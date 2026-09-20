import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ConfidenceLevel, GateRule, type BriefPreview, type Order } from "@bullseye/domain";
import type { BriefListResponse, Health, OrderRow, SignalRow } from "../src/lib/api";
import type { PollResult } from "../src/lib/usePoll";
import { clockTime, formatCount, formatUsd, fullTime } from "../src/format";
import { boardRows } from "../src/situation/model";
import { paidCounts, POLL_MS, summariseOrders, type ActivityEvent, type ActivityResponse, type ChainResponse, type CommerceSummary, type DeskEconomics, type DeskStatus, type Feed, type InvestigationSummary, type RebaseChain, type RoomInvestigation } from "../src/situation/data";
import { ActivityStrip } from "../src/situation/ActivityStrip";
import { CommercePanel } from "../src/situation/CommercePanel";
import { EvidenceChain } from "../src/situation/EvidenceChain";
import { GatePanel } from "../src/situation/GatePanel";
import { InvestigationPanel } from "../src/situation/InvestigationPanel";
import { OpportunityBoard } from "../src/situation/OpportunityBoard";
import { OpportunityField } from "../src/situation/OpportunityField";
import { StatusStrip } from "../src/situation/StatusStrip";
import { RETRY_PROMISE } from "../src/situation/stages";

/**
 * The nine honesty rules, held against the whole room at once. Three walls are drawn from fixtures
 * built to tempt every rule: an operator's wall on the testnet rail (orders list, receipts, costs,
 * chain figures), a visitor's wall on a mainnet desk (aggregates, withheld figures), and a test-rail
 * desk that has sold nothing yet. The accessibility of the same walls is checked at the end. Every
 * free-text field a model, a facilitator or an error could have written carries POISON; every
 * figure has a value that appears nowhere else, so a number on screen can be traced or not.
 */
afterEach(() => cleanup());

const POISON = "POISON-PROSE-7f3a";
const NOW = new Date("2026-09-19T17:00:05Z");
const ok = <T,>(data: T): PollResult<T> => ({ data, error: null, updatedAt: Date.parse("2026-09-19T17:00:00Z") });

const BUDGET = { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 };
const health = (rail: "OKX_X402_TESTNET" | "OKX_X402_MAINNET" | "FIXTURE"): Health => ({
  service: "bullseye", dataSource: { mode: "LIVE", asOf: "2026-09-19T16:59:58.000Z" },
  synthesis: { provider: "openrouter", model: "openrouter/auto", ready: true, detail: "cost tier medium" },
  paymentRail: { rail, network: rail === "OKX_X402_MAINNET" ? "eip155:196" : "eip155:1952", ready: true, detail: "", payTo: null, isTestnet: rail !== "OKX_X402_MAINNET" },
  priceUsd: "3.00", budget: BUDGET, operatorRoutes: "DISABLED", autoDesk: { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3 },
});
const DESK: DeskStatus = { enabled: true, intervalMinutes: 30, maxInvestigationsPerDay: 3, investigationsLast24h: 2, lastTick: { at: "2026-09-19T16:31:07.000Z", action: "IDLE", reason: "SCAN_FAILED", detail: `${POISON} ECONNRESET from upstream` }, nextTickAt: "2026-09-19T17:31:07.000Z", dailySpendCeilingUsd: 1.8, liveWindowHours: 96 };

type Inv = NonNullable<SignalRow["investigation"]>;
const signal = (id: string, symbol: string, observedAt: string, changePct: number, investigation: Inv | null, superseded: SignalRow["superseded"] = null): SignalRow => ({
  signal: { id, asset: { symbol }, observedAt, detectedAt: "2026-09-19T10:16:21.206Z", facts: { changePct, note: POISON }, provenance: { mode: "LIVE" }, headline: POISON } as unknown as SignalRow["signal"],
  superseded, investigation,
});
const SIGNALS: SignalRow[] = [
  signal("sig_aaaaaaaaaaaaaaa1", "AVGOx", "2026-09-19T00:30:00.000Z", 0.127234, { id: "inv_aaaaaaaaaaaaaaa1", status: "REJECTED", stopReason: "COMPLETED", briefId: null }),
  signal("sig_aaaaaaaaaaaaaaa2", "ESx", "2026-09-19T00:30:00.000Z", 0.814014, { id: "inv_aaaaaaaaaaaaaaa2", status: "PUBLISHED", stopReason: "COMPLETED", briefId: "brf_aaaaaaaaaaaaaaa2" }),
  signal("sig_aaaaaaaaaaaaaaa3", "SATAx", "2026-09-18T00:30:00.000Z", 0.051595, { id: "inv_aaaaaaaaaaaaaaa3", status: "PUBLISHED", stopReason: "COMPLETED", briefId: "brf_aaaaaaaaaaaaaaa3" }),
  signal("sig_aaaaaaaaaaaaaaa4", "NVDAx", "2026-09-17T00:30:00.000Z", 2.440576, { id: "inv_aaaaaaaaaaaaaaa4", status: "STOPPED", stopReason: "BUDGET_TOOL_CALLS_EXCEEDED", briefId: null }),
  // published, then voided by the issuer: its Brief is withdrawn, and its model-written headline must never reach the wall
  signal("sig_aaaaaaaaaaaaaaa5", "VTx", "2026-09-17T00:30:00.000Z", 0.179533, { id: "inv_aaaaaaaaaaaaaaa5", status: "PUBLISHED", stopReason: "COMPLETED", briefId: "brf_aaaaaaaaaaaaaaa5" }, { byVersion: 2, reason: "CANCELLED", status: "CANCELLED", notes: POISON, notedAt: "2026-09-19T09:00:00.000Z" } as unknown as SignalRow["superseded"]),
];
const BRIEFS = [
  { id: "brf_aaaaaaaaaaaaaaa2", signalId: "sig_aaaaaaaaaaaaaaa2", confidence: "HIGH", headline: POISON, summary: POISON },
  { id: "brf_aaaaaaaaaaaaaaa3", signalId: "sig_aaaaaaaaaaaaaaa3", confidence: "MEDIUM", headline: POISON, summary: POISON },
  { id: "brf_aaaaaaaaaaaaaaa5", signalId: "sig_aaaaaaaaaaaaaaa5", confidence: "LOW", headline: POISON, summary: POISON },
] as unknown as BriefPreview[];

