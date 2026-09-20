import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BriefPreview, Order } from "@bullseye/domain";
import type { BriefListResponse, Health, OrderRow, SignalRow } from "../src/lib/api";
import type { PollResult } from "../src/lib/usePoll";
import { summariseOrders, type ActivityEvent, type ActivityResponse, type CommerceSummary, type DeskStatus, type Feed, type RoomInvestigation } from "../src/situation/data";
import { ActivityStrip } from "../src/situation/ActivityStrip";
import { CommercePanel } from "../src/situation/CommercePanel";
import { GatePanel } from "../src/situation/GatePanel";
import { InvestigationPanel } from "../src/situation/InvestigationPanel";
import { OpportunityBoard } from "../src/situation/OpportunityBoard";
import { StatusStrip } from "../src/situation/StatusStrip";
import { FRESH_MS, useFreshKeys } from "../src/situation/useFresh";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const ok = <T,>(data: T): PollResult<T> => ({ data, error: null, updatedAt: Date.parse("2026-09-19T17:00:00Z") });
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("what counts as new", () => {
  it("nothing in the first answer is news; a key that was not there before is, for a while, once", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ keys }) => useFreshKeys(keys), { initialProps: { keys: null as string[] | null } });
    expect([...result.current]).toEqual([]);
    rerender({ keys: ["a", "b"] });
    expect([...result.current]).toEqual([]);
    rerender({ keys: ["c", "a", "b"] });
    expect([...result.current]).toEqual(["c"]);
    // the same answer again is not a change
    rerender({ keys: ["c", "a", "b"] });
    expect([...result.current]).toEqual(["c"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(FRESH_MS + 50); });
    expect([...result.current]).toEqual([]);
    // a key that left and came back is a change again
    rerender({ keys: ["a", "b"] });
    rerender({ keys: ["c", "a", "b"] });
    expect([...result.current]).toEqual(["c"]);
  });
});

const event = (at: string, state: string): ActivityEvent => ({ at, kind: "ORDER_STATE", refId: "ord_0123456789abcdef", symbol: "ESx", summary: `ESx: order ${state}`, rail: "OKX_X402_TESTNET", state } as ActivityEvent);
const feed = (events: ActivityEvent[]): PollResult<Feed<ActivityResponse>> => ok({ state: "ok", data: { events } as ActivityResponse });

describe("activity ticker", () => {
  it("ticks only when something happened: a new event is marked once, the ones already there are not", () => {
    const first = [event("2026-09-19T12:40:00.000Z", "PAYMENT_PENDING")];
    const { container, rerender } = render(<ActivityStrip activity={feed(first)} />);
    expect(container.querySelectorAll("li[data-fresh]")).toHaveLength(0);
    rerender(<ActivityStrip activity={feed(first)} />);
    expect(container.querySelectorAll("li[data-fresh]")).toHaveLength(0);
    rerender(<ActivityStrip activity={feed([event("2026-09-19T12:41:00.000Z", "PAID"), ...first])} />);
    const fresh = container.querySelectorAll("li[data-fresh]");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.textContent).toContain("ESx: order PAID");
    // it is still first in line: newest first
    expect(container.querySelector("li")).toBe(fresh[0]);
  });
});

type Inv = NonNullable<SignalRow["investigation"]>;
const signal = (id: string, symbol: string, investigation: Inv | null): SignalRow => ({
  signal: { id, asset: { symbol }, observedAt: "2026-09-19T00:30:00.000Z", detectedAt: "2026-09-19T10:16:21.206Z", facts: { changePct: 0.5 }, provenance: { mode: "LIVE" } } as unknown as SignalRow["signal"],
  superseded: null,
  investigation,
});
const HEALTH = { synthesis: { ready: true }, paymentRail: { ready: true }, budget: {} } as unknown as Health;
const HEALTH_FULL = { synthesis: { ready: true }, paymentRail: { ready: true, rail: "OKX_X402_TESTNET", isTestnet: true }, priceUsd: "3.00", budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 } } as unknown as Health;
const BRIEFS = ok({ briefs: [{ id: "brf_a", signalId: "sig_a", confidence: "HIGH" }] as unknown as BriefPreview[] } as BriefListResponse);
const orderRow = (state: Order["state"]): OrderRow => ({ order: { id: "ord_1", state, updatedAt: "2026-09-19T12:40:00.000Z", events: [], terms: { briefId: "brf_a", rail: "OKX_X402_TESTNET" }, payment: { chainVerified: true } } as unknown as Order, receipt: {} as OrderRow["receipt"], briefHeadline: null });
const commerce = (rows: OrderRow[]): PollResult<Feed<CommerceSummary>> => ok({ state: "ok", data: summariseOrders(rows) });

