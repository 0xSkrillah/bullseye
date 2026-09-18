/**
 * What an agent buyer is willing to sign. The limits are applied to the payment terms
 * themselves (network, token contract, base-unit amount), because those are what the
 * signature authorises; a seller's stated price is only a description.
 */

export interface Offer {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export type Network = `${string}:${string}`;

export interface SpendLimits {
  maxUsd: number;
  networks: Network[];
}

/** USD stablecoins the buyer will pay in; an unknown token contract is never signed for */
export const SETTLEMENT_ASSETS: Record<string, { address: string; name: string; decimals: number }> = {
  "eip155:1952": { address: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c", name: "USD₮0 (X Layer testnet)", decimals: 6 },
  "eip155:196": { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", name: "USD₮0 (X Layer mainnet)", decimals: 6 },
};

export function acceptable(offer: Offer, limits: SpendLimits): { ok: true } | { ok: false; reason: string } {
  if (offer.scheme !== "exact") return { ok: false, reason: `scheme ${offer.scheme} is not supported` };
  if (!(limits.networks as string[]).includes(offer.network)) return { ok: false, reason: `network ${offer.network} is not allowed` };
  const asset = SETTLEMENT_ASSETS[offer.network];
  if (!asset || asset.address.toLowerCase() !== offer.asset.toLowerCase()) return { ok: false, reason: `asset ${offer.asset} is not a known settlement asset on ${offer.network}` };
  if (!/^\d+$/.test(offer.amount)) return { ok: false, reason: `amount ${offer.amount} is not an integer number of base units` };
  if (!/^0x[0-9a-fA-F]{40}$/.test(offer.payTo) || /^0x0{40}$/.test(offer.payTo)) return { ok: false, reason: `recipient ${offer.payTo} is not a usable address` };
  const ceiling = BigInt(Math.floor(limits.maxUsd * 10 ** asset.decimals));
  if (BigInt(offer.amount) > ceiling) return { ok: false, reason: `amount ${offer.amount} base units exceeds the limit of ${ceiling} ($${limits.maxUsd})` };
  if (BigInt(offer.amount) === 0n) return { ok: false, reason: "amount is zero" };
  return { ok: true };
}
