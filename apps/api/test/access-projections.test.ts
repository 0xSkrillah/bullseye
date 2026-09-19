import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Order, UsageRecord } from "@bullseye/domain";
import { createApp } from "../src/http/app.js";
import { deskEconomics, type RunCost } from "../src/economics/deskEconomics.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

const PUBLIC = { PUBLIC_BASE_URL: "https://bullseye.example.com" };
const VIEWER = "a-viewer-token-of-sufficient-length";
const OPERATOR = "an-operator-token-of-sufficient-length";

async function desk(env: Record<string, string> = {}) {
  const c = await testContainer(env);
  const { view, signal } = await investigateFirstSignal(c);
  return { c, app: createApp(c), view, signal, briefId: view.briefId! };
}

async function buy(app: ReturnType<typeof createApp>, briefId: string) {
  const buyer = testBuyer();
  const path = `/api/v1/briefs/${briefId}`;
  const challenge = await request(app).get(path);
  const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
  return request(app).get(path).set(buyer.http.encodePaymentSignatureHeader(await buyer.http.createPaymentPayload(required))).set("x-bullseye-claim", "k".repeat(43));
}

/** what a Brief sells: what each evidence item found, and every sentence the writer produced from it */
function paidFindings(c: Awaited<ReturnType<typeof testContainer>>, briefId: string): string[] {
  const brief = c.briefs.get(briefId)!;
  const d = brief.draft;
  // the corporate-action record is the issuer's public notice; everything else is what the desk went and read
  const evidence = brief.evidence.filter((e) => e.kind !== "CORPORATE_ACTION_RECORD");
  const blocks = evidence.flatMap((e) => Object.entries(e.values).filter(([k, v]) => /block/i.test(k) && typeof v === "number").map(([, v]) => String(v)));
  return [...evidence.map((e) => e.summary), ...blocks, ...[...d.whatHappened, ...d.whyItMayMatter, ...d.onchainObservations].map((cl) => cl.text), ...d.unknowns, ...d.limitations, d.confidence.rationale];
}

const publicRoutes = (view: { id: string; signalId: string }, briefId: string) => [
  "/api/signals",
  `/api/signals/${view.signalId}`,
  "/api/investigations",
  `/api/investigations/${view.id}`,
  `/api/investigations/${view.id}/chain`,
  "/api/activity?limit=200",
  "/api/briefs",
  `/api/briefs/${briefId}/preview`,
  "/api/v1/catalog",
  "/api/commerce/summary",
  "/api/desk/economics",
  "/api/desk/status",
  "/api/health",
];

