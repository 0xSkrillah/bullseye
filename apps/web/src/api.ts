import type { InvestigationResponse } from "./lib/api";

// The typed client is lib/api.ts. This module only names the response parts the components take as props.

/** GET /api/investigations/:id reports usage as a summary, not as UsageRecord[]. */
export type InvestigationUsage = InvestigationResponse["usage"] & {
  /** everything the budget governor has counted, whatever its basis */
  budgetSpentUsd?: number;
  /** calls whose charge is unknown, carried at the price cap */
  upperBoundModelCostUsd?: number;
  costBases?: string[];
  /** models a router actually chose */
  routedModels?: string[];
};
