import { ORDER_TRANSITIONS, type OrderState } from "@bullseye/domain";
import type { Health } from "../lib/api";
import type { PollResult } from "../lib/usePoll";
import { isPaidOrLater } from "../components/PaymentState";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { clockTime } from "../format";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";
import { POLL_MS, type CommerceSummary, type DeskEconomics, type Feed } from "./data";
import { Panel } from "./Panel";
import { RETRY_PROMISE } from "./stages";
import { useFreshRises } from "./useFresh";

export interface CommercePanelProps {
  health: Health | null;
  commerce: PollResult<Feed<CommerceSummary>>;
  economics?: PollResult<Feed<DeskEconomics>>;
  /**
   * The newest judged runs, for the bars shown while desk totals do not exist. `measuredUsd` is null
   * when the server withholds it; `fixture` marks a run on the test double, whose zero is not a measured cost.
   */
  runs?: { id: string; symbol: string | null; measuredUsd: number | null; fixture?: boolean }[];
}

const OUTCOMES = ["PUBLISHED", "REJECTED", "STOPPED", "RUNNING"] as const;

/** Where each state sits on the diagram: the main line on top, the side rails under the state they leave from. */
const AT = {
  QUOTED: [40, 30],
  PAYMENT_PENDING: [150, 30],
  PAID: [270, 30],
  DELIVERING: [375, 30],
  DELIVERED: [452, 30],
  PAYMENT_UNKNOWN: [150, 66],
  DELIVERY_FAILED: [375, 66],
  PAYMENT_FAILED: [40, 96],
  RECONCILIATION_REQUIRED: [270, 96],
} as const satisfies Record<OrderState, readonly [number, number]>;

/** ok: PAID or later and chain-verified (decided from the counts below). warn: outcome not known yet. bad: failed. */
const TONE = {
  QUOTED: "ink",
  PAYMENT_PENDING: "warn",
  PAYMENT_UNKNOWN: "warn",
  RECONCILIATION_REQUIRED: "warn",
  PAYMENT_FAILED: "bad",
  PAID: "ok",
  DELIVERING: "ink",
  DELIVERED: "ok",
  DELIVERY_FAILED: "bad",
} as const satisfies Record<OrderState, "ink" | "warn" | "ok" | "bad">;

const STATES = Object.keys(AT) as OrderState[];
const R = 13;
const at = (n: number) => Math.round(n * 10) / 10;

/**
 * Stage PAYMENT / DELIVERY / ECONOMICS. Orders are counts by state (no buyer, order or payment
 * identifier ever reaches the room); the edges are the domain's transition table; the newest
 * order's path is drawn over them. The room offers no action: nothing here pays, retries or reconciles.
 * Economics keeps measured cost, upper-bound cost and estimated allowances in separate figures.
 */
