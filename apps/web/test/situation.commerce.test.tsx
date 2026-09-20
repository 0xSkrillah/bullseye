import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BriefPreview, GateResult, Order } from "@bullseye/domain";
import type { Health, OrderRow } from "../src/lib/api";
import type { PollResult } from "../src/lib/usePoll";
import { paidCounts, resetRoutesForTest, room, summariseOrders, type ChainResponse, type CommerceSummary, type DeskEconomics, type Feed, type RebaseChain, type RoomInvestigation } from "../src/situation/data";
import { CommercePanel } from "../src/situation/CommercePanel";
import { EvidenceChain } from "../src/situation/EvidenceChain";
import { GatePanel } from "../src/situation/GatePanel";
import { InvestigationPanel } from "../src/situation/InvestigationPanel";

const ok = <T,>(data: T): PollResult<T> => ({ data, error: null, updatedAt: Date.parse("2026-09-19T13:36:53Z") });
const pending = <T,>(): PollResult<T> => ({ data: null, error: null, updatedAt: null });
/** what a reader sees: tags and React's text-boundary comments removed */
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

const HEALTH = (ready = true): Health => ({
  service: "bullseye", dataSource: { mode: "LIVE", asOf: "2026-09-19T13:36:53Z" }, synthesis: { provider: "openrouter", model: "openrouter/auto", ready: true, detail: "" },
  paymentRail: { rail: "OKX_X402_TESTNET", network: "eip155:1952", ready, detail: ready ? "" : "Failed to initialize", payTo: null, isTestnet: true }, priceUsd: "3.00",
  budget: { maxVariableCostUsd: 0.6, maxModelCalls: 6, maxToolCalls: 14, maxLatencyMs: 180000, maxOutputTokensPerCall: 8000 },
});

