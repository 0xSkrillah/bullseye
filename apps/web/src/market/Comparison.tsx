import { humanAge, type ComparisonRow, type EvidenceRef } from "./data";
import { ProvenanceBadge, type BadgeKind } from "../components/ProvenanceBadge";
import { Timestamp } from "../primitives/Timestamp";

const BADGE_KINDS = new Set(["LIVE", "CACHED", "HISTORICAL", "FIXTURE", "STALE", "TESTNET"]);
const badge = (mode: string | null) => (mode !== null && BADGE_KINDS.has(mode) ? (mode as BadgeKind) : null);

/**
 * The two sides, side by side, with what would be needed to compare them.
 *
 * The rows with no value are the point of the panel: they are the bid, the ask, the size and the
 * expiry a spread would need, and they are empty because no source the desk may read publishes
 * them. Leaving them out would make the screen look complete when it is not.
 */
export function Comparison({ rows, onOpenEvidence, evidence }: { rows: ComparisonRow[]; evidence: EvidenceRef[]; onOpenEvidence: (id: string) => void }) {
  const known = new Set(evidence.map((e) => e.id));
  const idFor = (row: ComparisonRow) => (row.evidenceId !== null && known.has(row.evidenceId) ? row.evidenceId : null);
  return (
    <div className="mk-scroll" data-testid="market-comparison">
      <table className="mk-table">
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">Value</th>
            <th scope="col">Unit</th>
            <th scope="col">Observed</th>
            <th scope="col">Age</th>
            <th scope="col">Source</th>
            <th scope="col">Why it reads this way</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = idFor(r);
            return (
              <tr key={r.what} data-testid="market-comparison-row" data-what={r.what}>
                <th scope="row" style={{ fontWeight: 500, background: "none", fontFamily: "var(--font-sans)", fontSize: 13, letterSpacing: 0, textTransform: "none", color: "var(--ink)", position: "static" }}>
                  {r.what}
                </th>
                <td className="mk-num">{r.value === null ? <span className="mk-none">none published</span> : r.value}</td>
                <td className="mk-num" style={{ whiteSpace: "normal", fontSize: 11 }}>
                  {r.unit}
                </td>
                <td className="mk-num">{r.observedAt ? <Timestamp iso={r.observedAt} full /> : <span className="mk-none">—</span>}</td>
                <td className="mk-num">{r.value === null ? <span className="mk-none">—</span> : humanAge(r.ageSeconds)}</td>
                <td className="mk-num" style={{ whiteSpace: "normal" }}>
                  {badge(r.mode) && <ProvenanceBadge kind={badge(r.mode)!} />}
                  {r.stale && r.value !== null && <ProvenanceBadge kind="STALE" />}
                  <br />
                  {r.source}
                  {id && (
                    <>
                      <br />
                      <button type="button" className="mk-evi-btn" onClick={() => onOpenEvidence(id)}>
                        {id}
                      </button>
                    </>
                  )}
                </td>
                <td className="mk-why">{r.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One evidence item, as it was recorded: what it observed, when, until when it is usable, and the
 * hash of the response it came from. A reader who does not trust the figure can fetch the URL and
 * hash it themselves. Values that are part of the Brief are absent and say so.
 */
export function EvidenceDrawer({ item, onClose }: { item: EvidenceRef | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <div className="mk-drawer" role="dialog" aria-modal="true" aria-label={`Evidence ${item.id}`} onClick={onClose}>
      <div className="mk-drawer-panel" data-testid="market-evidence-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="mk-drawer-head">
          <div>
            <strong className="mono">{item.id}</strong>{" "}
            <span style={{ color: "var(--ink-secondary)", fontSize: 13 }}>{item.kind.replaceAll("_", " ").toLowerCase()}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {badge(item.provenance.mode) && <ProvenanceBadge kind={badge(item.provenance.mode)!} />}
            {item.stale && <ProvenanceBadge kind="STALE" />}
            <button type="button" className="be-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {item.summary && <p className="mk-note">{item.summary}</p>}

        <dl className="mk-kv">
          <dt>Observed at</dt>
          <dd>
            <Timestamp iso={item.observedAt} full />
          </dd>
          <dt>Usable until</dt>
          <dd>
            <Timestamp iso={item.staleAfter} full />
          </dd>
          <dt>Fetched at</dt>
          <dd>
            <Timestamp iso={item.provenance.fetchedAt} full />
          </dd>
          <dt>Source</dt>
          <dd>{item.provenance.source}</dd>
          <dt>URL</dt>
          <dd>{item.provenance.url}</dd>
          <dt>sha256 of the response</dt>
          <dd>{item.provenance.sha256}</dd>
          {item.provenance.note && (
            <>
              <dt>Note</dt>
              <dd style={{ fontFamily: "var(--font-sans)" }}>{item.provenance.note}</dd>
            </>
          )}
        </dl>

        {item.valuesWithheld ? (
          <p className="mk-note">
            What this read found is part of the Brief. The item is listed here with its source, its times and the hash of the response, so the read can be checked to have happened; its values are what a buyer pays for.
          </p>
        ) : (
          <div className="mk-scroll">
            <table className="mk-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Value</th>
                  <th scope="col">As recorded</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(item.values ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="mk-num">{v === null ? <span className="mk-none">null</span> : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
