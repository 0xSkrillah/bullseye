import { z } from "zod";
import { DataMode } from "./provenance.js";
import { ConsistencyCheck, EvidenceItem } from "./evidence.js";
import { SignalEvent } from "./signal.js";
import { StopReason } from "./budget.js";

export const Quantity = z.object({
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  evidenceId: z.string(),
  /** key inside EvidenceItem.values that holds this number */
  valueKey: z.string(),
});
export type Quantity = z.infer<typeof Quantity>;

export const Claim = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
  quantities: z.array(Quantity),
});
export type Claim = z.infer<typeof Claim>;

export const ConfidenceLevel = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

/** What the model is allowed to author. Everything else in a Brief is written by code. */
export const BriefDraft = z.object({
  headline: z.string().min(1).max(160),
  whatHappened: z.array(Claim).min(1),
  whyItMayMatter: z.array(Claim).min(1),
  onchainObservations: z.array(Claim).min(1),
  confidence: z.object({ level: ConfidenceLevel, rationale: z.string().min(1) }),
  unknowns: z.array(z.string().min(1)).min(1),
  conflicts: z.array(z.object({ checkId: z.string(), description: z.string().min(1) })),
  limitations: z.array(z.string().min(1)).min(1),
});
export type BriefDraft = z.infer<typeof BriefDraft>;

export const GateRule = z.enum([
  "SCHEMA",
  "INVESTIGATION_COMPLETED",
  "MANDATORY_EVIDENCE_PRESENT",
  "EVIDENCE_FRESH",
  "EVIDENCE_MODE_ALLOWED",
  "CLAIMS_CITE_KNOWN_EVIDENCE",
  "QUANTITIES_RESOLVE_TO_EVIDENCE",
  "NUMBERS_IN_TEXT_ARE_EVIDENCED",
  "NO_INVESTMENT_ADVICE",
  "FAILED_CHECKS_DISCLOSED",
  "CONFIDENCE_WITHIN_CAP",
]);
export type GateRule = z.infer<typeof GateRule>;

export const GateFinding = z.object({ rule: GateRule, passed: z.boolean(), detail: z.string() });
export type GateFinding = z.infer<typeof GateFinding>;

export const GateResult = z.object({
  decision: z.enum(["PUBLISH", "REJECT"]),
  evaluatedAt: z.string().datetime(),
  gateVersion: z.string(),
  confidenceCap: ConfidenceLevel,
  findings: z.array(GateFinding),
});
export type GateResult = z.infer<typeof GateResult>;

export const Synthesis = z.object({
  provider: z.string(),
  model: z.string(),
  mode: z.enum(["LIVE", "FIXTURE"]),
  /** when `model` is a router, the models it actually chose for this investigation */
  routedModels: z.array(z.string()).optional(),
});
export type Synthesis = z.infer<typeof Synthesis>;

export const BRIEF_SCHEMA_ID = "bullseye.brief/v1";

export const Brief = z.object({
  schema: z.literal(BRIEF_SCHEMA_ID),
  id: z.string().regex(/^brf_[0-9a-f]{16}$/),
  investigationId: z.string(),
  publishedAt: z.string().datetime(),
  dataMode: DataMode,
  synthesis: Synthesis,
  signal: SignalEvent,
  draft: BriefDraft,
  evidence: z.array(EvidenceItem),
  checks: z.array(ConsistencyCheck),
  gate: GateResult,
  disclaimer: z.string(),
  /** sha256 over the canonical JSON of every field above */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Brief = z.infer<typeof Brief>;

/** Free preview shown before purchase. Carries no paid findings. */
export const BriefPreview = z.object({
  id: z.string(),
  headline: z.string(),
  publishedAt: z.string(),
  dataMode: DataMode,
  synthesis: Synthesis,
  signalId: z.string(),
  asset: z.string(),
  confidence: ConfidenceLevel,
  evidenceCount: z.number().int(),
  evidenceKinds: z.array(z.string()),
  unknownCount: z.number().int(),
  conflictCount: z.number().int(),
  contentHash: z.string(),
});
export type BriefPreview = z.infer<typeof BriefPreview>;

export const InvestigationStatus = z.enum(["RUNNING", "PUBLISHED", "REJECTED", "STOPPED"]);
export type InvestigationStatus = z.infer<typeof InvestigationStatus>;

export const TimelineEntry = z.object({
  seq: z.number().int(),
  at: z.string().datetime(),
  type: z.enum(["STARTED", "MODEL_CALL", "TOOL_CALL", "EVIDENCE", "CHECKS", "GATE", "STOPPED", "PUBLISHED", "REJECTED"]),
  label: z.string(),
  detail: z.string().nullable(),
  evidenceId: z.string().nullable(),
  ok: z.boolean(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const InvestigationView = z.object({
  id: z.string(),
  signalId: z.string(),
  status: InvestigationStatus,
  stopReason: StopReason.nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  briefId: z.string().nullable(),
  gate: GateResult.nullable(),
  timeline: z.array(TimelineEntry),
});
export type InvestigationView = z.infer<typeof InvestigationView>;

export const DISCLAIMER =
  "Bullseye Briefs describe observed market-structure events and the evidence for them. They are not investment, legal or tax advice and contain no recommendation to buy, sell or hold any asset.";
