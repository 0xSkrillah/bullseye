/**
 * The Market Desk view: one verified event, what it does to money, and everything the desk cannot
 * tell you about transacting on it.
 *
 * It is assembled entirely from what the desk already holds — the signal the detector wrote, the
 * evidence an investigation recorded, and the chain reads `projectChain` is willing to show this
 * reader. It makes no external call of its own, so opening this screen costs nothing and cannot
 * produce a figure that was not already sourced and hashed.
 *
 * Who may see what follows the rule the rest of the desk already uses (`http/projections.ts`):
 * the issuer's published figures are public, because anyone can read them from the issuer's own
 * public API and the detector already publishes them on `GET /api/signals`; what the chain returned,
 * and every figure derived from it, is the verification the Brief sells. When the chain side is
 * withheld, the figures that depend on it are withheld too — otherwise the desk would give the
 * paid number away by arithmetic.
 */
import type { EvidenceItem, SignalEvent } from "@bullseye/domain";
import type { ProjectedChain } from "../http/projections.js";
import { assessRebase, type CostAssumption, type Figure, type RebaseAssessment, type RebaseInputs } from "./impact.js";
import { isDecimalString } from "./decimal.js";

/**
 * Evidence whose values come from the issuer's public API and are therefore public here. Anything
 * read from X Layer is left out: its values are what a buyer pays for.
 */
const ISSUER_PUBLIC_KINDS: ReadonlySet<EvidenceItem["kind"]> = new Set(["CORPORATE_ACTION_RECORD", "ISSUER_MULTIPLIER_STATE", "REFERENCE_PRICE", "TRADING_STATUS", "PROOF_OF_RESERVES"]);

/** how old an observation may be before the desk refuses to compute money with it */
export const DEFAULT_STALENESS_LIMIT_SECONDS = 15 * 60;

/** the holding every value-in-money figure on the screen is stated for; the desk states it, it does not guess a reader's balance */
export const STATED_HOLDING_TOKENS = "100";

export interface MarketClocks {
  /** when the issuer says the action took effect */
  effectiveAt: string | null;
  /** when this desk's detector first saw it */
  firstDetectedAt: string;
  /** when the newest source response behind this screen was fetched */
  latestFetchAt: string | null;
  /** when this response was assembled */
  answeredAt: string;
  /** effectiveAt to firstDetectedAt, in seconds; negative would mean the desk saw it coming */
  detectionLagSeconds: number | null;
  /** true when the desk first saw the event well after it took effect: a look back, not a warning */
  retrospective: boolean;
}

export interface MarketObservation {
  at: string | null;
  multiplier: string | null;
  source: "ISSUER" | "CHAIN";
  /** BEFORE / ACTIVATION / AFTER / HEAD for chain reads; PUBLISHED_BEFORE / PUBLISHED_AFTER for the issuer */
  key: string;
  evidenceId: string | null;
  blockNumber: number | null;
  mode: string | null;
}

export interface ComparisonRow {
  what: string;
  source: string;
  url: string | null;
  /** the evidence item this row came from. Named here because every X Layer read shares one RPC URL. */
  evidenceId: string | null;
  value: string | null;
  unit: string;
  observedAt: string | null;
  fetchedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  mode: string | null;
  sha256: string | null;
  note: string | null;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceItem["kind"];
  observedAt: string;
  staleAfter: string;
  stale: boolean;
  /** null for a reader who may not see it */
  summary: string | null;
  values: Record<string, unknown> | null;
  valuesWithheld: boolean;
  provenance: EvidenceItem["provenance"];
}

export interface MarketView {
  signalId: string;
  investigationId: string | null;
  asset: { symbol: string; name: string; underlyingSymbol: string; tokenIsin: string | null; network: string; chainId: number; tokenAddress: string };
  /** the currency, and where the desk got it; never inferred from a ticker */
  currency: string | null;
  currencyBasis: "SOURCE_STATED" | "ISSUER_FIELD_NAMING" | "UNKNOWN";
  headline: string;
  clocks: MarketClocks;
  figures: Figure[];
  costs: CostAssumption[];
  stillInteresting: RebaseAssessment["stillInteresting"];
  observations: { points: MarketObservation[]; chainWithheld: boolean; chainReadCount: number; eventMarkerAt: string | null; note: string };
  comparison: ComparisonRow[];
  evidence: EvidenceRef[];
  /** the existing paid product this screen sits in front of */
  brief: { briefId: string | null; forSale: boolean; priceUsd: string; resourcePath: string | null; withdrawn: boolean };
  /** kept separate from every figure above: this is what Bullseye charges, not what the event is worth */
  deskEconomicsNote: string;
  statedHoldingTokens: string;
  dataMode: string;
}

