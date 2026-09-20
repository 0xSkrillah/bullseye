import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BriefListResponse, Health, SignalRow } from "../src/lib/api";
import { usePoll, type PollResult } from "../src/lib/usePoll";
import { optional, POLL_MS, RECHECK_MS, summariseOrders, type ActivityResponse, type CommerceSummary, type DeskStatus, type Feed } from "../src/situation/data";
import { StatusStrip } from "../src/situation/StatusStrip";
import { OpportunityBoard } from "../src/situation/OpportunityBoard";
import { OpportunityField } from "../src/situation/OpportunityField";
import { InvestigationPanel } from "../src/situation/InvestigationPanel";
import { EvidenceChain } from "../src/situation/EvidenceChain";
import { GatePanel } from "../src/situation/GatePanel";
import { ActivityStrip } from "../src/situation/ActivityStrip";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const ok = <T,>(data: T): PollResult<T> => ({ data, error: null, updatedAt: Date.parse("2026-09-19T09:53:55Z") });
const pending = <T,>(): PollResult<T> => ({ data: null, error: null, updatedAt: null });
const NOW = new Date("2026-09-19T09:53:54Z");
/** what a reader sees: tags and React's text-boundary comments removed */
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "");

/** GET /api/health exactly as the public deployment answered on 2026-09-19 09:53:54Z, before it had its keys. */
const notReady: Health = {
  service: "bullseye",
  dataSource: { mode: "LIVE", asOf: "2026-09-19T09:53:54.620Z" },
  synthesis: { provider: "openrouter", model: "openrouter/auto", ready: false, detail: "OPENROUTER_API_KEY is not set" },
  paymentRail: { rail: "OKX_X402_TESTNET", network: "eip155:1952", ready: false, detail: "Failed to initialize: no supported payment kinds loaded from any facilitator.", payTo: "0xa8bcd760a7c280c05090431c6afdf15df324d64a", isTestnet: true },
  priceUsd: "3.00",
  budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 },
  operatorRoutes: "DISABLED",
  autoDesk: { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3 },
};
const ready: Health = {
  ...notReady,
  synthesis: { ...notReady.synthesis, ready: true, detail: "cost tier medium; price cap $3/$15 per million tokens in/out" },
  paymentRail: { ...notReady.paymentRail, ready: true, detail: "facilitator supports exact on eip155:1952" },
};
const unavailable: PollResult<Feed<DeskStatus>> = ok({ state: "unavailable" });
const noSignals = ok({ dataMode: "LIVE" as const, signals: [] });
const noOrders: PollResult<Feed<CommerceSummary>> = ok({ state: "ok", data: summariseOrders([]) });

describe("status strip", () => {
  it("says NOT READY and why, in the API's own words", () => {
    const html = renderToStaticMarkup(<StatusStrip health={ok(notReady)} deskStatus={unavailable} now={NOW} />);
    expect(html.match(/✕ NOT READY/g)).toHaveLength(2);
    expect(html).toContain("OPENROUTER_API_KEY is not set");
    expect(html).toContain("Failed to initialize: no supported payment kinds loaded from any facilitator.");
    expect(html).not.toContain("✓ READY");
  });

  it("carries TESTNET and Not revenue. on a testnet rail, ready or not", () => {
    for (const h of [notReady, ready]) {
      const html = renderToStaticMarkup(<StatusStrip health={ok(h)} deskStatus={unavailable} now={NOW} />);
      expect(html).toContain("TESTNET<");
      expect(html).toContain("Not revenue.");
    }
  });

  it("prints the data mode as a word, the auto desk's interval and cap, the operator mode and a UTC clock", () => {
    const html = renderToStaticMarkup(<StatusStrip health={ok(ready)} deskStatus={unavailable} now={NOW} />);
    expect(html).toContain("LIVE<");
    expect(html.match(/✓ READY/g)).toHaveLength(2);
    expect(html).toContain("every 30 min · cap 3 / day");
    expect(html).toContain("DISABLED");
    expect(html).toContain("read-only for visitors");
    expect(html).toContain("09:53:54Z");
    expect(html).toContain("2026-09-19 · UTC");
  });

  it("reads an auto desk that is off, and a server that does not report one, without inventing an interval", () => {
    const off = renderToStaticMarkup(<StatusStrip health={ok({ ...ready, autoDesk: { enabled: false } })} deskStatus={unavailable} now={NOW} />);
    expect(off).toContain("○ OFF");
    expect(off).not.toContain("every ");
    const old = renderToStaticMarkup(<StatusStrip health={ok({ ...ready, autoDesk: undefined, operatorRoutes: undefined })} deskStatus={unavailable} now={NOW} />);
    expect(old.match(/not reported by this server/g)).toHaveLength(2);
  });

  it("shows the last tick only when the server reports one", () => {
    const desk: DeskStatus = { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: 3, lastTick: { at: "2026-09-19T10:28:14.000Z", action: "IDLE", reason: "DAILY_CAP", detail: null }, nextTickAt: null, dailySpendCeilingUsd: 1.8, liveWindowHours: 96 };
    expect(renderToStaticMarkup(<StatusStrip health={ok(ready)} deskStatus={ok({ state: "ok", data: desk })} now={NOW} />)).toContain("10:28:14Z");
    expect(renderToStaticMarkup(<StatusStrip health={ok(ready)} deskStatus={unavailable} now={NOW} />)).not.toContain("tick ");
  });

  it("says the API is unreachable instead of showing nothing, and marks old figures when a later read fails", () => {
    const down = renderToStaticMarkup(<StatusStrip health={{ data: null, error: "api 502", updatedAt: null }} deskStatus={pending()} now={NOW} />);
    expect(down).toContain("✕ API UNREACHABLE");
    expect(down).toContain("api 502");
    const stale = renderToStaticMarkup(<StatusStrip health={{ ...ok(ready), error: "Failed to fetch" }} deskStatus={pending()} now={NOW} />);
    expect(stale).toContain("✕ no answer");
    expect(stale).toContain("09:53:55Z");
    // what was READY a minute ago is only "last known": no tick and no green
    expect(stale).not.toContain("✓ READY");
    expect(stale).not.toContain("room-ok");
    expect(stale).toContain("room-unknown");
    expect(stale).toContain("last known · ");
  });
});