const finding = (rule: string, passed: boolean) => ({ rule, passed, detail: `${POISON} "623521" not found in evidence` });
const gate = (decision: "PUBLISH" | "REJECT", failing: string[] = []) => ({ decision, confidenceCap: "HIGH", findings: GateRule.options.map((r) => finding(r, !failing.includes(r))) });
const run = (n: number, symbol: string, status: "PUBLISHED" | "REJECTED", briefId: string | null, measured: number): RoomInvestigation => ({
  investigation: {
    id: `inv_aaaaaaaaaaaaaaa${n}`, signalId: `sig_aaaaaaaaaaaaaaa${n}`, status, stopReason: "COMPLETED", startedAt: "2026-09-19T10:28:14.601Z", finishedAt: "2026-09-19T10:29:30.012Z", briefId,
    gate: gate(status === "PUBLISHED" ? "PUBLISH" : "REJECT", status === "PUBLISHED" ? [] : ["NUMBERS_IN_TEXT_ARE_EVIDENCED"]),
    gateAttempts: status === "PUBLISHED" ? [gate("REJECT", ["NUMBERS_IN_TEXT_ARE_EVIDENCED"]), gate("PUBLISH")] : null, budgetAtStart: BUDGET,
    timeline: [
      { seq: 1, at: "2026-09-19T10:28:16.000Z", type: "MODEL_CALL", ok: true, label: `${POISON} plan`, detail: POISON, evidenceId: null },
      { seq: 2, at: "2026-09-19T10:28:20.000Z", type: "TOOL_CALL", ok: false, label: "get_reference_price", detail: `${POISON} source unavailable`, evidenceId: null },
      { seq: 3, at: "2026-09-19T10:28:34.000Z", type: "EVIDENCE", ok: true, label: "EV-POR · LIVE", detail: `${POISON} 1937 shares held against 1934.058 circulating`, evidenceId: "EV-POR" },
      { seq: 4, at: "2026-09-19T10:29:14.000Z", type: "CHECKS", ok: true, label: "8 passed, 0 failed, 1 unknown", detail: POISON, evidenceId: null },
      { seq: 5, at: "2026-09-19T10:29:29.000Z", type: "GATE", ok: status === "PUBLISHED", label: `Publication gate: ${status === "PUBLISHED" ? "PUBLISH" : "REJECT"}`, detail: POISON, evidenceId: null },
    ],
  },
  budget: BUDGET,
  usage: { modelCalls: 3, toolCalls: 10, measuredModelCostUsd: measured, upperBoundModelCostUsd: 0.012345, budgetSpentUsd: Number((measured + 0.012345).toFixed(6)), costBases: ["MEASURED_PROVIDER_BILLED"], costBasis: "MEASURED_PROVIDER_BILLED", routedModels: ["openai/gpt-5.6-terra"] },
  symbol,
} as unknown as RoomInvestigation);
const RUNS = [run(1, "AVGOx", "REJECTED", null, 0.058282), run(2, "ESx", "PUBLISHED", "brf_aaaaaaaaaaaaaaa2", 0.062523), run(3, "SATAx", "PUBLISHED", "brf_aaaaaaaaaaaaaaa3", 0.048195)];
const LISTED: InvestigationSummary[] = RUNS.map((r, i) => ({ id: r.investigation.id, signalId: `sig_aaaaaaaaaaaaaaa${i + 1}`, symbol: ["AVGOx", "ESx", "SATAx"][i]!, status: r.investigation.status, stopReason: "COMPLETED", startedAt: r.investigation.startedAt, finishedAt: r.investigation.finishedAt, briefId: r.investigation.briefId, gate: { decision: r.investigation.gate!.decision, confidenceCap: "HIGH" }, draftsJudged: 2, usage: r.usage } as unknown as InvestigationSummary));

const CHAIN: RebaseChain = {
  network: "eip155:196", token: "0x7c74aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "SATAx", issuer: { multiplierOld: "1.046963274862202", multiplierNew: "1.0475034538939607", effectiveTimeUtc: "2026-09-19T00:30:00.000Z" },
  reads: [
    { key: "BEFORE", evidenceId: "EV-CHAIN-BEFORE", blockNumber: 70922304, blockTime: "2026-09-19T00:29:00.000Z", multiplier: "1.046963274862202", mode: "LIVE" },
    { key: "AFTER", evidenceId: "EV-CHAIN-AFTER", blockNumber: 70922424, blockTime: "2026-09-19T00:31:00.000Z", multiplier: "1.0475034538939607", mode: "LIVE" },
    { key: "HEAD", evidenceId: "EV-CHAIN-HEAD", blockNumber: 70990637, blockTime: "2026-09-19T10:28:30.000Z", multiplier: "1.0475034538939607", mode: "LIVE" },
  ],
  activation: { evidenceId: "EV-CHAIN-ACTIVATION", blockNumber: 70922364, blockTime: "2026-09-19T00:30:02.000Z", mode: "LIVE" }, activationSearched: true,
};
const WITHHELD: RebaseChain = { ...CHAIN, withheld: true, reads: CHAIN.reads.map((r) => ({ ...r, blockNumber: null, blockTime: null, multiplier: null })), activation: { ...CHAIN.activation!, blockNumber: null, blockTime: null } };

const order = (id: string, briefId: string, state: Order["state"], chainVerified: boolean | null, updatedAt: string, rail = "OKX_X402_TESTNET"): OrderRow => ({
  order: {
    id, quoteId: `quo_${id.slice(4)}`, state, updatedAt, terms: { briefId, rail, priceUsd: "3.00" },
    payment: chainVerified === null ? null : { chainVerified, payer: `0xPAYER${POISON}`, txHash: `0xTX${POISON}`, facilitatorStatus: POISON },
    events: [{ seq: 1, at: updatedAt, from: null, to: "QUOTED", reason: POISON }, { seq: 2, at: updatedAt, from: "QUOTED", to: "PAYMENT_PENDING", reason: POISON }, { seq: 3, at: updatedAt, from: "PAYMENT_PENDING", to: state, reason: POISON }],
  } as unknown as Order,
  receipt: { rail, countsAsRevenue: false, priceUsd: 3, measuredTotalUsd: 0.071725, estimatedTotalUsd: 0.45, estimatedContributionUsd: 2.478275, revenueNote: POISON, contributionNote: POISON, usage: { usageIsFixture: false } } as unknown as OrderRow["receipt"],
  briefHeadline: POISON,
});
const ORDERS = [
  order("ord_bbbbbbbbbbbbbbb1", "brf_aaaaaaaaaaaaaaa2", "DELIVERED", true, "2026-09-19T12:40:11.000Z"),
  order("ord_bbbbbbbbbbbbbbb2", "brf_aaaaaaaaaaaaaaa3", "PAID", false, "2026-09-19T12:41:12.000Z"),
  order("ord_bbbbbbbbbbbbbbb3", "brf_aaaaaaaaaaaaaaa3", "PAYMENT_UNKNOWN", null, "2026-09-19T12:39:13.000Z"),
];

