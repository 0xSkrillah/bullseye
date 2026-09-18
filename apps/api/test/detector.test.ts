import { describe, expect, it } from "vitest";
import type { Provenance, Sourced } from "@bullseye/domain";
import { detectRebaseSignals } from "../src/signals/rebaseDetector.js";
import type { XsAsset, XsCorporateAction } from "../src/adapters/xstocks.js";

const prov = (mode: Provenance["mode"]): Provenance => ({ mode, source: "test", url: "test://x", fetchedAt: "2026-09-18T10:00:00.000Z", sha256: "a".repeat(64) });

const action = (over: Partial<XsCorporateAction> = {}): XsCorporateAction => ({
  eventId: "evt-1",
  version: 2,
  xstockSymbol: "AAAx",
  spvSymbol: "AAA",
  caType: "CashDividend",
  effectiveTimeUtc: "2026-09-18T00:30:00.000Z",
  multiplierOld: "1",
  multiplierNew: "1.003297609233",
  grossCashflowUsd: "0.4",
  netCashflowUsd: "0.28",
  withholdingTaxRate: "0.3",
  createdTimeUtc: "2026-09-17T20:22:24.985Z",
  status: "Initial",
  ...over,
});

const asset = (symbol: string, networks: string[]): Sourced<XsAsset> => ({
  data: { id: symbol, name: `${symbol} name`, symbol, isin: null, underlyingSymbol: symbol.replace(/x$/, ""), isTradingHalted: false, deployments: networks.map((network) => ({ network, address: "0xdfae653d721d8cbfb7ff7ab1dc56693cdfb480f5" })) },
  provenance: prov("LIVE"),
});

const now = new Date("2026-09-18T12:00:00.000Z");
const input = (actions: XsCorporateAction[], assets: Sourced<XsAsset>[], mode: Provenance["mode"] = "LIVE") => ({
  actions: { data: actions, provenance: prov(mode) },
  assets: new Map(assets.map((a) => [a.data.symbol, a])),
  now,
  lookbackHours: 96,
});

describe("rebase detector", () => {
  it("is reproducible: identical inputs give identical signals", () => {
    const a = detectRebaseSignals(input([action()], [asset("AAAx", ["Ethereum", "XLayer"])]));
    const b = detectRebaseSignals(input([action()], [asset("AAAx", ["Ethereum", "XLayer"])]));
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0]!.id).toMatch(/^sig_[0-9a-f]{16}$/);
    expect(a[0]!.facts.changePct).toBe(0.329761);
  });

  it("carries category, asset, both timestamps, sources and provenance", () => {
    const [s] = detectRebaseSignals(input([action()], [asset("AAAx", ["XLayer"])]));
    expect(s).toMatchObject({ category: "CORPORATE_ACTION_REBASE", observedAt: "2026-09-18T00:30:00.000Z", detectedAt: now.toISOString(), asset: { symbol: "AAAx", chainId: 196 } });
    expect(s!.sources).toHaveLength(2);
    expect(s!.provenance).toMatchObject({ mode: "LIVE", detector: "xstocks-rebase-on-xlayer" });
  });

  it("gives a new version of the same corporate action a new identity", () => {
    const [v2] = detectRebaseSignals(input([action({ version: 2 })], [asset("AAAx", ["XLayer"])]));
    const [v3] = detectRebaseSignals(input([action({ version: 3 })], [asset("AAAx", ["XLayer"])]));
    expect(v2!.id).not.toBe(v3!.id);
  });

  it("ignores actions with no multiplier change, future actions and actions outside the lookback", () => {
    const actions = [
      action({ eventId: "same", multiplierNew: "1" }),
      action({ eventId: "null", multiplierOld: null, multiplierNew: null }),
      action({ eventId: "future", effectiveTimeUtc: "2026-09-19T00:30:00.000Z" }),
      action({ eventId: "old", effectiveTimeUtc: "2026-09-01T00:30:00.000Z" }),
    ];
    expect(detectRebaseSignals(input(actions, [asset("AAAx", ["XLayer"])]))).toEqual([]);
  });

  it("ignores assets that are not deployed on X Layer", () => {
    expect(detectRebaseSignals(input([action()], [asset("AAAx", ["Ethereum", "Solana"])]))).toEqual([]);
  });

  it("labels the signal with the weakest data mode of its inputs", () => {
    const [s] = detectRebaseSignals(input([action()], [asset("AAAx", ["XLayer"])], "CACHED"));
    expect(s!.provenance.mode).toBe("CACHED");
  });
});
