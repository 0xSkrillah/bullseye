import { SignalEvent, type Sourced } from "@bullseye/domain";
import type { Db } from "../db.js";
import type { SourceTransport } from "../adapters/transport.js";
import type { XsAsset, XStocksAdapter } from "../adapters/xstocks.js";
import { detectRebaseSignals, isRebaseCandidate } from "./rebaseDetector.js";

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

  async scan(): Promise<ScanResult> {
    const now = this.transport.now();
    const actions = await this.xstocks.corporateActionHistory({ pageSize: 50 });
    const candidates = actions.data.filter((a) => isRebaseCandidate(a, now, this.opts.lookbackHours));
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

    const signals = detectRebaseSignals({ actions, assets, now, lookbackHours: this.opts.lookbackHours });
    const newSignalIds: string[] = [];
    const insert = this.db.prepare("INSERT OR IGNORE INTO signals (id, json, observed_at, detected_at) VALUES (?, ?, ?, ?)");
    for (const s of signals) {
      // first detection wins, so detectedAt records when Bullseye first saw the event
      const res = insert.run(s.id, JSON.stringify(s), s.observedAt, s.detectedAt);
      if (res.changes > 0) newSignalIds.push(s.id);
    }
    return { scannedAt: now.toISOString(), actionsSeen: actions.data.length, candidates: candidates.length, signals, newSignalIds, skipped };
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
