import type { BriefPreview, DataMode } from "@bullseye/domain";
import type { SignalRow, Supersession } from "../lib/api";
import { isPaidOrLater } from "../components/PaymentState";
import type { RadarEvent } from "../components/RadarField";
import type { CommerceSummary, InvestigationSummary } from "./data";
import { BOARD_STAGES, RETRY_PROMISE, type BoardStage } from "./stages";

/**
 * Pure functions from API bodies to what the wall draws. Nothing here invents a value:
 * a read that has not answered gives "unknown", never "none".
 */

/** none: not reached · done: reached · running/pending: in progress or outcome not known · pass: a check passed or money moved and the chain confirmed it · unverified: paid, chain not confirmed · fail · unknown: the read has not answered */
export type NodeState = "none" | "done" | "running" | "pending" | "pass" | "unverified" | "fail" | "unknown";

/** `note` is the short word beside the node; `detail` is said but not drawn (a stop reason is too long for a cell) */
export interface BoardNode { state: NodeState; note?: string; detail?: string }

export interface BoardRow {
  id: string;
  symbol: string;
  mode: DataMode;
  effectiveAt: string;
  changePct: number;
  superseded: Supersession | null;
  investigationId: string | null;
  focused: boolean;
  nodes: Record<BoardStage, BoardNode>;
}

const reached = (n: BoardNode) => n.state !== "none" && n.state !== "unknown";
/** the line between two stages is drawn solid only when both ends were reached */
export const linked = (row: BoardRow, i: number) => i + 1 < BOARD_STAGES.length && reached(row.nodes[BOARD_STAGES[i]!]) && reached(row.nodes[BOARD_STAGES[i + 1]!]);

/** The investigation worth watching: the RUNNING one, else the newest. The list route is newest first. */
export function pickFocus(list: InvestigationSummary[] | null, rows: SignalRow[] | null): string | null {
  if (list && list.length > 0) return (list.find((i) => i.status === "RUNNING") ?? list[0]!).id;
  // an older server has no list and no start times: a RUNNING one if any, else the first row that carries one
  const withInv = (rows ?? []).filter((r) => r.investigation);
  return (withInv.find((r) => r.investigation!.status === "RUNNING") ?? withInv[0])?.investigation!.id ?? null;
}

/**
 * The last three stages of a row, from the furthest state any order for that Brief has reached and
 * how many of the orders at that state the chain confirmed. Green needs all of them confirmed.
 */
function commerceNodes(commerce: CommerceSummary | null, briefId: string | null): Pick<Record<BoardStage, BoardNode>, "PAYMENT" | "DELIVERY" | "ECONOMICS"> {
  const none: BoardNode = { state: "none" };
  if (!briefId) return { PAYMENT: none, DELIVERY: none, ECONOMICS: none };
  if (!commerce) return { PAYMENT: { state: "unknown" }, DELIVERY: { state: "unknown" }, ECONOMICS: { state: "unknown" } };
  const mine = commerce.byBrief.find((b) => b.briefId === briefId);
  // a Brief missing from a list that came back full may have orders older than the list reaches: not known, never "not reached"
  if (!mine) return commerce.atLeast ? { PAYMENT: { state: "unknown" }, DELIVERY: { state: "unknown" }, ECONOMICS: { state: "unknown" } } : { PAYMENT: none, DELIVERY: none, ECONOMICS: none };
  const s = mine.furthestState;
  const confirmed = mine.count > 0 && mine.chainVerified === mine.count;
  const payment: BoardNode = isPaidOrLater(s)
    ? confirmed ? { state: "pass", note: "PAID" } : { state: "unverified", note: "UNVERIFIED" }
    : s === "PAYMENT_UNKNOWN" ? { state: "pending", note: "UNKNOWN", detail: RETRY_PROMISE }
    : s === "RECONCILIATION_REQUIRED" ? { state: "pending", note: "UNKNOWN" }
    : s === "PAYMENT_PENDING" ? { state: "pending", note: "PENDING" }
    : s === "PAYMENT_FAILED" ? { state: "fail", note: "FAILED" }
    : none;
  const delivery: BoardNode = s === "DELIVERED"
    ? confirmed ? { state: "pass", note: "DELIVERED" } : { state: "unverified", note: "DELIVERED" }
    : s === "DELIVERING" ? { state: "running" }
    : s === "DELIVERY_FAILED" ? { state: "fail", note: "FAILED" }
    : none;
  return { PAYMENT: payment, DELIVERY: delivery, ECONOMICS: isPaidOrLater(s) ? { state: "done" } : none };
}

