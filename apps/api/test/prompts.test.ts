import { describe, expect, it } from "vitest";
import type { GateResult } from "@bullseye/domain";
import { BRIEF_DRAFT_JSON_SCHEMA, revisionPrompt, synthesisPrompt, SYSTEM_PROMPT } from "../src/research/prompts.js";
import { CANONICAL_UNIT, VALUE_UNITS, unitAccepted, unitGuide } from "../src/gate/numericGrounding.js";

type Schema = { properties?: Record<string, Schema>; items?: Schema; required?: string[] };

/** every property name anywhere in the schema the provider is sent */
function keys(schema: Schema, out = new Set<string>()): Set<string> {
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    out.add(name);
    keys(child, out);
  }
  if (schema.items) keys(schema.items, out);
  return out;
}

const gate = (rule: string): GateResult => ({ decision: "REJECT", gateVersion: "1.0.0", confidenceCap: "LOW", findings: [{ rule, passed: false, detail: "whatHappened: Expected array, received string" }] }) as unknown as GateResult;

describe("the writing prompt", () => {
  // a router may pick an endpoint that accepts response_format without enforcing it; the prompt is then the model's only source for the shape
  it("spells out every key of the schema, so the shape does not depend on the endpoint enforcing it", () => {
    const prompt = synthesisPrompt([], []);
    for (const key of keys(BRIEF_DRAFT_JSON_SCHEMA as Schema)) expect(prompt, key).toContain(`"${key}"`);
    expect(prompt).toContain("never a string");
  });

  it("carries no sample values a model could copy into a Brief", () => {
    const shape = synthesisPrompt([], []).split("Write the brief now")[1]!;
    expect(shape).not.toMatch(/"value":\s*[0-9]/);
    expect(shape).not.toMatch(/EV-[A-Z]/);
    // the rules about figures are themselves written without a single figure
    expect(shape).not.toMatch(/\d/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d/);
    expect(unitGuide()).not.toMatch(/\d/);
  });

  it("names the unit of every registered value key, and the gate accepts the unit it names", () => {
    const prompt = synthesisPrompt([], []);
    for (const specs of Object.values(VALUE_UNITS)) {
      for (const [key, spec] of Object.entries(specs)) {
        const line = prompt.split("\n").find((l) => l.startsWith(`- "${CANONICAL_UNIT[spec.unit]}":`));
        expect(line, key).toBeDefined();
        expect(line!.split(/[:,]\s*/), key).toContain(key);
        expect(unitAccepted(CANONICAL_UNIT[spec.unit], spec), key).toBe(true);
      }
    }
  });

  it("tells the writer how figures are judged: declared, typed, signed, counted, not spelled out", () => {
    const prompt = synthesisPrompt([], []);
    for (const phrase of [`declared in that claim's "quantities"`, 'followed directly by "%"', '"USD"', "Keep the sign", "two significant digits", 'beside "before"', "real counts", "spelled-out", "incidental numerals"]) expect(prompt, phrase).toContain(phrase);
  });

  it("repeats the shape in a revision only when the rejection was about the shape", () => {
    expect(revisionPrompt(gate("SCHEMA"))).toContain('"onchainObservations": Claim[]');
    expect(revisionPrompt(gate("NO_ADVICE"))).not.toContain("Claim[]");
  });

  it("repeats the rules about figures in a revision only when the rejection was about figures", () => {
    expect(revisionPrompt(gate("NUMBERS_IN_TEXT_ARE_EVIDENCED"))).toContain('"unit" is fixed by "valueKey"');
    expect(revisionPrompt(gate("QUANTITIES_RESOLVE_TO_EVIDENCE"))).toContain('"unit" is fixed by "valueKey"');
    expect(revisionPrompt(gate("NO_INVESTMENT_ADVICE"))).not.toContain("valueKey");
    expect(revisionPrompt(gate("FAILED_CHECKS_DISCLOSED"))).toContain("report the disagreement");
  });
});
