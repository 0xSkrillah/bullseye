import type { MarketObservation } from "./data";
import { fullTime } from "../format";

/**
 * The multiplier, as observed. One dot per recorded observation at its own timestamp, and a marker
 * at the issuer's effective time.
 *
 * Nothing is drawn between two dots. A line between observations would assert that the desk knows
 * what the value was in between, and it does not: it knows what `multiplier()` returned in the
 * blocks it actually read. Two reads either side of an activation do not say which block changed —
 * that is a separate read, and it gets its own dot when it exists. There are no candles here and
 * no history before the first observation, because neither was observed.
 */
export interface ObservationsProps {
  points: MarketObservation[];
  eventMarkerAt: string | null;
  note: string;
  chainWithheld: boolean;
  chainReadCount: number;
}

const W = 720;
const H = 240;
const PAD = { top: 22, right: 78, bottom: 34, left: 72 };

export function Observations({ points, eventMarkerAt, note, chainWithheld, chainReadCount }: ObservationsProps) {
  const usable = points.filter((p) => Number.isFinite(Date.parse(p.at)) && /^\d+(\.\d+)?$/.test(p.multiplier));
  if (usable.length === 0) {
    return (
      <div className="mk-chart" data-testid="market-chart">
        <p className="mk-note">No observation of this multiplier has been recorded, so there is nothing to draw.</p>
      </div>
    );
  }

  const times = usable.map((p) => Date.parse(p.at));
  const values = usable.map((p) => Number(p.multiplier));
  const marker = eventMarkerAt && Number.isFinite(Date.parse(eventMarkerAt)) ? Date.parse(eventMarkerAt) : null;
  const tMinRaw = Math.min(...times, marker ?? Infinity);
  const tMaxRaw = Math.max(...times, marker ?? -Infinity);
  // every observation at one instant (the issuer's step alone): give the axis a minute either side
  const span = tMaxRaw - tMinRaw;
  const tMin = span > 0 ? tMinRaw - span * 0.08 : tMinRaw - 60_000;
  const tMax = span > 0 ? tMaxRaw + span * 0.08 : tMaxRaw + 60_000;

  const vMinRaw = Math.min(...values);
  const vMaxRaw = Math.max(...values);
  const vSpan = vMaxRaw - vMinRaw;
  const vMin = vSpan > 0 ? vMinRaw - vSpan * 0.35 : vMinRaw * 0.999;
  const vMax = vSpan > 0 ? vMaxRaw + vSpan * 0.35 : vMaxRaw * 1.001;

  const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - ((v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom);

  // one gridline per distinct observed value: the axis shows values that were seen, not a round scale
  const distinct = [...new Set(usable.map((p) => p.multiplier))].sort((a, b) => Number(a) - Number(b));

  return (
    <div className="mk-chart" data-testid="market-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Multiplier observations for this event. ${usable.length} recorded observations. ${note}`}>
        {distinct.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(Number(v))} y2={y(Number(v))} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={PAD.left - 8} y={y(Number(v)) + 4} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-muted)">
              {Number(v) === 1 ? "1" : Number(v).toFixed(6)}
            </text>
          </g>
        ))}

        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--line-strong)" strokeWidth="1" />

        {marker !== null && (
          <g>
            <line x1={x(marker)} x2={x(marker)} y1={PAD.top - 12} y2={H - PAD.bottom} stroke="var(--invalid)" strokeWidth="2" />
            <text x={x(marker)} y={PAD.top - 16} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--invalid)">
              EFFECTIVE
            </text>
          </g>
        )}

        {usable.map((p, n) => {
          const cx = x(Date.parse(p.at));
          const cy = y(Number(p.multiplier));
          const issuer = p.source === "ISSUER";
          return (
            <g key={`${p.key}-${p.evidenceId ?? n}`}>
              <circle cx={cx} cy={cy} r={issuer ? 5 : 4.5} fill={issuer ? "var(--ink)" : "var(--uncertain)"} stroke="var(--canvas-inset)" strokeWidth="1.5">
                <title>{`${p.source} ${p.key}: ${p.multiplier} at ${fullTime(p.at)}${p.blockNumber === null ? "" : ` (block ${p.blockNumber})`}`}</title>
              </circle>
            </g>
          );
        })}

        <text x={PAD.left} y={H - PAD.bottom + 16} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-muted)">
          {fullTime(new Date(tMin).toISOString())}
        </text>
        <text x={W - PAD.right} y={H - PAD.bottom + 16} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-muted)">
          {fullTime(new Date(tMax).toISOString())}
        </text>
      </svg>

      <div className="mk-chart-legend">
        <span className="mk-key is-issuer">
          <i /> Issuer published
        </span>
        <span className="mk-key is-chain">
          <i /> multiplier() on X Layer
        </span>
        <span className="mk-key is-event">
          <i /> Effective time
        </span>
        <span>
          {usable.length} observation{usable.length === 1 ? "" : "s"}
          {chainWithheld && chainReadCount > 0 ? ` · ${chainReadCount} on-chain reads withheld` : ""}
        </span>
      </div>
      <p className="mk-note">{note}</p>
    </div>
  );
}
