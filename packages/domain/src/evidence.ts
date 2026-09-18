import { z } from "zod";
import { Provenance } from "./provenance.js";

export const EvidenceKind = z.enum([
  "CORPORATE_ACTION_RECORD",
  "ISSUER_MULTIPLIER_STATE",
  "ONCHAIN_MULTIPLIER_BEFORE",
  "ONCHAIN_MULTIPLIER_AFTER",
  "ONCHAIN_MULTIPLIER_LATEST",
  "ONCHAIN_ACTIVATION_BLOCK",
  "PROOF_OF_RESERVES",
  "REFERENCE_PRICE",
  "TRADING_STATUS",
  "SUPPLY",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EvidenceValue = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export type EvidenceValue = z.infer<typeof EvidenceValue>;

export const EvidenceItem = z.object({
  id: z.string().regex(/^EV-[A-Z0-9-]+$/),
  investigationId: z.string(),
  kind: EvidenceKind,
  /** deterministic, code-written description of what this item shows */
  summary: z.string(),
  /** flat map of machine-checkable values; quantities in a Brief must resolve here */
  values: z.record(EvidenceValue),
  /** the instant the values describe (block timestamp, source timestamp) */
  observedAt: z.string().datetime(),
  /** after this instant the item is stale and cannot support publication */
  staleAfter: z.string().datetime(),
  provenance: Provenance,
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const CheckStatus = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const ConsistencyCheck = z.object({
  id: z.string().regex(/^CHK-[A-Z0-9-]+$/),
  description: z.string(),
  status: CheckStatus,
  detail: z.string(),
  evidenceIds: z.array(z.string()),
});
export type ConsistencyCheck = z.infer<typeof ConsistencyCheck>;
