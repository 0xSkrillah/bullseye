import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefPaywall } from "../components/BriefPaywall";
import { EconomicsReceipt } from "../components/EconomicsReceipt";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { InvestigationTimeline } from "../components/InvestigationTimeline";
import { PaymentState } from "../components/PaymentState";
import { ProvenanceBadge, type BadgeKind } from "../components/ProvenanceBadge";
import { PublicationGateResult } from "../components/PublicationGateResult";
import { RadarField } from "../components/RadarField";
import { SignalCard } from "../components/SignalCard";
import { Id } from "../primitives/Id";
import { Money } from "../primitives/Money";
import { budget, evidence, gate, order, payment, quote, receipt, signal, usage, view } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const beforeExpiry = new Date("2026-09-18T09:50:00Z");
const afterExpiry = new Date("2026-09-18T10:00:00Z");

describe("primitives", () => {
  it("Id keeps n characters after the prefix and the whole value in the title", () => {
    expect(renderToStaticMarkup(<Id value="brf_0123456789abcdef" keep={6} />)).toContain(">brf_012345…cdef<");
    expect(renderToStaticMarkup(<Id value={"ab".repeat(32)} keep={6} />)).toContain(`title="${"ab".repeat(32)}"`);
  });

  it("Money tags a testnet or fixture price and never an amount on the mainnet rail", () => {
    for (const rail of ["OKX_X402_TESTNET", "FIXTURE"] as const) {
      const html = renderToStaticMarkup(<Money usd="3.00" basis="PRICE" rail={rail} />);
      expect(html).toContain("TESTNET<");
      expect(html).toContain("Not revenue.");
    }
    expect(renderToStaticMarkup(<Money usd="3.00" basis="PRICE" rail="OKX_X402_MAINNET" />)).not.toContain("TESTNET");
  });

  it("ProvenanceBadge renders nothing for a kind outside the six", () => {
    expect(renderToStaticMarkup(<ProvenanceBadge kind={"SOMETHING_ELSE" as BadgeKind} />)).toBe("");
  });
});

describe("SignalCard", () => {
  it("carries its id and reports a lock", () => {
    const onLock = vi.fn();
    render(<SignalCard signal={signal} locked={false} noise={false} onLock={onLock} />);
    const card = screen.getByTestId("signal-card");
    expect(card.getAttribute("data-signal-id")).toBe(signal.id);
    fireEvent.click(card);
    expect(onLock).toHaveBeenCalledWith(signal.id);
  });
});

describe("InvestigationTimeline", () => {
  it("renders one row per TimelineEntry from the usage summary and opens evidence by id", () => {
    const onOpen = vi.fn();
    render(<InvestigationTimeline view={view} usage={usage} budget={budget} now={new Date("2026-09-18T09:42:00Z")} onOpenEvidence={onOpen} />);
    const rows = screen.getAllByTestId("timeline-row");
    expect(rows.map((r) => r.getAttribute("data-type"))).toEqual(["STARTED", "EVIDENCE"]);
    expect(screen.getByTestId("timeline").textContent).not.toMatch(/\b(I|We) think\b/);
    fireEvent.click(rows[0]!);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(rows[1]!);
    expect(onOpen).toHaveBeenCalledWith("EV-CA-RECORD");
  });
});

describe("EvidenceDrawer", () => {
  it("is closed when it has no item", () => {
    expect(renderToStaticMarkup(<EvidenceDrawer item={null} now={beforeExpiry} onClose={() => undefined} />)).toBe("");
  });

  it("marks an item past staleAfter", () => {
    render(<EvidenceDrawer item={evidence} now={new Date("2026-09-18T11:00:00Z")} onClose={() => undefined} index={{ n: 1, total: 1 }} />);
    expect(screen.getByTestId("evidence-drawer").textContent).toContain("STALE");
  });
});

describe("PublicationGateResult", () => {
  it("prints findings in schema order and accepts a null briefId", () => {
    render(<PublicationGateResult gate={gate} briefId={null} />);
    const el = screen.getByTestId("gate-result");
    expect(el.getAttribute("data-decision")).toBe("PUBLISH");
    expect([...el.querySelectorAll("li")].map((li) => li.getAttribute("data-rule"))).toEqual(["SCHEMA", "EVIDENCE_FRESH"]);
  });
});

