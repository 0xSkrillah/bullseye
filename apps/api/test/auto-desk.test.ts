import { describe, expect, it, vi } from "vitest";
import { AutoDesk } from "../src/desk/autoDesk.js";
import { FIXTURE_CLOCK } from "../src/adapters/fixtures.js";
import { testContainer } from "./helpers.js";

const opts = { intervalMinutes: 30, maxInvestigationsPerDay: 3 };
const count = (c: Awaited<ReturnType<typeof testContainer>>) => (c.db.prepare("SELECT COUNT(*) AS n FROM investigations").get() as { n: number }).n;

describe("auto desk", () => {
  it("scans, investigates one new signal, and publishes a Brief with nobody driving", async () => {
    const c = await testContainer();
    const desk = new AutoDesk(c, opts);
    const first = await desk.tick();
    expect(first.action).toBe("STARTED");
    if (first.action !== "STARTED") return;
    await c.investigations.wait(first.investigationId);
    expect(c.investigations.view(first.investigationId)!.status).toBe("PUBLISHED");
    expect(c.briefs.list()).toHaveLength(1);
  });

  it("never investigates the same signal twice, even when the first run published nothing", async () => {
    const c = await testContainer();
    c.setFixtureBehaviour("unevidenced_number");
    const desk = new AutoDesk(c, opts);
    const first = await desk.tick();
    if (first.action !== "STARTED") throw new Error("expected a start");
    await c.investigations.wait(first.investigationId);
    expect(c.investigations.view(first.investigationId)!.status).toBe("REJECTED");

    c.setFixtureBehaviour("good");
    expect(await desk.tick()).toEqual({ action: "IDLE", reason: "NOTHING_NEW" });
    expect(count(c)).toBe(1);
  });

  it("stops at the daily ceiling before scanning", async () => {
    const c = await testContainer();
    const desk = new AutoDesk(c, { ...opts, maxInvestigationsPerDay: 1, now: () => new Date() });
    const first = await desk.tick();
    if (first.action !== "STARTED") throw new Error("expected a start");
    await c.investigations.wait(first.investigationId);
    const scan = vi.spyOn(c.signals, "scan");
    expect(await desk.tick()).toMatchObject({ action: "IDLE", reason: "DAILY_CAP" });
    expect(scan).not.toHaveBeenCalled();
  });

  it("does nothing while an investigation is running", async () => {
    const c = await testContainer();
    c.db.prepare("INSERT INTO signals (id, json, observed_at, detected_at) VALUES ('sig_x', '{}', ?, ?)").run(FIXTURE_CLOCK.toISOString(), FIXTURE_CLOCK.toISOString());
    c.db.prepare("INSERT INTO investigations (id, signal_id, status, started_at, budget_json, synthesis_json) VALUES ('inv_x', 'sig_x', 'RUNNING', ?, '{}', '{}')").run(new Date(Date.now() - 48 * 3_600_000).toISOString());
    expect(await new AutoDesk(c, opts).tick()).toMatchObject({ action: "IDLE", reason: "BUSY" });
    expect(count(c)).toBe(1);
  });

  it("is not blocked for ever by a run that a restart cut off: start-up closes it, and its signal is not retried", async () => {
    const c = await testContainer();
    const scan = await c.signals.scan();
    const cut = scan.signals[0]!;
    c.db.prepare("INSERT INTO investigations (id, signal_id, status, started_at, budget_json, synthesis_json) VALUES ('inv_cut', ?, 'RUNNING', ?, '{}', '{}')").run(cut.id, new Date(Date.now() - 48 * 3_600_000).toISOString());
    const desk = new AutoDesk(c, opts);
    expect(await desk.tick()).toMatchObject({ action: "IDLE", reason: "BUSY" });

    expect(c.investigations.recoverInterrupted()).toEqual(["inv_cut"]);
    const view = c.investigations.view("inv_cut")!;
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "ERROR" });
    expect(view.timeline.at(-1)).toMatchObject({ type: "STOPPED", ok: false });
    expect(view.timeline.at(-1)!.detail).toContain("restarted");
    expect(c.investigations.recoverInterrupted()).toEqual([]);

    const next = await desk.tick();
    expect(next.action === "STARTED" ? next.signalId : null).not.toBe(cut.id);
  });

  it("does not spend on research it could not sell: an unready payment rail keeps it idle", async () => {
    const c = await testContainer({ PAY_TO_ADDRESS: undefined as unknown as string });
    const outcome = await new AutoDesk(c, opts).tick();
    expect(outcome).toMatchObject({ action: "IDLE", reason: "NOT_READY" });
    expect(count(c)).toBe(0);
  });

  it("reports a failed scan as idle instead of throwing", async () => {
    const c = await testContainer();
    c.fixtureTransport.remove("xstocks.ca-history.all");
    expect(await new AutoDesk(c, opts).tick()).toMatchObject({ action: "IDLE", reason: "SCAN_FAILED" });
  });

  it("states its worst-case daily model spend", async () => {
    const c = await testContainer({ BUDGET_MAX_COST_USD: "0.60", BRIEF_PRICE_USD: "3.00" });
    expect(new AutoDesk(c, opts).dailySpendCeilingUsd).toBe(1.8);
  });
});
