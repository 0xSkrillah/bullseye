import { describe, expect, it } from "vitest";
import { canTransition, IllegalTransitionError, ORDER_TRANSITIONS, OrderState, type QuoteTerms } from "@bullseye/domain";
import { openDb } from "../src/db.js";
import { DuplicatePaymentError, hashTerms, OrderLedger, QuoteExpiredError } from "../src/commerce/orderLedger.js";

const terms = (over: Partial<QuoteTerms> = {}): QuoteTerms => ({
  briefId: "brf_0000000000000001",
  briefContentHash: "c".repeat(64),
  priceUsd: "1.00",
  amount: "1000000",
  asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
  assetName: "USD₮0",
  assetDecimals: 6,
  network: "eip155:1952",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  scheme: "exact",
  maxTimeoutSeconds: 300,
  extra: { name: "USD₮0", version: "1" },
  rail: "FIXTURE",
  resource: "http://localhost/api/v1/briefs/brf_0000000000000001",
  issuedAt: "2026-09-18T12:00:00.000Z",
  expiresAt: "2026-09-18T12:15:00.000Z",
  ...over,
});
const now = new Date("2026-09-18T12:01:00.000Z");

describe("order state machine", () => {
  it("distinguishes quoted, pending, unknown, paid, delivering, delivered and failed", () => {
    expect(OrderState.options).toEqual(expect.arrayContaining(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED", "PAYMENT_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"]));
  });

  it("never lets an unknown or failed payment reach delivery without passing through PAID", () => {
    for (const from of ["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED", "PAYMENT_FAILED"] as const) {
      expect(canTransition(from, "DELIVERING")).toBe(false);
      expect(canTransition(from, "DELIVERED")).toBe(false);
    }
    expect(ORDER_TRANSITIONS.PAYMENT_FAILED).toEqual([]);
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
  });
});

describe("order ledger", () => {
  it("stores quote terms under a hash that survives the storage round trip", () => {
    const ledger = new OrderLedger(openDb(":memory:"));
    const quote = ledger.issueQuote(terms());
    const reread = ledger.getQuote(quote.id)!;
    expect(reread.termsHash).toBe(quote.termsHash);
    expect(hashTerms(reread.terms)).toBe(quote.termsHash);
  });

  it("detects terms that were altered behind its back", () => {
    const db = openDb(":memory:");
    const ledger = new OrderLedger(db);
    const quote = ledger.issueQuote(terms());
    db.exec("DROP TRIGGER quotes_immutable_update");
    db.prepare("UPDATE quotes SET terms_json = ? WHERE id = ?").run(JSON.stringify(terms({ amount: "1" })), quote.id);
    expect(() => ledger.getQuote(quote.id)).toThrow(/integrity/);
  });

  it("binds one payment authorization to one order", () => {
    const ledger = new OrderLedger(openDb(":memory:"));
    const quote = ledger.issueQuote(terms());
    const order = ledger.openOrder(quote, "paykey-1", { p: 1 }, now);
    expect(order.state).toBe("PAYMENT_PENDING");
    expect(() => ledger.openOrder(quote, "paykey-1", { p: 1 }, now)).toThrow(DuplicatePaymentError);
    expect(ledger.list()).toHaveLength(1);
  });

  it("refuses an expired quote", () => {
    const ledger = new OrderLedger(openDb(":memory:"));
    const quote = ledger.issueQuote(terms());
    expect(() => ledger.openOrder(quote, "k", {}, new Date("2026-09-18T12:15:01.000Z"))).toThrow(QuoteExpiredError);
    expect(ledger.list()).toHaveLength(0);
  });

  it("rejects illegal transitions and leaves the order untouched", () => {
    const ledger = new OrderLedger(openDb(":memory:"));
    const order = ledger.openOrder(ledger.issueQuote(terms()), "k", {}, now);
    expect(() => ledger.transition(order.id, "DELIVERED", "skip payment")).toThrow(IllegalTransitionError);
    expect(() => ledger.transition(order.id, "DELIVERING", "skip payment")).toThrow(IllegalTransitionError);
    const after = ledger.get(order.id)!;
    expect(after.state).toBe("PAYMENT_PENDING");
    expect(after.events.map((e) => e.to)).toEqual(["QUOTED", "PAYMENT_PENDING"]);
  });

  it("survives a process restart", () => {
    const db = openDb(":memory:");
    const first = new OrderLedger(db);
    const order = first.openOrder(first.issueQuote(terms()), "k", {}, now);
    first.transition(order.id, "PAYMENT_UNKNOWN", "timeout");
    const second = new OrderLedger(db);
    expect(second.findByPaymentKey("k")).toMatchObject({ id: order.id, state: "PAYMENT_UNKNOWN" });
  });
});
