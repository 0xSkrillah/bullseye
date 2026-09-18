/**
 * One minimal, metered call to the configured synthesis model, reconciled against the
 * provider's own account of what was spent. Run this before the first live investigation
 * and after changing the model, the cost tier or the price caps.
 *
 *   npm run model-check
 *
 * Spends a fraction of a cent. Prints no credential. Writes what happened, including a
 * failure, to artifacts/integration/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../apps/api/src/config.js";
import { createLiveProvider } from "../apps/api/src/research/provider.js";
import { friendlyErrors, ScriptError } from "./lib.js";

friendlyErrors();

/** a smoke call that costs more than this means the routing or the caps are not what was configured */
const STOP_IF_CALL_COSTS_MORE_THAN_USD = 0.02;

const config = loadConfig();
if (config.SYNTHESIS_PROVIDER === "fixture") throw new ScriptError("SYNTHESIS_PROVIDER=fixture: there is no live model to check.", 2);

interface KeyInfo {
  usage: number;
  limit: number | null;
  limit_remaining: number | null;
  is_free_tier: boolean;
}

/** OpenRouter's own record of what this key has spent: the authority for reconciliation */
async function keyInfo(): Promise<KeyInfo | null> {
  if (config.SYNTHESIS_PROVIDER !== "openrouter" || !config.OPENROUTER_API_KEY) return null;
  const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new ScriptError(`OpenRouter rejected the key lookup with HTTP ${res.status}. Check OPENROUTER_API_KEY. Nothing was spent.`, 2);
  const { data } = (await res.json()) as { data: KeyInfo };
  return { usage: data.usage, limit: data.limit, limit_remaining: data.limit_remaining, is_free_tier: data.is_free_tier };
}

/** what goes into the artifact: spend only. The account's limit stays out of files that may be shared. */
function forArtifact(k: KeyInfo | null): { usage: number } | null {
  return k ? { usage: k.usage } : null;
}

const report: Record<string, unknown> = {
  ranAt: new Date().toISOString(),
  provider: config.SYNTHESIS_PROVIDER,
  requestedModel: config.BULLSEYE_MODEL,
  costTier: config.SYNTHESIS_PROVIDER === "openrouter" ? config.OPENROUTER_COST_TIER : null,
  priceCapUsdPerMTok: config.SYNTHESIS_PROVIDER === "openrouter" ? { prompt: config.OPENROUTER_MAX_PRICE_PROMPT, completion: config.OPENROUTER_MAX_PRICE_COMPLETION } : null,
};
let exitCode = 1;

try {
  const before = await keyInfo();
  report.accountBefore = forArtifact(before);
  if (before && before.limit_remaining !== null && before.limit_remaining < 1) {
    throw new ScriptError(`The key has $${before.limit_remaining} left under its limit; an investigation is budgeted at up to $${config.budget.maxVariableCostUsd}. Nothing was spent.`, 2);
  }

  const provider = createLiveProvider(config);
  const session = provider.start({ system: "You are a connectivity check.", task: "Reply with the single word READY.", tools: [], maxOutputTokens: 512 });
  const started = Date.now();
  const turn = await session.collect(null);
  report.call = { outcome: turn.kind, latencyMs: Date.now() - started, routedModel: turn.usage.model ?? null, inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, billedCostUsd: turn.usage.billedCostUsd ?? null, text: turn.kind === "done" ? turn.text.slice(0, 80) : null };

  // the provider's ledger can lag the response by a moment
  await new Promise((r) => setTimeout(r, 3_000));
  const after = await keyInfo();
  report.accountAfter = forArtifact(after);
  if (before && after) report.accountUsageDeltaUsd = Math.round((after.usage - before.usage) * 1e6) / 1e6;

  const billed = turn.usage.billedCostUsd ?? null;
  const problems: string[] = [];
  if (billed === null) problems.push("the response carried no billed cost; investigations would be carried at the price cap as an upper bound");
  if (billed !== null && billed > STOP_IF_CALL_COSTS_MORE_THAN_USD) problems.push(`the call cost $${billed}, above the $${STOP_IF_CALL_COSTS_MORE_THAN_USD} sanity limit for a one-word reply`);
  if (turn.kind !== "done") problems.push(`the model answered with "${turn.kind}" instead of text`);
  report.problems = problems;
  exitCode = problems.length === 0 ? 0 : 1;
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err);
  if (err instanceof ScriptError) exitCode = err.exitCode;
} finally {
  mkdirSync("artifacts/integration", { recursive: true });
  const out = `artifacts/integration/model-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);
}
process.exit(exitCode);
