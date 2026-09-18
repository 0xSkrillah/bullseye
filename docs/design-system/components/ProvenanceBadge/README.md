The word and dot that say where a piece of data came from: the four `DataMode`s from the domain (LIVE, CACHED, HISTORICAL, FIXTURE) plus two derived tags (STALE, TESTNET). It is the most repeated element in the product and the one a judge is meant to notice on every screen.

## When to use

Next to every external value, every evidence item, every Brief header (the Brief's own `dataMode`, which is the weakest of its inputs) and every payment amount. If a number has no badge within the same row, add one or remove the number.

## Kinds

- **LIVE** — `verified` dot on `verified-fill`. Fetched from the named source during this operation.
- **CACHED** — `uncertain` dot on `uncertain-fill`. A previous LIVE response served because the source failed. The tooltip names when it was cached and when the source failed.
- **HISTORICAL** — `historical` dot on `canvas-inset` with a `line` border. A recording of a real past response, or a read of past chain state.
- **FIXTURE** — `fixture` dot on `fixture-fill` with a **dashed** `fixture` border. Synthetic data; never sourced from a real system. The dashed border is deliberate so it reads as "not real" even in a screenshot.
- **STALE** — `invalid` `✕` on `invalid-fill`. Derived: `now > staleAfter`. Stale evidence blocks publication.
- **TESTNET** — `uncertain` outline, no fill, no dot. Derived from `PaymentRail === 'OKX_X402_TESTNET'`. Always accompanied by the words "Not revenue." on receipts.

Check verdicts (`Bullseye.verdict`) reuse the same colour logic for `CheckStatus`: `✓ PASS` in `verified`, `? UNKNOWN` in `uncertain`, `✕ FAIL` in `invalid`, `◐ RUNNING` in `uncertain`.

## Rules

- Never render a dot without its word. The word is the accessible name and the thing that survives a projector.
- Never invent a fifth mode. If a source's state does not fit, it is not allowed to be displayed as LIVE; use CACHED or HISTORICAL as the adapter labelled it.
- Never silently downgrade: a badge is set by the adapter, not by the UI.
- The badge is 20px tall, `label` style, `radius-sm`. It never grows to fit a longer word; the six words above are the whole vocabulary.

## The consumer provides

`kind: BadgeKind` and an optional `title` for the tooltip (default titles in the copy section).
