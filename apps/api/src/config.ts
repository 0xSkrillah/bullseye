import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ResearchBudget } from "@bullseye/domain";

/** repository root; relative paths in the environment are resolved against it, not the process cwd */
export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const fromRoot = (p: string) => (p === ":memory:" || isAbsolute(p) ? p : resolve(REPO_ROOT, p));

const Env = z.object({
  PORT: z.coerce.number().int().default(4402),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4402"),
  DB_PATH: z.string().default("./data/bullseye.sqlite"),

  // data sources
  XSTOCKS_BASE_URL: z.string().url().default("https://api.xstocks.fi/api/v2"),
  XLAYER_RPC_URL: z.string().url().default("https://rpc.xlayer.tech"),
  XLAYER_TESTNET_RPC_URL: z.string().url().default("https://testrpc.xlayer.tech"),
  /** live | recorded | fixture. "recorded" replays artifacts/recorded as HISTORICAL. */
  DATA_SOURCE: z.enum(["live", "recorded", "fixture"]).default("live"),
  RECORDING_DIR: z.string().default("./artifacts/recorded/xstocks-2026-09-18"),

  // investigator
  ANTHROPIC_API_KEY: z.string().optional(),
  BULLSEYE_MODEL: z.string().default("claude-opus-5"),
  /** anthropic | fixture. The fixture synthesiser is a test double and is labelled as such on every Brief. */
  SYNTHESIS_PROVIDER: z.enum(["anthropic", "fixture"]).default("anthropic"),
  BUDGET_MAX_COST_USD: z.coerce.number().positive().default(0.6),
  BUDGET_MAX_MODEL_CALLS: z.coerce.number().int().positive().default(6),
  BUDGET_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(14),
  BUDGET_MAX_LATENCY_MS: z.coerce.number().int().positive().default(180_000),
  BUDGET_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8_000),

  // commerce
  /** okx-testnet | okx-mainnet | fixture */
  PAYMENT_RAIL: z.enum(["okx-testnet", "okx-mainnet", "fixture"]).default("okx-testnet"),
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET_KEY: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  PAY_TO_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  BRIEF_PRICE_USD: z
    .string()
    .regex(/^\d+\.\d{2}$/)
    .default("3.00"),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // estimated (never measured) per-order allowances, USD
  EST_PAYMENT_FEE_RESERVE_USD: z.coerce.number().nonnegative().default(0.15),
  EST_REWORK_RESERVE_USD: z.coerce.number().nonnegative().default(0.2),
  EST_DATA_TOOL_ALLOWANCE_USD: z.coerce.number().nonnegative().default(0.1),

  /** allow FIXTURE-mode briefs to be published and sold. Tests only. */
  ALLOW_FIXTURE_PUBLICATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof Env> & { budget: ResearchBudget };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return {
    ...parsed,
    DB_PATH: fromRoot(parsed.DB_PATH),
    RECORDING_DIR: fromRoot(parsed.RECORDING_DIR),
    budget: {
      maxVariableCostUsd: parsed.BUDGET_MAX_COST_USD,
      maxModelCalls: parsed.BUDGET_MAX_MODEL_CALLS,
      maxToolCalls: parsed.BUDGET_MAX_TOOL_CALLS,
      maxLatencyMs: parsed.BUDGET_MAX_LATENCY_MS,
      maxOutputTokensPerCall: parsed.BUDGET_MAX_OUTPUT_TOKENS,
    },
  };
}
