import { describe, expect, it } from "vitest";
import request from "supertest";
import { decodePaymentSignatureHeader } from "@okxweb3/x402-core/http";
import type { Container } from "../src/container.js";
import { createApp } from "../src/http/app.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

async function shop(env: Record<string, string> = {}) {
  const c = await testContainer(env);
  const { view } = await investigateFirstSignal(c);
  const briefId = view.briefId!;
  return { c, app: createApp(c), briefId, path: `/api/v1/briefs/${briefId}` };
}

async function sign(app: ReturnType<typeof createApp>, path: string) {
  const buyer = testBuyer();
  const challenge = await request(app).get(path);
  const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
  const payload = await buyer.http.createPaymentPayload(required);
  return { payload, headers: buyer.http.encodePaymentSignatureHeader(payload) };
}

const encode = (payload: unknown) => ({ "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") });
const orders = (c: Container) => c.ledger.list();

describe("an order is only answered to the buyer who opened it", () => {
  it("does not deliver to a header forged from the public payer and nonce of a settled order", async () => {
    const { c, app, path } = await shop();
    const { payload, headers } = await sign(app, path);
    expect((await request(app).get(path).set(headers)).status).toBe(200);

    const auth = (payload.payload as { authorization: { from: string; nonce: string } }).authorization;
    const forged = encode({ x402Version: 2, accepted: { network: payload.accepted.network, asset: payload.accepted.asset }, payload: { authorization: { from: auth.from, nonce: auth.nonce, validBefore: "0" } } });
    for (const target of [path, "/api/v1/briefs/latest"]) {
      const res = await request(app).get(target).set(forged);
      expect(res.status, target).toBe(402);
      expect(res.body.brief, target).toBeUndefined();
      expect(JSON.stringify(res.body), target).not.toContain("whatHappened");
    }
    expect(orders(c)[0]!.deliveryCount).toBe(1);
  });

  it("does not re-deliver to the exact signed payload either, because a settled signature is public calldata", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    const first = await request(app).get(path).set(headers);
    expect(first.status).toBe(200);

    const replay = await request(app).get(path).set(headers);
    expect(replay.status).toBe(403);
    expect(replay.body).toMatchObject({ error: "claim_token_required" });
    expect(replay.body.brief).toBeUndefined();
    const wrong = await request(app).get(path).set(headers).set("x-bullseye-claim", "A".repeat(32));
    expect(wrong.status).toBe(403);
    expect(orders(c)[0]!.deliveryCount).toBe(1);

    const holder = await request(app).get(path).set(headers).set("x-bullseye-claim", first.headers["x-bullseye-claim"]!);
    expect(holder.status).toBe(200);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("lets a buyer whose outcome is unknown recover with the same payload, and hands them a working claim token", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    c.fixtureFacilitator!.mode = "settle_timeout";
    const unknown = await request(app).get(path).set(headers);
    expect(unknown.status).toBe(503);
    expect(unknown.headers["x-bullseye-claim"]).toBeTruthy();

    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "used";
    // the first response may never have arrived, so the retry carries no token
    const recovered = await request(app).get(path).set(headers);
    expect(recovered.status).toBe(200);
    const again = await request(app).get(path).set(headers).set("x-bullseye-claim", recovered.headers["x-bullseye-claim"]!);
    expect(again.status).toBe(200);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("keeps the honest buyer's token working when someone else recovers the same order with a payload copied from calldata", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    c.fixtureFacilitator!.mode = "settle_timeout";
    const unknown = await request(app).get(path).set(headers);
    const buyersToken = unknown.headers["x-bullseye-claim"]!;

    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "used";
    // the copier gets there first, with the payload and no token
    expect((await request(app).get(path).set(headers)).status).toBe(200);
    // the buyer retries as instructed, with the token from the 503
    const buyer = await request(app).get(path).set(headers).set("x-bullseye-claim", buyersToken);
    expect(buyer.status).toBe(200);
    expect(buyer.body.brief).toBeDefined();
  });

  it("answers a buyer who chose their own token only ever with that token, even before delivery", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    const mine = "b".repeat(40);
    c.fixtureFacilitator!.mode = "settle_timeout";
    const unknown = await request(app).get(path).set(headers).set("x-bullseye-claim", mine);
    expect(unknown.status).toBe(503);
    expect(unknown.headers["x-bullseye-claim"]).toBeUndefined();

    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "used";
    // the payload alone, which a chain watcher could rebuild, gets nothing: not the Brief and not a token
    const copier = await request(app).get(path).set(headers);
    expect(copier.status).toBe(403);
    expect(copier.headers["x-bullseye-claim"]).toBeUndefined();
    expect(c.ledger.get(unknown.body.orderId)!.state).toBe("PAYMENT_UNKNOWN");

    const buyer = await request(app).get(path).set(headers).set("x-bullseye-claim", mine);
    expect(buyer.status).toBe(200);
    expect((await request(app).get(path).set(headers).set("x-bullseye-claim", mine)).status).toBe(200);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("does not count a delivery that was never sent, so a buyer whose first response was lost can still collect", async () => {
    const { c, app, path, briefId } = await shop();
    const { headers } = await sign(app, path);
    // the response is built but the connection is gone before it is written: onSent never runs
    const lost = await c.checkout.handle(briefId, headers["PAYMENT-SIGNATURE"], undefined);
    expect(lost.status).toBe(200);
    expect(c.ledger.list()[0]!.deliveryCount).toBe(0);

    const retry = await request(app).get(path).set(headers);
    expect(retry.status).toBe(200);
    expect(c.ledger.list()[0]!.deliveryCount).toBe(1);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("serves overlapping recoveries of one order from a single reconciliation: no 500, one token", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    c.fixtureFacilitator!.mode = "settle_timeout";
    await request(app).get(path).set(headers);
    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "used";
    const orderId = c.ledger.list()[0]!.id;
    // two reconciliations asked for at once are one reconciliation: neither throws on the other's transition
    const [a, b] = await Promise.all([c.checkout.reconcile(orderId), c.checkout.reconcile(orderId)]);
    expect(a!.state).toBe("PAID");
    expect(b).toBe(a);

    const replies = await Promise.all([1, 2, 3].map(() => request(app).get(path).set(headers)));
    // whoever arrives before the first delivery is counted gets the Brief; the rest need the token. Nobody gets a 500.
    expect(replies.every((r) => r.status === 200 || r.status === 403)).toBe(true);
    const served = replies.filter((r) => r.status === 200);
    expect(served.length).toBeGreaterThan(0);
    expect(new Set(served.map((r) => r.headers["x-bullseye-claim"])).size).toBe(1);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("never publishes the ledger's payment key", async () => {
    const { app, path } = await shop();
    const { headers } = await sign(app, path);
    const paid = await request(app).get(path).set(headers);
    const list = await request(app).get("/api/orders");
    expect(list.body.orders[0].order.paymentKey).toBeNull();
    expect((await request(app).get(`/api/orders/${paid.body.orderId}`)).body.order.paymentKey).toBeNull();
  });
});

describe("a consumed authorization is not proof of payment", () => {
  it("does not mark an order paid, or deliver, when the nonce was consumed without the quoted transfer (cancelAuthorization)", async () => {
    const { c, app, path } = await shop();
    const { headers } = await sign(app, path);
    c.fixtureFacilitator!.mode = "settle_throws";
    const unknown = await request(app).get(path).set(headers);
    expect(unknown.status).toBe(503);

    c.fixtureFacilitator!.mode = "ok";
    c.fixtureFacilitator!.reconcileOutcome = "cancelled";
    const retry = await request(app).get(path).set(headers);
    expect(retry.status).toBe(503);
    expect(retry.body.brief).toBeUndefined();
    const order = c.ledger.get(unknown.body.orderId)!;
    expect(order.state).toBe("RECONCILIATION_REQUIRED");
    expect(order.payment?.chainVerified).toBe(false);
    expect(order.events.at(-1)!.reason).toContain("may have been cancelled");
    expect(order.deliveryCount).toBe(0);
  });
});

describe("an interrupted settlement is not a dead end", () => {
  it("treats a pending order nobody is working on as unknown and reconciles it, without settling again", async () => {
    const { c, app, path, briefId } = await shop();
    const { payload, headers } = await sign(app, path);
    // what a crash between opening the order and recording an outcome leaves behind
    const quote = c.ledger.quotesForBrief(briefId)[0]!;
    const auth = (payload.payload as { authorization: { from: string; nonce: string } }).authorization;
    const { sha256 } = await import("../src/adapters/transport.js");
    const key = sha256(`${payload.accepted.network}:${payload.accepted.asset}:${auth.from}:${auth.nonce}`.toLowerCase());
    const stranded = c.ledger.openOrder(quote, key, decodePaymentSignatureHeader(headers["PAYMENT-SIGNATURE"]!), new Date());
    expect(stranded.state).toBe("PAYMENT_PENDING");

    c.fixtureFacilitator!.reconcileOutcome = "used";
    const res = await request(app).get(path).set(headers);
    expect(res.status).toBe(200);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(0);
    expect(c.ledger.get(stranded.id)!.events.map((e) => e.to)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED"]);
  });
});

describe("payloads that cannot pay the quote cost nothing", () => {
  it("opens no order and makes no facilitator call for a payload without a signature, for the wrong amount, or already expired", async () => {
    const { c, app, path } = await shop();
    const { payload } = await sign(app, path);
    const inner = payload.payload as { signature: string; authorization: Record<string, string> };
    const variants = [
      { ...payload, payload: { authorization: inner.authorization } },
      { ...payload, payload: { ...inner, authorization: { ...inner.authorization, value: "1" } } },
      { ...payload, payload: { ...inner, authorization: { ...inner.authorization, to: "0x000000000000000000000000000000000000dEaD" } } },
      { ...payload, payload: { ...inner, authorization: { ...inner.authorization, validBefore: "1" } } },
      { ...payload, payload: { ...inner, authorization: { ...inner.authorization, nonce: "0x1234" } } },
    ];
    for (const v of variants) {
      const res = await request(app).get(path).set(encode(v));
      expect(res.status).toBe(402);
      expect(res.body.error).toContain("payment rejected before verification");
    }
    expect(orders(c)).toHaveLength(0);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(0);
  });

  it("limits how often one client may present a payment, separately from how often it may ask for a challenge", async () => {
    const { app, path } = await shop({ PAYMENT_ATTEMPT_RATE_LIMIT_PER_MINUTE: "2" });
    const { payload } = await sign(app, path);
    const bad = encode({ ...payload, payload: { authorization: (payload.payload as { authorization: unknown }).authorization } });
    expect((await request(app).get(path).set(bad)).status).toBe(402);
    expect((await request(app).get(path).set(bad)).status).toBe(402);
    const blocked = await request(app).get(path).set(bad);
    expect(blocked.status).toBe(429);
    expect(blocked.body.limit).toBe("payment_attempts");
    expect((await request(app).get(path)).status).toBe(402);
  });
});

describe("hostile input on the paid routes", () => {
  it("answers a header that decodes to null, a string or an array with a challenge, not a 500", async () => {
    const { app, path } = await shop();
    for (const raw of ["null", '"x"', "[]", "7"]) {
      for (const target of [path, "/api/v1/briefs/latest"]) {
        const res = await request(app).get(target).set("PAYMENT-SIGNATURE", Buffer.from(raw).toString("base64"));
        expect(res.status, `${raw} at ${target}`).toBe(402);
      }
    }
  });

  it("treats an empty symbol filter as no filter", async () => {
    const { app } = await shop();
    expect((await request(app).get("/api/v1/briefs/latest?symbol=")).status).toBe(402);
    expect((await request(app).post("/api/v1/briefs/latest").send({ symbol: "  " })).status).toBe(402);
  });

  it("answers a body that is not JSON with 400 and counts it against the rate limit", async () => {
    const { app } = await shop({ API_RATE_LIMIT_PER_MINUTE: "2" });
    const bad = () => request(app).post("/api/v1/briefs/latest").set("content-type", "application/json").send("{not json");
    expect((await bad()).status).toBe(400);
    expect((await bad()).body).toEqual({ error: "invalid_request" });
    expect((await bad()).status).toBe(429);
  });

  it("grants a cross-origin preflight the headers an x402 client asks for", async () => {
    const { app, path } = await shop();
    const res = await request(app).options(path).set("origin", "https://buyer.example").set("access-control-request-method", "GET").set("access-control-request-headers", "payment-signature,access-control-expose-headers");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("access-control-expose-headers");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Bullseye-Claim");
  });
});

describe("operator routes in a production build", () => {
  it("are not opened by a PUBLIC_BASE_URL left at localhost", async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const c = await testContainer();
      const app = createApp(c);
      expect((await request(app).post("/api/signals/scan")).status).toBe(403);
      expect((await request(app).get("/api/health")).body.operatorRoutes).toBe("DISABLED");
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
