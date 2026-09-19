import { describe, expect, it } from "vitest";
import request from "supertest";
import { decodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { Container } from "../src/container.js";
import { createApp } from "../src/http/app.js";
import { investigateFirstSignal, testBuyer, testContainer, TEST_PAY_TO } from "./helpers.js";

async function shop(env: Record<string, string> = {}) {
  const c = await testContainer(env);
  const { view } = await investigateFirstSignal(c);
  const briefId = view.briefId!;
  const app = createApp(c);
  return { c, app, briefId, path: `/api/v1/briefs/${briefId}` };
}

/** fetch the challenge and sign it with the OKX client SDK, exactly as an agent buyer would */
async function signChallenge(app: ReturnType<typeof createApp>, path: string) {
  const buyer = testBuyer();
  const challenge = await request(app).get(path);
  expect(challenge.status).toBe(402);
  const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
  const payload = await buyer.http.createPaymentPayload(required);
  return { buyer, challenge, required, headers: buyer.http.encodePaymentSignatureHeader(payload) };
}

const states = (c: Container, orderId: string) => c.ledger.get(orderId)!.events.map((e) => e.to);

describe("paid delivery over x402", () => {
  it("answers an unpaid request with a v2 challenge the OKX client SDK can parse", async () => {
    const { app, path, briefId } = await shop();
    const { challenge, required } = await signChallenge(app, path);
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:1952", payTo: TEST_PAY_TO, amount: "1000000" });
    expect(challenge.body.bullseye).toMatchObject({ priceUsd: "1.00", rail: "FIXTURE" });
    expect(challenge.body.brief).toBeUndefined();
    expect(JSON.stringify(challenge.body)).not.toContain("whatHappened");
    expect(required.resource.url).toContain(briefId);
  });

  it("delivers the Brief once payment settles and walks every state in order", async () => {
    const { c, app, path, briefId } = await shop();
    const { headers, buyer } = await signChallenge(app, path);
    const paid = await request(app).get(path).set(headers);
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ schema: "bullseye.delivery/v1", state: "DELIVERED", brief: { id: briefId }, payment: { rail: "FIXTURE", payer: buyer.account.address, chainVerified: false } });
    expect(decodePaymentResponseHeader(paid.headers["payment-response"]!).success).toBe(true);
    expect(states(c, paid.body.orderId)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAID", "DELIVERING", "DELIVERED"]);
  });

  it("serves a replayed authorization from the ledger without settling twice", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    const first = await request(app).get(path).set(headers);
    const claim = first.headers["x-bullseye-claim"]!;
    expect(claim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(first.body)).not.toContain(claim);
    const second = await request(app).get(path).set(headers).set("x-bullseye-claim", claim);
    expect(second.status).toBe(200);
    expect(second.body.orderId).toBe(first.body.orderId);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
    expect(c.ledger.list()).toHaveLength(1);
    expect(c.ledger.get(first.body.orderId)!.deliveryCount).toBe(2);
  });

  it("settles once when the same authorization arrives concurrently", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    const replies = await Promise.all([1, 2, 3, 4].map(() => request(app).get(path).set(headers)));
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
    expect(c.ledger.list()).toHaveLength(1);
    // the duplicates are told "in progress" while the first settles, and need its claim token once it has been delivered
    expect(replies.map((r) => r.status).every((s) => s === 200 || s === 409 || s === 403)).toBe(true);
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.headers["x-bullseye-claim"])).toHaveLength(1);
  });

  it("treats a settle timeout as unknown: no delivery, no second charge, then reconciles to PAID", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    c.fixtureFacilitator!.mode = "settle_timeout";
    const unknown = await request(app).get(path).set(headers);
    expect(unknown.status).toBe(503);
    expect(unknown.body).toMatchObject({ error: "payment_outcome_unknown", state: "PAYMENT_UNKNOWN" });
    expect(unknown.body.brief).toBeUndefined();

    // retry while the chain still cannot be read: still unknown, still exactly one settle call
    c.fixtureFacilitator!.mode = "ok";
    const retry = await request(app).get(path).set(headers);
    expect(retry.status).toBe(503);
    expect(retry.body.state).toBe("RECONCILIATION_REQUIRED");
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);

    // reconciliation evidence arrives: the authorization was consumed on-chain
    c.fixtureFacilitator!.reconcileOutcome = "used";
    const delivered = await request(app).get(path).set(headers);
    expect(delivered.status).toBe(200);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
    expect(states(c, unknown.body.orderId)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED", "PAID", "DELIVERING", "DELIVERED"]);
  });

  it("treats a dropped settle connection as unknown, not as failure", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    c.fixtureFacilitator!.mode = "settle_throws";
    const r = await request(app).get(path).set(headers);
    expect(r.status).toBe(503);
    expect(c.ledger.get(r.body.orderId)!.state).toBe("PAYMENT_UNKNOWN");
  });

  it("marks an explicit settlement failure as PAYMENT_FAILED and never delivers", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    c.fixtureFacilitator!.mode = "settle_failed";
    const r = await request(app).get(path).set(headers);
    expect(r.status).toBe(402);
    expect(r.body.order.state).toBe("PAYMENT_FAILED");
    expect(r.body.brief).toBeUndefined();
    const again = await request(app).get(path).set(headers);
    expect(again.status).toBe(402);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("rejects an invalid signature before settlement", async () => {
    const { c, app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    c.fixtureFacilitator!.mode = "verify_invalid";
    const r = await request(app).get(path).set(headers);
    expect(r.status).toBe(402);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(0);
    expect(c.ledger.list()[0]!.state).toBe("PAYMENT_FAILED");
  });

  it("keeps quote terms immutable after the buyer has approved them", async () => {
    const { c, app, path, briefId } = await shop();
    const quote = (await request(app).post(`/api/briefs/${briefId}/quotes`)).body;
    expect(() => c.db.prepare("UPDATE quotes SET terms_json = ? WHERE id = ?").run("{}", quote.id)).toThrow(/immutable/);
    expect(() => c.db.prepare("DELETE FROM quotes WHERE id = ?").run(quote.id)).toThrow(/immutable/);

    const { headers } = await signChallenge(app, `${path}?quote=${quote.id}`);
    const paid = await request(app).get(`${path}?quote=${quote.id}`).set(headers);
    expect(paid.status).toBe(200);
    expect(paid.body.quote).toMatchObject({ id: quote.id, termsHash: quote.termsHash });
    expect(() => c.db.prepare("UPDATE orders SET terms_hash = 'x' WHERE id = ?").run(paid.body.orderId)).toThrow(/frozen/);
    expect(() => c.db.prepare("UPDATE order_events SET reason = 'x' WHERE order_id = ?").run(paid.body.orderId)).toThrow(/append-only/);
  });

  it("does not issue a challenge when the rail cannot settle", async () => {
    const c = await testContainer({ PAYMENT_RAIL: "okx-testnet" });
    const { view } = await investigateFirstSignal(c);
    const r = await request(createApp(c)).get(`/api/v1/briefs/${view.briefId}`);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: "payment_rail_unavailable", rail: "OKX_X402_TESTNET" });
    expect(r.headers["payment-required"]).toBeUndefined();
  });

  it("reports delivery economics with measured and estimated figures apart, and never calls a fixture payment revenue", async () => {
    const { app, path } = await shop();
    const { headers } = await signChallenge(app, path);
    const paid = await request(app).get(path).set(headers);
    const { receipt } = (await request(app).get(`/api/orders/${paid.body.orderId}`)).body;
    expect(receipt).toMatchObject({ priceUsd: 1, countsAsRevenue: false, rail: "FIXTURE", usage: { usageIsFixture: true } });
    expect(receipt.measuredCosts).toEqual([]);
    expect(receipt.estimatedCosts.every((l: { basis: string }) => l.basis === "ESTIMATED")).toBe(true);
    expect(receipt.estimatedContributionUsd).toBeCloseTo(1 - receipt.estimatedTotalUsd, 6);
  });
});