describe("BriefPaywall", () => {
  it("shows the frozen terms, the full hash in the title, and one pay action", () => {
    const onPay = vi.fn();
    render(<BriefPaywall quote={quote} now={beforeExpiry} paying={false} onPay={onPay} onViewEvidence={() => undefined} onRequote={() => undefined} />);
    expect(screen.getByTestId("quote-price").textContent).toBe("$3.00");
    expect(screen.getByTestId("quote-terms-hash").getAttribute("title")).toBe(quote.termsHash);
    expect(screen.getByTestId("paywall").textContent).toContain("TESTNET");
    fireEvent.click(screen.getByTestId("pay-button"));
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it("withholds the pay action while paying and after expiry", () => {
    const { rerender } = render(<BriefPaywall quote={quote} now={beforeExpiry} paying onPay={() => undefined} />);
    expect((screen.getByTestId("pay-button") as HTMLButtonElement).disabled).toBe(true);
    rerender(<BriefPaywall quote={quote} now={afterExpiry} paying={false} onPay={() => undefined} />);
    expect(screen.queryByTestId("pay-button")).toBeNull();
    expect(screen.getByTestId("paywall").textContent).toContain("Request new quote");
  });
});

describe("PaymentState", () => {
  it("keeps a PAID price in ink until the chain has confirmed it", () => {
    expect(renderToStaticMarkup(<PaymentState order={order("PAID", payment(false))} />)).not.toContain("var(--verified)");
    expect(renderToStaticMarkup(<PaymentState order={order("PAID", payment(true))} />)).toContain("var(--verified)");
  });

  it("offers reconcile only where the outcome is not known", () => {
    const onReconcile = vi.fn();
    const { rerender } = render(<PaymentState order={order("PAYMENT_UNKNOWN", null)} onReconcile={onReconcile} />);
    expect(screen.getByTestId("payment-state").getAttribute("data-state")).toBe("PAYMENT_UNKNOWN");
    fireEvent.click(screen.getByTestId("reconcile-button"));
    expect(onReconcile).toHaveBeenCalledTimes(1);
    rerender(<PaymentState order={order("PAID", payment(true))} onReconcile={onReconcile} />);
    expect(screen.queryByTestId("reconcile-button")).toBeNull();
  });
});

describe("EconomicsReceipt", () => {
  it("separates measured from estimated and hides the contribution before PAID", () => {
    const { rerender } = render(<EconomicsReceipt receipt={receipt} state="PAYMENT_PENDING" network="eip155:1952" />);
    expect(screen.getByTestId("receipt-measured").textContent).toContain("Measured total");
    expect(screen.getByTestId("receipt-estimated").textContent).toContain("Estimated total");
    expect(screen.getByTestId("receipt-revenue-note").textContent).toContain(receipt.revenueNote);
    expect(screen.queryByTestId("receipt-contribution")).toBeNull();
    rerender(<EconomicsReceipt receipt={receipt} state="DELIVERED" paidAt="2026-09-18T09:44:47Z" network="eip155:1952" />);
    expect(screen.getByTestId("receipt-contribution").textContent).toContain("estimated");
    expect(screen.getByTestId("receipt").textContent).toContain("Not revenue.");
  });

  it("never prints an estimate in green, and the price only with chain verification", () => {
    expect(renderToStaticMarkup(<EconomicsReceipt receipt={receipt} state="DELIVERED" />)).not.toContain("var(--verified)");
    const verified = renderToStaticMarkup(<EconomicsReceipt receipt={receipt} state="DELIVERED" chainVerified />);
    expect(verified.match(/var\(--verified\)/g)).toHaveLength(1);
  });
});

describe("RadarField", () => {
  it("asks for a lock once the noise has entered, keeps asking until locked, then stops", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const { rerender } = render(<RadarField size={272} noise={3} locked={false} lockAfterMs={300} onLock={onLock} />);
    // one dot per step: each timer is armed by the render the previous one caused
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(70));
    act(() => vi.advanceTimersByTime(250));
    expect(onLock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    expect(onLock).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(onLock).toHaveBeenCalledTimes(2);
    rerender(<RadarField size={160} noise={3} locked lockAfterMs={300} onLock={onLock} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(onLock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("radar").querySelector(".reticle")).not.toBeNull();
  });
});
