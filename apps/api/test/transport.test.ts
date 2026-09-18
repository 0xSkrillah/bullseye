import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { openDb } from "../src/db.js";
import { FixtureTransport, LiveTransport, RecordedTransport, SourceUnavailableError } from "../src/adapters/transport.js";
import { SchemaMismatchError, XStocksAdapter } from "../src/adapters/xstocks.js";
import { XLayerAdapter } from "../src/adapters/xlayer.js";
import { SignalService } from "../src/signals/signalService.js";
import { EvidenceToolbox } from "../src/evidence/toolbox.js";
import { runConsistencyChecks } from "../src/evidence/checks.js";
import { REPO_ROOT } from "../src/config.js";

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const down = (async () => {
  throw new Error("ECONNRESET");
}) as unknown as typeof fetch;

describe("data modes are never swapped silently", () => {
  it("labels a fresh response LIVE", async () => {
    const t = new LiveTransport({ db: openDb(":memory:"), allowCached: true, fetchImpl: ok({ quote: 10 }) });
    expect((await t.http("k", "https://example.test/a")).provenance.mode).toBe("LIVE");
  });

  it("serves the last good response as CACHED, with its original fetch time and the reason, when the source fails", async () => {
    const db = openDb(":memory:");
    const live = await new LiveTransport({ db, allowCached: true, fetchImpl: ok({ quote: 10 }) }).http("k", "https://example.test/a");
    const cached = await new LiveTransport({ db, allowCached: true, fetchImpl: down }).http("k", "https://example.test/a");
    expect(cached.data).toEqual({ quote: 10 });
    expect(cached.provenance).toMatchObject({ mode: "CACHED", fetchedAt: live.provenance.fetchedAt, sha256: live.provenance.sha256 });
    expect(cached.provenance.note).toContain("ECONNRESET");
  });

  it("fails rather than falling back when caching is not allowed or nothing was cached", async () => {
    const db = openDb(":memory:");
    await new LiveTransport({ db, allowCached: true, fetchImpl: ok({ quote: 10 }) }).http("k", "https://example.test/a");
    await expect(new LiveTransport({ db, allowCached: false, fetchImpl: down }).http("k", "https://example.test/a")).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(new LiveTransport({ db, allowCached: true, fetchImpl: down }).http("other", "https://example.test/b")).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("rejects a live response that does not match the expected schema", async () => {
    const t = new LiveTransport({ allowCached: false, fetchImpl: ok({ quote: "ten" }) });
    await expect(new XStocksAdapter(t, "https://example.test").price("AAAx")).rejects.toBeInstanceOf(SchemaMismatchError);
  });

  it("a fixture transport only ever says FIXTURE and never invents missing keys", async () => {
    const t = new FixtureTransport({ a: { quote: 1 } });
    expect((await t.http("a", "u")).provenance.mode).toBe("FIXTURE");
    await expect(t.http("missing", "u")).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});

describe("recorded replay of real source responses", () => {
  const dir = resolve(REPO_ROOT, "artifacts/recorded/xstocks-2026-09-18");

  it("replays the recording as HISTORICAL and reproduces the on-chain agreement found on the day", async () => {
    const transport = new RecordedTransport(dir);
    const xstocks = new XStocksAdapter(transport, "https://api.xstocks.fi/api/v2");
    const xlayer = new XLayerAdapter(transport, "https://rpc.xlayer.tech");
    const scan = await new SignalService(openDb(":memory:"), xstocks, transport, { lookbackHours: 96, maxAssetsPerScan: 12 }).scan();
    const signal = scan.signals.find((s) => s.asset.symbol === "IFFx")!;
    expect(signal).toMatchObject({ observedAt: "2026-09-18T00:30:00.000Z", provenance: { mode: "HISTORICAL" }, facts: { multiplierOld: "1", multiplierNew: "1.003297609233" } });

    const toolbox = new EvidenceToolbox("inv_replay", signal, xstocks, xlayer);
    for (const when of ["before_effective", "after_effective", "latest"]) await toolbox.call("read_onchain_multiplier", { when });
    await toolbox.call("get_corporate_action", {});
    await toolbox.call("find_onchain_activation", {});
    const evidence = toolbox.all();
    expect(new Set(evidence.map((e) => e.provenance.mode))).toEqual(new Set(["HISTORICAL"]));
    expect(evidence.find((e) => e.id === "EV-CHAIN-ACTIVATION")!.values).toMatchObject({ activationBlock: 70922364, lagSecondsVsIssuerEffectiveTime: 0 });

    const checks = runConsistencyChecks(signal, evidence);
    for (const id of ["CHK-BEFORE-MATCHES-OLD", "CHK-AFTER-MATCHES-NEW", "CHK-LATEST-MATCHES-NEW", "CHK-ACTIVATION-ON-SCHEDULE"]) {
      expect(checks.find((c) => c.id === id)!.status).toBe("PASS");
    }
  });

  it("refuses to answer for anything that was not recorded", async () => {
    const xstocks = new XStocksAdapter(new RecordedTransport(dir), "https://api.xstocks.fi/api/v2");
    await expect(xstocks.price("TSLAx")).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});