// an order as GET /api/orders returns it today; the trail is the first settlement's (timeout, then found on chain)
const order = (state: Order["state"], chainVerified: boolean | null, extra: Partial<Order> = {}): OrderRow => ({
  order: {
    id: "ord_8a2102084ad69dab", quoteId: "quo_89c3dfefb6dd5b2f", state, updatedAt: "2026-09-18T22:05:47.000Z",
    terms: { briefId: "brf_a790c648a87d52dd", rail: "OKX_X402_TESTNET", priceUsd: "3.00" },
    payment: chainVerified === null ? null : { chainVerified, payer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", txHash: "0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a" },
    events: [
      { seq: 1, at: "2026-09-18T22:05:40.000Z", from: null, to: "QUOTED", reason: "quote issued" },
      { seq: 2, at: "2026-09-18T22:05:41.000Z", from: "QUOTED", to: "PAYMENT_PENDING", reason: "authorization received" },
      { seq: 3, at: "2026-09-18T22:05:43.000Z", from: "PAYMENT_PENDING", to: "PAYMENT_UNKNOWN", reason: "facilitator answered timeout" },
      { seq: 4, at: "2026-09-18T22:05:46.000Z", from: "PAYMENT_UNKNOWN", to: "PAID", reason: "transfer found on chain" },
    ],
    ...extra,
  } as unknown as Order,
  receipt: { rail: "OKX_X402_TESTNET", countsAsRevenue: false, priceUsd: 3, measuredTotalUsd: 0.071725, estimatedTotalUsd: 0.45, estimatedContributionUsd: 2.478275 } as unknown as OrderRow["receipt"],
  briefHeadline: null,
});
const feed = (rows: OrderRow[]): PollResult<Feed<CommerceSummary>> => ok({ state: "ok", data: summariseOrders(rows) });
/** the shape GET /api/commerce/summary answers a public visitor with: labelled, and without a receipt */
const publicSummary = (rows: OrderRow[]): PollResult<Feed<CommerceSummary>> => ok({ state: "ok", data: { ...summariseOrders(rows), source: "SUMMARY", label: "AGGREGATE", note: "Counts of orders by state. No buyer, order or payment identifiers. These are test payments: not revenue, and not evidence of demand.", latestReceipt: null } });

describe("orders reach the room as counts", () => {
  it("keeps states, times and the chain flag, and nothing that names a buyer, an order or a payment", () => {
    const s = summariseOrders([order("PAID", true), order("QUOTED", null, { id: "ord_other" } as Partial<Order>)]);
    expect(s.total).toBe(2);
    expect(s.byState.PAID).toEqual({ count: 1, chainVerified: 1 });
    expect(s.byBrief).toEqual([{ briefId: "brf_a790c648a87d52dd", symbol: null, orders: 2, furthestState: "PAID", count: 1, chainVerified: 1 }]);
    expect(s.latest?.trail.map((t) => t.to)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID"]);
    expect(paidCounts(s)).toEqual({ paid: 1, verified: 1 });
    const json = JSON.stringify(s);
    for (const secret of ["ord_", "quo_", "0x70997970", "0xa2f4058c", "payer", "txHash", "facilitator answered"]) expect(json).not.toContain(secret);
  });

  describe("the adapter", () => {
    const calls: { url: string; auth: string | null }[] = [];
    const serve = (routes: Record<string, [number, unknown]>) => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const [status, body] = routes[url] ?? [404, "<pre>Cannot GET</pre>"];
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }));
    beforeEach(() => { calls.length = 0; resetRoutesForTest(); sessionStorage.clear(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it("reads the summary where the server has it", async () => {
      serve({ "/api/commerce/summary": [200, { label: "AGGREGATE", note: "n", rail: "OKX_X402_TESTNET", isTestnet: true, priceUsd: "3.00", total: 0, byState: {}, byBrief: [], latest: null, latestReceipt: null }] });
      const out = await room.commerce();
      expect(out).toMatchObject({ state: "ok", data: { source: "SUMMARY", label: "AGGREGATE", total: 0 } });
      expect(calls.map((c) => c.url)).toEqual(["/api/commerce/summary"]);
    });

    it("never asks an older server for the summary: it folds GET /api/orders instead", async () => {
      serve({ "/api/orders": [200, { orders: [order("DELIVERED", true)] }] });
      const out = await room.commerce(false);
      expect(out).toMatchObject({ state: "ok", data: { source: "ORDERS", total: 1 } });
      expect(calls.map((c) => c.url)).toEqual(["/api/orders"]);
    });

    it("if the summary is missing after all, it falls back and does not ask again for a minute", async () => {
      serve({ "/api/orders": [200, { orders: [order("DELIVERED", true)] }] });
      let t = 1_000_000;
      const first = await room.commerce(true, () => t);
      expect(first).toMatchObject({ state: "ok", data: { source: "ORDERS", total: 1 } });
      await room.commerce(true, () => (t += 6_000));
      expect(calls.map((c) => c.url)).toEqual(["/api/commerce/summary", "/api/orders", "/api/orders"]);
      await room.commerce(true, () => (t += 60_000));
      expect(calls.map((c) => c.url).slice(3)).toEqual(["/api/commerce/summary", "/api/orders"]);
    });

    it("an orders list a visitor may not read is 'not known', never 'no orders'", async () => {
      serve({ "/api/orders": [403, { error: "operator_token_required" }] });
      await expect(room.commerce()).resolves.toEqual({ state: "unavailable" });
    });

    it("gives every request a deadline, so one that never answers becomes 'no answer' instead of stopping its poll", async () => {
      const seen: (AbortSignal | null | undefined)[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { seen.push(init?.signal); return new Response("{}", { status: 200 }); }));
      await room.health();
      if (typeof AbortSignal.timeout === "function") expect(seen[0]).toBeInstanceOf(AbortSignal);
      expect(seen).toHaveLength(1);
    });

    it("sends the viewer token as a header when this browser holds one, and only then", async () => {
      serve({ "/api/health": [200, {}] });
      await room.health();
      sessionStorage.setItem("bullseye.viewerToken", "not-a-real-token");
      await room.health();
      expect(calls.map((c) => c.auth)).toEqual([null, "Bearer not-a-real-token"]);
      expect(calls.every((c) => !c.url.includes("not-a-real-token"))).toBe(true);
    });
  });
});

describe("payment and delivery panel", () => {
  it("no orders is a zero in every state; a read that has not answered, or may not be read, is not a zero", () => {
    const none = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([])} />);
    expect(none).toContain("0 ORDERS");
    for (const s of ["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED", "PAYMENT_FAILED", "PAID", "DELIVERING", "DELIVERY_FAILED", "DELIVERED"]) expect(none).toContain(`${s} 0`);
    expect(none).toContain("no orders yet");
    const waiting = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={pending()} />);
    expect(waiting).toContain("counts not known yet");
    expect(waiting).not.toContain("0 ORDERS");
    expect(waiting).not.toContain("no orders yet");
    const closed = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={ok({ state: "unavailable" })} />);
    expect(closed).toContain("order counts not available to a visitor");
    expect(closed).not.toContain("0 ORDERS");
  });

  it("a list that came back full is a floor, and says so", () => {
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed(Array.from({ length: 50 }, () => order("QUOTED", null)))} />);
    expect(html).toContain("50+ ORDERS");
    expect(html).toContain("newest orders only");
    expect(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("QUOTED", null)])} />)).toContain("1 ORDER<");
  });

  it("a PAID or DELIVERED node is green only when the chain confirmed every order in it", () => {
    expect(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("PAID", true)])} />)).toContain("node is-ok");
    const unverified = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("DELIVERED", false)])} />);
    expect(unverified).not.toContain("node is-ok");
    expect(unverified).toContain("node is-warn");
    expect(text(unverified)).toContain("not chain-verified");
    // every order, not any order: one unconfirmed payment among confirmed ones keeps the node amber
    const mixed = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("PAID", true), order("PAID", false, { id: "ord_b" } as Partial<Order>)])} />);
    expect(mixed).not.toContain("node is-ok");
    expect(mixed).toContain("node is-warn");
    // and the difference is a glyph and a spoken count, never the colour alone
    expect(mixed).toMatch(/class="mark"[^>]*>◌</);
    expect(mixed).toContain("PAID 2 (1 chain-verified)");
    expect(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("PAID", true)])} />)).toMatch(/class="mark"[^>]*>✓</);
  });

  it("draws the newest order's own path over the state machine, from its trail", () => {
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("PAID", true)])} />);
    expect(html.match(/class="edge is-walked"/g)).toHaveLength(3);
    expect(html).toContain("newest order went QUOTED, then PAYMENT_PENDING, then PAYMENT_UNKNOWN, then PAID");
    expect(text(html)).toContain("4 steps");
  });

  it("PAYMENT_UNKNOWN says a retry cannot charge twice, word for word, and the room offers nothing to press", () => {
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("PAYMENT_UNKNOWN", null)])} />);
    expect(html).toContain("A retry cannot charge you twice.");
    expect(html).not.toMatch(/<button|<a |<input|onclick/i);
    expect(text(html)).not.toMatch(/pay again|retry now|reconcile/i);
    // an older unknown order keeps the promise on screen after a newer order took its place as the newest
    const older = order("PAYMENT_UNKNOWN", null, { id: "ord_older", updatedAt: "2026-09-18T22:00:00.000Z" } as Partial<Order>);
    const both = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([older, order("DELIVERED", true)])} />);
    expect(text(both)).toContain("◌ 1 PAYMENT_UNKNOWN · A retry cannot charge you twice.");
    expect(text(both)).toContain("newest order · DELIVERED");
  });

  it("prints what the server says about an aggregate, and why nothing can be charged when the rail is down", () => {
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH(false)} commerce={publicSummary([])} />);
    expect(html).toContain("AGGREGATE · ");
    expect(html).toContain("These are test payments: not revenue, and not evidence of demand.");
    // why nothing can be charged, and no status code: the room never calls the paid resource, so no figure of its answers is on the wall
    expect(text(html)).toContain("✕ rail not ready · nothing can be charged");
    expect(html).not.toContain("503");
    expect(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={publicSummary([])} />)).not.toContain("rail not ready");
  });
});

