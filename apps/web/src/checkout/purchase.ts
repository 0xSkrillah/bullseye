import type { Quote } from "@bullseye/domain";
import type { DeliveryEnvelope, OrderRow, PaidReply } from "../lib/api";
import type { Signer } from "../lib/pay";

/**
 * One buyer's purchase of one Brief, from this browser's point of view.
 *
 * The rule everything here serves: a second authorization is never requested because a response
 * was lost, the page was reloaded, or a write to storage failed. The wallet is asked to sign only
 * when no earlier purchase of this Brief is unresolved; every other path re-sends what was already
 * signed, or collects the order with its claim token. Both are answered from the seller's ledger
 * and can settle at most once.
 */
export type PurchaseStatus =
  | "INTENT" // recorded, nothing signed yet
  | "SIGNED" // the wallet signed; the request is not known to have been sent
  | "SUBMITTED" // sent to the seller; no answer received
  | "UNKNOWN" // the seller says the payment's outcome is not known
  | "PAID" // paid; the Brief has not reached this browser yet
  | "DELIVERED"
  | "FAILED"; // the seller says nothing was charged; a new purchase is allowed

export interface PurchaseRecord {
  v: 1;
  briefId: string;
  /** the immutable quote the buyer approved: id, terms and their hash */
  quote: Quote;
  /** capability chosen here, before anything is signed, and sent with the payment: the seller answers this order only to its holder */
  claim: string;
  /** PAYMENT-SIGNATURE header value; re-sent as is, never replaced */
  paymentSignature: string | null;
  orderId: string | null;
  status: PurchaseStatus;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CheckoutIssue =
  | { kind: "NO_WALLET"; challenge: string }
  | { kind: "WALLET_DECLINED"; detail: string }
  | { kind: "WRONG_NETWORK"; detail: string }
  | { kind: "WALLET_ERROR"; detail: string }
  | { kind: "QUOTE_MISMATCH"; detail: string }
  | { kind: "QUOTE_EXPIRED" }
  | { kind: "INSUFFICIENT_FUNDS"; detail: string }
  | { kind: "PAYMENT_REJECTED"; detail: string }
  | { kind: "WITHDRAWN"; detail: string }
  | { kind: "RATE_LIMITED"; retryAfterSeconds: number | null }
  | { kind: "RAIL_UNAVAILABLE"; detail: string }
  | { kind: "NO_ANSWER"; detail: string }
  | { kind: "OUTCOME_UNKNOWN" }
  | { kind: "IN_PROGRESS" }
  | { kind: "CLAIM_REFUSED" }
  | { kind: "CONTENT_MISMATCH"; detail: string }
  | { kind: "UNEXPECTED"; status: number; detail: string };

/** true when the issue leaves the buyer certain that nothing was signed or nothing was charged */
export function nothingCharged(issue: CheckoutIssue): boolean {
  return ["NO_WALLET", "WALLET_DECLINED", "WRONG_NETWORK", "WALLET_ERROR", "QUOTE_MISMATCH", "QUOTE_EXPIRED", "INSUFFICIENT_FUNDS", "PAYMENT_REJECTED", "WITHDRAWN", "RAIL_UNAVAILABLE"].includes(issue.kind);
}

export interface CheckoutResult {
  record: PurchaseRecord | null;
  envelope: DeliveryEnvelope | null;
  issue: CheckoutIssue | null;
}

export interface PurchaseStore {
  get(briefId: string): PurchaseRecord | null;
  /** false when the record is held only in this page's memory and will not survive a reload */
  put(record: PurchaseRecord): boolean;
  remove(briefId: string): void;
}

export interface CheckoutHttp {
  paidBrief(briefId: string, quoteId: string, paymentSignature?: string, claim?: string): Promise<PaidReply>;
  delivery(orderId: string, claim: string): Promise<PaidReply>;
  reconcile(orderId: string, claim: string): Promise<OrderRow>;
}

export interface CheckoutDeps {
  http: CheckoutHttp;
  store: PurchaseStore;
  signer(): Signer | undefined;
  now?(): Date;
  newClaim?(): string;
}

const KEY = (briefId: string) => `bullseye.purchase.v1:${briefId}`;

/** localStorage when the browser allows it, this page's memory when it does not. Holds no private key. */
export function browserStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = safeLocalStorage()): PurchaseStore {
  const memory = new Map<string, PurchaseRecord>();
  return {
    get(briefId) {
      const held = memory.get(briefId);
      if (held) return held;
      try {
        const raw = storage?.getItem(KEY(briefId));
        const parsed = raw ? (JSON.parse(raw) as PurchaseRecord) : null;
        return parsed && parsed.v === 1 && parsed.briefId === briefId && typeof parsed.claim === "string" ? parsed : null;
      } catch {
        return null;
      }
    },
    put(record) {
      memory.set(record.briefId, record);
      try {
        if (!storage) return false;
        storage.setItem(KEY(record.briefId), JSON.stringify(record));
        return true;
      } catch {
        return false;
      }
    },
    remove(briefId) {
      memory.delete(briefId);
      try {
        storage?.removeItem(KEY(briefId));
      } catch {
        // nothing to do: the memory copy is gone and storage was never reachable
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url: long enough to be a secret, plain enough for a header */
export function randomClaim(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.length > 0 ? v : fallback);
const field = (body: unknown, key: string): unknown => (body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);

export class Checkout {
  /** one purchase per Brief in flight: a double click shares the first click's promise, and its one signature */
  private readonly running = new Map<string, Promise<CheckoutResult>>();
  /** false once a write did not reach durable storage; the screen says so */
  durable = true;

  constructor(private readonly deps: CheckoutDeps) {}

  record(briefId: string): PurchaseRecord | null {
    return this.deps.store.get(briefId);
  }

  /** The Pay button. Signs only if no earlier purchase of this Brief is unresolved; otherwise resumes that purchase. */
  pay(quote: Quote): Promise<CheckoutResult> {
    return this.once(quote.terms.briefId, async () => {
      const earlier = this.record(quote.terms.briefId);
      if (earlier && earlier.status !== "INTENT" && earlier.status !== "FAILED") return this.recover(earlier);
      if (Date.parse(quote.terms.expiresAt) <= this.now().getTime()) return { record: earlier, envelope: null, issue: { kind: "QUOTE_EXPIRED" } };

      // the claim token is chosen and kept before anything is signed, so no lost response can leave the buyer without it
      const at = this.now().toISOString();
      let record: PurchaseRecord = earlier?.status === "INTENT" && earlier.quote.id === quote.id ? earlier : { v: 1, briefId: quote.terms.briefId, quote, claim: (this.deps.newClaim ?? randomClaim)(), paymentSignature: null, orderId: null, status: "INTENT", detail: null, createdAt: at, updatedAt: at };
      this.save(record);

      let first: PaidReply;
      try {
        first = await this.deps.http.paidBrief(record.briefId, quote.id);
      } catch (err) {
        return { record, envelope: null, issue: { kind: "UNEXPECTED", status: 0, detail: `The seller could not be reached for a challenge: ${message(err)}. Nothing was signed.` } };
      }
      if (first.status !== 402 || !first.challenge) return { record, envelope: null, issue: this.unsignedIssue(first) };

      const signer = this.deps.signer();
      if (!signer) return { record, envelope: null, issue: { kind: "NO_WALLET", challenge: first.challenge } };
      let signature: string;
      try {
        signature = await signer.sign(first.challenge, quote);
      } catch (err) {
        const issue = walletIssue(err);
        record = this.save({ ...record, detail: "detail" in issue ? issue.detail : null });
        return { record, envelope: null, issue };
      }
      // kept before it is sent: if the tab dies mid-request, the same authorization is what gets re-sent
      record = this.save({ ...record, paymentSignature: signature, status: "SIGNED", detail: null });
      return this.send(record);
    });
  }

  /** Reload, another tab, a lost response, an expired authorization: get back to the same purchase without the wallet. */
  resume(briefId: string): Promise<CheckoutResult> {
    return this.once(briefId, async () => {
      const record = this.record(briefId);
      if (!record) return { record: null, envelope: null, issue: null };
      return this.recover(record);
    });
  }

  /** Ask the seller to read the chain for an order whose outcome is unknown. Never settles; never signs. */
  reconcile(briefId: string): Promise<CheckoutResult> {
    return this.once(briefId, async () => {
      const record = this.record(briefId);
      if (!record?.orderId) return record ? this.recover(record) : { record: null, envelope: null, issue: null };
      let row: OrderRow;
      try {
        row = await this.deps.http.reconcile(record.orderId, record.claim);
      } catch (err) {
        return { record, envelope: null, issue: { kind: "NO_ANSWER", detail: `The seller did not answer the reconcile request: ${message(err)}. The order is unchanged.` } };
      }
      const state = row.order.state;
      if (state === "PAID" || state === "DELIVERING" || state === "DELIVERY_FAILED" || state === "DELIVERED") return this.collect(this.save({ ...record, status: "PAID", detail: null }));
      if (state === "PAYMENT_FAILED") return { record: this.save({ ...record, status: "FAILED", detail: "The seller found the authorization unused. Nothing was charged." }), envelope: null, issue: { kind: "PAYMENT_REJECTED", detail: "The authorization was never used. Nothing was charged." } };
      return { record: this.save({ ...record, status: "UNKNOWN" }), envelope: null, issue: { kind: "OUTCOME_UNKNOWN" } };
    });
  }

  /** Drop a purchase that charged nothing, so a new quote can be bought. Refuses anything that may have been paid. */
  forget(briefId: string): boolean {
    const record = this.record(briefId);
    if (record && record.status !== "INTENT" && record.status !== "FAILED") return false;
    this.deps.store.remove(briefId);
    return true;
  }

  private recover(record: PurchaseRecord): Promise<CheckoutResult> {
    if (record.orderId) return this.collect(record);
    if (record.paymentSignature) return this.send(record);
    return Promise.resolve({ record, envelope: null, issue: null });
  }

  /** The paid request with the authorization already held. The seller finds the order by it, or opens it if the first request never arrived. */
  private async send(record: PurchaseRecord): Promise<CheckoutResult> {
    const signature = record.paymentSignature;
    if (!signature) return { record, envelope: null, issue: null };
    record = this.save({ ...record, status: record.status === "SIGNED" ? "SUBMITTED" : record.status });
    let reply: PaidReply;
    try {
      reply = await this.deps.http.paidBrief(record.briefId, record.quote.id, signature, record.claim);
    } catch (err) {
      return { record, envelope: null, issue: { kind: "NO_ANSWER", detail: `The request was sent and no answer came back: ${message(err)}. It may or may not have been paid.` } };
    }
    return this.settle(record, reply, true);
  }

  private async collect(record: PurchaseRecord): Promise<CheckoutResult> {
    if (!record.orderId) return { record, envelope: null, issue: null };
    let reply: PaidReply;
    try {
      reply = await this.deps.http.delivery(record.orderId, record.claim);
    } catch (err) {
      return { record, envelope: null, issue: { kind: "NO_ANSWER", detail: `The seller did not answer: ${message(err)}. Your order is unchanged.` } };
    }
    return this.settle(record, reply, false);
  }

  private settle(held: PurchaseRecord, reply: PaidReply, sentAuthorization: boolean): CheckoutResult {
    // a token comes back only when the seller did not bind the one sent with the payment; then the seller's is the one that works
    const record = reply.claim && reply.claim !== held.claim ? { ...held, claim: reply.claim } : held;
    const orderId = reply.orderId ?? (typeof field(reply.body, "orderId") === "string" ? (field(reply.body, "orderId") as string) : null) ?? record.orderId;
    const error = text(field(reply.body, "error"), "");
    switch (reply.status) {
      case 200: {
        const envelope = reply.body as DeliveryEnvelope;
        if (envelope?.quote?.termsHash !== record.quote.termsHash || envelope?.brief?.contentHash !== record.quote.terms.briefContentHash) {
          return { record: this.save({ ...record, orderId, status: "PAID", detail: "delivered content did not match the quote" }), envelope: null, issue: { kind: "CONTENT_MISMATCH", detail: "The delivery does not match the terms or the content hash that were quoted, so it is not shown." } };
        }
        return { record: this.save({ ...record, orderId: envelope.orderId, status: "DELIVERED", detail: null }), envelope, issue: null };
      }
      case 503:
        if (error === "payment_outcome_unknown") return { record: this.save({ ...record, orderId, status: "UNKNOWN", detail: null }), envelope: null, issue: { kind: "OUTCOME_UNKNOWN" } };
        return { record, envelope: null, issue: { kind: "RAIL_UNAVAILABLE", detail: text(field(reply.body, "detail"), "The payment rail is not available.") } };
      case 409:
        if (error === "payment_in_progress") return { record: this.save({ ...record, orderId }), envelope: null, issue: { kind: "IN_PROGRESS" } };
        if (error === "payment_failed") return this.failed(record, orderId, text(field(reply.body, "detail"), "The payment failed."));
        return { record: this.save({ ...record, orderId }), envelope: null, issue: { kind: "UNEXPECTED", status: 409, detail: text(error, "conflict") } };
      case 402: {
        // a challenge in answer to a held authorization means no order is, or can be, paid by it
        const reason = text(error, "The seller did not accept the authorization.");
        // consumed on-chain yet unknown to the seller's ledger: not a case where anyone may say "nothing was charged"
        if (/nonce|already.?used/i.test(reason)) return { record: this.save({ ...record, orderId }), envelope: null, issue: { kind: "UNEXPECTED", status: 402, detail: `${reason}. The seller has no order for this authorization although it reports it used. Do not pay again; ask the operator to check the payer address.` } };
        const issue: CheckoutIssue = /insufficient/i.test(reason) ? { kind: "INSUFFICIENT_FUNDS", detail: reason } : /expired/i.test(reason) ? { kind: "QUOTE_EXPIRED" } : { kind: "PAYMENT_REJECTED", detail: reason };
        return { record: this.save({ ...record, orderId, status: "FAILED", detail: reason }), envelope: null, issue };
      }
      case 410:
        return { record: sentAuthorization ? this.save({ ...record, status: "FAILED", detail: "withdrawn before payment" }) : record, envelope: null, issue: { kind: "WITHDRAWN", detail: text(field(reply.body, "detail"), "This Brief is no longer sold.") } };
      case 403:
        return { record, envelope: null, issue: { kind: "CLAIM_REFUSED" } };
      case 429:
        return { record, envelope: null, issue: { kind: "RATE_LIMITED", retryAfterSeconds: reply.retryAfterSeconds } };
      case 502:
        // the seller could not reach the facilitator to verify, and records that settlement was never attempted
        if (error === "payment_verification_unavailable") return this.failed(record, orderId, "The seller could not verify the authorization and did not submit it.");
        return { record: this.save({ ...record, orderId }), envelope: null, issue: { kind: "UNEXPECTED", status: 502, detail: text(error, "bad gateway") } };
      default:
        // paid and not delivered (500 delivery_failed) lands here too: the order id is kept and collecting is retried
        return { record: this.save({ ...record, orderId }), envelope: null, issue: { kind: "UNEXPECTED", status: reply.status, detail: text(error, `the seller answered ${reply.status}`) } };
    }
  }

  private failed(record: PurchaseRecord, orderId: string | null, detail: string): CheckoutResult {
    return { record: this.save({ ...record, orderId, status: "FAILED", detail }), envelope: null, issue: { kind: "PAYMENT_REJECTED", detail: `${detail} Nothing was charged.` } };
  }

  private unsignedIssue(first: PaidReply): CheckoutIssue {
    const detail = text(field(first.body, "detail"), text(field(first.body, "error"), `the seller answered ${first.status}`));
    if (first.status === 410) return { kind: "WITHDRAWN", detail };
    if (first.status === 503) return { kind: "RAIL_UNAVAILABLE", detail };
    if (first.status === 429) return { kind: "RATE_LIMITED", retryAfterSeconds: first.retryAfterSeconds };
    return { kind: "UNEXPECTED", status: first.status, detail: `${detail}. Nothing was signed.` };
  }

  private save(record: PurchaseRecord): PurchaseRecord {
    const next = { ...record, updatedAt: this.now().toISOString() };
    if (!this.deps.store.put(next)) this.durable = false;
    return next;
  }

  private once(briefId: string, run: () => Promise<CheckoutResult>): Promise<CheckoutResult> {
    const running = this.running.get(briefId);
    if (running) return running;
    const started = run().finally(() => this.running.delete(briefId));
    this.running.set(briefId, started);
    return started;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

/** wallet.ts and x402.ts throw named errors; they are matched by name because the signer loads as its own script */
function walletIssue(err: unknown): CheckoutIssue {
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown } | null)?.code;
  const detail = message(err);
  if (name === "WalletError") {
    if (code === "DECLINED") return { kind: "WALLET_DECLINED", detail };
    if (code === "NETWORK_MISSING" || code === "NETWORK_NOT_SWITCHED") return { kind: "WRONG_NETWORK", detail };
    return { kind: "WALLET_ERROR", detail };
  }
  if (name === "QuoteMismatchError") return { kind: "QUOTE_MISMATCH", detail };
  return { kind: "WALLET_ERROR", detail: `${detail} Nothing was sent.` };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
