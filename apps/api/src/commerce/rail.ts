import { createPublicClient, getAddress, http, parseAbi, parseEventLogs, verifyTypedData, type PublicClient } from "viem";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import type { FacilitatorClient } from "@okxweb3/x402-core/server";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { PaymentRail, QuoteTerms } from "@bullseye/domain";
import { xLayer, xLayerTestnet } from "../adapters/xlayer.js";

export const SDK_VERSIONS = {
  "@okxweb3/x402-core": "0.1.0",
  "@okxweb3/x402-evm": "0.2.1",
  "@okxweb3/x402-express": "0.1.1",
  "@okxweb3/x402-fetch": "0.1.0",
} as const;

export interface RailStatus {
  rail: PaymentRail;
  network: Network;
  ready: boolean;
  detail: string;
  payTo: string | null;
  isTestnet: boolean;
}

export interface PricedTerms {
  amount: string;
  asset: string;
  assetName: string;
  assetDecimals: number;
  extra: Record<string, string>;
}

export interface ChainCheck {
  verified: boolean;
  blockNumber: number | null;
  checkedAt: string;
  note: string;
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export function readAuthorization(payload: PaymentPayload): Eip3009Authorization | null {
  // the header is attacker-controlled JSON: it may decode to null, a string or an array
  const auth = (payload as { payload?: { authorization?: Partial<Eip3009Authorization> } } | null)?.payload?.authorization;
  if (!auth || typeof auth.from !== "string" || typeof auth.nonce !== "string" || typeof auth.validBefore !== "string") return null;
  return auth as Eip3009Authorization;
}

export function requirementsFromTerms(terms: QuoteTerms): PaymentRequirements {
  return {
    scheme: terms.scheme,
    network: terms.network as Network,
    asset: terms.asset,
    amount: terms.amount,
    payTo: terms.payTo,
    maxTimeoutSeconds: terms.maxTimeoutSeconds,
    extra: terms.extra,
  };
}

const erc20TransferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const eip3009Abi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const authorizationUsedEvent = parseAbi(["event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"]);
/** X Layer's public RPC answers eth_getLogs for at most 100 blocks */
const LOG_WINDOW = 100n;
const LOG_WINDOWS_SEARCHED = 40;

/** A payment rail is the OKX x402 SDK resource server plus a way to look at the chain ourselves. */
export class PaymentRailAdapter {
  private readonly server: x402ResourceServer;
  private readonly scheme = new ExactEvmScheme();
  private readonly chain: PublicClient | null;
  private state: { ready: boolean; detail: string } = { ready: false, detail: "not initialised" };

  constructor(
    readonly rail: PaymentRail,
    readonly network: Network,
    private readonly facilitator: FacilitatorClient,
    private readonly payTo: string | undefined,
    rpcUrl: string | null,
  ) {
    this.server = new x402ResourceServer(facilitator);
    this.server.register(network, this.scheme);
    this.chain = rpcUrl ? createPublicClient({ chain: network === "eip155:196" ? xLayer : xLayerTestnet, transport: http(rpcUrl, { timeout: 15_000 }) }) : null;
  }

  async init(): Promise<RailStatus> {
    if (!this.payTo) {
      this.state = { ready: false, detail: "PAY_TO_ADDRESS is not set" };
      return this.status();
    }
    try {
      await this.server.initialize();
      const kind = this.server.getSupportedKind(2, this.network, "exact");
      this.state = kind ? { ready: true, detail: `facilitator supports exact on ${this.network}` } : { ready: false, detail: `facilitator does not list exact on ${this.network}` };
    } catch (err) {
      this.state = { ready: false, detail: err instanceof Error ? err.message : String(err) };
    }
    return this.status();
  }

  status(): RailStatus {
    return { rail: this.rail, network: this.network, ready: this.state.ready, detail: this.state.detail, payTo: this.payTo ?? null, isTestnet: this.rail !== "OKX_X402_MAINNET" };
  }