describe("what a visitor may read of an investigation", () => {
  it("is that each step happened, when, and whether it worked, and nothing of what the Brief sells", async () => {
    const { c, app, view, briefId } = await desk(PUBLIC);
    await buy(app, briefId);
    const findings = paidFindings(c, briefId);
    expect(findings.length).toBeGreaterThan(10);
    for (const path of publicRoutes(view, briefId)) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      const text = JSON.stringify(res.body);
      for (const f of findings) expect(text.includes(f), `${path} leaks: ${f.slice(0, 70)}`).toBe(false);
    }

    const body = (await request(app).get(`/api/investigations/${view.id}`)).body;
    expect(body.audience).toBe("PUBLIC");
    const evidenceRows = body.investigation.timeline.filter((t: { type: string }) => t.type === "EVIDENCE");
    expect(evidenceRows.length).toBeGreaterThan(4);
    for (const row of evidenceRows) {
      expect(row.detail).toBeNull();
      expect(row.evidenceId).toMatch(/^EV-/);
      expect(row.label).toContain(row.evidenceId);
    }
    expect(body.investigation.timeline.find((t: { type: string }) => t.type === "CHECKS").detail).toBeNull();
    expect(body.investigation.gate.decision).toBe("PUBLISH");
    expect(body.usage).toEqual({ modelCalls: expect.any(Number), toolCalls: expect.any(Number), costsWithheld: true });
  });

  it("keeps the issuer's public figures and the shape of the on-chain reads, with the chain's numbers left out", async () => {
    const { app, view, signal } = await desk(PUBLIC);
    const { chain } = (await request(app).get(`/api/investigations/${view.id}/chain`)).body;
    expect(chain.withheld).toBe(true);
    expect(chain.issuer.multiplierNew).toBe(signal.facts.multiplierNew);
    expect(chain.reads.map((r: { key: string }) => r.key)).toEqual(["BEFORE", "AFTER", "HEAD"]);
    for (const r of chain.reads) expect(r).toMatchObject({ blockNumber: null, blockTime: null, multiplier: null, evidenceId: expect.stringMatching(/^EV-/) });
    expect(chain.activation).toMatchObject({ blockNumber: null, blockTime: null });
  });

  it("shows a run that published nothing in full: there is no Brief to protect, and the rejection is the point", async () => {
    const c = await testContainer(PUBLIC);
    c.setFixtureBehaviour("unevidenced_number");
    const { view } = await investigateFirstSignal(c);
    expect(view.status).toBe("REJECTED");
    const app = createApp(c);
    const body = (await request(app).get(`/api/investigations/${view.id}`)).body;
    const numbers = body.investigation.gate.findings.find((f: { rule: string }) => f.rule === "NUMBERS_IN_TEXT_ARE_EVIDENCED");
    expect(numbers.passed).toBe(false);
    expect(numbers.detail).toContain("41250");
    const { chain } = (await request(app).get(`/api/investigations/${view.id}/chain`)).body;
    expect(chain.withheld).toBe(false);
    expect(chain.reads[0].blockNumber).toEqual(expect.any(Number));
  });

  it("does not open a run's findings to visitors during the minutes before its Brief exists", async () => {
    const c = await testContainer(PUBLIC);
    const { view } = await investigateFirstSignal(c);
    // the same run as it looked while it was still going: reads collected, a first draft judged, no Brief yet
    const stored = c.investigations.view(view.id)!;
    const rejected = { ...stored.gate!, decision: "REJECT" as const, findings: stored.gate!.findings.map((f) => (f.rule === "NUMBERS_IN_TEXT_ARE_EVIDENCED" ? { ...f, passed: false, detail: 'onchainObservations: "70922364" (no declared quantity)' } : f)) };
    c.db.prepare("UPDATE investigations SET status = 'RUNNING', brief_id = NULL, finished_at = NULL, gate_json = ?, gate_attempts_json = ? WHERE id = ?").run(JSON.stringify(rejected), JSON.stringify([rejected]), view.id);
    const app = createApp(c);

    const { chain } = (await request(app).get(`/api/investigations/${view.id}/chain`)).body;
    expect(chain.withheld).toBe(true);
    expect(chain.reads.every((r: { blockNumber: unknown; multiplier: unknown }) => r.blockNumber === null && r.multiplier === null)).toBe(true);
    const body = (await request(app).get(`/api/investigations/${view.id}`)).body;
    expect(body.investigation.status).toBe("RUNNING");
    expect(JSON.stringify(body)).not.toContain("70922364");
    expect(body.investigation.timeline.filter((t: { type: string }) => t.type === "EVIDENCE").every((t: { detail: unknown }) => t.detail === null)).toBe(true);
  });

  it("closes an earlier rejected run of a signal once a later run of that signal has a Brief on sale", async () => {
    const c = await testContainer(PUBLIC);
    c.setFixtureBehaviour("unevidenced_number");
    const first = (await investigateFirstSignal(c)).view;
    expect(first.status).toBe("REJECTED");
    c.setFixtureBehaviour("good");
    const second = (await investigateFirstSignal(c)).view;
    expect(second.status).toBe("PUBLISHED");
    expect(second.signalId).toBe(first.signalId);
    expect(second.id).not.toBe(first.id);
    const app = createApp(c);

    // the same event, the same blocks: the old run's reads are the new Brief's verification
    const { chain } = (await request(app).get(`/api/investigations/${first.id}/chain`)).body;
    expect(chain.withheld).toBe(true);
    for (const r of chain.reads) expect(r).toMatchObject({ blockNumber: null, blockTime: null, multiplier: null });
    expect(chain.activation).toMatchObject({ blockNumber: null, blockTime: null });

    const body = (await request(app).get(`/api/investigations/${first.id}`)).body;
    expect(body.investigation.status).toBe("REJECTED");
    expect(JSON.stringify(body)).not.toContain("41250");
    expect(body.investigation.gate.findings.find((f: { rule: string }) => f.rule === "NUMBERS_IN_TEXT_ARE_EVIDENCED").detail).toMatch(/withheld/i);
    for (const row of body.investigation.timeline.filter((t: { type: string }) => t.type === "GATE")) expect(row.detail).toBeNull();

    // were the rejected run ever the signal's latest again, the signal's page must not open it either
    c.db.prepare("UPDATE investigations SET started_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(first.id);
    const onSignal = (await request(app).get(`/api/signals/${first.signalId}`)).body;
    expect(onSignal.investigation.id).toBe(first.id);
    expect(JSON.stringify(onSignal)).not.toContain("41250");
  });

  it("does not say which checks failed, or how many passed, of a run whose Brief is on sale", async () => {
    const c = await testContainer({ ...PUBLIC, VIEWER_TOKEN: VIEWER });
    const { view } = await investigateFirstSignal(c);
    const stored = c.investigations.view(view.id)!;
    const disclosed = "all failed checks disclosed: CHK-ACTIVATION-TIME";
    const gate = { ...stored.gate!, findings: stored.gate!.findings.map((f) => (f.rule === "FAILED_CHECKS_DISCLOSED" ? { ...f, passed: true, detail: disclosed } : f)) };
    expect(gate.findings.some((f) => f.detail === disclosed)).toBe(true);
    c.db.prepare("UPDATE investigations SET gate_json = ?, gate_attempts_json = ? WHERE id = ?").run(JSON.stringify(gate), JSON.stringify([gate]), view.id);
    const app = createApp(c);

    const body = (await request(app).get(`/api/investigations/${view.id}`)).body;
    expect(body.audience).toBe("PUBLIC");
    expect(JSON.stringify(body)).not.toContain("CHK-ACTIVATION-TIME");
    expect(body.investigation.gate.findings.find((f: { rule: string }) => f.rule === "FAILED_CHECKS_DISCLOSED")).toMatchObject({ passed: true, detail: expect.stringMatching(/withheld/i) });
    // the row stays, with a label: the wall display reads it
    const row = body.investigation.timeline.find((t: { type: string }) => t.type === "CHECKS");
    expect(row.label).toEqual(expect.any(String));
    expect(row.label.length).toBeGreaterThan(0);
    expect(row.label).not.toMatch(/\d/);
    expect(row.detail).toBeNull();
    expect(JSON.stringify((await request(app).get(`/api/signals/${view.signalId}`)).body)).not.toMatch(/CHK-ACTIVATION-TIME|\d+ passed/);

    const full = (await request(app).get(`/api/investigations/${view.id}`).set({ authorization: `Bearer ${VIEWER}` })).body;
    expect(full.audience).toBe("DIAGNOSTIC");
    expect(full.investigation).toMatchObject(JSON.parse(JSON.stringify(c.investigations.view(view.id))));
    expect(full.investigation.timeline.find((t: { type: string }) => t.type === "CHECKS").label).toMatch(/^\d+ passed, \d+ failed, \d+ unknown$/);
    expect(JSON.stringify(full.investigation.gate)).toContain(disclosed);
  });

  it("withholds the detail of a rejected first draft once a revision of it is on sale", async () => {
    const c = await testContainer(PUBLIC);
    const { view } = await investigateFirstSignal(c);
    const stored = c.investigations.view(view.id)!;
    const rejected = { ...stored.gate!, decision: "REJECT" as const, findings: stored.gate!.findings.map((f) => (f.rule === "NUMBERS_IN_TEXT_ARE_EVIDENCED" ? { ...f, passed: false, detail: 'whatHappened: "1.0033" (precision too coarse)' } : f)) };
    c.db.prepare("UPDATE investigations SET gate_attempts_json = ? WHERE id = ?").run(JSON.stringify([rejected, stored.gate]), view.id);
    const body = (await request(createApp(c)).get(`/api/investigations/${view.id}`)).body;
    expect(body.investigation.gateAttempts).toHaveLength(2);
    expect(JSON.stringify(body.investigation.gateAttempts)).not.toContain("1.0033");
    expect(body.investigation.gateAttempts[0].findings.find((f: { passed: boolean }) => !f.passed).detail).toMatch(/withheld/i);
  });
});

