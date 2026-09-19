import {
  BriefDraft,
  type Claim,
  type ConfidenceLevel,
  type ConsistencyCheck,
  type EvidenceItem,
  type GateFinding,
  type GateResult,
  type GateRule,
  type StopReason,
  type Synthesis,
} from "@bullseye/domain";
import { CORE_CHECKS } from "../evidence/checks.js";
import { MANDATORY_EVIDENCE } from "../evidence/toolbox.js";
import { CANONICAL_UNIT, fieldSpec, ungroundedFigures, unitAccepted } from "./numericGrounding.js";

export { extractNumberTokens } from "./numericGrounding.js";

/** 2.0.0: figures bind to declared quantities by unit, sign and precision; no small-integer exemption */
export const GATE_VERSION = "2.0.0";

export interface GateInput {
  draft: unknown;
  evidence: EvidenceItem[];
  checks: ConsistencyCheck[];
  stopReason: StopReason;
  synthesis: Synthesis;
  /** freshness is judged at this instant: wall clock for live runs, capture time for HISTORICAL replays */
  asOf: Date;
  allowFixture: boolean;
}

/**
 * Phrases that turn a description of an event into a recommendation.
 * Deliberately blunt: a false positive costs one revision, a false negative publishes advice.
 */
const ADVICE_PATTERNS: RegExp[] = [
  /\b(buy|buying|sell|selling|hold)\b/i,
  /\b(go|going|stay|staying)\s+(long|short)\b/i,
  /\brecommend(s|ed|ation|ations)?\b/i,
  /\b(investors?|holders?|traders?|you)\s+should\b/i,
  /\bshould\s+(consider\s+)?(invest|purchase|acquire|accumulate|exit|reduce|increase|add|trim)\b/i,
  /\bprice\s+target\b/i,
  /\b(under|over)valued\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bwill\s+(rise|fall|rally|drop|outperform|underperform|appreciate|depreciate)\b/i,
  /\b(bullish|bearish)\b/i,
  /\b(attractive|good|great)\s+(entry|opportunity|investment)\b/i,
  /\bopportunity\s+to\s+profit\b/i,
  /\bexpected\s+return(s)?\b/i,
];

const RANK: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Words that present the event as settled. While a core check is not PASS the desk has not settled
 * it, and listing the conflict further down does not license a headline that says otherwise.
 */
const CONFIRMATION_LANGUAGE = /\b(confirm(s|ed|ation)?|verified|verifies|matches|agree(s|d)?|consistent with|in line with)\b/i;

export function computeConfidenceCap(evidence: EvidenceItem[], checks: ConsistencyCheck[]): ConfidenceLevel {
  const core = checks.filter((c) => (CORE_CHECKS as readonly string[]).includes(c.id));
  if (core.length < CORE_CHECKS.length || core.some((c) => c.status !== "PASS")) return "LOW";
  const mandatory = evidence.filter((e) => MANDATORY_EVIDENCE.includes(e.kind));
  if (mandatory.some((e) => e.provenance.mode !== "LIVE")) return "MEDIUM";
  if (checks.some((c) => c.status === "FAIL")) return "MEDIUM";
  return "HIGH";
}

/**
 * Decides whether a draft may be published. Pure: same input, same decision.
 * The model has no vote here; it cannot mark its own work as verified.
 */
