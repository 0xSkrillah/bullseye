import type { ReactNode } from "react";
import { ORDER_TRANSITIONS, type Order, type OrderEvent, type OrderState } from "@bullseye/domain";
import { formatCount } from "../format";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";

export interface PaymentStateProps {
  order: Order;
  onReconcile?(): void;
  reconciling?: boolean;
}

/** PAYMENT_UNKNOWN, word for word from guidelines/20-copy.md. Rendered as one text node so it can be asserted whole. */
export const UNKNOWN_SENTENCE =
  "No answer from facilitator after 90 s. Neither success nor failure. Bullseye will not deliver until the chain confirms. A retry cannot charge you twice.";

const GLYPH = {
  QUOTED: "○",
  PAYMENT_PENDING: "◐",
  PAYMENT_UNKNOWN: "?",
  RECONCILIATION_REQUIRED: "⟳",
  PAYMENT_FAILED: "✕",
  PAID: "✓",
  DELIVERING: "→",
  DELIVERY_FAILED: "✕",
  DELIVERED: "✓",
} as const satisfies Record<OrderState, string>;

/** The ladder is the first legal move out of each state, starting at QUOTED. */
function happyPath(): OrderState[] {
  const path: OrderState[] = ["QUOTED"];
  for (let next = ORDER_TRANSITIONS.QUOTED[0]; next && !path.includes(next); next = ORDER_TRANSITIONS[next][0]) path.push(next);
  return path;
}

const LADDER = happyPath();
const STOPS_AT: Partial<Record<OrderState, { step: OrderState; tone: "warn" | "bad" }>> = {
  PAYMENT_PENDING: { step: "PAYMENT_PENDING", tone: "warn" },
  PAYMENT_UNKNOWN: { step: "PAYMENT_PENDING", tone: "warn" },
  RECONCILIATION_REQUIRED: { step: "PAYMENT_PENDING", tone: "warn" },
  PAYMENT_FAILED: { step: "PAYMENT_PENDING", tone: "bad" },
  DELIVERY_FAILED: { step: "DELIVERING", tone: "bad" },
};

export function isPaidOrLater(state: OrderState): boolean {
  return state === "PAID" || state === "DELIVERING" || state === "DELIVERED" || state === "DELIVERY_FAILED";
}

/** Green needs both: the ledger says PAID or later, and an independent chain read confirmed the transfer. */
export function isRealised(order: Pick<Order, "state" | "payment">): boolean {
  return isPaidOrLater(order.state) && order.payment?.chainVerified === true;
}

function lineText(order: Order, event: OrderEvent, current: boolean): ReactNode {
  const p = order.payment;
  switch (event.to) {
    case "QUOTED":
      return (
        <>
          Quote <Id value={order.quoteId} /> issued <Timestamp iso={order.terms.issuedAt} /> · <Money usd={order.terms.priceUsd} basis="PRICE" rail={order.terms.rail} realised={isRealised(order)} />
        </>
      );
    case "PAYMENT_PENDING":
      return (
        <>
          Authorization received <Timestamp iso={event.at} />
          {current ? " · awaiting facilitator settlement" : ""}
          {order.paymentKey && (
            <>
              {" "}
              · paymentKey <Id value={order.paymentKey} />
            </>
          )}
        </>
      );
    case "PAYMENT_UNKNOWN":
      return UNKNOWN_SENTENCE;
    case "RECONCILIATION_REQUIRED":
      return (
        <>
          Reading X Layer for {p?.txHash ? <>tx <Id value={p.txHash} /></> : "the signed authorization"}
          {p?.chainCheckedAt && (
            <>
              {" "}
              · checked <Timestamp iso={p.chainCheckedAt} />
            </>
          )}
        </>
      );
    case "PAYMENT_FAILED":
      return (
        <>
          Payment failed: {event.reason}. <b>Nothing delivered. Nothing charged.</b>
        </>
      );
    case "PAID":
      return (
        <>
          Paid <Timestamp iso={event.at} />
          {p?.txHash && (
            <>
              {" "}
              · tx <b><Id value={p.txHash} /></b>
            </>
          )}
          {p?.chainVerified ? (
            <> · chain-verified{p.chainBlockNumber !== null ? <> at block <b>{formatCount(p.chainBlockNumber)}</b></> : ""}</>
          ) : (
            <> · facilitator: {p?.facilitatorStatus ?? "no status"} · not yet chain-verified</>
          )}
        </>
      );
    case "DELIVERING":
      return (
        <>
          Delivering Brief <Id value={order.terms.briefId} /> (attempt {order.events.filter((e) => e.to === "DELIVERING" && e.seq <= event.seq).length})
        </>
      );
    case "DELIVERY_FAILED":
      return <>Delivery failed: {event.reason}. Payment stands; delivery will be retried.</>;
    case "DELIVERED":
      return (
        <>
          Brief delivered <Timestamp iso={event.at} /> · sha256 matches quote terms
        </>
      );
  }
}

