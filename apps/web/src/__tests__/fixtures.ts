import type { EconomicsReceipt, EvidenceItem, GateResult, InvestigationView, Order, PaymentEvidence, Quote, ResearchBudget, SignalEvent } from "@bullseye/domain";
import type { InvestigationUsage } from "../api";

// Test values only. Nothing here is rendered by the app.

export const terms: Quote["terms"] = {
  briefId: "brf_0123456789abcdef",
  briefContentHash: "a".repeat(64),
  priceUsd: "3.00",
  amount: "3000000",
  asset: "0x" + "1".repeat(40),
  assetName: "USDC",
  assetDecimals: 6,
  network: "eip155:1952",
  payTo: "0x" + "2".repeat(40),
  scheme: "exact",
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
  rail: "OKX_X402_TESTNET",
  resource: "http://localhost:4402/api/v1/briefs/brf_0123456789abcdef",
  issuedAt: "2026-09-18T09:43:50Z",
  expiresAt: "2026-09-18T09:59:00Z",
};

export const quote: Quote = { id: "quo_0123456789abcdef", terms, termsHash: "b".repeat(64) };

export function payment(chainVerified: boolean): PaymentEvidence {
  return {
    rail: "OKX_X402_TESTNET",
    payer: "0x" + "3".repeat(40),
    txHash: "0x" + "4".repeat(64),
    network: "eip155:1952",
    facilitatorStatus: "success",
    chainVerified,
    chainBlockNumber: chainVerified ? 4182990 : null,
    chainCheckedAt: chainVerified ? "2026-09-18T09:44:47Z" : null,
    explorerUrl: null,
    note: null,
  };
}

export function order(state: Order["state"], pay: PaymentEvidence | null): Order {
  const trail: Order["state"][] =
    state === "QUOTED" ? ["QUOTED"] : state === "PAYMENT_UNKNOWN" || state === "RECONCILIATION_REQUIRED" ? ["QUOTED", "PAYMENT_PENDING", state] : ["QUOTED", "PAYMENT_PENDING", "PAID"];
  return {
    id: "ord_0123456789abcdef",
    quoteId: quote.id,
    termsHash: quote.termsHash,
    terms,
    state,
    paymentKey: "c".repeat(64),
    payment: pay,
    deliveryCount: 0,
    createdAt: "2026-09-18T09:43:50Z",
    updatedAt: "2026-09-18T09:45:32Z",
    events: trail.map((to, i) => ({ seq: i + 1, at: "2026-09-18T09:44:00Z", from: trail[i - 1] ?? null, to, reason: "test transition" })),
  };
}

export const receipt: EconomicsReceipt = {
  orderId: "ord_0123456789abcdef",
  briefId: "brf_0123456789abcdef",
  rail: "OKX_X402_TESTNET",
  priceUsd: 3,
  countsAsRevenue: false,
  revenueNote: "Paid with test tokens on X Layer testnet. This proves the payment mechanics; it is not revenue.",
  usage: { modelCalls: 2, toolCalls: 7, inputTokens: 3611, outputTokens: 1204, investigationLatencyMs: 41200, usageIsFixture: false },
  measuredCosts: [{ label: "Synthesis", amountUsd: 0.0142, basis: "MEASURED", detail: "MEASURED_USAGE_AT_LIST_PRICE" }],
  estimatedCosts: [{ label: "Payment fee reserve", amountUsd: 0.15, basis: "ESTIMATED", detail: "planning allowance" }],
  measuredTotalUsd: 0.0142,
  estimatedTotalUsd: 0.15,
  estimatedContributionUsd: 2.8358,
  contributionNote: "It is an estimate, not profit.",
};

export const gate: GateResult = {
  decision: "PUBLISH",
  evaluatedAt: "2026-09-18T09:41:47Z",
  gateVersion: "1.0.0",
  confidenceCap: "HIGH",
  findings: [
    { rule: "EVIDENCE_FRESH", passed: true, detail: "" },
    { rule: "SCHEMA", passed: true, detail: "" },
  ],
};

export const view: InvestigationView = {
  id: "inv_0123456789abcdef",
  signalId: "sig_0123456789abcdef",
  status: "PUBLISHED",
  stopReason: "COMPLETED",
  startedAt: "2026-09-18T09:41:07Z",
  finishedAt: "2026-09-18T09:41:48Z",
  briefId: "brf_0123456789abcdef",
  gate,
  timeline: [
    { seq: 1, at: "2026-09-18T09:41:07Z", type: "STARTED", label: "STARTED", detail: null, evidenceId: null, ok: true },
    { seq: 2, at: "2026-09-18T09:41:08Z", type: "EVIDENCE", label: "EV-CA-RECORD", detail: "CORPORATE_ACTION_RECORD", evidenceId: "EV-CA-RECORD", ok: true },
  ],
};

export const usage: InvestigationUsage = { modelCalls: 2, toolCalls: 7, measuredModelCostUsd: 0.0142, costBasis: "MEASURED_USAGE_AT_LIST_PRICE" };
export const budget: ResearchBudget = { maxVariableCostUsd: 0.25, maxModelCalls: 6, maxToolCalls: 12, maxLatencyMs: 90000, maxOutputTokensPerCall: 2000 };

export const evidence: EvidenceItem = {
  id: "EV-CA-RECORD",
  investigationId: view.id,
  kind: "CORPORATE_ACTION_RECORD",
  summary: "Corporate action record as returned by the source.",
  values: { multiplierNew: "1.004871" },
  observedAt: "2026-09-18T09:40:52Z",
  staleAfter: "2026-09-18T10:41:08Z",
  provenance: { mode: "HISTORICAL", source: "test source", url: "recorded://test", fetchedAt: "2026-09-18T09:41:08Z", sha256: "d".repeat(64) },
};

export const signal: SignalEvent = {
  id: "sig_0123456789abcdef",
  category: "CORPORATE_ACTION_REBASE",
  asset: { symbol: "TSTx", name: "Test asset", isin: null, underlyingSymbol: "TST", network: "XLayer", chainId: 196, tokenAddress: "0x" + "5".repeat(40) },
  observedAt: "2026-09-18T09:40:52Z",
  detectedAt: "2026-09-18T09:41:07Z",
  headline: "Test headline",
  reasonFlagged: "test reason",
  facts: {
    corporateActionId: "CA-TEST",
    corporateActionVersion: 1,
    caType: "DIVIDEND",
    status: "APPLIED",
    multiplierOld: "1.000000",
    multiplierNew: "1.004871",
    changePct: 0.4871,
    grossCashflowUsd: null,
    netCashflowUsd: null,
    withholdingTaxRate: null,
  },
  sources: [evidence.provenance],
  provenance: { mode: "HISTORICAL", detector: "test", detectorVersion: "0", inputHash: "e".repeat(64) },
};
