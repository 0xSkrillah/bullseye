import { EvidenceItem, weakestMode, type EvidenceKind, type EvidenceValue, type Provenance, type SignalEvent } from "@bullseye/domain";
import type { XLayerAdapter } from "../adapters/xlayer.js";
import type { XStocksAdapter } from "../adapters/xstocks.js";
import { supersededBy } from "../signals/rebaseDetector.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long after it was fetched each kind of evidence may still support publication. */
export const EVIDENCE_TTL_MS: Record<EvidenceKind, number> = {
  CORPORATE_ACTION_RECORD: 7 * DAY,
  ISSUER_MULTIPLIER_STATE: 30 * MINUTE,
  // state at a fixed past block does not change
  ONCHAIN_MULTIPLIER_BEFORE: 365 * DAY,
  ONCHAIN_MULTIPLIER_AFTER: 365 * DAY,
  ONCHAIN_ACTIVATION_BLOCK: 365 * DAY,
  ONCHAIN_MULTIPLIER_LATEST: 30 * MINUTE,
  PROOF_OF_RESERVES: 24 * HOUR,
  REFERENCE_PRICE: 30 * MINUTE,
  TRADING_STATUS: 30 * MINUTE,
  SUPPLY: 24 * HOUR,
};

export const MANDATORY_EVIDENCE: readonly EvidenceKind[] = [
  "CORPORATE_ACTION_RECORD",
  "ONCHAIN_MULTIPLIER_BEFORE",
  "ONCHAIN_MULTIPLIER_AFTER",
  "ONCHAIN_MULTIPLIER_LATEST",
  "PROOF_OF_RESERVES",
];

/** seconds either side of the issuer's effective time at which the bracket reads are taken */
export const BRACKET_OFFSET_SECONDS = 60;
/** activation search window around the effective time */
const ACTIVATION_WINDOW = { beforeSeconds: 900, afterSeconds: 3600 };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

export const TOOL_SPECS: ToolSpec[] = [
  tool("get_corporate_action", "Fetch the issuer's corporate-action record for this signal from the xStocks API. Produces evidence EV-CA."),
  tool("get_issuer_multiplier_state", "Fetch the issuer-reported current and pending multiplier for the X Layer deployment. Produces EV-MULT-API."),
  {
    name: "read_onchain_multiplier",
    description:
      "Read multiplier() from the token contract on X Layer mainnet at a chosen point: 60 seconds before the issuer's effective time (EV-CHAIN-BEFORE), " +
      "60 seconds after it (EV-CHAIN-AFTER), or at the chain head (EV-CHAIN-LATEST).",
    input_schema: {
      type: "object",
      properties: { when: { type: "string", enum: ["before_effective", "after_effective", "latest"] } },
      required: ["when"],
      additionalProperties: false,
    },
  },
  tool("find_onchain_activation", "Bisect X Layer blocks around the effective time to find the first block where multiplier() changed. Produces EV-CHAIN-ACTIVATION."),
  tool("get_proof_of_reserves", "Fetch the issuer's proof-of-reserves record: underlying shares held versus circulating token supply. Produces EV-POR."),
  tool("get_reference_price", "Fetch the issuer's current reference price and relate the net cashflow per share to it. Produces EV-PRICE."),
  tool("get_trading_status", "Fetch whether market or atomic trading of the asset is currently halted. Produces EV-STATUS."),
  tool("get_supply", "Fetch issuer-reported total and circulating supply across chains and read totalSupply() on X Layer. Produces EV-SUPPLY."),
];

function tool(name: string, description: string): ToolSpec {
  return { name, description, input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } };
}

export class UnknownToolError extends Error {}

/**
 * The only way an investigation can obtain facts. Every call yields an
 * EvidenceItem written by code; the model never authors evidence.
 */
export class EvidenceToolbox {
  private readonly items = new Map<string, EvidenceItem>();

  constructor(
    private readonly investigationId: string,
    private readonly signal: SignalEvent,
    private readonly xstocks: XStocksAdapter,
    private readonly xlayer: XLayerAdapter,
  ) {}

  all(): EvidenceItem[] {
    return [...this.items.values()];
  }

