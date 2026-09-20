import { useState, type ReactNode } from "react";

export type Region = "FEED" | "WORK" | "CONSOLE";

/** Feed | Working area | Console. Tablet collapses the console to a strip; phone shows one region. */
export function Desk({ feed, work, console: consoleRegion, strip }: { feed: ReactNode; work: ReactNode; console: ReactNode; strip: ReactNode }) {
  const [region, setRegion] = useState<Region>("FEED");
  const hidden = (r: Region) => (region === r ? "" : " is-hidden-phone");
  return (
    <div className="be be-desk">
      <div className="be-seg" role="tablist" aria-label="Region" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
        {(["FEED", "WORK", "CONSOLE"] as Region[]).map((r) => <button key={r} className={`be-btn${region === r ? " be-btn-primary" : ""}`} role="tab" aria-selected={region === r} onClick={() => setRegion(r)}>{r}</button>)}
        {/* the Market Desk reads the same events as money; it is a separate chunk and loads nothing here */}
        <a className="be-btn" href="/market" style={{ marginLeft: "auto", textDecoration: "none" }}>Market Desk</a>
      </div>
      <section className={`be-region${hidden("FEED")}`} aria-label="Feed">{feed}</section>
      <div style={{ display: "grid", gap: 24 }}>
        <div className="be-console-strip">{strip}</div>
        <section className={`be-region is-work${hidden("WORK")}`} aria-label="Working area">{work}</section>
      </div>
      <section className={`be-region is-console${hidden("CONSOLE")}`} aria-label="Console">{consoleRegion}</section>
    </div>
  );
}
