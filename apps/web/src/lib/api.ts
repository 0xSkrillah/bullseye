import type { Brief, BriefPreview, EconomicsReceipt, InvestigationView, Order, Quote, ResearchBudget, SignalEvent, DataMode, PaymentRail } from "@bullseye/domain";

/** Typed client for apps/api. Shapes mirror apps/api/src/http/app.ts. */
export interface RailStatus { rail: PaymentRail; network: string; ready: boolean; detail: string; payTo: string | null; isTestnet: boolean }
/** Who may start paid work. Anything but OPEN_ON_LOCALHOST means scan, investigate and reconcile answer 401/403 to a visitor. */
export type OperatorRoutes = "OPEN_ON_LOCALHOST" | "TOKEN_REQUIRED" | "DISABLED";
/** The interval and the cap are absent when the loop is off. */
export type AutoDesk = { enabled: true; intervalMinutes: number; maxInvestigationsPerDay: number } | { enabled: false };
export interface Health { service: string; dataSource: { mode: DataMode; asOf: string }; synthesis: { provider: string; model: string; ready: boolean; detail: string }; paymentRail: RailStatus; priceUsd: string; budget: ResearchBudget; operatorRoutes?: OperatorRoutes; /** who may read evidence summaries, on-chain figures and per-run cost here */ diagnostics?: OperatorRoutes; autoDesk?: AutoDesk; sdk?: Record<string, string> }
/** The issuer cancelled or replaced the version a signal (or a Brief's signal) was raised on. */
export interface Supersession { byVersion: number; reason: "CANCELLED" | "REPLACED"; status: string; notes: string | null; notedAt: string }
export interface SignalRow { signal: SignalEvent; superseded?: Supersession | null; investigation: { id: string; status: InvestigationView["status"]; stopReason: string | null; briefId: string | null } | null }
/** PUBLIC: the free view, with evidence summaries, on-chain figures and per-run cost withheld. DIAGNOSTIC: the operator, a viewer token, or a localhost desk. */
export type Audience = "PUBLIC" | "DIAGNOSTIC";
/** what a run cost and where it was routed are the desk's records: a visitor gets the counts, and `costsWithheld: true` */
export interface InvestigationUsageSummary { modelCalls: number; toolCalls: number; costsWithheld?: boolean; measuredModelCostUsd?: number; costBasis?: string | null; upperBoundModelCostUsd?: number; budgetSpentUsd?: number; costBases?: string[]; routedModels?: string[] }
export interface InvestigationResponse { audience?: Audience; investigation: InvestigationView; budget: ResearchBudget; usage: InvestigationUsageSummary }
export interface BriefPreviewResponse { preview: BriefPreview; signal: SignalEvent; withdrawn?: Supersession | null; priceUsd: string; rail: RailStatus; resource: string }
export interface BriefListResponse { priceUsd: string; rail: RailStatus; briefs: BriefPreview[] }
export interface OrderRow { order: Order; receipt: EconomicsReceipt; briefHeadline: string | null }
export interface DeliveryEnvelope { schema: "bullseye.delivery/v1"; orderId: string; state: Order["state"]; quote: { id: string; termsHash: string; terms: Quote["terms"] }; payment: Order["payment"]; brief: Brief }

export class ApiError extends Error { constructor(readonly status: number, readonly body: unknown) { super(`api ${status}`); } }

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

/** A typed GET for callers that read a route this client does not list; throws ApiError with the status. */
export const getJson = <T>(path: string): Promise<T> => j<T>(path);

export const api = {
  health: () => j<Health>("/api/health"),
  scan: () => j<unknown>("/api/signals/scan", { method: "POST" }),
  signals: () => j<{ dataMode: DataMode; signals: SignalRow[] }>("/api/signals"),
  investigate: (signalId: string) => j<{ created: boolean; id: string }>(`/api/signals/${signalId}/investigate`, { method: "POST" }),
  investigation: (id: string) => j<InvestigationResponse>(`/api/investigations/${id}`),
  briefs: () => j<BriefListResponse>("/api/briefs"),
  briefPreview: (id: string) => j<BriefPreviewResponse>(`/api/briefs/${id}/preview`),
  quote: (briefId: string) => j<Quote>(`/api/briefs/${briefId}/quotes`, { method: "POST" }),
  /** every buyer's order: an operator route, open only on localhost or with the operator's token. The buyer's own flow never calls it. */
  orders: () => j<{ orders: OrderRow[] }>("/api/orders"),
  /** one order, answered only to the holder of its claim token */
  order: (id: string, claim: string) => j<OrderRow>(`/api/orders/${id}`, { headers: { [CLAIM_HEADER]: claim } }),
  /** reads the chain for an order whose outcome is unknown; never settles. The buyer's own token authorises it. */
  reconcile: (id: string, claim: string) => j<OrderRow>(`/api/orders/${id}/reconcile`, { method: "POST", headers: { [CLAIM_HEADER]: claim } }),
  /** the Brief again for a buyer who holds the claim token: no signature, no settlement, no challenge */
  delivery: (orderId: string, claim: string): Promise<PaidReply> => paidFetch(`/api/orders/${orderId}/delivery`, { [CLAIM_HEADER]: claim }),
  /**
   * The paid resource. Without a PAYMENT-SIGNATURE header the server answers 402 with a
   * PAYMENT-REQUIRED challenge; with one, 200 and the delivery envelope. The claim token goes
   * in a header, never in the URL, and is sent with the payment so the buyer holds it whatever
   * happens to the response. Signing is the wallet's job: see checkout/purchase.ts.
   */
  paidBrief: (briefId: string, quoteId: string, paymentSignature?: string, claim?: string): Promise<PaidReply> =>
    paidFetch(`/api/v1/briefs/${briefId}?quote=${encodeURIComponent(quoteId)}`, { ...(paymentSignature ? { "payment-signature": paymentSignature } : {}), ...(claim ? { [CLAIM_HEADER]: claim } : {}) }),
};

const CLAIM_HEADER = "x-bullseye-claim";

/** What a paid route answered, headers included: the order id and the claim token travel in headers only. */
export interface PaidReply { status: number; challenge: string | null; orderId: string | null; claim: string | null; retryAfterSeconds: number | null; body: unknown }

async function paidFetch(path: string, headers: Record<string, string>): Promise<PaidReply> {
  const res = await fetch(path, { headers });
  const retry = Number(res.headers.get("Retry-After"));
  return {
    status: res.status,
    challenge: res.headers.get("PAYMENT-REQUIRED"),
    orderId: res.headers.get("X-Bullseye-Order"),
    claim: res.headers.get("X-Bullseye-Claim"),
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : null,
    body: await res.json().catch(() => null),
  };
}