// GET /api/desk/economics as the FIXES branch answers it, with the three real runs of 2026-09-19 and one test payment
const ECONOMICS: DeskEconomics = {
  label: "AGGREGATE", note: "Desk totals. Each investigation is counted once, including rejected, stopped and unsold work.", rail: "OKX_X402_TESTNET", isTestnet: true,
  investigations: { total: 3, published: 2, rejected: 1, stopped: 0, running: 0 },
  research: {
    basis: "MEASURED model cost as reported by the provider", total: { runs: 3, measuredUsd: 0.169, upperBoundUsd: 0 },
    byOutcome: { PUBLISHED: { runs: 2, measuredUsd: 0.110718, upperBoundUsd: 0 }, REJECTED: { runs: 1, measuredUsd: 0.058282, upperBoundUsd: 0 }, STOPPED: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 }, RUNNING: { runs: 0, measuredUsd: 0, upperBoundUsd: 0 } },
    unsold: { runs: 2, measuredUsd: 0.120805, upperBoundUsd: 0 }, runsWithoutAPrice: 0,
  },
  sales: { paidOrders: 1, revenueOrders: 0, revenueUsd: 0, testOrders: 1, testPaymentsUsd: 3, note: "Every paid order so far used test tokens or the fixture rail. Revenue is zero." },
  delivery: { basis: "ESTIMATED", perPaidOrderUsd: 0.45, estimatedTotalUsd: 0.45, note: "Planning allowances per paid order." },
  estimatedContributionUsd: -0.619, contributionNote: "Estimate.",
};

