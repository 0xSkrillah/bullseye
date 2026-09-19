import type { BriefDraft, EvidenceItem, Synthesis } from "@bullseye/domain";
import { CORE_CHECKS } from "../evidence/checks.js";
import type { ModelSession, ModelTurn, ProviderPricing, SynthesisProvider, ToolCall, ToolResult } from "./model.js";

/**
 * Deterministic test double for the synthesis model. It exists so the pipeline
 * can be exercised offline and so adverse cases can be forced. Anything it
 * produces is labelled FIXTURE and the publication gate refuses to sell it
 * unless ALLOW_FIXTURE_PUBLICATION is set.
 */
export type FixtureBehaviour = "good" | "gives_advice" | "unevidenced_number" | "skips_mandatory_evidence" | "never_stops" | "hides_conflict" | "invalid_json";

const ALL_TOOLS: { name: string; input: unknown }[] = [
  { name: "get_corporate_action", input: {} },
  { name: "get_issuer_multiplier_state", input: {} },
  { name: "read_onchain_multiplier", input: { when: "before_effective" } },
  { name: "read_onchain_multiplier", input: { when: "after_effective" } },
  { name: "read_onchain_multiplier", input: { when: "latest" } },
  { name: "find_onchain_activation", input: {} },
  { name: "get_proof_of_reserves", input: {} },
  { name: "get_reference_price", input: {} },
  { name: "get_trading_status", input: {} },
  { name: "get_supply", input: {} },
];

const SYNTHETIC_USAGE = { inputTokens: 2_000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 };

export class FixtureProvider implements SynthesisProvider {
  readonly info: Synthesis = { provider: "fixture", model: "deterministic-template", mode: "FIXTURE" };
  /** synthetic rates so that budget arithmetic can be exercised; nothing here is a real cost */
  readonly pricing: ProviderPricing = { worstCaseRates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, basisWhenNotBilled: "FIXTURE" };

  constructor(private readonly behaviour: FixtureBehaviour = "good") {}

  start(): ModelSession {
    const behaviour = this.behaviour;
    const evidence: EvidenceItem[] = [];
    let turn = 0;

    const absorb = (results: ToolResult[] | null) => {
      for (const r of results ?? []) {
        if (r.isError) continue;
        try {
          evidence.push(JSON.parse(r.content) as EvidenceItem);
        } catch {
          // ignore malformed tool output; the gate will catch missing evidence
        }
      }
    };

    return {
      async collect(results): Promise<ModelTurn> {
        absorb(results);
        turn++;
        if (behaviour === "never_stops") {
          return { kind: "tool_calls", calls: [call(turn, 0, "get_reference_price", {})], usage: SYNTHETIC_USAGE };
        }
        if (turn === 1) {
          const wanted = behaviour === "skips_mandatory_evidence" ? ALL_TOOLS.filter((t) => t.name !== "get_proof_of_reserves") : ALL_TOOLS;
          return { kind: "tool_calls", calls: wanted.map((t, i) => call(turn, i, t.name, t.input)), usage: SYNTHETIC_USAGE };
        }
        return { kind: "done", text: "evidence collected", usage: SYNTHETIC_USAGE };
      },
      async synthesise(instruction): Promise<ModelTurn> {
        if (behaviour === "invalid_json") return { kind: "done", text: "{ not json", usage: SYNTHETIC_USAGE };
        const failed = [...instruction.matchAll(/^(CHK-[A-Z0-9-]+) FAIL/gm)].map((m) => m[1] as string);
        const unsettled = [...instruction.matchAll(/^(CHK-[A-Z0-9-]+) (?:FAIL|UNKNOWN)/gm)].some((m) => (CORE_CHECKS as readonly string[]).includes(m[1] as string));
        return { kind: "done", text: JSON.stringify(templateDraft(evidence, failed, unsettled, behaviour)), usage: SYNTHETIC_USAGE };
      },
    };
  }
}

function call(turn: number, i: number, name: string, input: unknown): ToolCall {
  return { id: `fx_${turn}_${i}`, name, input };
}

