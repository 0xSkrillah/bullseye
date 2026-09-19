import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { AutoDesk } from "../src/desk/autoDesk.js";
import { ACTIVITY_KINDS } from "../src/http/activity.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

async function shop() {
  const c = await testContainer();
  const { view, signal } = await investigateFirstSignal(c);
  return { c, app: createApp(c), view, signal, briefId: view.briefId! };
}

async function buy(app: ReturnType<typeof createApp>, path: string) {
  const buyer = testBuyer();
  const challenge = await request(app).get(path);
  const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
  const payload = await buyer.http.createPaymentPayload(required);
  return request(app).get(path).set(buyer.http.encodePaymentSignatureHeader(payload));
}

/** sentences only the paid Brief contains: every claim, unknown and limitation the writer produced */
function paidText(c: Awaited<ReturnType<typeof testContainer>>, briefId: string): string[] {
  const d = c.briefs.get(briefId)!.draft;
  return [...d.whatHappened, ...d.whyItMayMatter, ...d.onchainObservations].map((cl) => cl.text).concat(d.unknowns, d.limitations, [d.confidence.rationale]);
}

describe("GET /api/investigations", () => {
  it("lists runs newest first with times, the gate's verdict, drafts judged and usage, and no timeline", async () => {
    const { app, view, signal } = await shop();
    const res = await request(app).get("/api/investigations");
    expect(res.status).toBe(200);
    expect(res.body.investigations).toHaveLength(1);
    const row = res.body.investigations[0];
    expect(row).toMatchObject({ id: view.id, signalId: signal.id, symbol: signal.asset.symbol, status: "PUBLISHED", stopReason: "COMPLETED", briefId: view.briefId, gate: { decision: "PUBLISH" }, draftsJudged: 1 });
    expect(Date.parse(row.startedAt)).toBeLessThanOrEqual(Date.parse(row.finishedAt));
    expect(row.usage).toMatchObject({ toolCalls: expect.any(Number), modelCalls: expect.any(Number) });
    expect(row.timeline).toBeUndefined();
    expect(row.gate.findings).toBeUndefined();
  });

  it("counts a rejected first draft and its revision", async () => {
    const c = await testContainer();
    c.setFixtureBehaviour("unevidenced_number");
    const { view } = await investigateFirstSignal(c);
    const row = (await request(createApp(c)).get("/api/investigations")).body.investigations[0];
    expect(row).toMatchObject({ id: view.id, status: "REJECTED", gate: { decision: "REJECT" } });
    expect(row.draftsJudged).toBe(2);
  });
});

describe("GET /api/investigations/:id", () => {
  it("keeps every gate attempt, oldest first, and the ceilings the run was started with", async () => {
    const c = await testContainer({ BUDGET_MAX_TOOL_CALLS: "13" });
    c.setFixtureBehaviour("unevidenced_number");
    const { view } = await investigateFirstSignal(c);
    // the configuration changes afterwards; the run still reports what it was held to
    const later = createApp({ ...c, config: { ...c.config, budget: { ...c.config.budget, maxToolCalls: 99 } } });
    const body = (await request(later).get(`/api/investigations/${view.id}`)).body;
    expect(body.budget.maxToolCalls).toBe(99);
    expect(body.investigation.budgetAtStart.maxToolCalls).toBe(13);
    expect(body.investigation.gateAttempts).toHaveLength(2);
    expect(body.investigation.gateAttempts.map((g: { decision: string }) => g.decision)).toEqual(["REJECT", "REJECT"]);
    expect(body.investigation.gateAttempts[1]).toEqual(body.investigation.gate);
  });

  it("reports attempts as not recorded, rather than guessing, for a run stored before they were kept", async () => {
    const { c, app, view } = await shop();
    c.db.prepare("UPDATE investigations SET gate_attempts_json = NULL, budget_json = '{}' WHERE id = ?").run(view.id);
    const body = (await request(app).get(`/api/investigations/${view.id}`)).body;
    expect(body.investigation.gateAttempts).toBeNull();
    expect(body.investigation.budgetAtStart).toBeNull();
    expect(body.investigation.gate.decision).toBe("PUBLISH");
  });
});

describe("GET /api/investigations/:id/chain", () => {
  it("returns the reads and the activation block as numbers taken from stored evidence", async () => {
    const { c, app, view, signal } = await shop();
    const res = await request(app).get(`/api/investigations/${view.id}/chain`);
    expect(res.status).toBe(200);
    const chain = res.body.chain;
    expect(chain).toMatchObject({ network: "eip155:196", token: signal.asset.tokenAddress, symbol: signal.asset.symbol, activationSearched: true });
    expect(chain.issuer).toEqual({ multiplierOld: signal.facts.multiplierOld, multiplierNew: signal.facts.multiplierNew, effectiveTimeUtc: signal.observedAt });
    expect(chain.reads.map((r: { key: string }) => r.key)).toEqual(["BEFORE", "AFTER", "HEAD"]);
    const evidence = new Map(c.investigations.evidence(view.id).map((e) => [e.id, e]));
    for (const read of chain.reads) {
      const e = evidence.get(read.evidenceId)!;
      expect(read).toMatchObject({ blockNumber: e.values.blockNumber, multiplier: e.values.multiplierExact, blockTime: e.values.blockTimestamp, mode: e.provenance.mode });
      expect(typeof read.multiplier).toBe("string");
    }
    expect(chain.activation.blockNumber).toBe(evidence.get("EV-CHAIN-ACTIVATION")!.values.activationBlock);
  });

  it("is null before any read exists and 404 for an unknown run", async () => {
    const { c, app, view } = await shop();
    c.db.prepare("DELETE FROM evidence WHERE investigation_id = ?").run(view.id);
    expect((await request(app).get(`/api/investigations/${view.id}/chain`)).body).toEqual({ audience: "DIAGNOSTIC", chain: null });
    expect((await request(app).get("/api/investigations/inv_0000000000000000/chain")).status).toBe(404);
  });
});

