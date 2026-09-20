import { getJson } from "../lib/api";

/**
 * Shapes mirror `apps/api/src/market/marketView.ts`. Read through `getJson`, so this screen adds
 * nothing to the shared client in `lib/api.ts` and can be merged without touching it.
 */

export type FigureLabel = "EVENT_IMPACT" | "REFERENCE_DISCREPANCY" | "ESTIMATED_QUOTED_SPREAD" | "INSUFFICIENT_DATA";

export interface FigureInput {
  name: string;
  value: string | null;
  unit: string;
  evidenceId: string | null;
  observedAt: string | null;
}

export interface Figure {
  key: string;
  label: FigureLabel;
  headline: string;
  value: string | null;
  unit: string;
  signed: boolean;
  inputs: FigureInput[];
  limitations: string[];
  missing: string[];
}

export interface CostAssumption {
  name: string;
  value: string | null;
  unit: string;
  basis: "ISSUER_PUBLISHED" | "UNKNOWN";
  note: string;
}

export interface MarketClocks {
  effectiveAt: string | null;
  firstDetectedAt: string;
  latestFetchAt: string | null;
  answeredAt: string;
  detectionLagSeconds: number | null;
  retrospective: boolean;
}

export interface MarketObservation {
  at: string;
  multiplier: string;
  source: "ISSUER" | "CHAIN";
  key: string;
  evidenceId: string | null;
  blockNumber: number | null;
  mode: string | null;
}

export interface ComparisonRow {
  what: string;
  source: string;
  url: string | null;
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
  kind: string;
  observedAt: string;
  staleAfter: string;
  stale: boolean;
  summary: string | null;
  values: Record<string, unknown> | null;
  valuesWithheld: boolean;
  provenance: { mode: string; source: string; url: string; fetchedAt: string; sha256: string; note?: string | null };
}

export interface MarketView {
  signalId: string;
  investigationId: string | null;
  asset: { symbol: string; name: string; underlyingSymbol: string; tokenIsin: string | null; network: string; chainId: number; tokenAddress: string };
  currency: string | null;
  currencyBasis: "SOURCE_STATED" | "ISSUER_FIELD_NAMING" | "UNKNOWN";
  headline: string;
  clocks: MarketClocks;
  figures: Figure[];
  costs: CostAssumption[];
  stillInteresting: { verdict: "NO_TRANSACTABLE_OPPORTUNITY" | "INSUFFICIENT_DATA"; because: string[] };
  observations: { points: MarketObservation[]; chainWithheld: boolean; chainReadCount: number; eventMarkerAt: string | null; note: string };
  comparison: ComparisonRow[];
  evidence: EvidenceRef[];
  brief: { briefId: string | null; forSale: boolean; priceUsd: string; resourcePath: string | null; withdrawn: boolean };
  deskEconomicsNote: string;
  statedHoldingTokens: string;
  dataMode: string;
}

export interface MarketResponse {
  audience: "PUBLIC" | "DIAGNOSTIC";
  market: MarketView;
}

/** the feed, so the screen can pick an event when the URL names none */
export interface MarketSignalRow {
  signal: { id: string; asset: { symbol: string }; headline: string; observedAt: string; detectedAt: string };
  investigation: { id: string; briefId: string | null } | null;
}

export const marketApi = {
  view: (signalId: string) => getJson<MarketResponse>(`/api/market/${signalId}`),
  signals: () => getJson<{ dataMode: string; signals: MarketSignalRow[] }>("/api/signals"),
};

/** How each label reads on screen, and the one sentence that says what kind of claim it is. */
export const LABELS = {
  EVENT_IMPACT: { text: "EVENT IMPACT", tone: "impact", meaning: "Arithmetic on the issuer's own published figures. No price, no venue, nothing estimated." },
  REFERENCE_DISCREPANCY: { text: "REFERENCE DISCREPANCY", tone: "reference", meaning: "Computed from a reference price, which has no side, no size and no venue. Not an executable quote." },
  ESTIMATED_QUOTED_SPREAD: { text: "ESTIMATED QUOTED SPREAD", tone: "spread", meaning: "Only ever shown for comparable buy-ask and sell-bid quotes with a size, fees and an expiry." },
  INSUFFICIENT_DATA: { text: "INSUFFICIENT DATA", tone: "missing", meaning: "An input is missing or stale. The figure is withheld and the missing inputs are named." },
} as const satisfies Record<FigureLabel, { text: string; tone: string; meaning: string }>;

/**
 * The headline, in plain English, derived from the sign of the balance change rather than assumed.
 * A corporate action can lower a multiplier as well as raise one, and the desk says which happened
 * rather than describing every rebase as a gain.
 */
export function plainHeadline(m: MarketView): string {
  const pct = m.figures.find((f) => f.key === "BALANCE_IMPACT")?.value ?? null;
  const symbol = m.asset.symbol;
  if (pct === null) return `${m.asset.name}: a corporate action changed how ${symbol} balances are scaled on X Layer`;
  if (pct === "0") return `${m.asset.name}: the issuer published an action that leaves every ${symbol} balance unchanged`;
  const fell = pct.startsWith("-");
  return `${m.asset.name}: every ${symbol} balance on X Layer ${fell ? "fell" : "grew"} by ${pct.replace("-", "")}%, and no transfer was emitted to show it`;
}

/** "3 h 47 min", for an age a reader has to judge freshness by */
export function humanAge(seconds: number | null): string {
  if (seconds === null) return "unknown";
  const s = Math.abs(Math.round(seconds));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
