import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

/** second well-known Hardhat development key; holds nothing on any real network */
const OTHER_BUYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const PUBLIC = { PUBLIC_BASE_URL: "https://bullseye.example.com" };
const TOKEN = "an-operator-token-of-sufficient-length";

async function shop(env: Record<string, string> = {}) {
  const c = await testContainer(env);
  const { view } = await investigateFirstSignal(c);
  const app = createApp(c);
  const path = `/api/v1/briefs/${view.briefId}`;
  const sign = async (buyer = testBuyer()) => {
    const challenge = await request(app).get(path);
    const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
    return buyer.http.encodePaymentSignatureHeader(await buyer.http.createPaymentPayload(required));
  };
  return { c, app, path, briefId: view.briefId!, sign };
}

const quotes = (c: Awaited<ReturnType<typeof testContainer>>) => (c.db.prepare("SELECT COUNT(*) AS n FROM quotes").get() as { n: number }).n;

describe("the list of every buyer's order", () => {
  it("is closed on a public deployment, and open to the operator's token only", async () => {
    const closed = await shop(PUBLIC);
    await request(closed.app).get(closed.path).set(await closed.sign());
    const refused = await request(closed.app).get("/api/orders");
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("ord_");

    const guarded = await shop({ ...PUBLIC, OPERATOR_TOKEN: TOKEN });
    await request(guarded.app).get(guarded.path).set(await guarded.sign());
    expect((await request(guarded.app).get("/api/orders")).status).toBe(401);
    const listed = await request(guarded.app).get("/api/orders").set("authorization", `Bearer ${TOKEN}`);
    expect(listed.status).toBe(200);
    expect(listed.body.orders).toHaveLength(1);
  });

  it("stays open on localhost without a token, so the development desk and its tests still work", async () => {
    const { app, path, sign } = await shop();
    await request(app).get(path).set(await sign());
    expect((await request(app).get("/api/orders")).body.orders).toHaveLength(1);
  });
});

describe("one order, one buyer", () => {
  it("keeps two buyers of the same Brief apart: each reads, and collects, only their own order", async () => {
    const { c, app, path, sign } = await shop(PUBLIC);
    const claimA = "a".repeat(43);
    const claimB = "b".repeat(43);
    const a = await request(app).get(path).set(await sign(testBuyer())).set("x-bullseye-claim", claimA);
    const b = await request(app).get(path).set(await sign(testBuyer(OTHER_BUYER_KEY))).set("x-bullseye-claim", claimB);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.orderId).not.toBe(b.body.orderId);
    expect(a.body.payment.payer.toLowerCase()).not.toBe(b.body.payment.payer.toLowerCase());

    const ownA = await request(app).get(`/api/orders/${a.body.orderId}`).set("x-bullseye-claim", claimA);
    expect(ownA.status).toBe(200);
    expect(ownA.body.order.id).toBe(a.body.orderId);
    expect(ownA.body.order.paymentKey).toBeNull();

    // A's token opens nothing of B's, and no token opens nothing at all
    for (const route of [`/api/orders/${b.body.orderId}`, `/api/orders/${b.body.orderId}/delivery`]) {
      for (const claim of [claimA, undefined]) {
        const req = request(app).get(route);
        const res = await (claim ? req.set("x-bullseye-claim", claim) : req);
        expect(res.status, `${route} ${claim ?? "no token"}`).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain("whatHappened");
        expect(JSON.stringify(res.body)).not.toContain(b.body.payment.payer);
      }
    }
    expect((await request(app).post(`/api/orders/${b.body.orderId}/reconcile`).set("x-bullseye-claim", claimA)).status).toBe(403);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(2);
  });

  it("answers an order that does not exist exactly as it answers a wrong token", async () => {
    const { app, path, sign } = await shop(PUBLIC);
    const real = await request(app).get(path).set(await sign()).set("x-bullseye-claim", "c".repeat(43));
    const wrong = await request(app).get(`/api/orders/${real.body.orderId}`).set("x-bullseye-claim", "d".repeat(43));
    const absent = await request(app).get("/api/orders/ord_0000000000000000").set("x-bullseye-claim", "d".repeat(43));
    expect([wrong.status, absent.status]).toEqual([403, 403]);
    expect(absent.body).toEqual(wrong.body);
    const wrongDelivery = await request(app).get(`/api/orders/${real.body.orderId}/delivery`).set("x-bullseye-claim", "d".repeat(43));
    const absentDelivery = await request(app).get("/api/orders/ord_0000000000000000/delivery").set("x-bullseye-claim", "d".repeat(43));
    expect(absentDelivery.body).toEqual(wrongDelivery.body);
  });

  it("never takes the token from the URL", async () => {
    const { app, path, sign } = await shop(PUBLIC);
    const claim = "e".repeat(43);
    const paid = await request(app).get(path).set(await sign()).set("x-bullseye-claim", claim);
    expect((await request(app).get(`/api/orders/${paid.body.orderId}?claim=${claim}&x-bullseye-claim=${claim}`)).status).toBe(403);
  });
});