describe("GET /api/desk/status", () => {
  it("says the loop is off, and still states the live window and the day's count", async () => {
    const { app } = await shop();
    const body = (await request(app).get("/api/desk/status")).body;
    expect(body).toMatchObject({ enabled: false, lastTick: null, nextTickAt: null, investigationsLast24h: 1, intervalMinutes: 30, maxInvestigationsPerDay: 3 });
    expect(body.liveWindowHours).toBeGreaterThan(0);
    expect(body.dailySpendCeilingUsd).toBeCloseTo(3 * 0.4);
  });

  it("reports the last tick and the next one when the loop runs", async () => {
    const c = await testContainer();
    const desk = new AutoDesk(c, { intervalMinutes: 30, maxInvestigationsPerDay: 3 });
    c.autoDesk = desk;
    const first = await desk.tick();
    if (first.action !== "STARTED") throw new Error("expected a start");
    await c.investigations.wait(first.investigationId);
    const started = (await request(createApp(c)).get("/api/desk/status")).body;
    expect(started).toMatchObject({ enabled: true, lastTick: { action: "STARTED", reason: null, detail: first.signalId } });
    expect(Date.parse(started.lastTick.at)).not.toBeNaN();

    await desk.tick();
    const idle = (await request(createApp(c)).get("/api/desk/status")).body;
    expect(idle.lastTick).toMatchObject({ action: "IDLE", reason: "NOTHING_NEW" });

    desk.start();
    const running = (await request(createApp(c)).get("/api/desk/status")).body;
    expect(Date.parse(running.nextTickAt)).toBeGreaterThan(Date.now());
    desk.stop();
    expect((await request(createApp(c)).get("/api/desk/status")).body.nextTickAt).toBeNull();
  });
});

describe("GET /api/activity", () => {
  it("merges real events newest first, names its kinds, and labels payment events with their rail", async () => {
    const { app, view, signal, briefId } = await shop();
    const paid = await buy(app, `/api/v1/briefs/${briefId}`);
    expect(paid.status).toBe(200);

    const body = (await request(app).get("/api/activity?limit=200")).body;
    expect(body.kinds).toEqual([...ACTIVITY_KINDS]);
    const events = body.events as { at: string; kind: string; refId: string; symbol: string | null; summary: string; rail: string | null; state: string | null }[];
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort().reverse());
    for (const e of events) expect(ACTIVITY_KINDS).toContain(e.kind);

    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ["SIGNAL_DETECTED", "INVESTIGATION_STARTED", "GATE_DECISION", "INVESTIGATION_PUBLISHED", "QUOTE_ISSUED", "ORDER_STATE"]) expect(kinds, k).toContain(k);
    expect(events.find((e) => e.kind === "INVESTIGATION_PUBLISHED")).toMatchObject({ refId: view.id, symbol: signal.asset.symbol });
    expect(events.filter((e) => e.kind === "ORDER_STATE").map((e) => e.state)).toEqual(["DELIVERED", "DELIVERING", "PAID", "PAYMENT_PENDING", "QUOTED"]);
    for (const e of events.filter((e) => e.kind === "ORDER_STATE" || e.kind === "QUOTE_ISSUED")) expect(e).toMatchObject({ rail: "FIXTURE", symbol: signal.asset.symbol });
    for (const e of events.filter((e) => e.kind !== "ORDER_STATE" && e.kind !== "QUOTE_ISSUED")) expect(e.rail).toBeNull();
  });

  it("honours the limit", async () => {
    const { app } = await shop();
    expect((await request(app).get("/api/activity?limit=2")).body.events).toHaveLength(2);
    expect((await request(app).get("/api/activity?limit=0")).body.events.length).toBeGreaterThan(2);
  });

  it("never repeats what a facilitator or an RPC said about a payment", async () => {
    const { c, app, briefId } = await shop();
    c.fixtureFacilitator!.mode = "verify_invalid";
    await buy(app, `/api/v1/briefs/${briefId}`);
    const order = c.ledger.list()[0]!;
    const reason = order.events.at(-1)!.reason;
    expect(reason).toContain("facilitator rejected");
    const text = JSON.stringify((await request(app).get("/api/activity?limit=200")).body);
    expect(text).not.toContain(reason);
    expect(text).toContain("PAYMENT_FAILED");
  });
});

describe("the free routes the room reads", () => {
  it("carry none of the paid Brief's sentences", async () => {
    const { c, app, view, briefId } = await shop();
    await buy(app, `/api/v1/briefs/${briefId}`);
    const secret = paidText(c, briefId);
    expect(secret.length).toBeGreaterThan(5);
    for (const path of ["/api/investigations", `/api/investigations/${view.id}`, `/api/investigations/${view.id}/chain`, "/api/desk/status", "/api/activity?limit=200", "/api/orders", "/api/signals", "/api/briefs", "/api/v1/catalog"]) {
      const text = JSON.stringify((await request(app).get(path)).body);
      for (const sentence of secret) expect(text.includes(sentence), `${path} leaks: ${sentence.slice(0, 60)}`).toBe(false);
    }
  });
});
