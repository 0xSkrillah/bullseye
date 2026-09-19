import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@okxweb3/x402-core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Eip1193Provider } from "../wallet";
import { quote, terms } from "./fixtures";

type Required = Parameters<typeof encodePaymentRequiredHeader>[0];

function challengeFor(amount: string): string {
  const required = {
    x402Version: 2,
    resource: { url: terms.resource, description: "test resource", mimeType: "application/json" },
    accepts: [{ scheme: terms.scheme, network: terms.network, asset: terms.asset, amount, payTo: terms.payTo, maxTimeoutSeconds: terms.maxTimeoutSeconds, extra: terms.extra }],
  };
  return encodePaymentRequiredHeader(required as Required);
}

/** An EIP-1193 provider backed by a throwaway key, standing in for a wallet extension. */
function testWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  const signatures = vi.fn();
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts") return [account.address.toLowerCase()];
      if (method === "eth_chainId") return "0x7a0";
      if (method === "eth_signTypedData_v4") {
        signatures();
        const data = JSON.parse(String(params?.[1]));
        const { EIP712Domain: _domain, ...types } = data.types;
        return account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message: data.message });
      }
      throw new Error(`unsupported ${method}`);
    },
  };
  return { account, provider, signatures };
}

afterEach(() => {
  delete window.ethereum;
  delete window.bullseyeSigner;
  // the signer keeps its authorization per quote in sessionStorage, which outlives the module reset below
  sessionStorage.clear();
  vi.resetModules();
});

describe("window.bullseyeSigner", () => {
  it("is not installed when the browser has no wallet", async () => {
    await import("../signer");
    expect(window.bullseyeSigner).toBeUndefined();
  });

  it("returns the PAYMENT-SIGNATURE header value for the seller's challenge", async () => {
    const { account, provider, signatures } = testWallet();
    window.ethereum = provider;
    await import("../signer");
    const header = await window.bullseyeSigner!.sign(challengeFor(terms.amount), quote);

    const payload = decodePaymentSignatureHeader(header);
    const authorization = (payload.payload as { authorization: { from: string; to: string; value: string } }).authorization;
    expect(authorization.from.toLowerCase()).toBe(account.address.toLowerCase());
    expect(authorization.to.toLowerCase()).toBe(terms.payTo.toLowerCase());
    expect(authorization.value).toBe(terms.amount);
    expect(signatures).toHaveBeenCalledTimes(1);
  });

  it("hands back the authorization it holds for a quote, and asks the wallet again only once that one is dropped", async () => {
    const { provider, signatures } = testWallet();
    window.ethereum = provider;
    await import("../signer");
    const first = await window.bullseyeSigner!.sign(challengeFor(terms.amount), quote);
    expect(await window.bullseyeSigner!.sign(challengeFor(terms.amount), quote)).toBe(first);
    expect(signatures).toHaveBeenCalledTimes(1);

    window.bullseyeSigner!.forget!(quote.id);
    expect(sessionStorage.getItem(`bullseye.authorization.${quote.id}`)).toBeNull();
    expect(await window.bullseyeSigner!.sign(challengeFor(terms.amount), quote)).not.toBe(first);
    expect(signatures).toHaveBeenCalledTimes(2);
  });

  it("signs nothing when the challenge differs from the quote on screen", async () => {
    const { provider, signatures } = testWallet();
    window.ethereum = provider;
    await import("../signer");
    await expect(window.bullseyeSigner!.sign(challengeFor("9000000"), quote)).rejects.toThrow("Nothing was signed");
    expect(signatures).not.toHaveBeenCalled();
  });
});
