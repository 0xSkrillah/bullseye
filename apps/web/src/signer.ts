import type { Signer } from "./lib/pay";
import type { Eip1193Provider } from "./wallet";

/**
 * Fills the payment seam in lib/pay.ts, and only when the browser has an injected
 * EIP-1193 wallet. The key stays in the wallet; this page only asks it to sign the
 * seller's own challenge. Without a wallet nothing is installed, and lib/pay.ts
 * shows the challenge for a purchase made elsewhere.
 */
function wallet(): Eip1193Provider | null {
  return window.ethereum ?? null;
}

const KEY = (quoteId: string) => `bullseye.authorization.${quoteId}`;

/** the authorization is useless after its validBefore, so the memory of it expires then too */
function remember(quoteId: string, signature: string, validForSeconds: number): void {
  try {
    sessionStorage.setItem(KEY(quoteId), JSON.stringify({ signature, expiresAt: Date.now() + validForSeconds * 1000 }));
  } catch {
    // storage unavailable: the next Pay signs again, and the seller's ledger still prevents a double charge per authorization
  }
}

function recall(quoteId: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY(quoteId));
    if (!raw) return null;
    const held = JSON.parse(raw) as { signature: string; expiresAt: number };
    if (held.expiresAt > Date.now()) return held.signature;
    sessionStorage.removeItem(KEY(quoteId));
  } catch {
    return null;
  }
  return null;
}

function install(): void {
  if (window.bullseyeSigner || !wallet()) return;
  const signer: Signer = {
    async sign(challenge, quote) {
      const provider = wallet();
      if (!provider) throw new Error("The wallet is no longer available. Nothing was signed.");
      // the x402 client and viem load on first use, so a page without a wallet never downloads them
      // One authorization per quote: pressing Pay again after an unknown outcome re-sends the
      // same signed authorization, which the seller answers from its ledger without settling twice.
      const { signChallenge } = await import("./x402");
      const held = recall(quote.id);
      const signature = await signChallenge(provider, challenge, quote, held);
      if (!held) remember(quote.id, signature, quote.terms.maxTimeoutSeconds);
      return signature;
    },
  };
  window.bullseyeSigner = signer;
}

install();
// some wallets inject after the first scripts have run
window.addEventListener("ethereum#initialized", install, { once: true });
