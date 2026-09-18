import { describe, expect, it } from "vitest";
import { Brief } from "@bullseye/domain";
import { investigateFirstSignal, testContainer } from "./helpers.js";
import { buildContainer } from "../src/container.js";
import { openDb } from "../src/db.js";
import { FixtureTransport } from "../src/adapters/transport.js";
import { buildFixtureResponses, FIXTURE_CLOCK } from "../src/adapters/fixtures.js";
import { testConfig } from "./helpers.js";

describe("investigation pipeline (fixture data, fixture synthesis)", () => {
  it("turns a signal into a published, hash-verified Brief labelled FIXTURE", async () => {
    const c = await testContainer();
    const { view } = await investigateFirstSignal(c);
    expect(view.status).toBe("PUBLISHED");
    expect(view.gate?.decision).toBe("PUBLISH");

    const brief = c.briefs.get(view.briefId!)!; // get() re-hashes the stored JSON and throws on mismatch
    expect(Brief.parse(brief).dataMode).toBe("FIXTURE");
    expect(brief.synthesis.mode).toBe("FIXTURE");
    expect(brief.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(["EV-CA", "EV-CHAIN-BEFORE", "EV-CHAIN-AFTER", "EV-CHAIN-LATEST", "EV-POR"]));
    expect(brief.checks.filter((k) => k.status === "FAIL")).toEqual([]);
    for (const claim of [...brief.draft.whatHappened, ...brief.draft.onchainObservations]) {
      for (const q of claim.quantities) expect(brief.evidence.find((e) => e.id === q.evidenceId)!.values[q.valueKey]).toBe(q.value);
    }
  });

  it("does not publish fixture output unless the configuration explicitly allows it", async () => {
    const c = await testContainer({ ALLOW_FIXTURE_PUBLICATION: "false" });
    const { view } = await investigateFirstSignal(c);
    expect(view.status).toBe("REJECTED");
    expect(view.gate!.findings.find((f) => f.rule === "EVIDENCE_MODE_ALLOWED")!.passed).toBe(false);
    expect(c.briefs.list()).toEqual([]);
  });

  it("does not re-investigate a signal that already has a Brief", async () => {
    const c = await testContainer();
    const { signal, view } = await investigateFirstSignal(c);
    const again = c.investigations.start(signal);
    expect(again).toEqual({ investigationId: view.id, created: false });
  });

  it.each([
    ["gives_advice", "NO_INVESTMENT_ADVICE"],
    ["unevidenced_number", "NUMBERS_IN_TEXT_ARE_EVIDENCED"],
    ["skips_mandatory_evidence", "MANDATORY_EVIDENCE_PRESENT"],
  ] as const)("blocks a Brief when the synthesiser %s", async (behaviour, rule) => {
    const c = await testContainer();
    c.setFixtureBehaviour(behaviour);
    const { view } = await investigateFirstSignal(c);
    expect(view.status).toBe("REJECTED");
    expect(view.gate!.findings.filter((f) => !f.passed).map((f) => f.rule)).toContain(rule);
    expect(view.briefId).toBeNull();
    expect(c.briefs.list()).toEqual([]);
  });

  it("stops with MODEL_OUTPUT_INVALID when the model returns malformed JSON", async () => {
    const c = await testContainer();
    c.setFixtureBehaviour("invalid_json");
    const { view } = await investigateFirstSignal(c);
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "MODEL_OUTPUT_INVALID", briefId: null });
  });

  it("publishes a chain/issuer disagreement only as a disclosed conflict with LOW confidence allowed", async () => {
    const c = await testContainer({}, { onchainAfter: "1" });
    c.setFixtureBehaviour("hides_conflict");
    const hidden = await investigateFirstSignal(c);
    expect(hidden.view.status).toBe("REJECTED");
    const rules = hidden.view.gate!.findings.filter((f) => !f.passed).map((f) => f.rule);
    expect(rules).toContain("FAILED_CHECKS_DISCLOSED");
    expect(rules).toContain("CONFIDENCE_WITHIN_CAP");
    expect(hidden.view.gate!.confidenceCap).toBe("LOW");
  });
});

describe("research budget governor", () => {
  it("stops at the tool-call ceiling", async () => {
    const c = await testContainer({ BUDGET_MAX_TOOL_CALLS: "3", BUDGET_MAX_MODEL_CALLS: "50" });
    c.setFixtureBehaviour("never_stops");
    const { view } = await investigateFirstSignal(c);
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "BUDGET_TOOL_CALLS_EXCEEDED", briefId: null });
    expect(c.investigations.usage(view.id).filter((u) => u.kind === "TOOL_CALL")).toHaveLength(3);
  });

  it("stops at the model-call ceiling", async () => {
    const c = await testContainer({ BUDGET_MAX_MODEL_CALLS: "2", BUDGET_MAX_TOOL_CALLS: "50" });
    c.setFixtureBehaviour("never_stops");
    const { view } = await investigateFirstSignal(c);
    expect(view.stopReason).toBe("BUDGET_MODEL_CALLS_EXCEEDED");
    expect(c.investigations.usage(view.id).filter((u) => u.kind === "MODEL_CALL")).toHaveLength(2);
  });

  it("refuses a model call whose worst case would break the cost ceiling", async () => {
    const c = await testContainer({ BUDGET_MAX_COST_USD: "0.25", BUDGET_MAX_MODEL_CALLS: "50", BUDGET_MAX_TOOL_CALLS: "50" });
    c.setFixtureBehaviour("never_stops");
    const { view } = await investigateFirstSignal(c);
    expect(view.stopReason).toBe("BUDGET_COST_EXCEEDED");
    const spent = c.investigations.usage(view.id).reduce((s, u) => s + u.costUsd, 0);
    expect(spent).toBeLessThanOrEqual(0.25);
  });

  it("declines before any spend when the price cannot cover budget plus reserves", async () => {
    const c = await testContainer({ BRIEF_PRICE_USD: "0.50", BUDGET_MAX_COST_USD: "0.60" });
    const { view } = await investigateFirstSignal(c);
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "DECLINED_UNECONOMIC" });
    expect(c.investigations.usage(view.id)).toEqual([]);
  });

  it("reports MODEL_UNAVAILABLE instead of substituting another synthesiser", async () => {
    const config = testConfig({ SYNTHESIS_PROVIDER: "anthropic" });
    const c = buildContainer({ ...config, ANTHROPIC_API_KEY: undefined }, { db: openDb(":memory:"), transport: new FixtureTransport(buildFixtureResponses(), () => FIXTURE_CLOCK) });
    const { view } = await investigateFirstSignal(c);
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "MODEL_UNAVAILABLE", briefId: null });
  });
});
