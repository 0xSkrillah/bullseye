import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { resetRoutesForTest } from "../src/situation/data";
import { Room } from "../src/situation/Room";

/**
 * The whole room, as it runs: every hook, every poll, against a stubbed API on fake timers. The
 * budget in data.ts is only a table of intervals; this counts the requests the room actually makes.
 */
const BUDGET = { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 };
const T0 = Date.parse("2026-09-19T17:00:00.000Z");

const run = (id: string, status: string, fixture = false) => ({
  investigation: {
    id, signalId: `sig_${id.slice(4)}`, status, stopReason: status === "RUNNING" ? null : "COMPLETED", startedAt: new Date(T0 - 30_000).toISOString(), finishedAt: status === "RUNNING" ? null : new Date(T0 - 10_000).toISOString(),
    briefId: null, gate: status === "RUNNING" ? null : { decision: "REJECT", confidenceCap: "HIGH", findings: [] }, gateAttempts: null, budgetAtStart: BUDGET, timeline: [],
  },
  budget: BUDGET,
  usage: { modelCalls: 1, toolCalls: 1, measuredModelCostUsd: fixture ? 0 : 0.05, upperBoundModelCostUsd: 0, costBases: [fixture ? "FIXTURE" : "MEASURED_PROVIDER_BILLED"], routedModels: [] },
});
const summary = (id: string, status: string, symbol: string) => ({ id, signalId: `sig_${id.slice(4)}`, symbol, status, stopReason: null, startedAt: new Date(T0 - 30_000).toISOString(), finishedAt: null, briefId: null, gate: status === "RUNNING" ? null : { decision: "REJECT", confidenceCap: "HIGH" }, draftsJudged: 1, usage: { modelCalls: 1, toolCalls: 1 } });

interface Api { modern: boolean; running: boolean; fixture?: boolean; failing?: string[] }
function serve({ modern, running, fixture = false, failing = [] }: Api) {
  const calls: string[] = [];
  const ids = ["inv_0000000000000001", "inv_0000000000000002", "inv_0000000000000003", "inv_0000000000000004"];
  const list = ids.map((id, i) => summary(id, running && i === 0 ? "RUNNING" : "REJECTED", ["AVGOx", "ESx", "SATAx", "VTx"][i]!));
  const routes: Record<string, unknown> = {
    "/api/health": { service: "bullseye", dataSource: { mode: "LIVE", asOf: new Date(T0).toISOString() }, synthesis: { provider: "fixture", model: "deterministic-template", ready: true, detail: "" }, paymentRail: { rail: "FIXTURE", network: "eip155:1952", ready: true, detail: "", payTo: null, isTestnet: true }, priceUsd: "3.00", budget: BUDGET, operatorRoutes: "DISABLED", autoDesk: { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3 }, ...(modern ? { diagnostics: "DISABLED" } : {}) },
    "/api/signals": { dataMode: "LIVE", signals: ids.map((id, i) => ({ signal: { id: `sig_${id.slice(4)}`, asset: { symbol: list[i]!.symbol }, observedAt: new Date(T0 - 3_600_000).toISOString(), detectedAt: new Date(T0).toISOString(), facts: { changePct: 0.1 }, provenance: { mode: "LIVE" } }, superseded: null, investigation: { id, status: list[i]!.status, stopReason: null, briefId: null } })) },
    "/api/briefs": { briefs: [] },
    "/api/desk/status": { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: 4, lastTick: null, nextTickAt: null, dailySpendCeilingUsd: 1.8, liveWindowHours: 96 },
    "/api/activity": { events: [] },
    "/api/investigations": { investigations: list },
    "/api/commerce/summary": { label: "AGGREGATE", note: "n", rail: "FIXTURE", isTestnet: true, priceUsd: "3.00", total: 0, byState: {}, byBrief: [], latest: null, latestReceipt: null },
    "/api/desk/economics": { label: "AGGREGATE", note: "n", rail: "FIXTURE", isTestnet: true, investigations: { total: 4, published: 0, rejected: 4, stopped: 0, running: 0 }, research: { basis: "MEASURED", total: { runs: 4, measuredUsd: 0.2, upperBoundUsd: 0 }, byOutcome: { PUBLISHED: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 }, REJECTED: { runs: 4, measuredUsd: 0.2, upperBoundUsd: 0 }, STOPPED: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 }, RUNNING: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 } }, unsold: { runs: 4, measuredUsd: 0.2, upperBoundUsd: 0 }, runsWithoutAPrice: 0 }, sales: { paidOrders: 0, revenueOrders: 0, revenueUsd: 0, testOrders: 0, testPaymentsUsd: 0, note: "n" }, delivery: { basis: "ESTIMATED", perPaidOrderUsd: 0.45, estimatedTotalUsd: 0, note: "n" }, estimatedContributionUsd: -0.2, contributionNote: "n" },
    "/api/orders": { orders: [] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.split("?")[0]!;
    calls.push(path);
    if (failing.some((f) => path === f)) return new Response(JSON.stringify({ error: "down" }), { status: 500 });
    const byId = /^\/api\/investigations\/(inv_\w+)(\/chain)?$/.exec(path);
    if (byId) return new Response(JSON.stringify(byId[2] ? { chain: null } : run(byId[1]!, running && byId[1] === ids[0] ? "RUNNING" : "REJECTED", fixture)), { status: 200 });
    if (!(path in routes)) return new Response("<pre>Cannot GET</pre>", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }));
  return calls;
}

