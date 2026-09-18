import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

/** well-known Hardhat development key; holds nothing on any real network */
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Gives the page an EIP-1193 provider whose signatures are produced in the test
 * process. The app under test runs its real wallet code path; only the wallet is stood in.
 */
export async function installTestWallet(page: Page): Promise<{ address: string; signatures: () => number }> {
  const account = privateKeyToAccount(DEV_KEY);
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

  return { address: account.address, signatures: () => signed };
}