  async call(name: string, input: unknown): Promise<EvidenceItem> {
    switch (name) {
      case "get_corporate_action":
        return this.corporateAction();
      case "get_issuer_multiplier_state":
        return this.issuerMultiplierState();
      case "read_onchain_multiplier": {
        const when = (input as { when?: string } | null)?.when;
        if (when !== "before_effective" && when !== "after_effective" && when !== "latest") {
          throw new UnknownToolError(`read_onchain_multiplier: invalid "when": ${String(when)}`);
        }
        return this.onchainMultiplier(when);
      }
      case "find_onchain_activation":
        return this.activation();
      case "get_proof_of_reserves":
        return this.proofOfReserves();
      case "get_reference_price":
        return this.referencePrice();
      case "get_trading_status":
        return this.tradingStatus();
      case "get_supply":
        return this.supply();
      default:
        throw new UnknownToolError(`unknown tool: ${name}`);
    }
  }

  private async corporateAction(): Promise<EvidenceItem> {
    const { symbol } = this.signal.asset;
    const history = await this.xstocks.corporateActionHistory({ symbol, pageSize: 50 });
    const mine = history.data.filter((row) => row.eventId === this.signal.facts.corporateActionId);
    // a row that failed validation may be a newer version of this very action; do not vouch for it
    const unreadable = history.rejected.filter((r) => r.eventId === null || r.eventId === this.signal.facts.corporateActionId);
    if (unreadable.length > 0) throw new Error(`the issuer history for ${symbol} contains ${unreadable.length} record(s) that failed validation and may revise this action: ${unreadable[0]!.reason}`);
    const action = mine.find((row) => row.version === this.signal.facts.corporateActionVersion);
    if (!action) throw new Error(`corporate action ${this.signal.facts.corporateActionId} v${this.signal.facts.corporateActionVersion} is no longer present in the issuer history for ${symbol}`);
    const newest = mine.reduce((x, y) => (y.version > x.version ? y : x));
    const superseded = supersededBy(action, mine);
    const oldM = Number(action.multiplierOld);
    const newM = Number(action.multiplierNew);
    const withholding = action.withholdingTaxRate === null ? null : Number(action.withholdingTaxRate);
    return this.put("EV-CA", "CORPORATE_ACTION_RECORD", history.provenance, action.effectiveTimeUtc ?? this.signal.observedAt, {
      summary:
        `Issuer corporate-action record ${action.eventId} v${action.version} for ${symbol}: ${action.caType}, status ${action.status}, multiplier ${action.multiplierOld} -> ${action.multiplierNew}, effective ${action.effectiveTimeUtc ?? "not set"}.` +
        (superseded ? ` The issuer has since ${superseded.reason === "CANCELLED" ? "cancelled" : "replaced"} it with v${superseded.byVersion} (${superseded.status}${superseded.notes ? `: ${superseded.notes}` : ""}).` : newest.version !== action.version ? ` A later version v${newest.version} (${newest.status}) exists and does not void this one.` : ""),
      values: {
        eventId: action.eventId,
        version: action.version,
        caType: action.caType,
        status: action.status,
        newestVersion: newest.version,
        newestStatus: newest.status,
        supersededByVersion: superseded?.byVersion ?? null,
        supersededReason: superseded?.reason ?? null,
        supersedingNotes: superseded?.notes ?? null,
        effectiveTimeUtc: action.effectiveTimeUtc,
        createdTimeUtc: action.createdTimeUtc,
        multiplierOld: action.multiplierOld === null ? null : oldM,
        multiplierNew: action.multiplierNew === null ? null : newM,
        multiplierNewExact: action.multiplierNew,
        changePct: action.multiplierOld === null || action.multiplierNew === null || oldM === 0 ? null : round((newM / oldM - 1) * 100, 6),
        grossCashflowUsd: action.grossCashflowUsd === null ? null : Number(action.grossCashflowUsd),
        netCashflowUsd: action.netCashflowUsd === null ? null : Number(action.netCashflowUsd),
        withholdingTaxRate: withholding,
        withholdingTaxPct: withholding === null ? null : round(withholding * 100, 4),
      },
    });
  }

  private async issuerMultiplierState(): Promise<EvidenceItem> {
    const m = await this.xstocks.multiplier(this.signal.asset.symbol, "XLayer");
    return this.put("EV-MULT-API", "ISSUER_MULTIPLIER_STATE", m.provenance, m.provenance.fetchedAt, {
      summary: `Issuer API reports current multiplier ${m.data.currentMultiplier} for the X Layer deployment; pending multiplier ${m.data.newMultiplier}.`,
      values: {
        currentMultiplier: m.data.currentMultiplier,
        pendingMultiplier: m.data.newMultiplier,
        hasPendingChange: m.data.newMultiplier !== 0,
        network: "XLayer",
      },
    });
  }

