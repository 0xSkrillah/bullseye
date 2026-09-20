import type { BriefPreview, DataMode, GateResult, InvestigationView, OrderState, PaymentRail, ResearchBudget } from "@bullseye/domain";
import { ApiError, type Health, type OrderRow, type SignalRow } from "../lib/api";
import { isPaidOrLater } from "../components/PaymentState";

/**
 * The room's reads, all of them, in one file. Every route here is a free GET; the room never calls
 * an operator route, never asks for a quote and never calls the paid resource.
 *
 * Request budget (the `api` limit is 600 a minute per client address, shared behind a NAT; the room
 * aims for at most 60): health 4, signals 6, commerce 10, briefs 2, desk status 2, activity 4,
 * investigations 4, economics 1 = 33 a minute idle, plus 20 + 6 for the one investigation that is
 * RUNNING and its chain. A finished investigation is read once: it never changes.
 * Polling stops while the tab is hidden and backs off after a failure.
 */
export const POLL_MS = {
  health: 15_000,
  signals: 10_000,
  commerce: 6_000,
  briefs: 30_000,
  deskStatus: 30_000,
  activity: 15_000,
  investigations: 15_000,
  economics: 60_000,
  runningInvestigation: 3_000,
  runningChain: 10_000,
} as const;

/** the list is asked for this many; a full answer means "at least" */
export const INVESTIGATION_LIST_LIMIT = 50;

/** a finished investigation never changes: read it once, then leave it alone */
export const SETTLED_MS = 3_600_000;

/** how often to look again for a route that answered 404 */
export const RECHECK_MS = 60_000;

/** longer than any healthy answer, shorter than anyone would stare at a frozen wall */
export const REQUEST_TIMEOUT_MS = 15_000;

export const POLL_OPTIONS = { pauseWhenHidden: true, backoffMaxMs: 60_000 } as const;

/**
 * A read-only token a venue's wall may hold so the server answers with its diagnostic view (costs,
 * chain figures). It is never in the URL and never in the bundle: whoever runs the wall puts it in
 * this browser's sessionStorage, and it leaves only as a request header to this same origin.
 */
const VIEWER_TOKEN_KEY = "bullseye.viewerToken";
function viewerToken(): string | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(VIEWER_TOKEN_KEY); } catch { return null; }
}

