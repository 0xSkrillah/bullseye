import { z } from "zod";

export const OrderState = z.enum([
  "QUOTED",
  "PAYMENT_PENDING",
  "PAYMENT_UNKNOWN",
  "PAYMENT_FAILED",
  "PAID",
  "DELIVERING",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RECONCILIATION_REQUIRED",
]);
export type OrderState = z.infer<typeof OrderState>;

/**
 * The only legal moves. PAYMENT_UNKNOWN is where a timeout lands: it is neither
 * success nor failure and can only be left through reconciliation evidence.
 */
export const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  QUOTED: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["PAID", "PAYMENT_FAILED", "PAYMENT_UNKNOWN"],
  PAYMENT_UNKNOWN: ["PAID", "PAYMENT_FAILED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["PAID", "PAYMENT_FAILED"],
  PAYMENT_FAILED: [],
  PAID: ["DELIVERING"],
  DELIVERING: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERY_FAILED: ["DELIVERING"],
  DELIVERED: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderState,
    readonly to: OrderState,
  ) {
    super(`illegal order transition ${from} -> ${to}`);
  }
}

export const PaymentRail = z.enum(["OKX_X402_TESTNET", "OKX_X402_MAINNET", "FIXTURE"]);
export type PaymentRail = z.infer<typeof PaymentRail>;

/** Terms are frozen when the quote is issued. The hash binds an order to exactly these terms. */
export const QuoteTerms = z.object({
  briefId: z.string(),
  briefContentHash: z.string(),
  priceUsd: z.string().regex(/^\d+\.\d{2,6}$/),
  /** token base units */
  amount: z.string().regex(/^\d+$/),
  asset: z.string(),
  assetName: z.string(),
  assetDecimals: z.number().int(),
  network: z.string().regex(/^eip155:\d+$/),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  scheme: z.literal("exact"),
  maxTimeoutSeconds: z.number().int().positive(),
  /** scheme-specific fields the buyer needs in order to sign (EIP-712 token name and version) */
  extra: z.record(z.string()),
  rail: PaymentRail,
  resource: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type QuoteTerms = z.infer<typeof QuoteTerms>;

export const Quote = z.object({
  id: z.string().regex(/^quo_[0-9a-f]{16}$/),
  terms: QuoteTerms,
  termsHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Quote = z.infer<typeof Quote>;

export const PaymentEvidence = z.object({
  rail: PaymentRail,
  payer: z.string().nullable(),
  txHash: z.string().nullable(),
  network: z.string(),
  facilitatorStatus: z.string().nullable(),
  /** set only after an independent read of the chain confirmed the transfer */
  chainVerified: z.boolean(),
  chainBlockNumber: z.number().int().nullable(),
  chainCheckedAt: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  note: z.string().nullable(),
});
export type PaymentEvidence = z.infer<typeof PaymentEvidence>;

export const OrderEvent = z.object({
  seq: z.number().int(),
  at: z.string().datetime(),
  from: OrderState.nullable(),
  to: OrderState,
  reason: z.string(),
});
export type OrderEvent = z.infer<typeof OrderEvent>;

export const Order = z.object({
  id: z.string().regex(/^ord_[0-9a-f]{16}$/),
  quoteId: z.string(),
  termsHash: z.string(),
  terms: QuoteTerms,
  state: OrderState,
  /** sha256 of the signed payment authorization; one authorization can only ever map to one order */
  paymentKey: z.string().nullable(),
  payment: PaymentEvidence.nullable(),
  deliveryCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  events: z.array(OrderEvent),
});
export type Order = z.infer<typeof Order>;
