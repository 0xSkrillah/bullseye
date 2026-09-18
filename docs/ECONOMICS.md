# Delivery economics

Bullseye reports three kinds of number and never adds them under one heading.

| Kind | Meaning | Shown as |
| --- | --- | --- |
| **Price** | What the frozen quote charged. | Plain. "Not revenue" unless settled on X Layer mainnet and confirmed on-chain. |
| **Measured** | Derived from recorded usage of this investigation. | `MEASURED` lines with their basis. |
| **Estimated** | Planning allowances that have not been observed. | `ESTIMATED` lines, amber, with the word "estimated". |

## Measured

- **Model usage.** Input, output and cache tokens as reported by the provider for every call, priced
  at the published list rates below. This is *measured usage at list price*, not an invoice: it
  ignores discounts, and failed calls are recorded with zero tokens.
- **Data and chain reads.** Counted and timed. The public xStocks API and the public X Layer RPC
  charge nothing per call, so the measured cost is $0.00 and the receipt says why.

Rate card used by `apps/api/src/research/governor.ts` (USD per million tokens, as of 2026-09-18):

| Model | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| `claude-opus-5` | 5.00 | 25.00 | 0.50 | 6.25 |
| `claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 2.50 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 0.10 | 1.25 |

A model that is not on the rate card is refused: Bullseye will not run an investigation it cannot price.

## Estimated (defaults, configurable in `.env`)

| Allowance | Default | Status |
| --- | --- | --- |
| Payment and fee reserve | $0.15 | No facilitator or network fee has been measured. |
| Rework reserve | $0.20 | No rejection rate has been measured. |
| Data and tooling allowance | $0.10 | The endpoints used today are free. |

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

## What has actually been measured so far

Nothing with a real model: no API key was available during the build, so every receipt to date
shows fixture usage and **no measured model cost**, and says so. The $3.00 price is the
dossier's illustrative figure and has not been tested with buyers.