export interface MarketViewDeps {
  signal: SignalEvent;
  investigationId: string | null;
  evidence: EvidenceItem[];
  chain: ProjectedChain | null;
  /** true when this reader may not see the chain's numbers */
  chainWithheld: boolean;
  briefId: string | null;
  briefWithdrawn: boolean;
  /** the Brief price as the config states it: a decimal string, never a float */
  priceUsd: string;
  now: Date;
  stalenessLimitSeconds?: number;
  /** DIAGNOSTIC readers see evidence summaries; a visitor sees that an item exists and how it was sourced */
  audience: "PUBLIC" | "DIAGNOSTIC";
}

function ageOf(observedAt: string | null, now: Date): number | null {
  if (!observedAt) return null;
  const then = Date.parse(observedAt);
  if (Number.isNaN(then)) return null;
  return Math.round((now.getTime() - then) / 1000);
}

/** a value from an evidence map, as a decimal string, or null when it is absent or not a decimal */
function decimalValue(item: EvidenceItem | undefined, key: string): string | null {
  if (!item) return null;
  const raw = item.values[key];
  if (typeof raw === "string") return isDecimalString(raw) ? raw : null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const text = String(raw);
    return isDecimalString(text) ? text : null;
  }
  return null;
}

function stringValue(item: EvidenceItem | undefined, key: string): string | null {
  const raw = item?.values[key];
  return typeof raw === "string" ? raw : null;
}

/**
 * Builds the view. Everything that needs a price is driven by EV-PRICE, and when no investigation
 * has recorded one the figures that need it say so instead of falling back to anything.
 */