function Line({ order, event, current }: { order: Order; event: OrderEvent; current: boolean }) {
  // PAID without a chain read keeps the state's name but not its green
  const unverified = event.to === "PAID" && !order.payment?.chainVerified;
  const pulse = current && event.to === "PAYMENT_UNKNOWN";
  const nameStyle = unverified ? { color: "var(--uncertain)" } : undefined;
  return (
    <div className={`be-pay-line be-pay-${event.to.toLowerCase()}`}>
      <span className={`name${pulse ? " be-pulse" : ""}`} style={nameStyle} aria-hidden="true">
        {GLYPH[event.to]}
      </span>
      <span>
        <span className="name" style={nameStyle}>
          {event.to}
        </span>
        <br />
        <span className="txt">{lineText(order, event, current)}</span>
      </span>
    </div>
  );
}

const evidenceList = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2, fontSize: 11, lineHeight: "16px", color: "var(--ink-secondary)" } as const;

export function PaymentState({ order, onReconcile, reconciling = false }: PaymentStateProps) {
  // one line per state reached; a state entered twice keeps its latest event
  const latest = new Map<OrderState, OrderEvent>();
  for (const e of order.events) latest.set(e.to, e);
  const reached = [...latest.values()].sort((a, b) => a.seq - b.seq);

  const stop = STOPS_AT[order.state];
  const canReconcile = order.state === "PAYMENT_UNKNOWN" || order.state === "RECONCILIATION_REQUIRED";
  const p = order.payment;

  return (
    <section className="be-pay" role="status" aria-live="polite" data-testid="payment-state" data-state={order.state} data-order-id={order.id} data-chain-verified={p?.chainVerified === true}>
      <span className="be-stage">
        Order · <Id value={order.id} short /> · <Enum value={order.state} />
      </span>
      <div className="be-pay-steps" aria-hidden="true">
        {LADDER.map((step) => {
          let cls = "";
          if (stop && stop.step === step) cls = stop.tone;
          else if (latest.has(step)) cls = step === "DELIVERED" || (step === "PAID" && p?.chainVerified) ? "ok" : "done";
          return <span key={step} className={cls || undefined} />;
        })}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {reached.map((e) => (
          <Line key={e.to} order={order} event={e} current={e.to === order.state} />
        ))}
      </div>

      {p && (
        <ul className="mono" style={evidenceList}>
          <li>Facilitator: {p.facilitatorStatus ?? "no status"}</li>
          <li>Chain verified: {p.chainVerified ? "yes" : "no"}</li>
          {p.payer && (
            <li>
              Payer: <Id value={p.payer} />
            </li>
          )}
          {p.note && <li>{p.note}</li>}
          {p.explorerUrl && (
            <li>
              <a href={p.explorerUrl} target="_blank" rel="noreferrer noopener">
                Explorer ↗
              </a>
            </li>
          )}
        </ul>
      )}

      {canReconcile && onReconcile && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="be-btn" type="button" onClick={onReconcile} disabled={reconciling} data-testid="reconcile-button">
            Reconcile from chain
          </button>
          {reconciling && (
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
              Fetching…
            </span>
          )}
        </div>
      )}

      <ul className="be-pay-events">
        {order.events.map((e) => (
          <li key={e.seq}>
            <Timestamp iso={e.at} /> · {e.from ?? "—"} → <b>{e.to}</b> · {e.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
