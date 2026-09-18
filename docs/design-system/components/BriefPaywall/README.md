The sheet that sells a Brief: the `Quote`'s frozen `QuoteTerms` rendered once, the TESTNET tag when the rail is a testnet, one plain sentence about what happens if payment cannot be confirmed, and a single primary action. After the click its body becomes the `PaymentState`.

## When to use

Over the Brief body from "Why it may matter" down, on the Purchase screen. The header and "What happened" stay visible above it. One per Brief; it never appears on the Feed.

## Anatomy

1. Eyebrow "IMMUTABLE QUOTE" in `label`.
2. Price: `terms.priceUsd` as `numeral` ("$3.00") with the TESTNET badge beside it when `terms.rail` is `OKX_X402_TESTNET` or `FIXTURE`.
3. Terms list (`be-kv`), all in `mono`, straight from `QuoteTerms`: Amount (`amount` base units · `asset` · decimals), Network (`network` as `eip155:…` plus its name), Pay to (`payTo`, truncated, full in `title`), Scheme (`scheme` · `rail`), Brief (`briefId` · `briefContentHash` truncated), Terms (`quote.id` · `termsHash` truncated).
4. Meta line in `mono-sm`: "Issued {issuedAt} · expires {expiresAt} ({mm:ss})" with a live countdown.
5. Body sentence, fixed in the copy section; it contains the double-charge promise.
6. Actions: primary "Pay $3.00 via OKX x402" (aria-label spells out the network), secondary "View evidence first".

## States

- **Quoted**: as above. The terms block is rendered from `termsHash` once and never re-rendered with different values; a changed hash means a new sheet.
- **Paying**: the button is disabled with "Authorising…" in `mono-sm`; the body is replaced by `PaymentState` in PAYMENT_PENDING.
- **Expired** (`is-expired`): price struck through in `ink-muted`, meta in `invalid` "expired at {t}", body "Quote expired before payment. Nothing was charged. A new quote will carry a new id and its own hash.", single secondary button "Request new quote".
- **Unavailable** (gate REJECT): the sheet is not shown; `PublicationGateResult` takes its place.

## Accessibility

`role="dialog"` labelled by the eyebrow; focus lands on the primary button; the countdown is `aria-live="off"` (it updates every second) with the absolute expiry in the visible text.

## The consumer provides

A `Quote`, `now`, and `onPay`, `onViewEvidence`, `onRequote`.

## Do / don't

- Do show every term; the judge should be able to hash them.
- Don't show a discount, a "was" price, an urgency banner or a second call to action.
- Don't restyle the primary button green; `verified` is for money that has moved, not money that is asked for.
