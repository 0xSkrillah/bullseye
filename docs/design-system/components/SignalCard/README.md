One `SignalEvent` in the Bullseye Feed: asset, headline, detected/observed time, the reason it was flagged, the corporate-action facts and its provenance mode. It is the first thing a judge sees and the thing that expands into a Brief.

## When to use

Only in the Feed region, in a vertical list, newest first. Never reuse it as a generic "card" elsewhere; the Brief header is its own element.

## Anatomy

1. Eyebrow: `category` humanised, in `label` (`be-stage`) — "Corporate action · rebase".
2. Title in `heading`: `headline`, present tense, fact first — "Dividend rebase applied: multiplier 1.000000 → 1.004871".
3. Meta row in `mono`, `ink-secondary`: `asset.symbol · asset.name · X Layer`, then `Detected hh:mm:ssZ · Observed hh:mm:ssZ`. Both times, always: the gap between them is the product's honesty about latency.
4. Reason in `body-sm`: `reasonFlagged`, prefixed by the stylesheet with "Flagged: " in `ink-secondary`.
5. Facts strip in `mono-sm`: `facts.corporateActionId v{version} · caType · status · id`.
6. One `ProvenanceBadge` for `provenance.mode`; add TESTNET only where a payment amount appears (not on the card itself).

## States

- **Default**: `canvas-raised`, 1px `line`.
- **Hover**: `canvas-overlay`.
- **Locked** (`is-locked`): 1px `line-strong` border and `▸ LOCKED` in the header. Exactly one card in the feed at a time. This is the card the radar locked onto and the one under investigation.
- **Noise** (`is-noise`): text in `ink-secondary`, reason hidden, "Not investigated" in the header. Noise cards stay in the feed so the judge sees what Bullseye chose *not* to chase.
- **Focus**: 2px `focus` ring, 2px offset.

## The consumer provides

A `SignalEvent` from `@bullseye/domain`, the `locked`/`noise` flags and an `onLock` handler. The card does not fetch, compute confidence or format dates; times arrive as ISO strings and are rendered as `hh:mm:ssZ` inside a `<time>` with the full value in `datetime`.

## Do / don't

- Do keep the headline under 64 characters; it must fit two lines at 320px.
- Don't add a price, a chart, a sparkline or an arrow; the multiplier change is a fact, not a direction.
- Don't colour the card by "sentiment"; the only colour on a card is its badge.
