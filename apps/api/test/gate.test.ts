import { describe, expect, it } from "vitest";
import type { BriefDraft, ConsistencyCheck, EvidenceItem, GateRule } from "@bullseye/domain";
import { computeConfidenceCap, evaluatePublication, extractNumberTokens, type GateInput } from "../src/gate/publicationGate.js";

const asOf = new Date("2026-09-18T12:00:00.000Z");

function ev(id: string, kind: EvidenceItem["kind"], values: EvidenceItem["values"], over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id,
    investigationId: "inv_test",
    kind,
    summary: id,
    values,
    observedAt: "2026-09-18T00:31:00.000Z",
    staleAfter: "2026-09-19T12:00:00.000Z",
    provenance: { mode: "LIVE", source: "test", url: "test://x", fetchedAt: "2026-09-18T11:59:00.000Z", sha256: "b".repeat(64) },
    ...over,
  };
}

const evidence = (): EvidenceItem[] => [
  ev("EV-CA", "CORPORATE_ACTION_RECORD", { multiplierOld: 1, multiplierNew: 1.003297609233, changePct: 0.329761, withholdingTaxPct: 30, effectiveTimeUtc: "2026-09-18T00:30:00.000Z" }),
  ev("EV-CHAIN-BEFORE", "ONCHAIN_MULTIPLIER_BEFORE", { multiplier: 1, multiplierExact: "1", blockNumber: 70922304, chainId: 196 }),
  ev("EV-CHAIN-AFTER", "ONCHAIN_MULTIPLIER_AFTER", { multiplier: 1.003297609233, multiplierExact: "1.003297609233", blockNumber: 70922424, chainId: 196 }),
  ev("EV-CHAIN-LATEST", "ONCHAIN_MULTIPLIER_LATEST", { multiplier: 1.003297609233, multiplierExact: "1.003297609233", blockNumber: 70988629, chainId: 196 }),
  ev("EV-POR", "PROOF_OF_RESERVES", { sharesHeld: 5, circulatingSupply: 0.949588, coverageRatio: 5.265442 }),
];

const pass = (id: string): ConsistencyCheck => ({ id, description: id, status: "PASS", detail: "", evidenceIds: [] });
const checks = (): ConsistencyCheck[] => [pass("CHK-ACTION-STILL-CURRENT"), pass("CHK-BEFORE-MATCHES-OLD"), pass("CHK-AFTER-MATCHES-NEW"), pass("CHK-LATEST-MATCHES-NEW"), pass("CHK-RESERVES-COVER-SUPPLY")];

const draft = (): BriefDraft => ({
  headline: "IFFx multiplier change confirmed on X Layer",
  whatHappened: [
    {
      text: "The issuer moved the multiplier from 1 to 1.003297609233, a change of 0.33%, effective 2026-09-18T00:30:00.000Z.",
      evidenceIds: ["EV-CA"],
      quantities: [
        { label: "old multiplier", value: 1, unit: "x", evidenceId: "EV-CA", valueKey: "multiplierOld" },
        { label: "new multiplier", value: 1.003297609233, unit: "x", evidenceId: "EV-CA", valueKey: "multiplierNew" },
        { label: "change", value: 0.329761, unit: "%", evidenceId: "EV-CA", valueKey: "changePct" },
      ],
    },
  ],
  whyItMayMatter: [{ text: "Balances change without Transfer events, so integrations that cache balances need to re-read them.", evidenceIds: ["EV-CA"], quantities: [] }],
  onchainObservations: [
    {
      text: "multiplier() returned 1 at block 70922304 and 1.003297609233 at block 70922424 on chain 196.",
      evidenceIds: ["EV-CHAIN-BEFORE", "EV-CHAIN-AFTER"],
      quantities: [
        { label: "before", value: 1, unit: "x", evidenceId: "EV-CHAIN-BEFORE", valueKey: "multiplier" },
        { label: "block before", value: 70922304, unit: "block", evidenceId: "EV-CHAIN-BEFORE", valueKey: "blockNumber" },
        { label: "after", value: 1.003297609233, unit: "x", evidenceId: "EV-CHAIN-AFTER", valueKey: "multiplier" },
        { label: "block after", value: 70922424, unit: "block", evidenceId: "EV-CHAIN-AFTER", valueKey: "blockNumber" },
        { label: "chain", value: 196, unit: "chain id", evidenceId: "EV-CHAIN-AFTER", valueKey: "chainId" },
      ],
    },
  ],
  confidence: { level: "HIGH", rationale: "Issuer record and chain state agree." },
  unknowns: ["Other chains were not read."],
  conflicts: [],
  limitations: ["Issuer figures are unaudited."],
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  draft: draft(),
  evidence: evidence(),
  checks: checks(),
  stopReason: "COMPLETED",
  synthesis: { provider: "anthropic", model: "claude-opus-5", mode: "LIVE" },
  asOf,
  allowFixture: false,
  ...over,
});

const failed = (r: ReturnType<typeof evaluatePublication>): GateRule[] => r.findings.filter((f) => !f.passed).map((f) => f.rule);

