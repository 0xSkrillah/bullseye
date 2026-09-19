import type { ConsistencyCheck, EvidenceItem, GateResult, ResearchBudget, SignalEvent } from "@bullseye/domain";

export const SYSTEM_PROMPT = `You are the research analyst on Bullseye, an intelligence desk covering tokenised real-world assets. A deterministic detector has flagged an event. Your job is to investigate it with the tools provided and then write a short, evidence-backed brief for analysts, integrators and software agents.

How the desk works
- Tools are your only source of facts. Each tool call returns an evidence item with an id (EV-...), a values map and provenance. Do not state anything about this event that is not in an evidence item.
- You work under a hard budget of model calls and tool calls that you cannot see past. Request the evidence you need in as few turns as possible; independent tools can be called in the same turn.
- A publication gate, written in code, decides whether your draft is published. It rejects drafts where a number or timestamp in the text is absent from the cited evidence, where a claim cites evidence that was not collected, where a failed consistency check is not disclosed, where confidence exceeds what the evidence supports, or where the text reads as investment advice.

What readers need
- What changed, stated precisely, with the numbers taken from evidence values.
- What the X Layer contract actually shows, and whether it agrees with the issuer.
- Why this may matter operationally: integrations, accounting, collateral and oracle handling, reconciliation. Describe mechanisms and consequences, never what anyone ought to do with their money. Do not mention buying, selling, holding, price direction, valuation or returns, and do not add disclaimers; the desk appends its own.
- What is unknown, what conflicts, and what the limits of this investigation are. Readers trust a brief more when it is candid about these.

Writing numbers
- Use numbers exactly as they appear in evidence values, or rounded to fewer decimals. Do not compute new figures; if a derived figure matters and no evidence item contains it, describe it in words instead.
- Every claim lists the evidence ids it relies on. Every number that appears in a claim's text is also listed in that claim's quantities with the evidence id and the key in that item's values map.
- Timestamps are written exactly as they appear in the evidence.`;

export function taskPrompt(signal: SignalEvent, budget: ResearchBudget): string {
  return `Investigate this signal.

${JSON.stringify(
    {
      id: signal.id,
      category: signal.category,
      asset: signal.asset,
      observedAt: signal.observedAt,
      detectedAt: signal.detectedAt,
      reasonFlagged: signal.reasonFlagged,
      facts: signal.facts,
      dataMode: signal.provenance.mode,
    },
    null,
    2,
  )}

Budget for this investigation: at most ${budget.maxModelCalls} model calls and ${budget.maxToolCalls} tool calls in total, including the final writing step.

Publication needs at least: the corporate-action record, the on-chain multiplier before the effective time, after it, and at the chain head, and the proof-of-reserves record. The other tools add useful context when the budget allows.

Collect evidence now. When you have what you need, stop calling tools and reply with the single word READY. You will then receive the results of the desk's consistency checks and be asked for the brief.`;
}

/**
 * The schema is also sent as response_format, but a router can pick an endpoint that accepts that
 * parameter without enforcing it. Then the prompt is the only place the model can learn the shape,
 * so it is spelled out here. Types only, no sample values: a sample number is a number a model may copy.
 */
const SHAPE_INSTRUCTIONS = `The object must have exactly these keys and types. No wrapper object, no extra keys, no markdown fences, no text before or after the JSON.
{
  "headline": string,
  "whatHappened": Claim[],
  "whyItMayMatter": Claim[],
  "onchainObservations": Claim[],
  "confidence": { "level": "HIGH" | "MEDIUM" | "LOW", "rationale": string },
  "unknowns": string[],            // at least one
  "conflicts": { "checkId": string, "description": string }[],
  "limitations": string[]          // at least one
}
Claim = { "text": string, "evidenceIds": string[], "quantities": Quantity[] }
Quantity = { "label": string, "value": number, "unit": string, "evidenceId": string, "valueKey": string }
The three claim sections are arrays of Claim objects, never a string. "quantities" is an array and may be empty. "value" is a JSON number copied from values[valueKey] of the evidence item named in "evidenceId".`;

export function synthesisPrompt(evidence: EvidenceItem[], checks: ConsistencyCheck[]): string {
  const checkLines = checks.map((c) => `${c.id} ${c.status} - ${c.description} (${c.detail})`).join("\n");
  const modes = [...new Set(evidence.map((e) => e.provenance.mode))].join(", ");
  return `Evidence collected: ${evidence.map((e) => e.id).join(", ")}. Data modes present: ${modes}.

These are the evidence items as the publication gate holds them. Where a tool was called more than once, only the item below counts; use no value that is not in it.
${JSON.stringify(evidence)}

Consistency checks computed by the desk from that evidence:
${checkLines}

Write the brief now as one JSON object.
${SHAPE_INSTRUCTIONS}
- Every check with status FAIL must appear in "conflicts" with its checkId and a plain description of the disagreement. If no check failed, "conflicts" is an empty array.
- Checks with status UNKNOWN belong in "unknowns".
- Confidence: HIGH only when every check passed and all mandatory evidence is LIVE; MEDIUM when some evidence is CACHED or HISTORICAL or a non-core check failed; LOW when CHK-ACTION-STILL-CURRENT or any of the three on-chain checks failed or is unknown.
- Keep it tight: 2-4 claims per section, one or two sentences each.`;
}

export function revisionPrompt(gate: GateResult): string {
  const failures = gate.findings.filter((f) => !f.passed).map((f) => `- ${f.rule}: ${f.detail}`);
  return `The publication gate rejected that draft:
${failures.join("\n")}

Revise the brief so that it passes, changing only what is needed. Numbers and timestamps must come from the cited evidence values; remove any you cannot source. Reply with the full JSON again.${failures.some((f) => f.startsWith("- SCHEMA")) ? `

The draft did not have the required shape.
${SHAPE_INSTRUCTIONS}` : ""}`;
}

/** JSON Schema handed to the model for the final step. Validation proper is done with the zod BriefDraft schema. */
export const BRIEF_DRAFT_JSON_SCHEMA: Record<string, unknown> = (() => {
  const claim = {
    type: "object",
    properties: {
      text: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" } },
      quantities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "number" },
            unit: { type: "string" },
            evidenceId: { type: "string" },
            valueKey: { type: "string" },
          },
          required: ["label", "value", "unit", "evidenceId", "valueKey"],
          additionalProperties: false,
        },
      },
    },
    required: ["text", "evidenceIds", "quantities"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      headline: { type: "string" },
      whatHappened: { type: "array", items: claim },
      whyItMayMatter: { type: "array", items: claim },
      onchainObservations: { type: "array", items: claim },
      confidence: {
        type: "object",
        properties: { level: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] }, rationale: { type: "string" } },
        required: ["level", "rationale"],
        additionalProperties: false,
      },
      unknowns: { type: "array", items: { type: "string" } },
      conflicts: {
        type: "array",
        items: {
          type: "object",
          properties: { checkId: { type: "string" }, description: { type: "string" } },
          required: ["checkId", "description"],
          additionalProperties: false,
        },
      },
      limitations: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "whatHappened", "whyItMayMatter", "onchainObservations", "confidence", "unknowns", "conflicts", "limitations"],
    additionalProperties: false,
  };
})();