export function buildMarketView(deps: MarketViewDeps): MarketView {
  const { signal, evidence, chain, now } = deps;
  const nowIso = now.toISOString();
  const staleness = deps.stalenessLimitSeconds ?? DEFAULT_STALENESS_LIMIT_SECONDS;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const price = byId.get("EV-PRICE");
  const status = byId.get("EV-STATUS");
  const action = byId.get("EV-CA");

  const priceValue = decimalValue(price, "quoteUsd");
  const referencePrice = price && priceValue !== null ? { value: priceValue, observedAt: price.observedAt, evidenceId: price.id } : null;

  // the chain's head read, only if this reader may see it
  const headRead = chain && !chain.withheld ? (chain.reads.find((r) => r.key === "HEAD") ?? null) : null;
  const chainMultiplier = headRead && headRead.multiplier !== null ? { value: headRead.multiplier, observedAt: headRead.blockTime, evidenceId: headRead.evidenceId } : null;

  /**
   * The currency, and where it comes from. The price endpoint returns a bare number and states no
   * currency at all, so the desk does not take one from it. What it does have is the issuer naming
   * its own fields: the corporate-action record publishes `grossCashflowUsd` and `netCashflowUsd`,
   * and the price evidence stores `quoteUsd`. That is the issuer stating the unit, in the field
   * name, and it is the same reading the rest of this repository already takes. It is reported as
   * such rather than presented as a currency the source declared in a currency field, and if the
   * issuer ever stops naming its fields that way the desk says the currency is unknown instead of
   * assuming the one it had yesterday.
   */
  const namedInUsd = stringValue(action, "currency") === null && (action?.values.netCashflowUsd !== undefined || action?.values.grossCashflowUsd !== undefined || price?.values.quoteUsd !== undefined);
  const statedCurrency = stringValue(action, "currency");
  const currency = statedCurrency ?? (namedInUsd ? "USD" : null);
  const currencyBasis: MarketView["currencyBasis"] = statedCurrency !== null ? "SOURCE_STATED" : namedInUsd ? "ISSUER_FIELD_NAMING" : "UNKNOWN";

  const inputs: RebaseInputs = {
    symbol: signal.asset.symbol,
    underlyingSymbol: signal.asset.underlyingSymbol,
    multiplierOld: signal.facts.multiplierOld,
    multiplierNew: signal.facts.multiplierNew,
    effectiveTimeUtc: signal.observedAt,
    netCashflowUsd: signal.facts.netCashflowUsd,
    grossCashflowUsd: signal.facts.grossCashflowUsd,
    withholdingTaxRate: signal.facts.withholdingTaxRate,
    referencePrice,
    currency,
    chainMultiplier,
    chainWithheld: deps.chainWithheld && chain !== null,
    holdingTokens: STATED_HOLDING_TOKENS,
    sizeLimits: null,
    stalenessLimitSeconds: staleness,
    now: nowIso,
  };
  const assessment = assessRebase(inputs);

  // ---- the four clocks, kept apart
  const fetchTimes = [...signal.sources.map((s) => s.fetchedAt), ...evidence.map((e) => e.provenance.fetchedAt)].filter((t): t is string => typeof t === "string").sort();
  const latestFetchAt = fetchTimes.length > 0 ? fetchTimes[fetchTimes.length - 1]! : null;
  const lag = ageOf(signal.observedAt, new Date(signal.detectedAt));
  const clocks: MarketClocks = {
    effectiveAt: signal.observedAt,
    firstDetectedAt: signal.detectedAt,
    latestFetchAt,
    answeredAt: nowIso,
    detectionLagSeconds: lag,
    retrospective: lag !== null && lag > 3600,
  };

  // ---- real timestamped observations only. Two from the issuer's record, and whatever the chain
  // reads recorded; no interpolation between them, and nothing invented before the first one.
  const points: MarketObservation[] = [
    { at: signal.observedAt, multiplier: signal.facts.multiplierOld, source: "ISSUER", key: "PUBLISHED_BEFORE", evidenceId: action?.id ?? null, blockNumber: null, mode: action?.provenance.mode ?? signal.provenance.mode },
    { at: signal.observedAt, multiplier: signal.facts.multiplierNew, source: "ISSUER", key: "PUBLISHED_AFTER", evidenceId: action?.id ?? null, blockNumber: null, mode: action?.provenance.mode ?? signal.provenance.mode },
  ];
  if (chain && !chain.withheld) {
    for (const r of chain.reads) points.push({ at: r.blockTime, multiplier: r.multiplier, source: "CHAIN", key: r.key, evidenceId: r.evidenceId, blockNumber: r.blockNumber, mode: r.mode });
    if (chain.activation) {
      const activationMultiplier = chain.reads.find((r) => r.key === "AFTER")?.multiplier ?? signal.facts.multiplierNew;
      points.push({ at: chain.activation.blockTime, multiplier: activationMultiplier, source: "CHAIN", key: "ACTIVATION", evidenceId: chain.activation.evidenceId, blockNumber: chain.activation.blockNumber, mode: chain.activation.mode });
    }
  }
  const chainReadCount = chain ? chain.reads.length + (chain.activation ? 1 : 0) : 0;
  const observations = {
    points: points.filter((p) => p.at !== null),
    chainWithheld: Boolean(chain?.withheld),
    chainReadCount,
    eventMarkerAt: signal.observedAt,
    note:
      chain === null
        ? "No on-chain read has been recorded for this event. The issuer's published step is shown alone; nothing is drawn between or before the points."
        : chain.withheld
          ? `${chainReadCount} on-chain reads exist for this event. Their block times and values are part of the Brief, so the chart shows the issuer's published step only.`
          : "Every point is one recorded observation at its own timestamp: the issuer's published step, and one `multiplier()` read per block the desk actually read. Nothing is drawn between them.",
  };

  // ---- the comparison panel: what each side is, where it came from, when, and in what unit
  const comparison: ComparisonRow[] = [];
  const row = (what: string, item: EvidenceItem | undefined, value: string | null, unit: string, note: string | null, source?: string, observedAt?: string | null): void => {
    const at = observedAt ?? item?.observedAt ?? null;
    const age = ageOf(at, now);
    comparison.push({
      what,
      source: source ?? item?.provenance.source ?? "—",
      url: item?.provenance.url ?? null,
      evidenceId: item?.id ?? null,
      value,
      unit,
      observedAt: at,
      fetchedAt: item?.provenance.fetchedAt ?? null,
      ageSeconds: age,
      stale: item ? Date.parse(item.staleAfter) <= now.getTime() : age === null || age > staleness,
      mode: item?.provenance.mode ?? null,
      sha256: item?.provenance.sha256 ?? null,
      note,
    });
  };
  row("Multiplier the issuer published", action, signal.facts.multiplierNew, "multiplier, 18 decimals", "The issuer's own corporate-action record. Public.", undefined, signal.observedAt);
  if (deps.chainWithheld && chain) {
    row("Multiplier on X Layer", undefined, null, "multiplier, 18 decimals", "Part of the Brief. The read happened; its value is not in this view.", "X Layer", null);
  } else if (chainMultiplier) {
    row("Multiplier on X Layer", byId.get("EV-CHAIN-LATEST"), chainMultiplier.value, "multiplier, 18 decimals", "`multiplier()` read at the head block, compared with the issuer at 18 decimals.", "X Layer", chainMultiplier.observedAt);
  } else {
    row("Multiplier on X Layer", undefined, null, "multiplier, 18 decimals", "No read recorded.", "X Layer", null);
  }
  row("Issuer reference price", price, priceValue, currency ? `${currency} per unit, denominator not stated by the issuer` : "currency not stated", "One number, no side, no size, no venue, no observation time of its own. Dated by fetch time.", undefined, price?.observedAt);
  row("Executable buy quote (ask)", undefined, null, currency ?? "currency not stated", "No source in the permitted set publishes one.", "—", null);
  row("Executable sell quote (bid)", undefined, null, currency ?? "currency not stated", "No source in the permitted set publishes one.", "—", null);
  row("Quote size", undefined, null, `${signal.asset.symbol} tokens`, "No quote, so no size. The figures in money above use the desk's stated holding of " + STATED_HOLDING_TOKENS + ".", "—", null);
  row("Quote expiry", undefined, null, "seconds", "No quote, so nothing expires. Freshness here is the age of a reference observation.", "—", null);
  const halted = status ? status.values.isMarketTradingHalted === true || status.values.isAtomicTradingHalted === true : null;
  row("Trading status", status, halted === null ? null : halted ? "halted" : "not halted", "halt flags", status ? status.summary.replace(/^Issuer trading status: /, "") : "Not recorded: no investigation has read the issuer status for this event.", undefined, status?.observedAt);

  // ---- the evidence drawer
  const evidenceRefs: EvidenceRef[] = evidence.map((e) => {
    const publicValues = ISSUER_PUBLIC_KINDS.has(e.kind);
    const show = deps.audience === "DIAGNOSTIC" || !deps.chainWithheld || publicValues;
    return {
      id: e.id,
      kind: e.kind,
      observedAt: e.observedAt,
      staleAfter: e.staleAfter,
      stale: Date.parse(e.staleAfter) <= now.getTime(),
      summary: deps.audience === "DIAGNOSTIC" || (publicValues && !deps.chainWithheld) ? e.summary : null,
      values: show ? (e.values as Record<string, unknown>) : null,
      valuesWithheld: !show,
      provenance: e.provenance,
    };
  });

  const modes = [signal.provenance.mode, ...evidence.map((e) => e.provenance.mode)];
  const weakest = modes.includes("FIXTURE") ? "FIXTURE" : modes.includes("HISTORICAL") ? "HISTORICAL" : modes.includes("CACHED") ? "CACHED" : "LIVE";

  return {
    signalId: signal.id,
    investigationId: deps.investigationId,
    asset: { symbol: signal.asset.symbol, name: signal.asset.name, underlyingSymbol: signal.asset.underlyingSymbol, tokenIsin: signal.asset.isin, network: signal.asset.network, chainId: signal.asset.chainId, tokenAddress: signal.asset.tokenAddress },
    currency,
    currencyBasis,
    headline: assessment.headline,
    clocks,
    figures: assessment.figures,
    costs: assessment.costs,
    stillInteresting: assessment.stillInteresting,
    observations,
    comparison,
    evidence: evidenceRefs,
    brief: { briefId: deps.briefId, forSale: deps.briefId !== null && !deps.briefWithdrawn, priceUsd: deps.priceUsd, resourcePath: deps.briefId ? `/api/v1/briefs/${deps.briefId}` : null, withdrawn: deps.briefWithdrawn },
    deskEconomicsNote: "The Brief price is what Bullseye charges for the verification, and is not part of any figure above. A buyer's opportunity and this desk's sales are separate ledgers; the desk's own totals are at GET /api/desk/economics.",
    statedHoldingTokens: STATED_HOLDING_TOKENS,
    dataMode: weakest,
  };
}
