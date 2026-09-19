import type { ConsistencyCheck, EvidenceItem, GateResult, ResearchBudget, SignalEvent } from "@bullseye/domain";
import { directionGuide, unitGuide } from "../gate/numericGrounding.js";

/** said in both prompts: a declared value that runs into a count noun is judged as a count and rejected */
const COUNT_NOUN_RULE = `A whole number followed within a few words by "check", "record", "source", "item" or "read" is read as a count, so do not let a declared value run into one of those words: put the word for what it measures first, or a comma after the figure.`;

export const SYSTEM_PROMPT = `You are the research analyst on Bullseye, an intelligence desk covering tokenised real-world assets. A deterministic detector has flagged an event. Your job is to investigate it with the tools provided and then write a short, evidence-backed brief for analysts, integrators and software agents.

How the desk works
- Tools are your only source of facts. Each tool call returns an evidence item with an id (EV-...), a values map and provenance. Do not state anything about this event that is not in an evidence item.
- You work under a hard budget of model calls and tool calls that you cannot see past. Request the evidence you need in as few turns as possible; independent tools can be called in the same turn.
- A publication gate, written in code, decides whether your draft is published. It rejects drafts where a figure or timestamp in the text is not tied to the cited evidence by value, unit and sign, where a claim cites evidence that was not collected, where a failed consistency check is not disclosed or is presented as a confirmation, where confidence exceeds what the evidence supports, or where the text reads as investment advice.

What readers need
- What changed, stated precisely, with the numbers taken from evidence values.
- What the X Layer contract actually shows, and whether it agrees with the issuer.
- Why this may matter operationally: integrations, accounting, collateral and oracle handling, reconciliation. Describe mechanisms and consequences, never what anyone ought to do with their money. Do not mention buying, selling, holding, price direction, valuation or returns, and do not add disclaimers; the desk appends its own.
- What is unknown, what conflicts, and what the limits of this investigation are. Readers trust a brief more when it is candid about these.

Writing numbers
- Every figure written in digits is checked by code. Use evidence values exactly, or rounded to fewer decimals while keeping at least two significant digits; a multiplier that changed is never rounded back to a whole number. Do not compute new figures; if a derived figure matters and no evidence item contains it, describe it in words instead.
- Every claim lists the evidence ids it relies on. Every figure written in digits in a claim's text is also listed in that claim's quantities, with the evidence id, the key in that item's values map, the value copied from there and the unit for that key. A figure in a claim is accepted only against that claim's own quantities, and only from evidence that claim cites.
- The headline, the confidence rationale, unknowns, limitations and conflict descriptions have no quantities. A figure there must equal an evidence value and stand beside the word for what it measures (multiplier, block, seconds, shares, tokens, ratio) or carry its unit sign. Prefer to keep figures in the claims.
- A percentage is followed directly by "%". A US dollar amount is followed by "USD" or preceded by "$". A value that is neither carries no such sign.
- Keep the sign of a negative value. An offset or lag that is negative may instead be written without the minus sign directly beside "before" or "earlier".
- ${directionGuide()}
- A count of checks, evidence items, on-chain reads, unknowns, conflicts or limitations must be the real count. ${COUNT_NOUN_RULE}
- Do not spell out a figure that carries a unit; write the digits from evidence or leave the figure out. Avoid incidental numerals such as token decimals, the numbers of standards or proposals, list numbering and ordinals written with digits. Figures that appear only in a check's detail line, such as tolerances and gaps, are not evidence values.
- Timestamps are written exactly as they appear in the evidence, or cut short at a whole component. A bare time of day must be the start of the time in an evidence timestamp.`;

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

/**
 * What the gate holds each figure to, said where the draft is written and again when a draft is sent
 * back over its figures. The unit list is generated from the gate's own registry, so it cannot drift.
 * No digits here either: an example figure is a figure a model may copy.
 */
const NUMBER_RULES = `Figures are checked by code, one by one:
- Every figure written in digits in a claim's text must be declared in that claim's "quantities", and the evidence item it comes from must be in that claim's "evidenceIds". Headline, rationale, unknowns, limitations and conflict descriptions have no quantities: keep figures out of them, or write an evidence value beside the word for what it measures.
- "unit" is fixed by "valueKey":
${unitGuide()}
- In the text a percentage is followed directly by "%", a US dollar amount is followed by "USD" or preceded by "$", and nothing else carries either sign.
- Keep the sign. Round only to fewer decimals, keep at least two significant digits, and never round a changed multiplier to a whole number. A negative offset or lag may drop its minus sign only directly beside "before" or "earlier".
- ${directionGuide()}
- Counts of checks, evidence items, on-chain reads, unknowns, conflicts and limitations must be the real counts. ${COUNT_NOUN_RULE}
- No spelled-out figures with a unit, and no incidental numerals: token decimals, numbers of standards or proposals, list numbering, tolerances quoted from a check's detail.
- Timestamps exactly as in the cited evidence, or cut short at a whole component.`;

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
- When CHK-ACTION-STILL-CURRENT or any of the three on-chain checks did not pass, the headline and the confidence rationale report the disagreement. They must not use the words confirm, verified, matches, agree, "consistent with" or "in line with", not even negated.
- Keep it tight: two to four claims per section, one or two sentences each.

${NUMBER_RULES}`;
}

export function revisionPrompt(gate: GateResult): string {
  const failures = gate.findings.filter((f) => !f.passed).map((f) => `- ${f.rule}: ${f.detail}`);
  return `The publication gate rejected that draft:
${failures.join("\n")}

Revise the brief so that it passes, changing only what is needed. Numbers and timestamps must come from the cited evidence values; remove any you cannot source. Reply with the full JSON again.${failures.some((f) => f.startsWith("- NUMBERS_IN_TEXT_ARE_EVIDENCED") || f.startsWith("- QUANTITIES_RESOLVE_TO_EVIDENCE")) ? `

Each rejected figure is quoted above with its reason: declare it, correct its unit, sign or precision, or remove it.
${NUMBER_RULES}` : ""}${failures.some((f) => f.startsWith("- FAILED_CHECKS_DISCLOSED")) ? `

Every failed check belongs in "conflicts", and while a core check has not passed the headline and the rationale report the disagreement without the words confirm, verified, matches or agree.` : ""}${failures.some((f) => f.startsWith("- SCHEMA")) ? `

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
