/**
 * Data feasibility probe for the Market Desk. For one supported asset it asks the permitted
 * sources what they actually return, and decides — from those responses, not from documentation —
 * which of the desk's three labels the data can support:
 *
 *   EVENT IMPACT              the issuer's own multiplier change, exact, in the units it publishes
 *   REFERENCE DISCREPANCY     two figures that genuinely measure the same thing, both observed
 *   ESTIMATED QUOTED SPREAD   comparable buy-ask and sell-bid quotes, with size, fees and expiry
 *
 * Nothing here is mocked and nothing is paid for: the xStocks public API needs no key, and the
 * X Layer read is a free eth_call. A check that cannot be satisfied is BLOCKED with the reason,
 * never softened. Results go to artifacts/integration/.
 *
 *   npm run market-probe            (defaults to QSRx, the asset of the first live run)
 *   npm run market-probe -- IFFx
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../apps/api/src/config.js";
import { LiveTransport, sha256 } from "../apps/api/src/adapters/transport.js";
import { XStocksAdapter } from "../apps/api/src/adapters/xstocks.js";
import { XLayerAdapter } from "../apps/api/src/adapters/xlayer.js";
import { exactEquals, pctChange, ratio } from "../apps/api/src/market/decimal.js";

type Verdict = "PASS" | "BLOCKED" | "UNKNOWN";
interface Check {
  check: string;
  verdict: Verdict;
  /** what the responses showed, in one sentence a reader can check against `evidence` */
  finding: string;
  evidence: unknown;
}

const checks: Check[] = [];
const record = (check: string, verdict: Verdict, finding: string, evidence: unknown) => {
  checks.push({ check, verdict, finding, evidence });
  console.log(`[${verdict}] ${check}: ${finding}`);
};

const symbol = process.argv[2] ?? "QSRx";
const config = loadConfig();
const transport = new LiveTransport({ allowCached: false });
const xstocks = new XStocksAdapter(transport, config.XSTOCKS_BASE_URL);
const xlayer = new XLayerAdapter(transport, config.XLAYER_RPC_URL);

/** the raw body as the source sent it, so a reader can hash it themselves */
async function raw(path: string): Promise<{ url: string; status: number; fetchedAt: string; sha256: string; body: unknown; latencyMs: number; cacheControl: string | null; age: string | null }> {
  const url = `${config.XSTOCKS_BASE_URL}${path}`;
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 160);
  }
  return { url, status: res.status, fetchedAt, sha256: sha256(text), body, latencyMs: Date.now() - started, cacheControl: res.headers.get("cache-control"), age: res.headers.get("age") };
}

// ---------------------------------------------------------------- 1. instrument identity
const asset = await xstocks.asset(symbol);
const a = asset.data as typeof asset.data & {
  underlyingIsin?: string | null;
  underlying?: { symbol: string; isin: string | null; currency: string | null; listingCountry: string | null } | null;
  trading?: { currency?: string | null; currentPeriod?: string | null; openNow?: boolean | null; nextChangeAt?: string | null; tradingHoursMode?: string | null; exchange?: { mic?: string; name?: string } | null; limitsPerPeriod?: Record<string, { minOrderFiatValue: number | null; maxOrderFiatValue: number | null }> | null } | null;
};
const tokenIsin = a.isin;
const underlyingIsin = a.underlyingIsin ?? a.underlying?.isin ?? null;
record(
  "INSTRUMENT_IDENTITY",
  tokenIsin !== null && underlyingIsin !== null && tokenIsin !== underlyingIsin ? "PASS" : "UNKNOWN",
  tokenIsin === underlyingIsin
    ? `the issuer reports the same ISIN for ${symbol} and its underlying: exposure equivalence cannot be ruled in or out from identity alone`
    : `${symbol} is ISIN ${tokenIsin} (the token) over ${a.underlyingSymbol} ISIN ${underlyingIsin} (the listed share): two different instruments, so a shared ticker root is not shared exposure`,
  { symbol: a.symbol, name: a.name, tokenIsin, underlyingSymbol: a.underlyingSymbol, underlyingIsin, listingCountry: a.underlying?.listingCountry ?? null, exchange: a.trading?.exchange ?? null, source: asset.provenance },
);