async function get<T>(path: string): Promise<T> {
  const token = viewerToken();
  // a request that never answers would hold its poll for good (the next one is only scheduled after an answer): give up and say "no answer"
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

/** A route a newer server has and an older one lacks: 404 means "not available yet", never an error and never made-up values. */
export type Feed<T> = { state: "ok"; data: T } | { state: "unavailable" };

export async function optional<T>(path: string): Promise<Feed<T>> {
  try {
    return { state: "ok", data: await get<T>(path) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { state: "unavailable" };
    throw e;
  }
}

/** GET /api/health. `diagnostics` exists only on a server that also has the orders summary and the desk totals, so its presence says which routes to ask for. */
export type RoomHealth = Health & { diagnostics?: "OPEN_ON_LOCALHOST" | "TOKEN_REQUIRED" | "DISABLED" };

/** PUBLIC: what any visitor is told. DIAGNOSTIC: localhost, the operator, or a wall holding the viewer token. Absent on an older server. */
export type Audience = "PUBLIC" | "DIAGNOSTIC";

/** GET /api/desk/status */
export interface DeskStatus {
  enabled: boolean;
  intervalMinutes: number;
  maxInvestigationsPerDay: number;
  investigationsLast24h: number;
  /** process memory: null after a restart until the loop has ticked once */
  lastTick: { at: string; action: string; reason: string | null; detail: string | null } | null;
  nextTickAt: string | null;
  dailySpendCeilingUsd: number;
  /** how far back the detector looks for an effective time; the radar's scale */
  liveWindowHours?: number;
}

/** GET /api/activity */
export interface ActivityEvent {
  at: string;
  kind: string;
  refId: string;
  symbol: string | null;
  /** written by code from stored fields; never model text */
  summary: string;
  rail: PaymentRail | null;
  state: string | null;
}
export interface ActivityResponse { kinds?: string[]; events: ActivityEvent[] }

/** A usage summary. For the PUBLIC audience the money fields are absent and `costsWithheld` is true: that is "withheld", never zero. */
export interface RoomUsage {
  modelCalls: number;
  toolCalls: number;
  costsWithheld?: boolean;
  measuredModelCostUsd?: number;
  upperBoundModelCostUsd?: number;
  budgetSpentUsd?: number;
  costBases?: string[];
  costBasis?: string | null;
  routedModels?: string[];
}

/** GET /api/investigations */
export interface InvestigationSummary {
  id: string;
  signalId: string;
  symbol: string | null;
  status: InvestigationView["status"];
  stopReason: InvestigationView["stopReason"];
  startedAt: string;
  finishedAt: string | null;
  briefId: string | null;
  gate: { decision: GateResult["decision"]; confidenceCap: GateResult["confidenceCap"] } | null;
  draftsJudged: number;
  usage: RoomUsage;
}
export interface InvestigationListResponse { audience?: Audience; investigations: InvestigationSummary[] }

/** GET /api/investigations/:id */
export interface RoomInvestigation { audience?: Audience; investigation: InvestigationView; budget: ResearchBudget; usage: RoomUsage }

/** GET /api/investigations/:id/chain. With `withheld`, every figure is null: the block, the value and the time are what the Brief sells. */
export interface RebaseChain {
  withheld?: boolean;
  network: string;
  token: string;
  symbol: string;
  issuer: { multiplierOld: string; multiplierNew: string; effectiveTimeUtc: string };
  reads: { key: "BEFORE" | "AFTER" | "HEAD"; evidenceId: string; blockNumber: number | null; blockTime: string | null; multiplier: string | null; mode: string }[];
  activation: { evidenceId: string; blockNumber: number | null; blockTime: string | null; mode: string } | null;
  activationSearched: boolean;
}
export interface ChainResponse { audience?: Audience; chain: RebaseChain | null; investigationId: string }

/**
 * Orders as counts. From GET /api/commerce/summary where the server has it (`source: "SUMMARY"`);
 * on an older server the same shape is folded from GET /api/orders in this file (`source: "ORDERS"`).
 * No buyer, order, quote or payment identifier is kept either way.
 */
export interface CommerceSummary {
  source: "SUMMARY" | "ORDERS";
  label: string | null;
  note: string | null;
  rail: PaymentRail | null;
  isTestnet: boolean | null;
  priceUsd: string | null;
  total: number;
  /** the route answers with its newest orders only and came back full: every count here is a floor */
  atLeast: boolean;
  byState: Partial<Record<OrderState, { count: number; chainVerified: number }>>;
  byBrief: { briefId: string; symbol: string | null; orders: number; furthestState: OrderState; count: number; chainVerified: number }[];
  latest: { at: string; state: OrderState; rail: PaymentRail; chainVerified: boolean; trail: { at: string; from: OrderState | null; to: OrderState }[] } | null;
  /** one order's receipt is one run's cost: a PUBLIC summary never carries it */
  latestReceipt: { rail: PaymentRail; countsAsRevenue: boolean; priceUsd: number | string; measuredTotalUsd: number; estimatedTotalUsd: number; estimatedContributionUsd: number; /** the run used the test double: its measured total is an empty sum, not a cost */ usageIsFixture?: boolean } | null;
}

/** GET /api/orders answers with this many at most; the summary route reads this many */
export const ORDERS_LIST_CAP = 50;
export const SUMMARY_WINDOW = 500;

/** how far along the path to delivery a state is; the server's own ranking */
const PROGRESS: readonly OrderState[] = ["PAYMENT_FAILED", "QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "RECONCILIATION_REQUIRED", "PAID", "DELIVERY_FAILED", "DELIVERING", "DELIVERED"];

export function summariseOrders(rows: OrderRow[]): CommerceSummary {
  const verified = (r: OrderRow) => r.order.payment?.chainVerified === true;
  const byState: CommerceSummary["byState"] = {};
  const briefs = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const cell = (byState[r.order.state] ??= { count: 0, chainVerified: 0 });
    cell.count += 1;
    if (verified(r)) cell.chainVerified += 1;
    briefs.set(r.order.terms.briefId, [...(briefs.get(r.order.terms.briefId) ?? []), r]);
  }
  const byBrief = [...briefs].map(([briefId, list]) => {
    const furthestState = list.map((r) => r.order.state).sort((a, b) => PROGRESS.indexOf(b) - PROGRESS.indexOf(a))[0]!;
    const there = list.filter((r) => r.order.state === furthestState);
    return { briefId, symbol: null, orders: list.length, furthestState, count: there.length, chainVerified: there.filter(verified).length };
  });
  const newest = [...rows].sort((a, b) => (a.order.updatedAt < b.order.updatedAt ? 1 : -1))[0] ?? null;
  const rc = newest?.receipt ?? null;
  return {
    source: "ORDERS",
    label: null,
    note: null,
    rail: newest?.order.terms.rail ?? null,
    isTestnet: null,
    priceUsd: null,
    total: rows.length,
    atLeast: rows.length >= ORDERS_LIST_CAP,
    byState,
    byBrief,
    latest: newest ? { at: newest.order.updatedAt, state: newest.order.state, rail: newest.order.terms.rail, chainVerified: verified(newest), trail: newest.order.events.map((e) => ({ at: e.at, from: e.from, to: e.to })) } : null,
    latestReceipt: rc ? { rail: rc.rail, countsAsRevenue: rc.countsAsRevenue, priceUsd: rc.priceUsd, measuredTotalUsd: rc.measuredTotalUsd, estimatedTotalUsd: rc.estimatedTotalUsd, estimatedContributionUsd: rc.estimatedContributionUsd, usageIsFixture: rc.usage?.usageIsFixture } : null,
  };
}

/** paid or later, and how many of those the chain confirmed */
export function paidCounts(s: CommerceSummary): { paid: number; verified: number } {
  let paid = 0, verified = 0;
  for (const [state, cell] of Object.entries(s.byState) as [OrderState, { count: number; chainVerified: number }][]) {
    if (isPaidOrLater(state)) { paid += cell.count; verified += cell.chainVerified; }
  }
  return { paid, verified };
}

/** GET /api/desk/economics: desk totals, every investigation counted once */
export interface CostBucket { runs: number; measuredUsd: number; upperBoundUsd: number }
export interface DeskEconomics {
  label: string;
  note: string;
  rail: PaymentRail;
  isTestnet: boolean;
  investigations: { total: number; published: number; rejected: number; stopped: number; running: number };
  research: { basis: string; total: CostBucket; byOutcome: Record<"PUBLISHED" | "REJECTED" | "STOPPED" | "RUNNING", CostBucket>; unsold: CostBucket; runsWithoutAPrice: number };
  /** `unverifiedMainnet*`: paid on mainnet but not confirmed by the chain, so neither revenue nor a test payment; absent on a server that does not tell them apart */
  sales: { paidOrders: number; revenueOrders: number; revenueUsd: number; testOrders: number; testPaymentsUsd: number; unverifiedMainnetOrders?: number; unverifiedMainnetUsd?: number; note: string };
  delivery: { basis: string; perPaidOrderUsd: number; estimatedTotalUsd: number; note: string };
  estimatedContributionUsd: number;
  contributionNote: string;
}

/** once the summary route has answered 404, the older orders route is read directly until the next look */
let summaryMissingUntil = 0;

export const room = {
  health: () => get<RoomHealth>("/api/health"),
  signals: () => get<{ dataMode: DataMode; signals: SignalRow[] }>("/api/signals"),
  briefs: () => get<{ briefs: BriefPreview[] }>("/api/briefs"),
  investigation: (id: string) => get<RoomInvestigation>(`/api/investigations/${id}`),
  deskStatus: () => optional<DeskStatus>("/api/desk/status"),
  activity: (limit = 30) => optional<ActivityResponse>(`/api/activity?limit=${limit}`),
  investigations: (limit = INVESTIGATION_LIST_LIMIT) => optional<InvestigationListResponse>(`/api/investigations?limit=${limit}`),
  economics: () => optional<DeskEconomics>("/api/desk/economics"),
  /** the answer is stamped with the investigation it belongs to, so a panel never draws one run's chain under another's name */
  chain: (investigationId: string): Promise<Feed<ChainResponse>> =>
    optional<{ audience?: Audience; chain: RebaseChain | null }>(`/api/investigations/${investigationId}/chain`).then((f) => (f.state === "ok" ? { state: "ok", data: { ...f.data, investigationId } } : f)),
  /**
   * Orders as counts. "unavailable" when neither route will answer a visitor (the summary does not
   * exist yet and the orders list is operator-only): that is "not known", never "no orders".
   */
  async commerce(hasSummary = true, now: () => number = Date.now): Promise<Feed<CommerceSummary>> {
    // an older server is never asked for a route it does not have: a 404 is noise in the console of whoever is watching
    if (hasSummary && now() >= summaryMissingUntil) {
      const s = await optional<Omit<CommerceSummary, "source" | "atLeast">>("/api/commerce/summary");
      if (s.state === "ok") return { state: "ok", data: { ...s.data, source: "SUMMARY", atLeast: s.data.total >= SUMMARY_WINDOW } };
      summaryMissingUntil = now() + RECHECK_MS;
    }
    try {
      return { state: "ok", data: summariseOrders((await get<{ orders: OrderRow[] }>("/api/orders")).orders) };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) return { state: "unavailable" };
      throw e;
    }
  },
};

/** tests only: forget that the summary route was missing */
export function resetRoutesForTest(): void { summaryMissingUntil = 0; }