describe("diagnostics", () => {
  it("open to the viewer token, which reads everything a visitor cannot and starts nothing", async () => {
    const { c, app, view, briefId } = await desk({ ...PUBLIC, VIEWER_TOKEN: VIEWER, OPERATOR_TOKEN: OPERATOR });
    await buy(app, briefId);
    const auth = { authorization: `Bearer ${VIEWER}` };
    const body = (await request(app).get(`/api/investigations/${view.id}`).set(auth)).body;
    expect(body.audience).toBe("DIAGNOSTIC");
    expect(body.investigation.timeline.find((t: { type: string }) => t.type === "EVIDENCE").detail).toEqual(expect.any(String));
    expect(body.usage).toMatchObject({ costsWithheld: false, measuredModelCostUsd: expect.any(Number) });
    expect((await request(app).get(`/api/investigations/${view.id}/chain`).set(auth)).body.chain.reads[0].blockNumber).toEqual(expect.any(Number));
    expect((await request(app).get("/api/activity").set(auth)).body.events.some((e: { refId: string }) => e.refId.startsWith("ord_"))).toBe(true);

    // it is not the operator's token: no spend route, no list of buyers' orders, no one's order
    expect((await request(app).post("/api/signals/scan").set(auth)).status).toBe(401);
    expect((await request(app).get("/api/orders").set(auth)).status).toBe(401);
    expect((await request(app).get(`/api/orders/${c.ledger.list()[0]!.id}`).set(auth)).status).toBe(403);
    expect((await request(app).get(`/api/investigations/${view.id}`).set({ authorization: `Bearer ${VIEWER}x` })).body.audience).toBe("PUBLIC");
    expect((await request(app).get(`/api/investigations/${view.id}`).set({ authorization: `Bearer ${OPERATOR}` })).body.audience).toBe("DIAGNOSTIC");
    expect((await request(app).get("/api/health")).body.diagnostics).toBe("TOKEN_REQUIRED");
  });

  it("are open on a localhost development desk and disabled on a public deployment with no token", async () => {
    const local = await desk();
    expect((await request(local.app).get(`/api/investigations/${local.view.id}`)).body.audience).toBe("DIAGNOSTIC");
    expect((await request(local.app).get("/api/health")).body.diagnostics).toBe("OPEN_ON_LOCALHOST");
    const open = await desk(PUBLIC);
    expect((await request(open.app).get("/api/health")).body.diagnostics).toBe("DISABLED");
    await expect(testContainer({ VIEWER_TOKEN: "short" })).rejects.toThrow();
  });

  it("the public activity feed names no order and no quote, and still groups one order's rows", async () => {
    const { app, briefId } = await desk(PUBLIC);
    await buy(app, briefId);
    const events = (await request(app).get("/api/activity?limit=200")).body.events as { kind: string; refId: string }[];
    expect(JSON.stringify(events)).not.toMatch(/ord_|quo_/);
    const orderRefs = new Set(events.filter((e) => e.kind === "ORDER_STATE").map((e) => e.refId));
    expect(orderRefs.size).toBe(1);
    expect([...orderRefs][0]).toMatch(/^ref_[0-9a-f]{16}$/);
  });
});

