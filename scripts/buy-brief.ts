/**
 * An agent buyer. Discovers a Brief in the catalogue, pays for it over x402 with
 * the OKX client SDK and saves the delivery envelope.
 *
 *   npm run buy -- <briefId|latest> [--base http://localhost:4402] [--max-usd 5] [--allow-mainnet]
 *
 * BUYER_PRIVATE_KEY must hold the buyer's key. It is never printed or written anywhere.
 * If the seller answers "payment outcome unknown" the SAME signed authorization is
 * retried; this script never signs twice for one purchase.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a) => !a.startsWith("--") && a !== flag("--base") && a !== flag("--max-usd")) ?? "latest";
const base = flag("--base") ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4402";
const maxUsd = Number(flag("--max-usd") ?? "5");
const allowMainnet = args.includes("--allow-mainnet");

const key = process.env.BUYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("BLOCKED: BUYER_PRIVATE_KEY is not set (expected a 0x-prefixed 32-byte hex key in the environment or .env).");
  process.exit(2);
}
const account = privateKeyToAccount(key as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const http = new x402HTTPClient(client);

let briefId = target;
if (target === "latest") {
  const catalog = (await (await fetch(`${base}/api/v1/catalog`)).json()) as { items: { id: string; headline: string }[] };
  if (catalog.items.length === 0) {
    console.error("nothing for sale: the catalogue is empty");
    process.exit(1);
  }
  briefId = catalog.items[0]!.id;
  console.log(`catalogue: ${catalog.items.length} brief(s); buying ${briefId} — ${catalog.items[0]!.headline}`);
}

const url = `${base}/api/v1/briefs/${briefId}`;
const challenge = await fetch(url);
if (challenge.status !== 402) {
  console.error(`expected 402 Payment Required, got ${challenge.status}: ${await challenge.text()}`);
  process.exit(1);
}
const required = http.getPaymentRequiredResponse((name) => challenge.headers.get(name));
const offer = required.accepts[0]!;
const quoted = (await challenge.json()) as { bullseye?: { quoteId: string; termsHash: string; priceUsd: string; rail: string } };
console.log(`quote ${quoted.bullseye?.quoteId} · $${quoted.bullseye?.priceUsd} · ${offer.amount} base units of ${offer.asset} on ${offer.network} · rail ${quoted.bullseye?.rail}`);

// spend guards: an agent should not sign whatever a seller asks for
if (offer.network === "eip155:196" && !allowMainnet) {
  console.error("refusing to pay on X Layer mainnet without --allow-mainnet");
  process.exit(3);
}
if (Number(quoted.bullseye?.priceUsd ?? Number.POSITIVE_INFINITY) > maxUsd) {
  console.error(`refusing: price $${quoted.bullseye?.priceUsd} exceeds --max-usd ${maxUsd}`);
  process.exit(3);
}

const payload = await http.createPaymentPayload(required);
const headers = http.encodePaymentSignatureHeader(payload);
console.log(`signed one authorization as ${account.address}`);

let res: Response | undefined;
for (let attempt = 1; attempt <= 6; attempt++) {
  res = await fetch(url, { headers });
  if (res.status !== 503 && res.status !== 409) break;
  const body = (await res.clone().json()) as { error?: string; state?: string; orderId?: string };
  console.log(`attempt ${attempt}: ${res.status} ${body.error} (order ${body.orderId}, state ${body.state}); retrying the same authorization in 10s`);
  await new Promise((r) => setTimeout(r, 10_000));
}
if (!res || res.status !== 200) {
  console.error(`not delivered: HTTP ${res?.status} ${await res?.text()}`);
  process.exit(1);
}

const envelope = (await res.json()) as {
  orderId: string;
  state: string;
  payment: { rail: string; txHash: string | null; chainVerified: boolean; explorerUrl: string | null };
  brief: { id: string; dataMode: string; contentHash: string; draft: { headline: string; confidence: { level: string } } };
};
mkdirSync("artifacts/evidence", { recursive: true });
const out = `artifacts/evidence/delivery-${envelope.orderId}.json`;
writeFileSync(out, JSON.stringify(envelope, null, 2));
console.log(`\ndelivered: ${envelope.brief.draft.headline}`);
console.log(`  order      ${envelope.orderId} (${envelope.state})`);
console.log(`  rail       ${envelope.payment.rail}${envelope.payment.rail === "OKX_X402_MAINNET" ? "" : "  — not revenue"}`);
console.log(`  tx         ${envelope.payment.txHash ?? "none"}  chain-verified: ${envelope.payment.chainVerified}`);
if (envelope.payment.explorerUrl) console.log(`  explorer   ${envelope.payment.explorerUrl}`);
console.log(`  brief      ${envelope.brief.id} · ${envelope.brief.dataMode} · confidence ${envelope.brief.draft.confidence.level} · sha256 ${envelope.brief.contentHash.slice(0, 16)}…`);
console.log(`  saved      ${out}`);
