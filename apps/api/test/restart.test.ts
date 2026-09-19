import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { buildContainer } from "../src/container.js";
import { openDb } from "../src/db.js";
import { FixtureTransport } from "../src/adapters/transport.js";
import { buildFixtureResponses, FIXTURE_CLOCK } from "../src/adapters/fixtures.js";
import { investigateFirstSignal, testBuyer, testConfig } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** one server process over a database file; closing the handle and calling this again is a restart */
async function boot(file: string) {
  const db = openDb(file);
  const c = buildContainer(testConfig({ DB_PATH: file, PUBLIC_BASE_URL: "https://bullseye.example.com" }), { db, transport: new FixtureTransport(buildFixtureResponses({}), () => FIXTURE_CLOCK) });
  await c.rail.init();
  return { c, app: createApp(c), stop: () => db.close() };
}

describe("a restart", () => {
  it("keeps the Brief, the quote, the order and the buyer's way back to it; an unknown payment is reconciled afterwards and never settled again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullseye-restart-"));
    dirs.push(dir);
    const file = join(dir, "desk.sqlite");

    const first = await boot(file);
    const { view } = await investigateFirstSignal(first.c);
    const path = `/api/v1/briefs/${view.briefId}`;
    const buyer = testBuyer();
    const challenge = await request(first.app).get(path);
    const quoteId = challenge.body.bullseye.quoteId as string;
    const termsHash = challenge.body.bullseye.termsHash as string;
    const headers = buyer.http.encodePaymentSignatureHeader(await buyer.http.createPaymentPayload(buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()])));

    first.c.fixtureFacilitator!.mode = "settle_timeout";
    const claim = "r".repeat(43);
    const unknown = await request(first.app).get(path).set(headers).set("x-bullseye-claim", claim);
    expect(unknown.status).toBe(503);
    const orderId = unknown.body.orderId as string;
    // a second buyer takes the server's token instead of choosing one; it must be the same token after the restart
    first.c.fixtureFacilitator!.mode = "ok";
    const other = testBuyer("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const otherChallenge = await request(first.app).get(path);
    const delivered = await request(first.app).get(path).set(other.http.encodePaymentSignatureHeader(await other.http.createPaymentPayload(other.http.getPaymentRequiredResponse((name) => otherChallenge.headers[name.toLowerCase()]))));
    expect(delivered.status).toBe(200);
    const issuedToken = delivered.headers["x-bullseye-claim"]!;
    first.stop();

    const second = await boot(file);
    expect(second.c.fixtureFacilitator!.settleCalls).toHaveLength(0);
    expect((await request(second.app).get("/api/briefs")).body.briefs.map((b: { id: string }) => b.id)).toEqual([view.briefId]);
    expect(second.c.ledger.getQuote(quoteId)!.termsHash).toBe(termsHash);

    // the unknown order is still unknown, still the buyer's, and still undelivered
    const own = await request(second.app).get(`/api/orders/${orderId}`).set("x-bullseye-claim", claim);
    expect(own.status).toBe(200);
    expect(own.body.order).toMatchObject({ id: orderId, state: "PAYMENT_UNKNOWN", deliveryCount: 0, termsHash });
    expect((await request(second.app).get(`/api/orders/${orderId}`).set("x-bullseye-claim", "s".repeat(43))).status).toBe(403);

    // the chain now shows the transfer: reconciled from it, delivered, and the new process never calls settle
    second.c.fixtureFacilitator!.reconcileOutcome = "used";
    const collected = await request(second.app).get(`/api/orders/${orderId}/delivery`).set("x-bullseye-claim", claim);
    expect(collected.status).toBe(200);
    expect(collected.body.brief.contentHash).toBe(delivered.body.brief.contentHash);
    expect(second.c.ledger.get(orderId)!.events.map((e) => e.to)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED"]);
    expect(second.c.fixtureFacilitator!.settleCalls).toHaveLength(0);

    // the token the first process handed out still opens its order
    expect((await request(second.app).get(`/api/orders/${delivered.body.orderId}/delivery`).set("x-bullseye-claim", issuedToken)).status).toBe(200);
    // and the authorization that was already settled is recognised, not charged again
    const replay = await request(second.app).get(path).set(headers).set("x-bullseye-claim", claim);
    expect(replay.status).toBe(200);
    expect(second.c.ledger.list()).toHaveLength(2);
    second.stop();
  });
});
