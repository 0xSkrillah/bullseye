import { Brief, canonicalJson, type BriefPreview } from "@bullseye/domain";
import type { Db } from "./db.js";
import { sha256 } from "./adapters/transport.js";

export class BriefIntegrityError extends Error {}

export class BriefStore {
  constructor(private readonly db: Db) {}

  get(id: string): Brief | null {
    const row = this.db.prepare("SELECT json FROM briefs WHERE id = ?").get(id) as { json: string } | undefined;
    if (!row) return null;
    const brief = Brief.parse(JSON.parse(row.json));
    const { contentHash, ...body } = brief;
    if (sha256(canonicalJson(body)) !== contentHash) throw new BriefIntegrityError(`brief ${id} does not match its content hash`);
    return brief;
  }

  forSignal(signalId: string): Brief | null {
    const row = this.db.prepare("SELECT id FROM briefs WHERE signal_id = ? ORDER BY published_at DESC LIMIT 1").get(signalId) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  list(limit = 50): Brief[] {
    const rows = this.db.prepare("SELECT id FROM briefs ORDER BY published_at DESC LIMIT ?").all(limit) as { id: string }[];
    return rows.map((r) => this.get(r.id)).filter((b): b is Brief => b !== null);
  }
}

export function toPreview(brief: Brief): BriefPreview {
  return {
    id: brief.id,
    headline: brief.draft.headline,
    publishedAt: brief.publishedAt,
    dataMode: brief.dataMode,
    synthesis: brief.synthesis,
    signalId: brief.signal.id,
    asset: brief.signal.asset.symbol,
    confidence: brief.draft.confidence.level,
    evidenceCount: brief.evidence.length,
    evidenceKinds: brief.evidence.map((e) => e.kind),
    unknownCount: brief.draft.unknowns.length,
    conflictCount: brief.draft.conflicts.length,
    contentHash: brief.contentHash,
  };
}
