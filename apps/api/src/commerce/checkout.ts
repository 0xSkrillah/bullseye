import { createHmac, timingSafeEqual } from "node:crypto";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { PaymentPayload, SettleResponse } from "@okxweb3/x402-core/types";
import { canonicalJson, type Brief, type Order, type PaymentEvidence, type Quote, type QuoteTerms } from "@bullseye/domain";
import { sha256 } from "../adapters/transport.js";
import { DuplicatePaymentError, OrderLedger, QuoteExpiredError } from "./orderLedger.js";
import { readAuthorization, type Eip3009Authorization, type PaymentRailAdapter } from "./rail.js";

export interface HttpReply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  /** call once the response has actually been written; a delivery only counts when it left the building */
  onSent?: () => void;
}

export interface DeliveryEnvelope {
  schema: "bullseye.delivery/v1";
  orderId: string;
  state: Order["state"];
  quote: { id: string; termsHash: string; terms: QuoteTerms };
  payment: PaymentEvidence;
  brief: Brief;
}

export interface CheckoutDeps {
  ledger: OrderLedger;
  rail: PaymentRailAdapter;
  publicBaseUrl: string;
  priceUsd: string;
  quoteTtlSeconds: number;
  getBrief(id: string): Brief | null;
  /** why a Brief may no longer be sold (the issuer voided the action it describes), or null */
  withdrawnReason?(brief: Brief): string | null;
  now?: () => Date;
}

/**
 * The paid resource. One signed authorization maps to exactly one order, and an
 * order settles at most once: every retry is answered from the ledger.
 */
export class Checkout {
  /** orders whose verify/settle call is running in this process right now */
  private readonly inFlight = new Set<string>();
  /** one reconciliation per order at a time; overlapping retries share it */
  private readonly reconciling = new Map<string, Promise<Order | null>>();

  constructor(private readonly deps: CheckoutDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** `resource` is the URL the buyer calls; it defaults to the Brief's own address */
  async quote(brief: Brief, resource = `${this.deps.publicBaseUrl}/api/v1/briefs/${brief.id}`): Promise<Quote> {
    const { ledger, rail } = this.deps;
    const now = this.now();
    const open = ledger.findOpenQuote(brief.id, now, resource);
    const status = rail.status();
    // an open quote is reused only if it still describes what this server would charge today
    if (open && open.terms.briefContentHash === brief.contentHash && open.terms.priceUsd === this.deps.priceUsd && open.terms.payTo === status.payTo && open.terms.rail === rail.rail) return open;
    if (!status.payTo) throw new RailNotReadyError("PAY_TO_ADDRESS is not set");
    const priced = await rail.price(this.deps.priceUsd);
    return ledger.issueQuote({
      briefId: brief.id,
      briefContentHash: brief.contentHash,
      priceUsd: this.deps.priceUsd,
      amount: priced.amount,
      asset: priced.asset,
      assetName: priced.assetName,
      assetDecimals: priced.assetDecimals,
      network: rail.network,
      payTo: status.payTo,
      scheme: "exact",
      maxTimeoutSeconds: 300,
      extra: priced.extra,
      rail: rail.rail,
      resource,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.deps.quoteTtlSeconds * 1000).toISOString(),
    });
  }

  /** The x402 resource: /api/v1/briefs/:id, or a stable address that resolved to this Brief. */
  async handle(briefId: string, paymentHeader: string | undefined, quoteId: string | undefined, resource?: string, claimToken?: string): Promise<HttpReply> {
    const { ledger, rail } = this.deps;
    const brief = this.deps.getBrief(briefId);
    if (!brief) return json(404, { error: "brief_not_found" });

    const status = rail.status();
    if (!status.ready) {
      // no challenge is better than a challenge nobody can settle
      return json(503, { error: "payment_rail_unavailable", rail: status.rail, detail: status.detail });
    }

    const withdrawn = this.deps.withdrawnReason?.(brief) ?? null;
    if (!paymentHeader) return withdrawn ? gone(brief, withdrawn) : this.challenge(brief, quoteId ? ledger.getQuote(quoteId) : null, undefined, resource);

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(paymentHeader);
    } catch {
      return this.challenge(brief, null, "PAYMENT-SIGNATURE header could not be decoded", resource);
    }
    const auth = readAuthorization(payload);
    if (!auth) return this.challenge(brief, null, "payment payload carries no EIP-3009 authorization", resource);
    const paymentKey = sha256(`${payload.accepted?.network}:${payload.accepted?.asset}:${auth.from}:${auth.nonce}`.toLowerCase());

