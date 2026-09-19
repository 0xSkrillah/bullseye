import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "../hooks";

export type RadarEventState = "open" | "investigating" | "published" | "superseded";

/** a real signal to plot. The caller places it; the field never moves or invents one */
export interface RadarEvent {
  id: string;
  label: string;
  /** radians, 0 = right, clockwise */
  angle: number;
  /** 0 = centre, 1 = the outer ring */
  distance: number;
  state: RadarEventState;
}

export interface RadarFieldProps {
  size?: number;
  /** number of decorative dots; they are texture, never events. 0 draws none */
  noise?: number;
  /** "off" draws no sweep at all: a sweep that never stops implies activity */
  sweep?: "loop" | "off";
  /** real signals, drawn as `.event.event-<state>` circles the caller may style; they carry their label as a title */
  events?: RadarEvent[];
  /** an event is locked: the reticle is drawn and the sweep stops */
  locked?: boolean;
  lockAfterMs?: number;
  /** asked once the noise has entered, and again at the same interval while nothing is locked */
  onLock?(): void;
}

/** default fills, so an unstyled event still reads; override with `.be-radar .event-<state>` */
const EVENT_FILL = { open: "var(--ink)", investigating: "var(--uncertain)", published: "var(--verified)", superseded: "var(--ink-muted)" } as const satisfies Record<RadarEventState, string>;

const STEP_MS = 70;
const MIN_ASK_MS = 250;

function seededPositions(count: number): { a: number; d: number }[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, () => ({ a: rnd() * Math.PI * 2, d: 0.15 + 0.82 * rnd() }));
}

function Dot({ cx, cy, instant }: { cx: string; cy: string; instant: boolean }) {
  const [on, setOn] = useState(instant);
  useEffect(() => {
    if (on) return;
    const frame = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(frame);
  }, [on]);
  return <circle className="noise" r="2.5" cx={cx} cy={cy} style={{ opacity: on ? 1 : 0, transition: instant ? "none" : "opacity 240ms ease-out" }} />;
}

/** Seeded, so the picture is identical every run. The field never invents an event: it only asks the owner to lock a real one. */
export function RadarField({ size = 480, noise = 36, locked = false, lockAfterMs = 900, onLock, sweep = "loop", events }: RadarFieldProps) {
  const reduced = useReducedMotion();
  const c = size / 2;
  const R = size / 2 - 8;
  const k = Math.min(1, Math.max(0.5, size / 360));
  const dots = useMemo(() => seededPositions(noise), [noise]);
  const target = { x: c + R * 0.42, y: c - R * 0.31 };

  // a field that mounts already locked, or under reduced motion, is drawn at once
  const [shown, setShown] = useState(locked || reduced ? noise : 0);
  const [reticle, setReticle] = useState<"off" | "entering" | "on">(locked ? "on" : "off");
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const instant = reduced || locked;

  useEffect(() => {
    if (shown >= noise) return;
    if (reduced || locked) {
      setShown(noise);
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, noise, reduced, locked]);

  const ready = shown >= noise;

  useEffect(() => {
    if (!ready || locked) return;
    const id = setInterval(() => onLockRef.current?.(), Math.max(MIN_ASK_MS, reduced ? 0 : lockAfterMs));
    return () => clearInterval(id);
  }, [ready, locked, reduced, lockAfterMs]);

  useEffect(() => {
    if (!locked) {
      setReticle("off");
      return;
    }
    setReticle((r) => (r === "on" ? r : reduced ? "on" : "entering"));
  }, [locked, reduced]);

  useEffect(() => {
    if (reticle !== "entering") return;
    const frame = requestAnimationFrame(() => setReticle("on"));
    return () => cancelAnimationFrame(frame);
  }, [reticle]);

  const f = (n: number) => n.toFixed(1);

  return (
    <div className="be-radar" style={{ width: size, maxWidth: "100%", aspectRatio: "1 / 1" }} data-testid="radar" data-locked={locked}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={events ? `Radar field: ${events.length} ${events.length === 1 ? "signal" : "signals"} plotted${locked ? ", one locked" : ""}` : locked ? "Radar field: decorative noise, one event locked" : "Radar field: decorative noise, no event locked"}
      >
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <circle key={ring} className="grid" cx={c} cy={c} r={f(R * ring)} />
        ))}
        <line className="grid" x1={c} y1={8} x2={c} y2={size - 8} />
        <line className="grid" x1={8} y1={c} x2={size - 8} y2={c} />
        {sweep === "loop" && (
          <path
            className="sweep"
            style={locked ? { animationPlayState: "paused" } : undefined}
            d={`M${c} ${c} L${c} ${f(c - R)} A${R} ${R} 0 0 1 ${f(c + R * Math.sin(0.6))} ${f(c - R * Math.cos(0.6))} Z`}
          />
        )}
        <g className="events" aria-hidden="true">
          {dots.slice(0, shown).map((dot, i) => (
            <Dot key={i} cx={f(c + R * dot.d * Math.cos(dot.a))} cy={f(c + R * dot.d * Math.sin(dot.a))} instant={instant} />
          ))}
          {(locked || (noise > 0 && shown >= noise / 2)) && <circle className={locked ? "target" : "noise"} r={locked ? "3.5" : "2.5"} cx={f(target.x)} cy={f(target.y)} />}
        </g>
        {events && events.length > 0 && (
          <g className="signals">
            {events.map((e) => {
              const d = Math.min(1, Math.max(0, e.distance));
              return (
                <circle key={e.id} className={`event event-${e.state}`} data-state={e.state} data-event={e.id} r={f(4 * k)} cx={f(c + R * d * Math.cos(e.angle))} cy={f(c + R * d * Math.sin(e.angle))} style={{ fill: EVENT_FILL[e.state] }}>
                  <title>{e.label}</title>
                </circle>
              );
            })}
          </g>
        )}
        {reticle !== "off" && (
          <g
            className="lock"
            aria-hidden="true"
            style={{
              transformOrigin: `${f(target.x)}px ${f(target.y)}px`,
              transform: reticle === "entering" ? "scale(1.4)" : "scale(1)",
              opacity: reticle === "entering" ? 0 : 1,
              transition: reduced ? "none" : "transform 320ms ease-out, opacity 320ms ease-out",
            }}
          >
            <circle className="halo" cx={f(target.x)} cy={f(target.y)} r={f(34 * k)} />
            <circle className="reticle" cx={f(target.x)} cy={f(target.y)} r={f(22 * k)} />
            <circle className="reticle" cx={f(target.x)} cy={f(target.y)} r={f(11 * k)} />
            <line className="reticle" x1={f(target.x - 30 * k)} y1={f(target.y)} x2={f(target.x - 16 * k)} y2={f(target.y)} />
            <line className="reticle" x1={f(target.x + 16 * k)} y1={f(target.y)} x2={f(target.x + 30 * k)} y2={f(target.y)} />
            <line className="reticle" x1={f(target.x)} y1={f(target.y - 30 * k)} x2={f(target.x)} y2={f(target.y - 16 * k)} />
            <line className="reticle" x1={f(target.x)} y1={f(target.y + 16 * k)} x2={f(target.x)} y2={f(target.y + 30 * k)} />
          </g>
        )}
      </svg>
    </div>
  );
}
