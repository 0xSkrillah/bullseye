import type { ReactNode } from "react";
import type { Brief as BriefT, BriefPreview, Claim, Quote } from "@bullseye/domain";
import { ConfidenceIndicator } from "../components/ConfidenceIndicator";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { PublicationGateResult } from "../components/PublicationGateResult";
import { UnknownsPanel } from "../components/UnknownsPanel";
import { BriefPaywall } from "../components/BriefPaywall";
import { Timestamp } from "../primitives/Timestamp";
import { Id } from "../primitives/Id";

export interface BriefScreenProps {
  preview: BriefPreview;
  /** the full Brief once delivered (or, in fixture mode, never) */
  brief: BriefT | null;
  quote: Quote | null;
  now: Date;
  paying: boolean;
  /** a purchase of this Brief from this browser is unresolved: no new quote and no Pay button until it is */
  purchaseOpen?: boolean;
  /** what happened to the buyer's purchase and the one safe thing to do next */
  notice?: ReactNode;
  onRequestQuote(): void;
  onPay(): void;
  onViewEvidence(): void;
}

function Claims({ claims }: { claims: Claim[] }) {
  return <>{claims.map((c, i) => (
    <p key={i}>{c.text}<span style={{ display: "inline-flex", gap: 4, marginLeft: 4, verticalAlign: "middle" }}>{c.evidenceIds.map((id) => <span key={id} className="be-chip">{id}</span>)}</span></p>
  ))}</>;
}

const SECTIONS = ["What happened", "Why it may matter", "On-chain observations", "Evidence", "Confidence", "Unknowns", "Conflicts", "Limitations"] as const;

/** Stage VERIFIED INTELLIGENCE. Header and "What happened" are free; the rest sits behind the paywall until delivered. */
export function BriefScreen({ preview, brief, quote, now, paying, purchaseOpen = false, notice = null, onRequestQuote, onPay, onViewEvidence }: BriefScreenProps) {
  const unlocked = brief !== null;
  return (
    <>
      <span className="be-stage">Brief · <Id value={preview.id} keep={6} /> · published <Timestamp iso={preview.publishedAt} /></span>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start", paddingBottom: 24, borderBottom: "1px solid var(--line)" }}>
        <ConfidenceIndicator level={preview.confidence} size={96} cap={brief?.gate.confidenceCap} rationale={brief?.draft.confidence.rationale} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 500 }}>{preview.headline}</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <ProvenanceBadge kind={preview.dataMode} title="Weakest input mode across all evidence" />
            <span className="be-badge be-badge-historical">MODEL: {preview.synthesis.mode}</span>
            <PublicationGateResult gate={brief?.gate ?? null} compact />
          </div>
        </div>
      </div>
      <div className="be-doc">
        <section><h2>{SECTIONS[0]}</h2>{brief ? <Claims claims={brief.draft.whatHappened} /> : <p style={{ color: "var(--ink-secondary)" }}>{preview.evidenceCount} evidence items · {preview.evidenceKinds.join(", ")} · {preview.unknownCount} unknowns · {preview.conflictCount} conflicts. The full text unlocks on purchase.</p>}</section>
        {unlocked ? (
          <>
            <section><h2>{SECTIONS[1]}</h2><Claims claims={brief.draft.whyItMayMatter} /></section>
            <section><h2>{SECTIONS[2]}</h2><Claims claims={brief.draft.onchainObservations} /></section>
            <section><h2>{SECTIONS[3]}</h2><ol style={{ margin: 0, paddingLeft: 20 }}>{brief.evidence.map((e) => <li key={e.id}><span className="mono">{e.id}</span> · {e.kind} · <ProvenanceBadge kind={e.provenance.mode} /></li>)}</ol></section>
            <section><h2>{SECTIONS[4]}</h2><p><span className="mono" style={{ color: brief.draft.confidence.level === "HIGH" ? "var(--verified)" : "var(--uncertain)" }}>{brief.draft.confidence.level}</span> — {brief.draft.confidence.rationale} Gate cap: {brief.gate.confidenceCap}.</p></section>
            <section><UnknownsPanel title="Unknowns" unknowns={brief.draft.unknowns} /></section>
            <section><UnknownsPanel title="Conflicts" conflicts={brief.draft.conflicts} checks={brief.checks} /></section>
            <section><h2>{SECTIONS[7]}</h2><ol style={{ margin: 0, paddingLeft: 20 }}>{brief.draft.limitations.map((l, i) => <li key={i}>{l}</li>)}</ol></section>
            <p style={{ fontSize: 13, lineHeight: "18px", color: "var(--ink-secondary)", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              {brief.disclaimer}<br /><span className="mono" style={{ fontSize: 11 }}>JSON · {brief.schema} · sha256 <Id value={brief.contentHash} keep={6} /></span>
            </p>
          </>
        ) : (
          <>
            {SECTIONS.slice(1).map((s) => <section key={s} aria-hidden="true"><h2 style={{ color: "var(--ink-muted)" }}>{s}</h2></section>)}
            <div className="be-doc-locked" style={{ top: 96 }}>
              {purchaseOpen ? null : quote ? (
                <BriefPaywall quote={quote} now={now} paying={paying} onPay={onPay} onViewEvidence={onViewEvidence} onRequote={onRequestQuote} />
              ) : (
                <section className="be-paywall" role="dialog" aria-label="Request a quote">
                  <span className="be-stage">Purchase</span>
                  <p>Request an immutable quote for this Brief. The terms are hashed and cannot change after you approve.</p>
                  <div><button className="be-btn be-btn-primary" type="button" onClick={onRequestQuote}>Request quote</button></div>
                </section>
              )}
              {notice}
            </div>
          </>
        )}
      </div>
    </>
  );
}