describe("economics", () => {
  const draw = (e: DeskEconomics) => renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={publicSummary([order("DELIVERED", true)])} economics={ok({ state: "ok", data: e })} />);

  it("keeps measured, upper-bound and estimated apart, each through Money, and never adds them up", () => {
    const html = draw({ ...ECONOMICS, research: { ...ECONOMICS.research, total: { runs: 3, measuredUsd: 0.169, upperBoundUsd: 0.12 } } });
    expect(text(html)).toContain("$0.169000 measured");
    expect(text(html)).toContain("+ ≈ $0.120000 estimated upper bound, not in the bar");
    expect(text(html)).toContain("delivery ≈ $0.45 estimated");
    expect(text(html)).toContain("contribution, not profit ≈ −$0.62 estimated");
    expect(html).not.toContain("$0.289");
    expect(text(html)).not.toMatch(/\b(total|net|margin)\b/i);
    expect(draw(ECONOMICS)).not.toContain("upper bound");
  });

  it("a test payment is never revenue and never green; revenue turns green only when the server counts a revenue order", () => {
    const html = draw(ECONOMICS);
    expect(text(html)).toContain("1 test $3.00 TESTNET Not revenue.");
    expect(text(html)).toContain("0 revenue orders $0.00");
    expect(html).not.toContain("var(--verified)");
    const real = draw({ ...ECONOMICS, rail: "OKX_X402_MAINNET", isTestnet: false, sales: { ...ECONOMICS.sales, revenueOrders: 1, revenueUsd: 3, testOrders: 0, testPaymentsUsd: 0 } });
    expect(real).toContain("var(--verified)");
    expect(real).not.toContain("TESTNET<");
    // test orders stay test orders after the desk moves to mainnet
    const moved = draw({ ...ECONOMICS, rail: "OKX_X402_MAINNET", isTestnet: false });
    expect(text(moved)).toContain("1 test $3.00 TESTNET Not revenue.");
    // a mainnet payment the chain has not confirmed is neither revenue nor green
    const unconfirmed = draw({ ...ECONOMICS, rail: "OKX_X402_MAINNET", isTestnet: false, sales: { ...ECONOMICS.sales, testOrders: 0, testPaymentsUsd: 0, unverifiedMainnetOrders: 2, unverifiedMainnetUsd: 6 } });
    expect(text(unconfirmed)).toContain("◌ 2 paid on mainnet, not chain-verified $6.00 · not counted as revenue");
    expect(unconfirmed).not.toContain("var(--verified)");
  });

  it("a mainnet receipt is green only when the chain confirmed the payment", () => {
    const row = (chainVerified: boolean) => {
      const r = order("DELIVERED", chainVerified);
      (r.order.terms as { rail: string }).rail = "OKX_X402_MAINNET";
      Object.assign(r.receipt, { rail: "OKX_X402_MAINNET", countsAsRevenue: true });
      return renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([r])} economics={ok({ state: "unavailable" })} />);
    };
    expect(row(true)).toContain("var(--verified)");
    expect(row(false)).not.toContain("var(--verified)");
  });

  it("splits the measured bar by how the run ended, and says when fixture runs have no price", () => {
    const html = draw(ECONOMICS);
    expect(html).toMatch(/seg is-published" style="width:65.5%"/);
    expect(html).toMatch(/seg is-rejected" style="width:34.5%"/);
    expect(text(html)).toContain("2 published · 1 rejected");
    expect(html).toMatch(/class="sw is-published"/);
    expect(text(draw({ ...ECONOMICS, research: { ...ECONOMICS.research, runsWithoutAPrice: 1 } }))).toContain("1 unpriced");
  });

  it("without desk totals it draws measured cost per run against the ceiling, and nothing at all when costs are withheld", () => {
    const runs = [{ id: "inv_a", symbol: "AVGOx", measuredUsd: 0.058282 }, { id: "inv_b", symbol: "ESx", measuredUsd: 0.062523 }];
    const bars = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={publicSummary([])} economics={ok({ state: "unavailable" })} runs={runs} />);
    expect(text(bars)).toContain("AVGOx $0.058282");
    expect(bars).toMatch(/seg is-published" style="width:9.7%"/);
    const withheld = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={publicSummary([])} economics={ok({ state: "unavailable" })} runs={runs.map((r) => ({ ...r, measuredUsd: null }))} />);
    expect(withheld).toContain("desk totals not available yet");
    expect(withheld).not.toContain("room-eco-sym");
    expect(text(withheld)).toContain("price per Brief $3.00 TESTNET Not revenue.");
  });

  it("a receipt says something about money only when its order was paid, and never calls a mainnet order a test payment", () => {
    const draw = (row: OrderRow) => text(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([row])} economics={ok({ state: "unavailable" })} />));
    for (const state of ["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAYMENT_FAILED", "RECONCILIATION_REQUIRED"] as const) {
      expect(draw(order(state, null))).not.toMatch(/receipt|contribution|measured cost/);
    }
    const mainnet = order("PAID", false);
    (mainnet.order.terms as { rail: string }).rail = "OKX_X402_MAINNET";
    (mainnet.receipt as { rail: string }).rail = "OKX_X402_MAINNET";
    expect(draw(mainnet)).toContain("· not counted as revenue, not profit");
    expect(draw(mainnet)).not.toContain("test payment");
  });

  it("a run on the test double has no measured cost: the word FIXTURE stands where a zero would", () => {
    const row = order("DELIVERED", true);
    (row.receipt as unknown as { measuredTotalUsd: number; usage: { usageIsFixture: boolean } }).measuredTotalUsd = 0;
    (row.receipt as unknown as { usage: { usageIsFixture: boolean } }).usage = { usageIsFixture: true };
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([row])} economics={ok({ state: "unavailable" })} />);
    expect(text(html)).toContain("FIXTURE model cost not measured");
    expect(html).not.toContain("data-basis=\"MEASURED\"");
    const bars = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([])} economics={ok({ state: "unavailable" })} runs={[{ id: "inv_q", symbol: "QSRx", measuredUsd: 0, fixture: true }]} />);
    expect(text(bars)).toContain("FIXTURE 1 run on the test double · model cost not measured");
    expect(bars).not.toContain("data-basis=\"MEASURED\"");
    expect(bars).not.toContain("room-eco-sym");
  });

  it("a receipt from the summary route, which does not say whether the run used the test double, never prints a zero as measured", () => {
    const summary = (measuredTotalUsd: number): PollResult<Feed<CommerceSummary>> => {
      const s = summariseOrders([order("DELIVERED", true)]);
      return ok({ state: "ok", data: { ...s, source: "SUMMARY", latestReceipt: { ...s.latestReceipt!, measuredTotalUsd, usageIsFixture: undefined } } });
    };
    const zero = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={summary(0)} economics={ok({ state: "unavailable" })} />);
    expect(text(zero)).toContain("model cost not reported");
    expect(zero).not.toContain("data-basis=\"MEASURED\"");
    // a real figure is still a real figure
    expect(text(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={summary(0.071725)} economics={ok({ state: "unavailable" })} />))).toContain("measured cost $0.071725");
  });

  it("order counts that stopped answering stay up as the last answer, and say how old they are", () => {
    const failing: PollResult<Feed<CommerceSummary>> = { data: { state: "ok", data: summariseOrders([order("PAID", true)]) }, error: "api 500", updatedAt: Date.parse("2026-09-19T12:00:07Z") };
    expect(text(renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={failing} />))).toContain("✕ no answer (api 500) · last 12:00:07Z");
  });

  it("desk totals that stopped answering stay up as the last answer, and say so", () => {
    const failing: PollResult<Feed<DeskEconomics>> = { data: { state: "ok", data: ECONOMICS }, error: "500", updatedAt: Date.parse("2026-09-19T13:36:53Z") };
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={publicSummary([])} economics={failing} />);
    expect(text(html)).toContain("✕ no answer from /api/desk/economics · last 13:36:53Z");
  });

  it("an older server's newest receipt keeps its three figures apart", () => {
    const html = renderToStaticMarkup(<CommercePanel health={HEALTH()} commerce={feed([order("DELIVERED", true)])} economics={ok({ state: "unavailable" })} />);
    expect(text(html)).toContain("price $3.00 TESTNET Not revenue.");
    expect(text(html)).toContain("measured cost $0.071725");
    expect(text(html)).toContain("allowances ≈ $0.45 estimated");
    // the receipt is a test payment's: the contribution worked out from it says so
    expect(text(html)).toContain("contribution ≈ $2.48 estimated · on a test payment, not profit");
    expect(html).not.toContain("var(--verified)");
  });
});

