import type { ResearchBudget, StopReason, UsageRecord } from "@bullseye/domain";

/** USD per million tokens. Published list prices; see docs/ECONOMICS.md for the source and date. */
export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const RATE_CARD_AS_OF = "2026-09-18";
export const RATE_CARD: Record<string, ModelRates> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** what the provider says it charged for the call, when it says so */
  billedCostUsd?: number | null;
  /** the model that answered, when a router chose it */
  model?: string | null;
}

export function priceUsage(rates: ModelRates, u: TokenUsage): number {
  const usd = (u.inputTokens * rates.input + u.outputTokens * rates.output + u.cacheReadTokens * rates.cacheRead + u.cacheWriteTokens * rates.cacheWrite) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** input tokens assumed for the first call, before any real usage has been observed */
const FIRST_CALL_INPUT_ESTIMATE = 3_000;

/**
 * Owns the research budget. The investigator must ask before every model call
 * and every tool call; a non-null answer ends the investigation.
 */
export class BudgetGovernor {
  private readonly startedAt: number;
  private modelCalls = 0;
  private toolCalls = 0;
  private spentUsd = 0;
  private lastInputTokens = FIRST_CALL_INPUT_ESTIMATE;

  constructor(
    readonly budget: ResearchBudget,
    private readonly rates: ModelRates,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }

  /** Worst-case price of the next model call: context so far plus a full-length reply. */
  projectedNextCallUsd(): number {
    return priceUsage(this.rates, { inputTokens: this.lastInputTokens, outputTokens: this.budget.maxOutputTokensPerCall, cacheReadTokens: 0, cacheWriteTokens: 0 });
  }

  beforeModelCall(): StopReason | null {
    if (this.clock() - this.startedAt > this.budget.maxLatencyMs) return "BUDGET_LATENCY_EXCEEDED";
    if (this.modelCalls >= this.budget.maxModelCalls) return "BUDGET_MODEL_CALLS_EXCEEDED";
    if (this.spentUsd + this.projectedNextCallUsd() > this.budget.maxVariableCostUsd) return "BUDGET_COST_EXCEEDED";
    return null;
  }

  beforeToolCall(): StopReason | null {
    if (this.clock() - this.startedAt > this.budget.maxLatencyMs) return "BUDGET_LATENCY_EXCEEDED";
    if (this.toolCalls >= this.budget.maxToolCalls) return "BUDGET_TOOL_CALLS_EXCEEDED";
    return null;
  }

  record(usage: UsageRecord): void {
    if (usage.kind === "MODEL_CALL") {
      this.modelCalls++;
      this.spentUsd += usage.costUsd;
      // the next request resends everything so far, including this reply
      this.lastInputTokens = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0);
    } else {
      this.toolCalls++;
    }
  }

  remainingMs(): number {
    return Math.max(0, this.budget.maxLatencyMs - (this.clock() - this.startedAt));
  }

  totals(): { modelCalls: number; toolCalls: number; spentUsd: number; elapsedMs: number } {
    return { modelCalls: this.modelCalls, toolCalls: this.toolCalls, spentUsd: Math.round(this.spentUsd * 1e6) / 1e6, elapsedMs: this.clock() - this.startedAt };
  }
}
