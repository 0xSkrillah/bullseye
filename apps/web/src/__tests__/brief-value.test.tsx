import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Brief, BriefPreview, SignalEvent } from "@bullseye/domain";
import { EventTimes, span } from "../components/EventTimes";
import { BalanceIllustration, PaidValue, rebasedBalance } from "../components/PaidValue";
import { BriefScreen } from "../screens/Brief";
import { evidence, gate, signal } from "./fixtures";

afterEach(cleanup);

const now = new Date("2026-09-19T12:00:00Z");
const preview: BriefPreview = {
  id: "brf_0123456789abcdef", headline: "TSTx multiplier change", publishedAt: "2026-09-18T22:01:00Z", dataMode: "HISTORICAL", synthesis: { provider: "fixture", model: "t", mode: "FIXTURE" },
  signalId: signal.id, asset: "TSTx", confidence: "MEDIUM", evidenceCount: 3, evidenceKinds: ["CORPORATE_ACTION_RECORD", "ONCHAIN_MULTIPLIER_BEFORE", "PROOF_OF_RESERVES"], unknownCount: 1, conflictCount: 0, contentHash: "a".repeat(64),
};
// the recorded QSRx case: effective 00:30, first seen 21:58:50 the same day
const lookBack: SignalEvent = { ...signal, observedAt: "2026-09-18T00:30:00Z", detectedAt: "2026-09-18T21:58:50Z", facts: { ...signal.facts, multiplierOld: "1", multiplierNew: "1.0066516577977895", changePct: 0.665166 } };