const finding = (rule: string, passed: boolean) => ({ rule, passed, detail: `DETAIL-OF-${rule}: "623521" not found in evidence` });
const RULES = ["SCHEMA", "INVESTIGATION_COMPLETED", "MANDATORY_EVIDENCE_PRESENT", "EVIDENCE_FRESH", "EVIDENCE_MODE_ALLOWED", "CLAIMS_CITE_KNOWN_EVIDENCE", "QUANTITIES_RESOLVE_TO_EVIDENCE", "NUMBERS_IN_TEXT_ARE_EVIDENCED", "NO_INVESTMENT_ADVICE", "FAILED_CHECKS_DISCLOSED", "CONFIDENCE_WITHIN_CAP"];
const gate = (decision: "PUBLISH" | "REJECT", failed: string[] = [], only?: string[]): GateResult => ({ decision, evaluatedAt: "2026-09-19T10:25:13.330Z", gateVersion: "1.0.0", confidenceCap: "HIGH", findings: (only ?? RULES).map((r) => finding(r, !failed.includes(r))) } as unknown as GateResult);
const run = (id: string, final: GateResult, attempts: GateResult[] | null, briefId: string | null, gates: number): RoomInvestigation => ({
  investigation: { id, signalId: "sig_x", status: final.decision === "PUBLISH" ? "PUBLISHED" : "REJECTED", stopReason: "COMPLETED", startedAt: "2026-09-19T10:23:01.385Z", finishedAt: "2026-09-19T10:25:13.334Z", briefId, gate: final, gateAttempts: attempts, budgetAtStart: null,
    timeline: Array.from({ length: gates }, (_, i) => ({ seq: i + 1, at: "2026-09-19T10:24:49.049Z", type: "GATE" as const, ok: i === gates - 1 && final.decision === "PUBLISH", label: "Publication gate", detail: "DETAIL-IN-TIMELINE", evidenceId: null })) },
  budget: HEALTH().budget, usage: { modelCalls: 5, toolCalls: 10, measuredModelCostUsd: 0.062523 },
});
const LISTED = [["inv_sata", "SATAx", 1], ["inv_es", "ESx", 2], ["inv_avgo", "AVGOx", 2]].map(([id, symbol, draftsJudged]) => ({ id, symbol, draftsJudged } as never));
const BRIEFS = [{ id: "brf_es", confidence: "HIGH" }, { id: "brf_sata", confidence: "MEDIUM" }] as unknown as BriefPreview[];

