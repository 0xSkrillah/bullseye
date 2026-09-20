# Data-to-display contract
Fill exact current API paths/field names before implementation. Do not assume this conceptual table is a new backend contract.

| Element | Existing source to verify | Allowed transformation | Required qualifiers |
|---|---|---|---|
| Event headline | market response / signal asset and event fields | Human-readable terminology | Not a price forecast; actual event type |
| Rebase delta | server-derived event/figure result | Specified decimal display rounding only | Unit, old/new values, event time |
| Observed chart | market observation points and marker | Time/axis mapping; accessible table | No interpolation as invented history; actual point times |
| Evidence strength | gate result / confidence cap | Plain label + explanation | Not statistical accuracy or return probability |
| Event age | effective/first detection timestamps | Current age with captured clock | Do not overwrite first detection on refresh |
| Provenance | transport/evidence mode | Badge | LIVE retrieval not necessarily recent event; source permission |
| Price | current quote/rail metadata | Amount formatter using asset decimals | Testnet/network/asset; quote expiry; no hardcoded USD substitute |
| Payment | buyer-owned purchase/order state | State presentation only | “Signed” not “Paid”; unknown not failure; recovery rights |
| Economics | permitted per-order or aggregate endpoint | Format totals; preserve sign/basis | Measured vs estimated; test payment vs revenue; not net profit |
| Hidden result | public projection / withheld marker | Explain included-in-brief | No fetching/rendering protected value in the free DOM |
| Receipt | authorized delivery/order | Download/copy permitted content | No claim token, key or raw signature in public analytics |

## Before adding any widget
Record route, fields, access role, source mode, observed time, derivation, exact units, missing semantics, click action and regression test. If an essential field is unavailable, use a correct empty/partial state and report the backend need; never fabricate it for visual completeness.

## Formatting
One numeric formatter per unit class. Keep exact large multipliers and hashes in disclosure/copy. Rounded headline and chart/table must correspond; display rounding must never feed payment amounts or calculations. Reserve minus signs and zero; positive observations are not automatically bullish. Reference differences and modeled scenarios require distinct labels from executed transactions.
