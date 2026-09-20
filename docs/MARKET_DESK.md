# Market Desk

`/market`, and `/market/<signalId>` for one event. Added 20 September 2026.

The desk at `/` shows that an investigation happened. The Market Desk says what the event does to
money, for a customer who has to decide one thing:

> Is this opportunity still interesting after checking the data, the adjustments and the costs?

For every event this desk has seen so far the answer is **no transactable opportunity**, and the
screen says so at the top, with its reasons. That is the finding, not a failure to find one: the
sources Bullseye is allowed to read publish no bid, no ask, no size and no expiry, so no spread
can be quoted, and the costs that would have to be netted against one are unknown. An unknown
cost is not zero.

This is a read-only view. It extends Bullseye's scope from "what happened, and is the evidence
sound" to "what does it do to money" — and no further. There is no brokerage, no execution, no
leverage, no key custody and no new contract. Nothing on the screen can be acted on through
Bullseye, and the screen never tells anyone to buy or sell anything.

## What it shows

| Section | What is in it |
| --- | --- |
| Headline | One sentence, in plain English, assembled by code from the sign and size of the balance change. A corporate action can lower a multiplier as well as raise one, and the headline says which happened. |
| The answer | The verdict and the reasons for it, before any figure. |
| Four clocks | Effective time, first detection, newest source fetch, and when the page was assembled — kept apart, never averaged into "as of". A first detection well after the effective time is labelled a look back, not an early warning. |
| What was observed | One mark per recorded observation of the multiplier, at its own timestamp, with the effective time marked. |
| The event, in exact decimals | The balance change, the two ways to get it wrong, and the issuer against the chain. |
| What it is worth | The same event in money, at the issuer's reference price, for a holding the desk states. |
| What the desk cannot tell you | The spread and the net edge, withheld, with every missing input named. |
| Both sides, with their sources | Every figure with its source, URL, unit, observation time, age, provenance mode and the sha256 of the response it came from — including the rows that are empty. |
| Costs | Each cost a buyer would have to know, and which of them are unknown. |
| Evidence | Every recorded item, openable, with its hash. |
| The Brief | A link to the existing paid x402 Brief and its JSON resource. Its price is never mixed into a figure above. |

## The four labels

Every figure carries one, and the label is rendered before the value, because a reader who takes a
reference discrepancy for a tradable spread has been misled even when every digit is right.

| Label | What it means |
| --- | --- |
| **EVENT IMPACT** | Arithmetic on the issuer's own published figures. No price, no venue, nothing estimated. |
| **REFERENCE DISCREPANCY** | Computed from a reference price, which has no side, no size, no venue and no one standing behind it. Never an executable quote. |
| **ESTIMATED QUOTED SPREAD** | Reserved for comparable buy-ask and sell-bid quotes with a size, fees and an expiry. **Nothing in the permitted sources produces one, so this label has never been used.** It exists so the screen can say what is missing by name. |
| **INSUFFICIENT DATA** | An input is missing or stale. The figure is withheld and the missing inputs are listed where the number would have been. |

`EVENT IMPACT` is a fourth label beyond the three the brief named, because the balance arithmetic
is not a discrepancy between two sources and should not be labelled as one: it is exact, it needs
no price, and calling it a discrepancy would understate it.

## The arithmetic

All of it is in `apps/api/src/market/decimal.ts` and `impact.ts`. No model writes a number in
either file. Figures are computed by integer arithmetic on `BigInt` at a fixed scale of 36 decimal
places, from decimal strings, and rounded exactly once, at the end, at a precision the caller
states. A multiplier of `1.0066516577977895` and a price of `72.75` cannot both be held exactly as
doubles, and no figure a buyer reads may depend on the order the rounding happened in.

A value that does not parse is never repaired. `parse` throws on the empty string, on leading
whitespace, on `1,024.5`, on `1e21`, and on more decimal places than it can hold, because each of
those is a source that has changed shape and a caller that would otherwise publish a number nobody
can check. `format` is the only place precision is lost, halves round away from zero, and nothing
ever prints as `-0`.

### The figures, on the real QSRx rebase of 18 September 2026

Multiplier `1` → `1.0066516577977895`, effective `2026-09-18T00:30:00Z`, net cash `0.4875`,
issuer reference price `72.75` read at `19:28:23Z`.