describe("gate matrix", () => {
  // the three real runs of 2026-09-19: AVGOx rejected on SCHEMA (the gate stops early), ESx published after one rejected draft, SATAx published first time
  const avgo = run("inv_avgo", gate("REJECT", ["SCHEMA"], ["INVESTIGATION_COMPLETED", "SCHEMA"]), null, null, 2);
  const es = run("inv_es", gate("PUBLISH"), null, "brf_es", 2);
  const sata = run("inv_sata", gate("PUBLISH"), null, "brf_sata", 1);
  const draw = (judged: RoomInvestigation[], focusId = "inv_sata") => renderToStaticMarkup(<GatePanel investigationsOnRecord={3} judged={judged} listed={LISTED} briefs={BRIEFS} focusId={focusId} />);

  it("says when a judged run the list names has not been read yet, or could not be", () => {
    const some = (extra: { expected: number; error?: string | null }) => renderToStaticMarkup(<GatePanel investigationsOnRecord={3} judged={[sata]} listed={LISTED} briefs={BRIEFS} focusId="inv_sata" {...extra} />);
    expect(some({ expected: 3 })).toContain("Fetching…");
    expect(some({ expected: 3, error: "500" })).toContain("✕ no answer (500)");
    expect(some({ expected: 1 })).toContain("rules · code, not model");
  });

  it("is rules down, runs across, with the verdict as a word and a rule the gate never reached left unjudged", () => {
    const html = draw([avgo, es, sata]);
    expect(html.match(/<th scope="col" class="run/g)).toHaveLength(3);
    expect(text(html)).toContain("AVGOx REJECT");
    // the focused run is pointed at, as on the board, and said to be the one the other panels show
    expect(text(html)).toContain("▸ SATAx PUBLISH , the run shown in the investigation panel");
    const schema = html.slice(html.indexOf(">SCHEMA<"), html.indexOf(">INVESTIGATION_COMPLETED<"));
    expect(schema.match(/✕|✓/g)).toEqual(["✕", "✓", "✓"]);
    const fresh = html.slice(html.indexOf(">EVIDENCE_FRESH<"), html.indexOf(">EVIDENCE_MODE_ALLOWED<"));
    expect(fresh.match(/·|✓/g)).toEqual(["·", "✓", "✓"]);
    expect(fresh).toContain("not evaluated");
    expect(html).toContain("run is-focus");
  });

  it("shows one glyph per draft when the server kept every draft, and says so when it kept only the last", () => {
    const kept = run("inv_es", gate("PUBLISH"), [gate("REJECT", ["NUMBERS_IN_TEXT_ARE_EVIDENCED"]), gate("PUBLISH")], "brf_es", 2);
    const html = draw([kept], "inv_es");
    const cell = html.slice(html.indexOf(">NUMBERS_IN_TEXT_ARE_EVIDENCED<"), html.indexOf(">NO_INVESTMENT_ADVICE<"));
    expect(cell.match(/✕|✓/g)).toEqual(["✕", "✓"]);
    expect(cell).toContain("failed, then passed");
    expect(html).not.toContain("for the last draft only");
    const lost = draw([es]);
    expect(text(lost)).toContain("DRAFTS JUDGED 2*");
    expect(text(lost)).toContain("* findings kept for the last draft only");
  });

  it("confidence is a level and a cap, in words, and a finding's own words never reach the wall", () => {
    const html = draw([avgo, es, sata]);
    expect(text(html)).toContain("CONFIDENCE CLAIMED — HIGH MEDIUM");
    expect(text(html)).toContain("CAP THE GATE ALLOWED HIGH HIGH HIGH");
    expect(html).not.toMatch(/DETAIL-OF-|DETAIL-IN-TIMELINE|623521/);
    // the two confidence rows are the last thing in the panel: words only, no figure, no gauge
    const rows = text(html.slice(html.indexOf(">CONFIDENCE CLAIMED<")));
    expect(rows).not.toMatch(/[\d%]/);
    expect(html).not.toMatch(/<(meter|progress)\b/);
  });
});

describe("what a public visitor is not told is shown as withheld, never as zero", () => {
  it("costs: the gauge says withheld, the call counts stay, and no figure is invented", () => {
    const pub: RoomInvestigation = { ...run("inv_es", gate("PUBLISH"), null, "brf_es", 2), audience: "PUBLIC", usage: { modelCalls: 5, toolCalls: 10, costsWithheld: true } };
    const html = renderToStaticMarkup(<InvestigationPanel health={HEALTH()} onRecord={3} running={0} focusId="inv_es" focus={ok(pub)} symbol="ESx" now={new Date("2026-09-19T13:36:53Z")} />);
    expect(html).toContain("COST · WITHHELD");
    expect(text(html)).toContain("withheld / $0.60");
    expect(text(html)).toContain("5 / 6");
    expect(text(html)).toContain("public view");
    // a visitor's CHECKS label is a fixed sentence, not counts: it is printed as it comes, never parsed and never prefixed
    const fixed: RoomInvestigation = { ...pub, investigation: { ...pub.investigation, timeline: [...pub.investigation.timeline.filter((e) => e.type !== "CHECKS"), { seq: 99, at: pub.investigation.startedAt, type: "CHECKS", ok: true, label: "Consistency checks computed", detail: null, evidenceId: null }] } };
    const said = text(renderToStaticMarkup(<InvestigationPanel health={HEALTH()} onRecord={3} running={0} focusId="inv_es" focus={ok(fixed)} symbol="ESx" now={new Date("2026-09-19T13:36:53Z")} />));
    expect(said).toContain("Consistency checks computed · public view");
    expect(said).not.toContain("checks: Consistency");
    expect(html).not.toMatch(/NaN|undefined|\$0\.000000/);
    expect(html).not.toContain("data-basis=\"MEASURED\"");
  });

  it("chain: the slots and their modes stay, the blocks and values do not, and the panel says where they are", () => {
    const chain: RebaseChain = {
      withheld: true, network: "eip155:196", token: "0x7c74", symbol: "SATAx", issuer: { multiplierOld: "1.046963274862202", multiplierNew: "1.0475034538939607", effectiveTimeUtc: "2026-09-19T00:30:00.000Z" },
      reads: (["BEFORE", "AFTER", "HEAD"] as const).map((key) => ({ key, evidenceId: `EV-CHAIN-${key}`, blockNumber: null, blockTime: null, multiplier: null, mode: "LIVE" })),
      activation: { evidenceId: "EV-CHAIN-ACTIVATION", blockNumber: null, blockTime: null, mode: "LIVE" }, activationSearched: true,
    };
    const draw = (props: { live?: boolean; onSale?: boolean | null; withdrawn?: boolean }) => renderToStaticMarkup(<EvidenceChain investigationsOnRecord={3} focusId="inv_sata" chain={ok<Feed<ChainResponse>>({ state: "ok", data: { chain, investigationId: "inv_sata" } })} {...props} />);
    // only a Brief on sale sells the figures: a run still going, or a withdrawn Brief, makes no such claim
    expect(draw({ live: true, onSale: false })).toContain("WITHHELD WHILE THE RUN MAY STILL PUBLISH");
    expect(draw({ live: true, onSale: false })).not.toContain("SOLD IN THE BRIEF");
    expect(draw({ onSale: false, withdrawn: true })).toContain("WITHHELD · BRIEF WITHDRAWN");
    expect(draw({})).toContain("BLOCKS AND VALUES WITHHELD");
    const html = draw({ onSale: true });
    // height is the multiplier's value in this chart: a withheld read sits on the axis, on neither level
    expect(html).not.toMatch(/is-collected"[^>]*(cy|y)="(128|56)"/);
    expect(html).toContain("BLOCKS AND VALUES ARE SOLD IN THE BRIEF");
    expect(html).toContain("the blocks and values are sold in the Brief");
    expect(html.match(/slot is-collected/g)).toHaveLength(3);
    expect(html).not.toContain("class=\"read\"");
    expect(html).not.toContain("class=\"step\"");
    expect(html).toContain("1.046963");
    expect(html).not.toMatch(/NaN|null|undefined/);
  });
});
