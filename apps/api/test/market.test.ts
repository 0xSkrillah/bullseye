import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { FIXTURE_CLOCK } from "../src/adapters/fixtures.js";
import { investigateFirstSignal, testContainer } from "./helpers.js";
import { DecimalError, format, formatTrimmed, from, parse, pctChange, ratio, signedDiff } from "../src/market/decimal.js";
import { assessRebase, costAssumptions, doubleAdjustmentError, impliedReinvestmentPrice, positionValue, quotedSpread, type RebaseInputs } from "../src/market/impact.js";
import { buildMarketView } from "../src/market/marketView.js";
import { projectChain } from "../src/http/projections.js";
import { SignalEvent } from "@bullseye/domain";

/** the real QSRx rebase of 18 September 2026, from artifacts/recorded/xstocks-2026-09-18 */
const QSRx: RebaseInputs = {
  symbol: "QSRx",
  underlyingSymbol: "QSR",
  multiplierOld: "1",
  multiplierNew: "1.0066516577977895",
  effectiveTimeUtc: "2026-09-18T00:30:00.000Z",
  netCashflowUsd: "0.4875",
  grossCashflowUsd: "0.4875",
  withholdingTaxRate: "0",
  referencePrice: { value: "72.75", observedAt: "2026-09-18T19:28:23.114Z", evidenceId: "EV-PRICE" },
  currency: "USD",
  chainMultiplier: { value: "1.0066516577977895", observedAt: "2026-09-18T19:27:00.000Z", evidenceId: "EV-CHAIN-LATEST" },
  chainWithheld: false,
  holdingTokens: "100",
  sizeLimits: { minOrderFiatValue: "1000", maxOrderFiatValue: "0", period: "closed" },
  stalenessLimitSeconds: 86_400,
  now: "2026-09-18T19:30:00.000Z",
};

/** a signal shaped like the fixture desk's, for tests that build a view without a container */
function fixtureSignal(): SignalEvent {
  return SignalEvent.parse({
    id: "sig_00000000000000ff",
    category: "CORPORATE_ACTION_REBASE",
    asset: { symbol: "FIXx", name: "Fixture Corp xStock", isin: null, underlyingSymbol: "FIX", network: "XLayer", chainId: 196, tokenAddress: "0x00000000000000000000000000000000000f1c70" },
    observedAt: "2026-01-15T00:30:00.000Z",
    detectedAt: "2026-01-15T09:00:00.000Z",
    headline: "FIXx dividend rebase",
    reasonFlagged: "multiplier changed",
    facts: { corporateActionId: "ca", corporateActionVersion: 1, caType: "CashDividend", status: "Initial", multiplierOld: "1", multiplierNew: "1.0025", changePct: 0.25, grossCashflowUsd: "0.5", netCashflowUsd: "0.35", withholdingTaxRate: "0.3" },
    sources: [{ mode: "FIXTURE", source: "fixture", url: "fixture://x", fetchedAt: "2026-01-15T09:00:00.000Z", sha256: "0".repeat(64) }],
    provenance: { mode: "FIXTURE", detector: "rebase", detectorVersion: "1", inputHash: "0".repeat(64) },
  });
}

/** long enough for the config schema, which wants a real token rather than a word */
const OPERATOR_TOKEN = "operator-token-for-market-tests";

const figure = (i: RebaseInputs, key: string) => {
  const f = assessRebase(i).figures.find((x) => x.key === key);
  if (!f) throw new Error(`no figure ${key}`);
  return f;
};

