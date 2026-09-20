import type { ReactNode } from "react";
import type { Health, OperatorRoutes } from "../lib/api";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { Enum } from "../primitives/Enum";
import { Timestamp } from "../primitives/Timestamp";
import type { DeskStatus, Feed } from "./data";
import { freshAttr, useFreshKeys } from "./useFresh";

export interface StatusStripProps {
  health: PollResult<Health>;
  deskStatus: PollResult<Feed<DeskStatus>>;
  now: Date;
}

const OPERATOR_LINE = {
  DISABLED: "read-only for visitors",
  TOKEN_REQUIRED: "operator token only",
  OPEN_ON_LOCALHOST: "open on this machine",
} as const satisfies Record<OperatorRoutes, string>;

function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`room-cell${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      <span className="room-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * READY is a check that passed; NOT READY is a stage that cannot run. The reason is the API's own sentence.
 * Once the health check stops answering, the last answer is only "last known": no tick, no cross, no green.
 */
function Readiness({ ready, stale, fresh }: { ready: boolean; stale: boolean; fresh: boolean }) {
  if (stale) return <span className="room-state room-unknown">{ready ? "READY" : "NOT READY"}</span>;
  const changed = fresh ? { "data-fresh": "" } : {};
  return ready ? <span className="room-state room-ok" {...changed}>✓ READY</span> : <span className="room-state room-bad" {...changed}>✕ NOT READY</span>;
}

/** Can the desk run? Everything here is one GET /api/health, plus the auto desk's last tick when the server reports it. */
export function StatusStrip({ health, deskStatus, now }: StatusStripProps) {
  const h = health.data;
  const desk = deskStatus.data?.state === "ok" ? deskStatus.data.data : null;
  const iso = now.toISOString();
  const stale = health.error !== null;
  const known = stale ? "last known · " : "";
  // a next tick is only "next" while it is still ahead: between two reads of the desk status it can fall into the past
  const upcoming = desk?.nextTickAt && Date.parse(desk.nextTickAt) > now.getTime() ? desk.nextTickAt : null;
  // a readiness that flipped, or a tick of the unattended loop, is marked once when the answer that carries it arrives
  const fresh = useFreshKeys(h ? [`model:${h.synthesis.ready}`, `rail:${h.paymentRail.ready}`] : null);
  // the tick has its own baseline, the first answer of the desk status route, whichever of the two reads answers first
  const freshTick = useFreshKeys(desk ? (desk.lastTick ? [`tick:${desk.lastTick.at}`] : []) : null);
  // the desk status can stop answering while the health check still does: what it last said is then only "last known"
  const deskKnown = stale || (desk !== null && deskStatus.error !== null) ? "last known · " : "";

  return (
    <section className="room-strip" aria-label="Desk status">
      <div className="room-cell room-brand">
        <span className="room-brand-row">
          <svg className="room-mark" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="13" /><circle cx="14" cy="14" r="8" /><circle className="core" cx="14" cy="14" r="3" />
          </svg>
          <span className="room-wordmark">BULLSEYE</span>
        </span>
        <h1 className="room-label">Situation room</h1>
      </div>

      {!h ? (
        <Cell label="API" className="room-cell-grow">
          {health.error ? <span className="room-state room-bad">✕ API UNREACHABLE</span> : <span className="room-state">Fetching…</span>}
          <span className="room-line">{health.error ? `GET /api/health: ${health.error} · asking again` : "GET /api/health"}</span>
        </Cell>
      ) : (
        <>
          <Cell label="Data source">
            <span className="room-state-row"><ProvenanceBadge kind={h.dataSource.mode} /></span>
            {health.error ? (
              <span className="room-line room-bad">✕ no answer{health.updatedAt !== null && <> since <Timestamp iso={new Date(health.updatedAt).toISOString()} /></>}</span>
            ) : (
              <span className="room-line">API clock <Timestamp iso={h.dataSource.asOf} /></span>
            )}
          </Cell>

          <Cell label="Model" className={h.synthesis.ready ? undefined : "room-cell-wide"}>
            <Readiness ready={h.synthesis.ready} stale={stale} fresh={fresh.has(`model:${h.synthesis.ready}`)} />
            <span className={`room-line${h.synthesis.ready ? "" : " room-ink"}`}>{known}{h.synthesis.ready ? h.synthesis.model : h.synthesis.detail}</span>
          </Cell>

          <Cell label="Payment rail" className="room-cell-grow">
            <span className="room-state-row">
              <Readiness ready={h.paymentRail.ready} stale={stale} fresh={fresh.has(`rail:${h.paymentRail.ready}`)} />
              {(h.paymentRail.isTestnet || h.paymentRail.rail !== "OKX_X402_MAINNET") && (
                <>
                  <ProvenanceBadge kind="TESTNET" title={h.paymentRail.rail === "FIXTURE" ? "Fixture rail: no funds move on any chain. Not revenue." : undefined} />
                  <span className="room-line">Not revenue.</span>
                </>
              )}
            </span>
            <span className={`room-line${h.paymentRail.ready ? "" : " room-ink"}`}>
              {known}{h.paymentRail.ready ? <><Enum value={h.paymentRail.rail} /> · {h.paymentRail.network}</> : h.paymentRail.detail}
            </span>
          </Cell>

          <Cell label="Auto desk">
            <span className="room-state-row">
              <span className="room-state">{!h.autoDesk ? "—" : h.autoDesk.enabled ? "● ON" : "○ OFF"}</span>
              {/* what the loop did on its last tick, in the server's own enums; its `detail` can carry an error's text and stays off the wall */}
              {desk?.lastTick && (
                <span className="room-line" {...freshAttr(freshTick, `tick:${desk.lastTick.at}`)}>
                  {deskKnown}tick <Timestamp iso={desk.lastTick.at} /> · <span className="room-ink"><Enum value={desk.lastTick.action} /></span>{desk.lastTick.reason ? <> · <Enum value={desk.lastTick.reason} /></> : null}
                </span>
              )}
            </span>
            <span className="room-line">
              {/* the 24 h count is every investigation, whoever started it; the cap is where the loop stops starting more */}
              {deskKnown}{!h.autoDesk ? "not reported by this server" : h.autoDesk.enabled
                ? <>every {h.autoDesk.intervalMinutes} min · {desk ? `${desk.investigationsLast24h} run${desk.investigationsLast24h === 1 ? "" : "s"} in 24 h · loop stops at ${h.autoDesk.maxInvestigationsPerDay}` : `cap ${h.autoDesk.maxInvestigationsPerDay} / day`}{upcoming ? <> · next <Timestamp iso={upcoming} /></> : null}</>
                : "no unattended runs"}
            </span>
          </Cell>

          <Cell label="Operator routes">
            <span className="room-state">{h.operatorRoutes ? <Enum value={h.operatorRoutes} /> : "—"}</span>
            <span className="room-line">{known}{h.operatorRoutes ? OPERATOR_LINE[h.operatorRoutes] : "not reported by this server"}</span>
          </Cell>
        </>
      )}

      <div className="room-cell room-clock" role="group" aria-label="Clock, UTC">
        <time className="room-clock-time" dateTime={iso}>{iso.slice(11, 19)}Z</time>
        <span className="room-line">{iso.slice(0, 10)} · UTC</span>
      </div>
    </section>
  );
}
