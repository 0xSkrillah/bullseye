import type { BriefPreview, DataMode } from "@bullseye/domain";
import type { Health, SignalRow } from "../lib/api";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { Timestamp } from "../primitives/Timestamp";
import { POLL_MS, paidCounts, type CommerceSummary, type Feed } from "./data";
import { boardRows, linked, type BoardNode, type BoardRow, type NodeState } from "./model";
import { Empty, FeedFoot, Panel } from "./Panel";
import { BOARD_ROWS, BOARD_STAGES, blockedStages, type BoardStage } from "./stages";
import { freshAttr, useFreshKeys } from "./useFresh";

/** a narrow screen has no room for the longest stage name; the full word stays in the title */
/** GET /api/signals and GET /api/briefs answer with at most this many, newest first */
const LIST_CAP = 50;

const SHORT: Partial<Record<BoardStage, string>> = { INVESTIGATION: "INVEST.", DELIVERY: "DELIV.", ECONOMICS: "ECON." };
/** a phone has room for four letters a column */
const TINY: Record<BoardStage, string> = { SIGNAL: "SIG", INVESTIGATION: "INV", GATE: "GATE", BRIEF: "BRF", PAYMENT: "PAY", DELIVERY: "DLV", ECONOMICS: "ECO" };

/** one glyph per state, so no two states differ by colour alone */
const GLYPH = { none: "○", unknown: "?", done: "●", running: "◐", pending: "◔", pass: "✓", unverified: "◌", fail: "✕" } as const satisfies Record<NodeState, string>;
const SAY = { none: "not reached", unknown: "not known yet", done: "reached", running: "running", pending: "outcome not known yet", pass: "passed", unverified: "paid, not chain-verified", fail: "failed" } as const satisfies Record<NodeState, string>;

export interface OpportunityBoardProps {
  health: Health | null;
  signals: PollResult<{ dataMode: DataMode; signals: SignalRow[] }>;
  briefs: PollResult<{ briefs: BriefPreview[] }>;
  commerce: PollResult<Feed<CommerceSummary>>;
  focusId: string | null;
}

function Node({ node, inLink, outLink, fresh }: { node: BoardNode; inLink: boolean; outLink: boolean; fresh: boolean }) {
  return (
    <span className={`room-node is-${node.state}${inLink ? " link-in" : ""}${outLink ? " link-out" : ""}`} data-fresh={fresh ? "" : undefined}>
      <span className="glyph" aria-hidden="true">{GLYPH[node.state]}</span>
      {node.note && <span className="note">{node.note}</span>}
    </span>
  );
}

/** a node that reached a state worth a look; "not reached" and "not known yet" are not news */
const nodeKey = (row: BoardRow, s: BoardStage) => (row.nodes[s].state === "none" || row.nodes[s].state === "unknown" ? null : `node:${row.id}:${s}:${row.nodes[s].state}`);

function Row({ row, max, fresh }: { row: BoardRow; max: number; fresh: ReadonlySet<string> }) {
  const voided = row.superseded ? `superseded by v${row.superseded.byVersion}, ${row.superseded.reason}: ` : "";
  const said = voided + BOARD_STAGES.map((s) => (s === "BRIEF" && row.nodes[s].state === "done" ? `BRIEF on sale${row.nodes[s].note ? `, confidence ${row.nodes[s].note}` : ""}` : `${s} ${row.nodes[s].note ?? SAY[row.nodes[s].state]}${row.nodes[s].detail ? `, ${row.nodes[s].detail}` : ""}`)).join(", ");
  return (
    <li className={`room-board-row${row.focused ? " is-focus" : ""}${row.superseded ? " is-superseded" : ""}`} {...freshAttr(fresh, `row:${row.id}`)}>
      <span className="col-source"><ProvenanceBadge kind={row.mode} /></span>
      <span className="col-asset">{row.focused && <span aria-hidden="true">▸</span>}{row.symbol}</span>
      {/* where the change column is not shown, the word stays: a strikethrough alone does not say what happened */}
      {row.superseded && <span className="col-voided room-bad" aria-hidden="true">SUPERSEDED</span>}
      <span className="col-effective"><Timestamp iso={row.effectiveAt} full /></span>
      <span className="col-change">
        {row.superseded ? (
          <span className="room-bad">SUPERSEDED · v{row.superseded.byVersion} {row.superseded.reason}</span>
        ) : (
          <>
            <span className="bar" aria-hidden="true"><span style={{ width: `${max > 0 ? Math.min(100, (Math.abs(row.changePct) / max) * 100) : 0}%` }} /></span>
            <span className="pct">{row.changePct >= 0 ? "+" : "−"}{Math.abs(row.changePct).toFixed(4)}%</span>
          </>
        )}
      </span>
      <span className="col-track" aria-hidden="true">
        {BOARD_STAGES.map((s, i) => <Node key={s} node={row.nodes[s]} inLink={i > 0 && linked(row, i - 1)} outLink={linked(row, i)} fresh={fresh.has(nodeKey(row, s) ?? "")} />)}
      </span>
      {/* the track is a drawing; this sentence is what it says, for a reader who cannot see it */}
      <span className="room-sr">{said}</span>
    </li>
  );
}

