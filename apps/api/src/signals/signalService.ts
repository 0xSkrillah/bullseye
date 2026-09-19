import { SignalEvent, type Sourced } from "@bullseye/domain";
import type { Db } from "../db.js";
import type { SourceTransport } from "../adapters/transport.js";
import type { XsAsset, XsCorporateAction, XStocksAdapter } from "../adapters/xstocks.js";
import { currentVersions, detectRebaseSignals, isRebaseCandidate, supersededBy, type Supersession } from "./rebaseDetector.js";

export interface ScanResult {
  scannedAt: string;
  actionsSeen: number;
  candidates: number;
  signals: SignalEvent[];
  newSignalIds: string[];
  skipped: { symbol: string; reason: string }[];
}

export class SignalService {
  constructor(
    private readonly db: Db,
    private readonly xstocks: XStocksAdapter,
    private readonly transport: SourceTransport,
    private readonly opts: { lookbackHours: number; maxAssetsPerScan: number } = { lookbackHours: 96, maxAssetsPerScan: 12 },
  ) {}

  /** how far back the detector looks for an effective time, in hours */
  get lookbackHours(): number {
    return this.opts.lookbackHours;
  }

  async scan(): Promise<ScanResult> {
    const now = this.transport.now();
    const actions = await this.xstocks.corporateActionHistory({ pageSize: 50 });
    const tainted = new Set(actions.rejected.map((r) => r.eventId).filter((id): id is string => id !== null));
    const candidates = currentVersions(actions.data).filter((a) => !tainted.has(a.eventId) && isRebaseCandidate(a, now, this.opts.lookbackHours));
    const symbols = [...new Set(candidates.map((c) => c.xstockSymbol))].slice(0, this.opts.maxAssetsPerScan);

    const assets = new Map<string, Sourced<XsAsset>>();
    const skipped: ScanResult["skipped"] = [];
    for (const symbol of symbols) {
      try {
        assets.set(symbol, await this.xstocks.asset(symbol));
      } catch (err) {
        skipped.push({ symbol, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    for (const r of actions.rejected) {
      skipped.push({ symbol: r.eventId ?? `record ${r.index}`, reason: `issuer record rejected by schema${r.eventId ? "; no version of this event is trusted until it parses" : ""}: ${r.reason}` });
    }

    const signals = detectRebaseSignals({ actions, assets, now, lookbackHours: this.opts.lookbackHours, taintedEventIds: tainted });
    this.markSuperseded(actions.data, now);
    const newSignalIds: string[] = [];
    const insert = this.db.prepare("INSERT OR IGNORE INTO signals (id, json, observed_at, detected_at) VALUES (?, ?, ?, ?)");
    for (const s of signals) {
      // first detection wins, so detectedAt records when Bullseye first saw the event
      const res = insert.run(s.id, JSON.stringify(s), s.observedAt, s.detectedAt);
      if (res.changes > 0) newSignalIds.push(s.id);
    }
    return { scannedAt: now.toISOString(), actionsSeen: actions.data.length, candidates: candidates.length, signals, newSignalIds, skipped };
  }

  /** A stored signal stays in the feed for the record, but is marked once the issuer cancels or replaces its version. */
  private markSuperseded(actions: XsCorporateAction[], now: Date): void {
    const rows = this.db.prepare("SELECT id, json FROM signals WHERE superseded_json IS NULL").all() as { id: string; json: string }[];
    const mark = this.db.prepare("UPDATE signals SET superseded_json = ? WHERE id = ?");
    for (const r of rows) {
      const signal = SignalEvent.parse(JSON.parse(r.json));
      const own = actions.find((a) => a.eventId === signal.facts.corporateActionId && a.version === signal.facts.corporateActionVersion);
      const sup = own ? supersededBy(own, actions) : null;
      if (sup) mark.run(JSON.stringify({ ...sup, notedAt: now.toISOString() }), r.id);
    }
  }

  supersession(signalId: string): (Supersession & { notedAt: string }) | null {
    const row = this.db.prepare("SELECT superseded_json FROM signals WHERE id = ?").get(signalId) as { superseded_json: string | null } | undefined;
    return row?.superseded_json ? (JSON.parse(row.superseded_json) as Supersession & { notedAt: string }) : null;
  }

  list(limit = 50): SignalEvent[] {
    const rows = this.db.prepare("SELECT json FROM signals ORDER BY observed_at DESC, id ASC LIMIT ?").all(limit) as { json: string }[];
    return rows.map((r) => SignalEvent.parse(JSON.parse(r.json)));
  }

  get(id: string): SignalEvent | null {
    const row = this.db.prepare("SELECT json FROM signals WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? SignalEvent.parse(JSON.parse(row.json)) : null;
  }
}