const minute = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); };

beforeEach(() => { vi.useFakeTimers({ now: T0 }); resetRoutesForTest(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the room as it runs", () => {
  it("asks the API less than once a second, a RUNNING investigation included, once it has loaded", async () => {
    const calls = serve({ modern: true, running: true });
    render(<Room />);
    await minute();
    const loaded = calls.length;
    await minute();
    const steady = calls.slice(loaded);
    expect(steady.length, JSON.stringify(steady.reduce<Record<string, number>>((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {}))).toBeLessThanOrEqual(60);
    // the RUNNING run is followed; every finished run was read once, in the first minute, and never again
    expect(steady.filter((p) => p === "/api/investigations/inv_0000000000000001").length).toBeGreaterThanOrEqual(15);
    for (const id of ["inv_0000000000000002", "inv_0000000000000003"]) expect(steady.filter((p) => p.startsWith(`/api/investigations/${id}`))).toEqual([]);
  });

  it("a finished run on screen is read once, as its panel says, and then left alone", async () => {
    const calls = serve({ modern: true, running: false });
    render(<Room />);
    await minute();
    const loaded = calls.length;
    // longer than the hour a settled poll used to wait: a re-read would show up here. Minute by minute, because React renders
    // only when an act() ends, and the room turns a finished run's poll off on its next render, as a real clock would let it.
    for (let i = 0; i < 61; i++) await minute();
    expect(calls.slice(loaded).filter((p) => p.startsWith("/api/investigations/inv_"))).toEqual([]);
    expect(calls.filter((p) => p === "/api/investigations/inv_0000000000000001")).toHaveLength(1);
  });

  it("never asks an older server for a route it does not have", async () => {
    const calls = serve({ modern: false, running: false });
    render(<Room />);
    await minute();
    expect(calls).not.toContain("/api/commerce/summary");
    expect(calls).not.toContain("/api/desk/economics");
  });

  it("tells a screen reader, in one sentence and in one place, which reads stopped answering", async () => {
    const calls = serve({ modern: true, running: false, failing: ["/api/activity", "/api/signals"] });
    const { container } = render(<Room />);
    const status = container.querySelectorAll("[role='status']");
    expect(status).toHaveLength(1);
    await minute();
    expect(calls).toContain("/api/activity");
    expect(status[0]!.textContent).toBe("No answer from signals, activity.");
    expect(container.querySelectorAll("[aria-live]").length).toBe(1);
  });

  it("a run on the test double is counted in words where its zero would otherwise read as a measured cost", async () => {
    serve({ modern: false, running: false, fixture: true });
    const { container } = render(<Room />);
    await minute();
    const economics = container.querySelector("[aria-label='Economics']")!.textContent!;
    expect(economics).toMatch(/runs? on the test double · model cost not measured/);
    expect(economics).not.toContain("$0.000000");
  });

  it("titles the tab while it is open", async () => {
    serve({ modern: true, running: false });
    const { unmount } = render(<Room />);
    expect(document.title).toBe("Bullseye · Situation Room");
    unmount();
    expect(document.title).not.toBe("Bullseye · Situation Room");
  });
});
