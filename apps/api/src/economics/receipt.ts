import { EconomicsReceipt, type CostLine, type Order, type UsageRecord } from "@bullseye/domain";
import { RATE_CARD_AS_OF } from "../research/governor.js";

export interface EstimatedAllowances {
  paymentFeeReserveUsd: number;
  reworkReserveUsd: number;
  dataToolAllowanceUsd: number;
}

function usd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Per-order delivery economics. Measured and estimated figures are kept in
 * separate lists with separate totals, and the whole investigation cost is
 * charged to the order as if it were the only sale of the Brief.
 */
export function buildReceipt(order: Order, usage: UsageRecord[], model: string, allowances: EstimatedAllowances): EconomicsReceipt {
  const modelCalls = usage.filter((u) => u.kind === "MODEL_CALL");
  const toolCalls = usage.filter((u) => u.kind === "TOOL_CALL");
  const usageIsFixture = modelCalls.some((u) => u.costBasis === "FIXTURE");
  const sumWhere = (basis: UsageRecord["costBasis"]) => usd(modelCalls.filter((u) => u.costBasis === basis).reduce((s, u) => s + u.costUsd, 0));
  const countWhere = (basis: UsageRecord["costBasis"]) => modelCalls.filter((u) => u.costBasis === basis).length;
  const routedTo = [...new Set(modelCalls.map((u) => u.model).filter((m): m is string => m !== null))].sort();
  const inputTokens = modelCalls.reduce((s, u) => s + (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0), 0);
  const outputTokens = modelCalls.reduce((s, u) => s + (u.outputTokens ?? 0), 0);
  const first = usage[0];
  const last = usage[usage.length - 1];
  const latency = first && last ? Date.parse(last.startedAt) + last.latencyMs - Date.parse(first.startedAt) : 0;

  const measuredCosts: CostLine[] = usageIsFixture
    ? []
    : [
        ...(countWhere("MEASURED_PROVIDER_BILLED") > 0
          ? [
              {
                label: "Model usage, as billed",
                amountUsd: sumWhere("MEASURED_PROVIDER_BILLED"),
                basis: "MEASURED" as const,
                detail: `${countWhere("MEASURED_PROVIDER_BILLED")} calls to ${model}${routedTo.length > 0 ? `, routed to ${routedTo.join(", ")}` : ""}; the amount the provider reported charging for each call.`,
              },
            ]
          : []),
        ...(countWhere("MEASURED_USAGE_AT_LIST_PRICE") > 0
          ? [
              {
                label: "Model usage",
                amountUsd: sumWhere("MEASURED_USAGE_AT_LIST_PRICE"),
                basis: "MEASURED" as const,
                detail: `${countWhere("MEASURED_USAGE_AT_LIST_PRICE")} calls to ${model}; ${inputTokens} input and ${outputTokens} output tokens as reported by the provider, priced at list rates as of ${RATE_CARD_AS_OF}. Not an invoice.`,
              },
            ]
          : []),
        {
          label: "Data and chain reads",
          amountUsd: 0,
          basis: "MEASURED",
          detail: `${toolCalls.length} tool calls against the public xStocks API and a public X Layer RPC endpoint; no per-call charge was incurred.`,
        },
      ];

  const estimatedCosts: CostLine[] = [
    { label: "Payment and fee reserve", amountUsd: allowances.paymentFeeReserveUsd, basis: "ESTIMATED", detail: "Planning allowance. No facilitator or network fee has been measured for this order." },
    { label: "Rework reserve", amountUsd: allowances.reworkReserveUsd, basis: "ESTIMATED", detail: "Planning allowance for rejected drafts and re-investigation." },
    { label: "Data and tooling allowance", amountUsd: allowances.dataToolAllowanceUsd, basis: "ESTIMATED", detail: "Planning allowance for paid data or RPC capacity that the public endpoints used today do not charge for." },
    ...(usageIsFixture ? [{ label: "Model usage", amountUsd: 0, basis: "ESTIMATED" as const, detail: "The synthesis model was a test double; no model cost was measured for this Brief." }] : []),
    // a call the provider did not price is carried at the configured price cap: a ceiling, so it is an estimate
    ...(countWhere("UPPER_BOUND_AT_PRICE_CAP") > 0
      ? [
          {
            label: "Model usage, upper bound",
            amountUsd: sumWhere("UPPER_BOUND_AT_PRICE_CAP"),
            basis: "ESTIMATED" as const,
            detail: `${countWhere("UPPER_BOUND_AT_PRICE_CAP")} calls for which the provider reported no charge; carried at the configured price cap.`,
          },
        ]
      : []),
  ];

  const measuredTotalUsd = usd(measuredCosts.reduce((s, c) => s + c.amountUsd, 0));
  const estimatedTotalUsd = usd(estimatedCosts.reduce((s, c) => s + c.amountUsd, 0));
  const priceUsd = Number(order.terms.priceUsd);
  const settledOnMainnet = order.terms.rail === "OKX_X402_MAINNET" && (order.state === "PAID" || order.state === "DELIVERING" || order.state === "DELIVERED") && order.payment?.chainVerified === true;

  return EconomicsReceipt.parse({
    orderId: order.id,
    briefId: order.terms.briefId,
    rail: order.terms.rail,
    priceUsd,
    countsAsRevenue: settledOnMainnet,
    revenueNote: settledOnMainnet
      ? "Settled on X Layer mainnet and confirmed on-chain."
      : order.terms.rail === "OKX_X402_TESTNET"
        ? "Paid with test tokens on X Layer testnet. This proves the payment mechanics; it is not revenue."
        : order.terms.rail === "FIXTURE"
          ? "Fixture payment rail: no funds moved on any chain. This is not revenue."
          : "Payment is not settled and confirmed; nothing is counted as revenue.",
    usage: { modelCalls: modelCalls.length, toolCalls: toolCalls.length, inputTokens, outputTokens, investigationLatencyMs: Math.max(0, latency), usageIsFixture },
    measuredCosts,
    estimatedCosts,
    measuredTotalUsd,
    estimatedTotalUsd,
    estimatedContributionUsd: usd(priceUsd - measuredTotalUsd - estimatedTotalUsd),
    contributionNote:
      "Estimated contribution = price − measured costs − estimated allowances, with the full investigation cost charged to this single order. It excludes labour, hosting, customer acquisition, overhead and tax. It is an estimate, not profit.",
  });
}