export function CommercePanel({ health, commerce, economics, runs = [] }: CommercePanelProps) {
  const feed = commerce.data;
  const s = feed?.state === "ok" ? feed.data : null;
  const cellOf = (st: OrderState) => s?.byState[st] ?? { count: 0, chainVerified: 0 };
  const rail = health?.paymentRail ?? null;
  const latest = s?.latest ?? null;
  const walked = new Set((latest?.trail ?? []).filter((t) => t.from !== null).map((t) => `${t.from}-${t.to}`));
  const visited = new Set((latest?.trail ?? []).map((t) => t.to));
  const eco = economics?.data?.state === "ok" ? economics.data.data : null;
  // a receipt exists for every order, paid or not: only one whose order was paid says anything about money
  const receipt = latest && isPaidOrLater(latest.state) ? s?.latestReceipt ?? null : null;
  // the head has one line: the summary's route is written short there and in full in the README
  const route = s?.source === "ORDERS" ? "/api/orders" : "…/commerce/summary";
  const ceiling = health?.budget.maxVariableCostUsd ?? null;
  const priced = runs.filter((r): r is { id: string; symbol: string | null; measuredUsd: number; fixture?: boolean } => r.measuredUsd !== null && !r.fixture);
  const fixtureRuns = runs.filter((r) => r.fixture).length;
  const unknown = cellOf("PAYMENT_UNKNOWN").count;
  // A state's ring pulses once when its count, or its chain-verified count, rises. Never when it falls: these are counts of the
  // newest orders, and one falls when an old order leaves the window. Another source (summary or orders list) is a new baseline.
  const fresh = useFreshRises(s ? Object.fromEntries(STATES.flatMap((st) => [[st, cellOf(st).count], [`${st}:verified`, cellOf(st).chainVerified]])) : null, undefined, s?.source ?? null);
  // lines that only some desks need: an upper bound, paid orders the chain has not confirmed
  // the desk totals' own note is three lines long: on the wall it never fits whole, and a caveat is not cut mid-sentence
  const tight = (eco?.research.total.upperBoundUsd ?? 0) > 0 || (eco?.sales.unverifiedMainnetOrders ?? 0) > 0 || (!s?.note && Boolean(eco?.note));
  const share = (usd: number, of: number) => `${of > 0 ? Math.round((usd / of) * 1000) / 10 : 0}%`;
  // totals that stopped answering stay on screen as the last answer, and say so
  const stale = economics?.error ? <span className="room-bad">✕ no answer from /api/desk/economics{economics.updatedAt ? ` · last ${clockTime(new Date(economics.updatedAt).toISOString())}` : ""}</span> : null;

  return (
    <Panel
      stage="Payment · Delivery"
      className="room-commerce"
      headline={s ? `${s.total}${s.atLeast ? "+" : ""} ORDER${s.total === 1 && !s.atLeast ? "" : "S"}` : "—"}
      meta={
        // the counts drawn below are the last answer: say how old they are
        commerce.error ? <span className="room-bad">✕ no answer ({commerce.error}){commerce.updatedAt ? ` · last ${clockTime(new Date(commerce.updatedAt).toISOString())}` : ""}</span>
        : feed?.state === "unavailable" ? "order counts not available to a visitor"
        : s ? <>{s.label ? `${s.label} · ` : ""}GET {route} · {POLL_MS.commerce / 1000} s</> : "Fetching…"
      }
    >
      <div className="room-scroll">
        <svg className="room-svg room-machine" viewBox="0 0 490 122" role="img" aria-label={s ? `Order state machine${s.atLeast ? ", newest orders only" : ""}: ${STATES.map((st) => `${st} ${cellOf(st).count}${TONE[st] === "ok" && cellOf(st).count > 0 ? ` (${cellOf(st).chainVerified} chain-verified)` : ""}`).join(", ")}${latest ? `; newest order went ${latest.trail.map((t) => t.to).join(", then ")}` : ""}` : "Order state machine: counts not known yet"}>
          <defs>
            <marker id="room-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="arrow" d="M0 0 L8 4 L0 8 z" /></marker>
          </defs>
          {STATES.flatMap((from) =>
            ORDER_TRANSITIONS[from].filter((to) => !(from === "DELIVERY_FAILED" && to === "DELIVERING")).map((to) => {
              const [ax, ay] = AT[from], [bx, by] = AT[to];
              const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
              const taken = walked.has(`${from}-${to}`) || (from === "DELIVERING" && walked.has("DELIVERY_FAILED-DELIVERING"));
              return <line key={`${from}-${to}`} className={taken ? "edge is-walked" : "edge"} x1={at(ax + (dx / len) * R)} y1={at(ay + (dy / len) * R)} x2={at(bx - (dx / len) * R)} y2={at(by - (dy / len) * R)} markerEnd="url(#room-arrow)" markerStart={from === "DELIVERING" && to === "DELIVERY_FAILED" ? "url(#room-arrow)" : undefined} />;
            }),
          )}
          {STATES.map((st) => {
            const [x, y] = AT[st], here = cellOf(st), main = y === AT.QUOTED[1];
            // green only when every order counted here is PAID or later AND chain-verified; otherwise "not known yet"
            const tone = TONE[st] === "ok" && here.chainVerified !== here.count ? "warn" : TONE[st];
            return (
              <g key={st} className={`node${here.count > 0 ? ` is-${tone}` : ""}${visited.has(st) ? " is-visited" : ""}`} data-fresh={fresh.has(st) || fresh.has(`${st}:verified`) ? "" : undefined}>
                <circle cx={x} cy={y} r="12" />
                <text className="count" x={x} y={y + 6} textAnchor="middle">{s ? here.count : "—"}</text>
                {TONE[st] === "ok" && here.count > 0 && <text className="mark" x={x + 17} y={y + 19} textAnchor="middle" aria-hidden="true">{tone === "ok" ? "✓" : "◌"}</text>}
                {main ? <text className="name" x={x} y="11" textAnchor="middle">{st}</text> : st === "PAYMENT_FAILED" ? <text className="name" x={x - 14} y={y + 23}>{st}</text> : <text className="name" x={x + 18} y={y + 4}>{st}</text>}
              </g>
            );
          })}
        </svg>
      </div>

      {/* the promise is on screen whenever any order's outcome is unknown, not only when the newest one's is */}
      {unknown > 0 && (
        <span className="room-line room-unknown">◌ {unknown} PAYMENT_UNKNOWN{latest?.state === "PAYMENT_UNKNOWN" ? <> <Timestamp iso={latest.at} /></> : null} · {RETRY_PROMISE}</span>
      )}
      {latest && latest.state !== "PAYMENT_UNKNOWN" ? (
        // on the wall this line gives way to the one above; every narrower layout shows both
        <span className={unknown > 0 ? "room-line is-second" : "room-line"}>newest order · <span className="room-ink">{latest.state}</span> <Timestamp iso={latest.at} /> · {latest.trail.length} step{latest.trail.length === 1 ? "" : "s"}{latest.chainVerified ? " · chain-verified" : isPaidOrLater(latest.state) ? " · not chain-verified" : ""}</span>
      ) : latest ? null : rail && !rail.ready ? (
        <span className="room-line room-bad">✕ rail not ready · nothing can be charged</span>
      ) : s && s.total === 0 ? (
        <span className="room-line">no orders yet</span>
      ) : null}

      <div className="room-economics" role="group" aria-label="Economics">
        {eco ? (
          <>
            <span className="room-eco-line">
              <span className="room-label">Economics · {eco.label}</span>
              {/* one bar, one basis: measured research cost, split by how the run ended. The upper bound is a separate figure, never a segment. */}
              <span className="room-eco-bar" role="img" aria-label={`Measured research cost by outcome: ${OUTCOMES.map((o) => `${o} ${eco.research.byOutcome[o].runs} runs`).join(", ")}`}>
                {OUTCOMES.map((o) => <span key={o} className={`seg is-${o.toLowerCase()}`} style={{ width: share(eco.research.byOutcome[o].measuredUsd, eco.research.total.measuredUsd) }} />)}
              </span>
              <span><Money usd={eco.research.total.measuredUsd} basis="MEASURED" decimals={6} /> measured</span>
            </span>
            {/* the bar's legend: the same marks as its segments, with the count of runs that ended that way. When the totals stop answering, that is said in its place. */}
            {stale ? <span className="room-eco-text">{stale}</span> : <span className="room-eco-text room-dim">
              {OUTCOMES.filter((o) => eco.research.byOutcome[o].runs > 0).map((o, i) => <span key={o}>{i > 0 ? " · " : ""}<i className={`sw is-${o.toLowerCase()}`} aria-hidden="true" />{eco.research.byOutcome[o].runs} {o.toLowerCase()}</span>)}
              {eco.investigations.total === 0 && "no runs"}
              {eco.research.runsWithoutAPrice > 0 && <> · {eco.research.runsWithoutAPrice} unpriced</>}
            </span>}
            {eco.research.total.upperBoundUsd > 0 && <span className="room-eco-text">+ <Money usd={eco.research.total.upperBoundUsd} basis="ESTIMATED" decimals={6} /> upper bound, not in the bar</span>}
            <span className="room-eco-text">
              sales · {eco.sales.revenueOrders} revenue order{eco.sales.revenueOrders === 1 ? "" : "s"} <Money usd={eco.sales.revenueUsd} basis="PRICE" realised={eco.sales.revenueOrders > 0} />
              {eco.sales.testOrders > 0 && <> · {eco.sales.testOrders} test <Money usd={eco.sales.testPaymentsUsd} basis="PRICE" rail={eco.rail === "OKX_X402_MAINNET" ? "OKX_X402_TESTNET" : eco.rail} /></>}
            </span>
            {(eco.sales.unverifiedMainnetOrders ?? 0) > 0 && (
              <span className="room-eco-text room-unknown">
                ◌ {eco.sales.unverifiedMainnetOrders} paid on mainnet, not chain-verified <Money usd={eco.sales.unverifiedMainnetUsd ?? 0} basis="PRICE" rail="OKX_X402_MAINNET" /> · not counted as revenue
              </span>
            )}
            <span className="room-eco-text">
              delivery <Money usd={eco.delivery.estimatedTotalUsd} basis="ESTIMATED" /> · contribution, not profit <Money usd={eco.estimatedContributionUsd} basis="ESTIMATED" />
            </span>
          </>
        ) : receipt ? (
          <>
            <span className="room-eco-line"><span className="room-label">Economics</span>{stale}</span>
            <span className="room-eco-text">newest paid order's receipt · price <Money usd={receipt.priceUsd} basis="PRICE" rail={receipt.rail} realised={receipt.countsAsRevenue && latest?.chainVerified === true} /></span>
            {/* a run on the test double has no measured cost: the word FIXTURE stands where a zero would mislead */}
            <span className="room-eco-text">
              {/* the summary route's receipt does not say whether the run used the test double: a zero from it is not reported, never a measured zero */}
              {receipt.usageIsFixture ? <><ProvenanceBadge kind="FIXTURE" title="Usage from the fixture synthesiser: not a real cost." /> model cost not measured</>
                : receipt.usageIsFixture === undefined && receipt.measuredTotalUsd === 0 ? <>model cost not reported</>
                : <>measured cost <Money usd={receipt.measuredTotalUsd} basis="MEASURED" decimals={6} /></>} · allowances <Money usd={receipt.estimatedTotalUsd} basis="ESTIMATED" />
            </span>
            {/* a contribution is money the desk made only when the order counts as revenue; otherwise the line says why it does not */}
            <span className="room-eco-text">contribution <Money usd={receipt.estimatedContributionUsd} basis="ESTIMATED" />{receipt.countsAsRevenue ? "" : receipt.rail === "OKX_X402_MAINNET" ? " · not counted as revenue" : " · on a test payment"}, not profit</span>
          </>
        ) : (
          <>
            <span className="room-eco-line">
              <span className="room-label">Economics</span>
              {stale ?? (priced.length > 0 ? `measured model cost per run · bar = ${ceiling !== null ? "the cost ceiling" : "—"}` : fixtureRuns > 0 ? null : economics?.data?.state === "unavailable" ? "desk totals not available yet" : "Fetching…")}
            </span>
            {ceiling !== null && priced.map((r) => (
              <span key={r.id} className="room-eco-line">
                <span className="room-eco-sym">{r.symbol ?? "—"}</span>
                <span className="room-eco-bar" aria-hidden="true"><span className="seg is-published" style={{ width: share(r.measuredUsd, ceiling) }} /></span>
                <Money usd={r.measuredUsd} basis="MEASURED" decimals={6} />
              </span>
            ))}
            {fixtureRuns > 0 && <span className="room-eco-text"><ProvenanceBadge kind="FIXTURE" title="Usage from the fixture synthesiser: not a real cost." /> {fixtureRuns} run{fixtureRuns === 1 ? "" : "s"} on the test double · model cost not measured</span>}
            {priced.length === 0 && <span className="room-eco-text">price per Brief {health ? <Money usd={health.priceUsd} basis="PRICE" rail={health.paymentRail.rail} /> : "—"}</span>}
          </>
        )}
      </div>
      {/* the server's own caveat. On the wall it gives way when the block above already needs its lines; every narrower layout always shows it. */}
      {(s?.note ?? eco?.note) && <span className={tight ? "room-note is-tight" : "room-note"}>{s?.note ?? eco?.note}</span>}
    </Panel>
  );
}