/** One row per signal, newest effective time first; ties keep the API's order. */
export function boardRows(rows: SignalRow[], briefs: BriefPreview[] | null, commerce: CommerceSummary | null, focusId: string | null): BoardRow[] {
  return rows
    .map((r, index) => ({ r, index }))
    .sort((a, b) => b.r.signal.observedAt.localeCompare(a.r.signal.observedAt) || a.index - b.index)
    .map(({ r }) => {
      const inv = r.investigation;
      const brief = inv?.briefId ? briefs?.find((b) => b.id === inv.briefId) ?? null : null;
      const investigation: BoardNode = !inv ? { state: "none" } : inv.status === "RUNNING" ? { state: "running" } : inv.status === "STOPPED" ? { state: "fail", note: "STOPPED", detail: inv.stopReason ?? undefined } : { state: "done" };
      const gate: BoardNode = inv?.status === "PUBLISHED" ? { state: "pass", note: "PUBLISH" } : inv?.status === "REJECTED" ? { state: "fail", note: "REJECT" } : { state: "none" };
      // a Brief whose action the issuer voided is withdrawn from sale; the confidence level is the draft's, shown as a word
      const briefNode: BoardNode = !inv?.briefId ? { state: "none" } : r.superseded ? { state: "fail", note: "WITHDRAWN" } : { state: "done", note: brief?.confidence };
      return {
        id: r.signal.id,
        symbol: r.signal.asset.symbol,
        mode: r.signal.provenance.mode,
        effectiveAt: r.signal.observedAt,
        changePct: r.signal.facts.changePct,
        superseded: r.superseded ?? null,
        investigationId: inv?.id ?? null,
        focused: inv !== null && inv.id === focusId,
        nodes: { SIGNAL: { state: "done" }, INVESTIGATION: investigation, GATE: gate, BRIEF: briefNode, ...commerceNodes(commerce, inv?.briefId ?? null) },
      };
    });
}

export interface FieldMark { id: string; symbol: string; angle: number; distance: number; rejected: boolean; stopped: boolean; label: boolean; state: RadarEvent["state"] }

/**
 * Where each signal sits on the field. Bearing: one per asset, alphabetical, evenly spaced, so an
 * asset keeps its bearing while the list is unchanged. Range: age of the effective time inside the
 * detector's live window, the rim being now and the centre the far end of the window.
 */
export function fieldMarks(rows: SignalRow[], nowMs: number, windowHours: number): { marks: FieldMark[]; outside: number; bearings: number } {
  const symbols = [...new Set(rows.map((r) => r.signal.asset.symbol))].sort();
  const newest = new Map<string, string>();
  for (const r of rows) { const s = r.signal.asset.symbol; if (!newest.has(s) || r.signal.observedAt > newest.get(s)!) newest.set(s, r.signal.observedAt); }
  const labelled = new Set<string>();
  const marks: FieldMark[] = [];
  let outside = 0;
  for (const r of rows) {
    const ageH = (nowMs - Date.parse(r.signal.observedAt)) / 3_600_000;
    if (!(ageH <= windowHours)) { outside += 1; continue; }
    const symbol = r.signal.asset.symbol;
    const inv = r.investigation;
    const isNewest = newest.get(symbol) === r.signal.observedAt && !labelled.has(symbol);
    if (isNewest) labelled.add(symbol);
    marks.push({
      id: r.signal.id,
      symbol,
      angle: -Math.PI / 2 + (symbols.indexOf(symbol) / symbols.length) * 2 * Math.PI,
      distance: Math.min(1, Math.max(0, 1 - Math.max(0, ageH) / windowHours)),
      rejected: inv?.status === "REJECTED",
      stopped: inv?.status === "STOPPED",
      label: isNewest,
      state: r.superseded ? "superseded" : !inv ? "open" : inv.status === "RUNNING" ? "investigating" : inv.status === "PUBLISHED" ? "published" : "open",
    });
  }
  return { marks, outside, bearings: symbols.length };
}
