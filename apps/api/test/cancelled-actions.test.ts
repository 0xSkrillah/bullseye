import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { FixtureTransport } from "../src/adapters/transport.js";
import { SchemaMismatchError, XStocksAdapter } from "../src/adapters/xstocks.js";
import { XLayerAdapter } from "../src/adapters/xlayer.js";
import { SignalService } from "../src/signals/signalService.js";
import { EvidenceToolbox } from "../src/evidence/toolbox.js";
import { runConsistencyChecks } from "../src/evidence/checks.js";
import { computeConfidenceCap } from "../src/gate/publicationGate.js";
import { buildFixtureResponses, FIXTURE_CLOCK, FIXTURE_SYMBOL } from "../src/adapters/fixtures.js";

/**
 * The issuer can cancel a corporate action after announcing it. A cancelled record, as served by
 * the live xStocks API on 2026-09-18, has status "Cancelled" and effectiveTimeUtc null.
 */
const cancelled = (over: Record<string, unknown> = {}) => ({
  eventId: "d43711e3-f269-4fe5-a03f-fb1f254a15ea",
  version: 3,
  xstockSymbol: "CPETCx",
  spvSymbol: "386",
  caType: "CashDividend",
  effectiveTimeUtc: null,
  multiplierOld: "1",
  multiplierNew: "1",
  grossCashflowUsd: "0.1223",
  netCashflowUsd: "0.11007",
  withholdingTaxRate: "0.1",
  notes: "[CANCELLED v2] Incorrect cash flow",
  createdTimeUtc: "2026-01-15T08:00:00.000Z",
  status: "Cancelled",
  ...over,
});

function desk(mutate: (responses: Record<string, unknown>) => void) {
  const responses = buildFixtureResponses();
  mutate(responses);
  const transport = new FixtureTransport(responses, () => FIXTURE_CLOCK);
  const xstocks = new XStocksAdapter(transport, "https://example.test");
  return { transport, xstocks, xlayer: new XLayerAdapter(transport, "https://rpc.example.test"), signals: new SignalService(openDb(":memory:"), xstocks, transport, { lookbackHours: 24 * 365, maxAssetsPerScan: 12 }) };
}

const history = (r: Record<string, unknown>) => r["xstocks.ca-history.all"] as { nodes: Record<string, unknown>[] };