describe("recovering a purchase with the claim token alone", () => {
  it("collects a delivered Brief again without the signed authorization, and without settling or quoting", async () => {
    const { c, app, path, sign } = await shop(PUBLIC);
    const claim = "f".repeat(43);
    const paid = await request(app).get(path).set(await sign()).set("x-bullseye-claim", claim);
    expect(paid.status).toBe(200);
    const quotesBefore = quotes(c);

    const again = await request(app).get(`/api/orders/${paid.body.orderId}/delivery`).set("x-bullseye-claim", claim);
    expect(again.status).toBe(200);
    expect(again.body.orderId).toBe(paid.body.orderId);
    expect(again.body.brief.contentHash).toBe(paid.body.brief.contentHash);
    expect(again.headers["payment-response"]).toBeUndefined();
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
    expect(quotes(c)).toBe(quotesBefore);
    expect(c.ledger.get(paid.body.orderId)!.deliveryCount).toBe(2);
  });

  it("works with the token the server handed out when the buyer chose none", async () => {
    const { c, app, path, sign } = await shop(PUBLIC);
    const paid = await request(app).get(path).set(await sign());
    const issued = paid.headers["x-bullseye-claim"]!;
    expect(issued).toBeTruthy();
    expect((await request(app).get(`/api/orders/${paid.body.orderId}/delivery`).set("x-bullseye-claim", issued)).status).toBe(200);
    expect((await request(app).get(`/api/orders/${paid.body.orderId}`).set("x-bullseye-claim", issued)).body.order.state).toBe("DELIVERED");
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("lets the buyer reconcile an unknown payment themselves; it stays unknown until the chain answers, and is never settled again", async () => {
    const { c, app, path, sign } = await shop(PUBLIC);
    const claim = "g".repeat(43);
    c.fixtureFacilitator!.mode = "settle_timeout";
    const unknown = await request(app).get(path).set(await sign()).set("x-bullseye-claim", claim);
    expect(unknown.status).toBe(503);
    const orderId = unknown.body.orderId as string;

    // the operator's route is closed here; the buyer's token is what opens this order
    expect((await request(app).post(`/api/orders/${orderId}/reconcile`)).status).toBe(403);
    const still = await request(app).post(`/api/orders/${orderId}/reconcile`).set("x-bullseye-claim", claim);
    expect(still.status).toBe(200);
    expect(["PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED"]).toContain(still.body.order.state);
    const early = await request(app).get(`/api/orders/${orderId}/delivery`).set("x-bullseye-claim", claim);
    expect(early.status).toBe(503);
    expect(early.body.brief).toBeUndefined();

    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "used";
    const settled = await request(app).post(`/api/orders/${orderId}/reconcile`).set("x-bullseye-claim", claim);
    expect(settled.body.order.state).toBe("PAID");
    const collected = await request(app).get(`/api/orders/${orderId}/delivery`).set("x-bullseye-claim", claim);
    expect(collected.status).toBe(200);
    expect(collected.body.state).toBe("DELIVERED");
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
    expect(c.ledger.list()).toHaveLength(1);
  });

  it("answers a failed payment with its state, not with a fresh challenge to sign", async () => {
    const { c, app, path, sign } = await shop(PUBLIC);
    const claim = "h".repeat(43);
    c.fixtureFacilitator!.mode = "settle_failed";
    const failed = await request(app).get(path).set(await sign()).set("x-bullseye-claim", claim);
    const orderId = c.ledger.list()[0]!.id;
    expect(failed.status).toBe(402);
    const quotesBefore = quotes(c);
    const res = await request(app).get(`/api/orders/${orderId}/delivery`).set("x-bullseye-claim", claim);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "payment_failed", state: "PAYMENT_FAILED" });
    expect(res.headers["payment-required"]).toBeUndefined();
    expect(quotes(c)).toBe(quotesBefore);
  });

  it("still delivers to an earlier buyer after the Brief has been withdrawn from sale", async () => {
    const { c, app, path, sign } = await shop();
    const claim = "i".repeat(43);
    const paid = await request(app).get(path).set(await sign()).set("x-bullseye-claim", claim);
    const hist = (c.fixtureTransport as unknown as { responses: Record<string, { nodes: Record<string, unknown>[] }> }).responses["xstocks.ca-history.all"]!;
    const v1 = hist.nodes[0]!;
    hist.nodes.unshift({ ...v1, version: 2, status: "Cancelled", effectiveTimeUtc: null, multiplierNew: v1.multiplierOld, notes: "[CANCELLED v1] Incorrect cash flow", createdTimeUtc: "2026-01-15T08:30:00.000Z" });
    await c.signals.scan();
    expect((await request(app).get(path)).status).toBe(410);
    expect((await request(app).get(`/api/orders/${paid.body.orderId}/delivery`).set("x-bullseye-claim", claim)).status).toBe(200);
  });
});

describe("what anyone may know about sales", () => {
  it("is counts by state and Brief, labelled, with no order, quote, payer or transaction in it", async () => {
    const { c, app, path, briefId, sign } = await shop(PUBLIC);
    const paid = await request(app).get(path).set(await sign()).set("x-bullseye-claim", "j".repeat(43));
    c.fixtureFacilitator!.mode = "settle_timeout";
    await request(app).get(path).set(await sign(testBuyer(OTHER_BUYER_KEY)));

    const res = await request(app).get("/api/commerce/summary");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: "AGGREGATE", countsAsRevenue: false, totals: { orders: 2, delivered: 1, byState: { DELIVERED: 1, PAYMENT_UNKNOWN: 1 } } });
    expect(res.body.note).toMatch(/not revenue/i);
    expect(res.body.byBrief).toEqual([expect.objectContaining({ briefId, orders: 2, delivered: 1 })]);

    const text = JSON.stringify(res.body).toLowerCase();
    const order = c.ledger.get(paid.body.orderId)!;
    for (const secret of [order.id, order.quoteId, order.payment!.payer!, order.payment!.txHash ?? "0xnone", order.termsHash]) expect(text).not.toContain(secret.toLowerCase());
    expect(text).not.toMatch(/ord_|quo_|0x[0-9a-f]{40}/);
  });
});
