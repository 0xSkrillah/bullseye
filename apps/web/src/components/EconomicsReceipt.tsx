import { useId, type ReactNode } from "react";
import type { CostLine, EconomicsReceipt as Receipt, OrderState } from "@bullseye/domain";
import { formatCount, seconds } from "../format";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";
import { isPaidOrLater } from "./PaymentState";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface EconomicsReceiptProps {
  receipt: Receipt;
  state: OrderState;
  /** instant the order entered PAID, from its event trail */
  paidAt?: string;
  /** CAIP-2 id printed beside the rail */
  network?: string;
  /** Order.payment.chainVerified. The price stays ink without it, whatever the state. */
  chainVerified?: boolean;
}

function CostRow({ line }: { line: CostLine }) {
  const estimated = line.basis === "ESTIMATED";
  return (
    <tr className={estimated ? "estimate" : undefined}>
      <td className="sub" style={estimated ? { color: "var(--uncertain)" } : undefined}>
        {line.label}{" "}
        <span className="fn">
          {estimated ? "· estimated " : ""}· {line.detail}
        </span>
      </td>
      <td>
        <Money usd={line.amountUsd} basis={line.basis} />
      </td>
    </tr>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <tr className="section">
      <td colSpan={2} style={{ textAlign: "left" }}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Five sections, each with its own heading. Measured and estimated amounts are
 * never added together anywhere in this table.
 */
export function EconomicsReceipt({ receipt, state, paidAt, network, chainVerified = false }: EconomicsReceiptProps) {
  const headingId = useId();
  const noteId = useId();
  const paid = isPaidOrLater(state);
  const notRevenue = receipt.rail !== "OKX_X402_MAINNET";
  const measured = receipt.measuredCosts.filter((l) => l.basis === "MEASURED");
  const estimated = receipt.estimatedCosts.filter((l) => l.basis === "ESTIMATED");

  return (
    <section className="be-receipt" aria-labelledby={headingId} data-testid="receipt" data-order-id={receipt.orderId} data-state={state}>
      <div className="be-receipt-head">
        <h3 className="be-receipt-title" id={headingId}>
          Receipt · {paid ? "" : "pending · "}
          <Id value={receipt.orderId} short /> · <Id value={receipt.briefId} short />
        </h3>
        {paid && (
          <span className="be-stamp">
            ✓ PAID{paidAt ? <> <Timestamp iso={paidAt} /></> : ""}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
          <Enum value={receipt.rail} />
          {network ? ` · ${network}` : ""}
        </span>
        {receipt.rail === "FIXTURE" && <ProvenanceBadge kind="FIXTURE" title="Fixture rail: no funds move on any chain." />}
        {notRevenue && <ProvenanceBadge kind="TESTNET" title={receipt.rail === "FIXTURE" ? "Fixture rail. Not revenue." : undefined} />}
        {notRevenue && <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}>Not revenue.</span>}
      </div>

      <table>
        <tbody>
          <Section>Price</Section>
          <tr className="total">
            <td>
              {paid ? "Price paid" : "Price quoted"}
              {!receipt.countsAsRevenue && (
                <span className="fn" data-testid="receipt-revenue-note">
                  {" "}
                  · {receipt.revenueNote}
                </span>
              )}
            </td>
            <td>
              <Money usd={receipt.priceUsd} basis="PRICE" realised={paid && chainVerified} />
            </td>
          </tr>
        </tbody>

        <tbody>
          <Section>Measured usage {receipt.usage.usageIsFixture && <ProvenanceBadge kind="FIXTURE" title="Usage came from a test double." />}</Section>
          <tr>
            <td className="sub">Model calls</td>
            <td>{formatCount(receipt.usage.modelCalls)}</td>
          </tr>
          <tr>
            <td className="sub">Tool calls</td>
            <td>{formatCount(receipt.usage.toolCalls)}</td>
          </tr>
          <tr>
            <td className="sub">Input tokens</td>
            <td>{formatCount(receipt.usage.inputTokens)}</td>
          </tr>
          <tr>
            <td className="sub">Output tokens</td>
            <td>{formatCount(receipt.usage.outputTokens)}</td>
          </tr>
          <tr>
            <td className="sub">Investigation latency</td>
            <td>{seconds(receipt.usage.investigationLatencyMs)} s</td>
          </tr>
          <tr>
            <td className="sub">Usage is fixture</td>
            <td>{receipt.usage.usageIsFixture ? "yes" : "no"}</td>
          </tr>
        </tbody>

        <tbody data-testid="receipt-measured">
          <Section>Measured costs</Section>
          {measured.length === 0 && (
            <tr>
              <td className="sub" colSpan={2} style={{ textAlign: "left" }}>
                No measured cost lines for this order.
              </td>
            </tr>
          )}
          {measured.map((line) => (
            <CostRow key={line.label} line={line} />
          ))}
          <tr className="total">
            <td>Measured total</td>
            <td>
              <Money usd={receipt.measuredTotalUsd} basis="MEASURED" />
            </td>
          </tr>
        </tbody>

        <tbody data-testid="receipt-estimated">
          <Section>Estimated costs</Section>
          {estimated.map((line) => (
            <CostRow key={line.label} line={line} />
          ))}
          <tr className="estimate total">
            <td>Estimated total</td>
            <td>
              <Money usd={receipt.estimatedTotalUsd} basis="ESTIMATED" />
            </td>
          </tr>
        </tbody>

        {paid && (
          <tbody data-testid="receipt-contribution">
            <Section>Estimated contribution</Section>
            <tr className="estimate total" aria-describedby={noteId}>
              <td>
                Contribution <span className="fn">· estimated</span>{" "}
                {receipt.usage.usageIsFixture && <ProvenanceBadge kind="FIXTURE" title="Usage came from a test double; this estimate rests on fixture usage." />}
              </td>
              <td className="numeral" style={{ fontSize: 18 }}>
                <Money usd={receipt.estimatedContributionUsd} basis="ESTIMATED" />
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="fn" id={noteId} style={{ border: 0, paddingTop: 4, textAlign: "left" }}>
                {receipt.contributionNote}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </section>
  );
}
