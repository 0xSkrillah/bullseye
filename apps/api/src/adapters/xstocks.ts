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
    effectiveTimeUtc: z.string().datetime(),
    multiplierOld: decimalString.nullable(),
    multiplierNew: decimalString.nullable(),
    grossCashflowUsd: decimalString.nullable(),
    netCashflowUsd: decimalString.nullable(),
    withholdingTaxRate: decimalString.nullable(),
    createdTimeUtc: z.string().datetime(),
    status: z.string(),
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

  async corporateActionHistory(opts: { symbol?: string; pageSize?: number } = {}): Promise<Sourced<XsCorporateAction[]>> {
    const params = new URLSearchParams({
      pageSize: String(opts.pageSize ?? 50),
      sortBy: "createdTimeUtc",
      sortOrder: "desc",
    });
    if (opts.symbol) params.set("symbol", opts.symbol);
    const key = `xstocks.ca-history.${opts.symbol ?? "all"}`;
    const page = parse(XsPage, key, await this.transport.http(key, `${this.baseUrl}/public/corporate-actions/history?${params}`));
    const nodes = page.data.nodes.map((n, i) => {
      const r = XsCorporateAction.safeParse(n);
      if (!r.success) throw new SchemaMismatchError(`${key}[${i}]`, r.error.issues.map((x) => x.message).join("; "));
      return r.data;
    });
    return { data: nodes, provenance: page.provenance };
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
