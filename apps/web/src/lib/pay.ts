import type { Quote } from "@bullseye/domain";
import { api } from "./api";

/**
 * Payment seam. The browser never holds a private key, so the default flow is:
 *   1. request the 402 challenge for the quote (proves the resource and terms),
 *   2. hand the challenge to whatever signs — a wallet extension implementing
 *      window.bullseyeSigner, or the operator running `npm run buy -- <briefId>` —
 *   3. poll /api/orders until an order for this brief appears and follow its state.
 * Wire @okxweb3/x402-fetch behind `window.bullseyeSigner` to make step 2 in-page.
 */
export interface Signer { sign(challenge: string, quote: Quote): Promise<string> }
declare global { interface Window { bullseyeSigner?: Signer } }

export type PayOutcome = { kind: "delivered"; orderId: string | null; body: unknown } | { kind: "challenged"; challenge: string } | { kind: "error"; detail: string };

export async function payForBrief(quote: Quote): Promise<PayOutcome> {
  const first = await api.paidBrief(quote.terms.briefId, quote.id);
  if (first.status === 200) return { kind: "delivered", orderId: first.orderId, body: first.body };
  if (first.status !== 402 || !first.challenge) return { kind: "error", detail: `unexpected ${first.status} from the paid resource` };
  const signer = window.bullseyeSigner;
  if (!signer) return { kind: "challenged", challenge: first.challenge };
  const sig = await signer.sign(first.challenge, quote);
  const second = await api.paidBrief(quote.terms.briefId, quote.id, sig);
  if (second.status === 200) return { kind: "delivered", orderId: second.orderId, body: second.body };
  return { kind: "error", detail: `paid resource answered ${second.status}` };
}