| Figure | Value | Why it is that |
| --- | --- | --- |
| Balance impact | **+0.665165779779 %** | `(new / old − 1) × 100`. A holder who did nothing holds this much more QSRx. It is a change in the number of tokens, **not a price return**. |
| Double-application error | **+0.665165779779 %** | `(new / 1 − 1) × 100`. What a system overstates a holding by if it applies the multiplier to a balance that already includes it. |
| Stale-cache error | **−0.66077056013 %** | `(old / new − 1) × 100`. What a cache still holding the pre-rebase balance understates by. **Not the same number as the rise**: the two are percentages of different bases. |
| Issuer versus chain | **0** | `multiplier()` at the head block against the issuer's published figure, compared at the 18 decimals the contract stores. |
| Position value | **+48.39 USD** | On the desk's stated holding of 100 QSRx: `7275.00` → `7323.39`. A valuation at a reference price, with no fee, spread or slippage deducted. Not a realisable amount. |
| Implied reinvestment price | **73.2900 USD** | `netCashflow ÷ (new / old − 1)`. The price per share at which the issuer's own cash distribution equals the multiplier increase it published. Its reference price is `72.75`: a difference of `−0.54` (`−0.736799 %`). |
| Quoted spread | **INSUFFICIENT DATA** | No bid, no ask, no size, no expiry, no venue, no fee schedule. |
| Net edge | **INSUFFICIENT DATA** | No quote to net against, and five unknown costs. |

Two of these deserve care.

**The double-application error is set by the multiplier's level, not by the size of the change.**
On QSRx the two happen to be the same number, because the multiplier started at 1, and the screen
says so out loud. On the recorded VGKx rebase they differ by a factor of six: the rebase is
`+0.1741971579 %`, and applying that multiplier twice overstates a holding by `+1.116517183338 %`.
A desk that quoted the rebase as the correction would be wrong by more than the event itself.

**The implied reinvestment price is dominated by the gap between two observation times.** The
action is dated 18 September 00:30Z and the price was read at 19:28Z, nineteen hours later. Most of
the `−0.74 %` difference is that gap, not a mispricing, and the figure carries that as its first
limitation. It is shown because it reconstructs the issuer's own arithmetic from published data —
`0.4875` reinvested at `73.29` is exactly the multiplier it published — and that reconstruction is
checkable. It is not shown as an edge, and there is nothing to transact against it.

## What the data actually supports

Established on 20 September 2026 from live responses, reproducibly, by `npm run market-probe`
(artifact: `artifacts/integration/market-probe-2026-09-20T13-17-24-494Z.json`; blockers written up
as SF-8 to SF-11 in [SPONSOR_FEEDBACK.md](SPONSOR_FEEDBACK.md)). Ten checks, four blocked.

| Check | Verdict | What the sources said |
| --- | --- | --- |
| Instrument identity | PASS | QSRx is ISIN `CH1580497118`; its underlying QSR is `US76131D1037`, listed on NYSE. **Two different instruments.** A shared ticker root is not shared exposure, and the desk says so on screen. |
| Currency | PASS | The issuer states `USD` for trading and for the underlying on the asset record. |
| Deployment identity | PASS | X Layer `0xc6437a26…`. The issuer lists 10 deployments over 3 distinct addresses, in no documented order — it must be looked up by network, never by index. |
| Market status and size | **BLOCKED** | At the time of the probe the issuer reported period `closed` with a maximum order value of **0**: no accessible transaction path at any size. |
| Reference price | **BLOCKED** | `{"quote": null}` after 20.1 s while the market is closed, and `{"quote": 72.75}` while it is open. No currency, no observation time, no venue and no side in the response. |
| Executable quote | **BLOCKED** | `/quote`, `/quotes`, `/orderbook`, `/book` and `/depth` all 404. Nothing publishes a bid, an ask, a size or an expiry. |
| Supply units | **BLOCKED** | Total supply `814558.32` against circulating supply `0.43` — 6.3 orders of magnitude apart — and reserves of 3 QSR shares, issuer-wide, against one deployment's chain read. **Shares backing a token is not computable**, so the desk does not divide them. |
| Event impact inputs | PASS | Exact decimal strings for both multipliers, the effective time, the cashflows and the withholding rate. |
| Freshness bound | PASS | The asset response is served `s-maxage=30, stale-while-revalidate=60` with no body-level observation time, so an observation is dated by fetch time and an edge cache can make it up to 90 s older than that. |
| Issuer versus chain | PASS | `multiplier()` at X Layer block 71141207 returned `1.0066516577977895`, equal to the issuer's figure at 18 decimals. |