/** Stage SIGNAL → ECONOMICS. One row per detected rebase; counts only, never a rate. A read that has not answered is a dash, not a zero. */
export function OpportunityBoard({ health, signals, briefs, commerce, focusId }: OpportunityBoardProps) {
  const rows = signals.data?.signals ?? null;
  const blocked = blockedStages(health);
  // The signals and Briefs routes answer with their newest 50. A full list is a floor, and every count taken from it says so with a "+".
  const floor = rows !== null && rows.length >= LIST_CAP ? "+" : "";
  const investigated = rows?.filter((r) => r.investigation).length ?? null;
  const rejected = rows?.filter((r) => r.investigation?.status === "REJECTED").length ?? null;
  // GET /api/briefs lists a withdrawn Brief too; one whose signal the issuer voided is no longer sold (410). A Brief whose signal is
  // older than the rows the room holds cannot be checked: it is not counted, and the count becomes a floor.
  const live = new Set((rows ?? []).filter((r) => !r.superseded).map((r) => r.signal.id));
  const known = new Set((rows ?? []).map((r) => r.signal.id));
  const listed = briefs.data?.briefs ?? null;
  const onSale = listed && rows ? listed.filter((b) => live.has(b.signalId)).length : null;
  const onSaleFloor = listed && rows && (listed.length >= LIST_CAP || listed.some((b) => !known.has(b.signalId))) ? "+" : "";
  // "paid" is only what the chain confirmed; a payment the chain has not confirmed is counted apart, in amber
  const summary = commerce.data?.state === "ok" ? commerce.data.data : null;
  const counts = summary ? paidCounts(summary) : null;
  const paid = counts ? counts.verified : null;
  const unverified = counts ? counts.paid - counts.verified : 0;
  const n = (v: number | null) => (v === null ? "—" : v);
  const failed = [briefs.error ? "/api/briefs" : null, commerce.error ? "the order counts" : null].filter(Boolean);

  const all = rows ? boardRows(rows, briefs.data?.briefs ?? null, summary, focusId) : [];
  // more rows than the wall holds: the last line says how many are left out, and the focused run always stays on
  let shown = all;
  if (all.length > BOARD_ROWS) {
    const head = all.slice(0, BOARD_ROWS - 1);
    const focus = all.find((r) => r.focused);
    shown = focus && !head.includes(focus) ? [...head.slice(0, BOARD_ROWS - 2), focus] : head;
  }
  const max = Math.max(0, ...shown.filter((r) => !r.superseded).map((r) => Math.abs(r.changePct)));
  // What moves: a row that was not there, a node that reached a new state, the count when it changes. Each read behind the board
  // has its own baseline, taken from its first answer WITH DATA: a read that failed first and answers later is a baseline, not news.
  const stageKeys = (stages: readonly BoardStage[]) => all.flatMap((r) => stages.map((s) => nodeKey(r, s)).filter((k): k is string => k !== null));
  const freshRows = useFreshKeys(rows ? [`count:${all.length}`, ...all.map((r) => `row:${r.id}`), ...stageKeys(["SIGNAL", "INVESTIGATION", "GATE"])] : null);
  const freshBriefs = useFreshKeys(rows && briefs.data ? stageKeys(["BRIEF"]) : null);
  const freshOrders = useFreshKeys(rows && summary ? stageKeys(["PAYMENT", "DELIVERY", "ECONOMICS"]) : null, undefined, summary?.source ?? null);
  const fresh = new Set([...freshRows, ...freshBriefs, ...freshOrders]);

  return (
    <Panel
      stage="Opportunities"
      className="room-board"
      headline={rows ? <span {...freshAttr(fresh, `count:${rows.length}`)}>{rows.length}{floor}</span> : "—"}
      meta={rows ? <>{n(investigated)}{floor} investigated · {n(rejected)}{floor} rejected by gate · {n(onSale)}{onSale === null ? "" : onSaleFloor} on sale · {n(paid)} paid{unverified > 0 && <span className="room-unknown"> · {unverified} paid, not chain-verified</span>}{failed.length > 0 && <span className="room-bad"> · ✕ no answer from {failed.join(", ")}</span>}</> : undefined}
      foot={<FeedFoot route="/api/signals" everyMs={POLL_MS.signals} updatedAt={signals.updatedAt} error={signals.error} />}
    >
      <div className="room-board-head" aria-hidden={rows !== null && rows.length === 0 ? true : undefined}>
        <span className="col-source">SOURCE</span>
        <span className="col-asset">ASSET</span>
        <span className="col-effective">EFFECTIVE</span>
        <span className="col-change">CHANGE{max > 0 ? ` · BAR MAX ${max.toFixed(4)}%` : ""}</span>
        <span className="col-track">
          {BOARD_STAGES.map((s) => (
            <span key={s} className={blocked[s] ? "room-bad" : undefined} title={blocked[s] ?? s}>{blocked[s] ? "✕ " : ""}{SHORT[s] ? <><span className="long">{s}</span><abbr className="short" title={s}>{SHORT[s]}</abbr></> : <span className="long short">{s}</span>}<abbr className="tiny" title={s}>{TINY[s]}</abbr></span>
          ))}
        </span>
      </div>
      {rows === null ? (
        <Empty title={signals.error ? "NO ANSWER" : "Fetching…"} />
      ) : rows.length === 0 ? (
        <Empty title="0 OPPORTUNITIES ON RECORD" note="One row per detected rebase, one node per pipeline stage. Nothing is drawn until a real event exists.">
          {Object.values(blocked).length > 0 && <span className="room-empty-note room-bad">✕ {Object.values(blocked).join(" · ")}</span>}
        </Empty>
      ) : (
        <ol className="room-board-rows">
          {shown.map((r) => <Row key={r.id} row={r} max={max} fresh={fresh} />)}
          {all.length > shown.length && <li className="room-board-more">+{all.length - shown.length} more, not shown</li>}
        </ol>
      )}
      {/* the key to the glyphs, wherever the words beside them are not shown (every layout but the wall) */}
      {rows !== null && rows.length > 0 && (
        <p className="room-board-key" aria-hidden="true">○ not reached · ● reached · ◐ running · ◔ outcome not known · ✓ passed, or paid and chain-verified · ◌ paid, not chain-verified · ✕ failed · ? not known yet</p>
      )}
    </Panel>
  );
}
