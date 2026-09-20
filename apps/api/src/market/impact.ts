/**
 * What a verified rebase means in money, and what it does not mean.
 *
 * Every figure here is computed by `./decimal.js` from values the desk already holds as evidence.
 * No model writes a number in this file and no number is rounded twice. Each figure carries its
 * own inputs, its own limitations and one of four labels, so a reader can see which kind of claim
 * they are being shown before they read the value:
 *
 *   EVENT_IMPACT            arithmetic on the issuer's own published figures. No price needed, no
 *                           venue involved, nothing estimated.
 *   REFERENCE_DISCREPANCY   two figures that measure the same thing, both observed, compared. A
 *                           reference price is not an executable quote, so this is never an edge.
 *   ESTIMATED_QUOTED_SPREAD only for comparable buy-ask and sell-bid quotes with size, fees and an
 *                           expiry. Nothing in the permitted sources produces one today.
 *   INSUFFICIENT_DATA       an input is missing or stale. The figure is withheld and the missing
 *                           inputs are named. It is never filled in with a zero or a guess.
 *
 * The distinction the whole file turns on: a rebase multiplier changes how many tokens a holder
 * has. It is not a price return. Multiplying a balance that already includes the new multiplier by
 * that multiplier again is the most likely way to be wrong about this event, and by exactly how
 * much is `doubleAdjustmentError`.
 */
import { CHAIN_PLACES, div, exactEquals, format, formatTrimmed, from, mul, parse, pctChange, product, signedDiff, sub, type Decimal } from "./decimal.js";

export type FigureLabel = "EVENT_IMPACT" | "REFERENCE_DISCREPANCY" | "ESTIMATED_QUOTED_SPREAD" | "INSUFFICIENT_DATA";

export interface FigureInput {
  name: string;
  value: string | null;
  unit: string;
  /** the evidence item this came from, so the drawer can open it */
  evidenceId: string | null;
  /** when the value was true, not when it was fetched; the two are separate cards on the desk */
  observedAt: string | null;
}

export interface Figure {
  key: string;
  label: FigureLabel;
  /** one sentence in plain English, true whether or not `value` is present */
  headline: string;
  value: string | null;
  unit: string;
  /** the signed difference, when the figure is a comparison; negative means the later value is lower */
  signed: boolean;
  inputs: FigureInput[];
  limitations: string[];
  /** inputs that do not exist or are too old to use; non-empty exactly when the label is INSUFFICIENT_DATA */
  missing: string[];
}

/** a cost the desk knows it must account for, and what it actually knows about it */
export interface CostAssumption {
  name: string;
  value: string | null;
  unit: string;
  basis: "ISSUER_PUBLISHED" | "UNKNOWN";
  note: string;
}

export interface RebaseInputs {
  symbol: string;
  underlyingSymbol: string;
  /** the issuer's published multipliers, as decimal strings, exactly as sent */
  multiplierOld: string;
  multiplierNew: string;
  effectiveTimeUtc: string | null;
  /** net cash per underlying share the issuer says the action distributes; null when not stated */
  netCashflowUsd: string | null;
  grossCashflowUsd: string | null;
  withholdingTaxRate: string | null;
  /** the issuer's reference price and when it was read; null when the issuer is publishing none */
  referencePrice: { value: string; observedAt: string; evidenceId: string | null } | null;
  /** currency, only if a source states it; never assumed from a ticker */
  currency: string | null;
  /** what the chain returned at the head, when the reader is allowed to see it */
  chainMultiplier: { value: string; observedAt: string | null; evidenceId: string | null } | null;
  /** true when the chain side exists but this reader may not see the numbers: it is part of the Brief */
  chainWithheld: boolean;
  /** the holding the figures are computed for, in tokens. The desk states it; it never assumes one. */
  holdingTokens: string | null;
  /** issuer order-size limits for the period in force when the asset was read */
  sizeLimits: { minOrderFiatValue: string | null; maxOrderFiatValue: string | null; period: string | null } | null;
  /** how old an observation may be before the desk stops computing with it */
  stalenessLimitSeconds: number;
  /** the instant the desk is answering at */
  now: string;
}

const EVENT_IMPACT_UNIT = "% of a holder's token balance";

function input(name: string, value: string | null, unit: string, evidenceId: string | null = null, observedAt: string | null = null): FigureInput {
  return { name, value, unit, evidenceId, observedAt };
}

