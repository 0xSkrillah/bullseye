import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BriefPreview, Order } from "@bullseye/domain";
import type { BriefListResponse, Health, OrderRow, SignalRow } from "../src/lib/api";
import type { PollResult } from "../src/lib/usePoll";
import { formatCount } from "../src/format";
import { summariseOrders, type ChainResponse, type CommerceSummary, type DeskStatus, type Feed, type InvestigationSummary, type RebaseChain, type RoomInvestigation } from "../src/situation/data";
import { boardRows, fieldMarks, pickFocus } from "../src/situation/model";
import { BOARD_ROWS } from "../src/situation/stages";
import { OpportunityBoard } from "../src/situation/OpportunityBoard";
import { OpportunityField } from "../src/situation/OpportunityField";
import { InvestigationPanel } from "../src/situation/InvestigationPanel";
import { EvidenceChain } from "../src/situation/EvidenceChain";

const ok = <T,>(data: T): PollResult<T> => ({ data, error: null, updatedAt: Date.parse("2026-09-19T11:37:31Z") });
const NOW = Date.parse("2026-09-19T11:37:00Z");
/** what a reader sees: tags and React's text-boundary comments removed */
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "");

// Shapes and values below are taken from the public deployment's answers on 2026-09-19 (three real runs).
type Inv = NonNullable<SignalRow["investigation"]>;
const signal = (id: string, symbol: string, observedAt: string, changePct: number, investigation: Inv | null = null, superseded: SignalRow["superseded"] = null): SignalRow => ({
  signal: { id, asset: { symbol }, observedAt, detectedAt: "2026-09-19T10:16:21.206Z", facts: { changePct }, provenance: { mode: "LIVE" } } as unknown as SignalRow["signal"],
  superseded,
  investigation,
});
const inv = (id: string, status: Inv["status"], briefId: string | null = null): Inv => ({ id, status, stopReason: status === "RUNNING" ? null : "COMPLETED", briefId });
const AVGO = signal("sig_216bdbd9b6603d1d", "AVGOx", "2026-09-19T00:30:00.000Z", 0.127234, inv("inv_bdb36ac9f9a8509f", "REJECTED"));
const ES = signal("sig_5509eaa2ecd85d30", "ESx", "2026-09-19T00:30:00.000Z", 0.814014, inv("inv_f117ffa0cac381a6", "PUBLISHED", "brf_9aac63b6842fb78e"));
const SATA = signal("sig_b30d780f239a977f", "SATAx", "2026-09-19T00:30:00.000Z", 0.051595, inv("inv_0b09dec635375140", "PUBLISHED", "brf_4f41f04af0081567"));
const SATA_OLD = signal("sig_4e3bfa6a46a0db72", "SATAx", "2026-09-16T00:30:00.000Z", 0.0516);
const CPETC = signal("sig_cc587ac483d424d9", "CPETCx", "2026-09-19T00:30:00.000Z", 2.440576);
const ROWS = [AVGO, ES, SATA, CPETC, SATA_OLD];
const BRIEFS = [{ id: "brf_4f41f04af0081567", signalId: SATA.signal.id, confidence: "MEDIUM" }, { id: "brf_9aac63b6842fb78e", signalId: ES.signal.id, confidence: "HIGH" }] as unknown as BriefPreview[];
const order = (briefId: string, state: Order["state"], chainVerified: boolean | null): OrderRow => ({ order: { id: "ord_0123456789abcdef", state, updatedAt: "2026-09-19T12:40:00.000Z", events: [], terms: { briefId, rail: "OKX_X402_TESTNET" }, payment: chainVerified === null ? null : { chainVerified } } as unknown as Order, receipt: {} as OrderRow["receipt"], briefHeadline: null });
const commerce = (rows: OrderRow[]): PollResult<Feed<CommerceSummary>> => ok({ state: "ok", data: summariseOrders(rows) });
const summary = (id: string, status: InvestigationSummary["status"], startedAt: string): InvestigationSummary => ({ id, signalId: "sig_x", symbol: "X", status, stopReason: null, startedAt, finishedAt: null, briefId: null, gate: null, draftsJudged: 0, usage: { modelCalls: 0, toolCalls: 0, measuredModelCostUsd: 0, costBasis: null } });

