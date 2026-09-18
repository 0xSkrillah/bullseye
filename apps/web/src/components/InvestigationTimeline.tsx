import type { EvidenceItem, InvestigationView, ResearchBudget, TimelineEntry } from "@bullseye/domain";
import type { InvestigationUsage } from "../api";
import { formatCount, instantMs, seconds } from "../format";
import { Enum } from "../primitives/Enum";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface InvestigationTimelineProps {
  view: InvestigationView;
  /** the API reports a usage summary for an investigation, not individual usage records */
  usage: InvestigationUsage;
  budget: ResearchBudget;
  /** drives the running latency and the stale test */
  now: Date | string;
  /** full evidence items exist only inside a delivered Brief; with them a row gains its badge and stale mark */
  evidence?: readonly EvidenceItem[];
  onOpenEvidence?(id: string): void;
}

const GLYPH = {
  STARTED: "○",
  MODEL_CALL: "✓",
  TOOL_CALL: "→",
  EVIDENCE: "✓",
  CHECKS: "✓",
  GATE: "✓",
  STOPPED: "✕",
  PUBLISHED: "✓",
  REJECTED: "✕",
} as const satisfies Record<TimelineEntry["type"], string>;

function tone(entry: TimelineEntry): "is-bad" | "is-neutral" | "is-ok" {
  if (entry.type === "STOPPED" || entry.type === "REJECTED" || !entry.ok) return "is-bad";
  if (entry.type === "STARTED" || entry.type === "TOOL_CALL") return "is-neutral";
  return "is-ok";
}

function share(used: number, ceiling: number): string {
  if (!(ceiling > 0)) return "0%";
  return `${Math.min(100, Math.max(0, Math.round((used / ceiling) * 100)))}%`;
}

const hit = { color: "var(--invalid)" } as const;

/** TimelineEntry rows only: what was called and what came back, never model text. */
export function InvestigationTimeline({ view, usage, budget, now, evidence, onOpenEvidence }: InvestigationTimelineProps) {
  const nowMs = instantMs(now);
  const endMs = view.finishedAt ? Date.parse(view.finishedAt) : nowMs;
  const elapsedMs = Math.max(0, endMs - Date.parse(view.startedAt));
  const fixtureCost = usage.costBasis === "FIXTURE";
  // the bar tracks what the governor counts against the ceiling; the word "measured" is kept for measured spend only
  const counted = usage.budgetSpentUsd ?? usage.measuredModelCostUsd;
  const upperBound = usage.upperBoundModelCostUsd ?? 0;
  const byId = new Map((evidence ?? []).map((e) => [e.id, e]));

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="investigation" data-status={view.status}>
      <div className="be-budget" aria-label="Research budget">
        <div style={view.stopReason === "BUDGET_COST_EXCEEDED" ? hit : undefined}>
          Cost
          <b>
            <Money usd={upperBound > 0 ? counted - upperBound : counted} basis="MEASURED" />
            {upperBound > 0 && (
              <>
                {" + "}
                <Money usd={upperBound} basis="ESTIMATED" />
              </>
            )}{" "}
            / <Money usd={budget.maxVariableCostUsd} basis="MEASURED" decimals={2} />
            {fixtureCost && (
              <>
                {" "}
                <ProvenanceBadge kind="FIXTURE" title="Cost basis FIXTURE: produced by a test double, not a real cost." />
              </>
            )}
          </b>
          <i>
            <span style={{ width: share(counted, budget.maxVariableCostUsd) }} />
          </i>
        </div>
        <div style={view.stopReason === "BUDGET_MODEL_CALLS_EXCEEDED" ? hit : undefined}>
          Model calls
          <b>
            {usage.modelCalls} / {budget.maxModelCalls}
          </b>
          <i>
            <span style={{ width: share(usage.modelCalls, budget.maxModelCalls) }} />
          </i>
        </div>
        <div style={view.stopReason === "BUDGET_TOOL_CALLS_EXCEEDED" ? hit : undefined}>
          Tool calls
          <b>
            {usage.toolCalls} / {budget.maxToolCalls}
          </b>
          <i>
            <span style={{ width: share(usage.toolCalls, budget.maxToolCalls) }} />
          </i>
        </div>
        <div style={view.stopReason === "BUDGET_LATENCY_EXCEEDED" ? hit : undefined}>
          Latency
          <b>
            {seconds(elapsedMs)} s / {seconds(budget.maxLatencyMs)} s
          </b>
          <i>
            <span style={{ width: share(elapsedMs, budget.maxLatencyMs) }} />
          </i>
        </div>
      </div>

      <ol className="be-timeline" data-testid="timeline">
        {view.timeline.map((entry) => {
          const item = entry.evidenceId ? byId.get(entry.evidenceId) : undefined;
          const stale = item ? nowMs > Date.parse(item.staleAfter) : false;
          const evidenceId = entry.evidenceId;
          const interactive = evidenceId !== null && onOpenEvidence !== undefined;
          const rowTone = stale ? "is-bad" : tone(entry);
          return (
            <li key={entry.seq}>
              <button
                type="button"
                className={`be-tl-row ${rowTone}${stale ? " is-stale" : ""}`}
                style={interactive ? undefined : { cursor: "default" }}
                data-testid="timeline-row"
                data-type={entry.type}
                data-ok={entry.ok}
                data-evidence-id={evidenceId ?? undefined}
                aria-disabled={interactive ? undefined : true}
                onClick={interactive ? () => onOpenEvidence(evidenceId) : undefined}
              >
                <span className="be-tl-glyph" aria-hidden="true">
                  {rowTone === "is-bad" ? "✕" : GLYPH[entry.type]}
                </span>
                <span className="be-tl-tool" title={entry.label}>
                  {entry.label}
                </span>
                <span className="be-tl-result">{entry.detail ?? ""}</span>
                <span>
                  {item && <ProvenanceBadge kind={item.provenance.mode} />}
                  {stale && <ProvenanceBadge kind="STALE" />}
                </span>
                <Timestamp iso={entry.at} className="be-tl-time" />
              </button>
            </li>
          );
        })}
      </ol>

      {view.status === "RUNNING" && (
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
          Fetching…
        </span>
      )}

      {view.status === "STOPPED" && view.stopReason && (
        <p role="alert" style={{ margin: 0, fontSize: 13, lineHeight: "18px", color: "var(--invalid)" }}>
          <span aria-hidden="true">✕</span> Stopped: <Enum mono value={view.stopReason} />
        </p>
      )}

      <div className="be-tl-foot" style={{ flexWrap: "wrap" }}>
        <span>{formatCount(view.timeline.length)} entries</span>
        <span>{formatCount(usage.modelCalls)} model calls</span>
        <span>{formatCount(usage.toolCalls)} tool calls</span>
        <span>{seconds(elapsedMs)} s</span>
        <span>
          <Money usd={usage.measuredModelCostUsd} basis="MEASURED" /> {fixtureCost ? "· fixture" : "measured"}
        </span>
        {upperBound > 0 && (
          <span>
            <Money usd={upperBound} basis="ESTIMATED" /> upper bound at price cap
          </span>
        )}
        {(usage.routedModels?.length ?? 0) > 0 && <span className="mono-sm">routed to {usage.routedModels!.join(", ")}</span>}
      </div>
    </div>
  );
}
