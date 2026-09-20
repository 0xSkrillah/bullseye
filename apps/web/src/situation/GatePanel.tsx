import { GateRule, type BriefPreview, type ConfidenceLevel, type GateResult } from "@bullseye/domain";
import type { SignalRow } from "../lib/api";
import type { InvestigationSummary, RoomInvestigation } from "./data";
import { Panel } from "./Panel";
import { freshAttr, useFreshKeys } from "./useFresh";

export interface GatePanelProps {
  /** how many investigations exist; null while unknown. "No draft" is only said when there is no run at all. */
  investigationsOnRecord: number | null;
  /** the newest runs the gate has judged, oldest first */
  judged?: RoomInvestigation[];
  /** how many judged runs the list names; when there are fewer columns, some reads are pending or failed, and the panel says which. null while that count is not known yet. */
  expected?: number | null;
  error?: string | null;
  listed?: InvestigationSummary[] | null;
  rows?: SignalRow[] | null;
  briefs?: BriefPreview[] | null;
  focusId?: string | null;
}

interface Column {
  id: string;
  symbol: string | null;
  focused: boolean;
  final: GateResult;
  /** every draft the gate judged, oldest first; only the final one when the server kept no record of the others */
  drafts: GateResult[];
  recorded: boolean;
  draftsJudged: number;
  confidence: ConfidenceLevel | null;
}

/**
 * Stage GATE, as a matrix: the domain's rules down the side (so a rule added to the gate appears
 * here by itself), the newest judged runs across. A cell is a finding of that run: ✓ passed,
 * ✕ failed, · not evaluated (a schema failure stops the gate early, and that is shown, not padded).
 * When the server recorded every draft, a cell holds one glyph per draft, oldest first: "✕✓" is a
 * rejected draft followed by a revision that passed. A finding's words are never shown.
 * Confidence is two rows of words, one under the other: the level the Brief claims, and the cap the gate allowed.
 */
export function GatePanel({ investigationsOnRecord, judged = [], expected = 0, error = null, listed = null, rows = null, briefs = null, focusId = null }: GatePanelProps) {
  const none = investigationsOnRecord === 0;
  const columns: Column[] = judged.map((j) => {
    const v = j.investigation;
    const recorded = Array.isArray(v.gateAttempts) && v.gateAttempts.length > 0;
    const drafts = recorded ? v.gateAttempts! : [v.gate!];
    return {
      id: v.id,
      symbol: listed?.find((i) => i.id === v.id)?.symbol ?? rows?.find((r) => r.investigation?.id === v.id)?.signal.asset.symbol ?? null,
      focused: v.id === focusId,
      final: v.gate!,
      drafts,
      recorded,
      draftsJudged: listed?.find((i) => i.id === v.id)?.draftsJudged ?? v.timeline.filter((e) => e.type === "GATE").length,
      confidence: v.briefId ? briefs?.find((b) => b.id === v.briefId)?.confidence ?? null : null,
    };
  });
  const cell = (g: GateResult, rule: GateRule) => g.findings.find((f) => f.rule === rule) ?? null;
  // a run the gate has just judged arrives as a new column; the columns read at load are the baseline, once all of them are in
  const fresh = useFreshKeys(expected !== null && columns.length >= expected ? columns.map((c) => `run:${c.id}`) : null);
  const unrecorded = columns.some((c) => !c.recorded && c.draftsJudged > 1);
  const say = (c: Column, rule: GateRule) => c.drafts.map((g) => { const f = cell(g, rule); return !f ? "not evaluated" : f.passed ? "passed" : "failed"; }).join(", then ");

  return (
    // the footnote takes the head's place when it is needed: a line of its own under the table is a line the wall does not have
    <Panel
      stage="Gate"
      className="room-gate"
      meta={
        expected !== null && columns.length < expected
          ? error ? <span className="room-bad">✕ no answer ({error})</span> : "Fetching…"
          : unrecorded ? "* findings kept for the last draft only" : `${GateRule.options.length} rules · code, not model`
      }
    >
      <table className="room-gate-table">
        <caption className="room-sr">Gate findings: rules by judged run, oldest run first, one mark per draft</caption>
        <thead>
          <tr>
            <th scope="col" className="rule">RULE</th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={c.focused ? "run is-focus" : "run"} {...freshAttr(fresh, `run:${c.id}`)}>
                <span className="sym">{c.focused && <span aria-hidden="true">▸</span>}{c.symbol ?? "—"}</span>
                <span className={c.final.decision === "PUBLISH" ? "room-ok" : "room-bad"}>{c.final.decision}</span>
                {c.focused && <span className="room-sr">, the run shown in the investigation panel</span>}
              </th>
            ))}
            {/* the first row sets the column widths: without this cell the empty state splits the table in half and cuts the rule names */}
            {columns.length === 0 && none && <td className="run" />}
          </tr>
        </thead>
        <tbody>
          {GateRule.options.map((rule) => (
            <tr key={rule}>
              <th scope="row" className="rule">{rule}</th>
              {columns.map((c) => (
                <td key={c.id} className={c.focused ? "run is-focus" : "run"}>
                  <span aria-hidden="true">
                    {c.drafts.map((g, i) => { const f = cell(g, rule); return <span key={i} className={!f ? "room-dim" : f.passed ? "room-ok" : "room-bad"}>{!f ? "·" : f.passed ? "✓" : "✕"}</span>; })}
                  </span>
                  <span className="room-sr">{say(c, rule)}</span>
                </td>
              ))}
              {columns.length === 0 && none && <td className="run room-dim"><span aria-hidden="true">·</span><span className="room-sr">not evaluated</span></td>}
            </tr>
          ))}
        </tbody>
        {columns.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row" className="rule">DRAFTS JUDGED</th>
              {columns.map((c) => <td key={c.id} className={c.focused ? "run is-focus" : "run"} title={c.recorded ? undefined : "only the last draft's findings were recorded"}>{c.draftsJudged}{!c.recorded && c.draftsJudged > 1 ? "*" : ""}</td>)}
            </tr>
            <tr>
              <th scope="row" className="rule">CONFIDENCE CLAIMED</th>
              {columns.map((c) => <td key={c.id} className={c.focused ? "run is-focus small" : "run small"}>{c.confidence ?? "—"}</td>)}
            </tr>
            <tr>
              <th scope="row" className="rule">CAP THE GATE ALLOWED</th>
              {columns.map((c) => <td key={c.id} className={c.focused ? "run is-focus small" : "run small"}>{c.final.confidenceCap}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
      {none && <span className="room-empty-title">NO DRAFT EVALUATED</span>}
    </Panel>
  );
}
