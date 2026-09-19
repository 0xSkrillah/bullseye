import type { PaymentRail } from "@bullseye/domain";
import type { Db } from "../db.js";

export const ACTIVITY_KINDS = [
  "SIGNAL_DETECTED",
  "SIGNAL_SUPERSEDED",
  "INVESTIGATION_STARTED",
  "GATE_DECISION",
  "INVESTIGATION_PUBLISHED",
  "INVESTIGATION_REJECTED",
  "INVESTIGATION_STOPPED",
  "QUOTE_ISSUED",
  "ORDER_STATE",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  at: string;
  kind: ActivityKind;
  /** id of the signal, investigation, quote or order the event is about */
  refId: string;
  symbol: string | null;
  /** written by code from stored fields; never model text and never an upstream error message */
  summary: string;
  /** order and quote events only, so a testnet payment can be labelled as one */
  rail: PaymentRail | null;
  /** ORDER_STATE only */
  state: string | null;
}

type Row = Record<string, string | number | null>;
const parse = <T>(json: string | null | undefined): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

/**
 * One time-ordered feed of things that happened, newest first, assembled from the tables that
 * already record them. Each source is read newest-first up to `limit`, so the merge is exact.
 */
export function recentActivity(db: Db, limit: number): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const symbolOf = (signalJson: string | null) => parse<{ asset?: { symbol?: string } }>(signalJson)?.asset?.symbol ?? null;

  for (const r of db.prepare("SELECT id, json, detected_at, superseded_json FROM signals ORDER BY detected_at DESC LIMIT ?").all(limit) as Row[]) {
    const signal = parse<{ headline?: string }>(String(r.json));
    const symbol = symbolOf(String(r.json));
    events.push({ at: String(r.detected_at), kind: "SIGNAL_DETECTED", refId: String(r.id), symbol, summary: signal?.headline ?? `${symbol ?? "signal"} detected`, rail: null, state: null });
    const sup = parse<{ byVersion?: number; reason?: string; notedAt?: string }>(r.superseded_json as string | null);
    if (sup?.notedAt) events.push({ at: sup.notedAt, kind: "SIGNAL_SUPERSEDED", refId: String(r.id), symbol, summary: `${symbol ?? "signal"}: issuer ${sup.reason === "CANCELLED" ? "cancelled" : "replaced"} the action (v${sup.byVersion ?? "?"})`, rail: null, state: null });
  }

  const investigations = db
    .prepare("SELECT i.id, i.status, i.stop_reason, i.started_at, i.finished_at, i.brief_id, s.json AS signal_json FROM investigations i LEFT JOIN signals s ON s.id = i.signal_id ORDER BY i.started_at DESC LIMIT ?")
    .all(limit) as Row[];
  for (const r of investigations) {
    const symbol = symbolOf(r.signal_json as string | null);
    const name = symbol ?? "investigation";
    events.push({ at: String(r.started_at), kind: "INVESTIGATION_STARTED", refId: String(r.id), symbol, summary: `${name}: investigation started`, rail: null, state: null });
    if (r.finished_at !== null && r.status !== "RUNNING") {
      const kind = r.status === "PUBLISHED" ? "INVESTIGATION_PUBLISHED" : r.status === "REJECTED" ? "INVESTIGATION_REJECTED" : "INVESTIGATION_STOPPED";
      const summary = r.status === "PUBLISHED" ? `${name}: Brief ${String(r.brief_id)} published` : r.status === "REJECTED" ? `${name}: rejected by the gate, nothing published` : `${name}: stopped (${String(r.stop_reason ?? "unknown")}), nothing published`;
      events.push({ at: String(r.finished_at), kind, refId: String(r.id), symbol, summary, rail: null, state: null });
    }
    // the label is written by the investigator from the gate's decision and rule names; the detail, which can quote a draft, is left out
    for (const t of db.prepare("SELECT json FROM timeline WHERE investigation_id = ? AND json LIKE '%\"type\":\"GATE\"%' ORDER BY seq").all(String(r.id)) as Row[]) {
      const entry = parse<{ at?: string; label?: string }>(String(t.json));
      if (entry?.at && entry.label) events.push({ at: entry.at, kind: "GATE_DECISION", refId: String(r.id), symbol, summary: `${name}: ${entry.label}`, rail: null, state: null });
    }
  }

  const briefSymbol = new Map<string, string | null>();
  const symbolForBrief = (briefId: string) => {
    if (!briefSymbol.has(briefId)) {
      const row = db.prepare("SELECT s.json AS signal_json FROM briefs b LEFT JOIN signals s ON s.id = b.signal_id WHERE b.id = ?").get(briefId) as Row | undefined;
      briefSymbol.set(briefId, symbolOf((row?.signal_json as string | null) ?? null));
    }
    return briefSymbol.get(briefId) ?? null;
  };
  type Terms = { briefId?: string; priceUsd?: string; rail?: PaymentRail };

  for (const r of db.prepare("SELECT id, terms_json, created_at FROM quotes ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]) {
    const terms = parse<Terms>(String(r.terms_json));
    const symbol = terms?.briefId ? symbolForBrief(terms.briefId) : null;
    events.push({ at: String(r.created_at), kind: "QUOTE_ISSUED", refId: String(r.id), symbol, summary: `${symbol ?? "Brief"}: quote issued at $${terms?.priceUsd ?? "?"}`, rail: terms?.rail ?? null, state: null });
  }

  const orderEvents = db
    .prepare("SELECT e.order_id, e.at, e.from_state, e.to_state, q.terms_json FROM order_events e JOIN orders o ON o.id = e.order_id JOIN quotes q ON q.id = o.quote_id ORDER BY e.at DESC, e.seq DESC LIMIT ?")
    .all(limit) as Row[];
  for (const r of orderEvents) {
    const terms = parse<Terms>(String(r.terms_json));
    const symbol = terms?.briefId ? symbolForBrief(terms.briefId) : null;
    // the stored reason can carry a facilitator's or an RPC's own words, so only the states are published
    events.push({ at: String(r.at), kind: "ORDER_STATE", refId: String(r.order_id), symbol, summary: `${symbol ?? "order"}: ${r.from_state === null ? "" : `${String(r.from_state)} → `}${String(r.to_state)}`, rail: terms?.rail ?? null, state: String(r.to_state) });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
