// Bullseye — component props contract. Documentation for the React/Vite app in apps/web.
// Every enum below mirrors packages/domain (Zod); import the real types from "@bullseye/domain"
// and treat these as the rendering contract.

export type DataMode = 'LIVE' | 'CACHED' | 'HISTORICAL' | 'FIXTURE';
/** Badge kinds: the four DataModes plus two derived tags. */
export type BadgeKind = DataMode | 'STALE' | 'TESTNET';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type CheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type OrderState =
  | 'QUOTED' | 'PAYMENT_PENDING' | 'PAYMENT_UNKNOWN' | 'PAYMENT_FAILED' | 'PAID'
  | 'DELIVERING' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RECONCILIATION_REQUIRED';
export type PaymentRail = 'OKX_X402_TESTNET' | 'OKX_X402_MAINNET' | 'FIXTURE';
export type TimelineType = 'STARTED' | 'MODEL_CALL' | 'TOOL_CALL' | 'EVIDENCE' | 'CHECKS' | 'GATE' | 'STOPPED' | 'PUBLISHED' | 'REJECTED';
export type GateRule =
  | 'SCHEMA' | 'INVESTIGATION_COMPLETED' | 'MANDATORY_EVIDENCE_PRESENT' | 'EVIDENCE_FRESH' | 'EVIDENCE_MODE_ALLOWED'
  | 'CLAIMS_CITE_KNOWN_EVIDENCE' | 'QUANTITIES_RESOLVE_TO_EVIDENCE' | 'NUMBERS_IN_TEXT_ARE_EVIDENCED'
  | 'NO_INVESTMENT_ADVICE' | 'FAILED_CHECKS_DISCLOSED' | 'CONFIDENCE_WITHIN_CAP';
export type CostBasis = 'MEASURED_USAGE_AT_LIST_PRICE' | 'NO_MARGINAL_PRICE' | 'FIXTURE';

/** ISO-8601 UTC with trailing Z. Rendered as "hh:mm:ssZ" inside a day, full value in title. */
export type Timestamp = string;

/** SignalCard — one SignalEvent in the Feed. Exactly one card per feed is `locked`. */
export interface SignalCardProps {
  signal: {
    id: string; category: string; headline: string; reasonFlagged: string;
    detectedAt: Timestamp; observedAt: Timestamp;
    asset: { symbol: string; name: string; network: 'XLayer' };
    facts: { corporateActionId: string; corporateActionVersion: number; caType: string; status: string; multiplierOld: string; multiplierNew: string; changePct: number };
    provenance: { mode: DataMode; detector: string; detectorVersion: string };
  };
  locked?: boolean;
  noise?: boolean;
  testnet?: boolean;
  onLock?(id: string): void;
}

/** ProvenanceBadge — the word and dot for a data source's mode. Never render a dot without its word. */
export interface ProvenanceBadgeProps { kind: BadgeKind; title?: string; }

/** EvidenceDrawer — a right-hand dialog showing one EvidenceItem with its machine-checkable values. */
export interface EvidenceDrawerProps {
  item: {
    id: string; kind: string; summary: string; observedAt: Timestamp; staleAfter: Timestamp;
    values: Record<string, number | string | boolean | null>;
    provenance: { mode: DataMode; source: string; url: string; fetchedAt: Timestamp; sha256: string; note?: string };
  };
  now: Timestamp;
  open: boolean;
  onClose(): void;
}

/** InvestigationTimeline — what happened, in order. Never renders reasoning text. */
export interface InvestigationTimelineProps {
  entries: { seq: number; at: Timestamp; type: TimelineType; label: string; detail: string | null; evidenceId: string | null; ok: boolean }[];
  usage: { kind: 'MODEL_CALL' | 'TOOL_CALL'; costUsd: number; costBasis: CostBasis; latencyMs: number }[];
  budget: { maxVariableCostUsd: number; maxModelCalls: number; maxToolCalls: number; maxLatencyMs: number };
  stopReason: string | null;
  onOpenEvidence?(id: string): void;
}

