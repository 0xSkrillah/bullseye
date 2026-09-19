# Delivery economics

Bullseye reports three kinds of number and never adds them under one heading.

| Kind | Meaning | Shown as |
| --- | --- | --- |
| **Price** | What the frozen quote charged. | Plain. "Not revenue" unless settled on X Layer mainnet and confirmed on-chain. |
| **Measured** | Derived from recorded usage of this investigation. | `MEASURED` lines with their basis. |
| **Estimated** | Planning allowances that have not been observed, and model charges the provider did not report. | `ESTIMATED` lines, amber, with the word "estimated". |

## Measured

Every usage record carries a cost basis (`CostBasis` in `packages/domain/src/budget.ts`). The basis
decides where the amount appears on the receipt (`apps/api/src/economics/receipt.ts`).

| Cost basis | What the amount is | On the receipt |
| --- | --- | --- |
| `MEASURED_PROVIDER_BILLED` | The amount the provider reports it charged for the call. With OpenRouter this is `usage.cost`. | `MEASURED`, "Model usage, as billed", with the number of calls and the models they were routed to. |
| `MEASURED_USAGE_AT_LIST_PRICE` | Provider-reported tokens multiplied by the published list price. Anthropic only. | `MEASURED`, "Model usage", with the token counts and the rate-card date. The line says "Not an invoice": it ignores discounts. |
| `UPPER_BOUND_AT_PRICE_CAP` | A call whose charge is unknown, carried at the configured price cap. A ceiling, not a measurement. | `ESTIMATED`, "Model usage, upper bound". Never under `MEASURED`. |
| `NO_MARGINAL_PRICE` | A call with no per-call price: a tool call against the public xStocks API or the public X Layer RPC, or a model request that never reached a model. $0.00. | Tool calls are counted in the `MEASURED` line "Data and chain reads" at $0.00, and the line says why. |
| `FIXTURE` | Usage produced by the test double. Not a real cost. | Not measured. The receipt has no `MEASURED` lines, sets `usageIsFixture`, and lists "Model usage" at $0.00 under `ESTIMATED` with the reason. |

- **The billed amount wins.** When the provider reports a charge, that amount is recorded, rounded to
  six decimals, and nothing is computed from tokens. With an OpenRouter bring-your-own-key account
  `usage.cost` is only OpenRouter's fee, so the billed amount is `usage.cost` plus
  `cost_details.upstream_inference_cost`; if that field is absent the charge is unknown.
- **Unknown charge.** If a response reports tokens but no charge, the tokens are priced at the cap.
  If the outcome itself is unknown, the request is carried at a ceiling: request bytes counted as
  input tokens and `max_tokens` as output, at the price cap. Either way the basis is
  `UPPER_BOUND_AT_PRICE_CAP`. The amount counts against the investigation's budget, and the receipt
  lists it under `ESTIMATED`.
- **Failed calls.** A call that fails after it may have been processed is still costed: the billed
  amount if reported, otherwise the ceiling. A request that never reached a model costs $0.00 with
  basis `NO_MARGINAL_PRICE`.
- **Data and chain reads.** Counted and timed. The public xStocks API and the public X Layer RPC
  charge nothing per call, so the measured cost is $0.00 and the receipt says why.

The budget governor (`apps/api/src/research/governor.ts`) prices the next model call at worst-case
rates before it is made. Where those rates come from depends on `SYNTHESIS_PROVIDER`.

**`openrouter` (default).** The model is `openrouter/auto` and the routed model is not known in
advance, so there is no rate card. The worst case is `OPENROUTER_MAX_PRICE_PROMPT` (default 3) and
`OPENROUTER_MAX_PRICE_COMPLETION` (default 15), USD per million tokens. The same two values are
sent with every request as `provider.max_price`, a hard filter that also applies to routed models.
That is what lets the governor refuse a call before it is made. The provider does not start unless
both caps are positive.

**`anthropic`.** The Claude rate card below applies only to `SYNTHESIS_PROVIDER=anthropic` (USD per
million tokens, as of 2026-09-18):

