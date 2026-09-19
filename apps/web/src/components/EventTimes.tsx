import type { Brief, SignalEvent } from "@bullseye/domain";
import { instantMs } from "../format";
import { Timestamp } from "../primitives/Timestamp";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface EventTimesProps {
  signal: SignalEvent;
  publishedAt: string;
  now: Date | string;
  /** the issuer cancelled or replaced the action after it was flagged */
  withdrawn?: { byVersion: number; reason: "CANCELLED" | "REPLACED"; notedAt: string } | null;
  /** present once the Brief is delivered: the chain's own activation time is part of what was bought */
  brief?: Brief | null;
}

/** anything detected this long after it took effect is a look back, not a warning */
export const RETROSPECTIVE_AFTER_MS = 60 * 60_000;

export function span(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const row = { display: "contents" } as const;
/** values are set in the mono face; the sentences that explain them are prose */
const prose = { fontFamily: "var(--font-sans)", color: "var(--ink-secondary)" } as const;

/**
 * Four different clocks, kept apart: when the event took effect, when the desk first saw it, when its
 * sources were last fetched, and when the Brief was published. LIVE says how data was fetched; it says
 * nothing about how old the event is, and a Brief about yesterday's event is not an early warning.
 */
export function EventTimes({ signal, publishedAt, now, withdrawn = null, brief = null }: EventTimesProps) {
  const effective = Date.parse(signal.observedAt);
  const detectionLag = Date.parse(signal.detectedAt) - effective;
  const retrospective = detectionLag > RETROSPECTIVE_AFTER_MS;
  const fetched = signal.sources.map((s) => s.fetchedAt).sort().at(-1) ?? null;
  const activation = brief?.evidence.find((e) => e.kind === "ONCHAIN_ACTIVATION_BLOCK")?.values.activationTimestamp;

  return (
    <section data-testid="event-times" data-retrospective={retrospective} aria-label="Event times">
      <h2>When</h2>
      <dl className="be-kv" style={{ gridTemplateColumns: "minmax(88px, 34%) minmax(0, 1fr)", rowGap: 6 }}>
        <div style={row}>
          <dt>Issuer effective time</dt>
          <dd><Timestamp iso={signal.observedAt} full /> · {span(instantMs(now) - effective)} ago</dd>
        </div>
        <div style={row}>
          <dt>First detected here</dt>
          <dd data-testid="detection-lag">
            <Timestamp iso={signal.detectedAt} full /> · {detectionLag >= 0 ? `${span(detectionLag)} after it took effect` : `${span(detectionLag)} before it took effect`}
            {retrospective && <span style={prose}><br /><b style={{ color: "var(--uncertain)" }}>Retrospective.</b> A look back at an event that had already happened: not an early warning, and no detection latency is claimed from it.</span>}
          </dd>
        </div>
        <div style={row}>
          <dt>Sources last fetched</dt>
          <dd>{fetched ? <Timestamp iso={fetched} full /> : "not recorded"} <ProvenanceBadge kind={signal.provenance.mode} title="How the detector's inputs were obtained. It does not describe the age of the event." /></dd>
        </div>
        <div style={row}>
          <dt>On-chain activation</dt>
          <dd>{typeof activation === "string" ? <Timestamp iso={activation} full /> : <span style={prose}>{brief ? "No change found in the searched window." : "In the Brief: the first X Layer block with the new multiplier, and its lag against the issuer."}</span>}</dd>
        </div>
        <div style={row}>
          <dt>Brief published</dt>
          <dd><Timestamp iso={publishedAt} full /> · {span(Date.parse(publishedAt) - effective)} after the effective time</dd>
        </div>
        <div style={row}>
          <dt>Still current</dt>
          <dd data-testid="currentness" style={withdrawn ? { color: "var(--invalid)" } : undefined}>
            {withdrawn ? (
              <span style={{ fontFamily: "var(--font-sans)" }}>The issuer {withdrawn.reason === "CANCELLED" ? "cancelled" : "replaced"} this action (v{withdrawn.byVersion}, noted <Timestamp iso={withdrawn.notedAt} full />). The Brief is withdrawn from sale; earlier buyers keep access.</span>
            ) : (
              <span style={prose}>No later cancellation or replacement by the issuer was seen at the last scan. If one appears, the Brief is withdrawn from sale.</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
