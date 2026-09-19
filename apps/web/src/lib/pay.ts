import type { Quote } from "@bullseye/domain";

/**
 * Payment seam. The browser never holds a private key. Whatever signs — an injected EIP-1193
 * wallet behind window.bullseyeSigner (see signer.ts), or an agent running `npm run buy` —
 * is handed the seller's 402 challenge and returns the PAYMENT-SIGNATURE header value.
 * The purchase itself (claim token, the one signature, recovery) is checkout/purchase.ts.
 */
export interface Signer {
  sign(challenge: string, quote: Quote): Promise<string>;
  /** drop the authorization held for a quote. Called only once the seller has said it failed and nothing was charged. */
  forget?(quoteId: string): void;
}
declare global { interface Window { bullseyeSigner?: Signer } }
