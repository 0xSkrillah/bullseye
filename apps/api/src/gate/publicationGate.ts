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

export const GATE_VERSION = "1.0.0";

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

/** integers this small are treated as prose ("2 sources"), not as market data */
const SMALL_INTEGER_MAX = 12;

interface NumberToken {
  raw: string;
  value: number;
  decimals: number;
}

export function extractNumberTokens(text: string): { numbers: NumberToken[]; timestamps: string[] } {
  const timestamps: string[] = [];
  let scrubbed = text
    .replace(/\b(EV|CHK)-[A-Z0-9-]+\b/g, " ")
    .replace(/\b0x[0-9a-fA-F]+\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?\b/g, (m) => {
      timestamps.push(m);
      return " ";
    })
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, (m) => {
      timestamps.push(m);
      return " ";
    });
  // identifiers such as "x402" or "v2" are names, not quantities
  scrubbed = scrubbed.replace(/\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g, " ");
  const numbers: NumberToken[] = [];
  for (const m of scrubbed.matchAll(/(?<![\w.])-?\d[\d,]*(\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    numbers.push({ raw: m[0], value, decimals: raw.includes(".") ? raw.split(".")[1]!.length : 0 });
  }
  return { numbers, timestamps };
}

function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** A number in prose is evidenced when it is some evidence value, that value's magnitude, or its percentage form, at the precision written. */
function numberIsEvidenced(token: NumberToken, candidates: number[]): boolean {
  if (token.decimals === 0 && Math.abs(token.value) <= SMALL_INTEGER_MAX) return true;
  const target = Math.abs(token.value);
  return candidates.some((c) => {
    const forms = [Math.abs(c), Math.abs(c) * 100];
    return forms.some((f) => Math.abs(roundTo(f, token.decimals) - target) < 10 ** -(token.decimals + 3));
  });
}

function numericValues(items: EvidenceItem[]): number[] {
  return items.flatMap((e) => Object.values(e.values).filter((v): v is number => typeof v === "number"));
}

function stringValues(items: EvidenceItem[]): string[] {
  return items.flatMap((e) => [e.observedAt, e.provenance.fetchedAt, ...Object.values(e.values).filter((v): v is string => typeof v === "string")]);
}

function timestampIsEvidenced(ts: string, haystack: string[]): boolean {
  const needle = ts.replace(/Z$/, "");
  return haystack.some((h) => h.includes(needle));
}

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
      else if (Math.abs(actual - q.value) > Math.max(1e-9, Math.abs(actual) * 1e-9)) badQuantities.push(`${section}: "${q.label}" says ${q.value} but ${q.evidenceId}.${q.valueKey} is ${actual}`);
    }
  }
  record("QUANTITIES_RESOLVE_TO_EVIDENCE", badQuantities.length === 0, badQuantities.length === 0 ? "every declared quantity equals its evidence value" : badQuantities.join("; "));

  const unevidenced: string[] = [];
  const checkText = (where: string, text: string, items: EvidenceItem[], extra: number[]) => {
    const { numbers, timestamps } = extractNumberTokens(text);
    const candidates = [...numericValues(items), ...extra];
    for (const n of numbers) if (!numberIsEvidenced(n, candidates)) unevidenced.push(`${where}: "${n.raw}"`);
    const haystack = stringValues(items);
    for (const ts of timestamps) if (!timestampIsEvidenced(ts, haystack)) unevidenced.push(`${where}: "${ts}"`);
  };
  for (const { section, claim } of claims) {
    const cited = claim.evidenceIds.map((id) => byId.get(id)).filter((e): e is EvidenceItem => e !== undefined);
    checkText(section, claim.text, cited, claim.quantities.map((q) => q.value));
  }
  const free: [string, string][] = [
    ["headline", draft.headline],
    ["confidence.rationale", draft.confidence.rationale],
    ...draft.unknowns.map((t, i): [string, string] => [`unknowns[${i}]`, t]),
    ...draft.limitations.map((t, i): [string, string] => [`limitations[${i}]`, t]),
    ...draft.conflicts.map((c, i): [string, string] => [`conflicts[${i}]`, c.description]),
  ];
  for (const [where, text] of free) checkText(where, text, input.evidence, []);
  record(
    "NUMBERS_IN_TEXT_ARE_EVIDENCED",
    unevidenced.length === 0,
    unevidenced.length === 0 ? "every number and timestamp in the text resolves to collected evidence" : `not found in evidence: ${unevidenced.join(", ")}`,
  );

  const allText: [string, string][] = [...claims.map(({ section, claim }): [string, string] => [section, claim.text]), ...free];
  const advice = allText.flatMap(([where, text]) => ADVICE_PATTERNS.filter((p) => p.test(text)).map((p) => `${where}: matches ${p.source}`));
  record("NO_INVESTMENT_ADVICE", advice.length === 0, advice.length === 0 ? "no advisory language found" : advice.join("; "));

  const failed = input.checks.filter((c) => c.status === "FAIL").map((c) => c.id);
  const disclosed = new Set(draft.conflicts.map((c) => c.checkId));
  const hidden = failed.filter((id) => !disclosed.has(id));
  record(
    "FAILED_CHECKS_DISCLOSED",
    hidden.length === 0,
    hidden.length === 0 ? (failed.length === 0 ? "no failed checks" : `all failed checks disclosed: ${failed.join(", ")}`) : `failed checks missing from conflicts: ${hidden.join(", ")}`,
  );

  record(
    "CONFIDENCE_WITHIN_CAP",
    RANK[draft.confidence.level] <= RANK[cap],
    `draft claims ${draft.confidence.level}; evidence and checks allow at most ${cap}`,
  );

  return finish();
}
