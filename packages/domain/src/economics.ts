import { z } from "zod";
import { PaymentRail } from "./order.js";

export const CostLine = z.object({
  label: z.string(),
  amountUsd: z.number().nonnegative(),
  /** MEASURED lines come from recorded usage. ESTIMATED lines are planning allowances. Never summed under one heading. */
  basis: z.enum(["MEASURED", "ESTIMATED"]),
  detail: z.string(),
});
export type CostLine = z.infer<typeof CostLine>;

export const EconomicsReceipt = z.object({
  orderId: z.string(),
  briefId: z.string(),
  rail: PaymentRail,
  priceUsd: z.number(),
  /** true only for a settled mainnet payment. Testnet and fixture payments are never revenue. */
  countsAsRevenue: z.boolean(),
  revenueNote: z.string(),
  usage: z.object({
    modelCalls: z.number().int(),
    toolCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    investigationLatencyMs: z.number().int(),
    usageIsFixture: z.boolean(),
  }),
  measuredCosts: z.array(CostLine),
  estimatedCosts: z.array(CostLine),
  measuredTotalUsd: z.number(),
  estimatedTotalUsd: z.number(),
  /** price - measured - estimated. An estimate; excludes labour, hosting, acquisition, overhead, tax. */
  estimatedContributionUsd: z.number(),
  contributionNote: z.string(),
});
export type EconomicsReceipt = z.infer<typeof EconomicsReceipt>;