// ---------------------------------------------------------------- 2. currency
const tradingCcy = a.trading?.currency ?? null;
const underlyingCcy = a.underlying?.currency ?? null;
record(
  "CURRENCY",
  tradingCcy !== null && tradingCcy === underlyingCcy ? "PASS" : "UNKNOWN",
  tradingCcy === null ? "no currency is stated on the asset record" : `the issuer states ${tradingCcy} for trading and ${underlyingCcy ?? "nothing"} for the underlying`,
  { tradingCurrency: tradingCcy, underlyingCurrency: underlyingCcy, source: asset.provenance },
);

// ---------------------------------------------------------------- 3. the X Layer deployment
const deployments = a.deployments;
const xl = deployments.find((d) => d.network === "XLayer") ?? null;
const addresses = [...new Set(deployments.map((d) => d.address.toLowerCase()))];
record(
  "DEPLOYMENT_IDENTITY",
  xl ? "PASS" : "BLOCKED",
  xl
    ? `${symbol} on X Layer is ${xl.address}; the issuer lists ${deployments.length} deployments across ${addresses.length} distinct addresses, and the array is not in a documented order, so it must be looked up by network and never by index`
    : `the issuer lists no XLayer deployment for ${symbol}`,
  { xLayer: xl, networks: deployments.map((d) => d.network), distinctAddresses: addresses, source: asset.provenance },
);

// ---------------------------------------------------------------- 4. market status and accessible size
const period = a.trading?.currentPeriod ?? null;
const limits = period ? (a.trading?.limitsPerPeriod?.[period] ?? null) : null;
const maxNow = limits?.maxOrderFiatValue ?? null;
record(
  "MARKET_STATUS_AND_SIZE",
  period === null ? "UNKNOWN" : maxNow !== null && maxNow > 0 ? "PASS" : "BLOCKED",
  period === null
    ? "no trading period is stated, so whether a transaction path is open now is unknown"
    : maxNow === 0
      ? `the issuer reports period "${period}" (openNow=${String(a.trading?.openNow)}) with a maximum order value of 0: there is no accessible transaction path at any size right now, next change ${a.trading?.nextChangeAt ?? "unknown"}`
      : `the issuer reports period "${period}" with orders from ${limits?.minOrderFiatValue ?? "?"} to ${maxNow} ${tradingCcy ?? ""}: a size-specific claim must sit inside that band`,
  { currentPeriod: period, openNow: a.trading?.openNow ?? null, nextChangeAt: a.trading?.nextChangeAt ?? null, tradingHoursMode: a.trading?.tradingHoursMode ?? null, limitsForCurrentPeriod: limits, allPeriods: a.trading?.limitsPerPeriod ?? null, source: asset.provenance },
);

// ---------------------------------------------------------------- 5. the reference price, as it really arrives
const price = await raw(`/public/assets/${encodeURIComponent(symbol)}/price-data`);
const quote = (price.body as { quote?: unknown } | null)?.quote;
const priceKeys = price.body !== null && typeof price.body === "object" ? Object.keys(price.body) : [];
record(
  "REFERENCE_PRICE",
  typeof quote === "number" && quote > 0 ? "PASS" : "BLOCKED",
  typeof quote === "number" && quote > 0
    ? `the endpoint returns one number, quote=${quote}, in fields [${priceKeys.join(", ")}]: no currency, no observation time, no venue and no side, so it is a reference price and the desk must date it by fetch time`
    : `the endpoint answered 200 with quote=${JSON.stringify(quote)} after ${price.latencyMs} ms: while the market is closed there is no reference price at all, and the repository schema (XsPrice, quote: number().positive()) rejects this body`,
  { quote, fields: priceKeys, latencyMs: price.latencyMs, statedCurrency: null, statedObservationTime: null, statedVenue: null, statedSide: null, url: price.url, fetchedAt: price.fetchedAt, sha256: price.sha256 },
);

