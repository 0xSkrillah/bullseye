import { useId, type ReactNode } from "react";
import { Timestamp } from "../primitives/Timestamp";

export interface PanelProps {
  /** the pipeline stage this panel belongs to, printed top-left in the label style */
  stage: string;
  /** one figure or state beside the stage label, in the display face */
  headline?: ReactNode;
  /** right-aligned in the header: counts, badges */
  meta?: ReactNode;
  className?: string;
  foot?: ReactNode;
  children?: ReactNode;
}

/** A region of the wall: `canvas-raised`, one border, its stage named in words. */
export function Panel({ stage, headline, meta, className, foot, children }: PanelProps) {
  const id = useId();
  return (
    <section className={`room-panel${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <header className="room-panel-head">
        <h2 id={id} className="room-label">{stage}</h2>
        {headline !== undefined && <span className="room-headline">{headline}</span>}
        {meta !== undefined && <span className="room-meta">{meta}</span>}
      </header>
      {children}
      {foot}
    </section>
  );
}

export interface FeedFootProps {
  /** the route that feeds the panel, as a visitor could type it */
  route: string;
  everyMs: number;
  updatedAt: number | null;
  error: string | null;
  /** the route answered 404: this server does not have it yet */
  unavailable?: boolean;
  /** said instead of "every N s" when that would be untrue, e.g. "read once" for a finished run */
  pace?: string;
}

/** Names the panel's source and says how fresh it is; a failed read is said in words, never hidden behind old figures. */
export function FeedFoot({ route, everyMs, updatedAt, error, unavailable = false, pace: said }: FeedFootProps) {
  const pace = said ?? `every ${Math.round(everyMs / 1000)} s`;
  return (
    <footer className="room-foot">
      <span>GET {route} · {pace}</span>
      {unavailable ? (
        <span>not available yet</span>
      ) : error ? (
        <span className="room-bad">✕ no answer ({error}){updatedAt !== null && <> · last <Timestamp iso={new Date(updatedAt).toISOString()} /></>}</span>
      ) : updatedAt === null ? (
        <span>Fetching…</span>
      ) : (
        <span>updated <Timestamp iso={new Date(updatedAt).toISOString()} /></span>
      )}
    </footer>
  );
}

/** A deliberate empty state: the fact in the display face, one plain sentence under it. */
export function Empty({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <div className="room-empty">
      <span className="room-empty-title">{title}</span>
      {note && <span className="room-empty-note">{note}</span>}
      {children}
    </div>
  );
}
