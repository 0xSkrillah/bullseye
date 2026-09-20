import { useId } from "react";
import type { EvidenceItem } from "@bullseye/domain";
import { instantMs } from "../format";
import { useDialogFocus } from "../lib/dialogFocus";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Timestamp } from "../primitives/Timestamp";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface EvidenceDrawerProps {
  /** null renders nothing: the drawer is open exactly when it has an item */
  item: EvidenceItem | null;
  /** drives the stale test */
  now: Date | string;
  onClose(): void;
  /** position of this item among the Brief's evidence, "3 of 5" */
  index?: { n: number; total: number };
  /** the values key a Brief quantity resolved to */
  highlightKey?: string | null;
}

const sub = { fontSize: 11, color: "var(--ink-secondary)" } as const;
const summary = { margin: 0, fontSize: 13, lineHeight: "18px" } as const;

export function EvidenceDrawer({ item, now, onClose, index, highlightKey }: EvidenceDrawerProps) {
  const titleId = useId();
  // the shared modal lifecycle: focus in, Tab kept inside, Escape closes, focus returned
  const { containerRef: ref, titleRef, onKeyDown } = useDialogFocus<HTMLElement, HTMLHeadingElement>(item?.id ?? null, onClose);

  if (!item) return null;

  const stale = instantMs(now) > Date.parse(item.staleAfter);
  const keys = Object.keys(item.values);
  const width = keys.reduce((w, k) => Math.max(w, k.length), 0) + 2;
  const sourceIsLink = /^https?:\/\//.test(item.provenance.url);

  return (
    <aside className="be-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={onKeyDown} data-testid="evidence-drawer" data-evidence-id={item.id}>
      <div className="be-drawer-head">
        <div>
          <h3 className="be-drawer-title mono" id={titleId} tabIndex={-1} ref={titleRef}>
            {item.id}
          </h3>
          <span className="mono" style={sub}>
            <Enum value={item.kind} />
            {index && index.n > 0 ? ` · ${index.n} of ${index.total}` : ""}
          </span>
        </div>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <ProvenanceBadge kind={item.provenance.mode} />
          {stale && <ProvenanceBadge kind="STALE" />}
        </span>
      </div>

      {item.provenance.mode === "FIXTURE" && <p style={{ ...summary, color: "var(--fixture)" }}>Fixture. Not sourced from a real system.</p>}

      {stale ? (
        <p style={{ ...summary, color: "var(--invalid)" }}>
          Past staleAfter since <Timestamp iso={item.staleAfter} />. Cannot support publication.
        </p>
      ) : (
        <p style={summary}>{item.summary}</p>
      )}

      <dl className="be-kv">
        <dt>Observed</dt>
        <dd>
          <Timestamp iso={item.observedAt} full />
        </dd>
        <dt>Stale after</dt>
        <dd style={stale ? { color: "var(--invalid)" } : undefined}>
          <Timestamp iso={item.staleAfter} full />
        </dd>
        <dt>Source</dt>
        <dd>
          {item.provenance.source} · {item.provenance.url}
        </dd>
        <dt>Fetched</dt>
        <dd>
          <Timestamp iso={item.provenance.fetchedAt} full />
        </dd>
        <dt>Mode</dt>
        <dd>
          <Enum value={item.provenance.mode} />
        </dd>
        <dt>sha256</dt>
        <dd>
          <Id value={item.provenance.sha256} />
        </dd>
        {item.provenance.note && (
          <>
            <dt>Note</dt>
            <dd style={{ fontFamily: "var(--font-sans)", color: "var(--ink-secondary)" }}>{item.provenance.note}</dd>
          </>
        )}
      </dl>

      <div className="be-excerpt">
        <span className="be-excerpt-label">VALUES · MACHINE-CHECKABLE</span>
        {keys.map((k) => (
          <span key={k} data-key={k} style={k === highlightKey ? { background: "var(--canvas-overlay)" } : undefined}>
            {k.padEnd(width, " ")}
            {String(item.values[k])}
            {"\n"}
          </span>
        ))}
      </div>

      <div className="be-drawer-actions">
        {sourceIsLink ? (
          <a className="be-btn" href={item.provenance.url} target="_blank" rel="noreferrer noopener">
            Open source ↗
          </a>
        ) : (
          <button className="be-btn" type="button" disabled title={`${item.provenance.url} is not a web address`}>
            Open source ↗
          </button>
        )}
        <button className="be-btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  );
}