  private async onchainMultiplier(when: "before_effective" | "after_effective" | "latest"): Promise<EvidenceItem> {
    const { tokenAddress } = this.signal.asset;
    if (when === "latest") {
      const read = await this.xlayer.multiplierAt(tokenAddress, "latest");
      return this.put("EV-CHAIN-LATEST", "ONCHAIN_MULTIPLIER_LATEST", read.provenance, read.data.blockTimestamp, {
        summary: `multiplier() on X Layer at head block ${read.data.blockNumber} (${read.data.blockTimestamp}) returned ${read.data.multiplier}.`,
        values: { multiplier: Number(read.data.multiplier), multiplierExact: read.data.multiplier, blockNumber: read.data.blockNumber, blockTimestamp: read.data.blockTimestamp, chainId: read.data.chainId, tokenAddress },
      });
    }
    const offset = when === "before_effective" ? -BRACKET_OFFSET_SECONDS : BRACKET_OFFSET_SECONDS;
    const target = new Date(Date.parse(this.signal.observedAt) + offset * 1000).toISOString();
    const block = await this.xlayer.blockAtOrAfter(target);
    const read = await this.xlayer.multiplierAt(tokenAddress, block.data.blockNumber);
    const id = when === "before_effective" ? "EV-CHAIN-BEFORE" : "EV-CHAIN-AFTER";
    const kind = when === "before_effective" ? "ONCHAIN_MULTIPLIER_BEFORE" : "ONCHAIN_MULTIPLIER_AFTER";
    return this.put(id, kind, read.provenance, read.data.blockTimestamp, {
      summary: `multiplier() on X Layer at block ${read.data.blockNumber} (${read.data.blockTimestamp}, ${Math.abs(offset)}s ${offset < 0 ? "before" : "after"} the issuer's effective time) returned ${read.data.multiplier}.`,
      values: {
        multiplier: Number(read.data.multiplier),
        multiplierExact: read.data.multiplier,
        blockNumber: read.data.blockNumber,
        blockTimestamp: read.data.blockTimestamp,
        offsetSeconds: offset,
        chainId: read.data.chainId,
        tokenAddress,
      },
    });
  }

  private async activation(): Promise<EvidenceItem> {
    const { tokenAddress } = this.signal.asset;
    const effective = Date.parse(this.signal.observedAt);
    const from = await this.xlayer.blockAtOrAfter(new Date(effective - ACTIVATION_WINDOW.beforeSeconds * 1000).toISOString());
    const headNow = await this.xlayer.head();
    const wantedEnd = effective + ACTIVATION_WINDOW.afterSeconds * 1000;
    const to =
      Date.parse(headNow.data.blockTimestamp) <= wantedEnd
        ? { data: { blockNumber: headNow.data.blockNumber } }
        : await this.xlayer.blockAtOrAfter(new Date(wantedEnd).toISOString());
    const found = await this.xlayer.findActivation(tokenAddress, from.data.blockNumber, to.data.blockNumber);
    if (found.data === null) {
      return this.put("EV-CHAIN-ACTIVATION", "ONCHAIN_ACTIVATION_BLOCK", found.provenance, this.signal.observedAt, {
        summary: `multiplier() did not change on X Layer between blocks ${from.data.blockNumber} and ${to.data.blockNumber}.`,
        values: { changeFound: false, searchFromBlock: from.data.blockNumber, searchToBlock: to.data.blockNumber, chainId: 196, tokenAddress },
      });
    }
    const a = found.data;
    const lagSeconds = Math.round((Date.parse(a.firstBlockWithNew.blockTimestamp) - effective) / 1000);
    return this.put("EV-CHAIN-ACTIVATION", "ONCHAIN_ACTIVATION_BLOCK", found.provenance, a.firstBlockWithNew.blockTimestamp, {
      summary: `multiplier() first returned ${a.firstBlockWithNew.multiplier} at X Layer block ${a.firstBlockWithNew.blockNumber} (${a.firstBlockWithNew.blockTimestamp}); the previous block still returned ${a.lastBlockWithOld.multiplier}.`,
      values: {
        changeFound: true,
        activationBlock: a.firstBlockWithNew.blockNumber,
        activationTimestamp: a.firstBlockWithNew.blockTimestamp,
        lagSecondsVsIssuerEffectiveTime: lagSeconds,
        multiplierBefore: Number(a.lastBlockWithOld.multiplier),
        multiplierAfter: Number(a.firstBlockWithNew.multiplier),
        lastBlockWithOld: a.lastBlockWithOld.blockNumber,
        rpcReads: a.rpcReads,
        chainId: a.chainId,
        tokenAddress,
      },
    });
  }