describe("decimal arithmetic", () => {
  it("refuses anything that is not a plain decimal rather than repairing it", () => {
    for (const bad of ["", " 1", "1,024.5", "1e21", "1.2.3", "abc", "0x10", "+1", "1."]) {
      expect(() => parse(bad), bad).toThrow(DecimalError);
    }
    expect(() => from(Number.NaN)).toThrow(DecimalError);
    expect(() => from(Infinity)).toThrow(DecimalError);
    // a number JavaScript only prints in exponent form is refused, not reinterpreted
    expect(() => from(1e21)).toThrow(DecimalError);
    expect(() => from(5e-7)).toThrow(DecimalError);
  });

  it("refuses a value carrying more precision than it can hold, instead of truncating it", () => {
    expect(() => parse(`0.${"1".repeat(37)}`)).toThrow(/more than the 36/);
    expect(parse(`0.${"1".repeat(36)}`)).toBeTypeOf("bigint");
  });

  it("rounds once, at the end, with halves away from zero and no negative zero", () => {
    expect(format(parse("2.5"), 0)).toBe("3");
    expect(format(parse("-2.5"), 0)).toBe("-3");
    expect(format(parse("2.4"), 0)).toBe("2");
    expect(format(parse("0.005"), 2)).toBe("0.01");
    expect(format(parse("-0.004"), 2)).toBe("0.00");
    expect(format(parse("-0.004"), 2).startsWith("-")).toBe(false);
    expect(formatTrimmed(parse("1.2500"), 4)).toBe("1.25");
    expect(format(parse("1"), 2)).toBe("1.00");
  });

  it("will not divide by zero, and says which input was zero", () => {
    expect(() => ratio("1", "0")).toThrow(/divide by zero/);
    expect(() => pctChange("0", "1")).toThrow(/percentage of zero/);
  });

  it("keeps the sign of a difference", () => {
    expect(signedDiff("72.75", "73.29", 2)).toBe("0.54");
    expect(signedDiff("73.29", "72.75", 2)).toBe("-0.54");
  });

  it("is exact where a float would not be", () => {
    // 0.1 + 0.2 as doubles is 0.30000000000000004; here the sum is exact
    expect(formatTrimmed(from("0.1") + from("0.2"), 20)).toBe("0.3");
    expect(pctChange("1", "1.0066516577977895")).toBe("0.665165779779");
  });
});

describe("what the rebase does, from the real QSRx event", () => {
  it("states the balance change and says it is not a price return", () => {
    const f = figure(QSRx, "BALANCE_IMPACT");
    expect(f.label).toBe("EVENT_IMPACT");
    expect(f.value).toBe("0.665165779779");
    expect(f.unit).toContain("balance");
    expect(f.limitations.join(" ")).toMatch(/not a price return/i);
    expect(f.missing).toEqual([]);
  });

  it("does not confuse the rise with what a stale cache understates by", () => {
    const rise = figure(QSRx, "BALANCE_IMPACT").value;
    const stale = figure(QSRx, "STALE_BALANCE_ERROR").value;
    expect(rise).toBe("0.665165779779");
    expect(stale).toBe("-0.66077056013");
    // the two are percentages of different bases and must never be quoted as one number
    expect(stale).not.toBe(`-${rise}`);
  });

  it("prices the double application of the multiplier off its level, not off the size of the change", () => {
    // an asset whose multiplier was already above 1: a 10% rebase, but a 65% double-application error
    const alreadyRebased: RebaseInputs = { ...QSRx, multiplierOld: "1.5", multiplierNew: "1.65" };
    expect(figure(alreadyRebased, "BALANCE_IMPACT").value).toBe("10");
    const double = doubleAdjustmentError(alreadyRebased);
    expect(double.value).toBe("65");
    expect(double.headline).toContain("not the 10%");
    // and when the multiplier started at 1 the two coincide, which the desk says out loud
    expect(doubleAdjustmentError(QSRx).headline).toMatch(/same number as the rebase itself/);
  });

  it("recovers the price the issuer reinvested at, and calls the gap to its own reference price a reference discrepancy", () => {
    const f = impliedReinvestmentPrice(QSRx);
    expect(f.label).toBe("REFERENCE_DISCREPANCY");
    // 0.4875 of net cash against a multiplier rise of 0.0066516577977895 implies 73.29 a share
    expect(f.value).toBe("73.2900");
    expect(f.headline).toContain("72.75");
    expect(f.limitations.join(" ")).toMatch(/not observed at the same moment/i);
    expect(f.limitations.join(" ")).toMatch(/not a spread/i);
    // the issuer states no denominator for its cashflow, and the desk says that is its own reading
    expect(f.limitations.join(" ")).toMatch(/assumption/i);
  });

  it("values a stated holding at the reference price and never calls it realisable", () => {
    const f = positionValue(QSRx);
    expect(f.value).toBe("48.39");
    expect(f.inputs.find((x) => x.name === "value before")?.value).toBe("7275.00");
    expect(f.inputs.find((x) => x.name === "value after")?.value).toBe("7323.39");
    expect(f.limitations.join(" ")).toMatch(/not at a quote anyone offered/i);
    expect(f.limitations.join(" ")).toMatch(/valuation, not a realisable amount/i);
  });

  it("agrees the chain matches the issuer at 18 decimals, and disagrees when it does not", () => {
    expect(figure(QSRx, "ISSUER_VERSUS_CHAIN").headline).toMatch(/agree/);
    const off = { ...QSRx, chainMultiplier: { value: "1.0066516577977894", observedAt: null, evidenceId: null } };
    const f = figure(off, "ISSUER_VERSUS_CHAIN");
    expect(f.headline).toMatch(/disagree/);
    expect(f.value).toBe("-0.0000000000000001");
  });
});

