import { useState, type ReactNode } from "react";
import type { Brief as BriefT, BriefPreview, Claim, EvidenceItem, GateResult, Quote, SignalEvent } from "@bullseye/domain";
import type { DeliveryEnvelope, Supersession } from "../lib/api";
import { ConfidenceIndicator } from "../components/ConfidenceIndicator";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { PublicationGateResult } from "../components/PublicationGateResult";
import { UnknownsPanel } from "../components/UnknownsPanel";
import { BriefPaywall } from "../components/BriefPaywall";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { EventTimes } from "../components/EventTimes";
import { BalanceIllustration, PaidValue } from "../components/PaidValue";
import { Enum } from "../primitives/Enum";
import { Timestamp } from "../primitives/Timestamp";
import { Id } from "../primitives/Id";

export interface BriefScreenProps {
  preview: BriefPreview;
  /** the event the Brief is about: the issuer's public facts, shown free */
  signal?: SignalEvent | null;
  /** the issuer voided the action after the Brief was published */
  withdrawn?: Supersession | null;
  /** the gate's decision on this Brief. It was made before the Brief existed, so it is known before anyone buys. */
  gate?: GateResult | null;
  /** the full Brief once delivered (or, in fixture mode, never) */
  brief: BriefT | null;
  /** what was delivered, exactly as the seller sent it: the download is this document */
  envelope?: DeliveryEnvelope | null;
  quote: Quote | null;
  now: Date;
  paying: boolean;
  /** a purchase of this Brief from this browser is unresolved: no new quote and no Pay button until it is */
  purchaseOpen?: boolean;
  /** what happened to the buyer's purchase and the one safe thing to do next */
  notice?: ReactNode;
  onRequestQuote(): void;
  onPay(): void;
}

const chipButton = { cursor: "pointer", font: "inherit", background: "none" } as const;

function Claims({ claims, onOpen }: { claims: Claim[]; onOpen(evidenceId: string, valueKey: string | null): void }) {
  return <>{claims.map((c, i) => (
    <p key={i}>{c.text}<span style={{ display: "inline-flex", gap: 4, marginLeft: 4, verticalAlign: "middle" }}>{c.evidenceIds.map((id) => (
      <button key={id} type="button" className="be-chip" style={chipButton} data-testid="evidence-link" data-evidence-id={id} aria-label={`Open evidence ${id}`}
        onClick={() => onOpen(id, c.quantities.find((q) => q.evidenceId === id)?.valueKey ?? null)}>{id}</button>
    ))}</span></p>
  ))}</>;
}