const event = (at: string, kind: string, summary: string, rail: string | null, state: string | null = null): ActivityEvent => ({ at, kind, refId: `ref_${at.slice(14, 19)}`, symbol: "ESx", summary, rail, state } as unknown as ActivityEvent);
const EVENTS = [
  event("2026-09-19T12:41:12.000Z", "ORDER_STATE", "SATAx: PAYMENT_PENDING → PAID", "OKX_X402_TESTNET", "PAID"),
  event("2026-09-19T12:39:13.000Z", "ORDER_STATE", "SATAx: PAYMENT_PENDING → PAYMENT_UNKNOWN", "OKX_X402_TESTNET", "PAYMENT_UNKNOWN"),
  event("2026-09-19T12:38:00.000Z", "QUOTE_ISSUED", "ESx: quote issued at $3.00", "FIXTURE"),
  event("2026-09-18T22:05:47.000Z", "GATE_DECISION", "ESx: Publication gate: PUBLISH", null),
];

const ECONOMICS: DeskEconomics = {
  label: "AGGREGATE", note: "Desk totals. Each investigation is counted once.", rail: "OKX_X402_MAINNET", isTestnet: false,
  investigations: { total: 3, published: 2, rejected: 1, stopped: 0, running: 0 },
  research: { basis: "MEASURED", total: { runs: 3, measuredUsd: 0.171111, upperBoundUsd: 0.012345 }, byOutcome: { PUBLISHED: { runs: 2, measuredUsd: 0.112829, upperBoundUsd: 0 }, REJECTED: { runs: 1, measuredUsd: 0.058282, upperBoundUsd: 0.012345 }, STOPPED: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 }, RUNNING: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 } }, unsold: { runs: 1, measuredUsd: 0.058282, upperBoundUsd: 0 }, runsWithoutAPrice: 1 },
  sales: { paidOrders: 4, revenueOrders: 1, revenueUsd: 3, testOrders: 2, testPaymentsUsd: 6, unverifiedMainnetOrders: 1, unverifiedMainnetUsd: 3, note: POISON },
  delivery: { basis: "ESTIMATED", perPaidOrderUsd: 0.45, estimatedTotalUsd: 1.35, note: POISON }, estimatedContributionUsd: 1.468655, contributionNote: POISON,
};
const SUMMARY: CommerceSummary = { ...summariseOrders([]), source: "SUMMARY", label: "AGGREGATE", note: "Counts of orders by state. No buyer, order or payment identifiers.", rail: "OKX_X402_MAINNET", isTestnet: false, priceUsd: "3.00", total: 4, byState: { PAID: { count: 1, chainVerified: 0 }, DELIVERED: { count: 3, chainVerified: 2 } }, byBrief: [{ briefId: "brf_aaaaaaaaaaaaaaa2", symbol: "ESx", orders: 3, furthestState: "DELIVERED", count: 3, chainVerified: 2 }, { briefId: "brf_aaaaaaaaaaaaaaa3", symbol: "SATAx", orders: 1, furthestState: "PAID", count: 1, chainVerified: 0 }], latest: { at: "2026-09-19T12:41:12.000Z", state: "PAID", rail: "OKX_X402_MAINNET", chainVerified: false, trail: [{ at: "2026-09-19T12:41:10.000Z", from: null, to: "QUOTED" }, { at: "2026-09-19T12:41:11.000Z", from: "QUOTED", to: "PAYMENT_PENDING" }, { at: "2026-09-19T12:41:12.000Z", from: "PAYMENT_PENDING", to: "PAID" }] }, latestReceipt: null };

interface WallProps { health: Health; commerce: CommerceSummary; economics: Feed<DeskEconomics>; focus: RoomInvestigation; chain: RebaseChain; withPrices: boolean; running?: boolean }
function Wall({ health: h, commerce, economics, focus, chain, withPrices, running = false }: WallProps) {
  const signals = ok({ dataMode: "LIVE" as const, signals: SIGNALS });
  const desk: PollResult<Feed<DeskStatus>> = ok({ state: "ok", data: DESK });
  const focusId = focus.investigation.id;
  return (
    <main className="be room">
      <StatusStrip health={ok(h)} deskStatus={desk} now={NOW} />
      <OpportunityField signals={signals} deskStatus={desk} nowMs={NOW.getTime()} />
      <OpportunityBoard health={h} signals={signals} briefs={ok({ briefs: BRIEFS } as BriefListResponse)} commerce={ok({ state: "ok", data: commerce })} focusId={focusId} />
      <InvestigationPanel health={h} onRecord={3} running={running ? 1 : 0} focusId={focusId} focus={ok(focus)} symbol="SATAx" now={NOW} />
      <EvidenceChain investigationsOnRecord={3} focusId={focusId} chain={ok<Feed<ChainResponse>>({ state: "ok", data: { chain, investigationId: focusId } })} live={running} onSale={!running} />
      <GatePanel investigationsOnRecord={3} judged={RUNS} expected={3} listed={LISTED} rows={SIGNALS} briefs={BRIEFS} focusId={focusId} />
      <CommercePanel health={h} commerce={ok({ state: "ok", data: commerce })} economics={ok(economics)} runs={RUNS.map((r) => ({ id: r.investigation.id, symbol: "X", measuredUsd: withPrices ? r.usage.measuredModelCostUsd ?? null : null }))} />
      <ActivityStrip activity={ok<Feed<ActivityResponse>>({ state: "ok", data: { events: EVENTS } as ActivityResponse })} now={NOW} />
    </main>
  );
}
/** an operator's wall: testnet rail, the orders list with receipts, costs and chain figures in full */
const operatorWall = () => render(<Wall health={health("OKX_X402_TESTNET")} commerce={summariseOrders(ORDERS)} economics={{ state: "unavailable" }} focus={RUNS[2]!} chain={CHAIN} withPrices />).container;
/** a visitor's wall on a mainnet desk: aggregates only, costs and chain figures withheld */
const PUBLIC_FOCUS = { ...RUNS[2]!, audience: "PUBLIC", usage: { modelCalls: 3, toolCalls: 10, costsWithheld: true } } as unknown as RoomInvestigation;
const visitorWall = () => render(<Wall health={health("OKX_X402_MAINNET")} commerce={SUMMARY} economics={{ state: "ok", data: ECONOMICS }} focus={PUBLIC_FOCUS} chain={WITHHELD} withPrices={false} />).container;
/** a desk on a test rail that has sold nothing yet, seen by a visitor: no orders, no totals, costs withheld */
const quietWall = (rail: "OKX_X402_TESTNET" | "FIXTURE" = "FIXTURE") => render(<Wall health={health(rail)} commerce={summariseOrders([])} economics={{ state: "unavailable" }} focus={PUBLIC_FOCUS} chain={WITHHELD} withPrices={false} />).container;
/** an investigation in progress, 45 s in: the one place the room works a figure out from the clock (elapsed), and where a projection would tempt */
const RUNNING_FOCUS = {
  ...RUNS[2]!,
  investigation: {
    ...RUNS[2]!.investigation, id: "inv_aaaaaaaaaaaaaaa6", status: "RUNNING", stopReason: null, startedAt: "2026-09-19T16:59:20.000Z", finishedAt: null, briefId: null, gate: null, gateAttempts: null,
    timeline: [
      { seq: 1, at: "2026-09-19T16:59:22.000Z", type: "MODEL_CALL", ok: true, label: `${POISON} plan`, detail: POISON, evidenceId: null },
      { seq: 2, at: "2026-09-19T16:59:31.000Z", type: "TOOL_CALL", ok: true, label: "read_multiplier", detail: POISON, evidenceId: null },
      { seq: 3, at: "2026-09-19T16:59:40.000Z", type: "EVIDENCE", ok: true, label: "EV-CHAIN-AFTER · LIVE", detail: POISON, evidenceId: "EV-CHAIN-AFTER" },
    ],
  },
  usage: { ...RUNS[2]!.usage, modelCalls: 1, toolCalls: 1 },
} as unknown as RoomInvestigation;
const runningWall = () => render(<Wall health={health("OKX_X402_TESTNET")} commerce={summariseOrders(ORDERS)} economics={{ state: "unavailable" }} focus={RUNNING_FOCUS} chain={CHAIN} withPrices running />).container;
const walls = () => [operatorWall(), visitorWall(), quietWall(), runningWall()];