/** ConfidenceIndicator — three arcs for HIGH/MEDIUM/LOW, plus the gate cap when it binds. */
export interface ConfidenceIndicatorProps {
  level: ConfidenceLevel;
  rationale: string;
  cap?: ConfidenceLevel;      // GateResult.confidenceCap
  withdrawn?: boolean;        // gate decision REJECT
  size?: 56 | 96;
}

/** UnknownsPanel — unknowns, or conflicts joined to their ConsistencyCheck. Never hidden when empty. */
export type UnknownsPanelProps =
  | { title: 'Unknowns'; unknowns: string[] }
  | { title: 'Conflicts'; conflicts: { checkId: string; description: string }[]; checks: { id: string; status: CheckStatus; detail: string }[] };

export interface Quote {
  id: string; termsHash: string;
  terms: { briefId: string; briefContentHash: string; priceUsd: string; amount: string; asset: string; assetName: string; assetDecimals: number; network: string; payTo: string; scheme: 'exact'; rail: PaymentRail; resource: string; issuedAt: Timestamp; expiresAt: Timestamp };
}

/** BriefPaywall — the immutable quote terms and the single pay action. */
export interface BriefPaywallProps { quote: Quote; now: Timestamp; expired?: boolean; onPay(): void; onViewEvidence?(): void; onRequote?(): void; }

/** PaymentState — the OrderState ladder with the order's event trail and payment evidence. */
export interface PaymentStateProps {
  order: {
    id: string; state: OrderState; paymentKey: string | null; deliveryCount: number;
    payment: { rail: PaymentRail; txHash: string | null; facilitatorStatus: string | null; chainVerified: boolean; chainBlockNumber: number | null; chainCheckedAt: Timestamp | null; explorerUrl: string | null; note: string | null } | null;
    events: { seq: number; at: Timestamp; from: OrderState | null; to: OrderState; reason: string }[];
  };
  onReconcile?(): void;
}

export interface CostLine { label: string; amountUsd: number; basis: 'MEASURED' | 'ESTIMATED'; detail: string; }

/** EconomicsReceipt — price, measured usage, measured costs, estimated costs and an estimate that cannot look like profit. */
export interface EconomicsReceiptProps {
  receipt: {
    orderId: string; briefId: string; rail: PaymentRail; priceUsd: number; countsAsRevenue: boolean; revenueNote: string;
    usage: { modelCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; investigationLatencyMs: number; usageIsFixture: boolean };
    measuredCosts: CostLine[]; estimatedCosts: CostLine[];
    measuredTotalUsd: number; estimatedTotalUsd: number; estimatedContributionUsd: number; contributionNote: string;
  };
  state: OrderState;
  paidAt?: Timestamp;
}

/** PublicationGateResult — the deterministic gate's decision, every rule, and what happens next. */
export interface PublicationGateResultProps {
  gate: { decision: 'PUBLISH' | 'REJECT'; evaluatedAt: Timestamp; gateVersion: string; confidenceCap: ConfidenceLevel; findings: { rule: GateRule; passed: boolean; detail: string }[] } | null;
  briefId?: string;
  compact?: boolean;
}

/** RadarHero — the hero field: noisy events enter, Bullseye locks one, it expands into a Brief. */
export interface RadarHeroProps { size?: number; noise?: number; lockAfterMs?: number; onLock?(): void; }

/** Money — the only way an amount renders. No colour override exists. */
export interface MoneyProps { usd: number | string; basis: 'MEASURED' | 'ESTIMATED' | 'PRICE'; realised?: boolean; rail?: PaymentRail; }

declare global {
  interface Window {
    Bullseye: {
      badge(kind: BadgeKind, opts?: { title?: string }): string;
      verdict(kind: 'PASS' | 'FAIL' | 'UNKNOWN' | 'RUNNING' | 'STALE'): string;
      confidence(el: HTMLElement, opts: { level: ConfidenceLevel; rationale?: string; cap?: ConfidenceLevel; withdrawn?: boolean; large?: boolean }): HTMLElement;
      radar(el: HTMLElement, opts?: RadarHeroProps): HTMLElement;
      esc(s: string): string;
    };
  }
}
