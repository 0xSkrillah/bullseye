import { describe, expect, it } from "vitest";
import { acceptable, type Offer, type SpendLimits } from "../../../scripts/spend-guard.js";

const limits: SpendLimits = { maxUsd: 5, networks: ["eip155:1952"] };
const offer = (over: Partial<Offer> = {}): Offer => ({
  scheme: "exact",
  network: "eip155:1952",
  asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
  amount: "3000000",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  ...over,
});
const reason = (o: Offer, l = limits) => {
  const v = acceptable(o, l);
  return v.ok ? null : v.reason;
};

describe("agent buyer spend guard", () => {
  it("accepts a quote within the limits", () => {
    expect(acceptable(offer(), limits)).toEqual({ ok: true });
    expect(acceptable(offer({ asset: "0x9E29B3AADA05BF2D2C827AF80BD28DC0B9B4FB0C" }), limits)).toEqual({ ok: true });
  });

  it("refuses an amount above the limit whatever the seller says the price is", () => {
    expect(reason(offer({ amount: "5000001" }))).toMatch(/exceeds the limit/);
    expect(reason(offer({ amount: "1000000000" }))).toMatch(/exceeds the limit/);
    expect(acceptable(offer({ amount: "5000000" }), limits).ok).toBe(true);
  });

  it("refuses any network that was not allowed, not only X Layer mainnet", () => {
    for (const network of ["eip155:196", "eip155:1", "eip155:8453", "solana:mainnet"]) expect(reason(offer({ network }))).toMatch(/not allowed/);
    expect(acceptable(offer({ network: "eip155:196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736" }), { maxUsd: 5, networks: ["eip155:1952", "eip155:196"] }).ok).toBe(true);
  });

  it("refuses a token contract it does not know, including the right token on the wrong network", () => {
    expect(reason(offer({ asset: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d" }))).toMatch(/not a known settlement asset/);
    expect(reason(offer({ network: "eip155:196" }), { maxUsd: 5, networks: ["eip155:196"] })).toMatch(/not a known settlement asset/);
  });

  it("refuses malformed amounts, zero, other schemes and unusable recipients", () => {
    expect(reason(offer({ amount: "3e6" }))).toMatch(/not an integer/);
    expect(reason(offer({ amount: "-1" }))).toMatch(/not an integer/);
    expect(reason(offer({ amount: "0" }))).toMatch(/zero/);
    expect(reason(offer({ scheme: "upto" }))).toMatch(/not supported/);
    expect(reason(offer({ payTo: "0x0000000000000000000000000000000000000000" }))).toMatch(/recipient/);
  });
});