describe("opportunity board", () => {
  const board = (signals: SignalRow[], orders: OrderRow[], briefs = BRIEFS, c: PollResult<Feed<CommerceSummary>> = commerce(orders)) =>
    <OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals })} briefs={briefs} commerce={c} focusId={null} />;
  const A = signal("sig_a", "ESx", { id: "inv_a", status: "PUBLISHED", stopReason: "COMPLETED", briefId: "brf_a" });

  it("marks a row that was not there and a node that reached a new state; the picture at load is the baseline", () => {
    const { container, rerender } = render(board([A], []));
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
    // a payment lands: the PAYMENT and ECONOMICS nodes of that row changed state, the row itself is not new
    rerender(board([A], [orderRow("PAID")]));
    expect(container.querySelectorAll(".room-board-row[data-fresh]")).toHaveLength(0);
    expect(container.querySelectorAll(".room-node[data-fresh]").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".room-node.is-pass[data-fresh]")).not.toBeNull();
    // a new signal: its row is marked, and the count in the head with it
    rerender(board([A, signal("sig_b", "VTx", null)], [orderRow("PAID")]));
    expect(container.querySelectorAll(".room-board-row[data-fresh]")).toHaveLength(1);
    expect(container.querySelector(".room-headline [data-fresh]")?.textContent).toBe("2");
  });

  it("does not call the late arrival of the orders read a change: nothing is news until every read behind the board has answered", () => {
    const waiting: PollResult<Feed<CommerceSummary>> = { data: null, error: null, updatedAt: null };
    const { container, rerender } = render(board([A], [], BRIEFS, waiting));
    rerender(board([A], [orderRow("DELIVERED")]));
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
  });
});

describe("auto desk cell", () => {
  const health: Health = {
    service: "bullseye", dataSource: { mode: "LIVE", asOf: "2026-09-19T17:00:00.000Z" }, synthesis: { provider: "openrouter", model: "openrouter/auto", ready: true, detail: "" },
    paymentRail: { rail: "OKX_X402_TESTNET", network: "eip155:1952", ready: true, detail: "", payTo: null, isTestnet: true }, priceUsd: "3.00",
    budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 },
    operatorRoutes: "DISABLED", autoDesk: { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3 },
  };
  const status = (lastTick: DeskStatus["lastTick"], runs = 2): DeskStatus => ({ enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: runs, lastTick, nextTickAt: "2026-09-19T17:30:00.000Z", dailySpendCeilingUsd: 1.8, liveWindowHours: 96 });
  const desk = (lastTick: DeskStatus["lastTick"], runs = 2): PollResult<Feed<DeskStatus>> => ok({ state: "ok", data: status(lastTick, runs) });
  const at = new Date("2026-09-19T17:00:05Z");

  it("says what the loop did on its last tick and when it ticks next, in the server's enums, and never the tick's detail", () => {
    const html = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={desk({ at: "2026-09-19T17:00:00.000Z", action: "IDLE", reason: "SCAN_FAILED", detail: "source unavailable [xstocks]: ECONNRESET secret-looking text" })} now={at} />));
    expect(html).toContain("tick 17:00:00Z · IDLE · SCAN_FAILED");
    expect(html).not.toContain("ECONNRESET");
    const started = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={desk({ at: "2026-09-19T17:00:00.000Z", action: "STARTED", reason: null, detail: "sig_216bdbd9b6603d1d" })} now={at} />));
    expect(started).toContain("tick 17:00:00Z · STARTED");
    expect(started).not.toContain("sig_216bdbd9b6603d1d");
  });

  it("the 24 h figure is every run, whoever started it, and the cap is where the loop stops: it is never written as the loop's own score", () => {
    const html = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={desk(null, 4)} now={at} />));
    expect(html).toContain("every 30 min · 4 runs in 24 h · loop stops at 3 · next 17:30:00Z");
    expect(html).not.toMatch(/4 \/ 3|started in 24 h/);
    expect(text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={desk(null, 1)} now={at} />))).toContain("1 run in 24 h");
  });

  it("a next tick that is already behind the clock is not called next", () => {
    const html = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={desk(null)} now={new Date("2026-09-19T17:30:20Z")} />));
    expect(html).toContain("every 30 min · 2 runs in 24 h · loop stops at 3");
    expect(html).not.toContain("next");
  });

  it("when the desk status stops answering, what it last said is only last known", () => {
    const failing: PollResult<Feed<DeskStatus>> = { data: { state: "ok", data: status({ at: "2026-09-19T17:00:00.000Z", action: "IDLE", reason: "NOTHING_NEW", detail: null }) }, error: "api 500", updatedAt: Date.parse("2026-09-19T17:00:01Z") };
    const html = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={failing} now={at} />));
    expect(html).toContain("last known · tick 17:00:00Z");
    expect(html).toContain("last known · every 30 min");
    expect(html).not.toContain("api 500");
    // the health check itself is fine: the other cells are not marked
    expect(html).toContain("✓ READY openrouter/auto");
  });

  it("without the desk status route it keeps the health check's own line", () => {
    const html = text(renderToStaticMarkup(<StatusStrip health={ok(health)} deskStatus={ok({ state: "unavailable" })} now={at} />));
    expect(html).toContain("every 30 min · cap 3 / day");
  });

  it("a tick that happened before the room looked is not news, whichever read answers first; the next one is", () => {
    const waiting: PollResult<Feed<DeskStatus>> = { data: null, error: null, updatedAt: null };
    const { container, rerender } = render(<StatusStrip health={ok(health)} deskStatus={waiting} now={at} />);
    rerender(<StatusStrip health={ok(health)} deskStatus={desk({ at: "2026-09-19T16:35:00.000Z", action: "IDLE", reason: "NOTHING_NEW", detail: null })} now={at} />);
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
    rerender(<StatusStrip health={ok(health)} deskStatus={desk({ at: "2026-09-19T17:05:00.000Z", action: "STARTED", reason: null, detail: null })} now={at} />);
    expect(container.querySelectorAll(".room-line[data-fresh]")).toHaveLength(1);
  });
});