describe("missing and stale inputs", () => {
  it("withholds every figure in money when the issuer publishes no price, and names why", () => {
    // the live endpoint answers {"quote": null} whenever the underlying market is closed
    const noPrice: RebaseInputs = { ...QSRx, referencePrice: null };
    for (const key of ["POSITION_VALUE", "IMPLIED_REINVESTMENT_PRICE"]) {
      const f = figure(noPrice, key);
      expect(f.label, key).toBe("INSUFFICIENT_DATA");
      expect(f.value, key).toBeNull();
      expect(f.missing.join(" "), key).toMatch(/no reference price/i);
    }
    // the balance figures need no price and are unaffected
    expect(figure(noPrice, "BALANCE_IMPACT").value).toBe("0.665165779779");
  });

  it("refuses to compute money from an observation past its staleness limit, and says how old it is", () => {
    const stale: RebaseInputs = { ...QSRx, stalenessLimitSeconds: 900, now: "2026-09-19T19:30:00.000Z" };
    const f = positionValue(stale);
    expect(f.label).toBe("INSUFFICIENT_DATA");
    expect(f.missing.join(" ")).toMatch(/older than this desk/i);
    const implied = impliedReinvestmentPrice(stale);
    expect(implied.label).toBe("INSUFFICIENT_DATA");
    expect(implied.missing.join(" ")).toMatch(/\d+ s ago/);
  });

  it("withholds the value in money when no holding has been stated rather than assuming one", () => {
    const f = positionValue({ ...QSRx, holdingTokens: null });
    expect(f.label).toBe("INSUFFICIENT_DATA");
    expect(f.missing.join(" ")).toMatch(/no holding size/i);
  });

  it("says the currency is not stated rather than printing a bare number as dollars", () => {
    const f = positionValue({ ...QSRx, currency: null });
    expect(f.unit).toMatch(/currency not stated/);
  });
});

