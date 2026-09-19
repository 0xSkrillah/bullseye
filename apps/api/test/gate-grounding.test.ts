import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Brief, type BriefDraft, type Claim, type ConsistencyCheck, type EvidenceItem, type GateResult, type GateRule, type Quantity } from "@bullseye/domain";
import { evaluatePublication, extractNumberTokens, GATE_VERSION, type GateInput } from "../src/gate/publicationGate.js";
import { fieldSpec, normaliseUnit, unitAccepted } from "../src/gate/numericGrounding.js";
import { FixtureTransport } from "../src/adapters/transport.js";
import { XStocksAdapter } from "../src/adapters/xstocks.js";
import { XLayerAdapter } from "../src/adapters/xlayer.js";
import { SignalService } from "../src/signals/signalService.js";
import { EvidenceToolbox, TOOL_SPECS } from "../src/evidence/toolbox.js";
import { buildFixtureResponses, FIXTURE_CLOCK } from "../src/adapters/fixtures.js";
import { openDb } from "../src/db.js";

/**
 * Every case here goes through the whole gate with a draft, evidence and checks that are otherwise
 * publishable, so a rejection is caused by the one thing the case changes.
 */

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

type Values = EvidenceItem["values"];

/** five items; `patch` overrides values of one of them */
const evidence = (patch: Record<string, Values> = {}): EvidenceItem[] =>
  [
    ev("EV-CA", "CORPORATE_ACTION_RECORD", {
      version: 1,
      newestVersion: 1,
      supersededByVersion: null,
      multiplierOld: 1,
      multiplierNew: 1.003297609233,
      multiplierNewExact: "1.003297609233",
      changePct: 0.329761,
      grossCashflowUsd: 18.57,
      netCashflowUsd: 13,
      withholdingTaxRate: 0.3,
      withholdingTaxPct: 30,
      effectiveTimeUtc: "2026-09-18T00:30:00.000Z",
    }),
    ev("EV-CHAIN-BEFORE", "ONCHAIN_MULTIPLIER_BEFORE", { multiplier: 1, multiplierExact: "1", blockNumber: 70922304, blockTimestamp: "2026-09-18T00:29:00.000Z", offsetSeconds: -60, chainId: 196 }, { observedAt: "2026-09-18T00:29:00.000Z" }),
    ev("EV-CHAIN-AFTER", "ONCHAIN_MULTIPLIER_AFTER", { multiplier: 1.003297609233, multiplierExact: "1.003297609233", blockNumber: 70922424, blockTimestamp: "2026-09-18T00:31:00.000Z", offsetSeconds: 60, chainId: 196 }),
    ev("EV-CHAIN-LATEST", "ONCHAIN_MULTIPLIER_LATEST", { multiplier: 1.003297609233, multiplierExact: "1.003297609233", blockNumber: 70988629, blockTimestamp: "2026-09-18T10:00:30.000Z", chainId: 196 }, { observedAt: "2026-09-18T10:00:30.000Z" }),
    ev("EV-POR", "PROOF_OF_RESERVES", { sharesHeld: 3, circulatingSupply: 0.949588, coverageRatio: 3.159265, surplusShares: 2.050412 }),
  ].map((e) => (patch[e.id] ? { ...e, values: { ...e.values, ...patch[e.id] } } : e));

const activation = (lagSeconds = 0): EvidenceItem =>
  ev(
    "EV-CHAIN-ACTIVATION",
    "ONCHAIN_ACTIVATION_BLOCK",
    { changeFound: true, activationBlock: 70922364, activationTimestamp: "2026-09-18T00:30:00.000Z", lagSecondsVsIssuerEffectiveTime: lagSeconds, multiplierBefore: 1, multiplierAfter: 1.003297609233, lastBlockWithOld: 70922363, rpcReads: 17, chainId: 196 },
    { observedAt: "2026-09-18T00:30:00.000Z" },
  );

const pass = (id: string, evidenceIds: string[] = []): ConsistencyCheck => ({ id, description: id, status: "PASS", detail: "", evidenceIds });
/** five checks, all PASS */
const checks = (): ConsistencyCheck[] => [pass("CHK-ACTION-STILL-CURRENT", ["EV-CA"]), pass("CHK-BEFORE-MATCHES-OLD"), pass("CHK-AFTER-MATCHES-NEW"), pass("CHK-LATEST-MATCHES-NEW"), pass("CHK-RESERVES-COVER-SUPPLY")];

/** a quantity that copies its value from the evidence, as an honest draft does */
function q(items: EvidenceItem[], evidenceId: string, valueKey: string, unit: string): Quantity {
  return { label: valueKey, value: items.find((e) => e.id === evidenceId)!.values[valueKey] as number, unit, evidenceId, valueKey };
}