const HEALTH = { synthesis: { ready: true }, paymentRail: { ready: true }, budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 } } as unknown as Health;
const DESK = (liveWindowHours?: number): PollResult<Feed<DeskStatus>> => ok({ state: "ok", data: { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: 3, lastTick: null, nextTickAt: null, dailySpendCeilingUsd: 1.8, liveWindowHours } });

describe("which investigation the room watches", () => {
  it("the RUNNING one, else the newest; the list is newest first", () => {
    const list = [summary("inv_new", "PUBLISHED", "2026-09-19T10:28:14Z"), summary("inv_run", "RUNNING", "2026-09-19T10:23:01Z"), summary("inv_old", "REJECTED", "2026-09-19T10:16:24Z")];
    expect(pickFocus(list, null)).toBe("inv_run");
    expect(pickFocus([list[0]!, list[2]!], null)).toBe("inv_new");
    expect(pickFocus([], ROWS)).toBe("inv_bdb36ac9f9a8509f");
    expect(pickFocus(null, [CPETC])).toBeNull();
  });
});

describe("opportunity board", () => {
  it("is one row per signal, newest effective time first, and says how far each one got", () => {
    // fed out of order: the oldest first, then the newest four in a different order than the one expected back
    const rows = boardRows([SATA_OLD, CPETC, AVGO, ES, SATA], BRIEFS, summariseOrders([]), "inv_0b09dec635375140");
    expect(rows.map((r) => r.id)).toEqual([CPETC.signal.id, AVGO.signal.id, ES.signal.id, SATA.signal.id, SATA_OLD.signal.id]);
    const [cpetc, avgo, es, sata] = rows as [typeof rows[0], typeof rows[0], typeof rows[0], typeof rows[0]];
    expect(avgo.nodes.GATE).toEqual({ state: "fail", note: "REJECT" });
    expect(avgo.nodes.BRIEF.state).toBe("none");
    expect(es.nodes.GATE).toEqual({ state: "pass", note: "PUBLISH" });
    expect(es.nodes.BRIEF).toEqual({ state: "done", note: "HIGH" });
    expect(es.nodes.PAYMENT.state).toBe("none");
    expect(sata.focused).toBe(true);
    expect(es.focused).toBe(false);
    expect(cpetc.nodes.INVESTIGATION.state).toBe("none");
  });

  it("never turns an unknown into a no, or an unverified payment into a pass", () => {
    const unknown = boardRows([ES], BRIEFS, null, null)[0]!;
    expect(unknown.nodes.PAYMENT.state).toBe("unknown");
    const brief = ES.investigation!.briefId!;
    expect(boardRows([ES], BRIEFS, summariseOrders([order(brief, "DELIVERED", false)]), null)[0]!.nodes.PAYMENT.state).toBe("unverified");
    expect(boardRows([ES], BRIEFS, summariseOrders([order(brief, "DELIVERED", false)]), null)[0]!.nodes.DELIVERY.state).toBe("unverified");
    expect(boardRows([ES], BRIEFS, summariseOrders([order(brief, "DELIVERED", true)]), null)[0]!.nodes.PAYMENT).toEqual({ state: "pass", note: "PAID" });
    // the product's promise travels with the state: said with the row, word for word
    expect(boardRows([ES], BRIEFS, summariseOrders([order(brief, "PAYMENT_UNKNOWN", null)]), null)[0]!.nodes.PAYMENT).toEqual({ state: "pending", note: "UNKNOWN", detail: "A retry cannot charge you twice." });
    expect(boardRows([ES], BRIEFS, summariseOrders([order("brf_other", "DELIVERED", true)]), null)[0]!.nodes.PAYMENT.state).toBe("none");
    // a list that came back full may not reach this Brief's orders: not known, never "not reached"
    const full = summariseOrders(Array.from({ length: 50 }, () => order("brf_other", "DELIVERED", true)));
    expect(full.atLeast).toBe(true);
    expect(boardRows([ES], BRIEFS, full, null)[0]!.nodes.PAYMENT.state).toBe("unknown");
  });

  it("a stopped run is a failed node with a short word; the reason is said, not squeezed into the cell", () => {
    const stopped = signal("sig_00000000000000aa", "NVDAx", "2026-09-19T00:30:00.000Z", 0.2, { id: "inv_00000000000000aa", status: "STOPPED", stopReason: "BUDGET_TOOL_CALLS_EXCEEDED", briefId: null });
    expect(boardRows([stopped], [], summariseOrders([]), null)[0]!.nodes.INVESTIGATION).toEqual({ state: "fail", note: "STOPPED", detail: "BUDGET_TOOL_CALLS_EXCEEDED" });
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: [stopped] })} briefs={ok({ briefs: [] } as unknown as BriefListResponse)} commerce={commerce([])} focusId={null} />);
    expect(html).toContain("INVESTIGATION STOPPED, BUDGET_TOOL_CALLS_EXCEEDED");
    expect(html).toContain(">STOPPED<");
  });

  it("no two states share a glyph, the row's sentence is real text, and an unconfirmed payment is counted apart in amber", () => {
    const brief = ES.investigation!.briefId!;
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: [ES] })} briefs={ok({ briefs: BRIEFS } as BriefListResponse)} commerce={commerce([order(brief, "DELIVERED", false)])} focusId={null} />);
    expect(html).toMatch(/is-unverified[^>]*><span class="glyph" aria-hidden="true">◌</);
    expect(html).not.toMatch(/<li class="room-board-row[^>]*aria-label/);
    expect(html).toContain("class=\"room-sr\"");
    // the second Brief's signal is not among the rows the room holds, so whether it is still sold is not known: a floor, "1+"
    expect(text(html)).toContain("1+ on sale · 0 paid · 1 paid, not chain-verified");
    expect(html).toContain("class=\"room-unknown\"");
    const verified = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: [ES] })} briefs={ok({ briefs: BRIEFS } as BriefListResponse)} commerce={commerce([order(brief, "DELIVERED", true)])} focusId={null} />);
    expect(text(verified)).toContain("1+ on sale · 1 paid");
    // nothing on this board is unconfirmed: the words appear only in the glyph key, which explains ◌ and says nothing about these orders
    expect(verified.replace(/<p class="room-board-key"[\s\S]*?<\/p>/, "")).not.toContain("not chain-verified");
  });

  it("a Brief whose action the issuer voided is withdrawn, and the row is struck", () => {
    const voided = { ...ES, superseded: { byVersion: 3, reason: "CANCELLED" as const, status: "Cancelled", notes: null, notedAt: "2026-09-19T12:00:00Z" } };
    expect(boardRows([voided], BRIEFS, summariseOrders([]), null)[0]!.nodes.BRIEF).toEqual({ state: "fail", note: "WITHDRAWN" });
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: [voided] })} briefs={ok({ briefs: BRIEFS } as BriefListResponse)} commerce={commerce([])} focusId={null} />);
    expect(html).toContain("is-superseded");
    expect(html).toContain("SUPERSEDED · v3 CANCELLED");
  });

  it("prints the change to four decimals from changePct, the provenance word, and the gate's verdict in words", () => {
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: ROWS })} briefs={ok({ briefs: BRIEFS } as BriefListResponse)} commerce={commerce([])} focusId="inv_0b09dec635375140" />);
    expect(html).toContain("+0.8140%");
    expect(html).toContain("+2.4406%");
    expect(html).toContain("BAR MAX 2.4406%");
    expect(html.match(/LIVE</g)!.length).toBe(ROWS.length);
    expect(html).toContain("GATE PUBLISH");
    expect(html).toContain("GATE REJECT");
    expect(html).toContain("BRIEF on sale, confidence MEDIUM");
    expect(html).toContain("is-focus");
    expect(html).not.toMatch(/confidence[^<]*\d/i);
  });

  it("holds what fits the wall and counts the rest in words", () => {
    const many = Array.from({ length: BOARD_ROWS + 4 }, (_, i) => signal(`sig_${String(i).padStart(16, "0")}`, `A${i}x`, `2026-09-${String(19 - Math.floor(i / 3)).padStart(2, "0")}T00:30:00.000Z`, 0.1 + i / 100));
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: many })} briefs={ok({ briefs: [] } as unknown as BriefListResponse)} commerce={commerce([])} focusId={null} />);
    expect(html.match(/<li class="room-board-row[ "]/g)).toHaveLength(BOARD_ROWS - 1);
    expect(html).toContain("+5 more, not shown");
    expect(html).toContain(`>${BOARD_ROWS + 4}<`);
  });

  it("keeps the focused run on the board even when it is the oldest of too many", () => {
    const many = Array.from({ length: BOARD_ROWS + 4 }, (_, i) => signal(`sig_${String(i).padStart(16, "0")}`, `A${i}x`, `2026-09-${String(19 - Math.floor(i / 3)).padStart(2, "0")}T00:30:00.000Z`, 0.1, i === BOARD_ROWS + 3 ? inv("inv_000000000000000f", "RUNNING") : null));
    const html = renderToStaticMarkup(<OpportunityBoard health={HEALTH} signals={ok({ dataMode: "LIVE" as const, signals: many })} briefs={ok({ briefs: [] } as unknown as BriefListResponse)} commerce={commerce([])} focusId="inv_000000000000000f" />);
    expect(html.match(/<li class="room-board-row[ "]/g)).toHaveLength(BOARD_ROWS - 1);
    expect(html.match(/room-board-row is-focus/g)).toHaveLength(1);
    expect(html).toContain(`A${BOARD_ROWS + 3}x`);
    expect(html).toContain("+5 more, not shown");
  });
});