  /** price -> token amount using the SDK's own asset table, so a quote always matches what SDK clients expect */
  async price(priceUsd: string): Promise<PricedTerms> {
    const parsed = await this.scheme.parsePrice(`$${priceUsd}`, this.network);
    const extra = Object.fromEntries(Object.entries(parsed.extra ?? {}).map(([k, v]) => [k, String(v)]));
    const decimals = Math.round(Math.log10(Number(parsed.amount) / Number(priceUsd)));
    return { amount: parsed.amount, asset: parsed.asset, assetName: extra.name ?? "unknown", assetDecimals: decimals, extra };
  }

  paymentRequired(terms: QuoteTerms, description: string, error?: string) {
    return this.server.createPaymentRequiredResponse([requirementsFromTerms(terms)], { url: terms.resource, description, mimeType: "application/json" }, error);
  }

  matches(terms: QuoteTerms, payload: PaymentPayload): boolean {
    return this.server.findMatchingRequirements([requirementsFromTerms(terms)], payload) !== undefined;
  }

  verify(payload: PaymentPayload, terms: QuoteTerms): Promise<VerifyResponse> {
    return this.server.verifyPayment(payload, requirementsFromTerms(terms));
  }

  settle(payload: PaymentPayload, terms: QuoteTerms): Promise<SettleResponse> {
    return this.server.settlePayment(payload, requirementsFromTerms(terms));
  }

  async settleStatus(txHash: string) {
    return this.facilitator.getSettleStatus ? this.facilitator.getSettleStatus(txHash) : null;
  }

  /** Independent confirmation: the receipt must succeed and contain the exact Transfer the quote asked for. */
  async chainCheck(terms: QuoteTerms, payer: string | null, txHash: string | null): Promise<ChainCheck> {
    const checkedAt = new Date().toISOString();
    if (!this.chain) return { verified: false, blockNumber: null, checkedAt, note: "this rail has no chain to check" };
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { verified: false, blockNumber: null, checkedAt, note: "no transaction hash to check" };
    try {
      const receipt = await this.chain.getTransactionReceipt({ hash: txHash as `0x${string}` });
      if (receipt.status !== "success") return { verified: false, blockNumber: Number(receipt.blockNumber), checkedAt, note: `transaction status is ${receipt.status}` };
      const transfers = parseEventLogs({ abi: erc20TransferEvent, logs: receipt.logs, eventName: "Transfer" });
      const hit = transfers.find(
        (l) =>
          getAddress(l.address) === getAddress(terms.asset) &&
          getAddress(l.args.to) === getAddress(terms.payTo) &&
          l.args.value === BigInt(terms.amount) &&
          (payer === null || getAddress(l.args.from) === getAddress(payer)),
      );
      return hit
        ? { verified: true, blockNumber: Number(receipt.blockNumber), checkedAt, note: `Transfer of ${terms.amount} base units to ${terms.payTo} found in block ${receipt.blockNumber}` }
        : { verified: false, blockNumber: Number(receipt.blockNumber), checkedAt, note: "transaction succeeded but does not contain the quoted Transfer" };
    } catch (err) {
      return { verified: false, blockNumber: null, checkedAt, note: `receipt not available: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` };
    }
  }

  /** EIP-3009 authorizationState: true once the signed authorization has been consumed on-chain. null when it cannot be read. */
  async authorizationUsed(terms: QuoteTerms, auth: Eip3009Authorization): Promise<boolean | null> {
    if (!this.chain) return null;
    try {
      return await this.chain.readContract({ address: getAddress(terms.asset), abi: eip3009Abi, functionName: "authorizationState", args: [getAddress(auth.from), auth.nonce as `0x${string}`] });
    } catch {
      return null;
    }
  }

