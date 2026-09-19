import { z } from "zod";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import type { Quote } from "@bullseye/domain";
import { connectSigner, type Eip1193Provider } from "./wallet";

const Accept = z.object({ scheme: z.string(), network: z.string(), asset: z.string(), amount: z.string(), payTo: z.string() });

export class QuoteMismatchError extends Error {
  override readonly name = "QuoteMismatchError";
}

/**
 * Ask the wallet for exactly one signed authorization for exactly the quoted terms.
 * `challenge` is the PAYMENT-REQUIRED header of the seller's 402; the result is the
 * PAYMENT-SIGNATURE header value for the retry. Throws before any signature is
 * requested if the challenge differs from the quote on screen.
 */
export async function signChallenge(provider: Eip1193Provider, challenge: string, quote: Quote, held: string | null = null): Promise<string> {
  const client = new x402Client();
  const http = new x402HTTPClient(client);
  const required = http.getPaymentRequiredResponse((name) => (name.toLowerCase() === "payment-required" ? challenge : null));

  const offer = Accept.safeParse(required.accepts[0]);
  const t = quote.terms;
  if (
    required.accepts.length !== 1 ||
    !offer.success ||
    offer.data.scheme !== t.scheme ||
    offer.data.network !== t.network ||
    offer.data.amount !== t.amount ||
    offer.data.asset.toLowerCase() !== t.asset.toLowerCase() ||
    offer.data.payTo.toLowerCase() !== t.payTo.toLowerCase()
  ) {
    throw new QuoteMismatchError("The payment requirements in the 402 challenge differ from the quoted terms. Nothing was signed.");
  }

  // an authorization already signed for this quote is re-sent rather than replaced
  if (held) return held;

  // the wallet is only approached once the terms are known to match
  registerExactEvmScheme(client, { signer: await connectSigner(provider) });
  const payload = await http.createPaymentPayload(required);
  const header = http.encodePaymentSignatureHeader(payload)["PAYMENT-SIGNATURE"];
  if (!header) throw new Error("The x402 client produced no PAYMENT-SIGNATURE header. Nothing was sent.");
  return header;
}