describe("the times of an event are kept apart", () => {
  it("labels a look back as retrospective and claims no early warning from it", () => {
    render(<EventTimes signal={lookBack} publishedAt={preview.publishedAt} now={now} />);
    expect(screen.getByTestId("event-times").getAttribute("data-retrospective")).toBe("true");
    const lag = screen.getByTestId("detection-lag").textContent ?? "";
    expect(lag).toContain("21 h 29 min after it took effect");
    expect(lag).toMatch(/Retrospective/);
    expect(lag).toMatch(/not an early warning/);
    // fetch freshness has its own row and its own badge; it is never offered as the age of the event
    const text = screen.getByTestId("event-times").textContent ?? "";
    expect(text).toContain("Sources last fetched");
    expect(text).toContain("Issuer effective time");
    expect(text).toContain("Brief published");
  });

  it("does not call an event seen within the hour retrospective", () => {
    render(<EventTimes signal={signal} publishedAt={preview.publishedAt} now={now} />);
    expect(screen.getByTestId("event-times").getAttribute("data-retrospective")).toBe("false");
    expect(screen.getByTestId("detection-lag").textContent).not.toMatch(/Retrospective/);
  });

  it("says when the issuer has voided the action, and that the Brief is withdrawn", () => {
    render(<EventTimes signal={signal} publishedAt={preview.publishedAt} now={now} withdrawn={{ byVersion: 2, reason: "CANCELLED", notedAt: "2026-09-19T08:00:00Z" }} />);
    expect(screen.getByTestId("currentness").textContent).toMatch(/cancelled this action \(v2/);
  });

  it("writes spans a reader can compare", () => {
    expect(span(20_000)).toBe("under a minute");
    expect(span(15 * 60_000)).toBe("15 min");
    expect(span(21 * 3_600_000 + 29 * 60_000)).toBe("21 h 29 min");
    expect(span(3 * 86_400_000 + 5 * 3_600_000)).toBe("3 d 5 h");
  });
});

describe("the case for the paid Brief", () => {
  it("computes the illustration from a stated formula and the issuer's own figures", () => {
    expect(rebasedBalance(100, "1", "1.0066516577977895")).toBe(100.665166);
    expect(rebasedBalance(100, "1.5", "1.5")).toBe(100);
    expect(rebasedBalance(100, "0", "1.1")).toBeNull();
    expect(rebasedBalance(100, "abc", "1.1")).toBeNull();
  });

  it("separates the issuer's notice from what the desk checked, labels the illustration, and gives no advice", () => {
    render(<><PaidValue signal={lookBack} preview={preview} /><BalanceIllustration signal={lookBack} /></>);
    expect(screen.getByTestId("issuer-announcement").textContent).toContain("1.0066516577977895");
    expect(screen.getByTestId("issuer-announcement").textContent).toMatch(/does not say whether, or when/);
    const paid = screen.getByTestId("paid-value").textContent ?? "";
    for (const question of ["Did X Layer apply it?", "When?", "Is the action still current?", "Can you check it yourself?"]) expect(paid).toContain(question);
    const illustration = screen.getByTestId("balance-illustration").textContent ?? "";
    expect(illustration).toContain("100.665166");
    expect(illustration).toMatch(/Illustrative\. Formula: balance × new multiplier ÷ old multiplier/);
    expect(illustration).toMatch(/not an investment return/);
    expect(document.body.textContent).not.toMatch(/\b(buy|sell|profit|undervalued|should)\b/i);
  });
});

describe("the Brief screen", () => {
  const draftClaim = { text: "The issuer moved the multiplier.", evidenceIds: [evidence.id], quantities: [{ label: "new", value: 1.004871, unit: "multiplier", evidenceId: evidence.id, valueKey: "multiplierNew" }] };
  const brief = {
    schema: "bullseye.brief/v1", id: preview.id, investigationId: "inv_x", publishedAt: preview.publishedAt, dataMode: "HISTORICAL", synthesis: preview.synthesis, signal,
    draft: { headline: preview.headline, whatHappened: [draftClaim], whyItMayMatter: [draftClaim], onchainObservations: [draftClaim], confidence: { level: "MEDIUM", rationale: "r" }, unknowns: ["u"], conflicts: [], limitations: ["l"] },
    evidence: [evidence], checks: [], gate, disclaimer: "d", contentHash: "a".repeat(64),
  } as unknown as Brief;
  const base = { preview, signal, quote: null, now, paying: false, onRequestQuote: () => undefined, onPay: () => undefined };

  it("shows the gate's decision before purchase instead of a gate that is still running", () => {
    render(<BriefScreen {...base} gate={gate} brief={null} />);
    expect(screen.getByTestId("gate-chip").getAttribute("data-decision")).toBe(gate.decision);
  });

  it("answers 'View evidence first' with the free index, and keeps values behind the purchase", () => {
    render(<BriefScreen {...base} gate={gate} brief={null} />);
    expect(screen.queryByTestId("evidence-index")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View evidence first" }));
    const index = screen.getByTestId("evidence-index").textContent ?? "";
    expect(index).toMatch(/PROOF.OF.RESERVES/i);
    expect(index).not.toContain("1.004871");
  });

  it("opens the evidence drawer from a claim's evidence id, on the value the claim used, and offers the delivered JSON", () => {
    const envelope = { schema: "bullseye.delivery/v1" as const, orderId: "ord_0123456789abcdef", state: "DELIVERED" as const, quote: { id: "quo_x", termsHash: "b".repeat(64), terms: {} as never }, payment: null, brief };
    render(<BriefScreen {...base} gate={gate} brief={brief} envelope={envelope} />);
    expect(screen.queryByTestId("evidence-drawer")).toBeNull();
    fireEvent.click(screen.getAllByTestId("evidence-link")[0]!);
    expect(screen.getByTestId("evidence-drawer").getAttribute("data-evidence-id")).toBe(evidence.id);
    fireEvent.click(screen.getByTestId("evidence-row"));
    expect(screen.getByTestId("evidence-drawer")).toBeTruthy();
    expect(screen.getByTestId("download-json")).toBeTruthy();
    expect(JSON.stringify(envelope)).not.toMatch(/bullseye-claim|"claim"|payment-signature|paymentSignature/i);
  });

  it("offers no quote and no Pay button for a Brief the issuer's later record has withdrawn", () => {
    render(<BriefScreen {...base} gate={gate} brief={null} withdrawn={{ byVersion: 2, reason: "REPLACED", status: "Corrected", notes: null, notedAt: "2026-09-19T08:00:00Z" }} />);
    expect(screen.getByTestId("withdrawn-notice").textContent).toMatch(/Nothing can be charged/);
    expect(screen.queryByRole("button", { name: "Request quote" })).toBeNull();
  });
});
