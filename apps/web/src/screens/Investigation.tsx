import { useState } from "react";
import type { Brief, EvidenceItem, SignalEvent } from "@bullseye/domain";
import type { InvestigationResponse } from "../lib/api";
import { InvestigationTimeline } from "../components/InvestigationTimeline";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { PublicationGateResult } from "../components/PublicationGateResult";
import { Timestamp } from "../primitives/Timestamp";

export interface InvestigationProps { signal: SignalEvent; data: InvestigationResponse | null; brief: Brief | null; now: Date }

/** Stage INVESTIGATE: header, budget, timeline; EVIDENCE rows open the drawer. */
export function Investigation({ signal, data, brief, now }: InvestigationProps) {
  const [open, setOpen] = useState<EvidenceItem | null>(null);
  const evidence = brief?.evidence ?? [];
  return (
    <>
      <span className="be-stage">Investigation{data ? <> · {data.investigation.id} · {signal.asset.symbol}</> : null}</span>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 500 }}>{signal.headline}</h2>
        <span className="mono" style={{ fontSize: 13, color: "var(--ink-secondary)" }}>{signal.asset.symbol} · Detected <Timestamp iso={signal.detectedAt} /></span>
      </div>
      {!data ? (
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>Fetching…</span>
      ) : (
        <>
          <InvestigationTimeline view={data.investigation} usage={data.usage} budget={data.budget} now={now}
            onOpenEvidence={(id) => setOpen(evidence.find((e) => e.id === id) ?? null)} />
          {data.investigation.status !== "RUNNING" && <PublicationGateResult gate={data.investigation.gate} briefId={data.investigation.briefId} />}
        </>
      )}
      <div style={{ position: "fixed", right: 24, top: 24, zIndex: 10 }}>
        <EvidenceDrawer item={open} now={now} onClose={() => setOpen(null)} index={open ? { n: evidence.indexOf(open) + 1, total: evidence.length } : undefined} />
      </div>
    </>
  );
}