const judgedRun = (id: string): RoomInvestigation => ({
  investigation: { id, signalId: "sig_x", status: "PUBLISHED", stopReason: "COMPLETED", startedAt: "2026-09-19T10:00:00.000Z", finishedAt: "2026-09-19T10:01:00.000Z", briefId: null, gate: { decision: "PUBLISH", confidenceCap: "HIGH", findings: [] }, gateAttempts: null, budgetAtStart: null, timeline: [] },
  budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 },
  usage: { modelCalls: 1, toolCalls: 1 },
} as unknown as RoomInvestigation);

describe("gate columns", () => {
  it("the columns read at load are the baseline, however late they arrive; a run judged afterwards is news", () => {
    const three = [judgedRun("inv_a"), judgedRun("inv_b"), judgedRun("inv_c")];
    const { container, rerender } = render(<GatePanel investigationsOnRecord={null} judged={[]} expected={null} />);
    rerender(<GatePanel investigationsOnRecord={3} judged={[]} expected={3} />);
    rerender(<GatePanel investigationsOnRecord={3} judged={three.slice(0, 2)} expected={3} />);
    rerender(<GatePanel investigationsOnRecord={3} judged={three} expected={3} />);
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
    rerender(<GatePanel investigationsOnRecord={4} judged={[three[1]!, three[2]!, judgedRun("inv_d")]} expected={3} />);
    expect(container.querySelectorAll("th[data-fresh]")).toHaveLength(1);
  });
});

describe("order state rings", () => {
  const rows = (states: Order["state"][]): OrderRow[] => states.map((state, i) => ({ ...orderRow(state), order: { ...orderRow(state).order, id: `ord_${i}` } as Order }));
  const panel = (c: CommerceSummary) => <CommercePanel health={HEALTH_FULL} commerce={ok({ state: "ok", data: c })} />;

  it("pulse when a count rises, never when it falls, and never because the room switched to another source", () => {
    const { container, rerender } = render(panel(summariseOrders(rows(["DELIVERED", "DELIVERED", "QUOTED"]))));
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
    // an old DELIVERED order left the window and a new order reached PAYMENT_PENDING: only the rise is news
    rerender(panel(summariseOrders(rows(["DELIVERED", "QUOTED", "PAYMENT_PENDING"]))));
    const fresh = [...container.querySelectorAll(".node[data-fresh]")];
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.textContent).toContain("PAYMENT_PENDING");
    // the summary route appears: other counts, another source, a new baseline
    rerender(panel({ ...summariseOrders(rows(["DELIVERED", "DELIVERED", "DELIVERED", "PAID"])), source: "SUMMARY" }));
    expect(container.querySelectorAll(".node[data-fresh]").length).toBeLessThanOrEqual(1);
    expect([...container.querySelectorAll(".node[data-fresh]")].every((n) => n.textContent!.includes("PAYMENT_PENDING"))).toBe(true);
  });
});