/** the delivery envelope holds the Brief, the quoted terms and the payment evidence; it never held the claim token or the signature */
function download(envelope: DeliveryEnvelope): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `bullseye-${envelope.brief.id}-${envelope.orderId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const SECTIONS = ["What happened", "Why it may matter", "On-chain observations", "Evidence", "Confidence", "Unknowns", "Conflicts", "Limitations"] as const;

/** Stage VERIFIED INTELLIGENCE. The issuer's facts, the times and what the Brief adds are free; the findings sit behind the paywall until delivered. */
export function BriefScreen({ preview, signal = null, withdrawn = null, gate = null, brief, envelope = null, quote, now, paying, purchaseOpen = false, notice = null, onRequestQuote, onPay }: BriefScreenProps) {
  const unlocked = brief !== null;
  const [open, setOpen] = useState<{ item: EvidenceItem; key: string | null } | null>(null);
  const [indexShown, setIndexShown] = useState(false);
  const openEvidence = (id: string, key: string | null) => {
    const item = brief?.evidence.find((e) => e.id === id);
    if (item) setOpen({ item, key });
  };
  // what the visitor can do about this Brief: a quote, the Pay button, a purchase already under way, or nothing if it was withdrawn
  const purchase = (
    <div className="be-doc-locked" style={{ position: "static" }} data-testid="purchase-block">
      {withdrawn ? (
        <section className="be-paywall" role="status" data-testid="withdrawn-notice">
          <span className="be-stage">Not for sale</span>
          <p>The issuer {withdrawn.reason === "CANCELLED" ? "cancelled" : "replaced"} the action this Brief describes, so it was withdrawn. Nothing can be charged for it. Anyone who bought it earlier can still open it.</p>
        </section>
      ) : purchaseOpen ? null : quote ? (
        <BriefPaywall quote={quote} now={now} paying={paying} onPay={onPay} onViewEvidence={() => setIndexShown((v) => !v)} onRequote={onRequestQuote} />
      ) : (
        <section className="be-paywall" role="dialog" aria-label="Request a quote">
          <span className="be-stage">Purchase</span>
          <p>Request an immutable quote for this Brief. The terms are hashed and cannot change after you approve.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="be-btn be-btn-primary" type="button" onClick={onRequestQuote}>Request quote</button>
            <button className="be-btn" type="button" onClick={() => setIndexShown((v) => !v)} aria-expanded={indexShown}>View evidence first</button>
          </div>
        </section>
      )}
      {indexShown && (
        <section className="be-panel" style={{ padding: 16, marginTop: 12 }} data-testid="evidence-index" aria-label="Evidence in this Brief">
          <span className="be-stage">Evidence in this Brief · free index</span>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13 }}>{preview.evidenceKinds.map((kind, i) => <li key={`${kind}-${i}`}><Enum value={kind} /></li>)}</ol>
          <p style={{ fontSize: 11, lineHeight: "16px", color: "var(--ink-secondary)", margin: "8px 0 0" }}>Weakest input mode: {preview.dataMode}. Each item's values, source URL, fetch time and sha256 open from the Brief once it is delivered.</p>
        </section>
      )}
      {notice}
    </div>
  );
  return (
    <>
      {/* the full id is an attribute, not truncated text: a link that promised one report has to be checkable against it */}
      <span className="be-stage" data-testid="brief-id" data-brief-id={preview.id}>Brief · <Id value={preview.id} keep={6} /> · published <Timestamp iso={preview.publishedAt} /></span>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start", paddingBottom: 24, borderBottom: "1px solid var(--line)" }}>
        <ConfidenceIndicator level={preview.confidence} size={96} cap={(brief?.gate ?? gate)?.confidenceCap} rationale={brief?.draft.confidence.rationale} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 500 }}>{preview.headline}</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <ProvenanceBadge kind={preview.dataMode} title="Weakest input mode across all evidence" />
            <span className="be-badge be-badge-historical">MODEL: {preview.synthesis.mode}</span>
            {/* a Brief exists only because the gate published it: the decision is shown before purchase, not after */}
            <PublicationGateResult gate={brief?.gate ?? gate} compact />
            {withdrawn && <span className="be-badge" style={{ color: "var(--invalid)", borderColor: "var(--invalid)" }} data-testid="withdrawn-badge">WITHDRAWN · issuer {withdrawn.reason === "CANCELLED" ? "cancelled" : "replaced"} the action</span>}
          </div>
        </div>
      </div>
      <div className="be-doc">
        {!unlocked && signal && <PaidValue signal={signal} preview={preview} />}
        {!unlocked && purchase}
        {signal && <EventTimes signal={signal} publishedAt={preview.publishedAt} now={now} withdrawn={withdrawn} brief={brief} />}
        {!unlocked && signal && <BalanceIllustration signal={signal} />}
        <section><h2>{SECTIONS[0]}</h2>{brief ? <Claims claims={brief.draft.whatHappened} onOpen={openEvidence} /> : <p style={{ color: "var(--ink-secondary)" }}>{preview.evidenceCount} evidence items · {preview.unknownCount} unknowns · {preview.conflictCount} conflicts. The findings unlock on purchase.</p>}</section>
        {unlocked ? (
          <>
            <section><h2>{SECTIONS[1]}</h2><Claims claims={brief.draft.whyItMayMatter} onOpen={openEvidence} /></section>
            <section><h2>{SECTIONS[2]}</h2><Claims claims={brief.draft.onchainObservations} onOpen={openEvidence} /></section>
            <section><h2>{SECTIONS[3]}</h2><ol style={{ margin: 0, paddingLeft: 20 }}>{brief.evidence.map((e) => (
              <li key={e.id}><button type="button" className="mono" style={{ ...chipButton, border: 0, padding: 0, color: "var(--ink)", textDecoration: "underline" }} data-testid="evidence-row" data-evidence-id={e.id} onClick={() => openEvidence(e.id, null)}>{e.id}</button> · <Enum value={e.kind} /> · <ProvenanceBadge kind={e.provenance.mode} /> · fetched <Timestamp iso={e.provenance.fetchedAt} /></li>
            ))}</ol></section>
            <section><h2>{SECTIONS[4]}</h2><p><span className="mono" style={{ color: brief.draft.confidence.level === "HIGH" ? "var(--verified)" : "var(--uncertain)" }}>{brief.draft.confidence.level}</span> — {brief.draft.confidence.rationale} Gate cap: {brief.gate.confidenceCap}.</p></section>
            <section><UnknownsPanel title="Unknowns" unknowns={brief.draft.unknowns} /></section>
            <section><UnknownsPanel title="Conflicts" conflicts={brief.draft.conflicts} checks={brief.checks} /></section>
            <section><h2>{SECTIONS[7]}</h2><ol style={{ margin: 0, paddingLeft: 20 }}>{brief.draft.limitations.map((l, i) => <li key={i}>{l}</li>)}</ol></section>
            <p style={{ fontSize: 13, lineHeight: "18px", color: "var(--ink-secondary)", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              {brief.disclaimer}<br /><span className="mono" style={{ fontSize: 11 }}>JSON · {brief.schema} · sha256 <Id value={brief.contentHash} keep={6} /></span>
            </p>
            {envelope && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="be-btn" type="button" onClick={() => download(envelope)} data-testid="download-json">Download JSON</button>
                <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}>The delivery exactly as an agent receives it: the Brief, the quoted terms and the payment evidence. It contains no key, signature or claim token.</span>
              </div>
            )}
          </>
        ) : (
          <>
            {SECTIONS.slice(1).map((s) => <section key={s} aria-hidden="true"><h2 style={{ color: "var(--ink-muted)" }}>{s}</h2></section>)}
          </>
        )}
      </div>
      <div style={{ position: "fixed", right: 24, top: 24, zIndex: 10 }}>
        <EvidenceDrawer item={open?.item ?? null} now={now} onClose={() => setOpen(null)} highlightKey={open?.key ?? null} index={open && brief ? { n: brief.evidence.indexOf(open.item) + 1, total: brief.evidence.length } : undefined} />
      </div>
    </>
  );
}
