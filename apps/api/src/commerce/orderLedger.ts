import { randomBytes } from "node:crypto";
import {
  canonicalJson,
  canTransition,
  IllegalTransitionError,
  Order,
  OrderState,
  PaymentEvidence,
  Quote,
  QuoteTerms,
  type OrderEvent,
} from "@bullseye/domain";
import { transaction, type Db } from "../db.js";
import { sha256 } from "../adapters/transport.js";

export class QuoteExpiredError extends Error {}
export class DuplicatePaymentError extends Error {
  constructor(readonly orderId: string) {
    super(`payment authorization already attached to order ${orderId}`);
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function hashTerms(terms: QuoteTerms): string {
  return sha256(canonicalJson(terms));
}

/**
 * Durable record of quotes and orders. Quotes are insert-only (enforced by
 * triggers), an order's quote and terms hash can never change, and every state
 * change is validated against the transition table and appended to order_events.
 */
export class OrderLedger {
  constructor(private readonly db: Db) {}

  issueQuote(terms: QuoteTerms): Quote {
    const parsed = QuoteTerms.parse(terms);
    const quote: Quote = { id: newId("quo"), terms: parsed, termsHash: hashTerms(parsed) };
    this.db.prepare("INSERT INTO quotes (id, brief_id, terms_json, terms_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(quote.id, parsed.briefId, JSON.stringify(parsed), quote.termsHash, parsed.issuedAt);
    return quote;
  }

  getQuote(id: string): Quote | null {
    const row = this.db.prepare("SELECT id, terms_json, terms_hash FROM quotes WHERE id = ?").get(id) as { id: string; terms_json: string; terms_hash: string } | undefined;
    if (!row) return null;
    const terms = QuoteTerms.parse(JSON.parse(row.terms_json));
    // a mismatch means the stored terms were altered outside this class
    if (hashTerms(terms) !== row.terms_hash) throw new Error(`quote ${id} failed its integrity check`);
    return { id: row.id, terms, termsHash: row.terms_hash };
  }

  /** newest quote for the brief that is still open at `now` */
  findOpenQuote(briefId: string, now: Date): Quote | null {
    const rows = this.db.prepare("SELECT id FROM quotes WHERE brief_id = ? ORDER BY created_at DESC LIMIT 20").all(briefId) as { id: string }[];
    for (const r of rows) {
      const q = this.getQuote(r.id);
      if (q && Date.parse(q.terms.expiresAt) > now.getTime()) return q;
    }
    return null;
  }

  quotesForBrief(briefId: string): Quote[] {
    const rows = this.db.prepare("SELECT id FROM quotes WHERE brief_id = ? ORDER BY created_at DESC LIMIT 50").all(briefId) as { id: string }[];
    return rows.map((r) => this.getQuote(r.id)).filter((q): q is Quote => q !== null);
  }

  /**
   * Buyer approval: binds a signed payment authorization to a quote and moves
   * straight to PAYMENT_PENDING. The UNIQUE payment_key makes this the single
   * point where a replayed or concurrent authorization is detected.
   */
  openOrder(quote: Quote, paymentKey: string, paymentPayload: unknown, now: Date): Order {
    if (Date.parse(quote.terms.expiresAt) <= now.getTime()) throw new QuoteExpiredError(`quote ${quote.id} expired at ${quote.terms.expiresAt}`);
    const id = newId("ord");
    const at = now.toISOString();
    return transaction(this.db, () => {
      const existing = this.db.prepare("SELECT id FROM orders WHERE payment_key = ?").get(paymentKey) as { id: string } | undefined;
      if (existing) throw new DuplicatePaymentError(existing.id);
      this.db
        .prepare("INSERT INTO orders (id, quote_id, terms_hash, state, payment_key, payment_payload_json, delivery_count, created_at, updated_at) VALUES (?, ?, ?, 'QUOTED', ?, ?, 0, ?, ?)")
        .run(id, quote.id, quote.termsHash, paymentKey, JSON.stringify(paymentPayload), at, at);
      this.appendEvent(id, null, "QUOTED", `buyer approved quote ${quote.id} (terms ${quote.termsHash.slice(0, 12)}…)`, at);
      this.move(id, "PAYMENT_PENDING", "signed payment authorization received", at);
      return this.mustGet(id);
    });
  }

  findByPaymentKey(paymentKey: string): Order | null {
    const row = this.db.prepare("SELECT id FROM orders WHERE payment_key = ?").get(paymentKey) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  transition(orderId: string, to: OrderState, reason: string, payment?: PaymentEvidence): Order {
    return transaction(this.db, () => {
      if (payment) this.db.prepare("UPDATE orders SET payment_json = ? WHERE id = ?").run(JSON.stringify(PaymentEvidence.parse(payment)), orderId);
      this.move(orderId, to, reason, new Date().toISOString());
      return this.mustGet(orderId);
    });
  }

  /** update payment evidence without changing state (for example a later chain confirmation) */
  annotatePayment(orderId: string, payment: PaymentEvidence): Order {
    this.db.prepare("UPDATE orders SET payment_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(PaymentEvidence.parse(payment)), new Date().toISOString(), orderId);
    return this.mustGet(orderId);
  }

  recordDelivery(orderId: string): Order {
    this.db.prepare("UPDATE orders SET delivery_count = delivery_count + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), orderId);
    return this.mustGet(orderId);
  }

  paymentPayload(orderId: string): unknown {
    const row = this.db.prepare("SELECT payment_payload_json FROM orders WHERE id = ?").get(orderId) as { payment_payload_json: string | null } | undefined;
    return row?.payment_payload_json ? JSON.parse(row.payment_payload_json) : null;
  }

  get(id: string): Order | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Record<string, string | number | null> | undefined;
    if (!row) return null;
    const quote = this.getQuote(String(row.quote_id));
    if (!quote) throw new Error(`order ${id} references missing quote ${String(row.quote_id)}`);
    if (quote.termsHash !== row.terms_hash) throw new Error(`order ${id} terms hash does not match its quote`);
    const events = (this.db.prepare("SELECT seq, at, from_state, to_state, reason FROM order_events WHERE order_id = ? ORDER BY seq").all(id) as { seq: number; at: string; from_state: string | null; to_state: string; reason: string }[]).map(
      (e): OrderEvent => ({ seq: e.seq, at: e.at, from: e.from_state === null ? null : OrderState.parse(e.from_state), to: OrderState.parse(e.to_state), reason: e.reason }),
    );
    return Order.parse({
      id: row.id,
      quoteId: row.quote_id,
      termsHash: row.terms_hash,
      terms: quote.terms,
      state: row.state,
      paymentKey: row.payment_key,
      payment: row.payment_json ? JSON.parse(String(row.payment_json)) : null,
      deliveryCount: row.delivery_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events,
    });
  }

  list(limit = 50): Order[] {
    const rows = this.db.prepare("SELECT id FROM orders ORDER BY created_at DESC LIMIT ?").all(limit) as { id: string }[];
    return rows.map((r) => this.mustGet(r.id));
  }

  private mustGet(id: string): Order {
    const order = this.get(id);
    if (!order) throw new Error(`order ${id} not found`);
    return order;
  }

  private move(orderId: string, to: OrderState, reason: string, at: string): void {
    const row = this.db.prepare("SELECT state FROM orders WHERE id = ?").get(orderId) as { state: string } | undefined;
    if (!row) throw new Error(`order ${orderId} not found`);
    const from = OrderState.parse(row.state);
    if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
    this.db.prepare("UPDATE orders SET state = ?, updated_at = ? WHERE id = ?").run(to, at, orderId);
    this.appendEvent(orderId, from, to, reason, at);
  }

  private appendEvent(orderId: string, from: OrderState | null, to: OrderState, reason: string, at: string): void {
    const next = this.db.prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM order_events WHERE order_id = ?").get(orderId) as { n: number };
    this.db.prepare("INSERT INTO order_events (order_id, seq, at, from_state, to_state, reason) VALUES (?, ?, ?, ?, ?, ?)").run(orderId, next.n, at, from, to, reason);
  }
}
