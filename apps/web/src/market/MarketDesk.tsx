import { useCallback, useMemo, useState } from "react";
import { groupFigures, humanAge, LABELS, marketApi, plainHeadline, type EvidenceRef, type MarketResponse, type MarketSignalRow } from "./data";
import { Costs, FigureCard } from "./Figures";
import { Comparison, EvidenceDrawer } from "./Comparison";
import { Observations } from "./Observations";
import { ProvenanceBadge, type BadgeKind } from "../components/ProvenanceBadge";
import { Timestamp } from "../primitives/Timestamp";
import { usePoll } from "../lib/usePoll";
import "./market.css";

/**
 * The Market Desk, at /market and /market/<signalId>.
 *
 * One verified event, read as money. It answers one question — is this still interesting once the
 * data, the adjustments and the costs have been checked — and it answers it with arithmetic and
 * named absences rather than a score. It is read-only: there is no order, no size to enter, no
 * execution, and nothing on it can be acted on through Bullseye.
 */

const BADGE_KINDS = new Set(["LIVE", "CACHED", "HISTORICAL", "FIXTURE", "STALE", "TESTNET"]);
const badge = (mode: string | null) => (mode !== null && BADGE_KINDS.has(mode) ? (mode as BadgeKind) : null);

function signalIdFromPath(): string | null {
  const fromPath = location.pathname.replace(/^\/market\/?/, "").replace(/\/$/, "");
  if (/^sig_[0-9a-f]{16}$/.test(fromPath)) return fromPath;
  const q = new URLSearchParams(location.search).get("signal");
  return q && /^sig_[0-9a-f]{16}$/.test(q) ? q : null;
}