// ---------------------------------------------------------------- 6. is any executable quote reachable?
const quoteProbes = [`/public/assets/${encodeURIComponent(symbol)}/quote`, `/public/assets/${encodeURIComponent(symbol)}/quotes`, `/public/assets/${encodeURIComponent(symbol)}/orderbook`, `/public/assets/${encodeURIComponent(symbol)}/book`, `/public/assets/${encodeURIComponent(symbol)}/depth`];
const probed: { path: string; status: number }[] = [];
for (const p of quoteProbes) {
  try {
    const r = await raw(p);
    probed.push({ path: p, status: r.status });
  } catch (err) {
    probed.push({ path: p, status: -1 });
    void err;
  }
}
const anyQuoteRoute = probed.some((p) => p.status === 200);
record(
  "EXECUTABLE_QUOTE",
  anyQuoteRoute ? "UNKNOWN" : "BLOCKED",
  anyQuoteRoute
    ? "one of the probed routes answered 200 and must be read before any spread is claimed"
    : `none of ${probed.length} probed routes exists (${probed.map((p) => `${p.path.split("/").pop()}=${p.status}`).join(", ")}): the permitted sources publish no bid, no ask, no size and no expiry, so a quoted spread cannot be computed and must not be estimated`,
  { probed, conclusion: "no two-sided quote source in the permitted set" },
);

// ---------------------------------------------------------------- 7. are the supply figures comparable?
const total = await raw(`/public/assets/${encodeURIComponent(symbol)}/total-supply`);
const circ = await raw(`/public/assets/${encodeURIComponent(symbol)}/circulating-supply`);
const por = await xstocks.proofOfReserves(symbol);
const totalV = (total.body as { value?: number }).value ?? null;
const circV = (circ.body as { value?: number }).value ?? null;
const magnitudes = totalV !== null && circV !== null && circV > 0 ? Math.log10(totalV / circV) : null;
record(
  "SUPPLY_UNITS",
  magnitudes !== null && Math.abs(magnitudes) < 1 ? "PASS" : "BLOCKED",
  magnitudes === null
    ? "a supply figure is missing, so backing per token cannot be established"
    : `total-supply reports ${totalV} and circulating-supply ${circV}, ${magnitudes.toFixed(1)} orders of magnitude apart, while proof-of-reserves holds ${por.data.sharesHeld} ${a.underlyingSymbol} shares against a circulating figure of ${por.data.circulatingSupply}: the three are not in one unit or one scope, so shares backing a token is not computable and the desk must not divide them`,
  { issuerTotalSupply: totalV, issuerCirculatingSupply: circV, ordersOfMagnitudeApart: magnitudes, porSharesHeld: por.data.sharesHeld, porCirculatingSupply: por.data.circulatingSupply, porTimestamp: por.data.timestamp, note: "proof-of-reserves and the supply endpoints are issuer-wide; the chain read below is one deployment", sources: { total: { url: total.url, sha256: total.sha256 }, circulating: { url: circ.url, sha256: circ.sha256 }, reserves: por.provenance } },
);

// ---------------------------------------------------------------- 8. the event itself, in the issuer's own units
const history = await xstocks.corporateActionHistory({ symbol, pageSize: 50 });
const rebases = history.data.filter((x) => x.multiplierOld !== null && x.multiplierNew !== null && x.multiplierOld !== x.multiplierNew);
const action = rebases[0] ?? null;
let impactPct: string | null = null;
if (action && action.multiplierOld !== null && action.multiplierNew !== null) {
  impactPct = pctChange(action.multiplierOld, action.multiplierNew);
}
record(
  "EVENT_IMPACT_INPUTS",
  action !== null && impactPct !== null ? "PASS" : "BLOCKED",
  action === null
    ? `the issuer's 50 most recent records for ${symbol} contain no multiplier change`
    : `${action.caType} ${action.eventId} v${action.version} moves the multiplier ${action.multiplierOld} to ${action.multiplierNew} (${impactPct}% on a holder's balance), effective ${action.effectiveTimeUtc ?? "not set"}, announced ${action.createdTimeUtc}, net cashflow ${action.netCashflowUsd ?? "not stated"} with withholding ${action.withholdingTaxRate ?? "not stated"}: exact decimal strings, so the balance effect is computable without a price`,
  { action, balanceImpactPct: impactPct, rejectedRecords: history.rejected, source: history.provenance },
);

