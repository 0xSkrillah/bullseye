import type { Order, UsageRecord } from "@bullseye/domain";
import type { EstimatedAllowances } from "./receipt.js";

export interface RunCost {
  investigationId: string;
  status: "RUNNING" | "PUBLISHED" | "REJECTED" | "STOPPED";
  briefId: string | null;
  usage: UsageRecord[];
}

type Bucket = { runs: number; measuredUsd: number; upperBoundUsd: number };

const usd = (n: number) => Math.round(n * 1e6) / 1e6;
const isPaid = (o: Order) => o.state === "PAID" || o.state === "DELIVERING" || o.state === "DELIVERY_FAILED" || o.state === "DELIVERED";

/**
 * What the desk has spent and taken, with every investigation counted once.
 *
 * A receipt charges the whole cost of a Brief's investigation to each order, as if that order were
 * the Brief's only sale. That is the conservative figure for one sale, and the wrong thing to add up:
 * two orders of one Brief would count its research twice, and research that was rejected, stopped or
 * never bought would not be counted at all. Here research is summed per investigation, whatever came
 * of it, and delivery allowances are counted per paid order.
 */
export function deskEconomics(runs: RunCost[], orders: Order[], allowances: EstimatedAllowances) {
  const empty = (): Bucket => ({ runs: 0, measuredUsd: 0, upperBoundUsd: 0 });
  const byOutcome: Record<RunCost["status"], Bucket> = { RUNNING: empty(), PUBLISHED: empty(), REJECTED: empty(), STOPPED: empty() };
  const total = empty();
  const unsold = empty();
  let unpricedRuns = 0;

  const soldBriefs = new Set(orders.filter(isPaid).map((o) => o.terms.briefId));
  for (const run of runs) {
    const models = run.usage.filter((u) => u.kind === "MODEL_CALL");
    const measured = models.filter((u) => u.costBasis.startsWith("MEASURED")).reduce((s, u) => s + u.costUsd, 0);
    const upper = models.filter((u) => u.costBasis === "UPPER_BOUND_AT_PRICE_CAP").reduce((s, u) => s + u.costUsd, 0);
    // a test double's calls carry no price at all: they are reported as a count, never as a zero cost
    if (models.some((u) => u.costBasis === "FIXTURE")) unpricedRuns += 1;
    for (const b of [total, byOutcome[run.status], ...(run.briefId !== null && soldBriefs.has(run.briefId) ? [] : [unsold])]) {
      b.runs += 1;
      b.measuredUsd += measured;
      b.upperBoundUsd += upper;
    }
  }
  const round = (b: Bucket): Bucket => ({ runs: b.runs, measuredUsd: usd(b.measuredUsd), upperBoundUsd: usd(b.upperBoundUsd) });

  const paid = orders.filter(isPaid);
  // revenue needs both: the mainnet rail, and the transfer read back from the chain. A paid order whose
  // delivery failed still counts, because the payment stands.
  const mainnet = paid.filter((o) => o.terms.rail === "OKX_X402_MAINNET");
  const revenueOrders = mainnet.filter((o) => o.payment?.chainVerified === true);
  // a mainnet order the chain has not confirmed is neither revenue nor a test payment; it is reported as what it is
  const unverifiedOrders = mainnet.filter((o) => o.payment?.chainVerified !== true);
  const testOrders = paid.filter((o) => o.terms.rail !== "OKX_X402_MAINNET");
  const sum = (list: Order[]) => usd(list.reduce((s, o) => s + Number(o.terms.priceUsd), 0));
  const perOrderAllowanceUsd = usd(allowances.paymentFeeReserveUsd + allowances.reworkReserveUsd + allowances.dataToolAllowanceUsd);
  const estimatedDeliveryUsd = usd(perOrderAllowanceUsd * paid.length);
  const revenueUsd = sum(revenueOrders);

  return {
    label: "AGGREGATE" as const,
    note: "Desk totals. Each investigation is counted once, including rejected, stopped and unsold work. Measured figures are what a provider reported; upper bounds and allowances are estimates. Test payments are not revenue.",
    investigations: { total: runs.length, published: byOutcome.PUBLISHED.runs, rejected: byOutcome.REJECTED.runs, stopped: byOutcome.STOPPED.runs, running: byOutcome.RUNNING.runs },
    research: {
      basis: "MEASURED model cost as reported by the provider; UPPER_BOUND for calls whose charge is unknown, carried at the price cap. Data and chain reads had no per-call charge.",
      total: round(total),
      byOutcome: { PUBLISHED: round(byOutcome.PUBLISHED), REJECTED: round(byOutcome.REJECTED), STOPPED: round(byOutcome.STOPPED), RUNNING: round(byOutcome.RUNNING) },
      /** research that no paid order has been placed against: rejected, stopped, running, or published and not bought */
      unsold: round(unsold),
      runsWithoutAPrice: unpricedRuns,
    },
    sales: {
      paidOrders: paid.length,
      revenueOrders: revenueOrders.length,
      revenueUsd,
      testOrders: testOrders.length,
      testPaymentsUsd: sum(testOrders),
      unverifiedMainnetOrders: unverifiedOrders.length,
      unverifiedMainnetUsd: sum(unverifiedOrders),
      note: paid.length > 0 && mainnet.length === 0 ? "Every paid order so far used test tokens or the fixture rail. Revenue is zero." : "Revenue counts only mainnet orders whose transfer was read back from the chain.",
    },
    delivery: {
      basis: "ESTIMATED",
      perPaidOrderUsd: perOrderAllowanceUsd,
      estimatedTotalUsd: estimatedDeliveryUsd,
      note: "Planning allowances per paid order (payment and fee reserve, rework reserve, data and tooling). No fee has been measured.",
    },
    /** revenue − measured research − upper-bound research − estimated delivery allowances; an estimate, not profit */
    estimatedContributionUsd: usd(revenueUsd - total.measuredUsd - total.upperBoundUsd - estimatedDeliveryUsd),
    contributionNote: "Estimate. Excludes labour, hosting, customer acquisition, overhead and tax. With no revenue it is simply what the desk has spent.",
  };
}