export function MarketDesk() {
  const [chosen, setChosen] = useState<string | null>(() => signalIdFromPath());
  // one drawer for the whole screen: a figure's input, a comparison row and the evidence list all open it
  const [open, setOpen] = useState<EvidenceRef | null>(null);
  const feed = usePoll(() => marketApi.signals(), 30_000, chosen === null);

  // with no event named, take the newest one the desk has investigated: that is the one with figures
  const rows: MarketSignalRow[] = feed.data?.signals ?? [];
  const suggested = useMemo(() => {
    const investigated = rows.filter((r) => r.investigation !== null);
    const pool = investigated.length > 0 ? investigated : rows;
    return [...pool].sort((a, b) => b.signal.detectedAt.localeCompare(a.signal.detectedAt))[0] ?? null;
  }, [rows]);

  const signalId = chosen ?? suggested?.signal.id ?? null;
  const view = usePoll<MarketResponse>(() => marketApi.view(signalId!), 20_000, signalId !== null, [signalId]);

  const pick = useCallback((id: string) => {
    setChosen(id);
    history.pushState({}, "", `/market/${id}`);
  }, []);

  const shell = (children: React.ReactNode) => (
    <div className="mk">
      <header className="mk-top">
        <span className="mk-wordmark">
          <span className="mk-bull" aria-hidden="true" />
          Bullseye · Market Desk
        </span>
        <nav className="mk-links">
          <a href="/">The desk</a>
          <a href="/room">Situation Room</a>
        </nav>
      </header>
      {children}
    </div>
  );

  if (signalId === null) {
    return shell(
      feed.error ? (
        <div className="mk-empty">
          <strong>The desk is not answering.</strong>
          <span>{feed.error}. Start the API on :4402, or run npm run start:offline for the recorded data.</span>
        </div>
      ) : feed.data === null ? (
        <div className="mk-empty">Reading the feed…</div>
      ) : (
        <div className="mk-empty">
          <strong>No event to read yet.</strong>
          <span>The detector has flagged nothing. Nothing is shown rather than an example: this screen never renders an event that was not detected.</span>
        </div>
      ),
    );
  }

  if (view.error) {
    return shell(
      <div className="mk-empty">
        <strong>That event could not be read.</strong>
        <span>{view.error}</span>
        <a className="be-btn" href="/market">
          Pick another
        </a>
      </div>,
    );
  }
  if (view.data === null) return shell(<div className="mk-empty">Reading the event…</div>);

  const m = view.data.market;
  const audience = view.data.audience;
  const sections = groupFigures(m.figures);
  const openEvidence = (id: string) => setOpen(m.evidence.find((e) => e.id === id) ?? null);

  return shell(
    <>
      <section className="mk-hero">
        <span className="mk-eyebrow">
          {m.asset.symbol} · {m.asset.network} · chain {m.asset.chainId}
          {badge(m.dataMode) && <ProvenanceBadge kind={badge(m.dataMode)!} />}
          {audience === "PUBLIC" ? <span title="On-chain figures are part of the Brief in this view.">free view</span> : <span title="Operator or viewer token: the desk's own working detail.">diagnostic view</span>}
        </span>
        <h1 className="mk-title" data-testid="market-headline">{plainHeadline(m)}</h1>
        <p className="mk-lede">{m.headline}</p>
        <p className="mk-note">
          {m.asset.symbol} is {m.asset.tokenIsin ? <>ISIN {m.asset.tokenIsin}, </> : null}a token tracking {m.asset.underlyingSymbol}. They are not the same instrument, and a shared ticker root is not shared exposure.
          {m.currency ? (
            <>
              {" "}
              Figures in money are in {m.currency}
              {m.currencyBasis === "ISSUER_FIELD_NAMING" ? ", which the issuer states by naming its own cashflow fields in it rather than in a currency field" : ""}.
            </>
          ) : (
            <> No source states a currency, so no figure here is labelled as one.</>
          )}
        </p>
      </section>

      <section className="mk-verdict" data-testid="market-verdict" data-verdict={m.stillInteresting.verdict}>
        <p className="mk-verdict-q">Is this opportunity still interesting after checking the data, the adjustments and the costs?</p>
        <p className="mk-verdict-a">{m.stillInteresting.verdict === "NO_TRANSACTABLE_OPPORTUNITY" ? "No transactable opportunity" : "Insufficient data"}</p>
        <ul>
          {m.stillInteresting.because.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="mk-section">
        <h2 className="mk-h2">Four clocks, kept apart</h2>
        <div className="mk-clocks" data-testid="market-clocks">
          <div className="mk-clock">
            <span className="mk-clock-label">Effective</span>
            <span className="mk-clock-value">{m.clocks.effectiveAt ? <Timestamp iso={m.clocks.effectiveAt} full /> : "not set"}</span>
            <span className="mk-clock-note">When the issuer says the action took effect.</span>
          </div>
          <div className="mk-clock">
            <span className="mk-clock-label">First detected</span>
            <span className="mk-clock-value">
              <Timestamp iso={m.clocks.firstDetectedAt} full />
            </span>
            <span className="mk-clock-note">
              {m.clocks.detectionLagSeconds === null ? "Lag unknown." : `${humanAge(m.clocks.detectionLagSeconds)} after it took effect.`}
              {m.clocks.retrospective ? " A look back, not an early warning." : ""}
            </span>
          </div>
          <div className="mk-clock">
            <span className="mk-clock-label">Newest fetch</span>
            <span className="mk-clock-value">{m.clocks.latestFetchAt ? <Timestamp iso={m.clocks.latestFetchAt} full /> : "—"}</span>
            <span className="mk-clock-note">When the freshest source response behind this screen arrived. Not when the value was true.</span>
          </div>
          <div className="mk-clock">
            <span className="mk-clock-label">Answered</span>
            <span className="mk-clock-value">
              <Timestamp iso={m.clocks.answeredAt} full />
            </span>
            <span className="mk-clock-note">When this page was assembled. It reads stored evidence and fetches nothing.</span>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <h2 className="mk-h2">What was observed</h2>
        <Observations points={m.observations.points} eventMarkerAt={m.observations.eventMarkerAt} note={m.observations.note} chainWithheld={m.observations.chainWithheld} chainReadCount={m.observations.chainReadCount} />
      </section>

      {sections
        .filter((s) => s.figures.length > 0)
        .map((s) => (
          <section className="mk-section" key={s.title} data-testid="market-figure-section">
            <h2 className="mk-h2">{s.title}</h2>
            {s.note && <p className="mk-note">{s.note}</p>}
            {s.title === "What it is worth, at a reference price" && (
              <p className="mk-note">
                Computed for a stated holding of {m.statedHoldingTokens} {m.asset.symbol}. The desk does not know any reader's balance and does not ask. A reference price has no side, no size and no
                venue, so everything in this section is a valuation and none of it is a quote.
              </p>
            )}
            <div className="mk-figures">
              {s.figures.map((f) => (
                <FigureCard key={f.key} figure={f} onOpenEvidence={openEvidence} />
              ))}
            </div>
          </section>
        ))}

      <section className="mk-section">
        <h2 className="mk-h2">Both sides, with their sources</h2>
        <Comparison rows={m.comparison} evidence={m.evidence} onOpenEvidence={openEvidence} />
      </section>

      <section className="mk-section">
        <h2 className="mk-h2">Costs, and which of them are unknown</h2>
        <p className="mk-note">An unknown cost is shown as unknown. Treating one as zero would turn a missing input into a favourable assumption, and it is why no net figure appears above.</p>
        <Costs costs={m.costs} />
      </section>

      <section className="mk-section">
        <h2 className="mk-h2">Evidence</h2>
        <p className="mk-note">
          {m.evidence.length === 0
            ? "No investigation has recorded evidence for this event yet, so this screen shows only what the detector published."
            : `${m.evidence.length} recorded items. Each carries the URL it came from, the time it was fetched and the sha256 of the response, so a reader can fetch it and hash it themselves.`}
        </p>
        <div className="mk-pick">
          {m.evidence.map((e) => (
            <a
              key={e.id}
              href={`#${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                setOpen(e);
              }}
            >
              <span>
                <strong className="mono">{e.id}</strong> {e.kind.replaceAll("_", " ").toLowerCase()} {e.valuesWithheld ? "· values in the Brief" : ""}
              </span>
              <small>
                observed <Timestamp iso={e.observedAt} full /> · {e.provenance.mode} · {e.provenance.source}
              </small>
            </a>
          ))}
        </div>
      </section>

      <section className="mk-brief">
        <h2 className="mk-h2">The Brief</h2>
        {m.brief.briefId === null ? (
          <p className="mk-note">No Brief exists for this event. The issuer's side above is all the desk has published; nothing is for sale.</p>
        ) : (
          <>
            <p className="mk-note">
              What the chain returned, each consistency check's verdict and the desk's own working record are in the Brief for this event. {audience === "PUBLIC" ? "This view shows that those reads happened, not what they found." : "This view is the diagnostic one and already shows them."}
            </p>
            <div className="mk-brief-row">
              <a className="be-btn be-btn-primary" href={`/?brief=${m.brief.briefId}`}>
                Open {m.brief.briefId} on the desk
              </a>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-secondary)" }}>
                {m.brief.withdrawn ? "Withdrawn from sale" : `${m.brief.priceUsd} USD · x402`}
              </span>
              {m.brief.resourcePath && (
                <a className="be-btn" href={m.brief.resourcePath}>
                  The paid JSON resource
                </a>
              )}
            </div>
            <p className="mk-note">{m.deskEconomicsNote}</p>
          </>
        )}
      </section>

      <footer className="mk-foot">
        <p>
          Read-only. Bullseye does not broker, execute, hold keys or take positions, and nothing on this screen can be acted on through it. The figures describe an observed corporate action and its
          evidence; they are not investment, legal or tax advice, and no figure here is a recommendation to buy or sell anything.
        </p>
        <p>
          Every label means something specific. {Object.values(LABELS).map((l) => `${l.text}: ${l.meaning}`).join(" ")}
        </p>
        <p>
          Event {m.signalId}
          {m.investigationId ? ` · run ${m.investigationId}` : " · no investigation"} · assembled from stored evidence at <Timestamp iso={m.clocks.answeredAt} full />.
        </p>
      </footer>

      <EvidenceDrawer item={open} onClose={() => setOpen(null)} />
      {chosen === null && suggested && rows.length > 1 && (
        <section className="mk-section">
          <h2 className="mk-h2">Other detected events</h2>
          <div className="mk-pick">
            {rows
              .filter((r) => r.signal.id !== signalId)
              .slice(0, 8)
              .map((r) => (
                <a
                  key={r.signal.id}
                  href={`/market/${r.signal.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    pick(r.signal.id);
                  }}
                >
                  <span>{r.signal.headline}</span>
                  <small>
                    {r.signal.asset.symbol} · effective <Timestamp iso={r.signal.observedAt} full /> · {r.investigation ? "investigated" : "not investigated"}
                  </small>
                </a>
              ))}
          </div>
        </section>
      )}
    </>,
  );
}