export function evaluatePublication(input: GateInput): GateResult {
  const findings: GateFinding[] = [];
  const record = (rule: GateRule, passed: boolean, detail: string) => findings.push({ rule, passed, detail });
  const cap = computeConfidenceCap(input.evidence, input.checks);
  const finish = (): GateResult => ({
    decision: findings.every((f) => f.passed) ? "PUBLISH" : "REJECT",
    evaluatedAt: input.asOf.toISOString(),
    gateVersion: GATE_VERSION,
    confidenceCap: cap,
    findings,
  });

  record("INVESTIGATION_COMPLETED", input.stopReason === "COMPLETED", `investigation stop reason: ${input.stopReason}`);

  const parsed = BriefDraft.safeParse(input.draft);
  if (!parsed.success) {
    record(
      "SCHEMA",
      false,
      parsed.error.issues
        .slice(0, 6)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
    return finish();
  }
  record("SCHEMA", true, "draft matches BriefDraft");
  const draft = parsed.data;
  const byId = new Map(input.evidence.map((e) => [e.id, e]));

  const missing = MANDATORY_EVIDENCE.filter((kind) => !input.evidence.some((e) => e.kind === kind));
  record("MANDATORY_EVIDENCE_PRESENT", missing.length === 0, missing.length === 0 ? "all mandatory evidence kinds collected" : `missing: ${missing.join(", ")}`);

  const stale = input.evidence.filter((e) => Date.parse(e.staleAfter) < input.asOf.getTime());
  record(
    "EVIDENCE_FRESH",
    stale.length === 0,
    stale.length === 0 ? `all evidence fresh as of ${input.asOf.toISOString()}` : `stale as of ${input.asOf.toISOString()}: ${stale.map((e) => `${e.id} (stale after ${e.staleAfter})`).join(", ")}`,
  );

  const fixtureEvidence = input.evidence.filter((e) => e.provenance.mode === "FIXTURE").map((e) => e.id);
  const fixtureUsed = fixtureEvidence.length > 0 || input.synthesis.mode === "FIXTURE";
  record(
    "EVIDENCE_MODE_ALLOWED",
    !fixtureUsed || input.allowFixture,
    !fixtureUsed
      ? "no fixture data or fixture synthesis involved"
      : input.allowFixture
        ? "fixture inputs present and explicitly allowed (test configuration); the Brief is labelled FIXTURE"
        : `fixture inputs cannot be published: ${[...fixtureEvidence, ...(input.synthesis.mode === "FIXTURE" ? ["synthesis"] : [])].join(", ")}`,
  );

  const claims: { section: string; claim: Claim }[] = [
    ...draft.whatHappened.map((claim) => ({ section: "whatHappened", claim })),
    ...draft.whyItMayMatter.map((claim) => ({ section: "whyItMayMatter", claim })),
    ...draft.onchainObservations.map((claim) => ({ section: "onchainObservations", claim })),
  ];

  const unknownRefs = claims.flatMap(({ section, claim }) => claim.evidenceIds.filter((id) => !byId.has(id)).map((id) => `${section}: ${id}`));
  record("CLAIMS_CITE_KNOWN_EVIDENCE", unknownRefs.length === 0, unknownRefs.length === 0 ? `${claims.length} claims cite collected evidence` : `unknown evidence ids: ${unknownRefs.join(", ")}`);

  const badQuantities: string[] = [];
  for (const { section, claim } of claims) {
    for (const q of claim.quantities) {
      const item = byId.get(q.evidenceId);
      const actual = item?.values[q.valueKey];
      if (!item) badQuantities.push(`${section}: "${q.label}" cites unknown ${q.evidenceId}`);
      else if (!claim.evidenceIds.includes(q.evidenceId)) badQuantities.push(`${section}: "${q.label}" uses ${q.evidenceId} which the claim does not cite`);
      else if (typeof actual !== "number") badQuantities.push(`${section}: "${q.label}" -> ${q.evidenceId}.${q.valueKey} is not a number`);
      else {
        if (Math.abs(actual - q.value) > Math.max(1e-9, Math.abs(actual) * 1e-9)) badQuantities.push(`${section}: "${q.label}" says ${q.value} but ${q.evidenceId}.${q.valueKey} is ${actual}`);
        // the unit is the registry's, not the draft's: a quantity may name it but cannot choose it
        const spec = fieldSpec(item.kind, q.valueKey);
        if (!spec) badQuantities.push(`${section}: "${q.label}" -> ${q.evidenceId}.${q.valueKey} has no registered unit and cannot support a number`);
        else if (!unitAccepted(q.unit, spec)) badQuantities.push(`${section}: "${q.label}" declares unit "${q.unit}" but ${q.evidenceId}.${q.valueKey} is ${spec.unit}; use "${CANONICAL_UNIT[spec.unit]}"`);
      }
    }
  }
  record("QUANTITIES_RESOLVE_TO_EVIDENCE", badQuantities.length === 0, badQuantities.length === 0 ? "every declared quantity equals its evidence value and names its registered unit" : badQuantities.join("; "));

  const unevidenced = ungroundedFigures({ draft, evidence: input.evidence, checks: input.checks });
  record(
    "NUMBERS_IN_TEXT_ARE_EVIDENCED",
    unevidenced.length === 0,
    unevidenced.length === 0 ? "every figure and timestamp in the text is bound to collected evidence by unit, sign and precision" : `not grounded in evidence: ${unevidenced.join("; ")}`,
  );

  const free: [string, string][] = [
    ["headline", draft.headline],
    ["confidence.rationale", draft.confidence.rationale],
    ...draft.unknowns.map((t, i): [string, string] => [`unknowns[${i}]`, t]),
    ...draft.limitations.map((t, i): [string, string] => [`limitations[${i}]`, t]),
    ...draft.conflicts.map((c, i): [string, string] => [`conflicts[${i}]`, c.description]),
  ];
  const allText: [string, string][] = [...claims.map(({ section, claim }): [string, string] => [section, claim.text]), ...free];
  const advice = allText.flatMap(([where, text]) => ADVICE_PATTERNS.filter((p) => p.test(text)).map((p) => `${where}: matches ${p.source}`));
  record("NO_INVESTMENT_ADVICE", advice.length === 0, advice.length === 0 ? "no advisory language found" : advice.join("; "));

  const failed = input.checks.filter((c) => c.status === "FAIL").map((c) => c.id);
  const disclosed = new Set(draft.conflicts.map((c) => c.checkId));
  const hidden = failed.filter((id) => !disclosed.has(id));
  // a conflict listed under "conflicts" is not disclosed if the headline still announces a confirmation
  const unsettled = CORE_CHECKS.filter((id) => input.checks.find((c) => c.id === id)?.status !== "PASS");
  const dressed =
    unsettled.length === 0
      ? []
      : ([["headline", draft.headline], ["confidence.rationale", draft.confidence.rationale]] as const).flatMap(([where, text]) => {
          const phrase = CONFIRMATION_LANGUAGE.exec(text)?.[0];
          return phrase ? [`${where} says "${phrase}" while ${unsettled.join(", ")} did not pass`] : [];
        });
  record(
    "FAILED_CHECKS_DISCLOSED",
    hidden.length === 0 && dressed.length === 0,
    [...(hidden.length > 0 ? [`failed checks missing from conflicts: ${hidden.join(", ")}`] : []), ...dressed].join("; ") || (failed.length === 0 ? "no failed checks" : `all failed checks disclosed: ${failed.join(", ")}`),
  );

  record(
    "CONFIDENCE_WITHIN_CAP",
    RANK[draft.confidence.level] <= RANK[cap],
    `draft claims ${draft.confidence.level}; evidence and checks allow at most ${cap}`,
  );

  return finish();
}
