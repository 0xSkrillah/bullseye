import type { ReactNode } from "react";

export type NavPlace = "DESK" | "MARKET";

/**
 * The same header on every screen, so a visitor can always tell where they are and reach the other
 * view. Only destinations this build actually serves are listed: `/` and `/market` are the two the
 * server answers (apps/api serves index.html for every non-/api path, and main.tsx picks the view
 * from it). The Situation Room is not on this branch, so it is not linked; a link that silently
 * renders a different screen is worse than no link.
 *
 * `status` is for short, factual chips — the data mode, the payment rail. It never carries a value
 * a buyer pays for.
 */
export function SiteNav({ place, status = null }: { place: NavPlace; status?: ReactNode }) {
  return (
    <header className="be-nav">
      <a className="be-nav-mark" href="/" aria-label="Bullseye home">
        <TargetMark />
        <span>Bullseye</span>
      </a>
      <nav className="be-nav-links" aria-label="Views">
        <a href="/" aria-current={place === "DESK" ? "page" : undefined}>The desk</a>
        <a href="/market" aria-current={place === "MARKET" ? "page" : undefined}>Market Desk</a>
      </nav>
      {status && <div className="be-nav-status">{status}</div>}
    </header>
  );
}

/**
 * Three rings and a red centre, drawn from tokens rather than an image.
 *
 * `hit` draws the centre once, and is for one thing only: a Brief that the gate actually
 * published. It never marks a page load, a poll or an investigation still running, and a reader
 * who asks for reduced motion gets the same mark without the draw.
 */
export function TargetMark({ size = 16, hit = false }: { size?: number; hit?: boolean }) {
  return <span className={`be-target${hit ? " is-hit" : ""}`} style={{ width: size, height: size }} aria-hidden="true" />;
}