describe("publication gate", () => {
  it("publishes a fully evidenced draft", () => {
    const r = evaluatePublication(input());
    expect(failed(r)).toEqual([]);
    expect(r.decision).toBe("PUBLISH");
    expect(r.confidenceCap).toBe("HIGH");
  });

  it("is deterministic", () => {
    expect(evaluatePublication(input())).toEqual(evaluatePublication(input()));
  });

  it("rejects when mandatory evidence is missing", () => {
    const r = evaluatePublication(input({ evidence: evidence().filter((e) => e.kind !== "PROOF_OF_RESERVES") }));
    expect(r.decision).toBe("REJECT");
    expect(failed(r)).toContain("MANDATORY_EVIDENCE_PRESENT");
  });

  it("rejects when evidence is stale", () => {
    const stale = evidence().map((e) => (e.id === "EV-CHAIN-LATEST" ? { ...e, staleAfter: "2026-09-18T11:00:00.000Z" } : e));
    const r = evaluatePublication(input({ evidence: stale }));
    expect(failed(r)).toContain("EVIDENCE_FRESH");
  });

  it("rejects investment advice", () => {
    const d = draft();
    d.whyItMayMatter[0]!.text = "Holders should buy more before the next dividend because the token is undervalued.";
    expect(failed(evaluatePublication(input({ draft: d })))).toContain("NO_INVESTMENT_ADVICE");
  });

  it("rejects a number that is not in the cited evidence", () => {
    const d = draft();
    d.whatHappened.push({ text: "Roughly 41250 holders were affected.", evidenceIds: ["EV-CA"], quantities: [] });
    const r = evaluatePublication(input({ draft: d }));
    expect(failed(r)).toContain("NUMBERS_IN_TEXT_ARE_EVIDENCED");
    expect(r.findings.find((f) => f.rule === "NUMBERS_IN_TEXT_ARE_EVIDENCED")!.detail).toContain("41250");
  });

  it("rejects a timestamp that is not in the evidence", () => {
    const d = draft();
    d.whatHappened[0]!.text = d.whatHappened[0]!.text.replace("2026-09-18T00:30:00.000Z", "2026-09-17T00:30:00.000Z");
    expect(failed(evaluatePublication(input({ draft: d })))).toContain("NUMBERS_IN_TEXT_ARE_EVIDENCED");
  });

  it("rejects a declared quantity that disagrees with its evidence value", () => {
    const d = draft();
    d.whatHappened[0]!.quantities[1]!.value = 1.0033;
    expect(failed(evaluatePublication(input({ draft: d })))).toContain("QUANTITIES_RESOLVE_TO_EVIDENCE");
  });

  it("rejects claims that cite evidence which was never collected", () => {
    const d = draft();
    d.whyItMayMatter[0]!.evidenceIds = ["EV-IMAGINED"];
    expect(failed(evaluatePublication(input({ draft: d })))).toContain("CLAIMS_CITE_KNOWN_EVIDENCE");
  });

  it("rejects when a failed check is not disclosed, and accepts once it is", () => {
    const withFail = [...checks(), { id: "CHK-TRADING-NOT-HALTED", description: "", status: "FAIL" as const, detail: "", evidenceIds: [] }];
    const hidden = draft();
    hidden.confidence.level = "MEDIUM";
    expect(failed(evaluatePublication(input({ checks: withFail, draft: hidden })))).toEqual(["FAILED_CHECKS_DISCLOSED"]);
    const disclosed = { ...hidden, conflicts: [{ checkId: "CHK-TRADING-NOT-HALTED", description: "Issuer reports trading is halted." }] };
    expect(evaluatePublication(input({ checks: withFail, draft: disclosed })).decision).toBe("PUBLISH");
  });

  it("caps confidence: a failed on-chain check allows LOW at most", () => {
    const core = checks().map((c) => (c.id === "CHK-AFTER-MATCHES-NEW" ? { ...c, status: "FAIL" as const } : c));
    expect(computeConfidenceCap(evidence(), core)).toBe("LOW");
    // with a core check failed the draft may not announce a confirmation, so this one reports the dispute and overstates only its confidence
    const d = {
      ...draft(),
      headline: "IFFx multiplier change reported by the issuer is not reflected on X Layer",
      confidence: { level: "HIGH" as const, rationale: "Issuer record and chain state were compared by the desk." },
      conflicts: [{ checkId: "CHK-AFTER-MATCHES-NEW", description: "Chain disagrees with the issuer." }],
    };
    expect(failed(evaluatePublication(input({ checks: core, draft: d })))).toEqual(["CONFIDENCE_WITHIN_CAP"]);
  });

  it("caps confidence at MEDIUM when mandatory evidence is cached", () => {
    const cached = evidence().map((e) => (e.id === "EV-POR" ? { ...e, provenance: { ...e.provenance, mode: "CACHED" as const } } : e));
    expect(computeConfidenceCap(cached, checks())).toBe("MEDIUM");
  });

  it("refuses fixture evidence or fixture synthesis unless explicitly allowed", () => {
    const fx = evidence().map((e) => ({ ...e, provenance: { ...e.provenance, mode: "FIXTURE" as const } }));
    expect(failed(evaluatePublication(input({ evidence: fx })))).toContain("EVIDENCE_MODE_ALLOWED");
    expect(failed(evaluatePublication(input({ synthesis: { provider: "fixture", model: "t", mode: "FIXTURE" } })))).toContain("EVIDENCE_MODE_ALLOWED");
    expect(failed(evaluatePublication(input({ evidence: fx, allowFixture: true })))).not.toContain("EVIDENCE_MODE_ALLOWED");
  });

  it("rejects when the investigation did not complete or the draft is malformed", () => {
    expect(failed(evaluatePublication(input({ stopReason: "BUDGET_COST_EXCEEDED" })))).toContain("INVESTIGATION_COMPLETED");
    expect(failed(evaluatePublication(input({ draft: { headline: "x" } })))).toContain("SCHEMA");
  });
});

describe("number extraction", () => {
  it("ignores ids, addresses and names, and separates timestamps", () => {
    const t = extractNumberTokens("EV-CHAIN-1 at 0xdfae653d721d8cbf on x402 v2 moved 1,250.5 units (0.33%) at 2026-09-18T00:30:00.000Z");
    expect(t.numbers.map((n) => n.value)).toEqual([1250.5, 0.33]);
    expect(t.timestamps).toEqual(["2026-09-18T00:30:00.000Z"]);
  });
});
