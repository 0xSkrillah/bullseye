/**
 * Independent payment checks that do not trust Bullseye's own API.
 *
 *   npm run verify-payment -- <orderId> [--base http://localhost:4402]
 *       Reads the order, then looks at X Layer directly: the receipt must have
 *       succeeded and contain the exact Transfer the frozen quote asked for.
 *
 *   npm run verify-payment -- --mock-merchant
 *       Points the OKX client SDK at OKX's documented mock merchant and reports
 *       how far the smallest documented test-payment flow gets.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http as viemHttp, parseAbi, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { xLayer, xLayerTestnet } from "../apps/api/src/adapters/xlayer.js";
import { api, friendlyErrors, readPrivateKey, ScriptError } from "./lib.js";

friendlyErrors();

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : (process.env.PUBLIC_BASE_URL ?? "http://localhost:4402");
mkdirSync("artifacts/integration", { recursive: true });

if (args.includes("--mock-merchant")) {
  const MOCK = "https://www.okx.com/api/v1/pay/mock-merchant/resource";
  const funded = process.env.BUYER_PRIVATE_KEY?.trim() ? readPrivateKey("BUYER_PRIVATE_KEY") : null;
  // parsing the challenge needs no funds, so an ephemeral key is enough to reach the first failure
  const account = privateKeyToAccount(funded ?? generatePrivateKey());
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const sdk = new x402HTTPClient(client);

  const res = await fetch(MOCK);
  const bodyText = await res.text();
  const report: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    url: MOCK,
    httpStatus: res.status,
    paymentRequiredHeaderPresent: res.headers.has("payment-required"),
    challengeInBody: bodyText.includes('"accepts"'),
    buyerFunded: Boolean(funded),
  };
  try {
    const required = sdk.getPaymentRequiredResponse((name) => res.headers.get(name));
    report.sdkParsedChallenge = true;
    if (!funded) {
      report.outcome = "BLOCKED: challenge parsed, but BUYER_PRIVATE_KEY is not set so no payment was attempted";
    } else {
      const headers = sdk.encodePaymentSignatureHeader(await sdk.createPaymentPayload(required));
      const paid = await fetch(MOCK, { headers });
      report.outcome = `payment attempt returned HTTP ${paid.status}`;
      report.paymentResponse = (await paid.text()).slice(0, 2000);
    }
  } catch (err) {
    report.sdkParsedChallenge = false;
    report.outcome = `FAILED before signing: ${err instanceof Error ? err.message : String(err)}`;
  }
  const out = `artifacts/integration/mock-merchant-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);
  process.exit(0);
}

const orderId = args.find((a) => /^ord_[0-9a-f]{16}$/.test(a));
if (!orderId) {
  throw new ScriptError(
    ["usage: npm run verify-payment -- <orderId> | --mock-merchant", "", "<orderId> is a real order id such as ord_96c880f882fe7647: `npm run buy` prints it, and GET /api/orders lists them."].join("\n"),
    2,
  );
}

const found = (await (await api(base, `/api/orders/${orderId}`)).json()) as {
  order?: { state: string; terms: { rail: string; network: string; asset: string; payTo: string; amount: string }; payment: { txHash: string | null; payer: string | null } | null };
};
if (!found.order) {
  console.error(`order ${orderId} not found at ${base}`);
  process.exit(1);
}
const { order } = found;
console.log(`order ${orderId}: state ${order.state}, rail ${order.terms.rail}, tx ${order.payment?.txHash ?? "none"}`);

if (order.terms.rail === "FIXTURE") {
  console.log("VERDICT: NOT A CHAIN PAYMENT — this order used the fixture rail; no funds moved and there is nothing on-chain to verify.");
  process.exit(0);
}
if (!order.payment?.txHash) {
  console.log("VERDICT: UNVERIFIABLE — the order has no transaction hash.");
  process.exit(1);
}

const mainnet = order.terms.network === "eip155:196";
const chain = createPublicClient({ chain: mainnet ? xLayer : xLayerTestnet, transport: viemHttp(mainnet ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech") });
const receipt = await chain.getTransactionReceipt({ hash: order.payment.txHash as `0x${string}` });
const transfers = parseEventLogs({ abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]), logs: receipt.logs, eventName: "Transfer" });
const match = transfers.find((l) => getAddress(l.address) === getAddress(order.terms.asset) && getAddress(l.args.to) === getAddress(order.terms.payTo) && l.args.value === BigInt(order.terms.amount));
const verdict = receipt.status === "success" && match ? "VERIFIED" : "NOT VERIFIED";
const report = {
  checkedAt: new Date().toISOString(),
  orderId,
  network: order.terms.network,
  txHash: order.payment.txHash,
  receiptStatus: receipt.status,
  blockNumber: Number(receipt.blockNumber),
  quotedTransferFound: Boolean(match),
  from: match?.args.from ?? null,
  verdict,
  note: mainnet ? "X Layer mainnet" : "X Layer testnet: proves payment mechanics, not revenue",
};
writeFileSync(`artifacts/integration/payment-${orderId}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(verdict === "VERIFIED" ? 0 : 1);
