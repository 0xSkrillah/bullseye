import type { KeyboardEvent } from "react";
import type { SignalEvent } from "@bullseye/domain";
import { humaniseCategory } from "../format";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Timestamp } from "../primitives/Timestamp";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface SignalCardProps {
  signal: SignalEvent;
  locked?: boolean;
  noise?: boolean;
  onLock?(id: string): void;
}

const NETWORK_NAME = { XLayer: "X Layer" } as const satisfies Record<SignalEvent["asset"]["network"], string>;

export function SignalCard({ signal, locked = false, noise = false, onLock }: SignalCardProps) {
  const lock = () => onLock?.(signal.id);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      lock();
    }
  };

  return (
    <article
      className={`be-card${locked ? " is-locked" : ""}${noise ? " is-noise" : ""}`}
      role="button"
      aria-pressed={locked}
      tabIndex={0}
      data-testid="signal-card"
      data-signal-id={signal.id}
      data-locked={locked}
      onClick={lock}
      onKeyDown={onKeyDown}
    >
      <div className="be-card-head">
        <span className="be-stage">{humaniseCategory(signal.category)}</span>
        {locked && <span className="be-locked-mark">▸ LOCKED</span>}
        {noise && !locked && (
          <span className="mono" style={{ fontSize: 11 }}>
            Not investigated
          </span>
        )}
      </div>
      <h3 className="be-card-title">{signal.headline}</h3>
      <div className="be-card-meta">
        <span className="mono">
          {signal.asset.symbol} · {signal.asset.name} · {NETWORK_NAME[signal.asset.network]}
        </span>
        <span className="mono">
          Detected <Timestamp iso={signal.detectedAt} /> · Observed <Timestamp iso={signal.observedAt} />
        </span>
      </div>
      <p className="be-card-reason" style={{ margin: 0 }}>
        {signal.reasonFlagged}
      </p>
      <div className="be-card-meta">
        <span className="mono" style={{ fontSize: 11 }}>
          CA {signal.facts.corporateActionId} v{signal.facts.corporateActionVersion} · <Enum mono value={signal.facts.caType} /> · <Enum mono value={signal.facts.status} /> ·{" "}
          <Id value={signal.id} />
        </span>
      </div>
      <div className="be-card-meta">
        <ProvenanceBadge kind={signal.provenance.mode} />
      </div>
    </article>
  );
}
