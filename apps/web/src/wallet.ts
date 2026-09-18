import { getAddress } from "viem";
import type { ClientEvmSigner } from "@okxweb3/x402-evm";

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export class WalletError extends Error {}

type TypedDataField = { name: string; type: string };

// EIP-712 fixes the order of the domain fields; a wallet hashes whatever order it is given
const DOMAIN_FIELDS: readonly (TypedDataField & { key: string })[] = [
  { key: "name", name: "name", type: "string" },
  { key: "version", name: "version", type: "string" },
  { key: "chainId", name: "chainId", type: "uint256" },
  { key: "verifyingContract", name: "verifyingContract", type: "address" },
  { key: "salt", name: "salt", type: "bytes32" },
];

export function typedDataJson(data: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }): string {
  const domainType = DOMAIN_FIELDS.filter((f) => data.domain[f.key] !== undefined && data.domain[f.key] !== null).map(({ name, type }) => ({ name, type }));
  return JSON.stringify(
    { types: { EIP712Domain: domainType, ...data.types }, primaryType: data.primaryType, domain: data.domain, message: data.message },
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString(10) : value),
  );
}

function rpcCode(err: unknown): number | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

function rpcMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(err);
}

async function ensureChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof current === "string" && Number.parseInt(current, 16) === chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
  } catch (err) {
    if (rpcCode(err) === 4902) throw new WalletError(`The wallet has no network with chain id ${chainId}. Add it in the wallet first. Nothing was signed.`);
    throw new WalletError(`The wallet did not switch to chain id ${chainId}: ${rpcMessage(err)}. Nothing was signed.`);
  }
}

/** A ClientEvmSigner whose key never leaves the injected wallet. */
export async function connectSigner(provider: Eip1193Provider): Promise<ClientEvmSigner> {
  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (err) {
    throw new WalletError(`The wallet did not share an account: ${rpcMessage(err)}. Nothing was signed.`);
  }
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string") throw new WalletError("The wallet returned no account. Nothing was signed.");
  const address = getAddress(first);

  return {
    address,
    async signTypedData(data) {
      // wallets refuse eth_signTypedData_v4 when the domain's chain is not the active one
      const chainId = Number(data.domain.chainId);
      if (Number.isInteger(chainId) && chainId > 0) await ensureChain(provider, chainId);
      try {
        const signature = await provider.request({ method: "eth_signTypedData_v4", params: [address, typedDataJson(data)] });
        if (typeof signature !== "string" || !signature.startsWith("0x")) throw new Error("the wallet returned no signature");
        return signature as `0x${string}`;
      } catch (err) {
        if (rpcCode(err) === 4001) throw new WalletError("Signature declined in the wallet. Nothing was signed. Nothing charged.");
        throw new WalletError(`The wallet could not sign: ${rpcMessage(err)}. Nothing charged.`);
      }
    },
  };
}
