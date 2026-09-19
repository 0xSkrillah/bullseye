import type { PaymentRail } from "@bullseye/domain";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { formatUsd } from "../format";

/** LIMIT is a ceiling that was configured, not an amount that was spent, quoted or estimated */
export type MoneyBasis = "MEASURED" | "ESTIMATED" | "PRICE" | "LIMIT";

export interface MoneyProps {
  usd: number | string;
  basis: MoneyBasis;
  /** the order is PAID or later and the chain confirmed the transfer; only meaningful for PRICE */
  realised?: boolean;
  rail?: PaymentRail;
  /** minimum decimals; formatting only */
  decimals?: number;
}

const DEFAULT_DECIMALS = { PRICE: 2, MEASURED: 4, ESTIMATED: 2, LIMIT: 2 } as const satisfies Record<MoneyBasis, number>;

/**
 * The only way an amount renders. Colour follows from basis and realised;
 * there is deliberately no way to pass one in.
 */
export function Money({ usd, basis, realised = false, rail, decimals }: MoneyProps) {
  const estimated = basis === "ESTIMATED";
  const color = estimated ? "var(--uncertain)" : basis === "PRICE" && realised ? "var(--verified)" : undefined;
  const notRevenue = basis === "PRICE" && rail !== undefined && rail !== "OKX_X402_MAINNET";

  return (
    <span className="be-money" data-basis={basis} style={{ color, whiteSpace: notRevenue ? undefined : "nowrap" }}>
      {estimated && <span aria-hidden="true">≈ </span>}
      <span className="mono">{formatUsd(usd, decimals ?? DEFAULT_DECIMALS[basis])}</span>
      {estimated && <span style={{ fontSize: 11 }}> estimated</span>}
      {notRevenue && (
        <>
          {" "}
          <ProvenanceBadge kind="TESTNET" title={rail === "FIXTURE" ? "Fixture rail: no funds move on any chain. Not revenue." : undefined} />
          <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}> Not revenue.</span>
        </>
      )}
    </span>
  );
}