describe("costs and the absence of a spread", () => {
  it("never shows a spread, and lists every piece it would need first", () => {
    const f = quotedSpread(QSRx);
    expect(f.label).toBe("INSUFFICIENT_DATA");
    expect(f.value).toBeNull();
    const missing = f.missing.join(" | ");
    for (const needed of ["ask", "bid", "size", "expiry", "venue", "fee schedule"]) {
      expect(missing, needed).toContain(needed);
    }
    // and it refuses to estimate one from a reference price
    expect(f.limitations.join(" ")).toMatch(/reference price is not a quote/i);
  });

  it("reports a closed venue as no transactable size at all", () => {
    expect(quotedSpread(QSRx).missing.join(" ")).toMatch(/maximum order value of 0/);
    const open = { ...QSRx, sizeLimits: { minOrderFiatValue: "1000", maxOrderFiatValue: "10000000", period: "market" } };
    expect(quotedSpread(open).missing.join(" ")).not.toMatch(/maximum order value of 0/);
  });

  it("keeps an unknown cost unknown, and never defaults one to zero", () => {
    const costs = costAssumptions(QSRx);
    const unknown = costs.filter((c) => c.basis === "UNKNOWN");
    expect(unknown.length).toBeGreaterThan(0);
    for (const c of unknown) expect(c.value, c.name).toBeNull();
    // the one rate the issuer does publish is carried as published, even when it is zero
    const withholding = costs.find((c) => c.name.includes("withholding"));
    expect(withholding).toMatchObject({ basis: "ISSUER_PUBLISHED", value: "0" });
    // an issuer that states nothing leaves it unknown, not zero
    expect(costAssumptions({ ...QSRx, withholdingTaxRate: null }).find((c) => c.name.includes("withholding"))).toMatchObject({ basis: "UNKNOWN", value: null });
  });

  it("suppresses any net figure while a cost is unknown, and says an unknown cost is not zero", () => {
    const f = figure(QSRx, "NET_EDGE");
    expect(f.label).toBe("INSUFFICIENT_DATA");
    expect(f.value).toBeNull();
    expect(f.missing.join(" ")).toMatch(/no executable quote/i);
    expect(f.limitations.join(" ")).toMatch(/not double-counted|none is netted/i);
  });

  it("claims no opportunity and gives its reasons", () => {
    const a = assessRebase(QSRx);
    expect(a.stillInteresting.verdict).toBe("NO_TRANSACTABLE_OPPORTUNITY");
    expect(a.stillInteresting.because.length).toBeGreaterThan(2);
    const everything = JSON.stringify(a);
    // nothing on this screen may read as advice, a score or a promise
    for (const forbidden of ["guaranteed", "risk-free", "alpha", "profit score", "you should buy", "you should sell"]) {
      expect(everything.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("uses only the four labels, and names missing inputs exactly when the label is INSUFFICIENT_DATA", () => {
    for (const f of assessRebase(QSRx).figures) {
      expect(["EVENT_IMPACT", "REFERENCE_DISCREPANCY", "ESTIMATED_QUOTED_SPREAD", "INSUFFICIENT_DATA"], f.key).toContain(f.label);
      expect(f.missing.length > 0, f.key).toBe(f.label === "INSUFFICIENT_DATA");
      expect(f.value === null, f.key).toBe(f.label === "INSUFFICIENT_DATA");
    }
  });
});

describe("GET /api/market/:signalId", () => {
  it("serves the whole assessment for a signal the fixture desk has investigated", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`);
    expect(res.status).toBe(200);
    const m = res.body.market;
    expect(m.signalId).toBe(signal.id);
    expect(m.asset.symbol).toBe(signal.asset.symbol);
    // the fixture issuer is internally consistent: 0.35 of net cash at a price of 140 is exactly 0.25%
    expect(m.figures.find((f: { key: string }) => f.key === "BALANCE_IMPACT").value).toBe("0.25");
    expect(m.figures.find((f: { key: string }) => f.key === "IMPLIED_REINVESTMENT_PRICE")).toMatchObject({ label: "REFERENCE_DISCREPANCY", value: "140.0000" });
    expect(m.figures.find((f: { key: string }) => f.key === "POSITION_VALUE").value).toBe("35.00");
    expect(m.currency).toBe("USD");
    expect(m.currencyBasis).toBe("ISSUER_FIELD_NAMING");
    expect(m.dataMode).toBe("FIXTURE");
  });

  it("keeps the four clocks apart and labels a late first detection", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`);
    const clocks = res.body.market.clocks;
    expect(clocks.effectiveAt).toBe(signal.observedAt);
    expect(clocks.firstDetectedAt).toBe(signal.detectedAt);
    expect(Date.parse(clocks.latestFetchAt)).toBeGreaterThan(0);
    expect(Date.parse(clocks.answeredAt)).toBeGreaterThan(0);
    // the fixture event took effect at 00:30 and the clock is 09:00: a look back, not a warning
    expect(clocks.detectionLagSeconds).toBeGreaterThan(3600);
    expect(clocks.retrospective).toBe(true);
  });

  it("charts only observations that exist, each at its own timestamp", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`).set("Authorization", "Bearer x");
    const o = res.body.market.observations;
    // two issuer points at the effective instant, plus one point per block the desk actually read
    expect(o.points.filter((p: { source: string }) => p.source === "ISSUER")).toHaveLength(2);
    expect(o.points.filter((p: { source: string }) => p.source === "CHAIN").length).toBeGreaterThan(0);
    for (const p of o.points) {
      expect(Date.parse(p.at), JSON.stringify(p)).toBeGreaterThan(0);
      expect(p.multiplier, JSON.stringify(p)).toMatch(/^\d+(\.\d+)?$/);
    }
    expect(o.eventMarkerAt).toBe(signal.observedAt);
    expect(o.note).toMatch(/Nothing is drawn between them/);
  });

  it("gives a signal with no investigation the event impact and nothing that needs a price", async () => {
    const c = await testContainer();
    const scan = await c.signals.scan();
    const signal = scan.signals[0]!;
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`);
    expect(res.status).toBe(200);
    const m = res.body.market;
    expect(m.investigationId).toBeNull();
    expect(m.figures.find((f: { key: string }) => f.key === "BALANCE_IMPACT").label).toBe("EVENT_IMPACT");
    expect(m.figures.find((f: { key: string }) => f.key === "POSITION_VALUE").label).toBe("INSUFFICIENT_DATA");
    expect(m.figures.find((f: { key: string }) => f.key === "ISSUER_VERSUS_CHAIN").label).toBe("INSUFFICIENT_DATA");
    expect(m.evidence).toEqual([]);
    expect(m.observations.chainReadCount).toBe(0);
    expect(m.observations.note).toMatch(/No on-chain read has been recorded/);
    expect(m.brief.briefId).toBeNull();
    expect(m.currency).toBeNull();
    expect(m.currencyBasis).toBe("UNKNOWN");
  });

  it("answers 404 for a signal that does not exist", async () => {
    const c = await testContainer();
    const res = await request(createApp(c)).get("/api/market/sig_0000000000000000");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "signal_not_found" });
  });
});