describe("empty and degraded states are deliberate", () => {
  it("the board says there is nothing, and which stages cannot run today", () => {
    const html = renderToStaticMarkup(<OpportunityBoard health={notReady} signals={noSignals} briefs={ok<BriefListResponse>({ priceUsd: "3.00", rail: notReady.paymentRail, briefs: [] })} commerce={noOrders} focusId={null} />);
    expect(html).toContain("0 OPPORTUNITIES ON RECORD");
    expect(text(html)).toContain("0 investigated · 0 rejected by gate · 0 on sale · 0 paid");
    expect(html).toContain("title=\"investigation cannot run: model not ready\"");
    expect(text(html)).toContain("✕ PAYMENT");
    expect(html).toContain("investigation cannot run: model not ready · payment cannot settle: rail not ready");
  });

  it("a ready desk with nothing on record blames no stage", () => {
    const html = renderToStaticMarkup(<OpportunityBoard health={ready} signals={noSignals} briefs={pending()} commerce={pending()} focusId={null} />);
    expect(html).toContain("0 OPPORTUNITIES ON RECORD");
    expect(html).not.toContain("✕");
  });

  it("the field is empty in words and draws no sweep", () => {
    const html = renderToStaticMarkup(<OpportunityField signals={noSignals} deskStatus={unavailable} nowMs={NOW.getTime()} />);
    expect(html).toContain("NO SIGNAL ON RECORD");
    expect(html).toContain("scale not available yet");
    expect(html).not.toContain("96 h");
    expect(html).not.toContain("class=\"sweep\"");
  });

  it("the radar's scale is the server's number, never a constant", () => {
    const desk: DeskStatus = { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: 0, lastTick: null, nextTickAt: null, dailySpendCeilingUsd: 1.8, liveWindowHours: 72 };
    expect(renderToStaticMarkup(<OpportunityField signals={noSignals} deskStatus={ok({ state: "ok", data: desk })} nowMs={NOW.getTime()} />)).toContain("centre = 72 h");
  });

  it("with no run, spend is a dash against real ceilings, never a zero", () => {
    const html = renderToStaticMarkup(<InvestigationPanel health={notReady} onRecord={0} running={0} />);
    expect(html).toContain("NO INVESTIGATION ON RECORD");
    expect(html).toContain("$0.60");
    expect(html).toContain("180 s ceiling");
    expect(html).not.toMatch(/>0<\/span> \/ /);
    expect(html).toContain("nothing RUNNING");
    expect(html).toContain("data-basis=\"LIMIT\"");
  });

  it("only says nothing is RUNNING when that is known, and says how many when some are", () => {
    const unknown = renderToStaticMarkup(<InvestigationPanel health={ready} onRecord={null} running={null} />);
    expect(unknown).not.toContain("nothing RUNNING");
    expect(unknown).not.toMatch(/\d+ RUNNING/);
    const one = renderToStaticMarkup(<InvestigationPanel health={ready} onRecord={50} atLeast running={1} />);
    expect(one).toContain("1 RUNNING");
    expect(one).not.toContain("nothing RUNNING");
    expect(one).toContain("50+ on record");
  });

  it("panels only claim emptiness when there is no investigation at all", () => {
    expect(renderToStaticMarkup(<EvidenceChain investigationsOnRecord={0} />)).toContain("NO ON-CHAIN READS");
    expect(renderToStaticMarkup(<EvidenceChain investigationsOnRecord={3} />)).not.toContain("NO ON-CHAIN READS");
    expect(renderToStaticMarkup(<GatePanel investigationsOnRecord={0} />)).toContain("NO DRAFT EVALUATED");
    const some = renderToStaticMarkup(<GatePanel investigationsOnRecord={3} />);
    expect(some).not.toContain("NO DRAFT EVALUATED");
    expect(some).not.toContain("not evaluated");
  });

  it("the gate lists the domain's eleven rules by name", () => {
    const html = renderToStaticMarkup(<GatePanel investigationsOnRecord={0} />);
    for (const rule of ["SCHEMA", "EVIDENCE_FRESH", "NUMBERS_IN_TEXT_ARE_EVIDENCED", "NO_INVESTMENT_ADVICE", "CONFIDENCE_WITHIN_CAP"]) expect(html).toContain(rule);
    expect(html).toContain("11 rules · code, not model");
  });

  it("the board counts what it knows: unknown reads are dashes and a withdrawn Brief is not on sale", () => {
    const row = (id: string, superseded: SignalRow["superseded"]): SignalRow => ({ signal: { id, asset: { symbol: id.toUpperCase() }, observedAt: "2026-09-19T00:30:00.000Z", facts: { changePct: 0.1 }, provenance: { mode: "LIVE" } } as unknown as SignalRow["signal"], superseded, investigation: { id: `inv_${id}`, status: "PUBLISHED", stopReason: "COMPLETED", briefId: `brf_${id}` } });
    const signals = ok({ dataMode: "LIVE" as const, signals: [row("a", null), row("b", { byVersion: 3, reason: "CANCELLED", status: "Cancelled", notes: null, notedAt: "2026-09-19T12:00:00Z" })] });
    const briefs = ok({ priceUsd: "3.00", rail: ready.paymentRail, briefs: [{ id: "brf_a", signalId: "a" }, { id: "brf_b", signalId: "b" }] } as unknown as BriefListResponse);
    expect(text(renderToStaticMarkup(<OpportunityBoard health={ready} signals={signals} briefs={briefs} commerce={noOrders} focusId={null} />))).toContain("2 investigated · 0 rejected by gate · 1 on sale · 0 paid");
    const unknown = renderToStaticMarkup(<OpportunityBoard health={ready} signals={signals} briefs={{ data: null, error: "api 502", updatedAt: null }} commerce={pending()} focusId={null} />);
    expect(text(unknown)).toContain("— on sale · — paid");
    expect(unknown).toContain("no answer from /api/briefs");
  });

  it("the activity line tells a missing route from an empty feed", () => {
    const missing: PollResult<Feed<ActivityResponse>> = ok({ state: "unavailable" });
    expect(renderToStaticMarkup(<ActivityStrip activity={missing} />)).toContain("ACTIVITY FEED NOT AVAILABLE YET");
    expect(renderToStaticMarkup(<ActivityStrip activity={ok({ state: "ok", data: { events: [] } })} />)).toContain("NO EVENTS ON RECORD");
  });

  it("activity is newest first, prints the server's own summary, and a testnet order event is never revenue", () => {
    const events = [
      { at: "2026-09-19T10:16:21.206Z", kind: "SIGNAL_DETECTED", refId: "sig_216bdbd9b6603d1d", symbol: "AVGOx", summary: "AVGOx rebased +0.127234% (CashDividend)", rail: null, state: null },
      { at: "2026-09-19T12:40:00.000Z", kind: "ORDER_STATE", refId: "ord_0123456789abcdef", symbol: "ESx", summary: "ESx: order PAID", rail: "OKX_X402_TESTNET" as const, state: "PAID" },
    ];
    const html = renderToStaticMarkup(<ActivityStrip activity={ok({ state: "ok", data: { events } })} />);
    expect(html.indexOf("ESx: order PAID")).toBeLessThan(html.indexOf("AVGOx rebased"));
    expect(html).toContain("12:40:00Z");
    expect(html.match(/TESTNET</g)).toHaveLength(1);
    expect(html.match(/>Not revenue\.</g)).toHaveLength(1);
  });

  it("an order whose payment outcome became unknown carries the promise about a retry, word for word", () => {
    const events = [
      { at: "2026-09-19T12:42:00.000Z", kind: "ORDER_STATE", refId: "ord_0123456789abcdef", symbol: "ESx", summary: "ESx: PAYMENT_PENDING → PAYMENT_UNKNOWN", rail: "OKX_X402_TESTNET" as const, state: "PAYMENT_UNKNOWN" },
      { at: "2026-09-19T12:40:00.000Z", kind: "ORDER_STATE", refId: "ord_0123456789abcdef", symbol: "ESx", summary: "ESx: QUOTED → PAYMENT_PENDING", rail: "OKX_X402_TESTNET" as const, state: "PAYMENT_PENDING" },
    ];
    const html = renderToStaticMarkup(<ActivityStrip activity={ok({ state: "ok", data: { events } })} />);
    expect(html.match(/A retry cannot charge you twice\./g)).toHaveLength(1);
  });

  it("a quote's price never reaches the wall as loose text", () => {
    const events = [{ at: "2026-09-19T12:41:00.000Z", kind: "QUOTE_ISSUED", refId: "quo_0123456789abcdef", symbol: "ESx", summary: "ESx: quote issued at $3.00", rail: "OKX_X402_TESTNET" as const, state: null }];
    const html = renderToStaticMarkup(<ActivityStrip activity={ok({ state: "ok", data: { events } })} />);
    expect(html).toContain("ESx: quote issued<");
    expect(html).not.toContain("$3.00");
    expect(html).toContain("TESTNET<");
  });
});

