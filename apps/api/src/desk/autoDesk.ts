import type { Container } from "../container.js";

export interface AutoDeskOptions {
  intervalMinutes: number;
  /** hard ceiling on investigations started in any 24 hours; with the per-investigation budget it bounds daily model spend */
  maxInvestigationsPerDay: number;
  now?: () => Date;
  log?: (line: string) => void;
}

export type TickOutcome =
  | { action: "STARTED"; signalId: string; investigationId: string }
  | { action: "IDLE"; reason: "NOT_READY" | "BUSY" | "DAILY_CAP" | "NOTHING_NEW" | "SCAN_FAILED"; detail?: string };

/**
 * Runs the desk without an operator: scan, and investigate at most one signal per tick.
 * It only ever starts a signal that has never been investigated, so a run the gate rejected
 * or the budget stopped is not retried on a timer, and it stops at the daily ceiling.
 */
export class AutoDesk {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTick: { at: string; outcome: TickOutcome } | null = null;
  private nextTickAt: string | null = null;

  constructor(
    private readonly c: Container,
    private readonly opts: AutoDeskOptions,
  ) {}

  /** worst-case model spend per 24 hours, USD */
  get dailySpendCeilingUsd(): number {
    return Math.round(this.opts.maxInvestigationsPerDay * this.c.config.budget.maxVariableCostUsd * 100) / 100;
  }

  start(): void {
    if (this.timer) return;
    const run = () => void this.tick().then((o) => this.opts.log?.(`auto desk: ${o.action === "STARTED" ? `investigating ${o.signalId} (${o.investigationId})` : `idle, ${o.reason}${o.detail ? `: ${o.detail}` : ""}`}`));
    const schedule = () => (this.nextTickAt = new Date(Date.now() + this.opts.intervalMinutes * 60_000).toISOString());
    this.timer = setInterval(() => {
      schedule();
      run();
    }, this.opts.intervalMinutes * 60_000);
    this.timer.unref();
    schedule();
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextTickAt = null;
  }

  /** what the loop last did and when it will look again; process memory, so empty after a restart until the first tick */
  status(): { lastTick: { at: string; action: TickOutcome["action"]; reason: string | null; detail: string | null } | null; nextTickAt: string | null } {
    const t = this.lastTick;
    return {
      lastTick: t ? { at: t.at, action: t.outcome.action, reason: t.outcome.action === "IDLE" ? t.outcome.reason : null, detail: t.outcome.action === "IDLE" ? (t.outcome.detail ?? null) : t.outcome.signalId } : null,
      nextTickAt: this.nextTickAt,
    };
  }

  async tick(): Promise<TickOutcome> {
    if (this.ticking) return { action: "IDLE", reason: "BUSY", detail: "previous tick still scanning" };
    this.ticking = true;
    try {
      const outcome = await this.step();
      this.lastTick = { at: (this.opts.now ? this.opts.now() : new Date()).toISOString(), outcome };
      return outcome;
    } finally {
      this.ticking = false;
    }
  }

  private async step(): Promise<TickOutcome> {
    const { c } = this;
    const now = this.opts.now ? this.opts.now() : new Date();

    // nothing is investigated that could not be sold: no model, or a rail that cannot settle
    const synthesis = c.synthesisStatus();
    if (!synthesis.ready) return { action: "IDLE", reason: "NOT_READY", detail: `synthesis: ${synthesis.detail}` };
    const rail = c.rail.status();
    if (!rail.ready) return { action: "IDLE", reason: "NOT_READY", detail: `payment rail: ${rail.detail}` };

    const running = c.db.prepare("SELECT COUNT(*) AS n FROM investigations WHERE status = 'RUNNING'").get() as { n: number };
    if (running.n > 0) return { action: "IDLE", reason: "BUSY", detail: "an investigation is running" };

    const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const recent = c.db.prepare("SELECT COUNT(*) AS n FROM investigations WHERE started_at > ?").get(since) as { n: number };
    if (recent.n >= this.opts.maxInvestigationsPerDay) return { action: "IDLE", reason: "DAILY_CAP", detail: `${recent.n} started in the last 24 h` };

    let signals;
    try {
      signals = (await c.signals.scan()).signals;
    } catch (err) {
      return { action: "IDLE", reason: "SCAN_FAILED", detail: err instanceof Error ? err.message : String(err) };
    }

    const next = signals.find((s) => c.signals.supersession(s.id) === null && c.investigations.latestForSignal(s.id) === null);
    if (!next) return { action: "IDLE", reason: "NOTHING_NEW" };
    const started = c.investigations.start(next);
    return { action: "STARTED", signalId: next.id, investigationId: started.investigationId };
  }
}