    // someone who already paid still gets what they paid for; nobody new is charged for a withdrawn Brief
    const existing = ledger.findByPaymentKey(paymentKey);
    if (existing) return this.recognise(existing, brief, payload, claimToken);
    if (withdrawn) return gone(brief, withdrawn);

    const quote = this.resolveQuote(brief, payload, quoteId);
    if (!quote) return this.challenge(brief, null, "payment does not match any quote issued for this brief", resource);

    // nothing is stored and the facilitator is not called for a payload that cannot possibly pay this quote
    const malformed = this.malformed(payload, auth, quote.terms);
    if (malformed) return this.challenge(brief, null, `payment rejected before verification: ${malformed}`, resource);

    // a buyer who sends their own token with the payment holds it whatever happens to the responses
    const chosen = claimToken !== undefined && BUYER_CLAIM.test(claimToken) ? claimToken : null;
    let order: Order;
    try {
      order = ledger.openOrder(quote, paymentKey, payload, this.now(), chosen ? `buyer:${sha256(chosen)}` : null);
    } catch (err) {
      if (err instanceof QuoteExpiredError) return this.challenge(brief, null, "quote expired; a new quote is attached", resource);
      if (err instanceof DuplicatePaymentError) {
        const winner = ledger.get(err.orderId);
        if (winner) return this.recognise(winner, brief, payload, claimToken);
      }
      throw err;
    }
    const reply = await this.pay(order, brief, payload);
    return chosen ? reply : withClaim(reply, this.serverClaim(order.id));
  }

  /** the same token for the same order every time, so re-issuing it can never invalidate the one the buyer already holds */
  private serverClaim(orderId: string): string {
    return createHmac("sha256", this.deps.ledger.secret("claim-token")).update(orderId).digest("base64url");
  }

  /**
   * (payer, nonce) is public once a payment is on-chain, and so is the signature, so neither proves
   * that the caller is the buyer. An existing order is only ever answered to someone who presents
   * the exact payload that opened it, and:
   *  - if the buyer sent their own claim token when they paid, only ever with that token;
   *  - otherwise, once the Brief has been delivered, only with the token the server returned.
   *    Until the first delivery the payload alone is accepted, because that is the path a buyer
   *    whose payment outcome is unknown retries on, and the server's token is returned again.
   */
  private async recognise(order: Order, brief: Brief, payload: PaymentPayload, claimToken: string | undefined): Promise<HttpReply> {
    const { ledger } = this.deps;
    const stored = ledger.paymentPayload(order.id) as PaymentPayload | null;
    const samePayload = stored !== null && digestEqual(canonicalJson(stored.payload ?? null), canonicalJson(payload.payload ?? null));
    if (!samePayload) return this.challenge(brief, null, "that authorization is already bound to an order and this request does not match it; sign a new authorization", order.terms.resource);
    if (order.terms.briefId !== brief.id) return json(409, { error: "authorization_bound_to_other_brief", orderId: order.id });

    const required = { error: "claim_token_required", orderId: order.id, detail: "Fetch this order with the X-Bullseye-Claim token: the one you sent with the payment, or the one returned with the first response." };
    const buyerHash = ledger.claimHash(order.id);
    if (buyerHash?.startsWith("buyer:")) {
      if (claimToken === undefined || !digestEqual(`buyer:${sha256(claimToken)}`, buyerHash)) return json(403, required);
      return this.resume(order, brief, payload);
    }
    const token = this.serverClaim(order.id);
    if (claimToken !== undefined && digestEqual(claimToken, token)) return withClaim(await this.resume(order, brief, payload), token);
    if (order.deliveryCount > 0) return json(403, required);
    return withClaim(await this.resume(order, brief, payload), token);
  }

  /**
   * Does this caller hold the order's claim token? The token is the only secret in a purchase: the
   * payer, the nonce and, once settled, the signature are all public. So the token alone is enough
   * to read, reconcile or collect the order it belongs to, and nothing else ever is.
   */
  holdsClaim(orderId: string, claimToken: string | undefined): boolean {
    if (claimToken === undefined || claimToken.length === 0 || claimToken.length > 256) return false;
    const buyerHash = this.deps.ledger.claimHash(orderId);
    if (buyerHash?.startsWith("buyer:")) return digestEqual(`buyer:${sha256(claimToken)}`, buyerHash);
    return digestEqual(claimToken, this.serverClaim(orderId));
  }

  /**
   * Delivery for a buyer who holds the claim token but no longer the signed authorization: a reload,
   * another tab, or an authorization long past its validBefore. Never settles and never issues a
   * challenge, so collecting what was bought can never turn into a second purchase.
   */
  async collect(orderId: string, claimToken: string | undefined): Promise<HttpReply> {
    const { ledger } = this.deps;
    let order = ledger.get(orderId);
    // the same answer whether or not the order exists, so ids cannot be probed
    if (!order || !this.holdsClaim(orderId, claimToken)) return json(403, { error: "claim_token_required", detail: "This order is answered only to its buyer. Send the X-Bullseye-Claim token it was opened with." });
    const brief = this.deps.getBrief(order.terms.briefId);
    if (!brief) return json(404, { error: "brief_not_found", orderId });

    if (order.state === "PAYMENT_PENDING" && this.inFlight.has(order.id)) return { status: 409, headers: { "retry-after": "3", "content-type": "application/json" }, body: { error: "payment_in_progress", orderId, state: order.state } };
    if (order.state === "PAYMENT_PENDING") order = ledger.transition(order.id, "PAYMENT_UNKNOWN", "settlement was interrupted before an outcome was recorded", this.evidence(order, null, null, "outcome unknown"));
    if (order.state === "PAYMENT_UNKNOWN" || order.state === "RECONCILIATION_REQUIRED") order = (await this.reconcile(order.id)) ?? order;
    if (order.state === "PAID" || order.state === "DELIVERING" || order.state === "DELIVERY_FAILED" || order.state === "DELIVERED") return this.deliver(order, brief, null);
    if (order.state === "PAYMENT_FAILED") return json(409, { error: "payment_failed", orderId, state: order.state, detail: "This order's payment failed and nothing was charged. A new purchase needs a new quote." });
    return this.unknownReply(order);
  }

  /** cheap checks that need no network: the authorization must be for this quote and carry a signature */
  private malformed(payload: PaymentPayload, auth: Eip3009Authorization, terms: QuoteTerms): string | null {
    const signature = (payload.payload as { signature?: unknown } | undefined)?.signature;
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130,}$/.test(signature)) return "no signature";
    if (!/^0x[0-9a-fA-F]{40}$/.test(auth.from) || typeof auth.to !== "string" || auth.to.toLowerCase() !== terms.payTo.toLowerCase()) return "authorization is not addressed to the quoted recipient";
    if (typeof auth.value !== "string" || auth.value !== terms.amount) return "authorization is not for the quoted amount";
    if (!/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) return "nonce is not 32 bytes";
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (!/^\d{1,12}$/.test(auth.validBefore) || Number(auth.validBefore) <= nowSeconds) return "authorization has expired";
    if (typeof auth.validAfter !== "string" || !/^\d{1,12}$/.test(auth.validAfter) || Number(auth.validAfter) > nowSeconds + 60) return "authorization is not valid yet";
    return null;
  }

  /**
   * Which Brief a payment sent to a stable address was signed for. The address may point at a newer
   * Brief by the time the buyer pays, and every Brief costs the same, so the payment alone does not
   * say. An order that already exists answers it; otherwise the quotes issued at that address do,
   * preferring the Brief named in the resource description the buyer's client echoes back.
   */
  briefForPayment(paymentHeader: string, resource: string): string | null {
    const { ledger, rail } = this.deps;
    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(paymentHeader);
    } catch {
      return null;
    }
    const auth = readAuthorization(payload);
    if (!auth) return null;
    const existing = ledger.findByPaymentKey(sha256(`${payload.accepted?.network}:${payload.accepted?.asset}:${auth.from}:${auth.nonce}`.toLowerCase()));
    if (existing) return existing.terms.briefId;
    const candidates = ledger.quotesForResource(resource).filter((q) => rail.matches(q.terms, payload));
    const named = /\bbrf_[0-9a-f]{16}\b/.exec(payload.resource?.description ?? "")?.[0];
    return (candidates.find((q) => q.terms.briefId === named) ?? candidates[0])?.terms.briefId ?? null;
  }

  /** Re-examine an order whose payment outcome is not known. Never calls settle again. */
  async reconcile(orderId: string): Promise<Order | null> {
    const running = this.reconciling.get(orderId);
    if (running) return running;
    const run = this.reconcileOnce(orderId).finally(() => this.reconciling.delete(orderId));
    this.reconciling.set(orderId, run);
    return run;
  }

  private async reconcileOnce(orderId: string): Promise<Order | null> {
    const { ledger, rail } = this.deps;
    const order = ledger.get(orderId);
    if (!order) return null;
    if (order.state !== "PAYMENT_UNKNOWN" && order.state !== "RECONCILIATION_REQUIRED") return order;
    const payload = ledger.paymentPayload(orderId) as PaymentPayload | null;
    const auth = payload ? readAuthorization(payload) : null;
    const payment = order.payment ?? this.evidence(order, null, null);

    if (payment.txHash) {
      const settle = await rail.settleStatus(payment.txHash).catch(() => null);
      const chain = await rail.chainCheck(order.terms, payment.payer, payment.txHash);
      if (chain.verified || settle?.status === "success") {
        return ledger.transition(orderId, "PAID", `reconciled: ${chain.verified ? chain.note : "facilitator reports success"}`, { ...payment, facilitatorStatus: settle?.status ?? payment.facilitatorStatus, chainVerified: chain.verified, chainBlockNumber: chain.blockNumber, chainCheckedAt: chain.checkedAt, note: chain.note });
      }
      if (settle?.status === "failed") return ledger.transition(orderId, "PAYMENT_FAILED", `reconciled: facilitator reports failure (${settle.errorReason ?? "no reason"})`, { ...payment, facilitatorStatus: "failed" });
    }

    if (auth) {
      const used = await rail.authorizationUsed(order.terms, auth);
      if (used === true) {
        // consumed is not the same as paid: cancelAuthorization consumes a nonce too, so look for the transfer itself
        const settled = await rail.authorizationSettled(order.terms, auth, new Date(order.createdAt));
        if (settled?.verified) {
          return ledger.transition(orderId, "PAID", `reconciled: ${settled.note}`, { ...payment, payer: payment.payer ?? auth.from, txHash: settled.txHash ?? payment.txHash, explorerUrl: rail.explorerUrl(settled.txHash ?? payment.txHash), chainVerified: true, chainBlockNumber: settled.blockNumber, chainCheckedAt: settled.checkedAt, note: settled.note });
        }
        const note = `authorization is consumed but the quoted transfer was not found (${settled?.note ?? "this rail cannot search the chain"}); it may have been cancelled`;
        if (order.state === "PAYMENT_UNKNOWN") return ledger.transition(orderId, "RECONCILIATION_REQUIRED", note, { ...payment, note });
        return order;
      }
      if (used === false && Number(auth.validBefore) * 1000 < this.now().getTime()) {
        return ledger.transition(orderId, "PAYMENT_FAILED", "reconciled: authorization expired unused, the buyer was not charged", { ...payment, note: "authorizationState false after validBefore" });
      }
    }

    if (order.state === "PAYMENT_UNKNOWN") return ledger.transition(orderId, "RECONCILIATION_REQUIRED", "automatic reconciliation could not determine the outcome");
    return order;
  }

  private resolveQuote(brief: Brief, payload: PaymentPayload, quoteId: string | undefined): Quote | null {
    const { ledger, rail } = this.deps;
    if (quoteId) {
      const q = ledger.getQuote(quoteId);
      return q && q.terms.briefId === brief.id && rail.matches(q.terms, payload) ? q : null;
    }
    return ledger.quotesForBrief(brief.id).find((q) => rail.matches(q.terms, payload)) ?? null;
  }

  private async challenge(brief: Brief, requested: Quote | null, error?: string, resource?: string): Promise<HttpReply> {
    const quote = requested && requested.terms.briefId === brief.id && Date.parse(requested.terms.expiresAt) > this.now().getTime() ? requested : await this.quote(brief, resource);
    const required = await this.deps.rail.paymentRequired(quote.terms, `Bullseye Brief ${brief.id}: ${brief.signal.headline}`, error);
    return {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required), "content-type": "application/json" },
      body: { ...required, bullseye: { quoteId: quote.id, termsHash: quote.termsHash, priceUsd: quote.terms.priceUsd, expiresAt: quote.terms.expiresAt, rail: quote.terms.rail } },
    };
  }

  private async pay(order: Order, brief: Brief, payload: PaymentPayload): Promise<HttpReply> {
    this.inFlight.add(order.id);
    try {
      return await this.settleAndDeliver(order, brief, payload);
    } finally {
      this.inFlight.delete(order.id);
    }
  }

  private async settleAndDeliver(order: Order, brief: Brief, payload: PaymentPayload): Promise<HttpReply> {
    const { ledger, rail } = this.deps;

    let verify;
    try {
      verify = await rail.verify(payload, order.terms);
    } catch (err) {
      // nothing has been submitted for settlement yet, so the buyer cannot have been charged
      const failed = ledger.transition(order.id, "PAYMENT_FAILED", `verification could not be performed: ${message(err)}`, this.evidence(order, null, null, "verify call failed; settle was never attempted"));
      return json(502, { error: "payment_verification_unavailable", order: failed });
    }
    if (!verify.isValid) {
      ledger.transition(order.id, "PAYMENT_FAILED", `facilitator rejected the authorization: ${verify.invalidReason ?? "unknown reason"}`, this.evidence(order, verify.payer ?? null, null, verify.invalidReason ?? null));
      return this.challenge(brief, null, `payment invalid: ${verify.invalidReason ?? "unknown reason"}`, order.terms.resource);
    }

    let settle: SettleResponse;
    try {
      settle = await rail.settle(payload, order.terms);
    } catch (err) {
      const settleError = err as { transaction?: string; errorReason?: string; statusCode?: number };
      // an explicit facilitator rejection is a failure; anything else (timeout, network, 5xx) is unknown
      if (settleError.errorReason && settleError.statusCode !== undefined && settleError.statusCode < 500 && !settleError.transaction) {
        const failed = ledger.transition(order.id, "PAYMENT_FAILED", `facilitator refused settlement: ${settleError.errorReason}`, this.evidence(order, verify.payer ?? null, null, settleError.errorReason));
        return json(402, { error: "payment_failed", order: failed });
      }
      const unknown = ledger.transition(order.id, "PAYMENT_UNKNOWN", `settle call did not return an outcome: ${message(err)}`, this.evidence(order, verify.payer ?? null, settleError.transaction || null, "outcome unknown"));
      return this.unknownReply(unknown);
    }

    const txHash = settle.transaction || null;
    const base = this.evidence(order, settle.payer ?? verify.payer ?? null, txHash, null, settle.status ?? (settle.success ? "success" : "failed"));

    if (settle.success && (settle.status === undefined || settle.status === "success")) {
      const chain = await rail.chainCheck(order.terms, base.payer, txHash);
      const paid = ledger.transition(order.id, "PAID", "facilitator settled the payment", { ...base, chainVerified: chain.verified, chainBlockNumber: chain.blockNumber, chainCheckedAt: chain.checkedAt, note: chain.note });
      return this.deliver(paid, brief, settle);
    }
    if (settle.status === "pending" || settle.status === "timeout") {
      const unknown = ledger.transition(order.id, "PAYMENT_UNKNOWN", `facilitator returned status "${settle.status}" without a final outcome`, { ...base, note: "awaiting reconciliation" });
      return this.unknownReply(unknown);
    }
    const failed = ledger.transition(order.id, "PAYMENT_FAILED", `settlement failed: ${settle.errorReason ?? "no reason given"}`, { ...base, note: settle.errorReason ?? null });
    return json(402, { error: "payment_failed", order: failed });
  }

  /** A request that carries an authorization we have already seen. Never settles again. */
  private async resume(order: Order, brief: Brief, payload: PaymentPayload): Promise<HttpReply> {
    switch (order.state) {
      case "DELIVERED":
      case "PAID":
      case "DELIVERING":
      case "DELIVERY_FAILED":
        return this.deliver(order, brief, null);
      case "PAYMENT_PENDING":
        if (this.inFlight.has(order.id)) return { status: 409, headers: { "retry-after": "3", "content-type": "application/json" }, body: { error: "payment_in_progress", orderId: order.id, state: order.state } };
        // the process stopped, or threw, between opening the order and recording an outcome; settle may or may not have gone out
        this.deps.ledger.transition(order.id, "PAYMENT_UNKNOWN", "settlement was interrupted before an outcome was recorded", this.evidence(order, null, null, "outcome unknown"));
      // falls through
      case "PAYMENT_UNKNOWN":
      case "RECONCILIATION_REQUIRED": {
        await this.reconcile(order.id);
        const after = this.deps.ledger.get(order.id) ?? order;
        if (after.state === "PAID" || after.state === "DELIVERING" || after.state === "DELIVERY_FAILED" || after.state === "DELIVERED") return this.deliver(after, brief, null);
        if (after.state === "PAYMENT_FAILED") return this.challenge(brief, null, "the earlier authorization expired unused; you were not charged", order.terms.resource);
        return this.unknownReply(after);
      }
      case "PAYMENT_FAILED":
        return this.challenge(brief, null, "that authorization failed and cannot be reused", order.terms.resource);
      default:
        void payload;
        return json(409, { error: "unexpected_order_state", orderId: order.id, state: order.state });
    }
  }

  private deliver(order: Order, brief: Brief, settle: SettleResponse | null): HttpReply {
    const { ledger } = this.deps;
    let current = order;
    try {
      if (current.state === "PAID" || current.state === "DELIVERY_FAILED") current = ledger.transition(current.id, "DELIVERING", "assembling delivery envelope");
      if (current.state === "DELIVERING") {
        if (brief.contentHash !== current.terms.briefContentHash) {
          current = ledger.transition(current.id, "DELIVERY_FAILED", "stored brief no longer matches the content hash that was quoted");
          return json(500, { error: "delivery_failed", order: current });
        }
        current = ledger.transition(current.id, "DELIVERED", "brief delivered to buyer");
      }
    } catch (err) {
      return json(500, { error: "delivery_failed", detail: message(err), orderId: current.id });
    }
    const delivered = current.id;
    const envelope: DeliveryEnvelope = {
      schema: "bullseye.delivery/v1",
      orderId: current.id,
      state: current.state,
      quote: { id: current.quoteId, termsHash: current.termsHash, terms: current.terms },
      payment: current.payment ?? this.evidence(current, null, null),
      brief,
    };
    const headers: Record<string, string> = { "content-type": "application/json", "x-bullseye-order": current.id };
    if (settle) headers["PAYMENT-RESPONSE"] = encodePaymentResponseHeader(settle);
    return { status: 200, headers, body: envelope, onSent: () => void ledger.recordDelivery(delivered) };
  }

  private unknownReply(order: Order): HttpReply {
    return {
      status: 503,
      headers: { "retry-after": "10", "content-type": "application/json", "x-bullseye-order": order.id },
      body: {
        error: "payment_outcome_unknown",
        message: "The payment was submitted but its outcome is not known. Do not sign a new authorization. Retry this request with the same PAYMENT-SIGNATURE header, or collect the order with its X-Bullseye-Claim token.",
        orderId: order.id,
        state: order.state,
        orderUrl: `${this.deps.publicBaseUrl}/api/orders/${order.id}`,
        deliveryUrl: `${this.deps.publicBaseUrl}/api/orders/${order.id}/delivery`,
      },
    };
  }

  private evidence(order: Order, payer: string | null, txHash: string | null, note: string | null = null, facilitatorStatus: string | null = null): PaymentEvidence {
    return {
      rail: order.terms.rail,
      payer,
      txHash,
      network: order.terms.network,
      facilitatorStatus,
      chainVerified: false,
      chainBlockNumber: null,
      chainCheckedAt: null,
      explorerUrl: this.deps.rail.explorerUrl(txHash),
      note,
    };
  }
}

export class RailNotReadyError extends Error {}

function gone(brief: Brief, reason: string): HttpReply {
  return json(410, { error: "brief_withdrawn", briefId: brief.id, detail: reason, message: "This Brief is no longer sold. Nothing was charged." });
}

/** a token the buyer picks: long enough to be a secret, plain enough for a header */
const BUYER_CLAIM = /^[A-Za-z0-9_-]{32,128}$/;

function digestEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

/** the claim token goes out in a header only, so it never lands in a saved delivery envelope */
function withClaim(reply: HttpReply, claim: string): HttpReply {
  return reply.status === 200 || reply.status === 503 || reply.status === 409 ? { ...reply, headers: { ...reply.headers, "x-bullseye-claim": claim } } : reply;
}

function json(status: number, body: unknown): HttpReply {
  return { status, headers: { "content-type": "application/json" }, body };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