function insufficient(key: string, headline: string, unit: string, missing: string[], inputs: FigureInput[], limitations: string[] = []): Figure {
  return { key, label: "INSUFFICIENT_DATA", headline, value: null, unit, signed: false, inputs, limitations, missing };
}

/** seconds between two instants, or null when either is missing */
export function ageSeconds(observedAt: string | null, now: string): number | null {
  if (!observedAt) return null;
  const then = Date.parse(observedAt);
  const at = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(at)) return null;
  return Math.round((at - then) / 1000);
}

export function isStale(observedAt: string | null, now: string, limitSeconds: number): boolean {
  const age = ageSeconds(observedAt, now);
  return age === null || age > limitSeconds;
}

/**
 * How much more of the token a holder has after the rebase, as a percentage of what they had.
 * This is the whole event, and it needs no price: balances are scaled by the multiplier.
 */
export function balanceImpact(i: RebaseInputs): Figure {
  const pct = pctChange(i.multiplierOld, i.multiplierNew);
  return {
    key: "BALANCE_IMPACT",
    label: "EVENT_IMPACT",
    headline: `Every ${i.symbol} balance on X Layer was scaled by ${i.multiplierNew} / ${i.multiplierOld}, so a holder who did nothing holds ${pct}% more ${i.symbol} than before.`,
    value: pct,
    unit: EVENT_IMPACT_UNIT,
    signed: true,
    inputs: [input("multiplier before", i.multiplierOld, "multiplier", "EV-CA", i.effectiveTimeUtc), input("multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc)],
    limitations: [
      "This is a change in the number of tokens, not a price return. The holder's position is worth more because they hold more, not because each token is worth more.",
      "No Transfer event is emitted by a rebase, so a balance read from transfer history alone will miss it entirely.",
    ],
    missing: [],
  };
}

/**
 * The error a cache makes if it still holds the pre-rebase balance. It is not the same number as
 * the rise: a rise of x% leaves the old value understating the new one by x/(1+x).
 */
export function staleBalanceError(i: RebaseInputs): Figure {
  const understatement = pctChange(i.multiplierNew, i.multiplierOld);
  const rise = pctChange(i.multiplierOld, i.multiplierNew);
  return {
    key: "STALE_BALANCE_ERROR",
    label: "EVENT_IMPACT",
    headline: `A cache still holding the pre-rebase balance now understates the holding by ${understatement.replace("-", "")}% — not by the ${rise}% it rose, because the two are percentages of different bases.`,
    value: understatement,
    unit: EVENT_IMPACT_UNIT,
    signed: true,
    inputs: [input("multiplier before", i.multiplierOld, "multiplier", "EV-CA", i.effectiveTimeUtc), input("multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc)],
    limitations: ["Both figures describe the same event. Quoting the wrong one of the two overstates or understates the correction by the square of the rebase."],
    missing: [],
  };
}

/**
 * What happens if the new multiplier is applied to a balance that already includes it. `balanceOf`
 * on the token returns the scaled balance, so a system that stores shares and scales them is right,
 * and a system that reads `balanceOf` and scales it again is wrong by this much.
 *
 * Note this depends only on the new multiplier, not on the size of the change: it is the same error
 * whether the multiplier moved a little or a lot.
 */
export function doubleAdjustmentError(i: RebaseInputs): Figure {
  const pct = pctChange("1", i.multiplierNew);
  const rise = pctChange(i.multiplierOld, i.multiplierNew);
  const coincide = exactEquals(i.multiplierOld, "1");
  return {
    key: "DOUBLE_ADJUSTMENT_ERROR",
    label: "EVENT_IMPACT",
    headline:
      `Applying the multiplier to a balance that already includes it overstates the holding by ${pct}%.` +
      (coincide
        ? ` Here that is the same number as the rebase itself, because the multiplier started at 1; for an asset whose multiplier was already above 1 the two differ.`
        : ` That is not the ${rise}% the multiplier moved by: the error is set by the multiplier's level, not by the size of the change.`),
    value: pct,
    unit: EVENT_IMPACT_UNIT,
    signed: true,
    inputs: [input("multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc), input("assumed base", "1", "multiplier", null, null)],
    limitations: ["`multiplier()` and `balanceOf()` are read from the same contract. Whether a consumer must apply the multiplier depends on which of the two it stored, and the desk cannot know that for a third-party system."],
    missing: [],
  };
}

/**
 * The price per share at which the issuer's cash distribution equals the multiplier increase it
 * published. It is a reference discrepancy against the issuer's own current price, and it is
 * dominated by the gap between the two observation times, which is why that gap is a limitation
 * and not a footnote.
 */
export function impliedReinvestmentPrice(i: RebaseInputs): Figure {
  const inputs = [
    input("net cash distributed", i.netCashflowUsd, i.currency ? `${i.currency} per ${i.underlyingSymbol} share (denominator not stated by the issuer)` : "per share, currency not stated", "EV-CA", i.effectiveTimeUtc),
    input("multiplier before", i.multiplierOld, "multiplier", "EV-CA", i.effectiveTimeUtc),
    input("multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc),
    input("issuer reference price", i.referencePrice?.value ?? null, i.currency ? `${i.currency}` : "currency not stated", i.referencePrice?.evidenceId ?? "EV-PRICE", i.referencePrice?.observedAt ?? null),
  ];
  const missing: string[] = [];
  if (i.netCashflowUsd === null) missing.push("the issuer states no net cashflow for this action");
  if (i.referencePrice === null) missing.push("the issuer is publishing no reference price for this asset right now");
  if (i.referencePrice && isStale(i.referencePrice.observedAt, i.now, i.stalenessLimitSeconds)) {
    const age = ageSeconds(i.referencePrice.observedAt, i.now);
    missing.push(`the reference price was observed ${age === null ? "at an unknown time" : `${age} s ago`}, past this desk's ${i.stalenessLimitSeconds} s limit`);
  }
  if (missing.length > 0) {
    return insufficient(
      "IMPLIED_REINVESTMENT_PRICE",
      "The price implied by the issuer's own multiplier cannot be compared with its reference price.",
      i.currency ?? "currency not stated",
      missing,
      inputs,
      ["Without a current reference price there is nothing to compare the implied price against. The desk shows no difference rather than an old one."],
    );
  }
  const relativeRise = sub(div(from(i.multiplierNew, "multiplier after"), from(i.multiplierOld, "multiplier before")), parse("1"));
  if (relativeRise === 0n) {
    return insufficient("IMPLIED_REINVESTMENT_PRICE", "The multiplier did not change, so no reinvestment price is implied.", i.currency ?? "currency not stated", ["the multiplier before and after are equal"], inputs);
  }
  const implied: Decimal = div(from(i.netCashflowUsd!, "net cash distributed"), relativeRise, "relative multiplier increase");
  const impliedText = format(implied, 4);
  const observed = i.referencePrice!.value;
  const difference = signedDiff(impliedText, observed, 4);
  const differencePct = pctChange(impliedText, observed, 6);
  return {
    key: "IMPLIED_REINVESTMENT_PRICE",
    label: "REFERENCE_DISCREPANCY",
    headline:
      `The issuer's multiplier implies the distribution was reinvested at ${impliedText} ${i.currency ?? ""} per ${i.underlyingSymbol} share. ` +
      `Its own reference price, read ${i.referencePrice!.observedAt}, is ${observed}: a difference of ${difference} (${differencePct}%).`,
    value: impliedText,
    unit: i.currency ? `${i.currency} per ${i.underlyingSymbol} share` : "per share, currency not stated",
    signed: false,
    inputs: [...inputs, input("difference, reference minus implied", difference, i.currency ?? "currency not stated", null, i.referencePrice!.observedAt)],
    limitations: [
      `The two figures were not observed at the same moment: the action is dated ${i.effectiveTimeUtc ?? "not stated"} and the price ${i.referencePrice!.observedAt}. Most of this difference is that gap, not a mispricing.`,
      "The issuer does not state what its cashflow figure is per, so reading it as per underlying share is this desk's assumption and is shown as one.",
      "A reference price has no side, no size and no venue. This difference is not a spread and cannot be transacted at.",
    ],
    missing: [],
  };
}

/** what a stated holding was worth before and after, if a price exists at all */
export function positionValue(i: RebaseInputs): Figure {
  const inputs = [
    input("holding", i.holdingTokens, `${i.symbol} tokens`, null, null),
    input("issuer reference price", i.referencePrice?.value ?? null, i.currency ?? "currency not stated", i.referencePrice?.evidenceId ?? "EV-PRICE", i.referencePrice?.observedAt ?? null),
    input("multiplier before", i.multiplierOld, "multiplier", "EV-CA", i.effectiveTimeUtc),
    input("multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc),
  ];
  const missing: string[] = [];
  if (i.holdingTokens === null) missing.push("no holding size has been stated");
  if (i.referencePrice === null) missing.push("the issuer is publishing no reference price for this asset right now");
  if (i.referencePrice && isStale(i.referencePrice.observedAt, i.now, i.stalenessLimitSeconds)) missing.push(`the reference price is older than this desk's ${i.stalenessLimitSeconds} s limit`);
  if (missing.length > 0) {
    return insufficient("POSITION_VALUE", "What the rebase is worth on a holding cannot be stated without both a size and a current price.", i.currency ?? "currency not stated", missing, inputs, [
      "The balance change above is exact and needs no price. Only its value in money needs one.",
    ]);
  }
  const price = from(i.referencePrice!.value, "issuer reference price");
  const holding = from(i.holdingTokens!, "holding");
  const before = mul(holding, price);
  const after = mul(mul(holding, div(from(i.multiplierNew, "multiplier after"), from(i.multiplierOld, "multiplier before"))), price);
  const gain = sub(after, before);
  return {
    key: "POSITION_VALUE",
    label: "REFERENCE_DISCREPANCY",
    headline:
      `At the issuer's reference price of ${i.referencePrice!.value}, a holding of ${i.holdingTokens} ${i.symbol} went from ${format(before, 2)} to ${format(after, 2)} ${i.currency ?? ""}: ` +
      `${format(gain, 2)} more, from holding more tokens at the same price per token.`,
    value: format(gain, 2),
    unit: i.currency ? `${i.currency} on the stated holding` : "on the stated holding, currency not stated",
    signed: true,
    inputs: [...inputs, input("value before", format(before, 2), i.currency ?? "currency not stated", null, i.referencePrice!.observedAt), input("value after", format(after, 2), i.currency ?? "currency not stated", null, i.referencePrice!.observedAt)],
    limitations: [
      "Priced at a reference price, not at a quote anyone offered, and with no fee, spread or slippage deducted. It is a valuation, not a realisable amount.",
      "The price is the price now, not the price at the effective time. It is applied to both sides of the comparison, so the difference is the balance change alone.",
      "The holding is the size stated on this screen. The desk does not know any reader's actual balance.",
    ],
    missing: [],
  };
}

/**
 * The spread the desk would need before it could say anything about transacting. It has none of it,
 * and says which pieces are missing rather than estimating around them.
 */
export function quotedSpread(i: RebaseInputs): Figure {
  const closed = i.sizeLimits?.maxOrderFiatValue !== undefined && i.sizeLimits?.maxOrderFiatValue !== null && exactEquals(i.sizeLimits.maxOrderFiatValue, "0");
  return insufficient(
    "QUOTED_SPREAD",
    "No spread is shown, because no two-sided quote exists in the sources this desk is allowed to read.",
    i.currency ?? "currency not stated",
    [
      "no buy-side ask price",
      "no sell-side bid price",
      "no quote size",
      "no quote expiry",
      "no venue or counterparty",
      "no published fee schedule",
      ...(closed ? [`the issuer's own venue is in period "${i.sizeLimits?.period ?? "closed"}" with a maximum order value of 0: there is no transaction path open at any size`] : []),
    ],
    [
      input("bid", null, i.currency ?? "currency not stated"),
      input("ask", null, i.currency ?? "currency not stated"),
      input("size", null, `${i.symbol} tokens`),
      input("minimum order", i.sizeLimits?.minOrderFiatValue ?? null, i.currency ? `${i.currency} notional` : "notional", "EV-STATUS", null),
      input("maximum order", i.sizeLimits?.maxOrderFiatValue ?? null, i.currency ? `${i.currency} notional` : "notional", "EV-STATUS", null),
    ],
    [
      "The issuer publishes one reference number per asset. A reference price is not a quote: it has no side, no size, no expiry and no one standing behind it.",
      "An estimate built from a reference price and an assumed spread would be a number about this desk's assumptions, not about the market, so none is shown.",
    ],
  );
}

/**
 * Net edge is suppressed, and this figure exists so the screen can say why rather than leave a gap.
 * It stays suppressed while any essential input is missing: that is every reading of this slice.
 */
export function netEdge(i: RebaseInputs, costs: CostAssumption[]): Figure {
  const unknownCosts = costs.filter((c) => c.basis === "UNKNOWN").map((c) => `${c.name} is unknown`);
  return insufficient(
    "NET_EDGE",
    "No net edge is claimed. The inputs a net figure would need do not exist, and an unknown cost is not zero.",
    i.currency ?? "currency not stated",
    ["no executable quote to net against", ...unknownCosts],
    costs.map((c) => input(c.name, c.value, c.unit, null, null)),
    [
      "Every cost below that is marked unknown stays unknown. Treating one as zero would turn a missing input into a favourable assumption.",
      "Because there is no quote, there is also nothing whose fees might already be included: no cost here is double-counted, and none is netted.",
    ],
  );
}

/** the issuer's figure against the chain's, when the reader may see the chain's */
export function issuerVersusChain(i: RebaseInputs): Figure {
  const inputs = [input("issuer multiplier after", i.multiplierNew, "multiplier", "EV-CA", i.effectiveTimeUtc), input("multiplier() on X Layer", i.chainMultiplier?.value ?? null, "multiplier", i.chainMultiplier?.evidenceId ?? "EV-CHAIN-LATEST", i.chainMultiplier?.observedAt ?? null)];
  if (i.chainWithheld) {
    return insufficient("ISSUER_VERSUS_CHAIN", "What the chain returned is part of the Brief. This view shows that the read happened, not what it found.", "multiplier", ["the on-chain reads are paid content in this view"], inputs, [
      "The issuer's published figures above are public and complete. The verification against X Layer is what the Brief sells.",
    ]);
  }
  if (!i.chainMultiplier) {
    return insufficient("ISSUER_VERSUS_CHAIN", "No on-chain read exists for this event yet.", "multiplier", ["no multiplier() read has been recorded"], inputs);
  }
  const agree = exactEquals(i.chainMultiplier.value, i.multiplierNew);
  const diff = signedDiff(i.multiplierNew, i.chainMultiplier.value, CHAIN_PLACES);
  return {
    key: "ISSUER_VERSUS_CHAIN",
    label: "EVENT_IMPACT",
    headline: agree
      ? `X Layer and the issuer agree: multiplier() returns ${i.chainMultiplier.value}, equal to the published ${i.multiplierNew} at all 18 decimals.`
      : `X Layer and the issuer disagree: multiplier() returns ${i.chainMultiplier.value} against a published ${i.multiplierNew}, a difference of ${diff}.`,
    value: diff,
    unit: "multiplier, at 18 decimals",
    signed: true,
    inputs,
    limitations: ["Compared at the 18 decimals the contract stores, not as floating-point numbers.", agree ? "Agreement at the head does not say when the change landed; the activation block is a separate read." : "A disagreement here is a finding about the two sources, not an error in either read."],
    missing: [],
  };
}

/**
 * The costs a buyer would have to know about. The issuer publishes two of them; the rest it does
 * not, and those stay unknown. Nothing here defaults to zero.
 */
export function costAssumptions(i: RebaseInputs): CostAssumption[] {
  return [
    {
      name: "withholding tax on the distribution",
      value: i.withholdingTaxRate,
      unit: "rate",
      basis: i.withholdingTaxRate === null ? "UNKNOWN" : "ISSUER_PUBLISHED",
      note: i.withholdingTaxRate === null ? "the issuer states no withholding rate for this action" : `the issuer states ${i.withholdingTaxRate}; gross ${i.grossCashflowUsd ?? "not stated"} against net ${i.netCashflowUsd ?? "not stated"}`,
    },
    {
      name: "minimum order value at the issuer",
      value: i.sizeLimits?.minOrderFiatValue ?? null,
      unit: i.currency ? `${i.currency} notional` : "notional",
      basis: i.sizeLimits?.minOrderFiatValue ? "ISSUER_PUBLISHED" : "UNKNOWN",
      note: i.sizeLimits?.minOrderFiatValue
        ? "published per trading period on the issuer's asset record; a size below it is not transactable there"
        : "the issuer publishes a per-period order-size band on its asset record, but this desk did not record it as evidence for this event; `npm run market-probe` reads it live",
    },
    {
      name: "maximum order value at the issuer",
      value: i.sizeLimits?.maxOrderFiatValue ?? null,
      unit: i.currency ? `${i.currency} notional` : "notional",
      basis: i.sizeLimits?.maxOrderFiatValue ? "ISSUER_PUBLISHED" : "UNKNOWN",
      note: i.sizeLimits?.maxOrderFiatValue
        ? exactEquals(i.sizeLimits.maxOrderFiatValue, "0")
          ? `zero in the current period ("${i.sizeLimits.period ?? "unknown"}"): nothing can be transacted there right now`
          : "published per trading period on the issuer's asset record"
        : "not recorded as evidence for this event; the issuer's band goes to zero while its venue is closed, which `npm run market-probe` shows live",
    },
    { name: "issuance or redemption fee", value: null, unit: "unknown", basis: "UNKNOWN", note: "not published in the sources this desk reads" },
    { name: "spread paid on entry or exit", value: null, unit: "unknown", basis: "UNKNOWN", note: "no two-sided quote exists to measure one from" },
    { name: "slippage at size", value: null, unit: "unknown", basis: "UNKNOWN", note: "no depth or book is published" },
    { name: "X Layer transaction cost", value: null, unit: "unknown", basis: "UNKNOWN", note: "not read by this slice; a gas estimate is not a fee schedule and none is assumed" },
  ];
}

export interface RebaseAssessment {
  figures: Figure[];
  costs: CostAssumption[];
  /** the one sentence at the top of the screen; assembled by code from the figures, never written by a model */
  headline: string;
  /** the answer to the question the desk exists to ask */
  stillInteresting: { verdict: "NO_TRANSACTABLE_OPPORTUNITY" | "INSUFFICIENT_DATA"; because: string[] };
}

/**
 * Assembles the whole assessment. The order is the order the screen reads in: what happened, what
 * it does to a balance, the two ways to get it wrong, what it is worth, and then everything the
 * desk cannot tell you.
 */
export function assessRebase(i: RebaseInputs): RebaseAssessment {
  const costs = costAssumptions(i);
  const figures = [balanceImpact(i), doubleAdjustmentError(i), staleBalanceError(i), issuerVersusChain(i), positionValue(i), impliedReinvestmentPrice(i), quotedSpread(i), netEdge(i, costs)];
  const impact = pctChange(i.multiplierOld, i.multiplierNew);
  const priced = figures.find((f) => f.key === "POSITION_VALUE")?.label !== "INSUFFICIENT_DATA";
  // Each of the two errors is named with its OWN figure. A stale cache is not wrong by the rebase:
  // it understates by x/(1+x), which is STALE_BALANCE_ERROR, and the lede used to say "by that
  // much" — making, in prose, the exact mistake the figure below it exists to warn against.
  const stale = pctChange(i.multiplierNew, i.multiplierOld).replace("-", "");
  const headline =
    `${i.symbol} holders on X Layer hold ${impact}% more tokens after this ${i.effectiveTimeUtc ? `action effective ${i.effectiveTimeUtc}` : "action"}, and no Transfer event says so. ` +
    `A balance cached before it now understates the holding by ${stale}%, and anything that applies the multiplier to an already-scaled balance overstates it by ${pctChange("1", i.multiplierNew)}%. ` +
    (priced ? "Its value in money is shown at the issuer's reference price, which is not a quote." : "Its value in money is not shown: the issuer is publishing no reference price right now.");
  const because = [
    "No source the desk may read publishes a bid, an ask, a size or an expiry, so no spread can be quoted and none is estimated.",
    ...(i.sizeLimits?.maxOrderFiatValue && exactEquals(i.sizeLimits.maxOrderFiatValue, "0") ? [`The issuer's venue is in period "${i.sizeLimits.period ?? "closed"}" with a maximum order value of 0: no size is transactable there at this moment.`] : []),
    "Entry and exit costs, fees and slippage are unknown and are carried as unknown, so no net figure is available to compare against.",
    "The balance effect above is exact and is the part of this event that is certain. It accrues to whoever already holds the token; it is not an entry opportunity.",
  ];
  return { figures, costs, headline, stillInteresting: { verdict: "NO_TRANSACTABLE_OPPORTUNITY", because } };
}

/** exported for the tests: the same rounding the screen shows, so a test asserts what a reader sees */
export const show = { format, formatTrimmed, product };