describe("the paywall boundary", () => {
  it("withholds the chain's numbers, and every figure derived from them, from a visitor", async () => {
    const c = await testContainer({ OPERATOR_TOKEN: OPERATOR_TOKEN, PUBLIC_BASE_URL: "https://desk.example" });
    const { signal, view } = await investigateFirstSignal(c);
    expect(view.briefId).not.toBeNull();
    const app = createApp(c);

    const visitor = await request(app).get(`/api/market/${signal.id}`);
    expect(visitor.body.audience).toBe("PUBLIC");
    const pub = visitor.body.market;
    expect(pub.observations.chainWithheld).toBe(true);
    expect(pub.observations.points.every((p: { source: string }) => p.source === "ISSUER")).toBe(true);
    expect(pub.observations.chainReadCount).toBeGreaterThan(0);
    expect(pub.observations.note).toMatch(/part of the Brief/);
    // the comparison row exists so the reader knows a read happened, with no value in it
    const chainRow = pub.comparison.find((r: { what: string }) => r.what === "Multiplier on X Layer");
    expect(chainRow.value).toBeNull();
    expect(chainRow.note).toMatch(/Part of the Brief/);
    // and the arithmetic that would give the number away is withheld with it
    const compare = pub.figures.find((f: { key: string }) => f.key === "ISSUER_VERSUS_CHAIN");
    expect(compare.label).toBe("INSUFFICIENT_DATA");
    expect(compare.value).toBeNull();
    expect(compare.missing.join(" ")).toMatch(/paid content/i);
    // every field that carries what the chain returned is empty, block numbers and times included
    for (const p of pub.observations.points) expect(p.blockNumber, JSON.stringify(p)).toBeNull();

    const operator = await request(app).get(`/api/market/${signal.id}`).set("Authorization", `Bearer ${OPERATOR_TOKEN}`);
    expect(operator.body.audience).toBe("DIAGNOSTIC");
    const diag = operator.body.market;
    expect(diag.observations.chainWithheld).toBe(false);
    expect(diag.figures.find((f: { key: string }) => f.key === "ISSUER_VERSUS_CHAIN").label).toBe("EVENT_IMPACT");
    // the same desk, read by the operator, does carry the block numbers and the values
    const onchainMultiplier = c.investigations.evidence(view.id).find((e) => e.id === "EV-CHAIN-LATEST")!.values.multiplierExact as string;
    expect(JSON.stringify(diag)).toContain(onchainMultiplier);
    expect(diag.observations.points.some((p: { source: string; blockNumber: number | null }) => p.source === "CHAIN" && p.blockNumber !== null)).toBe(true);
  });

  it("lets no chain value through by arithmetic, even one the issuer never published", () => {
    // a chain that disagrees with the issuer, so the value it returned is a string of its own
    const secret = "9.876543210987654321";
    const chain = projectChain(
      {
        network: "XLayer",
        token: "0x00000000000000000000000000000000000f1c70",
        symbol: "FIXx",
        issuer: { multiplierOld: "1", multiplierNew: "1.0025", effectiveTimeUtc: "2026-01-15T00:30:00.000Z" },
        reads: [{ key: "HEAD", evidenceId: "EV-CHAIN-LATEST", blockNumber: 50002000, blockTime: "2026-01-15T09:00:00.000Z", multiplier: secret, mode: "FIXTURE" }],
        activation: { evidenceId: "EV-CHAIN-ACTIVATION", blockNumber: 50000900, blockTime: "2026-01-15T00:30:02.000Z", mode: "FIXTURE" },
        activationSearched: true,
      },
      "PUBLIC",
      true,
    );
    expect(chain!.withheld).toBe(true);
    const m = buildMarketView({
      signal: fixtureSignal(),
      investigationId: "inv_test",
      evidence: [],
      chain,
      chainWithheld: true,
      briefId: "brf_test",
      briefWithdrawn: false,
      priceUsd: "1.00",
      now: FIXTURE_CLOCK,
      audience: "PUBLIC",
    });
    const body = JSON.stringify(m);
    expect(body).not.toContain(secret);
    expect(body).not.toContain("50002000");
    expect(m.figures.find((f) => f.key === "ISSUER_VERSUS_CHAIN")?.value).toBeNull();
    // the reader is still told the read exists, so the screen is not silently short of a panel
    expect(m.observations.chainReadCount).toBe(2);
    expect(m.observations.note).toMatch(/part of the Brief/);
  });

  it("keeps the issuer's own figures public, because the issuer publishes them", async () => {
    const c = await testContainer({ OPERATOR_TOKEN: OPERATOR_TOKEN, PUBLIC_BASE_URL: "https://desk.example" });
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`);
    const m = res.body.market;
    expect(m.figures.find((f: { key: string }) => f.key === "BALANCE_IMPACT").value).toBe("0.25");
    expect(m.figures.find((f: { key: string }) => f.key === "IMPLIED_REINVESTMENT_PRICE").value).toBe("140.0000");
    const ca = m.evidence.find((e: { id: string }) => e.id === "EV-CA");
    expect(ca.valuesWithheld).toBe(false);
    expect(ca.values.multiplierNewExact).toBe(signal.facts.multiplierNew);
    // an on-chain item is listed, with its provenance, and without its values
    const onchain = m.evidence.find((e: { kind: string }) => e.kind === "ONCHAIN_MULTIPLIER_LATEST");
    expect(onchain.valuesWithheld).toBe(true);
    expect(onchain.values).toBeNull();
    expect(onchain.summary).toBeNull();
    expect(onchain.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("points at the paid Brief rather than reproducing it", async () => {
    const c = await testContainer({ BRIEF_PRICE_USD: "7.77" });
    const { signal, view } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`);
    const brief = res.body.market.brief;
    expect(brief).toMatchObject({ briefId: view.briefId, forSale: true, priceUsd: "7.77", resourcePath: `/api/v1/briefs/${view.briefId}` });
    // the price of the Brief is never mixed into the event's own figures
    expect(res.body.market.deskEconomicsNote).toMatch(/separate ledgers/);
    for (const f of res.body.market.figures) expect(JSON.stringify(f)).not.toContain(brief.priceUsd);
  });
});

