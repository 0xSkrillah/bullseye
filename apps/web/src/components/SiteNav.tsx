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

/** three rings and a red centre: drawn from tokens, never an image, and never animated on its own */
export function TargetMark({ size = 16 }: { size?: number }) {
  return <span className="be-target" style={{ width: size, height: size }} aria-hidden="true" />;
}
