import type { OrderRow, Health } from "../lib/api";
import { PaymentState } from "../components/PaymentState";
import { EconomicsReceipt } from "../components/EconomicsReceipt";
import { PublicationGateResult } from "../components/PublicationGateResult";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { Money } from "../primitives/Money";
import type { GateResult } from "@bullseye/domain";

export interface ConsoleProps { health: Health | null; order: OrderRow | null; gate: GateResult | null; briefId: string | null; challenge: string | null; /** absent when reconciling is not this visitor's to start */ onReconcile?(id: string): void }

/** Stages PURCHASE / DELIVERY / RECONCILIATION: order state, payment evidence, receipt. */
export function Console({ health, order, gate, briefId, challenge, onReconcile }: ConsoleProps) {
  const paidAt = order?.order.events.find((e) => e.to === "PAID")?.at;
  return (
    <>
      <span className="be-stage">Console</span>
      {health && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)", display: "grid", gap: 4 }}>
          <span>Data <ProvenanceBadge kind={health.dataSource.mode} /> · Model {health.synthesis.ready ? "ready" : "not ready"} · {health.synthesis.model}</span>
          <span>Rail {health.paymentRail.rail} · {health.paymentRail.network} · {health.paymentRail.ready ? "ready" : health.paymentRail.detail} {health.paymentRail.isTestnet && <ProvenanceBadge kind="TESTNET" />}</span>
          <span>Price <Money usd={health.priceUsd} basis="PRICE" rail={health.paymentRail.rail} /></span>
        </div>
      )}
      {gate && <PublicationGateResult gate={gate} briefId={briefId} />}
      {challenge && !order && (
        <div className="be-panel" style={{ padding: 16, display: "grid", gap: 8 }}>
          <span className="be-stage">Payment challenge issued</span>
          <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>The paid resource answered 402 with PAYMENT-REQUIRED. Sign it with an x402 wallet or run <span className="mono">npm run buy -- {briefId}</span>; the order appears here as soon as the ledger opens it.</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)", overflowWrap: "anywhere" }} title={challenge}>{challenge.slice(0, 96)}…</span>
        </div>
      )}
      {order ? (
        <>
          <div className="be-panel" style={{ padding: 16 }}><PaymentState order={order.order} onReconcile={onReconcile ? () => onReconcile(order.order.id) : undefined} /></div>
          <EconomicsReceipt receipt={order.receipt} state={order.order.state} paidAt={paidAt} network={order.order.terms.network} />
        </>
      ) : (
        <div className="be-panel be-pay" style={{ padding: 16 }}>
          <span className="be-stage">Order · none yet</span>
          <div className="be-pay-steps" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>Request a quote on the Brief to begin.</span>
        </div>
      )}
    </>
  );
}
