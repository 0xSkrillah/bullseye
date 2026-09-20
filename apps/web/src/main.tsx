import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/bullseye.css";
import { App } from "./App";

// Terminal (dark) is the product; Projector (light) is for a bright room. Both are defined in
// tokens.css, so anything this accepts is a theme the app actually has.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const root = createRoot(document.getElementById("root")!);

/**
 * The server answers index.html for every path outside /api, so the path picks the view; no router.
 * The Market Desk is its own chunk: the desk at "/" never loads its code or its stylesheet.
 *
 * A chunk that will not load — a lost connection mid-navigation, a stale cached index after a
 * deploy — gets a page that says so and offers the two ways out, rather than an empty document.
 * Nothing a buyer has is stored in this chunk, so a failure here loses no purchase.
 */
if (location.pathname === "/market" || location.pathname.startsWith("/market/")) {
  document.title = "Bullseye · Market Desk";
  void import("./market/MarketDesk")
    .then(({ MarketDesk }) => root.render(<StrictMode><MarketDesk /></StrictMode>))
    .catch(() => root.render(<StrictMode><RouteLoadFailed /></StrictMode>));
} else {
  root.render(<StrictMode><App /></StrictMode>);
}

function RouteLoadFailed() {
  return (
    <div className="be" style={{ padding: 24 }}>
      <div className="be-panel" role="alert" style={{ maxWidth: "60ch", margin: "48px auto", display: "grid", gap: 12 }}>
        <span className="be-stage">Market Desk could not load</span>
        <p style={{ margin: 0, fontSize: 14, lineHeight: "22px" }}>
          This part of the site did not finish downloading. Nothing was charged, and any report already bought from this browser is unaffected.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="be-btn be-btn-primary" type="button" onClick={() => location.reload()}>Reload this page</button>
          <a className="be-btn" href="/" style={{ textDecoration: "none" }}>Go to the desk</a>
        </div>
      </div>
    </div>
  );
}
