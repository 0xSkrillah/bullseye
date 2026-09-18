import type { ConfidenceLevel } from "@bullseye/domain";

export interface ConfidenceIndicatorProps {
  level: ConfidenceLevel;
  /** absent in the free preview; the rationale is part of the paid Brief */
  rationale?: string;
  /** GateResult.confidenceCap */
  cap?: ConfidenceLevel;
  capDetail?: string;
  /** gate decision REJECT */
  withdrawn?: boolean;
  size?: 56 | 96;
}

const ARCS: Record<ConfidenceLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const R = 24;
const CIRCUMFERENCE = 2 * Math.PI * R;
const SEGMENT = CIRCUMFERENCE / 3;
const GAP = 4;

export function ConfidenceIndicator({ level, rationale, cap, capDetail, withdrawn = false, size = 56 }: ConfidenceIndicatorProps) {
  const lit = withdrawn ? 0 : ARCS[level];
  const capped = !withdrawn && cap !== undefined && ARCS[cap] < ARCS[level];
  const tone = withdrawn ? "withdrawn" : level === "HIGH" && !capped ? "high" : "medium";
  const label = withdrawn ? "Confidence withdrawn, not published" : `Confidence ${level.toLowerCase()}${capped && cap ? `, capped at ${cap.toLowerCase()}` : ""}`;

  return (
    <div className={`be-conf c-${tone}${size === 96 ? " is-lg" : ""}`} role="img" aria-label={label}>
      <span className="be-conf-ring">
        <svg viewBox="0 0 56 56" aria-hidden="true">
          {[0, 1, 2].map((i) => {
            const on = i < lit;
            const aboveCap = capped && cap !== undefined && i >= ARCS[cap];
            return (
              <circle
                key={i}
                className={on ? (aboveCap ? "cap" : "val") : "track"}
                cx="28"
                cy="28"
                r={R}
                strokeDasharray={`${(SEGMENT - GAP).toFixed(1)} ${(CIRCUMFERENCE - SEGMENT + GAP).toFixed(1)}`}
                strokeDashoffset={(-i * SEGMENT).toFixed(1)}
              />
            );
          })}
        </svg>
        <span className="be-conf-num">{withdrawn ? "✕" : lit}</span>
      </span>
      <span className="be-conf-text">
        <span className="be-conf-band">
          {withdrawn ? "WITHDRAWN" : level}
          {capped && cap ? ` · CAP ${cap}` : ""}
        </span>
        {withdrawn ? <span className="be-conf-why">Gate decision REJECT. Not published.</span> : rationale ? <span className="be-conf-why">{rationale}</span> : null}
        {capped && cap && (
          <span className="be-downrate">
            Capped at {cap} by the publication gate{capDetail ? `: ${capDetail}` : "."}
          </span>
        )}
      </span>
    </div>
  );
}
