import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

/** well-known Hardhat development keys; they hold nothing on any real network */
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const SECOND_DEV_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

/** sign: a working wallet. decline: the buyer rejects the signature (EIP-1193 4001). wrong_chain: another network is active and the wallet has no X Layer testnet (4902). */
export type TestWalletMode = "sign" | "decline" | "wrong_chain";

/**
 * Gives the page an EIP-1193 provider whose signatures are produced in the test
 * process. The app under test runs its real wallet code path; only the wallet is stood in.
 */
export async function installTestWallet(page: Page, key: `0x${string}` = DEV_KEY): Promise<{ address: string; signatures: () => number; setMode: (mode: TestWalletMode) => Promise<void> }> {
  const account = privateKeyToAccount(key);
  let signed = 0;

  await page.exposeFunction("__testWalletSign", async (typedDataJson: string) => {
    const data = JSON.parse(typedDataJson) as { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
    const { EIP712Domain: _domainType, ...types } = data.types;
    const message = Object.fromEntries(
      Object.entries(data.message).map(([k, v]) => {
        const field = types[data.primaryType]?.find((f) => f.name === k);
        return [k, field?.type.startsWith("uint") ? BigInt(v as string) : v];
      }),
    );
    signed++;
    return account.signTypedData({ domain: { ...data.domain, chainId: Number(data.domain.chainId) }, types, primaryType: data.primaryType, message } as never);
  });

  await page.addInitScript((address) => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      isTestWallet: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const mode = (window as unknown as { __testWalletMode?: string }).__testWalletMode ?? "sign";
        const refuse = (code: number, message: string) => Object.assign(new Error(message), { code });
        if (mode === "wrong_chain" && method === "eth_chainId") return "0x1";
        if (mode === "wrong_chain" && method === "wallet_switchEthereumChain") throw refuse(4902, "Unrecognized chain ID");
        if (mode === "decline" && method === "eth_signTypedData_v4") throw refuse(4001, "User rejected the request.");
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [address];
          case "eth_chainId":
            return "0x7a0";
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          case "eth_signTypedData_v4": {
            const raw = params?.[1];
            return (window as unknown as { __testWalletSign: (j: string) => Promise<string> }).__testWalletSign(typeof raw === "string" ? raw : JSON.stringify(raw));
          }
          default:
            throw new Error(`test wallet: unsupported method ${method}`);
        }
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  }, account.address);

  const setMode = (mode: TestWalletMode) => page.evaluate((m) => void ((window as unknown as { __testWalletMode?: string }).__testWalletMode = m), mode);
  return { address: account.address, signatures: () => signed, setMode };
}
