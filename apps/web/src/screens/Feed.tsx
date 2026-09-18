import type { SignalRow } from "../lib/api";
import { SignalCard } from "../components/SignalCard";
import { RadarField } from "../components/RadarField";

export interface FeedProps { rows: SignalRow[]; lockedId: string | null; listening: boolean; onLock(id: string): void; onRadarLock(): void }

/** Stage SIGNAL: the radar and the SignalCard list, newest first. */
export function Feed({ rows, lockedId, listening, onLock, onRadarLock }: FeedProps) {
  const sorted = [...rows].sort((a, b) => b.signal.detectedAt.localeCompare(a.signal.detectedAt));
  return (
    <>
      <span className="be-stage">Feed</span>
      <div style={{ display: "grid", placeItems: "center" }}><RadarField size={lockedId ? 160 : 272} noise={Math.max(12, Math.min(36, rows.length + 30))} locked={!!lockedId} onLock={onRadarLock} /></div>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
        {listening && rows.length === 0 ? "Listening…" : `${rows.length} events · ${lockedId ? 1 : 0} locked`}
      </span>
      {rows.length === 0 && !listening && <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>No events in the last 15 min.</span>}
      <div style={{ display: "grid", gap: 16 }}>
        {sorted.map((r) => <SignalCard key={r.signal.id} signal={r.signal} locked={r.signal.id === lockedId} noise={!r.investigation && r.signal.id !== lockedId} onLock={onLock} />)}
      </div>
    </>
  );
}
