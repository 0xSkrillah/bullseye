import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/bullseye.css";
import { App } from "./App";

// Terminal (dark) is the product; Projector (light) is for a bright room. Both are defined in
// tokens.css, so anything this accepts is a theme the app actually has.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

/**
 * The server answers index.html for every path outside /api, so the path picks the view; no router.
 * The Market Desk and the Situation Room are each their own chunk: the desk at "/" never loads
 * either one's code, its stylesheet or its fonts.
 *
 * A chunk that will not load — a lost connection mid-navigation, a stale cached index after a
 * deploy — gets a page that says so and offers the two ways out, rather than an empty document.
 * Nothing a buyer has is stored in these chunks, so a failure here loses no purchase.
 */
const lazy = (title: string, name: string, load: () => Promise<ReactNode>) => {
  document.title = title;
  void load().then(render).catch(() => render(<RouteLoadFailed name={name} />));
};

const path = location.pathname;
if (path === "/market" || path.startsWith("/market/")) {
  lazy("Bullseye · Market Desk", "Market Desk", () => import("./market/MarketDesk").then(({ MarketDesk }) => <MarketDesk />));
} else if (path === "/room" || path.startsWith("/room/")) {
  lazy("Bullseye · Situation Room", "Situation Room", () => import("./situation/Room").then(({ Room }) => <Room />));
} else {
  render(<App />);
}

function RouteLoadFailed({ name }: { name: string }) {
  return (
    <div className="be" style={{ padding: 24 }}>
      <div className="be-panel" role="alert" style={{ maxWidth: "60ch", margin: "48px auto", display: "grid", gap: 12 }}>
        <span className="be-stage">{name} could not load</span>
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
