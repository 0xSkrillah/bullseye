import { useEffect } from "react";
import "./room.css";
import { ActivityStrip } from "./ActivityStrip";
import { CommercePanel } from "./CommercePanel";
import { INVESTIGATION_LIST_LIMIT } from "./data";
import { EvidenceChain } from "./EvidenceChain";
import { GatePanel } from "./GatePanel";
import { InvestigationPanel } from "./InvestigationPanel";
import { OpportunityBoard } from "./OpportunityBoard";
import { OpportunityField } from "./OpportunityField";
import { StatusStrip } from "./StatusStrip";
import { useRoomData } from "./useRoomData";

/**
 * The Situation Room: one read-only wall view of the desk running itself.
 * SOURCES → SIGNAL → INVESTIGATION → GATE → BRIEF → PAYMENT → DELIVERY → ECONOMICS, left to right.
 * It starts nothing: no scan, no investigation, no quote, no payment. Every figure is an API field
 * (see README.md in this folder); a field that is not there prints as a dash.
 */
export function Room() {
  const d = useRoomData();
  // the page is the desk's; while the room is mounted the tab says which view this is
  useEffect(() => {
    const before = document.title;
    document.title = "Bullseye · Situation Room";
    return () => { document.title = before; };
  }, []);
  const rows = d.signals.data?.signals ?? null;
  // the list route is the count when the server has it; otherwise the signals that carry an investigation
  const listed = d.investigations.data?.state === "ok" ? d.investigations.data.data.investigations : null;
  const onRecord = listed ? listed.length : rows === null ? null : rows.filter((r) => r.investigation).length;
  const running = listed ? listed.filter((i) => i.status === "RUNNING").length : rows === null ? null : rows.filter((r) => r.investigation?.status === "RUNNING").length;
  // the radar measures age against a clock that moves once a minute, so it is not redrawn every second
  const nowMinute = Math.floor(d.now.getTime() / 60_000) * 60_000;
  const focusRow = rows?.find((r) => r.investigation?.id === d.focusId) ?? null;
  const focusRun = d.focus.data?.investigation.id === d.focusId ? d.focus.data.investigation : null;
  const failing = ([["the health check", d.health], ["signals", d.signals], ["Briefs", d.briefs], ["orders", d.commerce], ["desk totals", d.economics], ["desk status", d.deskStatus], ["activity", d.activity], ["investigations", d.investigations], ["the watched run", d.focus], ["its chain", d.chain]] as const)
    .filter(([, poll]) => poll.error !== null).map(([name]) => name);
  const focusSymbol =listed?.find((i) => i.id === d.focusId)?.symbol ?? rows?.find((r) => r.investigation?.id === d.focusId)?.signal.asset.symbol ?? null;
  return (
    <main className="be room">
      <StatusStrip health={d.health} deskStatus={d.deskStatus} now={d.now} />
      <div className="room-row room-row-a">
        <OpportunityField signals={d.signals} deskStatus={d.deskStatus} nowMs={nowMinute} />
        <OpportunityBoard health={d.health.data} signals={d.signals} briefs={d.briefs} commerce={d.commerce} focusId={d.focusId} />
      </div>
      <div className="room-row room-row-b">
        <InvestigationPanel health={d.health.data} onRecord={onRecord} atLeast={listed !== null && listed.length >= INVESTIGATION_LIST_LIMIT} running={running} focusId={d.focusId} focus={d.focus} symbol={focusSymbol} now={d.now} />
        <EvidenceChain investigationsOnRecord={onRecord} focusId={d.focusId} chain={d.chain} live={focusRun?.status === "RUNNING"} onSale={focusRun ? focusRun.briefId !== null && !focusRow?.superseded : null} withdrawn={Boolean(focusRun?.briefId && focusRow?.superseded)} />
        <GatePanel investigationsOnRecord={onRecord} judged={d.judged} expected={d.judgedExpected} error={d.judgedError} listed={listed} rows={rows} briefs={d.briefs.data?.briefs ?? null} focusId={d.focusId} />
        <CommercePanel health={d.health.data} commerce={d.commerce} economics={d.economics} runs={d.judged.map((j) => ({ id: j.investigation.id, symbol: listed?.find((i) => i.id === j.investigation.id)?.symbol ?? null, measuredUsd: j.usage.measuredModelCostUsd ?? null, fixture: j.usage.costBases?.includes("FIXTURE") ?? false }))} />
      </div>
      <ActivityStrip activity={d.activity} now={d.now} />
      {/* One place a screen reader hears that reads have stopped answering: always there, so a change is announced, and one
          sentence for every read that fails at once, rather than a status in each panel that appears with its own text. */}
      <p className="room-sr" role="status">{failing.length > 0 ? `No answer from ${failing.join(", ")}.` : ""}</p>
    </main>
  );
}
