/**
 * An agent buyer. Discovers a Brief in the catalogue, pays for it over x402 with
 * the OKX client SDK and saves the delivery envelope.
 *
 *   npm run buy -- <briefId|latest> [--base http://localhost:4402] [--max-usd 5] [--allow-mainnet]
 *   npm run buy -- --collect <orderId> [--base …]     fetch a purchase again with its claim token; signs nothing
 *
 * BUYER_PRIVATE_KEY must hold the buyer's key (64 hex characters, with or without 0x). It is never
 * printed or written anywhere.
 *
 * One purchase, one signature. The claim token and the signed authorization are written to
 * data/purchases/ (git-ignored) before anything is sent. If the seller answers "payment outcome
 * unknown", if the response is lost, or if this process dies, running the same command again
 * finds that entry and re-sends the SAME authorization: it never signs a second one for a
 * purchase that may already have been paid.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { api, friendlyErrors, readPrivateKey, ScriptError } from "./lib.js";
import { findByOrder, findOpen, JOURNAL_DIR, record, type PurchaseEntry } from "./purchase-journal.js";
import { acceptable, SETTLEMENT_ASSETS, type SpendLimits } from "./spend-guard.js";

friendlyErrors();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a) => !a.startsWith("--") && a !== flag("--base") && a !== flag("--max-usd") && a !== flag("--collect")) ?? "latest";
const base = flag("--base") ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4402";
const maxUsd = Number(flag("--max-usd") ?? "5");
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new ScriptError("--max-usd must be a positive number", 2);
const allowMainnet = args.includes("--allow-mainnet");
const limits: SpendLimits = { maxUsd, networks: allowMainnet ? ["eip155:1952", "eip155:196"] : ["eip155:1952"] };

type Envelope = {
  orderId: string;
  state: string;
  payment: { rail: string; txHash: string | null; chainVerified: boolean; explorerUrl: string | null };
  brief: { id: string; dataMode: string; contentHash: string; draft: { headline: string; confidence: { level: string } } };
};

/** the delivery envelope carries no claim token and no signature, so it is safe to keep as evidence */
function saveDelivery(envelope: Envelope): void {
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
}

const collect = flag("--collect");
if (collect) {
  const held = findByOrder(JOURNAL_DIR, collect);
  if (!held) throw new ScriptError(`no purchase entry for ${collect} under ${JOURNAL_DIR}. Only the buyer who made a purchase holds its claim token.`, 2);
  const again = await api(flag("--base") ?? held.entry.base, `/api/orders/${collect}/delivery`, { headers: { "x-bullseye-claim": held.entry.claim } });
  if (again.status !== 200) {
    console.error(`not delivered: HTTP ${again.status} ${await again.text()}`);
    process.exit(1);
  }
  console.log(`collected ${collect} with its claim token: nothing was signed and nothing was paid`);
  saveDelivery((await again.json()) as Envelope);
  process.exit(0);
}

const account = privateKeyToAccount(readPrivateKey("BUYER_PRIVATE_KEY"));
const client = new x402Client();
// the signer exists only for the allowed networks, and only offers that pass the limits can be selected for signing
registerExactEvmScheme(client, { signer: account, networks: limits.networks });
client.registerPolicy((_version, offers) => offers.filter((o) => acceptable(o, limits).ok));
const http = new x402HTTPClient(client);

let briefId = target;
if (target === "latest") {
  const catalog = (await (await api(base, "/api/v1/catalog")).json()) as { items: { id: string; headline: string }[] };
  if (catalog.items.length === 0) {
    console.error("nothing for sale: the catalogue is empty");
    process.exit(1);
  }
  briefId = catalog.items[0]!.id;
  console.log(`catalogue: ${catalog.items.length} brief(s); buying ${briefId} — ${catalog.items[0]!.headline}`);
}

const path = `/api/v1/briefs/${briefId}`;

