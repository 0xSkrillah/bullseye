import { createPublicClient, defineChain, formatUnits, http, parseAbi, type PublicClient } from "viem";
import type { Sourced } from "@bullseye/domain";
import type { SourceTransport } from "./transport.js";

export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/x-layer" } },
});

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/x-layer-testnet" } },
  testnet: true,
});

const xStockAbi = parseAbi([
  "function multiplier() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const MULTIPLIER_DECIMALS = 18;

export interface BlockRef {
  blockNumber: number;
  blockTimestamp: string;
}

export interface MultiplierRead extends BlockRef {
  chainId: number;
  tokenAddress: string;
  multiplierRaw: string;
  multiplier: string;
}

export interface ActivationRead {
  chainId: number;
  tokenAddress: string;
  lastBlockWithOld: BlockRef & { multiplier: string };
  firstBlockWithNew: BlockRef & { multiplier: string };
  rpcReads: number;
}

export interface SupplyRead extends BlockRef {
  chainId: number;
  tokenAddress: string;
  totalSupply: string;
}

export class XLayerAdapter {
  private readonly client: PublicClient;

  constructor(
    private readonly transport: SourceTransport,
    private readonly rpcUrl: string,
  ) {
    this.client = createPublicClient({ chain: xLayer, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
  }

  async head(): Promise<Sourced<BlockRef & { chainId: number }>> {
    return this.transport.chain("xlayer.head", this.rpcUrl, async () => {
      const [chainId, block] = await Promise.all([this.client.getChainId(), this.client.getBlock()]);
      if (chainId !== xLayer.id) throw new Error(`unexpected chain id ${chainId}, wanted ${xLayer.id}`);
      return { chainId, blockNumber: Number(block.number), blockTimestamp: iso(block.timestamp) };
    });
  }

  /** First block whose timestamp is >= the target. X Layer blocks are ~1s, so this converges in a few reads. */
  async blockAtOrAfter(targetIso: string): Promise<Sourced<BlockRef & { rpcReads: number }>> {
    const target = Math.floor(Date.parse(targetIso) / 1000);
    return this.transport.chain(`xlayer.block-at.${target}`, this.rpcUrl, async () => {
      let reads = 1;
      const head = await this.client.getBlock();
      if (Number(head.timestamp) < target) throw new Error("target time is in the future of the chain head");
      let lo = 0n;
      let hi = head.number;
      // jump close using the head as an anchor, then bisect inside a narrow window
      let guess = head.number - BigInt(Number(head.timestamp) - target);
      if (guess < 0n) guess = 0n;
      const window = 4096n;
      lo = guess > window ? guess - window : 0n;
      hi = guess + window < head.number ? guess + window : head.number;
      const loBlock = await this.client.getBlock({ blockNumber: lo });
      reads++;
      if (Number(loBlock.timestamp) >= target) lo = 0n;
      const hiBlock = await this.client.getBlock({ blockNumber: hi });
      reads++;
      if (Number(hiBlock.timestamp) < target) hi = head.number;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        const b = await this.client.getBlock({ blockNumber: mid });
        reads++;
        if (Number(b.timestamp) >= target) hi = mid;
        else lo = mid + 1n;
        if (reads > 80) throw new Error("block search did not converge");
      }
      const found = await this.client.getBlock({ blockNumber: lo });
      reads++;
      return { blockNumber: Number(found.number), blockTimestamp: iso(found.timestamp), rpcReads: reads };
    });
  }

  async multiplierAt(tokenAddress: string, block: number | "latest"): Promise<Sourced<MultiplierRead>> {
    return this.transport.chain(`xlayer.multiplier.${tokenAddress.toLowerCase()}.${block}`, this.rpcUrl, async () => {
      const blockNumber = block === "latest" ? await this.client.getBlockNumber() : BigInt(block);
      const [raw, header] = await Promise.all([this.readMultiplier(tokenAddress, blockNumber), this.client.getBlock({ blockNumber })]);
      return {
        chainId: xLayer.id,
        tokenAddress,
        blockNumber: Number(blockNumber),
        blockTimestamp: iso(header.timestamp),
        multiplierRaw: raw.toString(),
        multiplier: formatUnits(raw, MULTIPLIER_DECIMALS),
      };
    });
  }

  /** Bisects [fromBlock, toBlock] for the first block at which multiplier() differs from its value at fromBlock. */
  async findActivation(tokenAddress: string, fromBlock: number, toBlock: number): Promise<Sourced<ActivationRead | null>> {
    const key = `xlayer.activation.${tokenAddress.toLowerCase()}.${fromBlock}.${toBlock}`;
    return this.transport.chain(key, this.rpcUrl, async () => {
      let reads = 2;
      const oldRaw = await this.readMultiplier(tokenAddress, BigInt(fromBlock));
      const endRaw = await this.readMultiplier(tokenAddress, BigInt(toBlock));
      if (oldRaw === endRaw) return null;
      let lo = BigInt(fromBlock);
      let hi = BigInt(toBlock);
      while (hi - lo > 1n) {
        const mid = (lo + hi) / 2n;
        const v = await this.readMultiplier(tokenAddress, mid);
        reads++;
        if (v === oldRaw) lo = mid;
        else hi = mid;
      }
      const [newRaw, loHeader, hiHeader] = await Promise.all([
        this.readMultiplier(tokenAddress, hi),
        this.client.getBlock({ blockNumber: lo }),
        this.client.getBlock({ blockNumber: hi }),
      ]);
      reads += 3;
      return {
        chainId: xLayer.id,
        tokenAddress,
        lastBlockWithOld: { blockNumber: Number(lo), blockTimestamp: iso(loHeader.timestamp), multiplier: formatUnits(oldRaw, MULTIPLIER_DECIMALS) },
        firstBlockWithNew: { blockNumber: Number(hi), blockTimestamp: iso(hiHeader.timestamp), multiplier: formatUnits(newRaw, MULTIPLIER_DECIMALS) },
        rpcReads: reads,
      };
    });
  }

  async totalSupply(tokenAddress: string): Promise<Sourced<SupplyRead>> {
    return this.transport.chain(`xlayer.total-supply.${tokenAddress.toLowerCase()}`, this.rpcUrl, async () => {
      const header = await this.client.getBlock();
      const [supply, decimals] = await Promise.all([
        this.client.readContract({ address: tokenAddress as `0x${string}`, abi: xStockAbi, functionName: "totalSupply", blockNumber: header.number }),
        this.client.readContract({ address: tokenAddress as `0x${string}`, abi: xStockAbi, functionName: "decimals" }),
      ]);
      return {
        chainId: xLayer.id,
        tokenAddress,
        blockNumber: Number(header.number),
        blockTimestamp: iso(header.timestamp),
        totalSupply: formatUnits(supply, decimals),
      };
    });
  }

  private readMultiplier(tokenAddress: string, blockNumber: bigint): Promise<bigint> {
    return this.client.readContract({ address: tokenAddress as `0x${string}`, abi: xStockAbi, functionName: "multiplier", blockNumber });
  }
}

function iso(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}
