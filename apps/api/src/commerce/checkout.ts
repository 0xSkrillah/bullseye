import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { PaymentPayload, SettleResponse } from "@okxweb3/x402-core/types";
import type { Brief, Order, PaymentEvidence, Quote, QuoteTerms } from "@bullseye/domain";
import { sha256 } from "../adapters/transport.js";
import { DuplicatePaymentError, OrderLedger, QuoteExpiredError } from "./orderLedger.js";
import { readAuthorization, type PaymentRailAdapter } from "./rail.js";

export interface HttpReply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
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
  async handle(briefId: string, paymentHeader: string | undefined, quoteId: string | undefined, resource?: string): Promise<HttpReply> {
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
    if (existing) return this.resume(existing, brief, payload);
    if (withdrawn) return gone(brief, withdrawn);

    const quote = this.resolveQuote(brief, payload, quoteId);
    if (!quote) return this.challenge(brief, null, "payment does not match any quote issued for this brief", resource);

    let order: Order;
    try {
      order = ledger.openOrder(quote, paymentKey, payload, this.now());
    } catch (err) {
      if (err instanceof QuoteExpiredError) return this.challenge(brief, null, "quote expired; a new quote is attached", resource);
      if (err instanceof DuplicatePaymentError) {
        const winner = ledger.get(err.orderId);
        if (winner) return this.resume(winner, brief, payload);
      }
      throw err;
    }
    return this.pay(order, brief, payload);
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
        return ledger.transition(orderId, "PAID", "reconciled: the token contract reports this authorization as consumed", { ...payment, chainVerified: true, chainCheckedAt: new Date().toISOString(), note: "authorizationState(payer, nonce) returned true" });
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
    if (order.terms.briefId !== brief.id) return json(409, { error: "authorization_bound_to_other_brief", orderId: order.id });
    switch (order.state) {
      case "DELIVERED":
      case "PAID":
      case "DELIVERING":
      case "DELIVERY_FAILED":
        return this.deliver(order, brief, null);
      case "PAYMENT_PENDING":
        return { status: 409, headers: { "retry-after": "3", "content-type": "application/json" }, body: { error: "payment_in_progress", orderId: order.id, state: order.state } };
      case "PAYMENT_UNKNOWN":
      case "RECONCILIATION_REQUIRED": {
        const after = (await this.reconcile(order.id)) ?? order;
        if (after.state === "PAID") return this.deliver(after, brief, null);
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
    current = ledger.recordDelivery(current.id);
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
    return { status: 200, headers, body: envelope };
  }

  private unknownReply(order: Order): HttpReply {
    return {
      status: 503,
      headers: { "retry-after": "10", "content-type": "application/json", "x-bullseye-order": order.id },
      body: {
        error: "payment_outcome_unknown",
        message: "The payment was submitted but its outcome is not known. Do not sign a new authorization. Retry this request with the same PAYMENT-SIGNATURE header, or check the order.",
        orderId: order.id,
        state: order.state,
        orderUrl: `${this.deps.publicBaseUrl}/api/orders/${order.id}`,
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

function json(status: number, body: unknown): HttpReply {
  return { status, headers: { "content-type": "application/json" }, body };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
