import { z } from "zod";

export const ResearchBudget = z.object({
  maxVariableCostUsd: z.number().positive(),
  maxModelCalls: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxLatencyMs: z.number().int().positive(),
  maxOutputTokensPerCall: z.number().int().positive(),
});
export type ResearchBudget = z.infer<typeof ResearchBudget>;

export const CostBasis = z.enum([
  /** provider-reported token usage multiplied by the published list price */
  "MEASURED_USAGE_AT_LIST_PRICE",
  /** the call has no marginal price (public API, public RPC); only count and latency are measured */
  "NO_MARGINAL_PRICE",
  /** produced by a test double; not a real cost */
  "FIXTURE",
]);
export type CostBasis = z.infer<typeof CostBasis>;

export const UsageRecord = z.object({
  investigationId: z.string(),
  seq: z.number().int(),
  kind: z.enum(["MODEL_CALL", "TOOL_CALL"]),
  name: z.string(),
  startedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative(),
  costBasis: CostBasis,
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

export const StopReason = z.enum([
  "COMPLETED",
  /** declined before any spend: the price cannot cover the research budget plus reserves */
  "DECLINED_UNECONOMIC",
  "BUDGET_COST_EXCEEDED",
  "BUDGET_MODEL_CALLS_EXCEEDED",
  "BUDGET_TOOL_CALLS_EXCEEDED",
  "BUDGET_LATENCY_EXCEEDED",
  "MODEL_UNAVAILABLE",
  "MODEL_REFUSED",
  "MODEL_OUTPUT_INVALID",
  "ERROR",
]);
export type StopReason = z.infer<typeof StopReason>;
