import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/bullseye.css";
import { App } from "./App";

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const root = createRoot(document.getElementById("root")!);

// The server answers index.html for every path outside /api, so the path picks the view; no router.
// The Market Desk is its own chunk: the desk at "/" never loads its code or its stylesheet.
if (location.pathname === "/market" || location.pathname.startsWith("/market/")) {
  document.title = "Bullseye · Market Desk";
  void import("./market/MarketDesk").then(({ MarketDesk }) => root.render(<StrictMode><MarketDesk /></StrictMode>));
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