describe("data adapter", () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" } }));

  it("treats 404 as not available yet, not as an error and not as data", async () => {
    vi.stubGlobal("fetch", respond(404, "<pre>Cannot GET /api/desk/status</pre>"));
    await expect(optional("/api/desk/status")).resolves.toEqual({ state: "unavailable" });
  });

  it("passes a body through untouched and lets every other failure surface", async () => {
    vi.stubGlobal("fetch", respond(200, { events: [] }));
    await expect(optional("/api/activity")).resolves.toEqual({ state: "ok", data: { events: [] } });
    vi.stubGlobal("fetch", respond(429, { error: "rate_limited" }));
    await expect(optional("/api/activity")).rejects.toThrow("api 429");
  });

  it("budgets the whole room under one request a second", () => {
    const perMinute = (Object.values(POLL_MS) as number[]).reduce((t, ms) => t + 60_000 / ms, 0);
    expect(perMinute).toBeLessThanOrEqual(60);
    expect(RECHECK_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("polling", () => {
  const setVisibility = (state: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("stops while the tab is hidden and asks once when it is shown again", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => "x");
    renderHook(() => usePoll(fn, 1000, true, [], { pauseWhenHidden: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { setVisibility("hidden"); await vi.advanceTimersByTimeAsync(5000); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits longer after each failure and returns to pace on the first success", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    let fail = true;
    const fn = vi.fn(async () => { if (fail) throw new Error("api 429"); return "x"; });
    const { result } = renderHook(() => usePoll(fn, 1000, true, [], { backoffMaxMs: 8000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe("api 429");
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fn).toHaveBeenCalledTimes(2);
    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("takes the next wait from the answer without asking twice, so finding a route missing costs one request", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => ({ state: "unavailable" as const }));
    renderHook(() => usePoll(fn, 1000, true, [], { paceFor: (d) => (d.state === "unavailable" ? 60_000 : undefined) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("drops the last answer, error and time when what it is asking about changes", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async (id: string) => { if (id === "inv_b") throw new Error("api 500"); return id; });
    const { result, rerender } = renderHook(({ id }) => usePoll(() => fn(id), 1000, true, [id], { resetKey: id }), { initialProps: { id: "inv_a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("inv_a");
    expect(result.current.updatedAt).not.toBeNull();
    await act(async () => { rerender({ id: "inv_b" }); await vi.advanceTimersByTimeAsync(0); });
    // the failure is inv_b's own; the time inv_a last answered is not shown under it
    expect(result.current).toEqual({ data: null, error: "api 500", cause: new Error("api 500"), updatedAt: null });
  });

  it("without options it is the interval the desk has always used: a slow answer never stalls it", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => new Promise<string>(() => undefined));
    renderHook(() => usePoll(fn, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