const draft = (): BriefDraft => {
  const e = evidence();
  return {
    headline: "IFFx multiplier change confirmed on X Layer",
    whatHappened: [
      {
        text: "The issuer moved the multiplier from 1 to 1.003297609233, a change of 0.33%, effective 2026-09-18T00:30:00.000Z.",
        evidenceIds: ["EV-CA"],
        quantities: [q(e, "EV-CA", "multiplierOld", "multiplier"), q(e, "EV-CA", "multiplierNew", "multiplier"), q(e, "EV-CA", "changePct", "%")],
      },
    ],
    whyItMayMatter: [{ text: "Balances change without Transfer events, so integrations that cache balances need to re-read them.", evidenceIds: ["EV-CA"], quantities: [] }],
    onchainObservations: [
      {
        text: "multiplier() returned 1 at block 70922304 and 1.003297609233 at block 70922424.",
        evidenceIds: ["EV-CHAIN-BEFORE", "EV-CHAIN-AFTER"],
        quantities: [q(e, "EV-CHAIN-BEFORE", "multiplier", "x"), q(e, "EV-CHAIN-BEFORE", "blockNumber", "block"), q(e, "EV-CHAIN-AFTER", "multiplier", "x"), q(e, "EV-CHAIN-AFTER", "blockNumber", "block")],
      },
    ],
    confidence: { level: "HIGH", rationale: "Issuer record and chain state were compared by the desk's checks." },
    unknowns: ["Other chains were not read."],
    conflicts: [],
    limitations: ["Issuer figures are unaudited."],
  };
};

const input = (over: Partial<GateInput> = {}): GateInput => ({
  draft: draft(),
  evidence: evidence(),
  checks: checks(),
  stopReason: "COMPLETED",
  synthesis: { provider: "openrouter", model: "openrouter/auto", mode: "LIVE" },
  asOf,
  allowFixture: false,
  ...over,
});

const failed = (r: GateResult): GateRule[] => r.findings.filter((f) => !f.passed).map((f) => f.rule);
const detail = (r: GateResult, rule: GateRule): string => r.findings.find((f) => f.rule === rule)!.detail;

/** the base draft plus one more claim */
function withClaim(claim: Claim, items: EvidenceItem[] = evidence()): GateInput {
  const d = draft();
  d.whatHappened.push(claim);
  return input({ draft: d, evidence: items });
}

function withHeadline(headline: string, over: Partial<GateInput> = {}): GateInput {
  return input({ draft: { ...draft(), headline }, ...over });
}

/** rejected for its figures and for nothing else, and the finding says why */
function expectUngrounded(i: GateInput, ...fragments: string[]) {
  const r = evaluatePublication(i);
  expect(r.decision).toBe("REJECT");
  expect(failed(r)).toEqual(["NUMBERS_IN_TEXT_ARE_EVIDENCED"]);
  for (const f of fragments) expect(detail(r, "NUMBERS_IN_TEXT_ARE_EVIDENCED")).toContain(f);
}

function expectPublished(i: GateInput) {
  const r = evaluatePublication(i);
  expect(r.findings.filter((f) => !f.passed)).toEqual([]);
  expect(r.decision).toBe("PUBLISH");
}