describe("provenance and freshness on the comparison panel", () => {
  it("gives every row a source, a unit, an observation time and a fetch time, and marks the empty ones", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`).set("Authorization", "Bearer x");
    const rows = res.body.market.comparison;
    expect(rows.length).toBeGreaterThan(6);
    for (const r of rows) {
      expect(r.what, JSON.stringify(r)).toBeTruthy();
      expect(r.unit, JSON.stringify(r)).toBeTruthy();
      expect(r.note, JSON.stringify(r)).toBeTruthy();
    }
    const price = rows.find((r: { what: string }) => r.what === "Issuer reference price");
    expect(price.value).toBe("140");
    expect(price.mode).toBe("FIXTURE");
    expect(price.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(price.note).toMatch(/no side, no size, no venue/);
    expect(price.ageSeconds).toBeGreaterThanOrEqual(0);
    for (const missingRow of ["Executable buy quote (ask)", "Executable sell quote (bid)", "Quote size", "Quote expiry"]) {
      const r = rows.find((x: { what: string }) => x.what === missingRow);
      expect(r.value, missingRow).toBeNull();
      expect(r.stale, missingRow).toBe(true);
    }
  });

  it("names the evidence item each row came from, not one that merely shares its URL", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`).set("Authorization", "Bearer x");
    const rows = res.body.market.comparison;
    // On a live or recorded desk every X Layer read carries the same URL — the RPC endpoint — so a
    // row matched to its evidence by URL resolves to whichever chain item happens to come first.
    // Observed on the recorded QSRx run, where all four chain items share https://rpc.xlayer.tech
    // and the head-multiplier row linked to EV-CHAIN-ACTIVATION. The row names its own item instead.
    expect(rows.find((r: { what: string }) => r.what === "Multiplier on X Layer").evidenceId).toBe("EV-CHAIN-LATEST");
    expect(rows.find((r: { what: string }) => r.what === "Issuer reference price").evidenceId).toBe("EV-PRICE");
    expect(rows.find((r: { what: string }) => r.what === "Multiplier the issuer published").evidenceId).toBe("EV-CA");
    expect(rows.find((r: { what: string }) => r.what === "Quote expiry").evidenceId).toBeNull();
  });

  it("carries the trading status as a value, because the issuer does publish one", async () => {
    const c = await testContainer();
    const { signal } = await investigateFirstSignal(c);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`).set("Authorization", "Bearer x");
    const row = res.body.market.comparison.find((r: { what: string }) => r.what === "Trading status");
    expect(row.value).toBe("not halted");
    expect(row.evidenceId).toBe("EV-STATUS");
  });

  it("marks an observation stale once the clock has moved past the limit, and stops computing money", async () => {
    let at = FIXTURE_CLOCK;
    const c = await testContainer({}, {}, () => at);
    const { signal } = await investigateFirstSignal(c);
    // the same desk, an hour later: the recorded observations have not changed, but they have aged
    at = new Date(FIXTURE_CLOCK.getTime() + 3_600_000);
    const res = await request(createApp(c)).get(`/api/market/${signal.id}`).set("Authorization", "Bearer x");
    const m = res.body.market;
    expect(m.figures.find((f: { key: string }) => f.key === "POSITION_VALUE").label).toBe("INSUFFICIENT_DATA");
    expect(m.figures.find((f: { key: string }) => f.key === "IMPLIED_REINVESTMENT_PRICE").label).toBe("INSUFFICIENT_DATA");
    // and the balance arithmetic, which needs no observation of a market, still stands
    expect(m.figures.find((f: { key: string }) => f.key === "BALANCE_IMPACT").value).toBe("0.25");
    const price = m.comparison.find((r: { what: string }) => r.what === "Issuer reference price");
    expect(price.ageSeconds).toBe(3600);
  });
});

describe("a source that changes shape", () => {
  it("withholds the price rather than reading a value it does not recognise", async () => {
    const c = await testContainer();
    const { signal, view } = await investigateFirstSignal(c);
    // the issuer starts sending a formatted string where a number used to be
    const evidence = c.investigations.evidence(view.id).map((e) => (e.id === "EV-PRICE" ? { ...e, values: { ...e.values, quoteUsd: "1,024.50" } } : e));
    const m = buildMarketView({
      signal,
      investigationId: view.id,
      evidence,
      chain: null,
      chainWithheld: false,
      briefId: view.briefId,
      briefWithdrawn: false,
      priceUsd: "1.00",
      now: FIXTURE_CLOCK,
      audience: "DIAGNOSTIC",
    });
    expect(m.figures.find((f) => f.key === "POSITION_VALUE")?.label).toBe("INSUFFICIENT_DATA");
    expect(m.comparison.find((r) => r.what === "Issuer reference price")?.value).toBeNull();
  });
});
