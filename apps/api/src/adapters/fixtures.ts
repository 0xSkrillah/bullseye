/**
 * Synthetic source responses for tests. The asset, issuer record and chain
 * reads below are invented; nothing here describes a real instrument. Anything
 * served from this file is labelled FIXTURE by FixtureTransport.
 */

export const FIXTURE_CLOCK = new Date("2026-01-15T09:00:00.000Z");
export const FIXTURE_SYMBOL = "FIXx";
export const FIXTURE_TOKEN = "0x00000000000000000000000000000000000f1c70";
const EFFECTIVE = "2026-01-15T00:30:00.000Z";
const BASE_BLOCK = 50_000_000;
const BASE_TS = Math.floor(Date.parse("2026-01-15T00:00:00.000Z") / 1000);

export interface FixtureOptions {
  /** what the chain returns 60s after the effective time; defaults to the issuer's new multiplier */
  onchainAfter?: string;
  /** shares the custodian holds; default comfortably covers supply */
  sharesHeld?: string;
  /** set to move the multiplier by nothing, which yields no signal */
  multiplierNew?: string;
}

const blockAt = (iso: string) => BASE_BLOCK + (Math.floor(Date.parse(iso) / 1000) - BASE_TS);
const isoOfBlock = (block: number) => new Date((BASE_TS + (block - BASE_BLOCK)) * 1000).toISOString();
const shift = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

export function buildFixtureResponses(opts: FixtureOptions = {}): Record<string, unknown> {
  const multiplierOld = "1";
  const multiplierNew = opts.multiplierNew ?? "1.0025";
  const onchainAfter = opts.onchainAfter ?? multiplierNew;
  const addr = FIXTURE_TOKEN.toLowerCase();

  const action = {
    eventId: "00000000-0000-4000-8000-0000000f1c70",
    version: 1,
    xstockSymbol: FIXTURE_SYMBOL,
    spvSymbol: "FIX",
    caType: "CashDividend",
    effectiveTimeUtc: EFFECTIVE,
    multiplierOld,
    multiplierNew,
    grossCashflowUsd: "0.5",
    netCashflowUsd: "0.35",
    withholdingTaxRate: "0.3",
    createdTimeUtc: "2026-01-14T20:00:00.000Z",
    status: "Initial",
  };
  const history = { page: { currentPage: 1 }, nodes: [action] };

  const beforeBlock = blockAt(shift(EFFECTIVE, -60));
  const afterBlock = blockAt(shift(EFFECTIVE, 60));
  const fromBlock = blockAt(shift(EFFECTIVE, -900));
  const toBlock = blockAt(shift(EFFECTIVE, 3600));
  const activationBlock = blockAt(EFFECTIVE) + 2;
  const headBlock = blockAt(FIXTURE_CLOCK.toISOString());
  const ref = (block: number) => ({ blockNumber: block, blockTimestamp: isoOfBlock(block) });
  const read = (block: number, multiplier: string) => ({ chainId: 196, tokenAddress: FIXTURE_TOKEN, ...ref(block), multiplierRaw: toRaw(multiplier), multiplier });
  const changed = onchainAfter !== multiplierOld;

  return {
    "xstocks.ca-history.all": history,
    [`xstocks.ca-history.${FIXTURE_SYMBOL}`]: history,
    [`xstocks.asset.${FIXTURE_SYMBOL}`]: {
      id: "fixture-asset",
      name: "Fixture Corp xStock",
      symbol: FIXTURE_SYMBOL,
      isin: null,
      underlyingSymbol: "FIX",
      isTradingHalted: false,
      deployments: [{ network: "XLayer", address: FIXTURE_TOKEN }],
    },
    [`xstocks.multiplier.${FIXTURE_SYMBOL}.XLayer`]: { currentMultiplier: Number(onchainAfter), newMultiplier: 0, activationDateTime: 0, reason: null },
    [`xstocks.por.${FIXTURE_SYMBOL}`]: {
      symbol: FIXTURE_SYMBOL,
      timestamp: "2026-01-15T08:45:00.000Z",
      sharesHeld: opts.sharesHeld ?? "1200",
      circulatingSupply: "1000.5",
      holdings: [{ provider: "Fixture Custody", quantity: opts.sharesHeld ?? "1200", symbol: "FIX" }],
    },
    [`xstocks.price.${FIXTURE_SYMBOL}`]: { quote: 140 },
    [`xstocks.status.${FIXTURE_SYMBOL}`]: { symbol: FIXTURE_SYMBOL, isMarketTradingHalted: false, isAtomicTradingHalted: false },
    [`xstocks.total-supply.${FIXTURE_SYMBOL}`]: { value: 5000 },
    [`xstocks.circulating-supply.${FIXTURE_SYMBOL}`]: { value: 1000.5 },

    "xlayer.head": { chainId: 196, ...ref(headBlock) },
    [`xlayer.block-at.${tsOf(shift(EFFECTIVE, -60))}`]: { ...ref(beforeBlock), rpcReads: 0 },
    [`xlayer.block-at.${tsOf(shift(EFFECTIVE, 60))}`]: { ...ref(afterBlock), rpcReads: 0 },
    [`xlayer.block-at.${tsOf(shift(EFFECTIVE, -900))}`]: { ...ref(fromBlock), rpcReads: 0 },
    [`xlayer.block-at.${tsOf(shift(EFFECTIVE, 3600))}`]: { ...ref(toBlock), rpcReads: 0 },
    [`xlayer.multiplier.${addr}.${beforeBlock}`]: read(beforeBlock, multiplierOld),
    [`xlayer.multiplier.${addr}.${afterBlock}`]: read(afterBlock, onchainAfter),
    [`xlayer.multiplier.${addr}.latest`]: read(headBlock, onchainAfter),
    [`xlayer.activation.${addr}.${fromBlock}.${toBlock}`]: changed
      ? {
          chainId: 196,
          tokenAddress: FIXTURE_TOKEN,
          lastBlockWithOld: { ...ref(activationBlock - 1), multiplier: multiplierOld },
          firstBlockWithNew: { ...ref(activationBlock), multiplier: onchainAfter },
          rpcReads: 0,
        }
      : null,
    [`xlayer.total-supply.${addr}`]: { chainId: 196, tokenAddress: FIXTURE_TOKEN, ...ref(headBlock), totalSupply: "800.25" },
  };
}

function tsOf(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function toRaw(decimal: string): string {
  const [whole, frac = ""] = decimal.split(".");
  return BigInt(`${whole}${frac.padEnd(18, "0")}`).toString();
}