  /**
   * Proof that this authorization paid the quote. authorizationState alone is not proof: an EIP-3009
   * cancelAuthorization sets the same flag and moves nothing. So find the AuthorizationUsed event for
   * (payer, nonce) and require the quoted Transfer in the same transaction. The event can only exist
   * between the moment the order was opened and the authorization's validBefore, so the search is
   * anchored there and works however old the order is. "Not found" is an answer the caller must
   * treat as unknown, never as paid.
   */
  async authorizationSettled(terms: QuoteTerms, auth: Eip3009Authorization, openedAt: Date): Promise<(ChainCheck & { txHash: string | null }) | null> {
    if (!this.chain) return null;
    const checkedAt = new Date().toISOString();
    const miss = (note: string) => ({ verified: false, blockNumber: null, checkedAt, txHash: null, note });
    try {
      const head = await this.chain.getBlock();
      const fromTime = BigInt(Math.floor(openedAt.getTime() / 1000) - 120);
      const untilTime = BigInt(auth.validBefore) + 120n;
      let from = await this.firstBlockAtOrAfter(fromTime, head.number);
      for (let i = 0; i < LOG_WINDOWS_SEARCHED && from <= head.number; i++) {
        const to = from + LOG_WINDOW - 1n > head.number ? head.number : from + LOG_WINDOW - 1n;
        const logs = await this.chain.getLogs({ address: getAddress(terms.asset), event: authorizationUsedEvent[0], args: { authorizer: getAddress(auth.from), nonce: auth.nonce as `0x${string}` }, fromBlock: from, toBlock: to });
        const hit = logs[0];
        if (hit?.transactionHash) return await this.transferForAuthorization(terms, auth, hit.transactionHash);
        if (to === head.number || (await this.chain.getBlock({ blockNumber: to })).timestamp > untilTime) break;
        from = to + 1n;
      }
      return miss("no AuthorizationUsed event for this payer and nonce between the order opening and the authorization's expiry");
    } catch (err) {
      return miss(`log search failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
    }
  }

  /** the receipt must succeed, carry the quoted Transfer, and not carry more of this payer's authorizations than quoted Transfers */
  private async transferForAuthorization(terms: QuoteTerms, auth: Eip3009Authorization, txHash: `0x${string}`): Promise<ChainCheck & { txHash: string | null }> {
    const check = await this.chainCheck(terms, auth.from, txHash);
    if (!check.verified || !this.chain) return { ...check, txHash };
    const receipt = await this.chain.getTransactionReceipt({ hash: txHash });
    const own = (address: string) => getAddress(address) === getAddress(terms.asset);
    const authorizations = parseEventLogs({ abi: authorizationUsedEvent, logs: receipt.logs, eventName: "AuthorizationUsed" }).filter((l) => own(l.address) && getAddress(l.args.authorizer) === getAddress(auth.from)).length;
    const transfers = parseEventLogs({ abi: erc20TransferEvent, logs: receipt.logs, eventName: "Transfer" }).filter(
      (l) => own(l.address) && getAddress(l.args.from) === getAddress(auth.from) && getAddress(l.args.to) === getAddress(terms.payTo) && l.args.value === BigInt(terms.amount),
    ).length;
    if (authorizations > transfers) return { ...check, verified: false, txHash, note: `transaction carries ${authorizations} authorizations from this payer but only ${transfers} quoted transfer(s); cannot attribute one to this order` };
    return { ...check, txHash };
  }

  /** first block whose timestamp is at or after `time` (seconds), by bisection */
  private async firstBlockAtOrAfter(time: bigint, head: bigint): Promise<bigint> {
    let lo = 0n;
    let hi = head;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await this.chain!.getBlock({ blockNumber: mid })).timestamp < time) lo = mid + 1n;
      else hi = mid;
    }
    return lo;
  }

  explorerUrl(txHash: string | null): string | null {
    if (!txHash || this.rail === "FIXTURE") return null;
    return `${this.network === "eip155:196" ? xLayer.blockExplorers.default.url : xLayerTestnet.blockExplorers.default.url}/tx/${txHash}`;
  }
}

export function createOkxRail(opts: { mainnet: boolean; apiKey?: string; secretKey?: string; passphrase?: string; payTo?: string; rpcUrl: string }): PaymentRailAdapter {
  const network: Network = opts.mainnet ? "eip155:196" : "eip155:1952";
  const facilitator: FacilitatorClient =
    opts.apiKey && opts.secretKey && opts.passphrase
      ? new OKXFacilitatorClient({ apiKey: opts.apiKey, secretKey: opts.secretKey, passphrase: opts.passphrase, syncSettle: true })
      : new MissingCredentialsFacilitator();
  return new PaymentRailAdapter(opts.mainnet ? "OKX_X402_MAINNET" : "OKX_X402_TESTNET", network, facilitator, opts.payTo, opts.rpcUrl);
}

class MissingCredentialsFacilitator implements FacilitatorClient {
  private fail(): never {
    throw new Error("OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE are required for the OKX x402 facilitator");
  }
  async getSupported(): Promise<SupportedResponse> {
    return this.fail();
  }
  async verify(): Promise<VerifyResponse> {
    return this.fail();
  }
  async settle(): Promise<SettleResponse> {
    return this.fail();
  }
}

export type FixtureFacilitatorMode = "ok" | "verify_invalid" | "settle_failed" | "settle_timeout" | "settle_throws";

/**
 * Test double for the facilitator. Signatures are genuinely verified (EIP-712,
 * EIP-3009 TransferWithAuthorization) but nothing is ever sent to a chain, so an
 * order paid through it is labelled FIXTURE and can never count as settled funds.
 */
export class FixtureFacilitator implements FacilitatorClient {
  mode: FixtureFacilitatorMode = "ok";
  /** what a later reconciliation should discover for authorizations left unknown */
  reconcileOutcome: "used" | "unused" | "unreadable" | "cancelled" = "unreadable";
  readonly settleCalls: string[] = [];
  private readonly usedNonces = new Set<string>();

  constructor(private readonly network: Network) {}

  async getSupported(): Promise<SupportedResponse> {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: this.network }], extensions: [], signers: {} };
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const auth = readAuthorization(payload);
    const signature = (payload.payload as { signature?: string }).signature;
    if (!auth || !signature) return { isValid: false, invalidReason: "invalid_payload" };
    if (this.mode === "verify_invalid") return { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: auth.from };
    const now = Math.floor(Date.now() / 1000);
    if (BigInt(auth.value) !== BigInt(requirements.amount)) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_value", payer: auth.from };
    if (getAddress(auth.to) !== getAddress(requirements.payTo)) return { isValid: false, invalidReason: "invalid_exact_evm_payload_recipient_mismatch", payer: auth.from };
    if (Number(auth.validBefore) < now) return { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_valid_before", payer: auth.from };
    if (this.usedNonces.has(`${auth.from}:${auth.nonce}`.toLowerCase())) return { isValid: false, invalidReason: "nonce_already_used", payer: auth.from };
    const ok = await verifyTypedData({
      address: getAddress(auth.from),
      domain: { name: String(requirements.extra.name), version: String(requirements.extra.version), chainId: Number(requirements.network.split(":")[1]), verifyingContract: getAddress(requirements.asset) },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: { from: getAddress(auth.from), to: getAddress(auth.to), value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce as `0x${string}` },
      signature: signature as `0x${string}`,
    });
    return ok ? { isValid: true, payer: auth.from } : { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: auth.from };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const auth = readAuthorization(payload);
    const key = `${auth?.from}:${auth?.nonce}`.toLowerCase();
    this.settleCalls.push(key);
    const base = { payer: auth?.from, network: requirements.network, transaction: "" };
    switch (this.mode) {
      case "settle_throws":
        throw new Error("fixture facilitator: connection reset during settle");
      case "settle_timeout":
        return { ...base, success: false, status: "timeout", errorReason: "settlement_timeout" };
      case "settle_failed":
        return { ...base, success: false, errorReason: "insufficient_funds" };
      default:
        this.usedNonces.add(key);
        return { ...base, success: true, status: "success", amount: requirements.amount };
    }
  }
}

export class FixtureRail extends PaymentRailAdapter {
  constructor(
    readonly fixtureFacilitator: FixtureFacilitator,
    payTo: string | undefined,
  ) {
    super("FIXTURE", "eip155:1952", fixtureFacilitator, payTo, null);
  }

  override async authorizationUsed(): Promise<boolean | null> {
    const outcome = this.fixtureFacilitator.reconcileOutcome;
    return outcome === "unreadable" ? null : outcome === "used" || outcome === "cancelled";
  }

  /** "cancelled" models cancelAuthorization: the nonce is consumed and no funds moved */
  override async authorizationSettled(): Promise<(ChainCheck & { txHash: string | null }) | null> {
    const outcome = this.fixtureFacilitator.reconcileOutcome;
    const checkedAt = new Date().toISOString();
    if (outcome === "used") return { verified: true, blockNumber: null, checkedAt, txHash: null, note: "fixture: the authorization was consumed by the quoted transfer" };
    return { verified: false, blockNumber: null, checkedAt, txHash: null, note: "fixture: no transfer used this authorization" };
  }
}