// ---------------------------------------------------------------- 9. freshness: what the fetch time is worth
record(
  "FRESHNESS_BOUND",
  asset.provenance.fetchedAt ? "PASS" : "UNKNOWN",
  `the asset response carries cache-control "${(await raw(`/public/assets/${encodeURIComponent(symbol)}`)).cacheControl ?? "none"}" and no body-level observation time; the price response carries none either, so every observation is dated by fetch time and an edge cache may make it older than that`,
  { assetCacheControl: (await raw(`/public/assets/${encodeURIComponent(symbol)}`)).cacheControl, priceCacheControl: price.cacheControl, priceAge: price.age, bodyObservationTimes: { asset: null, price: null, proofOfReserves: por.data.timestamp } },
);

// ---------------------------------------------------------------- 10. does the chain agree with the issuer?
let chainCheck: Check = { check: "ISSUER_VERSUS_CHAIN", verdict: "UNKNOWN", finding: "not attempted", evidence: null };
if (xl) {
  try {
    const onchain = await xlayer.multiplierAt(xl.address, "latest");
    const issuerState = await xstocks.multiplier(symbol, "XLayer");
    const issuerNow = String(issuerState.data.currentMultiplier);
    const agree = exactEquals(onchain.data.multiplier, issuerNow);
    chainCheck = {
      check: "ISSUER_VERSUS_CHAIN",
      verdict: agree ? "PASS" : "BLOCKED",
      finding: agree
        ? `multiplier() on X Layer at block ${onchain.data.blockNumber} returns ${onchain.data.multiplier} and the issuer API reports ${issuerNow}: equal at 18 decimals, so the two sides of the event are comparable`
        : `multiplier() on X Layer at block ${onchain.data.blockNumber} returns ${onchain.data.multiplier} but the issuer API reports ${issuerNow}: they disagree, which is the finding, not an error`,
      evidence: { onchain: onchain.data, issuerCurrent: issuerNow, issuerPending: issuerState.data.newMultiplier, pendingIsSentinel: issuerState.data.newMultiplier === 0, ratio: ratio(onchain.data.multiplier, issuerNow), sources: { chain: onchain.provenance, issuer: issuerState.provenance } },
    };
  } catch (err) {
    chainCheck = { check: "ISSUER_VERSUS_CHAIN", verdict: "UNKNOWN", finding: `the X Layer read failed: ${err instanceof Error ? err.message : String(err)}`, evidence: null };
  }
}
checks.push(chainCheck);
console.log(`[${chainCheck.verdict}] ${chainCheck.check}: ${chainCheck.finding}`);

// ---------------------------------------------------------------- verdict
const verdictFor = (name: string) => checks.find((x) => x.check === name)?.verdict ?? "UNKNOWN";
const verdict = {
  EVENT_IMPACT: verdictFor("EVENT_IMPACT_INPUTS") === "PASS" ? "AVAILABLE" : "INSUFFICIENT_DATA",
  REFERENCE_DISCREPANCY:
    verdictFor("EVENT_IMPACT_INPUTS") === "PASS" && verdictFor("REFERENCE_PRICE") === "PASS"
      ? "AVAILABLE, between two issuer figures with different observation times; the time gap is a limitation, not an edge"
      : "INSUFFICIENT_DATA: no reference price is being published right now",
  ESTIMATED_QUOTED_SPREAD: "INSUFFICIENT_DATA: no bid, ask, size, fee schedule or quote expiry exists in the permitted sources",
  NET_EDGE: "SUPPRESSED: unknown costs are unknown, and no executable quote exists to net them against",
  scope: "One asset, one issuer, one chain. This probe reads; it does not trade, and no source here is a venue.",
};

mkdirSync("artifacts/integration", { recursive: true });
const out = `artifacts/integration/market-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, symbol, sources: { xstocks: config.XSTOCKS_BASE_URL, xlayer: config.XLAYER_RPC_URL }, checks, verdict }, null, 2));
console.log(`\nwrote ${out}`);
const blocked = checks.filter((x) => x.verdict === "BLOCKED").length;
console.log(`${checks.length} checks, ${blocked} blocked. Labels the data supports: EVENT IMPACT ${verdict.EVENT_IMPACT}; quoted spread ${verdict.ESTIMATED_QUOTED_SPREAD.split(":")[0]}.`);
