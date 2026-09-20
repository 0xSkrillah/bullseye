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
  /**
   * `asset.name` and `facts` are the issuer's own published fields, already in this response and
   * now read: the explanatory layer names the companies and works the event's arithmetic from the
   * multipliers rather than restating either. Both are optional so an older server that answers
   * without them renders the screen with those parts absent rather than failing.
   */
  signal: {
    id: string;
    asset: { symbol: string; name?: string };
    headline: string;
    observedAt: string;
    detectedAt: string;
    facts?: { multiplierOld?: string; multiplierNew?: string };
  };
  /** the issuer replaced or cancelled this action; it is not counted in the explanatory layer */
  superseded?: boolean;
  investigation: { id: string; briefId: string | null } | null;
}

/**
 * The public part of `/api/health`: what the desk is running on and which rail a purchase would
 * use. It carries no buyer detail and nothing that is only in a Brief, so the free screen may read
 * it to say what a report costs and on what network.
 */
export interface MarketHealth {
  priceUsd: string;
  paymentRail: { rail: string; network: string; ready: boolean; isTestnet: boolean; detail: string };
  dataSource: { mode: string; asOf: string };
}

export const marketApi = {
  view: (signalId: string) => getJson<MarketResponse>(`/api/market/${encodeURIComponent(signalId)}`),
  signals: () => getJson<{ dataMode: string; signals: MarketSignalRow[] }>("/api/signals"),
  health: () => getJson<MarketHealth>("/api/health"),
};

/** How each label reads on screen, and the one sentence that says what kind of claim it is. */
export const LABELS = {
  EVENT_IMPACT: { text: "EVENT IMPACT", tone: "impact", meaning: "Arithmetic on the issuer's own published figures. No price, no venue, nothing estimated." },
  REFERENCE_DISCREPANCY: { text: "REFERENCE DISCREPANCY", tone: "reference", meaning: "Computed from a reference price, which has no side, no size and no venue. Not an executable quote." },
  ESTIMATED_QUOTED_SPREAD: { text: "ESTIMATED QUOTED SPREAD", tone: "spread", meaning: "Only ever shown for comparable buy-ask and sell-bid quotes with a size, fees and an expiry." },
  INSUFFICIENT_DATA: { text: "INSUFFICIENT DATA", tone: "missing", meaning: "An input is missing or stale. The figure is withheld and the missing inputs are named." },
} as const satisfies Record<FigureLabel, { text: string; tone: string; meaning: string }>;

/**
 * Which section each figure belongs to, keyed by the figure itself and never by its label.
 *
 * Grouping by label would make a figure vanish the moment its label changed — and the labels do
 * change: the comparison with the chain becomes INSUFFICIENT_DATA both when no read exists and
 * when the reads are withheld as part of the Brief, which is precisely when the reader most needs
 * to see the card saying so. Anything this table does not name still renders, in the last section,
 * so a figure added to the API can never quietly disappear from the screen.
 */
export const FIGURE_SECTIONS = [
  {
    title: "The event, and the two ways a book gets it wrong",
    note: "Arithmetic on the issuer's published multipliers. No price is involved, so none of these figures can be stale for want of one. A rebase percentage is a change in the number of tokens, not a price return. Two of these are the size of an error rather than the size of the event: what a balance cached before the change now understates by, and what applying the multiplier to an already-scaled balance overstates by.",
    keys: ["BALANCE_IMPACT", "DOUBLE_ADJUSTMENT_ERROR", "STALE_BALANCE_ERROR", "ISSUER_VERSUS_CHAIN"],
  },
  { title: "What it is worth, at a reference price", note: null, keys: ["POSITION_VALUE", "IMPLIED_REINVESTMENT_PRICE"] },
  { title: "What the desk cannot tell you", note: null, keys: ["QUOTED_SPREAD", "NET_EDGE"] },
] as const;

/** every figure, in its section, with anything unrecognised kept rather than dropped */
export function groupFigures(figures: Figure[]): { title: string; note: string | null; figures: Figure[] }[] {
  const named = new Set(FIGURE_SECTIONS.flatMap((s) => s.keys as readonly string[]));
  const sections = FIGURE_SECTIONS.map((s) => ({ title: s.title, note: s.note as string | null, figures: figures.filter((f) => (s.keys as readonly string[]).includes(f.key)) }));
  const rest = figures.filter((f) => !named.has(f.key));
  return rest.length === 0 ? sections : [...sections, { title: "Also computed", note: null, figures: rest }];
}

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
  // The headline carries one number and stops there. It used to end "and no transfer was emitted to
  // show it", which reads as something Bullseye measured: no event-log sweep was carried out, and
  // the absence follows from how a multiplier rebase works. That reasoning now lives in the
  // explanatory layer above, where it is plainly a mechanism rather than an observation.
  return `${m.asset.name}: every ${symbol} balance on X Layer ${fell ? "fell" : "grew"} by ${pct.replace("-", "")}%`;
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
