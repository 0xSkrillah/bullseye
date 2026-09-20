import type { ReactNode } from "react";
import type { CheckoutIssue, PurchaseRecord } from "../checkout/purchase";
import { networkName } from "../lib/networks";
import { AUTO_CHECKS } from "../checkout/usePurchase";
import { Id } from "../primitives/Id";
import { Timestamp } from "../primitives/Timestamp";

export interface CheckoutNoticeProps {
  record: PurchaseRecord | null;
  issue: CheckoutIssue | null;
  busy: boolean;
  durable: boolean;
  autoChecks: number;
  /** origin an agent buyer would be pointed at */
  origin: string;
  onResume(): void;
  onReconcile(): void;
  onStartOver(): void;
  onDismiss(): void;
}


const SAFE = "Doing this re-sends the authorization you already signed, or reads the order. It cannot charge you twice.";

/** true while a purchase of this Brief is unresolved, so the screen shows this notice instead of asking for a new quote */
export function purchaseIsOpen(record: PurchaseRecord | null): boolean {
  return record !== null && ["SIGNED", "SUBMITTED", "UNKNOWN", "PAID"].includes(record.status);
}

function issueText(issue: CheckoutIssue, record: PurchaseRecord | null, origin: string): ReactNode {
  const network = record ? networkName(record.quote.terms.network) : "the quoted network";
  switch (issue.kind) {
    case "NO_WALLET":
      return (
        <>
          No browser wallet was found, so nothing was signed and nothing was charged. Install an EIP-1193 wallet that has {network} and reload, or buy as an agent:{" "}
          <span className="mono">npm run buy -- {record?.briefId ?? "latest"} --base {origin}</span>. The agent pays the same x402 resource and receives the same JSON.
        </>
      );
    case "WALLET_DECLINED":
      return <>Signature declined in the wallet. Nothing was signed. Nothing charged. Press Pay to be asked again.</>;
    case "WRONG_NETWORK":
      return (
        <>
          {issue.detail} Switch the wallet to {network}
          {record ? <> (chain id {record.quote.terms.network.split(":")[1]})</> : null} and press Pay again.
        </>
      );
    case "WALLET_ERROR":
      return <>{issue.detail}</>;
    case "QUOTE_MISMATCH":
      return <>{issue.detail} Request a new quote before paying.</>;
    case "QUOTE_EXPIRED":
      return <>The quote expired before payment. Nothing was charged. Request a new quote: it carries a new id and its own hash.</>;
    case "INSUFFICIENT_FUNDS":
      return (
        <>
          The wallet does not hold enough {record?.quote.terms.assetName ?? "of the settlement asset"} on {network} ({issue.detail}). Nothing was charged.
        </>
      );
    case "PAYMENT_REJECTED":
      return <>{issue.detail}</>;
    case "WITHDRAWN":
      return <>This Brief was withdrawn from sale: {issue.detail} Nothing was charged.</>;
    case "RATE_LIMITED":
      return <>Too many requests from this address. Nothing new was signed. Try again{issue.retryAfterSeconds ? ` in ${issue.retryAfterSeconds} s` : " in a minute"}.</>;
    case "RAIL_UNAVAILABLE":
      return <>The payment rail is not available: {issue.detail} Nothing was signed.</>;
    case "NO_ANSWER":
      return <>{issue.detail} Do not start a new purchase. {SAFE}</>;
    case "OUTCOME_UNKNOWN":
      return <>The seller submitted the payment and does not know its outcome yet. Neither success nor failure. Nothing is delivered until the chain confirms, and nothing new will be signed.</>;
    case "IN_PROGRESS":
      return <>The seller is still settling this payment. Nothing new will be signed.</>;
    case "CLAIM_REFUSED":
      return <>The seller did not accept this browser's claim token for the order. Nothing new was signed. The order is unchanged; ask the operator to look it up by payer address.</>;
    case "CONTENT_MISMATCH":
      return <>{issue.detail} The payment stands and nothing new will be signed.</>;
    case "UNEXPECTED":
      return <>{issue.detail}</>;
  }
}

function stateText(record: PurchaseRecord): ReactNode {
  switch (record.status) {
    case "SIGNED":
      return <>You signed one authorization for this Brief <Timestamp iso={record.updatedAt} />. It is not known to have been sent.</>;
    case "SUBMITTED":
      return <>The signed authorization was sent <Timestamp iso={record.updatedAt} /> and no answer has been recorded. It may or may not have been paid.</>;
    case "UNKNOWN":
      return <>Order <Id value={record.orderId ?? "unknown"} short />: payment outcome not known. Unknown stays unknown until the chain is read.</>;
    case "PAID":
      return <>Order <Id value={record.orderId ?? "unknown"} short /> is paid. The Brief has not reached this browser yet.</>;
    default:
      return null;
  }
}

/** The buyer's side of a purchase that is not a plain success: what happened, what it cost (usually nothing), and the one safe thing to do next. */
export function CheckoutNotice({ record, issue, busy, durable, autoChecks, origin, onResume, onReconcile, onStartOver, onDismiss }: CheckoutNoticeProps) {
  const open = purchaseIsOpen(record);
  const failed = record?.status === "FAILED";
  if (!open && !issue && !failed && durable) return null;
  const waiting = record?.status === "UNKNOWN";
  const tone = issue && !open && !failed ? "var(--uncertain)" : open ? "var(--uncertain)" : "var(--ink-secondary)";

  return (
    <section className="be-panel" role="status" aria-live="polite" data-testid="checkout-notice" data-status={record?.status ?? "NONE"} data-issue={issue?.kind ?? "NONE"} style={{ padding: 16, display: "grid", gap: 8, borderColor: tone }}>
      <span className="be-stage">{open ? "Purchase in progress" : failed ? "Purchase not completed" : "Purchase"}</span>
      {open && record && <span style={{ fontSize: 13 }}>{stateText(record)}</span>}
      {issue && <span style={{ fontSize: 13, color: "var(--ink-secondary)" }} data-testid="checkout-issue">{issueText(issue, record, origin)}</span>}
      {failed && !issue && record && <span style={{ fontSize: 13, color: "var(--ink-secondary)" }}>{record.detail ?? "The payment did not complete."} Nothing was charged.</span>}
      {!durable && <span style={{ fontSize: 13, color: "var(--uncertain)" }}>This browser is not keeping purchase records (private window or blocked storage). Keep this tab open until the Brief is delivered; a reload would lose the way back to this order.</span>}

      {open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {waiting ? (
            <button className="be-btn" type="button" onClick={onReconcile} disabled={busy} data-testid="buyer-reconcile-button">Check the chain again</button>
          ) : (
            <button className="be-btn be-btn-primary" type="button" onClick={onResume} disabled={busy} data-testid="resume-button">{record?.status === "SIGNED" ? "Send the signed authorization" : record?.status === "PAID" ? "Collect the Brief" : "Check this purchase"}</button>
          )}
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
            {busy ? "Asking the seller…" : waiting ? `checked automatically ${autoChecks} of ${AUTO_CHECKS.max} times` : ""}
          </span>
        </div>
      )}
      {open && <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}>{SAFE}</span>}
      {failed && <div><button className="be-btn" type="button" onClick={onStartOver} data-testid="start-over-button">Start a new purchase</button></div>}
      {!open && !failed && issue && <div><button className="be-btn" type="button" onClick={onDismiss}>Dismiss</button></div>}
    </section>
  );
}
