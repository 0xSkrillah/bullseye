import type { Health } from "../lib/api";

/** The pipeline after SOURCES, left to right; one node per stage on every row of the board. */
export const BOARD_STAGES = ["SIGNAL", "INVESTIGATION", "GATE", "BRIEF", "PAYMENT", "DELIVERY", "ECONOMICS"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

/** the product's promise about an order whose payment outcome is unknown; said, word for word, wherever the room shows that state */
export const RETRY_PROMISE = "A retry cannot charge you twice.";

/** the wall holds this many board lines without scrolling; any more are counted in words, never dropped silently */
export const BOARD_ROWS = 14;

/** A stage the desk cannot run today, and the reason in the health check's own terms. */
export function blockedStages(health: Health | null): Partial<Record<BoardStage, string>> {
  if (!health) return {};
  const out: Partial<Record<BoardStage, string>> = {};
  if (!health.synthesis.ready) out.INVESTIGATION = "investigation cannot run: model not ready";
  if (!health.paymentRail.ready) out.PAYMENT = "payment cannot settle: rail not ready";
  return out;
}