function templateDraft(evidence: EvidenceItem[], failedChecks: string[], coreUnsettled: boolean, behaviour: FixtureBehaviour): BriefDraft {
  const ev = (id: string) => evidence.find((e) => e.id === id);
  const num = (id: string, key: string): number => Number(ev(id)?.values[key] ?? Number.NaN);
  const q = (label: string, id: string, key: string, unit: string) => ({ label, value: num(id, key), unit, evidenceId: id, valueKey: key });
  const has = (id: string) => ev(id) !== undefined;

  const whatHappened: BriefDraft["whatHappened"] = [
    {
      text: `The issuer recorded a corporate action that changed the token balance multiplier from ${num("EV-CA", "multiplierOld")} to ${num("EV-CA", "multiplierNew")}, a change of ${num("EV-CA", "changePct")}%.`,
      evidenceIds: ["EV-CA"],
      quantities: [q("old multiplier", "EV-CA", "multiplierOld", "x"), q("new multiplier", "EV-CA", "multiplierNew", "x"), q("change", "EV-CA", "changePct", "%")],
    },
  ];
  if (behaviour === "unevidenced_number") {
    whatHappened.push({ text: "Roughly 41250 holders were affected by the change.", evidenceIds: ["EV-CA"], quantities: [] });
  }

  const onchain: BriefDraft["onchainObservations"] = [];
  if (has("EV-CHAIN-BEFORE") && has("EV-CHAIN-AFTER")) {
    onchain.push({
      text: `On X Layer the contract returned multiplier ${num("EV-CHAIN-BEFORE", "multiplier")} at block ${num("EV-CHAIN-BEFORE", "blockNumber")} and ${num("EV-CHAIN-AFTER", "multiplier")} at block ${num("EV-CHAIN-AFTER", "blockNumber")}.`,
      evidenceIds: ["EV-CHAIN-BEFORE", "EV-CHAIN-AFTER"],
      quantities: [
        q("multiplier before", "EV-CHAIN-BEFORE", "multiplier", "x"),
        q("block before", "EV-CHAIN-BEFORE", "blockNumber", "block"),
        q("multiplier after", "EV-CHAIN-AFTER", "multiplier", "x"),
        q("block after", "EV-CHAIN-AFTER", "blockNumber", "block"),
      ],
    });
  }
  if (onchain.length === 0) onchain.push({ text: "No on-chain reads were collected.", evidenceIds: ["EV-CA"], quantities: [] });

  const why: BriefDraft["whyItMayMatter"] = [
    {
      text:
        behaviour === "gives_advice"
          ? "Holders should buy more before the next dividend because the token is undervalued."
          : "Rebasing balances change without Transfer events, so integrations that cache balances or track shares separately need to account for the new multiplier.",
      evidenceIds: ["EV-CA"],
      quantities: [],
    },
  ];

  return {
    // an honest template does not announce a confirmation the core checks did not give; the one that hides its conflicts does
    headline: coreUnsettled && behaviour !== "hides_conflict" ? "Multiplier change reported by the issuer is disputed by the desk's core checks" : "Multiplier change confirmed against X Layer contract state",
    whatHappened,
    whyItMayMatter: why,
    onchainObservations: onchain,
    confidence: { level: confidenceFor(evidence, failedChecks, behaviour), rationale: "Issuer record and on-chain reads were compared by deterministic checks." },
    unknowns: ["Deployments on other chains were not read."],
    conflicts: behaviour === "hides_conflict" ? [] : failedChecks.map((id) => ({ checkId: id, description: `Deterministic check ${id} failed; see the check detail.` })),
    limitations: ["Issuer-reported figures are not independently audited by Bullseye."],
  };
}

function confidenceFor(evidence: EvidenceItem[], failedChecks: string[], behaviour: FixtureBehaviour): BriefDraft["confidence"]["level"] {
  if (behaviour === "hides_conflict") return "HIGH";
  if (failedChecks.some((id) => /^CHK-(BEFORE|AFTER|LATEST)-/.test(id))) return "LOW";
  return evidence.every((e) => e.provenance.mode === "LIVE") && failedChecks.length === 0 ? "HIGH" : "MEDIUM";
}