// A purchase of this Brief that may already have been paid is resumed, never replaced.
const open = findOpen(JOURNAL_DIR, base, briefId, account.address);
let entry: PurchaseEntry;
let file: string;
if (open) {
  ({ entry, file } = open);
  console.log(`resuming the purchase signed ${entry.createdAt} (${entry.state}${entry.orderId ? `, order ${entry.orderId}` : ""}): re-sending the same authorization. Nothing new will be signed.`);
} else {
  const challenge = await api(base, path);
  if (challenge.status !== 402) {
    console.error(`expected 402 Payment Required, got ${challenge.status}: ${await challenge.text()}`);
    process.exit(1);
  }
  const required = http.getPaymentRequiredResponse((name) => challenge.headers.get(name));
  const quoted = (await challenge.json()) as { bullseye?: { quoteId: string; termsHash: string; priceUsd: string; rail: string } };
  console.log(`quote ${quoted.bullseye?.quoteId} · stated price $${quoted.bullseye?.priceUsd} · rail ${quoted.bullseye?.rail}`);

  // Spend guards run on the payment terms that would be signed, never on the seller's description of them.
  const verdicts = required.accepts.map((o) => ({ offer: o, verdict: acceptable(o, limits) }));
  for (const { offer, verdict } of verdicts) console.log(`  offer: ${offer.amount} base units of ${offer.asset} on ${offer.network} to ${offer.payTo} -> ${verdict.ok ? "within limits" : `refused: ${verdict.reason}`}`);
  if (!verdicts.some((v) => v.verdict.ok)) throw new ScriptError(`refusing to sign: no offer is within the limits (max $${maxUsd}, networks ${limits.networks.join(", ")}, known settlement assets only). Nothing was signed.`, 3);

  const payload = await http.createPaymentPayload(required);
  // last look at what was actually signed, before it leaves this process
  const signed = acceptable(payload.accepted, limits);
  const authorization = (payload.payload as { authorization?: { to?: string; value?: string } }).authorization;
  if (!signed.ok || authorization?.value !== payload.accepted.amount || authorization?.to?.toLowerCase() !== payload.accepted.payTo.toLowerCase()) {
    throw new ScriptError(`refusing to send: the signed authorization does not match an acceptable offer (${signed.ok ? "authorization differs from the offer" : signed.reason}). It was not sent.`, 3);
  }
  console.log(`signed one authorization as ${account.address}: ${payload.accepted.amount} base units of ${SETTLEMENT_ASSETS[payload.accepted.network]?.name} on ${payload.accepted.network}`);

  // Once a payment is on-chain its payer, nonce and signature are public, so none of them proves who the buyer is.
  // A secret sent with the payment does: the seller answers this order only to whoever presents it again.
  const at = new Date().toISOString();
  entry = { v: 1, base, briefId, path, quoteId: quoted.bullseye?.quoteId ?? null, termsHash: quoted.bullseye?.termsHash ?? null, payer: account.address, claim: randomBytes(32).toString("base64url"), paymentHeaders: http.encodePaymentSignatureHeader(payload), orderId: null, state: "SIGNED", createdAt: at, updatedAt: at };
  try {
    file = record(JOURNAL_DIR, entry);
  } catch (err) {
    // an authorization this script cannot find again is one it could end up signing twice
    throw new ScriptError(`refusing to send: the purchase could not be recorded under ${JOURNAL_DIR} (${err instanceof Error ? err.message : String(err)}). The authorization was not sent and will expire unused.`, 3);
  }
}

const keep = (change: Partial<PurchaseEntry>) => {
  entry = { ...entry, ...change };
  record(JOURNAL_DIR, entry, file);
};

let res: Response | undefined;
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    res = await api(base, entry.path, { headers: { ...entry.paymentHeaders, "x-bullseye-claim": entry.claim } });
  } catch (err) {
    if (err instanceof ScriptError) throw err;
    console.log(`attempt ${attempt}: no answer (${err instanceof Error ? err.message : String(err)}). It may or may not have been paid; retrying the same authorization in 10s`);
    await new Promise((r) => setTimeout(r, 10_000));
    continue;
  }
  if (res.status !== 503 && res.status !== 409) break;
  const body = (await res.clone().json()) as { error?: string; state?: string; orderId?: string };
  keep({ state: "UNKNOWN", orderId: body.orderId ?? entry.orderId });
  console.log(`attempt ${attempt}: ${res.status} ${body.error} (order ${body.orderId}, state ${body.state}); retrying the same authorization in 10s`);
  await new Promise((r) => setTimeout(r, 10_000));
}
if (res?.status === 402 || res?.status === 410) {
  // a challenge in answer to a held authorization means no order is, or can be, paid by it
  keep({ state: "FAILED" });
  console.error(`not paid: HTTP ${res.status} ${await res.text()}\nThe seller did not accept the authorization, so nothing was charged. Run the command again for a new quote.`);
  process.exit(1);
}
if (!res || res.status !== 200) {
  console.error(`not delivered: ${res ? `HTTP ${res.status} ${await res.text()}` : "no answer from the seller"}\nThe purchase is recorded${entry.orderId ? ` (order ${entry.orderId})` : ""}. Run the same command again: it re-sends the same authorization and signs nothing new.`);
  process.exit(1);
}

const envelope = (await res.json()) as Envelope;
keep({ state: "DELIVERED", orderId: envelope.orderId });
saveDelivery(envelope);
