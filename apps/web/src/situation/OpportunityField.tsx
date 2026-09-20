import type { DataMode } from "@bullseye/domain";
import type { SignalRow } from "../lib/api";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { RadarField } from "../components/RadarField";
import { POLL_MS, type DeskStatus, type Feed } from "./data";
import { fieldMarks } from "./model";
import { FeedFoot, Panel } from "./Panel";

export interface OpportunityFieldProps {
  signals: PollResult<{ dataMode: DataMode; signals: SignalRow[] }>;
  deskStatus: PollResult<Feed<DeskStatus>>;
  /** the clock the ages are measured against, in ms; the room passes one that moves once a minute */
  nowMs: number;
}

/** RadarField's own geometry for a field of this size: centre, and the outer ring 8px inside the edge */
const SIZE = 340, C = SIZE / 2, R = SIZE / 2 - 8;
const f1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Stage SOURCES / SIGNAL. The radar is the shared RadarField with its texture switched off (no
 * decorative dots, no sweep) and no `onLock`, so the room can never start an investigation.
 * It plots real signals only: bearing by asset, range by age inside the detector's live window.
 * The words on top (asset names, ring hours, the cross on a run the gate rejected or that was stopped) are an overlay of the room's.
 */
export function OpportunityField({ signals, deskStatus, nowMs }: OpportunityFieldProps) {
  const rows = signals.data?.signals ?? null;
  const windowHours = deskStatus.data?.state === "ok" ? deskStatus.data.data.liveWindowHours : undefined;
  const placed = rows && windowHours !== undefined ? fieldMarks(rows, nowMs, windowHours) : null;
  const at = (angle: number, r: number) => ({ x: f1(C + r * Math.cos(angle)), y: f1(C + r * Math.sin(angle)) });
  // ring hours sit on a bearing half-way between the first two assets, so they never land on a signal
  const tickAngle = -Math.PI / 2 + Math.PI / Math.max(3, placed?.bearings ?? 0);

  return (
    <Panel
      stage="Sources · Opportunity field"
      className="room-field"
      meta={signals.data ? <ProvenanceBadge kind={signals.data.dataMode} /> : undefined}
      foot={<FeedFoot route="/api/signals" everyMs={POLL_MS.signals} updatedAt={signals.updatedAt} error={signals.error} />}
    >
      <div className="room-radar">
        <div className="room-radar-box">
          <RadarField size={SIZE} noise={0} sweep="off" events={placed?.marks.map((m) => ({ id: m.id, label: m.symbol, angle: m.angle, distance: m.distance, state: m.state }))} />
          {placed && windowHours !== undefined && (
            <svg className="room-svg room-radar-words" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
              {/* with nothing plotted the rings have nothing to measure, and the words "NO SIGNAL ON RECORD" take the middle: the legend still gives the scale */}
              {placed.marks.length > 0 && ([1, 0.75, 0.5, 0.25] as const).map((k) => {
                const p = at(tickAngle, R * k - 4);
                return <text key={k} className="ring" x={p.x} y={p.y + 12} textAnchor="middle">{k === 1 ? "NOW" : `${f1(windowHours * (1 - k))} H`}</text>;
              })}
              {placed.marks.map((m) => {
                const p = at(m.angle, R * m.distance), co = Math.cos(m.angle), si = Math.sin(m.angle);
                const l = at(m.angle, R * m.distance - 16);
                return (
                  <g key={m.id}>
                    {m.state === "published" && <circle className="reticle" cx={p.x} cy={p.y} r="9" />}
                    {/* each state has a shape of its own, as on the board: the dot's colour alone is not enough */}
                    {m.state === "investigating" && <path className="half" d={`M${p.x} ${p.y - 9} A9 9 0 0 1 ${p.x} ${p.y + 9}`} />}
                    {m.state === "superseded" && <path className="voided" d={`M${p.x - 7} ${p.y + 7} L${p.x + 7} ${p.y - 7}`} />}
                    {(m.rejected || m.stopped) && <path className="cross" d={`M${p.x - 5} ${p.y - 5} L${p.x + 5} ${p.y + 5} M${p.x - 5} ${p.y + 5} L${p.x + 5} ${p.y - 5}`} />}
                    {m.label && <text className={m.state === "open" && !m.rejected && !m.stopped ? "name" : "name is-known"} x={l.x} y={l.y + (si > 0.3 ? -2 : si < -0.3 ? 12 : 5)} textAnchor={co > 0.3 ? "end" : co < -0.3 ? "start" : "middle"}>{m.symbol}</text>}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        {rows === null ? (
          <div className="room-radar-note"><span className="room-line">{signals.error ? "✕ no answer" : "Fetching…"}</span></div>
        ) : rows.length === 0 ? (
          <div className="room-radar-note">
            <span className="room-empty-title">NO SIGNAL ON RECORD</span>
            <span className="room-line">the field plots real events only</span>
          </div>
        ) : null}
      </div>
      <div className="room-legend">
        <span>● open &#160;<span className="room-unknown">◐</span> running &#160;◎ on sale &#160;<span className="room-bad">✕</span> rejected/stopped &#160;⊘ superseded</span>
        <span>
          {windowHours === undefined ? (rows && rows.length > 0 ? "not plotted: scale not available yet" : "scale not available yet") : `rim = now · centre = ${windowHours} h`}
          {placed && placed.outside > 0 ? ` · ${placed.outside} older, not plotted` : ""}
        </span>
      </div>
    </Panel>
  );
}
