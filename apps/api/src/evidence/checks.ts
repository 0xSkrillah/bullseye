import { parseUnits } from "viem";
import type { CheckStatus, ConsistencyCheck, EvidenceItem, SignalEvent } from "@bullseye/domain";

/** activation within this many seconds of the issuer's effective time counts as on schedule (issuer docs advise a 15 minute pause either side) */
const ACTIVATION_TOLERANCE_SECONDS = 900;
/** the current quote is not the ex-date price, so the size cross-check is deliberately loose */
const REBASE_SIZE_TOLERANCE = 0.25;

/** Compare multipliers at the contract's 18 decimal precision rather than as floats. */
function sameMultiplier(a: string, b: string): boolean {
  try {
    return parseUnits(a, 18) === parseUnits(b, 18);
  } catch {
    return false;
  }
}

/**
 * Cross-checks computed by code from collected evidence. The model never decides
 * whether sources agree; it is only required to disclose every FAIL.
 */
export function runConsistencyChecks(signal: SignalEvent, evidence: EvidenceItem[]): ConsistencyCheck[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const before = byId.get("EV-CHAIN-BEFORE");
  const after = byId.get("EV-CHAIN-AFTER");
  const latest = byId.get("EV-CHAIN-LATEST");
  const api = byId.get("EV-MULT-API");
  const por = byId.get("EV-POR");
  const activation = byId.get("EV-CHAIN-ACTIVATION");
  const price = byId.get("EV-PRICE");
  const status = byId.get("EV-STATUS");
  const checks: ConsistencyCheck[] = [];

  const add = (id: string, description: string, status_: CheckStatus, detail: string, evidenceIds: string[]) =>
    checks.push({ id, description, status: status_, detail, evidenceIds });

  if (before) {
    const got = String(before.values.multiplierExact);
    add(
      "CHK-BEFORE-MATCHES-OLD",
      "On-chain multiplier before the effective time equals the issuer's old multiplier",
      sameMultiplier(got, signal.facts.multiplierOld) ? "PASS" : "FAIL",
      `on-chain ${got} vs issuer old ${signal.facts.multiplierOld}`,
      ["EV-CHAIN-BEFORE", "EV-CA"],
    );
  } else add("CHK-BEFORE-MATCHES-OLD", "On-chain multiplier before the effective time equals the issuer's old multiplier", "UNKNOWN", "EV-CHAIN-BEFORE not collected", []);

  if (after) {
    const got = String(after.values.multiplierExact);
    add(
      "CHK-AFTER-MATCHES-NEW",
      "On-chain multiplier after the effective time equals the issuer's new multiplier",
      sameMultiplier(got, signal.facts.multiplierNew) ? "PASS" : "FAIL",
      `on-chain ${got} vs issuer new ${signal.facts.multiplierNew}`,
      ["EV-CHAIN-AFTER", "EV-CA"],
    );
  } else add("CHK-AFTER-MATCHES-NEW", "On-chain multiplier after the effective time equals the issuer's new multiplier", "UNKNOWN", "EV-CHAIN-AFTER not collected", []);

  if (latest) {
    const got = String(latest.values.multiplierExact);
    add(
      "CHK-LATEST-MATCHES-NEW",
      "On-chain multiplier at the chain head still equals the issuer's new multiplier",
      sameMultiplier(got, signal.facts.multiplierNew) ? "PASS" : "FAIL",
      `on-chain head ${got} vs issuer new ${signal.facts.multiplierNew}`,
      ["EV-CHAIN-LATEST", "EV-CA"],
    );
  } else add("CHK-LATEST-MATCHES-NEW", "On-chain multiplier at the chain head still equals the issuer's new multiplier", "UNKNOWN", "EV-CHAIN-LATEST not collected", []);

  if (api && latest) {
    const a = Number(api.values.currentMultiplier);
    const c = Number(latest.values.multiplier);
    add(
      "CHK-API-STATE-MATCHES-CHAIN",
      "Issuer API current multiplier equals the on-chain multiplier at the chain head",
      Math.abs(a - c) <= 1e-12 ? "PASS" : "FAIL",
      `issuer API ${a} vs on-chain ${c}`,
      ["EV-MULT-API", "EV-CHAIN-LATEST"],
    );
  } else add("CHK-API-STATE-MATCHES-CHAIN", "Issuer API current multiplier equals the on-chain multiplier at the chain head", "UNKNOWN", "needs EV-MULT-API and EV-CHAIN-LATEST", []);

  if (por) {
    const ratio = por.values.coverageRatio;
    add(
      "CHK-RESERVES-COVER-SUPPLY",
      "Issuer-reported underlying shares held are at least the circulating token supply",
      typeof ratio !== "number" ? "UNKNOWN" : ratio >= 1 ? "PASS" : "FAIL",
      typeof ratio === "number" ? `coverage ratio ${ratio}` : "circulating supply is zero, ratio undefined",
      ["EV-POR"],
    );
  } else add("CHK-RESERVES-COVER-SUPPLY", "Issuer-reported underlying shares held are at least the circulating token supply", "UNKNOWN", "EV-POR not collected", []);

  if (activation) {
    if (activation.values.changeFound !== true) {
      add("CHK-ACTIVATION-ON-SCHEDULE", "On-chain activation happened close to the issuer's effective time", "FAIL", "no multiplier change found in the search window", ["EV-CHAIN-ACTIVATION"]);
    } else {
      const lag = Number(activation.values.lagSecondsVsIssuerEffectiveTime);
      add(
        "CHK-ACTIVATION-ON-SCHEDULE",
        "On-chain activation happened close to the issuer's effective time",
        Math.abs(lag) <= ACTIVATION_TOLERANCE_SECONDS ? "PASS" : "FAIL",
        `activation lag ${lag}s (tolerance ${ACTIVATION_TOLERANCE_SECONDS}s)`,
        ["EV-CHAIN-ACTIVATION", "EV-CA"],
      );
    }
  } else add("CHK-ACTIVATION-ON-SCHEDULE", "On-chain activation happened close to the issuer's effective time", "UNKNOWN", "EV-CHAIN-ACTIVATION not collected", []);

  if (price && typeof price.values.impliedRebasePctAtCurrentPrice === "number" && signal.facts.changePct !== 0) {
    const implied = price.values.impliedRebasePctAtCurrentPrice;
    const rel = Math.abs(implied - signal.facts.changePct) / Math.abs(signal.facts.changePct);
    add(
      "CHK-REBASE-SIZE-PLAUSIBLE",
      "Rebase size is consistent with net cashflow per share divided by the reference price",
      rel <= REBASE_SIZE_TOLERANCE ? "PASS" : "FAIL",
      `implied ${implied}% at current price vs reported ${signal.facts.changePct}% (relative gap ${(rel * 100).toFixed(1)}%, tolerance ${REBASE_SIZE_TOLERANCE * 100}%)`,
      ["EV-PRICE", "EV-CA"],
    );
  } else add("CHK-REBASE-SIZE-PLAUSIBLE", "Rebase size is consistent with net cashflow per share divided by the reference price", "UNKNOWN", "needs EV-PRICE and a net cashflow figure", []);

  if (status) {
    const halted = status.values.isMarketTradingHalted === true || status.values.isAtomicTradingHalted === true;
    add("CHK-TRADING-NOT-HALTED", "Issuer reports trading is not halted", halted ? "FAIL" : "PASS", `market halted=${status.values.isMarketTradingHalted}, atomic halted=${status.values.isAtomicTradingHalted}`, ["EV-STATUS"]);
  } else add("CHK-TRADING-NOT-HALTED", "Issuer reports trading is not halted", "UNKNOWN", "EV-STATUS not collected", []);

  return checks;
}

/** Checks that go to the heart of the claim "the rebase happened on X Layer as the issuer said". */
export const CORE_CHECKS = ["CHK-BEFORE-MATCHES-OLD", "CHK-AFTER-MATCHES-NEW", "CHK-LATEST-MATCHES-NEW"] as const;
