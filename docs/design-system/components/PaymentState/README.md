The honest ladder of an `Order`: QUOTED → PAYMENT_PENDING → PAID → DELIVERING → DELIVERED, with the exceptional stops PAYMENT_UNKNOWN, RECONCILIATION_REQUIRED, PAYMENT_FAILED and DELIVERY_FAILED shown as states in their own right. Under the ladder, the order's `events[]` trail and its `PaymentEvidence`.

## When to use

Inside the BriefPaywall after the pay click, and in the Console beside the receipt. It is the only place order state is rendered; the receipt's Paid stamp reads from it.

## Anatomy

1. Head in `label`: "Order · {id} · {state}".
2. Step bar (`be-pay-steps`): five 3px segments for the happy path. `done` segments are `ink`; PAID and DELIVERED segments turn `verified` when reached; an exceptional state colours its segment `uncertain` (PENDING/UNKNOWN/RECONCILIATION) or `invalid` (FAILED). Decorative: `aria-hidden`.
3. Lines (`be-pay-line be-pay-{state}`), one per state reached, in order: glyph · state word in `mono` (colour by state) · text in `ink-secondary` with figures in `ink`. Glyphs: `○` QUOTED, `◐` PAYMENT_PENDING, `?` PAYMENT_UNKNOWN (pulses), `⟳` RECONCILIATION_REQUIRED, `✕` failures, `✓` PAID and DELIVERED, `→` DELIVERING.
4. PAID line carries `PaymentEvidence`: tx hash, "chain-verified at block N" only when `chainVerified` is true (otherwise "facilitator: {status} · not yet chain-verified"), and the explorer link.
5. Actions, only where the domain allows a move: PAYMENT_UNKNOWN → "Reconcile from chain"; DELIVERY_FAILED → "Retry delivery". There is never a "Pay again" button: a retry re-uses the `paymentKey`.
6. Event trail (`be-pay-events`): `events[]` as "{at} · {from} → {to} · {reason}" in `mono-sm`.

## The fixed sentences

- PAYMENT_UNKNOWN: "No answer from facilitator after 90 s. Neither success nor failure. Bullseye will not deliver until the chain confirms. **A retry cannot charge you twice.**"
- PAYMENT_FAILED: "Payment failed: {reason}. **Nothing delivered. Nothing charged.**"
- DELIVERY_FAILED: "Delivery failed: {reason}. Payment stands; delivery will be retried."
- DELIVERED: "{at} · sha256 matches quote terms".

## Accessibility

`role="status"`, `aria-live="polite"`; each new line is announced once. The PAYMENT_UNKNOWN pulse is 1.2 s, the only looping motion in the product, and is static under reduced motion.

## The consumer provides

An `Order` (state, events, payment, paymentKey) and `onReconcile`.

## Do / don't

- Do show the `paymentKey` truncated on PAYMENT_PENDING and later; it is why a retry maps to the same order.
- Don't collapse the ladder into a single status pill; the judge needs to see the path and where it stopped.
- Don't turn PAID green until `chainVerified` is true; the facilitator's word alone is `ink`.
