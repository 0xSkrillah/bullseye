import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PollResult } from "../lib/usePoll";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { fullTime } from "../format";
import { Timestamp } from "../primitives/Timestamp";
import type { ActivityResponse, Feed } from "./data";
import { RETRY_PROMISE } from "./stages";
import { freshAttr, useFreshKeys } from "./useFresh";

export interface ActivityStripProps {
  activity: PollResult<Feed<ActivityResponse>>;
  /** the wall clock; an event from another UTC day prints its date, so yesterday's 17:33 never reads as today's */
  now?: Date;
}

/** more than one line of the wall holds; the line shows as many whole events as fit and never half of one */
const SHOWN = 8;
const keyOf = (e: { at: string; kind: string; refId: string; state?: string | null }) => `${e.at}-${e.kind}-${e.refId}-${e.state ?? ""}`;

/**
 * The bottom line of the wall: real events only, newest first, UTC. It is a ticker that only ticks
 * when something happened: it never scrolls on its own, and a new event slides in at the front once,
 * when GET /api/activity first returns it. `summary` is written by the server's
 * code from stored fields, never by a model, and is printed as it arrives.
 */
export function ActivityStrip({ activity, now }: ActivityStripProps) {
  const feed = activity.data;
  const events = feed?.state === "ok" ? [...feed.data.events].sort((a, b) => b.at.localeCompare(a.at)) : null;
  const fresh = useFreshKeys(events ? events.map(keyOf) : null);
  const today = now ? now.toISOString().slice(0, 10) : null;

  // The wall's rows cannot grow, and an event is left out, never cut: one that is wider than a whole row is measured
  // and dropped, so the next whole event takes its place. Layouts that scroll wrap such an event instead, and none is dropped.
  const list = useRef<HTMLOListElement>(null);
  const [tooWide, setTooWide] = useState<ReadonlySet<string>>(new Set());
  const [measured, setMeasured] = useState(0);
  // while a reset puts dropped events back to be measured again, the list is busy: a reader is not told of them as news
  const [busy, setBusy] = useState(false);
  const signature = events ? events.map(keyOf).join("\n") : "";
  useLayoutEffect(() => {
    const wide = [...(list.current?.children ?? [])].filter((li) => li.scrollWidth > li.clientWidth + 1).map((li) => li.getAttribute("data-key") ?? "");
    if (wide.length > 0) setTooWide((old) => new Set([...old, ...wide]));
    else setBusy(false);
  }, [signature, measured, tooWide.size]);
  useEffect(() => {
    const ol = list.current;
    if (!ol || typeof ResizeObserver === "undefined") return;
    let live = true;
    let width = ol.clientWidth;
    // a wider row, or the display face arriving in place of its wider fallback, can make room again: start over
    const again = () => { if (live) { setBusy(true); setTooWide(new Set()); setMeasured((n) => n + 1); } };
    const watch = new ResizeObserver(() => { if (ol.clientWidth !== width) { width = ol.clientWidth; again(); } });
    watch.observe(ol);
    void document.fonts?.ready.then(again);
    return () => { live = false; watch.disconnect(); };
  }, []);
  return (
    <section className="room-activity" aria-label="Activity">
      <span className="room-label">Activity</span>
      <span className="room-activity-rule" aria-hidden="true" />
      {feed === null ? (
        <span className="room-activity-state">{activity.error ? "NO ANSWER" : "Fetching…"}</span>
      ) : feed.state === "unavailable" ? (
        <span className="room-activity-state">ACTIVITY FEED NOT AVAILABLE YET</span>
      ) : events !== null && events.length === 0 ? (
        <span className="room-activity-state">NO EVENTS ON RECORD</span>
      ) : null}
      {/* Always there, empty until something happens, so the first event is announced like every other: politely, as an addition. */}
      <ol className="room-activity-events" ref={list} aria-live="polite" aria-relevant="additions" aria-busy={busy || undefined} aria-label="Activity events, newest first">
          {(events ?? []).filter((e) => !tooWide.has(keyOf(e))).slice(0, SHOWN).map((e) => (
            <li key={keyOf(e)} data-key={keyOf(e)} data-kind={e.kind} {...freshAttr(fresh, keyOf(e))}>
              <Timestamp iso={e.at} full={today !== null && fullTime(e.at).slice(0, 10) !== today} className="room-line" />
              {/* a quote's sentence carries its price as text; an amount only ever renders through <Money>, so the wall leaves it out */}
              <span className="what">{e.kind === "QUOTE_ISSUED" ? `${e.symbol ?? "Brief"}: quote issued` : e.summary}</span>
              {e.rail !== null && e.rail !== "OKX_X402_MAINNET" && (
                <>
                  <ProvenanceBadge kind="TESTNET" title={e.rail === "FIXTURE" ? "Fixture rail: no funds move on any chain. Not revenue." : undefined} />
                  <span className="room-line">Not revenue.</span>
                </>
              )}
              {e.state === "PAYMENT_UNKNOWN" && <span className="room-line room-unknown">{RETRY_PROMISE}</span>}
            </li>
          ))}
      </ol>
      <span className="room-line room-activity-source">
        {activity.error ? <span className="room-bad">✕ GET /api/activity: {activity.error}</span> : <><span>GET /api/activity</span><span>newest first · UTC</span></>}
      </span>
    </section>
  );
}
