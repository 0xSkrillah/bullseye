The `EconomicsReceipt` for one order, as a terminal-style table on `canvas-inset`: price, measured usage, measured costs, estimated costs and the estimated contribution — five sections that are never added together under one heading. It is how a judge sees that Bullseye knows what a Brief cost and refuses to call an estimate a profit.

## When to use

The Console region after an order reaches PAID; before that, the same table with "—" values and the head "Receipt · pending". Also the closing frame of the demo.

## Anatomy

1. Head: "Receipt · {orderId} · {briefId}" in `mono`; the Paid stamp "✓ PAID {t}" in `verified` `mono-sm` on the right, only when the order state is PAID or later.
2. Rail line: `rail` and `network` in `mono-sm`, plus the TESTNET badge for `OKX_X402_TESTNET` or `FIXTURE`.
3. Table, one `section` row per heading, `th`-style in `label`:
   - **Price**: `priceUsd`; when `countsAsRevenue` is false the `revenueNote` follows in `mono-sm` ("Not revenue (testnet).").
   - **Measured usage**: model calls, tool calls, input tokens, output tokens, investigation latency, "Usage is fixture yes/no" from `usage`.
   - **Measured costs**: one row per `CostLine` with `basis` MEASURED — `label` · `detail` (the `CostBasis`), amount to four decimals — then "Measured total" = `measuredTotalUsd`.
   - **Estimated costs**: one row per `CostLine` with `basis` ESTIMATED, every cell in `uncertain`, amount prefixed `≈`, `detail` ending in "estimated" — then "Estimated total" = `estimatedTotalUsd`, also amber.
   - **Estimated contribution**: `estimatedContributionUsd` as the one `numeral` on the panel, `uncertain`, `≈`, the word "estimated"; then `contributionNote` verbatim in `mono-sm`, always ending "Not profit." and, on testnet, "Not revenue: rail is OKX_X402_TESTNET."
4. Figures are `mono`, tabular, right-aligned; USD to two decimals for price, four for costs.

## States

- **Pending**: head "Receipt · pending", no stamp, values "—", contribution row hidden.
- **Paid** (as previewed).
- **Fixture**: `usage.usageIsFixture` true → the usage section head gets a FIXTURE badge and all measured costs show `detail` "FIXTURE"; the contribution row prints "≈ — · fixture" instead of an amount.

## The consumer provides

An `EconomicsReceipt` from `@bullseye/domain` and the current `OrderState`.

## Do / don't

- Do keep measured and estimated in separate sections with their own totals.
- Don't render a "Net", "Profit", "Margin" or "Total" row that spans both.
- Don't set any estimate in `verified`, even when the order is paid.