**Conclusion: EVENT IMPACT ONLY.** The feasibility box in the brief was two hours; this was settled
inside it. No opportunity has been manufactured to fill the gap, and the screen shows the absence
rather than hiding it.

## Who may see what

The Market Desk changes no access rule. It reuses `projectChain` and the audience rule from
`apps/api/src/http/projections.ts`:

- **The issuer's published figures are public.** Anyone can read them from the issuer's own public
  API, and the detector already publishes the multipliers, the cashflows and the withholding rate
  on `GET /api/signals`. Every `EVENT IMPACT` figure is derived from those.
- **What the chain returned is what the Brief sells.** For a visitor reading a signal that may
  still sell, the chain's block numbers, block times and multipliers are withheld, the chart draws
  the issuer's step alone and says how many reads it is not showing, the comparison row keeps its
  place with no value in it, and the evidence items are listed with their provenance and hashes but
  no values or summaries.
- **A figure derived from a withheld read is withheld with it.** Otherwise the desk would give the
  paid number away by arithmetic. `ISSUER_VERSUS_CHAIN` becomes `INSUFFICIENT_DATA` with the reason
  "the on-chain reads are paid content in this view", and it stays on screen: sections are keyed by
  figure, not by label, so a card cannot vanish when its label changes.

Tested in `apps/api/test/market.test.ts` ("the paywall boundary"), including that a chain value the
issuer never published does not appear anywhere in a public body, by value or by block number.

## Cost, and what a page load does

Opening this screen makes **no external call and spends nothing**. `GET /api/market/:signalId`
reads the signal, the stored evidence and the stored chain reads, and computes. It cannot produce a
figure that was not already sourced and hashed, and it cannot start paid work.

`npm run market-probe` does make live calls: ten unauthenticated reads of the xStocks public API
and one `eth_call` on X Layer. Both are free. No model is called, nothing is paid for, and no
transaction is signed.

## Separate ledgers

The Brief price is what Bullseye charges for the verification. It is not part of any figure on this
screen, and a test asserts it appears in none of them. A buyer's opportunity and this desk's sales
economics are separate ledgers; the desk's own totals stay at `GET /api/desk/economics`
([ECONOMICS.md](ECONOMICS.md)).

## What is not here

- **No forward tracker.** The brief made it optional and conditional on the core passing. It is not
  built, deliberately: an honest tracker has to accumulate observations over days before it can
  show anything, the submission closes on 25 September, and it would need new persistence during a
  feature freeze. A tracker that could not produce an outcome series before the deadline would be
  a screen that looks like evidence and is not. The pieces it would need — frozen inputs, stated
  fill assumptions, and preserved negative and pending results — are not half-built either.
- **No second asset or signal type.** One asset, one issuer, one chain, as before.
- **No estimated spread, ever, from a reference price.** An estimate built from a reference price
  and an assumed spread is a number about this desk's assumptions, not about the market.
- **No backing-per-token figure**, because the supply figures are not in one unit or scope (SF-9).
- **No order-size band in the live view.** The issuer publishes one per trading period, but this
  desk does not record it as evidence for an event, so the cost table carries it as unknown and
  points at the probe. Adding it would mean changing the evidence an investigation records, which
  is the frozen publication path.

## Tests

| Suite | Count | What it covers here |
| --- | --- | --- |
| `apps/api/test/market.test.ts` | 36 | The arithmetic against the real QSRx numbers; refusing values that do not parse; rounding once; missing and stale inputs; the double-application case where the two figures diverge; unknown costs staying unknown; quote expiry; the paywall boundary in both directions; a source that changes shape. |
| `apps/web/test/market.test.tsx` | 22 | The label before the number; no figure in the verified colour; missing inputs shown where the number would be; the chart drawing marks and nothing joining them; the direction of the headline; sections that cannot drop a figure. |
| `tests/e2e/market-desk.spec.ts` | 4 | In a browser: the existing desk still offers this one; a genuine-data path with real recorded figures; the insufficient-data fallback; an event with no investigation. |

Totals at the end of this slice, Node 26.7.0: `npm run typecheck` clean; `npm test` API **286 in
21 files**, web **81 in 6**; `PW_CHANNEL=msedge npm run test:e2e` **11 browser tests**;
`npm run build` ok. Baseline before the slice: API 250 in 20, web 59 in 5, 7 browser tests.

Layout checked at 375, 768 and 1440 px: no horizontal page overflow at any width, all eight figures
rendered, and the two wide tables are deliberate horizontal scrollers.
