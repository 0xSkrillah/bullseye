import type { GateResult, InvestigationView, TimelineEntry } from "@bullseye/domain";
import type { RebaseChain } from "../research/investigator.js";

/**
 * Who is reading. PUBLIC is anyone: the free preview. DIAGNOSTIC is the operator or a holder of the
 * viewer token (and anyone on a localhost development desk): the desk's own working detail.
 * A buyer is neither; a buyer reads one order, with its claim token.
 */
export type Audience = "PUBLIC" | "DIAGNOSTIC";

export const WITHHELD = "Withheld from the public view: it is part of the Brief, or of the desk's own records.";

/**
 * What a Brief sells is what the chain showed, checked against the issuer: the reads, the activation
 * block, each check's verdict. Evidence summaries and per-check results say exactly that, so a
 * visitor sees that a step happened, when, and whether it succeeded, and not what it found.
 * Model and tool call details are the desk's working records (models routed to, tokens, cost).
 */
const DETAIL_IS_DIAGNOSTIC: ReadonlySet<TimelineEntry["type"]> = new Set(["EVIDENCE", "CHECKS", "MODEL_CALL", "TOOL_CALL"]);

/**
 * A run has something to protect while it may still publish, and once it has. Only a run that
 * finished with no Brief (REJECTED, STOPPED) has nothing to sell, and so nothing to withhold:
 * a run that is still RUNNING must not be readable in full for the two minutes before its Brief exists.
 */
export function mayStillSell(view: Pick<InvestigationView, "status" | "briefId">): boolean {
  return view.briefId !== null || view.status === "RUNNING";
}

function publicGate(gate: GateResult, protect: boolean): GateResult {
  // a rejected draft of a run that later publishes can quote figures the Brief sells
  if (!protect) return gate;
  // passed, the disclosure rule names the checks that failed, and a check's verdict is part of the Brief
  return { ...gate, findings: gate.findings.map((f) => (f.passed && f.rule !== "FAILED_CHECKS_DISCLOSED" ? f : { ...f, detail: WITHHELD })) };
}

/** what the CHECKS row says to a visitor while the counts are for sale; the row and a label stay, the wall display reads them */
const CHECKS_LABEL_PUBLIC = "Consistency checks computed";

/** `protect` is the caller's to widen: another run of the same signal may be what is on sale */
export function projectInvestigation(view: InvestigationView, audience: Audience, protect = mayStillSell(view)): InvestigationView & { audience: Audience } {
  if (audience === "DIAGNOSTIC") return { ...view, audience };
  return {
    ...view,
    audience,
    gate: view.gate ? publicGate(view.gate, protect) : null,
    gateAttempts: view.gateAttempts ? view.gateAttempts.map((g) => publicGate(g, protect)) : null,
    timeline: view.timeline.map((t) => {
      // "N passed, M failed, K unknown" is every verdict when M and K are zero
      if (t.type === "CHECKS" && protect) return { ...t, label: CHECKS_LABEL_PUBLIC, detail: null };
      return DETAIL_IS_DIAGNOSTIC.has(t.type) || (t.type === "GATE" && protect) ? { ...t, detail: null } : t;
    }),
  };
}

export interface UsageSummary {
  modelCalls: number;
  toolCalls: number;
  measuredModelCostUsd: number;
  upperBoundModelCostUsd: number;
  budgetSpentUsd: number;
  costBases: string[];
  costBasis: string | null;
  routedModels: string[];
}

/** counts are public; what a run cost and which models it was routed to are the desk's records. GET /api/desk/economics has the labelled totals. */
export type PublicUsage = Pick<UsageSummary, "modelCalls" | "toolCalls"> & { costsWithheld: true };

export function projectUsage(usage: UsageSummary, audience: Audience): (UsageSummary & { costsWithheld: false }) | PublicUsage {
  if (audience === "DIAGNOSTIC") return { ...usage, costsWithheld: false };
  return { modelCalls: usage.modelCalls, toolCalls: usage.toolCalls, costsWithheld: true };
}

export type ProjectedChain = (RebaseChain & { withheld: false }) | (Omit<RebaseChain, "reads" | "activation"> & {
  withheld: true;
  reads: { key: RebaseChain["reads"][number]["key"]; evidenceId: string; mode: RebaseChain["reads"][number]["mode"]; blockNumber: null; blockTime: null; multiplier: null }[];
  activation: { evidenceId: string; mode: NonNullable<RebaseChain["activation"]>["mode"]; blockNumber: null; blockTime: null } | null;
});

/**
 * The issuer's figures are public and stay. The chain's side (which block, what it returned, when it
 * changed) is the verification being sold, so a visitor sees which reads exist and how they were
 * sourced, with the numbers left out. A run that finished with no Brief keeps its numbers: nothing is sold from it.
 */
export function projectChain(chain: RebaseChain | null, audience: Audience, protect: boolean): ProjectedChain | null {
  if (chain === null) return null;
  if (audience === "DIAGNOSTIC" || !protect) return { ...chain, withheld: false };
  return {
    ...chain,
    withheld: true,
    reads: chain.reads.map((r) => ({ key: r.key, evidenceId: r.evidenceId, mode: r.mode, blockNumber: null, blockTime: null, multiplier: null })),
    activation: chain.activation ? { evidenceId: chain.activation.evidenceId, mode: chain.activation.mode, blockNumber: null, blockTime: null } : null,
  };
}