describe("cancelled and malformed corporate actions", () => {
  it("a cancelled record with no effective time does not stop the scan and never becomes a signal", async () => {
    const d = desk((r) => history(r).nodes.unshift(cancelled()));
    const scan = await d.signals.scan();
    expect(scan.actionsSeen).toBe(2);
    expect(scan.signals.map((s) => s.asset.symbol)).toEqual([FIXTURE_SYMBOL]);
    expect(scan.skipped).toEqual([]);
  });

  it("a cancelled action is not a signal even if it still carries a multiplier change and an effective time", async () => {
    const d = desk((r) => {
      const live = history(r).nodes[0]!;
      history(r).nodes[0] = { ...live, status: "Cancelled" };
    });
    expect((await d.signals.scan()).signals).toEqual([]);
  });

  it("when the issuer cancels an action, the earlier version still listed in the history does not fire", async () => {
    // exactly what the live API shows: v1 "Initial" stays in the list, v2 "Cancelled" is added above it
    const d = desk((r) => {
      const v1 = history(r).nodes[0]!;
      history(r).nodes.unshift({ ...v1, version: 2, status: "Cancelled", effectiveTimeUtc: null, multiplierNew: v1.multiplierOld, notes: "[CANCELLED v1] Incorrect cash flow", createdTimeUtc: "2026-01-15T08:30:00.000Z" });
    });
    const scan = await d.signals.scan();
    expect(scan.actionsSeen).toBe(2);
    expect(scan.signals).toEqual([]);
  });

  it("when the issuer corrects an action, the signal is raised on the corrected version only", async () => {
    const d = desk((r) => {
      const v1 = history(r).nodes[0]!;
      history(r).nodes.unshift({ ...v1, version: 2, status: "Corrected", multiplierNew: "1.0031", createdTimeUtc: "2026-01-15T08:30:00.000Z" });
    });
    const signals = (await d.signals.scan()).signals;
    expect(signals).toHaveLength(1);
    expect(signals[0]!.facts).toMatchObject({ corporateActionVersion: 2, status: "Corrected", multiplierNew: "1.0031" });
  });

  it("a record that fails the schema is left out and reported, not silently dropped and not fatal", async () => {
    const d = desk((r) => history(r).nodes.unshift(cancelled({ eventId: "bad-record", version: "three" })));
    const scan = await d.signals.scan();
    expect(scan.signals).toHaveLength(1);
    expect(scan.skipped).toHaveLength(1);
    expect(scan.skipped[0]).toMatchObject({ symbol: "bad-record" });
    expect(scan.skipped[0]!.reason).toContain("version");
  });

  it("a page where most records fail the schema is an error, because the contract has changed", async () => {
    const d = desk((r) => {
      history(r).nodes = [cancelled({ version: "x" }), cancelled({ version: "y" }), history(r).nodes[0]!];
    });
    await expect(d.xstocks.corporateActionHistory()).rejects.toBeInstanceOf(SchemaMismatchError);
  });

  const flaggedThen = async (later: (v1: Record<string, unknown>) => Record<string, unknown>[]) => {
    const signal = (await desk(() => undefined).signals.scan()).signals[0]!;
    // the history is append-only: v1 stays, later versions are added above it
    const after = desk((r) => {
      const v1 = history(r).nodes[0]!;
      const rows = [...later(v1), v1];
      history(r).nodes = rows;
      (r[`xstocks.ca-history.${FIXTURE_SYMBOL}`] as { nodes: unknown[] }).nodes = rows;
    });
    const toolbox = new EvidenceToolbox("inv_later", signal, after.xstocks, after.xlayer);
    return { signal, after, toolbox };
  };

  it("if the issuer cancels an action after it was flagged, the evidence says so, a core check fails and confidence is capped at LOW", async () => {
    const { signal, toolbox } = await flaggedThen((v1) => [{ ...v1, version: 2, status: "Cancelled", effectiveTimeUtc: null, multiplierNew: v1.multiplierOld, notes: "[CANCELLED v1] Incorrect cash flow", createdTimeUtc: "2026-01-15T08:30:00.000Z" }]);
    const record = await toolbox.call("get_corporate_action", {});
    expect(record.values).toMatchObject({ version: 1, status: "Initial", newestVersion: 2, newestStatus: "Cancelled", supersededByVersion: 2, supersededReason: "CANCELLED", supersedingNotes: "[CANCELLED v1] Incorrect cash flow" });
    expect(record.summary).toContain("has since cancelled it with v2");

    for (const when of ["before_effective", "after_effective", "latest"]) await toolbox.call("read_onchain_multiplier", { when });
    await toolbox.call("get_proof_of_reserves", {});
    const checks = runConsistencyChecks(signal, toolbox.all());
    expect(checks.find((c) => c.id === "CHK-ACTION-STILL-CURRENT")).toMatchObject({ status: "FAIL" });
    expect(computeConfidenceCap(toolbox.all(), checks)).toBe("LOW");
  });

  it("a later version that starts from the same multiplier replaces the earlier one", async () => {
    const { signal, toolbox, after } = await flaggedThen((v1) => [{ ...v1, version: 2, status: "Corrected", multiplierNew: "1.0031", createdTimeUtc: "2026-01-15T08:30:00.000Z" }]);
    const record = await toolbox.call("get_corporate_action", {});
    expect(record.values).toMatchObject({ supersededByVersion: 2, supersededReason: "REPLACED" });
    expect(runConsistencyChecks(signal, toolbox.all()).find((c) => c.id === "CHK-ACTION-STILL-CURRENT")!.status).toBe("FAIL");
    expect((await after.signals.scan()).signals.map((s) => s.facts.corporateActionVersion)).toEqual([2]);
  });

  it("a later version that starts where the earlier one ended is a further rebase: the earlier one stands", async () => {
    // seen live: LINx v2 1.0052 -> 1.0076, then v3 "Corrected" 1.0076 -> 1.0085, both executed on-chain
    const { signal, toolbox, after } = await flaggedThen((v1) => [{ ...v1, version: 2, status: "Corrected", multiplierOld: v1.multiplierNew, multiplierNew: "1.0041", effectiveTimeUtc: "2026-01-15T06:30:00.000Z", createdTimeUtc: "2026-01-15T06:00:00.000Z" }]);
    const record = await toolbox.call("get_corporate_action", {});
    expect(record.values).toMatchObject({ version: 1, newestVersion: 2, supersededByVersion: null });
    expect(record.summary).toContain("does not void this one");
    expect(runConsistencyChecks(signal, toolbox.all()).find((c) => c.id === "CHK-ACTION-STILL-CURRENT")!.status).toBe("PASS");
    expect((await after.signals.scan()).signals.map((s) => s.facts.corporateActionVersion).sort()).toEqual([1, 2]);
  });

  it("fails closed when a row that cannot be read might be a newer version of the action", async () => {
    // the newest row of this event is malformed; the older row must not be vouched for or flagged
    const broken = desk((r) => {
      const v1 = history(r).nodes[0]!;
      const rows = [{ ...v1, version: "2", status: "Cancelled" }, v1];
      history(r).nodes = rows;
      (r[`xstocks.ca-history.${FIXTURE_SYMBOL}`] as { nodes: unknown[] }).nodes = rows;
    });
    const scan = await broken.signals.scan();
    expect(scan.signals).toEqual([]);
    expect(scan.skipped[0]!.reason).toContain("no version of this event is trusted");

    const signal = (await desk(() => undefined).signals.scan()).signals[0]!;
    await expect(new EvidenceToolbox("inv_broken", signal, broken.xstocks, broken.xlayer).call("get_corporate_action", {})).rejects.toThrow(/failed validation and may revise this action/);
  });

  it("marks a stored signal once the issuer voids it, and leaves the others alone", async () => {
    const responses = buildFixtureResponses();
    const transport = new FixtureTransport(responses, () => FIXTURE_CLOCK);
    const signals = new SignalService(openDb(":memory:"), new XStocksAdapter(transport, "https://example.test"), transport, { lookbackHours: 24 * 365, maxAssetsPerScan: 12 });
    const [signal] = (await signals.scan()).signals;
    expect(signals.supersession(signal!.id)).toBeNull();

    const v1 = history(responses).nodes[0]!;
    history(responses).nodes.unshift({ ...v1, version: 2, status: "Cancelled", effectiveTimeUtc: null, multiplierNew: v1.multiplierOld, notes: "[CANCELLED v1] Incorrect cash flow", createdTimeUtc: "2026-01-15T08:30:00.000Z" });
    await signals.scan();
    expect(signals.supersession(signal!.id)).toMatchObject({ byVersion: 2, reason: "CANCELLED", notes: "[CANCELLED v1] Incorrect cash flow" });
    expect(signals.list().map((s) => s.id)).toEqual([signal!.id]);
  });

  it("an unchanged issuer record passes the check", async () => {
    const d = desk(() => undefined);
    const signal = (await d.signals.scan()).signals[0]!;
    const toolbox = new EvidenceToolbox("inv_ok", signal, d.xstocks, d.xlayer);
    await toolbox.call("get_corporate_action", {});
    expect(runConsistencyChecks(signal, toolbox.all()).find((c) => c.id === "CHK-ACTION-STILL-CURRENT")).toMatchObject({ status: "PASS" });
  });
});
