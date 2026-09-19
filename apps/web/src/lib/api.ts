import type { Brief, BriefPreview, EconomicsReceipt, InvestigationView, Order, Quote, ResearchBudget, SignalEvent, DataMode, PaymentRail } from "@bullseye/domain";

/** Typed client for apps/api. Shapes mirror apps/api/src/http/app.ts. */
export interface RailStatus { rail: PaymentRail; network: string; ready: boolean; detail: string; payTo: string | null; isTestnet: boolean }
/** Who may start paid work. Anything but OPEN_ON_LOCALHOST means scan, investigate and reconcile answer 401/403 to a visitor. */
export type OperatorRoutes = "OPEN_ON_LOCALHOST" | "TOKEN_REQUIRED" | "DISABLED";
/** The interval and the cap are absent when the loop is off. */
export type AutoDesk = { enabled: true; intervalMinutes: number; maxInvestigationsPerDay: number } | { enabled: false };
export interface Health { service: string; dataSource: { mode: DataMode; asOf: string }; synthesis: { provider: string; model: string; ready: boolean; detail: string }; paymentRail: RailStatus; priceUsd: string; budget: ResearchBudget; operatorRoutes?: OperatorRoutes; autoDesk?: AutoDesk; sdk?: Record<string, string> }
/** The issuer cancelled or replaced the version a signal (or a Brief's signal) was raised on. */
export interface Supersession { byVersion: number; reason: "CANCELLED" | "REPLACED"; status: string; notes: string | null; notedAt: string }
export interface SignalRow { signal: SignalEvent; superseded?: Supersession | null; investigation: { id: string; status: InvestigationView["status"]; stopReason: string | null; briefId: string | null } | null }
export interface InvestigationResponse { investigation: InvestigationView; budget: ResearchBudget; usage: { modelCalls: number; toolCalls: number; measuredModelCostUsd: number; costBasis: string | null; upperBoundModelCostUsd?: number; budgetSpentUsd?: number; costBases?: string[]; routedModels?: string[] } }
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
  orders: () => j<{ orders: OrderRow[] }>("/api/orders"),
  order: (id: string) => j<OrderRow>(`/api/orders/${id}`),
  reconcile: (id: string) => j<OrderRow>(`/api/orders/${id}/reconcile`, { method: "POST" }),
  /**
   * The paid resource. Without a PAYMENT-SIGNATURE header the server answers 402 with a
   * PAYMENT-REQUIRED challenge; with one, 200 and the delivery envelope. Signing needs a
   * wallet, which the browser does not hold: see lib/pay.ts.
   */
  async paidBrief(briefId: string, quoteId: string, paymentSignature?: string): Promise<{ status: number; challenge: string | null; orderId: string | null; body: unknown }> {
    const res = await fetch(`/api/v1/briefs/${briefId}?quote=${encodeURIComponent(quoteId)}`, { headers: paymentSignature ? { "payment-signature": paymentSignature } : {} });
    return { status: res.status, challenge: res.headers.get("PAYMENT-REQUIRED"), orderId: res.headers.get("X-Bullseye-Order"), body: await res.json().catch(() => null) };
  },
};
