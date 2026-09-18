import type { DataMode } from "@bullseye/domain";

export type BadgeKind = DataMode | "STALE" | "TESTNET";

export interface ProvenanceBadgeProps {
  kind: BadgeKind;
  title?: string;
}

const KINDS = {
  LIVE: { cls: "live", dot: true, glyph: null, title: "Fetched from the named source during this operation." },
  CACHED: { cls: "cached", dot: true, glyph: null, title: "A previous LIVE response, served because the source failed." },
  HISTORICAL: { cls: "historical", dot: true, glyph: null, title: "A recording of a real past response, or a read of past chain state." },
  FIXTURE: { cls: "fixture", dot: true, glyph: null, title: "Fixture. Not sourced from a real system." },
  STALE: { cls: "stale", dot: false, glyph: "✕", title: "Past staleAfter. Cannot support publication." },
  TESTNET: { cls: "testnet", dot: false, glyph: null, title: "X Layer testnet. Not revenue." },
} as const satisfies Record<BadgeKind, { cls: string; dot: boolean; glyph: string | null; title: string }>;

/** The word is the badge; the dot only repeats it. A kind outside the six is not rendered at all. */
export function ProvenanceBadge({ kind, title }: ProvenanceBadgeProps) {
  if (!Object.hasOwn(KINDS, kind)) return null;
  const k = KINDS[kind];
  return (
    <span className={`be-badge be-badge-${k.cls}`} title={title ?? k.title} data-kind={kind}>
      {k.dot && <span className="be-dot" aria-hidden="true" />}
      {k.glyph && <span aria-hidden="true">{k.glyph}</span>}
      {kind}
    </span>
  );
}
