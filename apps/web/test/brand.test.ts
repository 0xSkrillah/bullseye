import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EconomicsReceipt as Receipt, Order } from "@bullseye/domain";
import { Money } from "../src/primitives/Money";
import { ProvenanceBadge } from "../src/components/ProvenanceBadge";
import { PaymentState, UNKNOWN_SENTENCE } from "../src/components/PaymentState";
import { EconomicsReceipt } from "../src/components/EconomicsReceipt";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const terms: Order["terms"] = {
  briefId: "brf_0123456789abcdef", briefContentHash: "a".repeat(64), priceUsd: "3.00", amount: "3000000", asset: "0x" + "1".repeat(40), assetName: "USDC", assetDecimals: 6,
  network: "eip155:1952", payTo: "0x" + "2".repeat(40), scheme: "exact", maxTimeoutSeconds: 300, extra: {}, rail: "OKX_X402_TESTNET",
  resource: "http://localhost:4402/api/v1/briefs/brf_0123456789abcdef", issuedAt: "2026-09-18T09:43:50Z", expiresAt: "2026-09-18T09:59:00Z",
};

const order = (state: Order["state"], events: Order["events"]): Order => ({
  id: "ord_0123456789abcdef", quoteId: "quo_0123456789abcdef", termsHash: "b".repeat(64), terms, state, paymentKey: "c".repeat(64), payment: null, deliveryCount: 0,
  createdAt: "2026-09-18T09:43:50Z", updatedAt: "2026-09-18T09:45:32Z", events,
});

describe("brand rules the UI cannot break", () => {
  it("1. an estimated amount is never green and always says estimated", () => {
    const html = render(createElement(Money, { usd: 2.47, basis: "ESTIMATED" }));
    expect(html).not.toContain("var(--verified)");
    expect(html).toContain("estimated");
    expect(html).toContain("≈");
  });

  it("2. every provenance badge renders its word, not only a dot", () => {
    for (const kind of ["LIVE", "CACHED", "HISTORICAL", "FIXTURE", "STALE", "TESTNET"] as const) {
      expect(render(createElement(ProvenanceBadge, { kind }))).toContain(`${kind}<`);
    }
  });

  it("3. PAYMENT_UNKNOWN says the double-charge promise verbatim and offers no pay-again", () => {
    const o = order("PAYMENT_UNKNOWN", [
      { seq: 1, at: "2026-09-18T09:43:50Z", from: null, to: "QUOTED", reason: "quote issued" },
      { seq: 2, at: "2026-09-18T09:44:02Z", from: "QUOTED", to: "PAYMENT_PENDING", reason: "authorization received" },
      { seq: 3, at: "2026-09-18T09:45:32Z", from: "PAYMENT_PENDING", to: "PAYMENT_UNKNOWN", reason: "facilitator timeout" },
    ]);
    const html = render(createElement(PaymentState, { order: o, onReconcile: () => undefined }));
    expect(html).toContain(UNKNOWN_SENTENCE);
    expect(html).toContain("Reconcile from chain");
    expect(html.toLowerCase()).not.toContain("pay again");
  });

  it("4. the receipt never sums measured and estimated under one total", () => {
    const r: Receipt = {
      orderId: "ord_0123456789abcdef", briefId: "brf_0123456789abcdef", rail: "OKX_X402_TESTNET", priceUsd: 3, countsAsRevenue: false, revenueNote: "Not revenue (testnet).",
      usage: { modelCalls: 2, toolCalls: 7, inputTokens: 3611, outputTokens: 1204, investigationLatencyMs: 41200, usageIsFixture: false },
      measuredCosts: [{ label: "Claude synthesis", amountUsd: 0.0142, basis: "MEASURED", detail: "MEASURED_USAGE_AT_LIST_PRICE" }],
      estimatedCosts: [{ label: "Payment fee reserve", amountUsd: 0.15, basis: "ESTIMATED", detail: "planning allowance" }],
      measuredTotalUsd: 0.0142, estimatedTotalUsd: 0.15, estimatedContributionUsd: 2.8358, contributionNote: "Price − measured − estimated. Not profit.",
    };
    const html = render(createElement(EconomicsReceipt, { receipt: r, state: "DELIVERED", paidAt: "2026-09-18T09:44:47Z" }));
    expect(html).toContain("Measured total");
    expect(html).toContain("Estimated total");
    expect(html).not.toMatch(/>Total</);
    expect(html).not.toMatch(/Net|Profit|Margin/);
    expect(html).toContain("TESTNET");
    expect(html).toContain("Not revenue");
  });

  it("5. a PAID price is green only when chain-verified; the same price unpaid is ink", () => {
    expect(render(createElement(Money, { usd: "3.00", basis: "PRICE", realised: true }))).toContain("var(--verified)");
    expect(render(createElement(Money, { usd: "3.00", basis: "PRICE", realised: false }))).not.toContain("var(--verified)");
  });
});