describe("numeric grounding through the full gate", () => {
  it("publishes the base draft, so each rejection below is caused by the one thing it changes", () => {
    const r = evaluatePublication(input());
    expect(failed(r)).toEqual([]);
    expect(r.decision).toBe("PUBLISH");
    expect(r.gateVersion).toBe(GATE_VERSION);
    expect(GATE_VERSION).toBe("2.0.0");
  });

  it("is deterministic: the same input gives a deep-equal result", () => {
    expect(evaluatePublication(input())).toEqual(evaluatePublication(input()));
    const bad = () => withClaim({ text: "Holders receive $10 per token, a fall of 12%.", evidenceIds: ["EV-CA"], quantities: [] });
    expect(evaluatePublication(bad())).toEqual(evaluatePublication(bad()));
  });

  describe("unsupported figures", () => {
    it("rejects an unsupported $10 in a claim", () => {
      expectUngrounded(withClaim({ text: "Holders receive $10 per token.", evidenceIds: ["EV-CA"], quantities: [] }), 'whatHappened: "10"', "no declared quantity");
    });

    it("rejects an unsupported 12% in a claim", () => {
      expectUngrounded(withClaim({ text: "The multiplier rose 12%.", evidenceIds: ["EV-CA"], quantities: [] }), 'whatHappened: "12"', "no declared quantity");
    });

    it("rejects an unsupported $10 and an unsupported 12% in the headline", () => {
      expectUngrounded(withHeadline("IFFx holders receive $10 per token on X Layer"), 'headline: "10"');
      expectUngrounded(withHeadline("IFFx multiplier rose 12% on X Layer"), 'headline: "12"');
    });

    it("has no small-integer exemption: a bare 7 or 2 is a figure like any other", () => {
      expectUngrounded(withClaim({ text: "The change reached 7 venues within 2 days.", evidenceIds: ["EV-CA"], quantities: [] }), '"7"', '"2"');
      expectUngrounded(input({ draft: { ...draft(), unknowns: ["Whether the other 4 deployments followed is not known."] } }), 'unknowns[0]: "4"');
    });

    it("rejects a figure that is declared but whose evidence key has no registered unit", () => {
      const items = evidence({ "EV-CA": { holdersAffected: 41250 } });
      const r = evaluatePublication(withClaim({ text: "Roughly 41250 holders were affected.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "holdersAffected", "holders")] }, items));
      expect(failed(r)).toEqual(["QUANTITIES_RESOLVE_TO_EVIDENCE", "NUMBERS_IN_TEXT_ARE_EVIDENCED"]);
      expect(detail(r, "QUANTITIES_RESOLVE_TO_EVIDENCE")).toContain("EV-CA.holdersAffected has no registered unit");
      expect(detail(r, "NUMBERS_IN_TEXT_ARE_EVIDENCED")).toContain("41250");
    });
  });

  describe("sign", () => {
    it('rejects "-13 USD" where the net cashflow is 13', () => {
      const e = evidence();
      expectUngrounded(withClaim({ text: "The net cashflow per share is -13 USD.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "netCashflowUsd", "USD")] }), '"-13"', "sign mismatch");
      expectUngrounded(withClaim({ text: "The net cashflow per share is -$13.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "netCashflowUsd", "USD")] }), "sign mismatch");
      expectPublished(withClaim({ text: "The net cashflow per share is 13 USD.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "netCashflowUsd", "USD")] }));
    });

    it("rejects a positive value of a signed field written as a fall or a shortfall", () => {
      const items = evidence({ "EV-CA": { changePct: 13 }, "EV-POR": { surplusShares: 13 } });
      // the base draft quotes the change, so here the claim under test replaces its first claim
      const only = (claim: Claim): GateInput => input({ draft: { ...draft(), whatHappened: [claim] }, evidence: items });
      expectUngrounded(only({ text: "The multiplier fell 13%.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "changePct", "%")] }), '"13"', "sign mismatch");
      expectUngrounded(only({ text: "The multiplier moved 13%, a decline.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "changePct", "%")] }), "sign mismatch");
      expectUngrounded(only({ text: "Reserves show a shortfall of 13 shares.", evidenceIds: ["EV-POR"], quantities: [q(items, "EV-POR", "surplusShares", "shares")] }), '"13"', "sign mismatch");
      expectPublished(only({ text: "The multiplier rose 13%.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "changePct", "%")] }));
      expectPublished(only({ text: "Reserves show a surplus of 13 shares.", evidenceIds: ["EV-POR"], quantities: [q(items, "EV-POR", "surplusShares", "shares")] }));
    });

    it('rejects an unsigned "60 seconds after" bound to an offset of -60, and accepts the honest wordings', () => {
      const e = evidence();
      const offset = [q(e, "EV-CHAIN-BEFORE", "offsetSeconds", "seconds")];
      expectUngrounded(withClaim({ text: "The first read was taken 60 seconds after the effective time.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: offset }), '"60"', "sign mismatch", "EV-CHAIN-BEFORE.offsetSeconds is -60");
      expectUngrounded(withClaim({ text: "The first read was taken at an offset of 60 seconds.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: offset }), "sign mismatch");
      expectPublished(withClaim({ text: "The first read was taken 60 seconds before the effective time.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: offset }));
      expectPublished(withClaim({ text: "The first read was taken at an offset of -60 seconds.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: offset }));
    });

    it("binds each of two offsets in one sentence to the value its own wording names", () => {
      const e = evidence();
      const both = { evidenceIds: ["EV-CHAIN-BEFORE", "EV-CHAIN-AFTER"], quantities: [q(e, "EV-CHAIN-BEFORE", "offsetSeconds", "seconds"), q(e, "EV-CHAIN-AFTER", "offsetSeconds", "seconds")] };
      expectPublished(withClaim({ text: "Reads were taken 60 seconds before and 60 seconds after the effective time.", ...both }));
    });
  });

  describe("unit", () => {
    it('rejects a percentage written as "$0.33" or "0.33 USD"', () => {
      const e = evidence();
      const change = [q(e, "EV-CA", "changePct", "%")];
      expectUngrounded(withClaim({ text: "The change is worth $0.33 per token.", evidenceIds: ["EV-CA"], quantities: change }), '"0.33"', "unit mismatch", "EV-CA.changePct is a percentage");
      expectUngrounded(withClaim({ text: "The change is worth 0.33 USD per token.", evidenceIds: ["EV-CA"], quantities: change }), "unit mismatch");
      expectUngrounded(withClaim({ text: "The change is 0.33 per token.", evidenceIds: ["EV-CA"], quantities: change }), "unit mismatch");
    });

    it('rejects a USD amount written with "%"', () => {
      const e = evidence();
      expectUngrounded(withClaim({ text: "The gross distribution is 18.57% of the holding.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "grossCashflowUsd", "USD")] }), '"18.57"', "unit mismatch", "EV-CA.grossCashflowUsd is a USD amount");
      expectPublished(withClaim({ text: "The gross distribution is 18.57 USD per share.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "grossCashflowUsd", "USD per share")] }));
    });

    it("rejects a declared quantity whose unit contradicts the registry, and names the unit to use", () => {
      const d = draft();
      d.whatHappened[0]!.quantities[2]!.unit = "USD";
      const r = evaluatePublication(input({ draft: d }));
      expect(failed(r)).toEqual(["QUANTITIES_RESOLVE_TO_EVIDENCE"]);
      expect(detail(r, "QUANTITIES_RESOLVE_TO_EVIDENCE")).toContain('declares unit "USD" but EV-CA.changePct is PERCENT; use "%"');
    });

    it('rejects an untyped x100: "50 USD" where the withholding rate is 0.5', () => {
      const items = evidence({ "EV-CA": { withholdingTaxRate: 0.5, withholdingTaxPct: 50 } });
      expectUngrounded(withClaim({ text: "The issuer withholds 50 USD per share.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "withholdingTaxRate", "rate")] }, items), '"50"', "unit mismatch");
      expectUngrounded(withClaim({ text: "The issuer withholds at a rate of 50.", evidenceIds: ["EV-CA"], quantities: [q(items, "EV-CA", "withholdingTaxRate", "rate")] }, items), '"50"', "unit mismatch");
    });

    it('accepts the typed conversion: "50%" for a rate of 0.5, "30%" for withholdingTaxPct 30, and the bare rate itself', () => {
      const half = evidence({ "EV-CA": { withholdingTaxRate: 0.5, withholdingTaxPct: 50 } });
      expectPublished(withClaim({ text: "The withholding tax rate is 50%.", evidenceIds: ["EV-CA"], quantities: [q(half, "EV-CA", "withholdingTaxRate", "rate")] }, half));
      expectPublished(withClaim({ text: "The withholding tax rate is 0.5.", evidenceIds: ["EV-CA"], quantities: [q(half, "EV-CA", "withholdingTaxRate", "%")] }, half));
      const e = evidence();
      expectPublished(withClaim({ text: "The withholding tax is 30%.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "withholdingTaxPct", "percent")] }));
      // 0.3 is a fraction: "0.3%" is neither it nor its percentage form
      expectUngrounded(withClaim({ text: "The withholding tax rate is 0.3%.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "withholdingTaxRate", "rate")] }), '"0.3"', "unit mismatch");
    });

    it("rejects basis points and scaled figures, which no evidence value is written in", () => {
      const e = evidence();
      expectUngrounded(withClaim({ text: "The multiplier moved by 33 bps.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "changePct", "%")] }), '"33"', "basis points");
      expectUngrounded(withClaim({ text: "About 3 million shares back the token.", evidenceIds: ["EV-POR"], quantities: [q(e, "EV-POR", "sharesHeld", "shares")] }), '"3"', "scaled");
    });
  });

  describe("numbers that match something unrelated", () => {
    it("rejects a block number quoted as a holder count in the headline", () => {
      expectUngrounded(withHeadline("IFFx rebase reached 70922304 holders on X Layer"), 'headline: "70922304"', "EV-CHAIN-BEFORE.blockNumber is BLOCK");
      expectPublished(withHeadline("IFFx multiplier change seen at block 70922424 on X Layer"));
    });

    it("rejects a number that exists only in evidence the claim does not cite", () => {
      expectUngrounded(withClaim({ text: "The reserve record lists 0.949588 circulating tokens.", evidenceIds: ["EV-CA"], quantities: [] }), '"0.949588"');
      const e = evidence();
      const r = evaluatePublication(withClaim({ text: "The reserve record lists 0.949588 circulating tokens.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-POR", "circulatingSupply", "tokens")] }));
      expect(failed(r)).toEqual(["QUANTITIES_RESOLVE_TO_EVIDENCE", "NUMBERS_IN_TEXT_ARE_EVIDENCED"]);
    });

    it("rejects a number that the cited evidence holds but the claim did not declare", () => {
      expectUngrounded(withClaim({ text: "The record sits on chain 196 at block 70922304.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: [] }), '"196"', '"70922304"');
    });

    it('rejects "3 checks passed" when sharesHeld is 3 but 5 checks passed', () => {
      const e = evidence();
      expectUngrounded(withClaim({ text: "The custodian holds the shares and 3 checks passed.", evidenceIds: ["EV-POR"], quantities: [q(e, "EV-POR", "sharesHeld", "shares")] }), '"3"', "not the derived count", "5");
    });
  });

  describe("rounding", () => {
    it('rejects "1" for a multiplier of 1.003297609233, and "1.00" as well', () => {
      const e = evidence();
      const onlyNew = [q(e, "EV-CA", "multiplierNew", "multiplier")];
      expectUngrounded(withClaim({ text: "The new multiplier is 1.", evidenceIds: ["EV-CA"], quantities: onlyNew }), '"1"', "precision too coarse");
      expectUngrounded(withClaim({ text: "The new multiplier is 1.00 as before.", evidenceIds: ["EV-CA"], quantities: onlyNew }), '"1.00"', "precision too coarse");
      // the same digit is fine when it is the old multiplier, which is exactly 1
      expectPublished(withClaim({ text: "The old multiplier is 1.", evidenceIds: ["EV-CA"], quantities: [q(e, "EV-CA", "multiplierOld", "multiplier")] }));
    });

    it('rejects "0.3%" for a change of 0.329761, and a figure that is not a rounding of it at all', () => {
      const e = evidence();
      const change = [q(e, "EV-CA", "changePct", "%")];
      expectUngrounded(withClaim({ text: "The multiplier changed by 0.3%.", evidenceIds: ["EV-CA"], quantities: change }), '"0.3"', "precision too coarse");
      expectUngrounded(withClaim({ text: "The multiplier changed by 0.34%.", evidenceIds: ["EV-CA"], quantities: change }), '"0.34"', "no declared quantity");
    });

    it('accepts "0.33%", "1.0033" and the full value', () => {
      const e = evidence();
      const qs = [q(e, "EV-CA", "changePct", "%"), q(e, "EV-CA", "multiplierNew", "multiplier")];
      expectPublished(withClaim({ text: "The multiplier changed by 0.33% to 1.0033.", evidenceIds: ["EV-CA"], quantities: qs }));
      expectPublished(withClaim({ text: "The multiplier changed by 0.329761% to 1.003297609233.", evidenceIds: ["EV-CA"], quantities: qs }));
    });

    it("compares the percentage form of a fraction without float noise", () => {
      const items = evidence({ "EV-POR": { coverageRatio: 0.665166 } });
      expectPublished(withClaim({ text: "Coverage stands at 66.5166%, or 67% rounded.", evidenceIds: ["EV-POR"], quantities: [q(items, "EV-POR", "coverageRatio", "ratio")] }, items));
    });
  });

  describe("counts the gate computes itself", () => {
    it('accepts "5 of 5 consistency checks passed" and "5 evidence items"', () => {
      expectPublished(withClaim({ text: "5 of 5 consistency checks passed and the desk holds 5 evidence items, of which this claim cites 1 record.", evidenceIds: ["EV-CA"], quantities: [] }));
      expectPublished(input({ draft: { ...draft(), confidence: { level: "HIGH", rationale: "All 5 consistency checks passed and 0 failed; 3 on-chain reads were compared with the issuer record." } } }));
    });

    it("rejects wrong counts", () => {
      expectUngrounded(withClaim({ text: "4 of 5 consistency checks passed.", evidenceIds: ["EV-CA"], quantities: [] }), '"4"', "not the derived count");
      expectUngrounded(withClaim({ text: "The desk holds 7 evidence items.", evidenceIds: ["EV-CA"], quantities: [] }), '"7"', "not the derived count");
      expectUngrounded(input({ draft: { ...draft(), confidence: { level: "HIGH", rationale: "All 9 checks passed." } } }), 'confidence.rationale: "9"');
      expectUngrounded(input({ draft: { ...draft(), confidence: { level: "HIGH", rationale: "0 of 5 checks passed." } } }), 'confidence.rationale: "0"');
      expectUngrounded(input({ draft: { ...draft(), limitations: ["Only 2 on-chain reads were taken."] } }), 'limitations[0]: "2"');
    });

    it("lets the one evidence value that is itself a count of reads be written as such", () => {
      const items = [...evidence(), activation()];
      expectPublished(withClaim({ text: "The activation search used 17 RPC reads.", evidenceIds: ["EV-CHAIN-ACTIVATION"], quantities: [q(items, "EV-CHAIN-ACTIVATION", "rpcReads", "reads")] }, items));
      expectUngrounded(withClaim({ text: "The activation search used 12 RPC reads.", evidenceIds: ["EV-CHAIN-ACTIVATION"], quantities: [q(items, "EV-CHAIN-ACTIVATION", "rpcReads", "reads")] }, items), '"12"');
    });
  });

  describe("activation timing", () => {
    it("rejects a timestamp that is not in the cited evidence", () => {
      expectUngrounded(withClaim({ text: "The change took effect at 2026-09-17T00:30:00.000Z.", evidenceIds: ["EV-CA"], quantities: [] }), "2026-09-17T00:30:00.000Z");
      // real, but held by an item this claim does not cite
      expectUngrounded(withClaim({ text: "The change took effect at 2026-09-18T10:00:30.000Z.", evidenceIds: ["EV-CA"], quantities: [] }), "2026-09-18T10:00:30.000Z", "cited evidence");
    });

    it("accepts a timestamp cut short at a whole component, a date, and a time of day that starts an evidence time", () => {
      expectPublished(withClaim({ text: "The change took effect on 2026-09-18 at 00:30, that is 2026-09-18T00:30Z.", evidenceIds: ["EV-CA"], quantities: [] }));
    });

    it('rejects an invented time of day such as "00:45"', () => {
      expectUngrounded(withClaim({ text: "The contract switched at 00:45 UTC.", evidenceIds: ["EV-CA"], quantities: [] }), '"00:45"');
      expectUngrounded(withHeadline("IFFx multiplier change landed at 00:45 on X Layer"), 'headline: "00:45"');
    });

    it('rejects a lag written as "45 seconds" when the evidence says 0', () => {
      const items = [...evidence(), activation(0)];
      const lag = [q(items, "EV-CHAIN-ACTIVATION", "lagSecondsVsIssuerEffectiveTime", "seconds")];
      expectUngrounded(withClaim({ text: "Activation lagged the issuer's effective time by 45 seconds.", evidenceIds: ["EV-CHAIN-ACTIVATION"], quantities: lag }, items), '"45"', "no declared quantity");
      expectPublished(withClaim({ text: "Activation lagged the issuer's effective time by 0 seconds.", evidenceIds: ["EV-CHAIN-ACTIVATION"], quantities: lag }, items));
    });

    it("rejects a timestamp that matches evidence only as a substring", () => {
      // "00:30" sits inside 10:00:30 and "1:59" inside 11:59:00; neither is a time this item holds
      expectUngrounded(withClaim({ text: "The head read was taken at 00:30.", evidenceIds: ["EV-CHAIN-LATEST"], quantities: [] }), '"00:30"');
      expectUngrounded(withClaim({ text: "The head read was fetched at 1:59.", evidenceIds: ["EV-CHAIN-LATEST"], quantities: [] }), '"1:59"');
      expectPublished(withClaim({ text: "The head read was taken at 10:00:30.", evidenceIds: ["EV-CHAIN-LATEST"], quantities: [] }));
    });
  });

  describe("rules around the figures still hold", () => {
    it("rejects stale evidence", () => {
      const stale = evidence().map((e) => (e.id === "EV-CHAIN-LATEST" ? { ...e, staleAfter: "2026-09-18T11:00:00.000Z" } : e));
      const r = evaluatePublication(input({ evidence: stale }));
      expect(r.decision).toBe("REJECT");
      expect(failed(r)).toEqual(["EVIDENCE_FRESH"]);
    });

    it("rejects missing mandatory evidence", () => {
      const r = evaluatePublication(input({ evidence: evidence().filter((e) => e.kind !== "PROOF_OF_RESERVES") }));
      expect(r.decision).toBe("REJECT");
      expect(failed(r)).toEqual(["MANDATORY_EVIDENCE_PRESENT"]);
    });

    it("rejects advice language", () => {
      const d = draft();
      d.whyItMayMatter[0]!.text = "Holders should buy more before the next dividend because the token is undervalued.";
      const r = evaluatePublication(input({ draft: d }));
      expect(r.decision).toBe("REJECT");
      expect(failed(r)).toEqual(["NO_INVESTMENT_ADVICE"]);
    });

    it('rejects a spelled-out figure with a unit ("twelve percent"), and leaves number words without a unit alone', () => {
      expectUngrounded(withClaim({ text: "The multiplier rose twelve percent.", evidenceIds: ["EV-CA"], quantities: [] }), '"twelve percent"', "write figures as digits taken from evidence");
      expectUngrounded(withHeadline("IFFx holders receive two hundred dollars per token"), '"two hundred dollars"');
      expectUngrounded(withHeadline("IFFx multiplier moved by twenty-five basis points"), '"twenty-five basis points"');
      expectPublished(withClaim({ text: "One of the two reads was taken before the effective time.", evidenceIds: ["EV-CHAIN-BEFORE"], quantities: [] }));
    });
  });

  describe("an issuer cancellation", () => {
    const cancelledChecks = (): ConsistencyCheck[] => checks().map((c) => (c.id === "CHK-ACTION-STILL-CURRENT" ? { ...c, status: "FAIL" as const, detail: "issuer cancelled v1 with v2" } : c));
    const cancelledEvidence = () => evidence({ "EV-CA": { newestVersion: 2, supersededByVersion: 2, supersededReason: "CANCELLED" } });
    const honest = (): BriefDraft => ({
      ...draft(),
      headline: "IFFx multiplier change was cancelled by the issuer after it was flagged",
      confidence: { level: "LOW", rationale: "The issuer voided this version of the record, so chain and issuer disagree about what stands." },
      conflicts: [{ checkId: "CHK-ACTION-STILL-CURRENT", description: "The issuer cancelled version 1 of the action and listed version 2 in its place." }],
    });

    it("publishes when the conflict is disclosed, confidence is LOW and nothing claims a confirmation", () => {
      const r = evaluatePublication(input({ draft: honest(), checks: cancelledChecks(), evidence: cancelledEvidence() }));
      expect(failed(r)).toEqual([]);
      expect(r.decision).toBe("PUBLISH");
      expect(r.confidenceCap).toBe("LOW");
    });

    it('rejects the same draft once its headline says "confirmed on X Layer"', () => {
      const r = evaluatePublication(input({ draft: { ...honest(), headline: "IFFx multiplier change confirmed on X Layer" }, checks: cancelledChecks(), evidence: cancelledEvidence() }));
      expect(r.decision).toBe("REJECT");
      expect(failed(r)).toEqual(["FAILED_CHECKS_DISCLOSED"]);
      expect(detail(r, "FAILED_CHECKS_DISCLOSED")).toContain('headline says "confirmed" while CHK-ACTION-STILL-CURRENT did not pass');
    });

    it("rejects confirmation language in the rationale as well", () => {
      const r = evaluatePublication(input({ draft: { ...honest(), confidence: { level: "LOW", rationale: "The chain state matches the issuer record." } }, checks: cancelledChecks(), evidence: cancelledEvidence() }));
      expect(failed(r)).toEqual(["FAILED_CHECKS_DISCLOSED"]);
      expect(detail(r, "FAILED_CHECKS_DISCLOSED")).toContain('confidence.rationale says "matches"');
    });

    it("rejects when the cancellation is not disclosed", () => {
      const r = evaluatePublication(input({ draft: { ...honest(), conflicts: [] }, checks: cancelledChecks(), evidence: cancelledEvidence() }));
      expect(r.decision).toBe("REJECT");
      expect(failed(r)).toEqual(["FAILED_CHECKS_DISCLOSED"]);
      expect(detail(r, "FAILED_CHECKS_DISCLOSED")).toContain("CHK-ACTION-STILL-CURRENT");
    });

    it("binds a figure in a conflict description to the evidence of the check it is about", () => {
      const withFigure = (description: string) => input({ draft: { ...honest(), conflicts: [{ checkId: "CHK-ACTION-STILL-CURRENT", description }] }, checks: cancelledChecks(), evidence: cancelledEvidence() });
      expectPublished(withFigure("The issuer replaced this record with version 2."));
      // 3 is sharesHeld, which the check about the issuer record never looked at
      expectUngrounded(withFigure("The issuer replaced this record with version 3."), 'conflicts[0]: "3"');
    });
  });
});

describe("the recorded live Brief", () => {
  const recorded = JSON.parse(readFileSync(new URL("../../../artifacts/evidence/delivery-ord_8a2102084ad69dab.json", import.meta.url), "utf8")) as { brief: unknown };
  const brief = Brief.parse(recorded.brief);

  it("has a registered unit for every numeric key in its evidence", () => {
    const unregistered = brief.evidence.flatMap((e) =>
      Object.entries(e.values)
        .filter(([key, v]) => typeof v === "number" && !fieldSpec(e.kind, key))
        .map(([key]) => `${e.kind}.${key}`),
    );
    expect(unregistered).toEqual([]);
    expect(brief.evidence.flatMap((e) => Object.values(e.values)).filter((v) => typeof v === "number").length).toBeGreaterThan(30);
  });

  it("passes every rule of the new gate with its own evidence and checks, judged at the instant it was first judged", () => {
    const r = evaluatePublication({ draft: brief.draft, evidence: brief.evidence, checks: brief.checks, stopReason: "COMPLETED", synthesis: brief.synthesis, asOf: new Date(brief.gate.evaluatedAt), allowFixture: false });
    expect(r.findings.filter((f) => !f.passed)).toEqual([]);
    expect(r.decision).toBe("PUBLISH");
    expect(r.gateVersion).toBe("2.0.0");
  });

  it("declares every quantity with a unit string the registry accepts", () => {
    for (const claim of [...brief.draft.whatHappened, ...brief.draft.whyItMayMatter, ...brief.draft.onchainObservations]) {
      for (const quantity of claim.quantities) {
        const item = brief.evidence.find((e) => e.id === quantity.evidenceId)!;
        expect(unitAccepted(quantity.unit, fieldSpec(item.kind, quantity.valueKey)!), `${quantity.valueKey} as "${quantity.unit}"`).toBe(true);
      }
    }
  });
});

describe("the unit registry", () => {
  it("covers every numeric key the toolbox emits, in both outcomes of the activation search", async () => {
    const unregistered: string[] = [];
    for (const fixture of [{}, { onchainAfter: "1" }]) {
      const transport = new FixtureTransport(buildFixtureResponses(fixture), () => FIXTURE_CLOCK);
      const xstocks = new XStocksAdapter(transport, "https://example.test");
      const xlayer = new XLayerAdapter(transport, "https://rpc.example.test");
      const signal = (await new SignalService(openDb(":memory:"), xstocks, transport, { lookbackHours: 24 * 365, maxAssetsPerScan: 12 }).scan()).signals[0]!;
      const toolbox = new EvidenceToolbox("inv_units", signal, xstocks, xlayer);
      for (const spec of TOOL_SPECS) {
        const inputs = spec.name === "read_onchain_multiplier" ? [{ when: "before_effective" }, { when: "after_effective" }, { when: "latest" }] : [{}];
        for (const toolInput of inputs) await toolbox.call(spec.name, toolInput);
      }
      for (const e of toolbox.all()) for (const [key, v] of Object.entries(e.values)) if (typeof v === "number" && !fieldSpec(e.kind, key)) unregistered.push(`${e.kind}.${key}`);
    }
    expect(unregistered).toEqual([]);
  });

  it("normalises the unit strings a writer is likely to use, case and spacing aside", () => {
    const cases: [string, string][] = [
      ["x", "MULTIPLIER"], ["×", "MULTIPLIER"], [" Multiplier ", "MULTIPLIER"], ["%", "PERCENT"], ["per cent", "PERCENT"], ["pct", "PERCENT"], ["USD", "USD"], ["$", "USD"], ["US dollars", "USD"], ["USD per share", "USD"],
      ["rate", "RATIO"], ["fraction", "RATIO"], ["s", "SECONDS"], ["Seconds", "SECONDS"], ["block number", "BLOCK"], ["block height", "BLOCK"], ["chain id", "CHAIN_ID"], ["chainId", "CHAIN_ID"], ["v", "VERSION"],
      ["underlying shares", "SHARES"], ["tokens", "TOKENS"], ["units", "TOKENS"], ["rpc reads", "COUNT"], ["calls", "COUNT"],
    ];
    for (const [unit, expected] of cases) expect(normaliseUnit(unit), unit).toBe(expected);
    expect(normaliseUnit("holders")).toBeNull();
  });
});

describe("number tokens", () => {
  it("reports where each figure stands, its sign and the unit written against it", () => {
    const text = "Paid $1,250.5 then -13 USD, up 0.33% and 25 bps, at block 70922304.";
    const { numbers } = extractNumberTokens(text);
    expect(numbers.map((n) => [n.raw, n.value, n.marker])).toEqual([
      ["1,250.5", 1250.5, "USD"],
      ["-13", -13, "USD"],
      ["0.33", 0.33, "PERCENT"],
      ["25", 25, "BPS"],
      ["70922304", 70922304, "NONE"],
    ]);
    for (const n of numbers) expect(text.slice(n.index, n.index + n.raw.length)).toBe(n.raw);
  });

  it("does not let a digit pass by being unreadable", () => {
    expect(extractNumberTokens("release 1.2.3 shipped").numbers.map((n) => n.marker)).toContain("UNREADABLE");
    expect(extractNumberTokens("a gain of .5%").numbers.map((n) => [n.value, n.marker])).toEqual([[0.5, "PERCENT"]]);
    expect(extractNumberTokens("worth USD10 today").numbers.map((n) => [n.value, n.marker])).toEqual([[10, "USD"]]);
    // glued to a word it would read as a name like "x402"; with a unit behind it, it is a figure that cannot be read
    expect(extractNumberTokens("the multiplier rose10% on x402").numbers.map((n) => [n.value, n.marker])).toEqual([[10, "UNREADABLE"]]);
  });
});
