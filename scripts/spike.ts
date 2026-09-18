/**
 * Integration spike. Exercises every external dependency once and writes what
 * actually happened to artifacts/integration/. Nothing here is mocked: a step
 * that cannot run is reported as BLOCKED with the exact reason.
 *
 *   npm run spike
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, hashDomain, http, parseAbi } from "viem";
import { z } from "zod";
import { loadConfig } from "../apps/api/src/config.js";
import { LiveTransport } from "../apps/api/src/adapters/transport.js";
import { XStocksAdapter } from "../apps/api/src/adapters/xstocks.js";
import { XLayerAdapter, xLayerTestnet } from "../apps/api/src/adapters/xlayer.js";
import { detectRebaseSignals, isRebaseCandidate } from "../apps/api/src/signals/rebaseDetector.js";
import { createOkxRail, SDK_VERSIONS } from "../apps/api/src/commerce/rail.js";

type StepStatus = "PASS" | "FAIL" | "BLOCKED";
interface Step {
  step: string;
  status: StepStatus;
  detail: unknown;
}

const steps: Step[] = [];
const record = (step: string, status: StepStatus, detail: unknown) => {
  steps.push({ step, status, detail });
  console.log(`[${status}] ${step}`);
};

const config = loadConfig();
const transport = new LiveTransport({ allowCached: false });
const xstocks = new XStocksAdapter(transport, config.XSTOCKS_BASE_URL);
const xlayer = new XLayerAdapter(transport, config.XLAYER_RPC_URL);

// 1. genuine RWA reference data, schema-validated
let signalForChain: ReturnType<typeof detectRebaseSignals>[number] | undefined;
try {
  const now = new Date();
  const actions = await xstocks.corporateActionHistory({ pageSize: 50 });
  const candidates = actions.data.filter((a) => isRebaseCandidate(a, now, 96));
  const assets = new Map();
  for (const symbol of [...new Set(candidates.map((c) => c.xstockSymbol))].slice(0, 6)) assets.set(symbol, await xstocks.asset(symbol));
  const signals = detectRebaseSignals({ actions, assets, now, lookbackHours: 96 });
  signalForChain = signals[0];
  record("xstocks: corporate-action history fetched and schema-validated", "PASS", {
    url: actions.provenance.url,
    sha256: actions.provenance.sha256,
    actions: actions.data.length,
    rebaseCandidates: candidates.length,
    signalsOnXLayer: signals.map((s) => ({ id: s.id, headline: s.headline, observedAt: s.observedAt, token: s.asset.tokenAddress })),
  });
} catch (err) {
  record("xstocks: corporate-action history fetched and schema-validated", "FAIL", String(err));
}

// 2. X Layer connectivity and an on-chain cross-check of the issuer's claim
try {
  const head = await xlayer.head();
  record("xlayer: connected to mainnet RPC", "PASS", { rpc: config.XLAYER_RPC_URL, ...head.data });
  if (signalForChain) {
    const effective = Date.parse(signalForChain.observedAt);
    const before = await xlayer.blockAtOrAfter(new Date(effective - 60_000).toISOString());
    const after = await xlayer.blockAtOrAfter(new Date(effective + 60_000).toISOString());
    const [mBefore, mAfter] = await Promise.all([
      xlayer.multiplierAt(signalForChain.asset.tokenAddress, before.data.blockNumber),
      xlayer.multiplierAt(signalForChain.asset.tokenAddress, after.data.blockNumber),
    ]);
    const agrees = mBefore.data.multiplier === normalise(signalForChain.facts.multiplierOld) && mAfter.data.multiplier === normalise(signalForChain.facts.multiplierNew);
    record("xlayer: on-chain multiplier() brackets the issuer-reported rebase", agrees ? "PASS" : "FAIL", {
      signal: signalForChain.id,
      issuer: { old: signalForChain.facts.multiplierOld, new: signalForChain.facts.multiplierNew, effective: signalForChain.observedAt },
      before: mBefore.data,
      after: mAfter.data,
    });
  } else {
    record("xlayer: on-chain multiplier() brackets the issuer-reported rebase", "BLOCKED", "no rebase on an X Layer deployment inside the last 96h");
  }
} catch (err) {
  record("xlayer: connected to mainnet RPC", "FAIL", String(err));
}

// 3. smallest documented OKX test-payment flow: the mock merchant's 402 challenge
const MockChallenge = z.object({
  x402Version: z.literal(2),
  accepts: z
    .array(z.object({ scheme: z.string(), network: z.string(), asset: z.string(), payTo: z.string(), extra: z.object({ name: z.string(), version: z.string() }).passthrough() }).passthrough())
    .min(1),
});
try {
  const res = await fetch("https://www.okx.com/api/v1/pay/mock-merchant/resource", { signal: AbortSignal.timeout(20_000) });
  const body: unknown = await res.json();
  const parsed = MockChallenge.parse(body);
  const exact = parsed.accepts.find((a) => a.scheme === "exact")!;
  const testnet = createPublicClient({ chain: xLayerTestnet, transport: http(config.XLAYER_TESTNET_RPC_URL) });
  const onchainSeparator = await testnet.readContract({ address: exact.asset as `0x${string}`, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" });
  const types = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
  } as const;
  const advertised = hashDomain({ domain: { name: exact.extra.name, version: exact.extra.version, chainId: 1952n, verifyingContract: exact.asset as `0x${string}` }, types });
  record("okx: mock merchant returns an x402 v2 challenge on X Layer testnet", res.status === 402 ? "PASS" : "FAIL", {
    httpStatus: res.status,
    paymentRequiredHeaderPresent: res.headers.has("payment-required"),
    challenge: parsed,
    eip712: { advertised: exact.extra, advertisedDomainSeparator: advertised, onchainDomainSeparator: onchainSeparator, match: advertised === onchainSeparator },
  });
} catch (err) {
  record("okx: mock merchant returns an x402 v2 challenge on X Layer testnet", "FAIL", String(err));
}

// 4. paying the mock merchant needs a funded buyer
record(
  "okx: buyer completes a test payment against the mock merchant",
  "BLOCKED",
  process.env.BUYER_PRIVATE_KEY ? "run `npm run verify-payment -- --mock-merchant` to attempt it with the configured buyer" : "BUYER_PRIVATE_KEY is not set; a faucet-funded X Layer testnet wallet is required",
);

// 5. Bullseye's own endpoint through the OKX seller SDK
const rail = createOkxRail({ mainnet: config.PAYMENT_RAIL === "okx-mainnet", apiKey: config.OKX_API_KEY, secretKey: config.OKX_SECRET_KEY, passphrase: config.OKX_PASSPHRASE, payTo: config.PAY_TO_ADDRESS, rpcUrl: config.XLAYER_TESTNET_RPC_URL });
const railStatus = await rail.init();
record("okx: Bullseye seller rail initialises against the OKX facilitator", railStatus.ready ? "PASS" : "BLOCKED", railStatus);

function normalise(decimal: string): string {
  return decimal.includes(".") ? decimal.replace(/0+$/, "").replace(/\.$/, "") : decimal;
}

mkdirSync("artifacts/integration", { recursive: true });
const out = `artifacts/integration/spike-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, sdk: SDK_VERSIONS, steps }, null, 2));
console.log(`\nwrote ${out}`);
process.exit(steps.some((s) => s.status === "FAIL") ? 1 : 0);