  private async proofOfReserves(): Promise<EvidenceItem> {
    const por = await this.xstocks.proofOfReserves(this.signal.asset.symbol);
    const shares = Number(por.data.sharesHeld);
    const circulating = Number(por.data.circulatingSupply);
    return this.put("EV-POR", "PROOF_OF_RESERVES", por.provenance, por.data.timestamp, {
      summary: `Issuer proof-of-reserves at ${por.data.timestamp}: ${por.data.sharesHeld} ${this.signal.asset.underlyingSymbol} shares held against ${por.data.circulatingSupply} circulating ${this.signal.asset.symbol}.`,
      values: {
        sharesHeld: shares,
        circulatingSupply: round(circulating, 6),
        coverageRatio: circulating > 0 ? round(shares / circulating, 6) : null,
        surplusShares: round(shares - circulating, 6),
        custodians: por.data.holdings.map((h) => h.provider).join(", "),
        reportedAt: por.data.timestamp,
      },
    });
  }

  private async referencePrice(): Promise<EvidenceItem> {
    const price = await this.xstocks.price(this.signal.asset.symbol);
    const net = this.signal.facts.netCashflowUsd === null ? null : Number(this.signal.facts.netCashflowUsd);
    return this.put("EV-PRICE", "REFERENCE_PRICE", price.provenance, price.provenance.fetchedAt, {
      summary: `Issuer reference price for ${this.signal.asset.symbol} is ${price.data.quote} USD (current quote, not the ex-date price).`,
      values: {
        quoteUsd: price.data.quote,
        netCashflowUsd: net,
        impliedRebasePctAtCurrentPrice: net === null ? null : round((net / price.data.quote) * 100, 6),
      },
    });
  }

  private async tradingStatus(): Promise<EvidenceItem> {
    const s = await this.xstocks.tradingStatus(this.signal.asset.symbol);
    return this.put("EV-STATUS", "TRADING_STATUS", s.provenance, s.provenance.fetchedAt, {
      summary: `Issuer trading status: market trading halted = ${s.data.isMarketTradingHalted}, atomic trading halted = ${s.data.isAtomicTradingHalted}.`,
      values: { isMarketTradingHalted: s.data.isMarketTradingHalted, isAtomicTradingHalted: s.data.isAtomicTradingHalted },
    });
  }

  private async supply(): Promise<EvidenceItem> {
    const { symbol, tokenAddress } = this.signal.asset;
    const [total, circulating, onchain] = await Promise.all([
      this.xstocks.totalSupply(symbol),
      this.xstocks.circulatingSupply(symbol),
      this.xlayer.totalSupply(tokenAddress),
    ]);
    const xl = Number(onchain.data.totalSupply);
    // the item is only as strong as its weakest input; keep the on-chain provenance and note the API inputs
    const provenance: Provenance = {
      ...onchain.provenance,
      mode: weakestMode([total.provenance.mode, circulating.provenance.mode, onchain.provenance.mode]),
      note: `combines ${total.provenance.url} and ${circulating.provenance.url} with an on-chain totalSupply() read`,
    };
    return this.put("EV-SUPPLY", "SUPPLY", provenance, onchain.data.blockTimestamp, {
      summary: `Issuer reports total supply ${total.data.value} and circulating supply ${circulating.data.value} across all chains; totalSupply() on X Layer is ${onchain.data.totalSupply} at block ${onchain.data.blockNumber}.`,
      values: {
        issuerTotalSupplyAllChains: round(total.data.value, 6),
        issuerCirculatingSupplyAllChains: round(circulating.data.value, 6),
        xlayerTotalSupply: round(xl, 6),
        xlayerBlockNumber: onchain.data.blockNumber,
        chainId: onchain.data.chainId,
      },
    });
  }

  private put(
    id: string,
    kind: EvidenceKind,
    provenance: Provenance,
    observedAt: string,
    body: { summary: string; values: Record<string, EvidenceValue> },
  ): EvidenceItem {
    const item = EvidenceItem.parse({
      id,
      investigationId: this.investigationId,
      kind,
      summary: body.summary,
      values: body.values,
      observedAt,
      staleAfter: new Date(Date.parse(provenance.fetchedAt) + EVIDENCE_TTL_MS[kind]).toISOString(),
      provenance,
    });
    this.items.set(id, item);
    return item;
  }
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