describe("run chart", () => {
  const run = (id: string, seqs: number[], status = "RUNNING"): PollResult<RoomInvestigation> => ok({
    ...judgedRun(id),
    investigation: { ...judgedRun(id).investigation, status, finishedAt: null, gate: null, timeline: seqs.map((seq) => ({ seq, at: `2026-09-19T10:00:0${seq}.000Z`, type: "TOOL_CALL", ok: true, label: "x", detail: null, evidenceId: null })) },
  } as unknown as RoomInvestigation);
  const panel = (id: string, focus: PollResult<RoomInvestigation>) => <InvestigationPanel health={HEALTH_FULL} onRecord={2} running={1} focusId={id} focus={focus} symbol="ESx" now={new Date("2026-09-19T10:00:30Z")} />;

  it("marks an entry that arrived while the room was watching, and nothing when the focus moves to a run that already held its entries", () => {
    const { container, rerender } = render(panel("inv_a", run("inv_a", [1, 2])));
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
    rerender(panel("inv_a", run("inv_a", [1, 2, 3])));
    expect(container.querySelectorAll(".room-runchart g[data-fresh]")).toHaveLength(1);
    rerender(panel("inv_b", run("inv_b", [1, 2, 3, 4])));
    // inv_a's third mark may still be inside its two seconds; nothing of inv_b's is marked
    expect(container.querySelectorAll(".room-runchart g[data-fresh]")).toHaveLength(0);
    expect(container.querySelectorAll(".room-status[data-fresh]")).toHaveLength(0);
  });
});

describe("activity ticker dates", () => {
  it("an event from another UTC day prints its date, so yesterday's time of day never reads as today's", () => {
    const events = [event("2026-09-19T12:41:00.000Z", "PAID"), event("2026-09-18T22:05:47.000Z", "DELIVERED")];
    const html = text(renderToStaticMarkup(<ActivityStrip activity={feed(events)} now={new Date("2026-09-19T17:00:00Z")} />));
    expect(html).toContain("12:41:00Z ESx: order PAID");
    expect(html).not.toContain("2026-09-19 12:41:00Z");
    expect(html).toContain("2026-09-18 22:05:47Z ESx: order DELIVERED");
  });
});

describe("the room's motion rules", () => {
  // the suite runs with --root apps/web from the repository root, or from apps/web itself
  const root = ["apps/web/src/situation", "src/situation"].find((p) => existsSync(p))!;
  const css = readFileSync(`${root}/room.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const cut = css.indexOf("@media (prefers-reduced-motion: reduce)");
  const main = css.slice(0, cut).replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const reduced = css.slice(cut);
  const rules = [...main.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1]!.split(",").map((s) => s.trim()).filter(Boolean), body: m[2]! }));
  const moving = rules.filter((r) => /\b(animation|transition)(-[a-z-]+)?\s*:/.test(r.body));

  it("everything that moves is tied to data-fresh: every selector of every rule that animates", () => {
    expect(moving.length).toBeGreaterThan(0);
    for (const r of moving) for (const s of r.selectors) expect(s, `"${s}" animates without [data-fresh]`).toContain("[data-fresh]");
  });

  it("nothing loops: each animation is one of the room's own, written in shorthand, and runs exactly once", () => {
    expect(css).not.toMatch(/infinite/);
    for (const r of moving) {
      expect(r.body).not.toMatch(/\b(transition|animation-name|animation-iteration-count)\s*:/);
      const layers = (r.body.match(/\banimation\s*:([^;]+)/)?.[1] ?? "").replace(/\([^)]*\)/g, "").split(",");
      for (const layer of layers) {
        expect(layer).toMatch(/\broom-fresh-[a-z]+\b/);
        // the only bare number in a layer is its iteration count; times carry a unit
        expect(layer.trim().split(/\s+/).filter((t) => /^\d+(\.\d+)?$/.test(t))).toEqual(["1"]);
      }
    }
  });

  it("reduced motion removes all of it and still marks what is new, for every selector that animates", () => {
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");
    for (const r of moving) for (const s of r.selectors) {
      // the same element, or a child of it, carries a still marker
      const subject = s.replace(/\s*>\s*/g, " ").split(/\s+/).find((part) => part.includes("[data-fresh]"))!;
      expect(reduced, `no still marker for "${s}"`).toContain(subject);
    }
  });

  it("no component animates on its own: no inline animation, no shared pulsing class, no Web Animations call", () => {
    for (const file of readdirSync(root).filter((f) => /\.tsx?$/.test(f))) {
      expect(readFileSync(`${root}/${file}`, "utf8"), file).not.toMatch(/be-pulse|be-spin|animation\s*:|transition\s*:|\.animate\(/);
    }
  });
});
