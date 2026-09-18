import { z } from "zod";

/**
 * Every piece of external data carries exactly one of these labels.
 *  LIVE       fetched from the named source during this operation
 *  CACHED     a previously fetched LIVE response, served because the source failed
 *  HISTORICAL a replayed recording of a real past response from the named source
 *  FIXTURE    synthetic data for tests; never sourced from a real system
 */
export const DataMode = z.enum(["LIVE", "CACHED", "HISTORICAL", "FIXTURE"]);
export type DataMode = z.infer<typeof DataMode>;

export const Provenance = z.object({
  mode: DataMode,
  source: z.string().min(1),
  url: z.string().min(1),
  fetchedAt: z.string().datetime(),
  /** sha256 of the raw response body, or of the canonical JSON of a decoded chain read */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export interface Sourced<T> {
  data: T;
  provenance: Provenance;
}

const RANK: Record<DataMode, number> = { LIVE: 0, CACHED: 1, HISTORICAL: 2, FIXTURE: 3 };

/** The weakest label wins: one FIXTURE input makes the whole product FIXTURE. */
export function weakestMode(modes: DataMode[]): DataMode {
  if (modes.length === 0) throw new Error("weakestMode: no modes supplied");
  return modes.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));
}
