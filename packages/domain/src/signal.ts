import { z } from "zod";
import { DataMode, Provenance } from "./provenance.js";

export const SignalCategory = z.enum(["CORPORATE_ACTION_REBASE"]);
export type SignalCategory = z.infer<typeof SignalCategory>;

export const AssetRef = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  isin: z.string().nullable(),
  underlyingSymbol: z.string().min(1),
  network: z.literal("XLayer"),
  chainId: z.literal(196),
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
export type AssetRef = z.infer<typeof AssetRef>;

export const RebaseFacts = z.object({
  corporateActionId: z.string(),
  corporateActionVersion: z.number().int(),
  caType: z.string(),
  status: z.string(),
  multiplierOld: z.string(),
  multiplierNew: z.string(),
  /** (new / old - 1) * 100, rounded to 6 dp by the detector */
  changePct: z.number(),
  grossCashflowUsd: z.string().nullable(),
  netCashflowUsd: z.string().nullable(),
  withholdingTaxRate: z.string().nullable(),
});
export type RebaseFacts = z.infer<typeof RebaseFacts>;

export const SignalEvent = z.object({
  id: z.string().regex(/^sig_[0-9a-f]{16}$/),
  category: SignalCategory,
  asset: AssetRef,
  /** when the event took effect according to the source */
  observedAt: z.string().datetime(),
  /** when the detector first saw it */
  detectedAt: z.string().datetime(),
  headline: z.string().min(1),
  reasonFlagged: z.string().min(1),
  facts: RebaseFacts,
  sources: z.array(Provenance).min(1),
  provenance: z.object({
    mode: DataMode,
    detector: z.string(),
    detectorVersion: z.string(),
    /** sha256 over the canonical detector inputs for this signal */
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});
export type SignalEvent = z.infer<typeof SignalEvent>;
