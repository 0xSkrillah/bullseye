import { describe, expect, it } from "vitest";
import type { GateResult } from "@bullseye/domain";
import { BRIEF_DRAFT_JSON_SCHEMA, revisionPrompt, synthesisPrompt } from "../src/research/prompts.js";

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
  });

  it("repeats the shape in a revision only when the rejection was about the shape", () => {
    expect(revisionPrompt(gate("SCHEMA"))).toContain('"onchainObservations": Claim[]');
    expect(revisionPrompt(gate("NO_ADVICE"))).not.toContain("Claim[]");
  });
});
