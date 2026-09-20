import { useState, type ReactNode } from "react";
import { SiteNav } from "../components/SiteNav";

export type Region = "FEED" | "WORK" | "CONSOLE";

/**
 * Feed | Working area | Console, under the shared header. Tablet and small laptop collapse the
 * console to a strip; phone shows one region at a time and gets the region tabs — they are hidden
 * on wider screens, where all three regions are already on the page and the tabs would do nothing.
 */
export function Desk({ feed, work, console: consoleRegion, strip, status = null }: { feed: ReactNode; work: ReactNode; console: ReactNode; strip: ReactNode; status?: ReactNode }) {
  const [region, setRegion] = useState<Region>("FEED");
  const hidden = (r: Region) => (region === r ? "" : " is-hidden-phone");
  return (
    <div className="be">
      <SiteNav place="DESK" status={status} />
      <div className="be-desk">
        <div className="be-seg" role="tablist" aria-label="Region">
          {(["FEED", "WORK", "CONSOLE"] as Region[]).map((r) => <button key={r} className={`be-btn${region === r ? " be-btn-primary" : ""}`} role="tab" aria-selected={region === r} onClick={() => setRegion(r)}>{r}</button>)}
        </div>
        <section className={`be-region${hidden("FEED")}`} aria-label="Feed">{feed}</section>
        <div style={{ display: "grid", gap: 24, minWidth: 0 }}>
          <div className="be-console-strip">{strip}</div>
          <section className={`be-region is-work${hidden("WORK")}`} aria-label="Working area">{work}</section>
        </div>
        <section className={`be-region is-console${hidden("CONSOLE")}`} aria-label="Console">{consoleRegion}</section>
      </div>
    </div>
  );
}