describe("desk economics", () => {
  const call = (investigationId: string, seq: number, costUsd: number, costBasis: UsageRecord["costBasis"]): UsageRecord => ({ investigationId, seq, kind: "MODEL_CALL", name: "synthesis", model: "m", startedAt: "2026-09-18T00:00:00.000Z", latencyMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null, costUsd, costBasis, ok: true, error: null });
  const order = (id: string, briefId: string, state: Order["state"], rail: Order["terms"]["rail"], chainVerified: boolean): Order =>
    ({ id, state, terms: { briefId, priceUsd: "3.00", rail }, payment: { chainVerified } }) as unknown as Order;
  const allowances = { paymentFeeReserveUsd: 0.15, reworkReserveUsd: 0.2, dataToolAllowanceUsd: 0.1 };
  const runs: RunCost[] = [
    { investigationId: "inv_a", status: "PUBLISHED", briefId: "brf_a", usage: [call("inv_a", 0, 0.03, "MEASURED_PROVIDER_BILLED"), call("inv_a", 1, 0.04, "MEASURED_PROVIDER_BILLED")] },
    { investigationId: "inv_b", status: "REJECTED", briefId: null, usage: [call("inv_b", 0, 0.05, "MEASURED_PROVIDER_BILLED"), call("inv_b", 1, 0.02, "UPPER_BOUND_AT_PRICE_CAP")] },
    { investigationId: "inv_c", status: "PUBLISHED", briefId: "brf_c", usage: [call("inv_c", 0, 0.06, "MEASURED_USAGE_AT_LIST_PRICE")] },
    { investigationId: "inv_d", status: "STOPPED", briefId: null, usage: [call("inv_d", 0, 0.01, "MEASURED_PROVIDER_BILLED")] },
  ];

  it("counts each investigation once however many orders its Brief has, and counts rejected, stopped and unsold work", () => {
    const orders = [order("ord_1", "brf_a", "DELIVERED", "OKX_X402_TESTNET", true), order("ord_2", "brf_a", "DELIVERED", "OKX_X402_TESTNET", true), order("ord_3", "brf_a", "PAYMENT_FAILED", "OKX_X402_TESTNET", false)];
    const e = deskEconomics(runs, orders, allowances);
    expect(e.investigations).toEqual({ total: 4, published: 2, rejected: 1, stopped: 1, running: 0 });
    // 0.07 + 0.05 + 0.06 + 0.01: brf_a's research is there once although it sold twice
    expect(e.research.total).toEqual({ runs: 4, measuredUsd: 0.19, upperBoundUsd: 0.02 });
    expect(e.research.byOutcome.REJECTED).toEqual({ runs: 1, measuredUsd: 0.05, upperBoundUsd: 0.02 });
    expect(e.research.unsold).toEqual({ runs: 3, measuredUsd: 0.12, upperBoundUsd: 0.02 });
    expect(e.delivery).toMatchObject({ basis: "ESTIMATED", perPaidOrderUsd: 0.45, estimatedTotalUsd: 0.9 });
  });

  it("never calls a test payment revenue: with testnet orders only, revenue is zero and the contribution is what was spent", () => {
    const e = deskEconomics(runs, [order("ord_1", "brf_a", "DELIVERED", "OKX_X402_TESTNET", true), order("ord_2", "brf_c", "PAID", "FIXTURE", false)], allowances);
    expect(e.sales).toMatchObject({ paidOrders: 2, revenueOrders: 0, revenueUsd: 0, testOrders: 2, testPaymentsUsd: 6 });
    expect(e.sales.note).toMatch(/revenue is zero/i);
    expect(e.estimatedContributionUsd).toBe(-(0.19 + 0.02 + 0.9));
    expect(e.contributionNote).toMatch(/not|excludes/i);
  });

  it("counts a mainnet order as revenue only when its transfer was read back from the chain", () => {
    const e = deskEconomics(runs, [order("ord_1", "brf_a", "DELIVERED", "OKX_X402_MAINNET", true), order("ord_2", "brf_a", "DELIVERED", "OKX_X402_MAINNET", false)], allowances);
    // the unconfirmed mainnet order is not revenue, and it is not a test payment either
    expect(e.sales).toMatchObject({ revenueOrders: 1, revenueUsd: 3, testOrders: 0, testPaymentsUsd: 0, unverifiedMainnetOrders: 1, unverifiedMainnetUsd: 3 });
  });

  it("is served as a labelled aggregate with no run, order or buyer in it", async () => {
    const { app, view, briefId } = await desk(PUBLIC);
    const paid = await buy(app, briefId);
    const res = await request(app).get("/api/desk/economics");
    expect(res.body).toMatchObject({ label: "AGGREGATE", investigations: { total: 1, published: 1 }, sales: { paidOrders: 1, revenueUsd: 0 }, research: { runsWithoutAPrice: 1 } });
    const text = JSON.stringify(res.body);
    for (const id of [view.id, briefId, paid.body.orderId, paid.body.payment.payer]) expect(text).not.toContain(id);
  });
});