describe("opportunity field", () => {
  it("places a signal by the age of its effective time inside the server's window, one bearing per asset", () => {
    const { marks, outside } = fieldMarks(ROWS, NOW, 96);
    expect(outside).toBe(0);
    const sataNew = marks.find((m) => m.id === SATA.signal.id)!;
    const sataOld = marks.find((m) => m.id === SATA_OLD.signal.id)!;
    expect(sataNew.angle).toBe(sataOld.angle);
    expect(sataNew.distance).toBeCloseTo(1 - (11 + 7 / 60) / 96, 4);
    expect(sataOld.distance).toBeCloseTo(1 - (83 + 7 / 60) / 96, 4);
    expect(marks.filter((m) => m.label).map((m) => m.symbol).sort()).toEqual(["AVGOx", "CPETCx", "ESx", "SATAx"]);
    expect(marks.find((m) => m.id === AVGO.signal.id)).toMatchObject({ rejected: true, stopped: false, state: "open" });
    const halted = signal("sig_00000000000000bb", "NVDAx", "2026-09-19T00:30:00.000Z", 0.2, { id: "inv_00000000000000bb", status: "STOPPED", stopReason: "ERROR", briefId: null });
    expect(fieldMarks([halted], NOW, 96).marks[0]).toMatchObject({ rejected: false, stopped: true });
    expect(fieldMarks(ROWS, NOW, 48).bearings).toBe(4);
    expect(marks.find((m) => m.id === ES.signal.id)).toMatchObject({ rejected: false, state: "published" });
    expect(fieldMarks(ROWS, NOW, 48)).toMatchObject({ outside: 1 });
  });

  it("plots only real signals, and only when the server gives the scale", () => {
    const signals = ok({ dataMode: "LIVE" as const, signals: ROWS });
    const plotted = renderToStaticMarkup(<OpportunityField signals={signals} deskStatus={DESK(96)} nowMs={NOW} />);
    expect(plotted.match(/data-event="sig_/g)).toHaveLength(ROWS.length);
    expect(plotted).toContain("5 signals plotted");
    expect(plotted).toContain("rim = now · centre = 96 h");
    expect(plotted).toContain("class=\"cross\"");
    // the legend names every mark the field can draw, each a shape and not only a colour
    for (const words of ["open", "running", "on sale", "rejected/stopped", "superseded"]) expect(plotted).toContain(words);
    expect(plotted).not.toContain("class=\"noise\"");
    expect(plotted).not.toContain("class=\"sweep\"");
    const unscaled = renderToStaticMarkup(<OpportunityField signals={signals} deskStatus={DESK(undefined)} nowMs={NOW} />);
    expect(unscaled).not.toContain("data-event=");
    expect(unscaled).toContain("not plotted: scale not available yet");
    expect(renderToStaticMarkup(<OpportunityField signals={signals} deskStatus={DESK(48)} nowMs={NOW} />)).toContain("1 older, not plotted");
  });
});

// GET /api/investigations/inv_0b09dec635375140 on 2026-09-19, timeline shortened to one entry of each kind
const RUN: RoomInvestigation = {
  investigation: {
    id: "inv_0b09dec635375140", signalId: SATA.signal.id, status: "PUBLISHED", stopReason: "COMPLETED", startedAt: "2026-09-19T10:28:14.601Z", finishedAt: "2026-09-19T10:29:29.966Z", briefId: "brf_4f41f04af0081567", gate: null, gateAttempts: null, budgetAtStart: null,
    timeline: [
      { seq: 1, at: "2026-09-19T10:28:14.605Z", type: "STARTED", ok: true, label: "Investigating SATAx: SATAx rebased +0.051595% (CashDividend)", detail: "budget: $0.6 max variable cost, 6 model calls, 14 tool calls", evidenceId: null },
      { seq: 2, at: "2026-09-19T10:28:20.354Z", type: "MODEL_CALL", ok: true, label: "plan evidence collection", detail: "openai/gpt-5.6-terra · 1303 in (1300 cache-written) / 234 out tokens · $0.0061 MEASURED_PROVIDER_BILLED", evidenceId: null },
      { seq: 3, at: "2026-09-19T10:28:34.057Z", type: "EVIDENCE", ok: true, label: "EV-POR · LIVE", detail: "Issuer proof-of-reserves at 2026-09-19T10:22:21.241Z: 1937 SATA shares held against 1934.0580119841452792 circulating SATAx.", evidenceId: "EV-POR" },
      { seq: 4, at: "2026-09-19T10:29:12.075Z", type: "TOOL_CALL", ok: false, label: "get_reference_price", detail: "source unavailable [xstocks.price.SATAx]: The operation was aborted due to timeout", evidenceId: null },
      { seq: 5, at: "2026-09-19T10:29:14.306Z", type: "CHECKS", ok: true, label: "8 passed, 0 failed, 1 unknown", detail: "CHK-ACTION-STILL-CURRENT: PASS", evidenceId: null },
      { seq: 6, at: "2026-09-19T10:29:29.964Z", type: "GATE", ok: true, label: "Publication gate: PUBLISH", detail: null, evidenceId: null },
    ],
  },
  budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 },
  usage: { modelCalls: 3, toolCalls: 10, measuredModelCostUsd: 0.048195, upperBoundModelCostUsd: 0, budgetSpentUsd: 0.048195, costBases: ["MEASURED_PROVIDER_BILLED"], costBasis: "MEASURED_PROVIDER_BILLED", routedModels: ["openai/gpt-5.6-terra"] },
};

describe("focused investigation", () => {
  const draw = (focus: RoomInvestigation, focusId = focus.investigation.id) => renderToStaticMarkup(<InvestigationPanel health={HEALTH} onRecord={3} running={0} focusId={focusId} focus={ok(focus)} symbol="SATAx" now={new Date(NOW)} />);

  it("shows spend against ceilings from the run's own fields", () => {
    const html = draw(RUN);
    expect(html).toContain("$0.048195");
    expect(html).toContain("$0.60");
    expect(html).toContain("data-basis=\"MEASURED\"");
    expect(html).toContain("data-basis=\"LIMIT\"");
    expect(text(html)).toContain("3 / 6");
    expect(text(html)).toContain("10 / 14");
    expect(html).toContain("75.4 s");
    expect(html).toContain("180 s ceiling");
    expect(html).toContain("✓ ");
    expect(html).toContain("PUBLISHED");
    expect(html).toContain("routed: openai/gpt-5.6-terra");
    expect(html).toContain("checks: 8 passed, 0 failed, 1 unknown");
    expect(html).toContain("1 tool calls of which 1 failed");
  });

  it("marks what happened and when, and never prints what a timeline entry says", () => {
    const html = draw(RUN);
    // +5.753 s and +19.456 s of a 180 s axis that is 418 units long and starts at 96
    expect(html).toContain("class=\"m-model\" x=\"105.4\"");
    expect(html).toContain("class=\"m-evidence\" cx=\"141.2\"");
    expect(html.match(/class="m-model"/g)).toHaveLength(1);
    expect(html.match(/class="m-evidence"/g)).toHaveLength(1);
    expect(html).toContain("m-glyph is-bad");
    expect(html).toContain("m-glyph is-ok");
    for (const prose of ["plan evidence collection", "proof-of-reserves", "source unavailable", "cache-written", "Investigating SATAx"]) expect(html).not.toContain(prose);
  });

  it("keeps an upper-bound cost apart from measured cost: amber, ≈, the word estimated, never green", () => {
    const html = draw({ ...RUN, usage: { ...RUN.usage, upperBoundModelCostUsd: 0.12, budgetSpentUsd: 0.168195 } });
    const gauges = html.slice(html.indexOf("class=\"room-gauges\""), html.indexOf("class=\"room-scroll\""));
    expect(text(gauges)).toContain("+ ≈ $0.120000 estimated upper bound");
    expect(gauges).toMatch(/data-basis="ESTIMATED" style="color:var\(--uncertain\)/);
    expect(gauges).not.toContain("var(--verified)");
    expect(gauges).toMatch(/fill is-estimated" style="width:20%"/);
    expect(html).not.toContain("$0.168195");
    // with nothing carried at the price cap there is no estimate on screen at all
    const plain = draw(RUN);
    expect(plain).not.toContain("≈");
    expect(plain).toMatch(/fill is-estimated" style="width:0%"/);
  });

  it("a failed model call is a cross, not a colour, and a run that overran its ceiling is drawn past it", () => {
    const failed = draw({ ...RUN, investigation: { ...RUN.investigation, timeline: [...RUN.investigation.timeline, { seq: 7, at: "2026-09-19T10:29:20.000Z", type: "MODEL_CALL", ok: false, label: "write brief", detail: null, evidenceId: null }] } });
    expect(failed).not.toContain("m-model is-bad");
    expect(failed.match(/m-glyph is-bad/g)).toHaveLength(2);
    expect(failed).toContain("2 model calls of which 1 failed");
    const over = draw({ ...RUN, investigation: { ...RUN.investigation, status: "STOPPED", stopReason: "BUDGET_LATENCY_EXCEEDED", finishedAt: "2026-09-19T10:34:14.601Z", briefId: null } });
    expect(over).toContain("class=\"ceiling\" x1=\"305\"");
    expect(over).toContain("class=\"elapsed\" x1=\"514\"");
    expect(over).toContain("finished 360.0 s");
    expect(text(over)).toContain("✕ stopped: BUDGET_LATENCY_EXCEEDED");
  });

  it("a RUNNING run's clock is never red on the browser's word, and stops at the last answer when the reads fail", () => {
    const going: RoomInvestigation = { ...RUN, investigation: { ...RUN.investigation, status: "RUNNING", finishedAt: null, briefId: null, gate: null } };
    const start = Date.parse(going.investigation.startedAt);
    // a wall PC whose clock runs fast: past the ceiling by its own reckoning, while the server has said nothing
    const fast = renderToStaticMarkup(<InvestigationPanel health={HEALTH} onRecord={3} running={1} focusId={going.investigation.id} focus={ok(going)} symbol="SATAx" now={new Date(start + 200_000)} />);
    expect(fast).toContain("now 200.0 s");
    expect(fast).not.toContain("tick is-bad");
    const failing = { data: going, error: "503", updatedAt: start + 42_000 };
    const frozen = renderToStaticMarkup(<InvestigationPanel health={HEALTH} onRecord={3} running={1} focusId={going.investigation.id} focus={failing} symbol="SATAx" now={new Date(start + 200_000)} />);
    expect(frozen).toContain("last known 42.0 s");
    expect(frozen).not.toContain("200.0 s");
  });

  it("uses the ceilings the run was started with when the server kept them, and says which it is showing", () => {
    const own = draw({ ...RUN, investigation: { ...RUN.investigation, budgetAtStart: { ...RUN.budget, maxVariableCostUsd: 0.25, maxLatencyMs: 90000 } } });
    expect(own).toContain("$0.25");
    expect(own).toContain("90 s ceiling");
    expect(own).toContain("the ceilings this run was started with");
    expect(draw(RUN)).toContain("Budget, current ceilings");
  });

  it("usage from the fixture synthesiser carries the word FIXTURE beside its figure", () => {
    expect(draw({ ...RUN, usage: { ...RUN.usage, measuredModelCostUsd: 0, budgetSpentUsd: 0, costBases: ["FIXTURE"], costBasis: "FIXTURE" } })).toContain("FIXTURE<");
    expect(draw(RUN)).not.toContain("FIXTURE<");
  });

  it("a stopped run says why, and the gauge that was hit turns red", () => {
    const html = draw({ ...RUN, investigation: { ...RUN.investigation, status: "STOPPED", stopReason: "BUDGET_TOOL_CALLS_EXCEEDED", briefId: null } });
    expect(html).toContain("STOPPED");
    expect(html).toContain("BUDGET_TOOL_CALLS_EXCEEDED");
    expect(html.match(/room-gauge is-over/g)).toHaveLength(1);
  });

  it("never draws one run under another run's name", () => {
    const html = draw(RUN, "inv_f117ffa0cac381a6");
    expect(html).not.toContain("$0.048195");
    expect(html).toContain("Fetching…");
  });
});

// GET /api/investigations/inv_0b09dec635375140/chain on 2026-09-19
const CHAIN: RebaseChain = {
  network: "eip155:196", token: "0x7c7445a40926152b8d24abdb9020e219d3d3380a", symbol: "SATAx",
  issuer: { multiplierOld: "1.046963274862202", multiplierNew: "1.0475034538939607", effectiveTimeUtc: "2026-09-19T00:30:00.000Z" },
  reads: [
    { key: "BEFORE", evidenceId: "EV-CHAIN-BEFORE", blockNumber: 71008704, blockTime: "2026-09-19T00:29:00.000Z", multiplier: "1.046963274862202", mode: "LIVE" },
    { key: "AFTER", evidenceId: "EV-CHAIN-AFTER", blockNumber: 71008824, blockTime: "2026-09-19T00:31:00.000Z", multiplier: "1.0475034538939607", mode: "LIVE" },
    { key: "HEAD", evidenceId: "EV-CHAIN-LATEST", blockNumber: 71044677, blockTime: "2026-09-19T10:28:33.000Z", multiplier: "1.0475034538939607", mode: "LIVE" },
  ],
  activation: { evidenceId: "EV-CHAIN-ACTIVATION", blockNumber: 71008764, blockTime: "2026-09-19T00:30:00.000Z", mode: "LIVE" },
  activationSearched: true,
};

describe("evidence chain", () => {
  const draw = (chain: RebaseChain | null, id = "inv_0b09dec635375140") => renderToStaticMarkup(<EvidenceChain investigationsOnRecord={3} focusId="inv_0b09dec635375140" chain={ok<Feed<ChainResponse>>({ state: "ok", data: { chain, investigationId: id } })} />);

  it("draws the step from the route's numbers: two levels, three reads, the block it changed in", () => {
    const html = draw(CHAIN);
    expect(html).toContain("1.046963");
    expect(html).toContain("1.047503");
    expect(html).toContain(formatCount(71008764));
    expect(html).toContain("00:30:00Z");
    expect(html.match(/class="read"/g)).toHaveLength(3);
    expect(html).toContain("class=\"step\"");
    expect(html).toContain("LIVE<");
    expect(html).toContain("multiplier() of SATAx on X Layer");
    // the chain's name comes from the response's `network`; one the room does not know is printed as it comes
    expect(draw({ ...CHAIN, network: "eip155:1952" })).toContain("multiplier() of SATAx on X Layer testnet");
    expect(draw({ ...CHAIN, network: "eip155:8453" })).toContain("multiplier() of SATAx on eip155:8453");
    // a finished run's chain is read once, and the foot says so rather than claiming a pace
    expect(html).toContain("read once");
    expect(html).not.toContain("every 10 s");
  });

  it("a read is green only when it returned what its slot should; anything else is a failed check, red, with its value", () => {
    const old = CHAIN.issuer.multiplierOld;
    const still = draw({ ...CHAIN, activation: null, reads: [CHAIN.reads[0]!, { ...CHAIN.reads[1]!, multiplier: old }, { ...CHAIN.reads[2]!, multiplier: old }] });
    expect(still).toContain("NO CHANGE FOUND ON CHAIN");
    expect(still).not.toContain("class=\"step\"");
    expect(still.match(/class="read"/g)).toHaveLength(1);
    expect(still.match(/class="read is-bad"/g)).toHaveLength(2);
    expect(still).toContain("✕ 1.046963");
    expect(still).toContain("AFTER read 1.046963 at block 71008824 (does not match the issuer)");
    const early = draw({ ...CHAIN, reads: [{ ...CHAIN.reads[0]!, multiplier: CHAIN.issuer.multiplierNew }, CHAIN.reads[1]!, CHAIN.reads[2]!] });
    expect(early.match(/class="read is-bad"/g)).toHaveLength(1);
    const neither = draw({ ...CHAIN, reads: [CHAIN.reads[0]!, { ...CHAIN.reads[1]!, multiplier: "1.05" }, CHAIN.reads[2]!] });
    expect(neither).toContain("read is-bad");
    expect(neither).toContain("✕ 1.050000");
    expect(draw({ ...CHAIN, activation: null, activationSearched: false })).toContain("ACTIVATION BLOCK NOT SEARCHED YET");
  });

  it("draws the line only where reads support it", () => {
    // the chain changed, but not to the issuer's value: the old level up to the block, a marker, no riser
    const mismatch = draw({ ...CHAIN, reads: [CHAIN.reads[0]!, { ...CHAIN.reads[1]!, multiplier: "1.05" }, { ...CHAIN.reads[2]!, multiplier: "1.05" }] });
    expect(mismatch).toContain("class=\"ceiling\"");
    expect(mismatch).not.toContain("V56");
    expect(mismatch.match(/class="read is-bad"/g)).toHaveLength(2);
    // only the activation block is known: a marker and nothing else
    const alone = draw({ ...CHAIN, reads: [] });
    expect(alone).toContain("class=\"ceiling\"");
    expect(alone).not.toContain("class=\"step\"");
    // the chain changed after the AFTER read: slots go in block order and the riser is where the block is
    const lag = draw({ ...CHAIN, activation: { ...CHAIN.activation!, blockNumber: 71008894 }, reads: [CHAIN.reads[0]!, { ...CHAIN.reads[1]!, multiplier: CHAIN.issuer.multiplierOld }, CHAIN.reads[2]!] });
    expect(lag).toMatch(/x="106" y="182" text-anchor="middle">AFTER</);
    expect(lag).toMatch(/x="178" y="182" text-anchor="middle">ACTIVATION</);
    expect(lag).toContain("M178 128 V56");
    // the good run rises at the activation block, between BEFORE and AFTER
    expect(draw(CHAIN)).toContain("M106 128 V56");
  });

  it("a weaker read shows on the badge, and another run's chain is never drawn", () => {
    expect(draw({ ...CHAIN, reads: [{ ...CHAIN.reads[0]!, mode: "CACHED" }, CHAIN.reads[1]!, CHAIN.reads[2]!] })).toContain("CACHED<");
    const other = draw(CHAIN, "inv_f117ffa0cac381a6");
    expect(other).not.toContain("1.046963");
    expect(other).not.toContain("NO ON-CHAIN READS");
  });
});
