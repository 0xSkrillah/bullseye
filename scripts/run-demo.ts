/**
 * Drives the golden path against a running API and writes a transcript of what
 * actually happened to artifacts/evidence/. Whatever modes the server is running
 * in (LIVE / HISTORICAL / FIXTURE data, live or fixture synthesis, which rail)
 * are copied into the transcript from the server's own answers.
 *
 *   npm run demo -- [SYMBOL] [--base http://localhost:4402] [--buy]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { api, friendlyErrors } from "./lib.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JOURNAL_DIR, type PurchaseEntry } from "./purchase-journal.js";

/** the newest journal entry for this Brief at this seller, whatever its state */
function findOpenOrDelivered(base: string, briefId: string): PurchaseEntry | null {
  if (!existsSync(JOURNAL_DIR)) return null;
  const entries = readdirSync(JOURNAL_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(JOURNAL_DIR, n), "utf8")) as PurchaseEntry)
    .filter((e) => e.briefId === briefId && e.base.replace(/\/+$/, "") === base.replace(/\/+$/, ""));
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

friendlyErrors();

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "http://localhost:4402";
const symbol = args.find((a) => !a.startsWith("--") && a !== base);
const buy = args.includes("--buy");

const transcript: { at: string; step: string; data: unknown }[] = [];
const log = (step: string, data: unknown) => {
  transcript.push({ at: new Date().toISOString(), step, data });
  console.log(`\n== ${step}`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2).slice(0, 1800));
};
const save = () => {
  mkdirSync("artifacts/evidence", { recursive: true });
  const out = `artifacts/evidence/demo-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(transcript, null, 2));
  console.log(`\ntranscript: ${out}`);
};
const get = async (path: string) => (await api(base, path)).json() as Promise<any>;
const post = async (path: string) => (await api(base, path, { method: "POST" })).json() as Promise<any>;

const health = await get("/api/health");
log("health", health);

const scan = await post("/api/signals/scan");
log("detect", { scannedAt: scan.scannedAt, actionsSeen: scan.actionsSeen, signals: scan.signals?.map((s: any) => `${s.id} ${s.provenance.mode} ${s.headline}`) });
const signal = (scan.signals ?? []).find((s: any) => !symbol || s.asset.symbol === symbol);
if (!signal) {
  const seen = [...new Set((scan.signals ?? []).map((s: any) => s.asset.symbol))].join(", ") || "none";
  log("stopped", `no signal${symbol ? ` for ${symbol}` : ""}; nothing to investigate. SYMBOL is an xStock ticker the detector has flagged; currently flagged: ${seen}`);
  save();
  process.exit(1);
}
log("signal", signal);

const started = await post(`/api/signals/${signal.id}/investigate`);
let view: any;
for (;;) {
  view = await get(`/api/investigations/${started.investigationId}`);
  if (view.investigation.status !== "RUNNING") break;
  await new Promise((r) => setTimeout(r, 1500));
}
log("investigation", {
  status: view.investigation.status,
  stopReason: view.investigation.stopReason,
  usage: view.usage,
  timeline: view.investigation.timeline.map((t: any) => `${t.ok ? "ok " : "ERR"} ${t.type} ${t.label}${t.detail ? ` — ${t.detail}` : ""}`),
});
log("gate", view.investigation.gate ?? "no gate decision (investigation did not reach the gate)");

if (view.investigation.status !== "PUBLISHED") {
  log("stopped", "no Brief was published, so there is nothing to sell and nothing was charged");
  save();
  process.exit(view.investigation.status === "REJECTED" ? 0 : 1);
}

const briefId = view.investigation.briefId as string;
log("preview", await get(`/api/briefs/${briefId}/preview`));
const challenge = await api(base, `/api/v1/briefs/${briefId}`);
log("unpaid request", { httpStatus: challenge.status, paymentRequiredHeader: challenge.headers.has("payment-required"), body: await challenge.json() });

if (buy) {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/buy-brief.ts", briefId, "--base", base], { encoding: "utf8" });
  log("agent purchase", `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() || `buyer exited with status ${run.status}`);
  // the buyer script wrote its order id and claim token to the purchase journal; the order is read with that token, as any buyer would
  const bought = findOpenOrDelivered(base, briefId);
  if (bought?.orderId) {
    const mine = await api(base, `/api/orders/${bought.orderId}`, { headers: { "x-bullseye-claim": bought.claim } });
    if (mine.ok) log("order and delivery economics", await mine.json());
  }
  if (run.status !== 0) {
    log("stopped", `the purchase did not complete (buyer exit status ${run.status}); see "agent purchase" above`);
    save();
    process.exit(run.status ?? 1);
  }
}
save();
