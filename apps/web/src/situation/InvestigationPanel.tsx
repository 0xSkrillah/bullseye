import type { ReactNode } from "react";
import type { TimelineEntry } from "@bullseye/domain";
import type { Health } from "../lib/api";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";
import { POLL_MS, type RoomInvestigation } from "./data";
import { Panel } from "./Panel";
import { freshAttr, useFreshKeys } from "./useFresh";

export interface InvestigationPanelProps {
  health: Health | null;
  /** how many investigations exist; null while unknown. `atLeast` when the list came back full, so more may exist. */
  onRecord: number | null;
  atLeast?: boolean;
  /** how many are RUNNING; null while unknown */
  running: number | null;
  /** the investigation the room is watching, and the read of it; drawn only when the two agree */
  focusId?: string | null;
  focus?: PollResult<RoomInvestigation>;
  /** the asset of the focused run, from the signal it belongs to */
  symbol?: string | null;
  now?: Date;
}

function Gauge({ name, fraction = 0, estimated = 0, over = false, children }: { name: string; fraction?: number; estimated?: number; over?: boolean; children: ReactNode }) {
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10}%`;
  return (
    <div className={`room-gauge${over ? " is-over" : ""}`}>
      <span className="room-gauge-name">{name}</span>
      <span className="room-gauge-track" aria-hidden="true">
        <span className="fill" style={{ width: pct(fraction) }} />
        <span className="fill is-estimated" style={{ width: pct(Math.min(estimated, 1 - Math.min(1, fraction))) }} />
      </span>
      <span className="room-gauge-value">{children}</span>
    </div>
  );
}

const TICKS = [0, 60, 120, 180, 240, 300];
const LANE = { MODEL: 26, TOOL: 56, EVIDENCE: 86, VERDICT: 116 } as const;
const AXIS_Y = 132;
const STATUS_GLYPH = { RUNNING: "◐", PUBLISHED: "✓", REJECTED: "✕", STOPPED: "✕" } as const;
const STATUS_TONE = { RUNNING: "room-unknown", PUBLISHED: "room-ok", REJECTED: "room-bad", STOPPED: "room-bad" } as const;

/** One mark per timeline entry, at the second it happened. Glyph by type and `ok`; never the entry's words. */
function Mark({ e, x, fresh }: { e: TimelineEntry; x: number; fresh: boolean }) {
  return <g data-fresh={fresh ? "" : undefined}>{glyph(e, x)}</g>;
}

function glyph(e: TimelineEntry, x: number) {
  switch (e.type) {
    case "MODEL_CALL": return e.ok ? <rect className="m-model" x={x - 4} y={LANE.MODEL - 4} width="8" height="8" /> : <text className="m-glyph is-bad" x={x} y={LANE.MODEL + 5} textAnchor="middle">✕</text>;
    case "TOOL_CALL": return e.ok ? <circle className="m-tool" cx={x} cy={LANE.TOOL} r="4" /> : <text className="m-glyph is-bad" x={x} y={LANE.TOOL + 5} textAnchor="middle">✕</text>;
    case "EVIDENCE": return <circle className="m-evidence" cx={x} cy={LANE.EVIDENCE} r="4" />;
    case "CHECKS": return <rect className="m-checks" x={x - 4} y={LANE.VERDICT - 4} width="8" height="8" transform={`rotate(45 ${x} ${LANE.VERDICT})`} />;
    case "GATE": return <text className={e.ok ? "m-glyph is-ok" : "m-glyph is-bad"} x={x} y={LANE.VERDICT + 5} textAnchor="middle">{e.ok ? "✓" : "✕"}</text>;
    case "STOPPED": return <text className="m-glyph is-bad" x={x} y={LANE.VERDICT + 5} textAnchor="middle">✕</text>;
    default: return null;
  }
}

/**
 * Stage INVESTIGATION: the RUNNING run, else the newest. Gauges are spend against the ceilings the
 * run was started with (`budgetAtStart`, else today's configuration). Measured cost and upper-bound
 * cost stay apart, as the API keeps them. The run chart places every timeline entry at the second
 * it happened; it shows that something happened and whether it was ok, never the entry's text.
 */
export function InvestigationPanel({ health, onRecord, atLeast = false, running, focusId = null, focus, symbol = null, now }: InvestigationPanelProps) {
  const data = focus?.data && focus.data.investigation.id === focusId ? focus.data : null;
  const v = data?.investigation ?? null;
  const u = data?.usage ?? null;
  const own = v?.budgetAtStart ?? null;
  const b = own ?? data?.budget ?? health?.budget ?? null;
  const ceilingS = b ? b.maxLatencyMs / 1000 : null;
  const startMs = v ? Date.parse(v.startedAt) : null;
  // a finished run's elapsed is two server fields. A RUNNING run's is this browser's clock minus `startedAt`,
  // and it stops at the last answer when the reads start failing, so a stale run never keeps counting.
  const stale = Boolean(v && !v.finishedAt && focus?.error && focus.updatedAt);
  const endMs = v ? (v.finishedAt ? Date.parse(v.finishedAt) : stale ? focus!.updatedAt : now ? now.getTime() : null) : null;
  const elapsedS = startMs !== null && endMs !== null ? Math.max(0, (endMs - startMs) / 1000) : null;
  const upper = u?.upperBoundModelCostUsd ?? 0;
  // a public visitor is told how many calls were made, not what they cost: that is "withheld", never zero
  const measured = u?.measuredModelCostUsd ?? null;
  const withheld = u !== null && measured === null;
  const x0 = 96, x1 = 514;
  // the axis runs to the ceiling, or further when the run did: a mark is never pinned to a ceiling it overran
  const scaleS = ceilingS !== null ? Math.max(ceilingS, elapsedS ?? 0) : null;
  const sx = (s: number) => (scaleS ? Math.round((x0 + (Math.max(0, s) / scaleS) * (x1 - x0)) * 10) / 10 : x0);
  const count = (t: TimelineEntry["type"], ok?: boolean) => v?.timeline.filter((e) => e.type === t && (ok === undefined || e.ok === ok)).length ?? 0;
  const checks = v?.timeline.find((e) => e.type === "CHECKS")?.label ?? null;
  const hit = v?.stopReason ?? null;
  // a test double's usage is not a cost: the figure is the API's, the badge says what kind of figure it is
  const fixtureUsage = u?.costBases?.includes("FIXTURE") ?? false;
  // a timeline entry appears once, when the read that first carries it arrives; so does a change of status
  // When the focus moves to another run, what that run already holds is a baseline: it happened before the room looked.
  const fresh = useFreshKeys(v ? [`status:${v.id}:${v.status}`, ...v.timeline.map((e) => `mark:${v.id}:${e.seq}`)] : null, undefined, v?.id ?? null);
  const about = [
    u?.routedModels && u.routedModels.length > 0 ? `routed: ${u.routedModels.join(", ")}` : null,
    // the label is counts ("8 passed, 0 failed, 1 unknown") for a reader who may see them, and a fixed sentence for a visitor: printed as it comes
    checks ? (/^[0-9]/.test(checks) ? `checks: ${checks}` : checks) : null,
    // the gauge above already says the cost is withheld; this says why
    withheld ? "public view" : null,
  ].filter((s): s is string => s !== null);

  return (
    <Panel
      stage="Investigation"
      className="room-investigation"
      headline={v && symbol ? <>▸ {symbol}</> : undefined}
      meta={
        v ? (
          <>
            <Id value={v.id} short /> <Timestamp iso={v.startedAt} />
            <span className={`room-status ${STATUS_TONE[v.status]}`} {...freshAttr(fresh, `status:${v.id}:${v.status}`)}>{STATUS_GLYPH[v.status]} <Enum value={v.status} /></span>
          </>
        ) : onRecord !== null ? `${onRecord}${atLeast ? "+" : ""} on record` : undefined
      }
      foot={
        <footer className="room-foot">
          <span>
            {/* with a run on screen the foot is about the run; the route and its pace are said when there is none */}
            {(v ? about.join(" · ") : "") || `GET /api/investigations/:id · ${v && v.status !== "RUNNING" ? "read once" : `every ${POLL_MS.runningInvestigation / 1000} s while RUNNING`}`}
          </span>
          {focus?.error && focusId ? <span className="room-bad">✕ no answer ({focus.error})</span> : <span>{running === null ? "" : running === 0 ? "nothing RUNNING" : `${running} RUNNING`}{onRecord !== null && v ? ` · ${onRecord}${atLeast ? "+" : ""} on record` : ""}</span>}
        </footer>
      }
    >
      {v?.status === "STOPPED" && v.stopReason ? <div className="room-line room-bad">✕ stopped: <Enum value={v.stopReason} /></div> : null}
      <div className="room-gauges" role="group" aria-label={own ? "Budget: spent against the ceilings this run was started with" : "Budget, current ceilings"}>
        <Gauge name={withheld ? "COST · WITHHELD" : "COST · MEASURED"} fraction={measured !== null && b ? measured / b.maxVariableCostUsd : 0} estimated={b ? upper / b.maxVariableCostUsd : 0} over={hit === "BUDGET_COST_EXCEEDED"}>
          {measured !== null ? <Money usd={measured} basis="MEASURED" decimals={6} /> : <span className="room-dim">{withheld ? "withheld" : "—"}</span>} / {b ? <Money usd={b.maxVariableCostUsd} basis="LIMIT" /> : "—"}
          {fixtureUsage && <span className="room-gauge-extra"><ProvenanceBadge kind="FIXTURE" title="Usage from the fixture synthesiser: not a real cost." /> not a real cost</span>}
          {upper > 0 && <span className="room-gauge-extra">+ <Money usd={upper} basis="ESTIMATED" decimals={6} /> upper bound</span>}
        </Gauge>
        <Gauge name="MODEL CALLS" fraction={u && b ? u.modelCalls / b.maxModelCalls : 0} over={hit === "BUDGET_MODEL_CALLS_EXCEEDED"}>{u ? u.modelCalls : <span className="room-dim">—</span>} / {b ? b.maxModelCalls : "—"}</Gauge>
        <Gauge name="TOOL CALLS" fraction={u && b ? u.toolCalls / b.maxToolCalls : 0} over={hit === "BUDGET_TOOL_CALLS_EXCEEDED"}>{u ? u.toolCalls : <span className="room-dim">—</span>} / {b ? b.maxToolCalls : "—"}</Gauge>
        <Gauge name="ELAPSED" fraction={elapsedS !== null && ceilingS ? elapsedS / ceilingS : 0} over={hit === "BUDGET_LATENCY_EXCEEDED"}>{elapsedS !== null ? `${elapsedS.toFixed(1)} s` : <span className="room-dim">—</span>} / {ceilingS !== null ? `${ceilingS} s` : "—"}</Gauge>
      </div>
      <div className="room-scroll">
        <svg
          className="room-svg room-runchart"
          viewBox="0 0 526 154"
          role="img"
          aria-label={
            v && elapsedS !== null
              ? `Run chart for ${symbol ?? v.id}: ${count("MODEL_CALL")} model calls of which ${count("MODEL_CALL", false)} failed, ${count("TOOL_CALL")} tool calls of which ${count("TOOL_CALL", false)} failed, ${count("EVIDENCE")} evidence items, ${count("GATE")} gate decisions, ${elapsedS.toFixed(1)} seconds${ceilingS ? ` of a ${ceilingS} second ceiling` : ""}`
              : onRecord === 0 ? "Run chart: no investigation on record" : "Run chart"
          }
        >
          {(Object.keys(LANE) as (keyof typeof LANE)[]).map((lane) => (
            <g key={lane}>
              <text className="lane" x="0" y={LANE[lane] + 4}>{lane}</text>
              <line className="rule" x1={x0} y1={LANE[lane]} x2={x1} y2={LANE[lane]} />
            </g>
          ))}
          <line className="axis" x1={x0} y1={AXIS_Y} x2={x1} y2={AXIS_Y} />
          {ceilingS !== null && scaleS !== null && (
            <>
              <line className="ceiling" x1={sx(ceilingS)} y1="8" x2={sx(ceilingS)} y2={AXIS_Y} />
              {[...TICKS.filter((s) => s < ceilingS), ceilingS].map((s) => (
                <text key={s} className="tick" x={sx(s)} y={AXIS_Y + 18} textAnchor={s === 0 ? "start" : sx(s) > x1 - 60 ? "end" : "middle"}>{s} s{s === ceilingS ? " ceiling" : ""}</text>
              ))}
            </>
          )}
          {v && startMs !== null && ceilingS !== null && (
            <>
              {elapsedS !== null && (
                <>
                  <line className="elapsed" x1={sx(elapsedS)} y1="8" x2={sx(elapsedS)} y2={AXIS_Y} />
                  <text className={hit === "BUDGET_LATENCY_EXCEEDED" || (v.finishedAt && ceilingS !== null && elapsedS > ceilingS) ? "tick is-bad" : "tick is-ink"} x={sx(elapsedS) + (sx(elapsedS) > x1 - 110 ? -5 : 5)} y="12" textAnchor={sx(elapsedS) > x1 - 110 ? "end" : "start"}>{stale ? "last known" : v.status === "RUNNING" ? "now" : "finished"} {elapsedS.toFixed(1)} s</text>
                </>
              )}
              {v.timeline.map((e) => <Mark key={e.seq} e={e} x={sx((Date.parse(e.at) - startMs) / 1000)} fresh={fresh.has(`mark:${v.id}:${e.seq}`)} />)}
            </>
          )}
          {!v && onRecord === 0 && <text className="display" x={(x0 + x1) / 2} y="76" textAnchor="middle">NO INVESTIGATION ON RECORD</text>}
          {!v && focusId && !focus?.error && <text className="tick" x={(x0 + x1) / 2} y="76" textAnchor="middle">Fetching…</text>}
        </svg>
      </div>
    </Panel>
  );
}
