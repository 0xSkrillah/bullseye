import { canonicalJson, SignalEvent, weakestMode, type Sourced } from "@bullseye/domain";
import { sha256 } from "../adapters/transport.js";
import type { XsAsset, XsCorporateAction } from "../adapters/xstocks.js";

export const DETECTOR_NAME = "xstocks-rebase-on-xlayer";
export const DETECTOR_VERSION = "1.0.0";

export interface DetectorInput {
  actions: Sourced<XsCorporateAction[]>;
  assets: Map<string, Sourced<XsAsset>>;
  /** detection clock; passed in so that the same inputs always produce the same output */
  now: Date;
  lookbackHours: number;
  /** events with a row that failed validation: that row may be a newer version, so the event is not trusted */
  taintedEventIds?: ReadonlySet<string>;
}

/**
 * A corporate action is a rebase candidate when the issuer reports a multiplier
 * change that has already taken effect inside the lookback window.
 */
export function isRebaseCandidate(action: XsCorporateAction, now: Date, lookbackHours: number): action is XsCorporateAction & { effectiveTimeUtc: string; multiplierOld: string; multiplierNew: string } {
  // a cancelled action never took effect; the issuer also nulls its effective time
  if (action.status.toLowerCase() === "cancelled" || action.effectiveTimeUtc === null) return false;
  if (action.multiplierOld === null || action.multiplierNew === null) return false;
  if (action.multiplierOld === action.multiplierNew) return false;
  const effective = Date.parse(action.effectiveTimeUtc);
  if (effective > now.getTime()) return false;
  return now.getTime() - effective <= lookbackHours * 3_600_000;
}

export interface Supersession {
  byVersion: number;
  reason: "CANCELLED" | "REPLACED";
  status: string;
  notes: string | null;
}

const isCancelled = (a: XsCorporateAction) => a.status.toLowerCase() === "cancelled";

/** "1", "1.0" and "1.000" are the same multiplier */
function sameDecimal(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  return norm(a) === norm(b);
}

/**
 * The issuer's history is append-only: every version of an event stays listed, unchanged.
 * A later version can mean three different things, and only two of them void an earlier one:
 *  - a Cancelled row voids the version it names ("[CANCELLED v2] ..."), or the one before it;
 *  - a live row that starts from the SAME multiplier replaces the earlier row;
 *  - a live row that starts where the earlier row ended is a further rebase; both took effect.
 */
export function supersededBy(row: XsCorporateAction, all: XsCorporateAction[]): Supersession | null {
  const versions = all.filter((v) => v.eventId === row.eventId).sort((x, y) => x.version - y.version);
  for (const later of versions.filter((v) => v.version > row.version)) {
    if (isCancelled(later)) {
      const named = /\[CANCELLED v(\d+)\]/i.exec(later.notes ?? "")?.[1];
      const target = named !== undefined ? Number(named) : versions.filter((v) => v.version < later.version && !isCancelled(v)).at(-1)?.version;
      if (target === row.version) return { byVersion: later.version, reason: "CANCELLED", status: later.status, notes: later.notes ?? null };
      continue;
    }
    if (later.multiplierOld !== null && row.multiplierOld !== null && sameDecimal(later.multiplierOld, row.multiplierOld)) {
      return { byVersion: later.version, reason: "REPLACED", status: later.status, notes: later.notes ?? null };
    }
  }
  return null;
}

/** rows that still describe something the issuer stands behind */
export function currentVersions(actions: XsCorporateAction[]): XsCorporateAction[] {
  return actions.filter((a) => !isCancelled(a) && supersededBy(a, actions) === null);
}

/**
 * Pure and deterministic: no I/O, no clock reads, no randomness.
 * Emits one SignalEvent per corporate action (id + version) whose token is deployed on X Layer.
 */
export function detectRebaseSignals(input: DetectorInput): SignalEvent[] {
  const signals: SignalEvent[] = [];
  for (const action of currentVersions(input.actions.data)) {
    if (input.taintedEventIds?.has(action.eventId)) continue;
    if (!isRebaseCandidate(action, input.now, input.lookbackHours)) continue;
    const asset = input.assets.get(action.xstockSymbol);
    if (!asset) continue;
    const deployment = asset.data.deployments.find((d) => d.network === "XLayer");
    if (!deployment || !/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) continue;

    const oldM = Number(action.multiplierOld);
    const newM = Number(action.multiplierNew);
    const changePct = Math.round((newM / oldM - 1) * 100 * 1e6) / 1e6;
    const identity = `${action.eventId}:${action.version}`;

    signals.push(
      SignalEvent.parse({
        id: `sig_${sha256(identity).slice(0, 16)}`,
        category: "CORPORATE_ACTION_REBASE",
        asset: {
          symbol: asset.data.symbol,
          name: asset.data.name,
          isin: asset.data.isin,
          underlyingSymbol: asset.data.underlyingSymbol,
          network: "XLayer",
          chainId: 196,
          tokenAddress: deployment.address,
        },
        observedAt: action.effectiveTimeUtc,
        detectedAt: input.now.toISOString(),
        headline: `${asset.data.symbol} rebased ${changePct >= 0 ? "+" : ""}${changePct}% (${action.caType})`,
        reasonFlagged:
          `Issuer reported a ${action.caType} that moves the ${asset.data.symbol} balance multiplier from ` +
          `${action.multiplierOld} to ${action.multiplierNew}. Holder balances on X Layer change without Transfer events, ` +
          `so the change needs independent on-chain confirmation.`,
        facts: {
          corporateActionId: action.eventId,
          corporateActionVersion: action.version,
          caType: action.caType,
          status: action.status,
          multiplierOld: action.multiplierOld,
          multiplierNew: action.multiplierNew,
          changePct,
          grossCashflowUsd: action.grossCashflowUsd,
          netCashflowUsd: action.netCashflowUsd,
          withholdingTaxRate: action.withholdingTaxRate,
        },
        sources: [input.actions.provenance, asset.provenance],
        provenance: {
          mode: weakestMode([input.actions.provenance.mode, asset.provenance.mode]),
          detector: DETECTOR_NAME,
          detectorVersion: DETECTOR_VERSION,
          inputHash: sha256(canonicalJson({ action, deployment: { network: deployment.network, address: deployment.address } })),
        },
      }),
    );
  }
  return signals.sort((a, b) => (a.observedAt === b.observedAt ? a.id.localeCompare(b.id) : b.observedAt.localeCompare(a.observedAt)));
}