| Model | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| `claude-opus-5` | 5.00 | 25.00 | 0.50 | 6.25 |
| `claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 2.50 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 0.10 | 1.25 |

With this provider a model that is not on the rate card is refused: Bullseye will not run an
investigation it cannot price.

## Estimated (defaults, configurable in `.env`)

| Allowance | Default | Status |
| --- | --- | --- |
| Payment and fee reserve | $0.15 | No facilitator or network fee has been measured. |
| Rework reserve | $0.20 | No rejection rate has been measured. The one live investigation needed one revision ($0.037156, inside its measured total); one run is not a rate. |
| Data and tooling allowance | $0.10 | The endpoints used today are free. |

A model call carried at `UPPER_BOUND_AT_PRICE_CAP` is also listed here, as "Model usage, upper
bound". The one live investigation had none.

## Estimated contribution

`price − measured total − estimated total`, with the **whole** investigation cost charged to the
order as if it were the only sale of that Brief. It excludes labour, hosting, customer
acquisition, overhead and tax. It is an estimate and is never presented as profit.

## The budget is part of the economics

Each investigation has a maximum variable cost (default $0.60), model-call ceiling (6), tool-call
ceiling (14), latency ceiling (180 s) and per-call output ceiling (8 000 tokens). Before starting,
Bullseye checks that the price exceeds the cost ceiling plus the estimated allowances; if not, it
declines with `DECLINED_UNECONOMIC` before spending anything. At the default $3.00 price the worst
case leaves $3.00 − $0.60 − $0.45 = $1.95 of estimated contribution.

Before every model call the governor projects the next call at the worst-case rates: the context so
far as input plus a full-length reply as output. The first call assumes 3 000 input tokens. At the
default OpenRouter caps that is 3 000 × $3 + 8 000 × $15 per million = $0.129. If the amount already
spent plus the projection exceeds the ceiling, the call is refused with `BUDGET_COST_EXCEEDED`.
Amounts carried at the price cap count as spent.

With OpenRouter, one governor approval is one billable request. A timeout, dropped connection,
unreadable 200 body, 408 or 5xx is not re-sent, because the model may have run and been billed.
Only HTTP 429 and connections that never opened (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) are
retried. The request timeout is the smaller of 120 s and the time left in the investigation's
latency budget, with a floor of 5 s. The Anthropic provider is unchanged and still uses its SDK's
own retries (`maxRetries: 2`), so the rule holds for OpenRouter only.

## What has actually been measured so far

One investigation with a real model, on 2026-09-18. It is one run: not an average, not a rate, not
a benchmark.

Signal `sig_24ecf336903c1da1` (QSRx, CashDividend). `SYNTHESIS_PROVIDER=openrouter`, model
`openrouter/auto`, cost tier `medium`, caps $3 / $15 per million tokens. 4 model calls and 10 tool
calls. All four model calls have basis `MEASURED_PROVIDER_BILLED`.

| # | Call | Routed model | Tokens in / out, as reported | Billed |
| --- | --- | --- | --- | --- |
| 1 | plan evidence collection | `deepseek/deepseek-v4-pro` | 1819 / 782 | $0.005413 |
| 2 | plan evidence collection | `deepseek/deepseek-v4-pro` | 3936 / 21 | $0.006607 |
| 3 | write brief | `deepseek/deepseek-v4-pro` | 4675 / 4142 | $0.022549 |
| 4 | revise brief after gate rejection | `openai/gpt-5.6-terra` | 3 / 1786 | $0.037156 |
| | **Total** | | | **$0.071725** |

The total is $0.071725 against the $0.60 ceiling. Nothing was carried at the price cap
(`upperBoundModelCostUsd` 0, `budgetSpentUsd` 0.071725). The cost carried is the billed amount, not
a figure computed from the token counts. Call 4 exists because the publication gate rejected the
first draft on rule `SCHEMA`; the one permitted revision passed. No rejection rate can be inferred
from one run. Transcript: `artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`.

**Reconciliation.** Before the investigation, `npm run model-check` made one metered call:
`openrouter/auto`, routed to `z-ai/glm-5.2`, 27 prompt and 68 completion tokens, billed $0.0005055
(`artifacts/integration/model-check-2026-09-18T21-57-37-431Z.json`). OpenRouter's `GET /api/v1/key`
later reported cumulative usage of $0.07222918 for the key. The recorded calls sum to $0.0722305
($0.0005055 + $0.071725). The $0.0000013 difference is rounding to six decimals per record. The
ledger lags: 3 s after the model-check call it still showed no change.

**Receipt.** The Brief from this investigation, `brf_a790c648a87d52dd`, was bought once, by the
repository's agent buyer (`npm run buy`), on X Layer testnet: order `ord_8a2102084ad69dab`. Its
receipt:

| Line | Kind | Amount |
| --- | --- | --- |
| Price | Price | $3.00, `countsAsRevenue: false` |
| Model usage, as billed | `MEASURED` | $0.071725 |
| Data and chain reads | `MEASURED` | $0.00 |
| Estimated allowances | `ESTIMATED` | $0.45 |
| Estimated contribution | Estimate | $2.478275 |

The revenue note reads: "Paid with test tokens on X Layer testnet. This proves the payment
mechanics; it is not revenue." $2.478275 is $3.00 − $0.071725 − $0.45. It is an estimate from one
order, it excludes labour, hosting, customer acquisition, overhead and tax, and it is not profit.

No facilitator or network fee has been measured. The $3.00 price is the dossier's illustrative
figure and has not been tested with buyers. Receipts for runs with the fixture synthesiser show no
measured model cost, and say so.
