import type { ReactNode } from "react";

export type NavPlace = "DESK" | "MARKET" | "ROOM";

/**
 * The same header on every screen, so a visitor can always tell where they are and reach the
 * others. Only destinations this build actually serves are listed — `/`, `/market` and `/room`,
 * each of which `main.tsx` renders from the path (apps/api answers index.html for every non-/api
 * path). A link that silently renders a different screen is worse than no link, so anything not
 * routed here does not belong in this list.
 *
 * The order is the journey: understand the event, read the report, then inspect the machine. The
 * Situation Room is last because it is the optional proof, not the way in.
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
        <a href="/market" aria-current={place === "MARKET" ? "page" : undefined}>Market Desk</a>
        <a href="/" aria-current={place === "DESK" ? "page" : undefined}>The desk</a>
        <a href="/room" aria-current={place === "ROOM" ? "page" : undefined}>Situation Room</a>
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
