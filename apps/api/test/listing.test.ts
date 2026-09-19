import { describe, expect, it } from "vitest";
import request from "supertest";
import { canonicalJson, type Brief } from "@bullseye/domain";
import { decodePaymentRequiredHeader } from "@okxweb3/x402-core/http";
import type { Container } from "../src/container.js";
import { createApp } from "../src/http/app.js";
import { sha256 } from "../src/adapters/transport.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

const LATEST = "/api/v1/briefs/latest";

async function shop() {
  const c = await testContainer();
  const { view } = await investigateFirstSignal(c);
  return { c, app: createApp(c), briefId: view.briefId! };
}

/** a second, newer Brief for the same asset, stored the way the investigator stores one */
function publishNewer(c: Container, from: Brief): Brief {
  const { contentHash: _old, ...body } = from;
  const next = { ...body, id: "brf_00000000000000ff", publishedAt: new Date(Date.parse(from.publishedAt) + 60_000).toISOString() };
  const brief: Brief = { ...next, contentHash: sha256(canonicalJson(next)) };
  c.db.prepare("INSERT INTO briefs (id, investigation_id, signal_id, json, content_hash, published_at) VALUES (?, ?, ?, ?, ?, ?)").run(brief.id, "inv_test", brief.signal.id, JSON.stringify(brief), brief.contentHash, brief.publishedAt);
  return brief;
}

async function sign(app: ReturnType<typeof createApp>, path: string, method: "get" | "post" = "get") {
  const buyer = testBuyer();
  const challenge = await request(app)[method](path);
  expect(challenge.status).toBe(402);
  const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
  const payload = await buyer.http.createPaymentPayload(required);
  return { challenge, required, headers: buyer.http.encodePaymentSignatureHeader(payload) };
}

describe("a listable paid endpoint", () => {
  it("answers POST with the same v2 challenge as GET", async () => {
    const { app, briefId } = await shop();
    const path = `/api/v1/briefs/${briefId}`;
    const viaPost = await request(app).post(path);
    const viaGet = await request(app).get(path);
    expect(viaPost.status).toBe(402);
    const required = decodePaymentRequiredHeader(viaPost.headers["payment-required"]!);
    expect(required).toMatchObject({ x402Version: 2, resource: { url: `http://localhost:4402${path}`, mimeType: "application/json" } });
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", maxTimeoutSeconds: 300 });
    // one open quote per address: the second request reuses it rather than minting another
    expect(viaGet.body.bullseye.quoteId).toBe(viaPost.body.bullseye.quoteId);
  });

  it("settles and delivers a payment sent with POST", async () => {
    const { c, app, briefId } = await shop();
    const path = `/api/v1/briefs/${briefId}`;
    const { headers } = await sign(app, path, "post");
    const paid = await request(app).post(path).set(headers);
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ schema: "bullseye.delivery/v1", state: "DELIVERED", brief: { id: briefId } });
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("refuses other methods on the paid resource", async () => {
    const { app, briefId } = await shop();
    expect((await request(app).put(`/api/v1/briefs/${briefId}`)).status).toBe(405);
    expect((await request(app).delete(LATEST)).status).toBe(405);
  });

  it("quotes the stable address as the resource, and keeps it apart from the Brief's own address", async () => {
    const { app, briefId } = await shop();
    const stable = await request(app).post(LATEST);
    expect(stable.status).toBe(402);
    const required = decodePaymentRequiredHeader(stable.headers["payment-required"]!);
    expect(required.resource.url).toBe(`http://localhost:4402${LATEST}`);
    expect(required.resource.description).toContain(briefId);
    const direct = await request(app).get(`/api/v1/briefs/${briefId}`);
    expect(decodePaymentRequiredHeader(direct.headers["payment-required"]!).resource.url).toBe(`http://localhost:4402/api/v1/briefs/${briefId}`);
    expect(direct.body.bullseye.quoteId).not.toBe(stable.body.bullseye.quoteId);
  });

  it("filters the stable address by symbol from the query or a POST body", async () => {
    const { c, app, briefId } = await shop();
    const symbol = c.briefs.get(briefId)!.signal.asset.symbol;
    const byQuery = await request(app).get(`${LATEST}?symbol=${symbol.toLowerCase()}`);
    expect(byQuery.status).toBe(402);
    expect(decodePaymentRequiredHeader(byQuery.headers["payment-required"]!).resource.url).toBe(`http://localhost:4402${LATEST}?symbol=${symbol.toLowerCase()}`);
    const byBody = await request(app).post(LATEST).send({ symbol });
    expect(byBody.status).toBe(402);
    const none = await request(app).post(LATEST).send({ symbol: "NOPEx" });
    expect(none.status).toBe(404);
    expect(none.body).toMatchObject({ error: "nothing_for_sale" });
    expect(none.headers["payment-required"]).toBeUndefined();
  });

  it("says nothing is for sale, without a challenge, before any Brief exists", async () => {
    const c = await testContainer();
    const res = await request(createApp(c)).post(LATEST);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("nothing_for_sale");
    expect(res.headers["payment-required"]).toBeUndefined();
    expect(c.ledger.list()).toHaveLength(0);
  });

  it("delivers the Brief that was quoted when a newer one is published before the buyer pays", async () => {
    const { c, app, briefId } = await shop();
    const { headers } = await sign(app, LATEST, "post");
    const newer = publishNewer(c, c.briefs.get(briefId)!);
    // the address now points at the newer Brief for anyone who has not been quoted yet
    const fresh = await request(app).post(LATEST);
    expect(decodePaymentRequiredHeader(fresh.headers["payment-required"]!).resource.description).toContain(newer.id);

    const paid = await request(app).post(LATEST).set(headers);
    expect(paid.status).toBe(200);
    expect(paid.body.brief.id).toBe(briefId);
    expect(paid.body.quote.terms).toMatchObject({ briefId, resource: `http://localhost:4402${LATEST}` });
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);

    // the same authorization replayed is answered from its order, still for the Brief that was bought
    const again = await request(app).post(LATEST).set(headers);
    expect(again.body).toMatchObject({ orderId: paid.body.orderId, brief: { id: briefId } });
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(1);
  });

  it("does not offer a withdrawn Brief at the stable address", async () => {
    const { c, app, briefId } = await shop();
    const brief = c.briefs.get(briefId)!;
    c.db.prepare("UPDATE signals SET superseded_json = ? WHERE id = ?").run(JSON.stringify({ byVersion: 2, reason: "CANCELLED", status: "Cancelled", notes: "[CANCELLED v1] test", notedAt: new Date().toISOString() }), brief.signal.id);
    const res = await request(app).post(LATEST);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("nothing_for_sale");
  });

  it("advertises the stable address in the catalogue", async () => {
    const { app } = await shop();
    const catalog = await request(app).get("/api/v1/catalog");
    expect(catalog.body.latest).toMatchObject({ resource: `http://localhost:4402${LATEST}`, methods: ["GET", "POST"] });
  });
});
