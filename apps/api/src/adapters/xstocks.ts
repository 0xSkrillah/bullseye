import { z } from "zod";
import type { Sourced } from "@bullseye/domain";
import type { SourceTransport } from "./transport.js";

/**
 * xStocks public API v2 (https://docs.xstocks.fi/apis/openapi). No authentication.
 * Schemas are strict about the fields Bullseye depends on and tolerant of additions.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const XsDeployment = z
  .object({
    network: z.string(),
    address: z.string(),
  })
  .passthrough();

export const XsAsset = z
  .object({
    id: z.string(),
    name: z.string(),
    symbol: z.string(),
    isin: z.string().nullable(),
    underlyingSymbol: z.string(),
    isTradingHalted: z.boolean(),
    deployments: z.array(XsDeployment),
  })
  .passthrough();
export type XsAsset = z.infer<typeof XsAsset>;

export const XsCorporateAction = z
  .object({
    eventId: z.string(),
    version: z.number().int(),
    xstockSymbol: z.string(),
    spvSymbol: z.string(),
    caType: z.string(),
    /** null on cancelled actions */
    effectiveTimeUtc: z.string().datetime().nullable(),
    multiplierOld: decimalString.nullable(),
    multiplierNew: decimalString.nullable(),
    grossCashflowUsd: decimalString.nullable(),
    netCashflowUsd: decimalString.nullable(),
    withholdingTaxRate: decimalString.nullable(),
    createdTimeUtc: z.string().datetime(),
    status: z.string(),
    /** on a cancellation the issuer names the cancelled version here: "[CANCELLED v2] reason" */
    notes: z.string().nullable().optional(),
  })
  .passthrough();
export type XsCorporateAction = z.infer<typeof XsCorporateAction>;

const XsPage = z.object({ nodes: z.array(z.unknown()) }).passthrough();

export const XsMultiplier = z
  .object({
    currentMultiplier: z.number(),
    newMultiplier: z.number(),
    activationDateTime: z.union([z.number(), z.string()]),
    reason: z.string().nullable(),
  })
  .passthrough();
export type XsMultiplier = z.infer<typeof XsMultiplier>;

export const XsProofOfReserves = z
  .object({
    symbol: z.string(),
    timestamp: z.string().datetime(),
    sharesHeld: decimalString,
    circulatingSupply: decimalString,
    holdings: z.array(z.object({ provider: z.string(), quantity: decimalString, symbol: z.string() }).passthrough()),
  })
  .passthrough();
export type XsProofOfReserves = z.infer<typeof XsProofOfReserves>;

export const XsPrice = z.object({ quote: z.number().positive() }).passthrough();
export const XsSupply = z.object({ value: z.number().nonnegative() }).passthrough();
export const XsTradingStatus = z
  .object({ symbol: z.string(), isMarketTradingHalted: z.boolean(), isAtomicTradingHalted: z.boolean() })
  .passthrough();
export type XsTradingStatus = z.infer<typeof XsTradingStatus>;

export interface RejectedRecord {
  index: number;
  eventId: string | null;
  reason: string;
}

/** a list response is unusable once this share of its records fails validation: the contract has changed */
const MAX_REJECTED_SHARE = 0.5;

export class SchemaMismatchError extends Error {
  constructor(key: string, issues: string) {
    super(`response for ${key} did not match the expected schema: ${issues}`);
  }
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, key: string, sourced: Sourced<unknown>): Sourced<T> {
  const result = schema.safeParse(sourced.data);
  if (!result.success) {
    throw new SchemaMismatchError(
      key,
      result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }
  return { data: result.data, provenance: sourced.provenance };
}

export class XStocksAdapter {
  constructor(
    private readonly transport: SourceTransport,
    private readonly baseUrl: string,
  ) {}

  /**
   * Records that fail validation are left out and returned in `rejected`, so one odd record
   * cannot hide every other event; callers must surface them. A mostly invalid page still throws.
   */
  async corporateActionHistory(opts: { symbol?: string; pageSize?: number } = {}): Promise<Sourced<XsCorporateAction[]> & { rejected: RejectedRecord[] }> {
    const params = new URLSearchParams({
      pageSize: String(opts.pageSize ?? 50),
      sortBy: "createdTimeUtc",
      sortOrder: "desc",
    });
    if (opts.symbol) params.set("symbol", opts.symbol);
    const key = `xstocks.ca-history.${opts.symbol ?? "all"}`;
    const page = parse(XsPage, key, await this.transport.http(key, `${this.baseUrl}/public/corporate-actions/history?${params}`));
    const nodes: XsCorporateAction[] = [];
    const rejected: RejectedRecord[] = [];
    page.data.nodes.forEach((n, index) => {
      const r = XsCorporateAction.safeParse(n);
      if (r.success) return nodes.push(r.data);
      const eventId = typeof (n as { eventId?: unknown } | null)?.eventId === "string" ? (n as { eventId: string }).eventId : null;
      rejected.push({ index, eventId, reason: r.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ") });
    });
    if (page.data.nodes.length > 0 && rejected.length / page.data.nodes.length > MAX_REJECTED_SHARE) {
      throw new SchemaMismatchError(key, `${rejected.length} of ${page.data.nodes.length} records failed validation, e.g. [${rejected[0]!.index}] ${rejected[0]!.reason}`);
    }
    return { data: nodes, provenance: page.provenance, rejected };
  }

  async asset(symbol: string): Promise<Sourced<XsAsset>> {
    const key = `xstocks.asset.${symbol}`;
    return parse(XsAsset, key, await this.transport.http(key, `${this.baseUrl}/public/assets/${encodeURIComponent(symbol)}`));
  }

  async multiplier(symbol: string, network = "XLayer"): Promise<Sourced<XsMultiplier>> {
    const key = `xstocks.multiplier.${symbol}.${network}`;
    return parse(
      XsMultiplier,
      key,
      await this.transport.http(key, `${this.baseUrl}/public/assets/${encodeURIComponent(symbol)}/multiplier?network=${network}`),
    );
  }

  async proofOfReserves(symbol: string): Promise<Sourced<XsProofOfReserves>> {
    const key = `xstocks.por.${symbol}`;
    return parse(XsProofOfReserves, key, await this.transport.http(key, `${this.baseUrl}/public/proof-of-reserves/${encodeURIComponent(symbol)}`));
  }

  async price(symbol: string): Promise<Sourced<z.infer<typeof XsPrice>>> {
    const key = `xstocks.price.${symbol}`;
    return parse(XsPrice, key, await this.transport.http(key, `${this.baseUrl}/public/assets/${encodeURIComponent(symbol)}/price-data`));
  }

  async tradingStatus(symbol: string): Promise<Sourced<XsTradingStatus>> {
    const key = `xstocks.status.${symbol}`;
    return parse(XsTradingStatus, key, await this.transport.http(key, `${this.baseUrl}/public/system/status/${encodeURIComponent(symbol)}`));
  }

  async totalSupply(symbol: string): Promise<Sourced<z.infer<typeof XsSupply>>> {
    const key = `xstocks.total-supply.${symbol}`;
    return parse(XsSupply, key, await this.transport.http(key, `${this.baseUrl}/public/assets/${encodeURIComponent(symbol)}/total-supply`));
  }

  async circulatingSupply(symbol: string): Promise<Sourced<z.infer<typeof XsSupply>>> {
    const key = `xstocks.circulating-supply.${symbol}`;
    return parse(XsSupply, key, await this.transport.http(key, `${this.baseUrl}/public/assets/${encodeURIComponent(symbol)}/circulating-supply`));
  }
}