/** what a reader sees: every text node, a space between them (so "5" beside "4 investigated" never reads as 54), whitespace collapsed */
function textOf(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  // only ordinary whitespace is collapsed: the thin space inside "70 922 304" is part of the number
  return parts.join(" ").replace(/[ \t\r\n]+/g, " ").trim();
}
/** everything the wall says: its text, and what a screen reader or a hover is told through labels and titles */
function saidBy(el: Element): string {
  const attrs = [...el.querySelectorAll("[aria-label], [title]")].flatMap((a) => [a.getAttribute("aria-label") ?? "", a.getAttribute("title") ?? ""]);
  return [textOf(el), ...attrs].join(" ").replace(/[ \t\r\n]+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------

describe("1. no invented data: a figure on the wall is a field of an API response, or a count of fields", () => {
  const THIN = formatCount(1000)[1]!;
  const NUMBER = new RegExp(`\\d(?:[\\d.,:${THIN}-]*\\d)?`, "g");
  const tokens = (s: string) => s.match(NUMBER) ?? [];

  /** every way the room may legitimately print a value it was given */
  function allowedFrom(...sources: unknown[]): Set<string> {
    const out = new Set<string>();
    const add = (s: string) => tokens(s).forEach((t) => out.add(t));
    const walk = (v: unknown): void => {
      if (typeof v === "number") { add(String(v)); add(formatCount(v)); for (const d of [1, 2, 4, 6]) { add(v.toFixed(d)); add(formatUsd(v, d)); } add((v / 1000).toFixed(1)); add(String(v / 1000)); }
      else if (typeof v === "string") { add(v); if (!Number.isNaN(Date.parse(v)) && /^\d{4}-\d\d-\d\dT/.test(v)) { add(clockTime(v)); add(fullTime(v)); } if (/^\d+(\.\d+)?$/.test(v)) { add(Number(v).toFixed(6)); for (const d of [2, 4, 6]) add(formatUsd(v, d)); } }
      // a list's length is a count of its records: rows, runs, reads, rules, steps
      else if (Array.isArray(v)) { add(String(v.length)); v.forEach(walk); }
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    sources.forEach(walk);
    return out;
  }

  it("every number on both walls traces to a fixture field; nothing is summed, averaged or made up", () => {
    const allowed = allowedFrom(health("OKX_X402_TESTNET"), health("OKX_X402_MAINNET"), DESK, SIGNALS, BRIEFS, RUNS, RUNNING_FOCUS, LISTED, CHAIN, ORDERS, EVENTS, ECONOMICS, SUMMARY, Object.values(POLL_MS), NOW.toISOString(), new Date(ok(null).updatedAt!).toISOString());
    // scale labels, which are the fields they are read against cut into even steps: the radar's rings and the run chart's axis
    for (const k of [0.25, 0.5, 0.75]) allowed.add(String(DESK.liveWindowHours! * k));
    for (let s = 0; s <= BUDGET.maxLatencyMs / 1000; s += 60) allowed.add(String(s));
    // the figures the room works out itself: a finished run's elapsed seconds (two fields of one response), and a RUNNING run's
    // (the browser's clock, here NOW, minus `startedAt`)
    allowed.add(((Date.parse(RUNS[2]!.investigation.finishedAt!) - Date.parse(RUNS[2]!.investigation.startedAt)) / 1000).toFixed(1));
    allowed.add(((NOW.getTime() - Date.parse(RUNNING_FOCUS.investigation.startedAt)) / 1000).toFixed(1));
    allowed.add("24"); // "runs in 24 h": the window investigationsLast24h is defined over
    // counts of records, each a count of fields: rows by status, orders by state, timeline entries by type; zero is a count too
    const statuses = SIGNALS.map((r) => r.investigation?.status ?? "none");
    for (const n of [0, GateRule.options.length, SIGNALS.filter((r) => r.investigation).length, ...[...new Set(statuses)].map((s) => statuses.filter((x) => x === s).length)]) allowed.add(String(n));
    for (const s of [summariseOrders(ORDERS), SUMMARY]) for (const n of Object.values(paidCounts(s))) allowed.add(String(n));
    for (const f of [RUNS[2]!, RUNNING_FOCUS]) for (const type of new Set(f.investigation.timeline.map((e) => e.type))) allowed.add(String(f.investigation.timeline.filter((e) => e.type === type).length));
    allowedFrom(summariseOrders(ORDERS)).forEach((t) => allowed.add(t));

    for (const wall of walls()) {
      // identifiers are not figures: an abbreviated id is cut out before the numbers are read
      wall.querySelectorAll("span[title]").forEach((el) => { if (/^(sig|brf|quo|ord|inv)_/.test(el.getAttribute("title") ?? "")) el.remove(); });
      for (const t of tokens(saidBy(wall))) expect(allowed, `"${t}" is on the wall but is no field of any response`).toContain(t);
    }
  });

  it("a small count is the count it claims to be: the board's header and the auto desk line, word for word", () => {
    // AVGOx, ESx, SATAx, NVDAx and VTx carry a run; only AVGOx was rejected by the gate (NVDAx was stopped); ESx and SATAx are on sale,
    // VTx's Brief is withdrawn; one order is paid and confirmed, one paid and not
    expect(textOf(operatorWall().querySelector(".room-board .room-meta")!)).toBe("5 investigated · 1 rejected by gate · 2 on sale · 1 paid · 1 paid, not chain-verified");
    expect(textOf(operatorWall().querySelector("[aria-label='Auto desk']")!)).toBe("Auto desk ● ON tick 16:31:07Z · IDLE · SCAN_FAILED every 30 min · 2 runs in 24 h · loop stops at 3 · next 17:31:07Z");
  });

  it("the sums the fixtures invite are not on the wall", () => {
    const sums = new Set([0.058282 + 0.062523 + 0.048195, 0.171111 + 0.012345, 0.071725 + 0.45, 0.062523 + 0.048195, 0.45 + 1.35].flatMap((n) => [n.toFixed(6), n.toFixed(4), n.toFixed(2)]));
    for (const wall of walls()) for (const t of tokens(saidBy(wall))) expect(sums, `"${t}" is a sum of fields`).not.toContain(t);
  });

  it("the room's source holds no sample data and no randomness", () => {
    for (const [file, src] of sources()) expect(src, file).not.toMatch(/Math\.random|faker|lorem|sample data|mock(ed)? (data|order|signal)|placeholder (value|number)/i);
  });
});

describe("2. no trends, rates, averages or percentages from a handful of records", () => {
  it("the only percentages are a signal's own changePct and the bar's stated maximum", () => {
    const pcts = new Set(SIGNALS.map((r) => Math.abs((r.signal.facts as { changePct: number }).changePct).toFixed(4)));
    for (const wall of walls()) {
      const found = [...saidBy(wall).matchAll(/(\d[\d.]*)\s*%/g)].map((m) => m[1]!);
      expect(found.length).toBeGreaterThan(0);
      for (const p of found) expect(pcts, `${p}% is not a signal's changePct`).toContain(p);
    }
  });

  it("no word that turns a few records into a statistic, and no arrow that turns two into a trend", () => {
    for (const wall of walls()) {
      expect(saidBy(wall)).not.toMatch(/\b(average|avg|mean|median|trend|trending|growth|run[- ]rate|per (hour|day|week|call|run)|conversion|win rate|hit rate|success rate|pass rate|on track|forecast|projected|est\.?|estimated time|ETA|to finish|remaining|time left|left today)\b/i);
      expect(saidBy(wall)).not.toMatch(/[↑↓▲▼↗↘]/);
    }
  });
});

describe("3. testnet is never revenue, and green needs the chain", () => {
  it("every payment on a test rail says TESTNET and Not revenue., wherever it shows", () => {
    const wall = operatorWall();
    const strip = wall.querySelector("[aria-label='Payment rail']")!;
    expect(textOf(strip)).toContain("TESTNET");
    expect(textOf(strip)).toContain("Not revenue.");
    const events = [...wall.querySelectorAll(".room-activity-events li")];
    expect(events.length).toBe(EVENTS.length);
    for (const li of events) {
      const onTestRail = /PAID|PAYMENT_UNKNOWN|quote issued/.test(textOf(li));
      expect(textOf(li).includes("TESTNET") && textOf(li).includes("Not revenue."), textOf(li)).toBe(onTestRail);
    }
    // every price drawn with a test rail carries both, inside the amount itself
    const prices = [wall, quietWall("FIXTURE"), quietWall("OKX_X402_TESTNET")].flatMap((w) => { const found = [...w.querySelectorAll(".room-commerce .be-money[data-basis='PRICE']")]; expect(found.length).toBeGreaterThan(0); return found; });
    for (const p of prices) { expect(textOf(p)).toContain("TESTNET"); expect(textOf(p)).toContain("Not revenue."); }
  });

  it("nothing about money is green on a test rail, whatever state the orders reached", () => {
    const wall = operatorWall();
    for (const m of wall.querySelectorAll(".be-money")) expect((m as HTMLElement).style.color).not.toContain("verified");
    expect(wall.querySelector(".room-commerce")!.innerHTML).not.toContain("room-ok");
  });

  it("a PAID or DELIVERED mark is green only when the chain confirmed every order in it", () => {
    const wall = operatorWall();
    const node = (state: string) => [...wall.querySelectorAll(".room-machine .node")].find((g) => g.querySelector(".name")?.textContent === state)!;
    expect(node("DELIVERED").getAttribute("class")).toContain("is-ok");
    expect(node("PAID").getAttribute("class")).toContain("is-warn");
    expect(node("PAID").getAttribute("class")).not.toContain("is-ok");
    // the board: ESx's order was confirmed, SATAx's furthest order (PAID) was not
    const row = (symbol: string) => [...wall.querySelectorAll(".room-board-row")].find((r) => textOf(r).includes(symbol))!;
    expect(row("ESx").querySelectorAll(".room-node.is-pass").length).toBeGreaterThanOrEqual(2);
    expect(row("SATAx").querySelector(".room-node.is-unverified")).not.toBeNull();
    expect([...row("SATAx").querySelectorAll(".room-node.is-pass")].map((n) => textOf(n)).join(" ")).not.toMatch(/PAID|DELIVERED/);
  });

  it("every order, not any order: two of three delivered orders confirmed is still amber, on the diagram and on the board", () => {
    // the visitor's summary has ESx with three DELIVERED orders, two of them confirmed by the chain
    const wall = visitorWall();
    const delivered = [...wall.querySelectorAll(".room-machine .node")].find((g) => g.querySelector(".name")?.textContent === "DELIVERED")!;
    expect(delivered.getAttribute("class")).toContain("is-warn");
    expect(textOf(delivered.querySelector(".mark")!)).toBe("◌");
    const es = [...wall.querySelectorAll(".room-board-row")].find((r) => textOf(r).includes("ESx"))!;
    expect(es.querySelectorAll(".room-node.is-unverified")).toHaveLength(2);
    expect([...es.querySelectorAll(".room-node.is-pass")].map((n) => textOf(n)).join(" ")).not.toMatch(/PAID|DELIVERED/);
    // the same from the orders list: the count and the confirmed count are both of the orders at the furthest state
    const brief = "brf_aaaaaaaaaaaaaaa2";
    const mixed = summariseOrders([ORDERS[0]!, order("ord_bbbbbbbbbbbbbbb4", brief, "DELIVERED", false, "2026-09-19T12:30:14.000Z")]);
    expect(mixed.byBrief[0]).toMatchObject({ furthestState: "DELIVERED", count: 2, chainVerified: 1 });
    expect(boardRows(SIGNALS, BRIEFS, mixed, null).find((r) => r.symbol === "ESx")!.nodes.PAYMENT.state).toBe("unverified");
    // a confirmed order below the furthest state does not make the furthest one confirmed
    const below = summariseOrders([order("ord_bbbbbbbbbbbbbbb5", brief, "DELIVERED", false, "2026-09-19T12:30:14.000Z"), order("ord_bbbbbbbbbbbbbbb6", brief, "PAID", true, "2026-09-19T12:31:14.000Z")]);
    expect(below.byBrief[0]).toMatchObject({ furthestState: "DELIVERED", count: 1, chainVerified: 0 });
    expect(boardRows(SIGNALS, BRIEFS, below, null).find((r) => r.symbol === "ESx")!.nodes.DELIVERY.state).toBe("unverified");
  });

  it("on mainnet, revenue is green only for orders the server counts as revenue; unconfirmed ones are amber and said not to count", () => {
    const wall = visitorWall();
    const commerce = wall.querySelector(".room-commerce")!;
    expect(textOf(commerce)).toContain("1 paid on mainnet, not chain-verified");
    expect(textOf(commerce)).toContain("not counted as revenue");
    const green = [...commerce.querySelectorAll<HTMLElement>(".be-money")].filter((m) => m.style.color.includes("verified"));
    expect(green.map((m) => textOf(m))).toEqual(["$3.00"]);
    // test orders made before the desk moved to mainnet are still test orders
    expect(textOf(commerce)).toMatch(/2 test \$6\.00 TESTNET Not revenue\./);
  });
});

describe("4. an estimate is never verified-green and says so; only <Money> draws money", () => {
  it("every estimated amount carries ≈ and the word, and is amber", () => {
    let seen = 0;
    for (const wall of walls()) for (const m of wall.querySelectorAll<HTMLElement>(".be-money[data-basis='ESTIMATED']")) {
      seen += 1;
      expect(textOf(m)).toContain("≈");
      expect(textOf(m)).toContain("estimated");
      expect(m.style.color).toContain("uncertain");
    }
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it("no dollar sign exists outside a <Money>: not in text, not in a label read aloud, not in a title", () => {
    for (const wall of walls()) {
      const walker = document.createTreeWalker(wall, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.includes("$")) expect(n.parentElement!.closest(".be-money"), `"${n.textContent}"`).not.toBeNull();
      for (const el of wall.querySelectorAll("[aria-label], [title]")) expect(`${el.getAttribute("aria-label") ?? ""}${el.getAttribute("title") ?? ""}`).not.toContain("$");
    }
  });

  it("an amount is money whatever it is written with: no dollar figure of any response appears outside a <Money>, with or without a $", () => {
    const forms = new Set<string>();
    const walk = (v: unknown, key = ""): void => {
      if (/usd$/i.test(key) && (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v))) && Number(v) !== 0) for (const d of [2, 4, 6]) forms.add(Number(v).toFixed(d));
      else if (Array.isArray(v)) v.forEach((x) => walk(x));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    [health("OKX_X402_TESTNET"), DESK, RUNS, RUNNING_FOCUS, LISTED, ORDERS, ECONOMICS, SUMMARY].forEach((s) => walk(s));
    expect(forms.size).toBeGreaterThan(20);
    const THIN = formatCount(1000)[1]!;
    for (const wall of walls()) {
      const bare = wall.cloneNode(true) as Element;
      bare.querySelectorAll(".be-money").forEach((m) => m.remove());
      for (const t of saidBy(bare).match(new RegExp(`\\d(?:[\\d.,${THIN}]*\\d)?`, "g")) ?? []) expect(forms, `"${t}" is a dollar figure outside <Money>`).not.toContain(t);
      expect(saidBy(bare)).not.toMatch(/\b(USD|USDC|USDG|USDT0?|dollars?)\b/);
    }
  });

  it("the source never formats money itself", () => {
    for (const [file, src] of sources()) {
      expect(src, file).not.toMatch(/formatUsd|toLocaleString|Intl\.NumberFormat|currency/);
      // a "$" in JSX text or in a string, as opposed to the "${" of a template
      expect(stripComments(src), file).not.toMatch(/\$(?!\{)[\d\s"'`<]/);
    }
  });
});

describe("5. every provenance badge says its word", () => {
  it("a badge's text is its kind; none is a bare dot or a colour", () => {
    let seen = 0;
    for (const wall of walls()) for (const b of wall.querySelectorAll(".be-badge")) { seen += 1; expect(textOf(b).trim()).toBe(b.getAttribute("data-kind")); }
    expect(seen).toBeGreaterThanOrEqual(10);
  });

  it("a data mode reaches the wall only through the badge", () => {
    for (const [file, src] of sources()) if (/\.mode\b|dataMode/.test(src) && file.endsWith(".tsx") && !/model|useRoomData|data\.ts/.test(file)) expect(src, file).toMatch(/ProvenanceBadge|read\.mode|r\.mode/);
  });
});

describe("6. PAYMENT_UNKNOWN keeps its promise and offers nothing to press", () => {
  it("says \"A retry cannot charge you twice.\" word for word wherever that state is on the wall", () => {
    expect(RETRY_PROMISE).toBe("A retry cannot charge you twice.");
    const wall = operatorWall();
    expect(textOf(wall.querySelector(".room-commerce")!)).toContain(`1 PAYMENT_UNKNOWN · ${RETRY_PROMISE}`);
    const li = [...wall.querySelectorAll(".room-activity-events li")].find((x) => textOf(x).includes("PAYMENT_UNKNOWN"))!;
    expect(textOf(li)).toContain(RETRY_PROMISE);
    // and only there: the promise is not sprinkled on orders whose outcome is known
    expect(textOf(wall).split(RETRY_PROMISE).length - 1).toBe(2);
  });

  it("the room has nothing to press, type into or follow: it cannot pay, retry or reconcile", () => {
    for (const wall of walls()) {
      expect(wall.querySelectorAll("button, a, input, select, textarea, form, [role='button'], [role='link'], [tabindex], [contenteditable], [onclick]")).toHaveLength(0);
      expect(textOf(wall)).not.toMatch(/pay again|retry now|try again|reconcile|click|press/i);
    }
    for (const [file, src] of sources()) expect(stripComments(src), file).not.toMatch(/onClick|onSubmit|<button|<a\s|<input|method:\s*["'`](POST|PUT|PATCH|DELETE)|\/reconcile|\/investigate|\/scan|\/quotes|\/v1\/briefs/);
  });
});

describe("7. confidence is a level and the gate's cap, in words", () => {
  it("both confidence rows hold levels only; no figure, no gauge, no percentage", () => {
    const levels = [...ConfidenceLevel.options, "—"];
    for (const wall of walls()) {
      const rows = [...wall.querySelectorAll(".room-gate-table tfoot tr")].filter((tr) => /CONFIDENCE|CAP/.test(textOf(tr)));
      expect(rows).toHaveLength(2);
      // the cell is the word and nothing else: no bar, no fill, no styled span that could draw the level as a length
      for (const tr of rows) for (const td of tr.querySelectorAll("td")) { expect(levels).toContain(textOf(td).trim()); expect(td.innerHTML).toBe(textOf(td).trim()); }
      for (const node of wall.querySelectorAll(".room-board-row .room-node.is-done")) expect(node.querySelector("[style], .fill, .bar, .room-gauge-track")).toBeNull();
      expect(wall.querySelectorAll("meter, progress, [role='meter'], [role='progressbar']")).toHaveLength(0);
      // on the board, a Brief on sale carries its level as a word
      for (const note of wall.querySelectorAll(".room-board-row .room-node.is-done .note")) expect([...ConfidenceLevel.options, "WITHDRAWN"]).toContain(textOf(note).trim());
    }
  });
});

describe("8. no prose a model, a facilitator or an error wrote ever reaches the wall", () => {
  it("not in text, not in a title, not in a label: headlines, finding details, timeline details and labels, tick details, order reasons, notes, payer and tx", () => {
    for (const wall of walls()) {
      expect(wall.innerHTML).not.toContain(POISON);
      expect(wall.innerHTML).not.toMatch(/623521|ECONNRESET|0xPAYER|0xTX/);
    }
  });

  it("the one timeline label the room prints is the CHECKS count, and nothing else of any entry", () => {
    const wall = operatorWall();
    expect(textOf(wall.querySelector(".room-investigation")!)).toContain("checks: 8 passed, 0 failed, 1 unknown");
    expect(textOf(wall)).not.toMatch(/get_reference_price|EV-POR|Publication gate: REJECT/);
  });

  it("the source never reads a field that holds prose", () => {
    // allowed, and not matched here: the health check's own `synthesis.detail` / `paymentRail.detail` (why a stage cannot run), the enums
    // `lastTick.reason` and `superseded.reason`, the activity feed's code-written `summary`, and the board's own `nodes[s].detail`
    const PROSE = /\.headline\b|briefHeadline|\.notes\b|\.(contribution|revenue)Note\b|\.payer\b|\.txHash\b|facilitatorStatus|lastTick\.detail|\b(e|f|g|entry|finding|event)\.detail\b|\b(e|entry|event)\.reason\b|\.findings\b[^;\n]*\.detail/;
    for (const [file, src] of sources()) expect(stripComments(src), file).not.toMatch(PROSE);
    // nor under another name: destructured, or read by key
    for (const [file, src] of sources()) expect(stripComments(src), file).not.toMatch(/\{[^{}]*\b(headline|summary|notes|contributionNote|revenueNote)\b[^{}]*\}\s*=\s*[^;]*\b(brief|briefs|b|preview)\b|\[\s*["'`](headline|notes|detail)["'`]\s*\]/);
  });

  it("a withdrawn Brief is said to be withdrawn, and nothing it said is shown", () => {
    const wall = operatorWall();
    const vt = [...wall.querySelectorAll(".room-board-row")].find((r) => textOf(r).includes("VTx"))!;
    expect(textOf(vt)).toContain("WITHDRAWN");
    expect(textOf(vt.querySelector(".room-sr")!)).toMatch(/^superseded by v2, CANCELLED: /);
    expect(vt.innerHTML).not.toContain(POISON);
  });
});

describe("9. nothing reads as investment advice", () => {
  const ADVICE = /\b(buy|sell|hold|accumulate|bullish|bearish|outperform|underperform|undervalued|overvalued|upside|downside|price target|target price|recommend\w*|should (you|we|i)|go long|go short|take profit|entry point|invest now|alpha)\b/i;

  it("no wall says what to do with an asset", () => {
    for (const wall of walls()) expect(saidBy(wall).replace(/NO_INVESTMENT_ADVICE/g, "")).not.toMatch(ADVICE);
  });

  it("no string in the source does either", () => {
    for (const [file, src] of sources()) {
      const strings = [...stripComments(src).matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
      for (const s of strings) expect(s.replace(/NO_INVESTMENT_ADVICE/g, ""), `${file}: "${s.slice(0, 60)}"`).not.toMatch(ADVICE);
    }
  });
});

describe("and the things that make the nine hold", () => {
  it("no colour literal in the room: tokens only", () => {
    for (const [file, src] of [...sources(), ...sources(".css")]) expect(stripComments(src).replace(/url\(#[\w-]+\)|&#x?\w+;/g, ""), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });

  it("the whole room asks the API less than once a second, RUNNING investigation included", () => {
    expect((Object.values(POLL_MS) as number[]).reduce((t, ms) => t + 60_000 / ms, 0)).toBeLessThanOrEqual(60);
  });
});

describe("accessibility of the wall", () => {
  it("one main landmark, one h1, and every panel a region named by its own heading", () => {
    for (const wall of walls()) {
      expect(wall.querySelectorAll("main")).toHaveLength(1);
      expect(wall.querySelectorAll("h1")).toHaveLength(1);
      const regions = [...wall.querySelectorAll("section")];
      expect(regions.length).toBeGreaterThanOrEqual(8);
      for (const s of regions) {
        const named = s.getAttribute("aria-label") ?? [...wall.querySelectorAll("[id]")].find((el) => el.id === s.getAttribute("aria-labelledby"))?.textContent;
        expect(named, s.className).toBeTruthy();
      }
      // headings do not skip a level: the h1, then one h2 per panel
      expect(wall.querySelectorAll("h3, h4, h5, h6")).toHaveLength(0);
    }
  });

  it("every drawing says what it shows, or is hidden from a reader who has the words instead", () => {
    for (const wall of walls()) for (const svg of wall.querySelectorAll("svg")) {
      const hidden = svg.closest("[aria-hidden='true']") !== null;
      const said = svg.getAttribute("role") === "img" && (svg.getAttribute("aria-label") ?? "").length > 10;
      expect(hidden || said, svg.getAttribute("class") ?? "svg").toBe(true);
    }
  });

  it("times are machine-readable, the gate matrix is a real table, and a row of the board is said in words", () => {
    for (const wall of walls()) {
      for (const t of wall.querySelectorAll("time")) expect(Number.isNaN(Date.parse(t.getAttribute("datetime") ?? ""))).toBe(false);
      const table = wall.querySelector("table")!;
      expect(table.querySelector("caption")?.textContent).toBeTruthy();
      for (const th of table.querySelectorAll("th")) expect(["col", "row"]).toContain(th.getAttribute("scope"));
      for (const row of wall.querySelectorAll(".room-board-row")) {
        expect(row.querySelector(".col-track")!.getAttribute("aria-hidden")).toBe("true");
        expect(textOf(row.querySelector(".room-sr")!)).toMatch(/SIGNAL .*INVESTIGATION .*GATE /);
      }
    }
  });

  it("news is announced politely and only as additions; errors are the only status messages", () => {
    const wall = operatorWall();
    const live = [...wall.querySelectorAll("[aria-live]")];
    expect(live.map((el) => [el.getAttribute("aria-live"), el.getAttribute("aria-relevant")])).toEqual([["polite", "additions"]]);
    expect(wall.querySelectorAll("[role='status'], [role='alert']")).toHaveLength(0);
  });

  it("state never rests on colour: every node state has its own glyph, every order-state ring that can be green or amber its own mark", () => {
    const wall = operatorWall();
    const glyphOf = new Map<string, Set<string>>();
    for (const n of wall.querySelectorAll(".room-node")) {
      const state = [...n.classList].find((c) => c.startsWith("is-"))!;
      (glyphOf.get(state) ?? glyphOf.set(state, new Set()).get(state)!).add(textOf(n.querySelector(".glyph")!));
    }
    const glyphs = [...glyphOf.values()].map((s) => [...s]);
    for (const g of glyphs) expect(g).toHaveLength(1);
    expect(new Set(glyphs.flat()).size).toBe(glyphs.length);
    for (const g of wall.querySelectorAll(".room-machine .node.is-ok, .room-machine .node.is-warn")) if (/PAID|DELIVERED/.test(textOf(g))) expect(textOf(g.querySelector(".mark")!)).toMatch(/[✓◌]/);
  });

  it("text is 4.5:1 or better and drawn marks 3:1 on every surface the room uses, worked out from the tokens", () => {
    const tokensCss = readFileSync(["apps/web/src/styles/tokens.css", "src/styles/tokens.css"].find((p) => existsSync(p))!, "utf8");
    const dark = tokensCss.slice(0, tokensCss.includes("[data-theme=\"light\"]") ? tokensCss.indexOf("[data-theme=\"light\"]") : undefined);
    const hex = (name: string) => new RegExp(`--${name}: *(#[0-9a-fA-F]{6})`).exec(dark)![1]!;
    const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
    const surfaces = ["canvas", "canvas-raised", "canvas-overlay", "canvas-inset"];
    // and every background a keyframe paints behind text for a moment: new text is read at exactly that moment
    for (const src of sources(".css").map(([, s]) => s)) for (const m of src.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) for (const b of m[1]!.matchAll(/background-color:\s*var\(--([a-z-]+)\)/g)) if (!surfaces.includes(b[1]!)) surfaces.push(b[1]!);

    const css = sources(".css").map(([, src]) => stripComments(src)).join("\n");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
    const text = new Set<string>(), marks = new Set<string>();
    for (const r of rules) {
      for (const m of r.body.matchAll(/(?:^|[;\s])(color|fill|stroke):\s*var\(--([a-z-]+)\)/g)) {
        const isText = m[1] === "color" ? !/\.glyph\b/.test(r.selector) : m[1] === "fill" && /\.(tick|lane|name|count|ring|display|mark|m-glyph)\b|text\b/.test(r.selector);
        (isText ? text : marks).add(m[2]!);
      }
    }
    // rules, borders and the inside of a ring are not information: what they separate or hold is
    for (const t of ["line", "line-strong", "canvas", "canvas-raised", "canvas-overlay", "canvas-inset"]) marks.delete(t);
    expect([...text].sort()).toEqual(["ink", "ink-secondary", "invalid", "uncertain", "verified"]);
    for (const t of text) for (const s of surfaces) expect(ratio(t, s), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
    for (const t of marks) for (const s of surfaces) expect(ratio(t, s), `${t} on ${s}`).toBeGreaterThanOrEqual(3);
  });

  it("where the board's words give way, its glyphs keep a key and its columns keep a name", () => {
    const wall = operatorWall();
    const head = wall.querySelector(".room-board-head .col-track")!;
    // a four-letter name per stage for a phone, beside the full one
    expect([...head.querySelectorAll(".tiny")].map((a) => a.textContent)).toEqual(["SIG", "INV", "GATE", "BRF", "PAY", "DLV", "ECO"]);
    const key = textOf(wall.querySelector(".room-board-key")!);
    for (const glyph of ["○", "●", "◐", "◔", "✓", "◌", "✕", "?"]) expect(key).toContain(glyph);
    expect(key).toContain("◌ paid, not chain-verified");
    const css = stripComments(sources(".css").map(([, s]) => s).join("\n"));
    const narrower = css.slice(css.indexOf("@media (max-width: 1899px)"));
    expect(narrower).toMatch(/\.room-board-key\s*\{\s*display:\s*block/);
    // two columns and fewer: a rule's name wraps rather than lose its last letters
    const tablet = css.slice(css.indexOf("@media (max-width: 1199px)"), css.indexOf("@media", css.indexOf("@media (max-width: 1199px)") + 5));
    expect(tablet).toMatch(/\.room-gate-table \.rule\s*\{[^}]*white-space:\s*normal/);
  });

  it("no type under 11px, and the display face is never the only carrier of a figure's meaning", () => {
    const css = sources(".css").map(([, src]) => stripComments(src)).join("\n");
    for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
    expect(css).not.toMatch(/font-size:\s*[\d.]+(em|rem|%|vw)/);
  });
});

// ---------------------------------------------------------------------------------------------

function sources(ext: ".tsx" | ".css" = ".tsx"): [string, string][] {
  // the suite runs with --root apps/web from the repository root, or from apps/web itself
  const root = ["apps/web/src/situation", "src/situation"].find((p) => existsSync(p))!;
  return readdirSync(root).filter((f) => (ext === ".css" ? f.endsWith(".css") : /\.tsx?$/.test(f))).map((f) => [f, readFileSync(`${root}/${f}`, "utf8")]);
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}
