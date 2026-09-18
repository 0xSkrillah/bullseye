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
}

/**
 * A corporate action is a rebase candidate when the issuer reports a multiplier
 * change that has already taken effect inside the lookback window.
 */
export function isRebaseCandidate(action: XsCorporateAction, now: Date, lookbackHours: number): boolean {
  if (action.multiplierOld === null || action.multiplierNew === null) return false;
  if (action.multiplierOld === action.multiplierNew) return false;
  const effective = Date.parse(action.effectiveTimeUtc);
  if (effective > now.getTime()) return false;
  return now.getTime() - effective <= lookbackHours * 3_600_000;
}

/**
 * Pure and deterministic: no I/O, no clock reads, no randomness.
 * Emits one SignalEvent per corporate action (id + version) whose token is deployed on X Layer.
 */
export function detectRebaseSignals(input: DetectorInput): SignalEvent[] {
  const signals: SignalEvent[] = [];
  for (const action of input.actions.data) {
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
