# Sponsor integration feedback

Observations from integrating OKX x402 payments, X Layer and the xStocks API into Bullseye.
SF-1 and SF-2 have a reproduction that runs from this repository. SF-4 and SF-6 are reproduced
with the guide's example and a direct RPC call. SF-3 and SF-5 are read from the SDK and the
guide. SF-7 is a single observation from the one real settlement. SF-8 to SF-11 are xStocks data
contract findings, each reproduced live by `npm run market-probe`. These are
developer-experience and documentation findings. None of them is a security vulnerability, and
none was tested beyond what is described.

Environment for every item: Windows 11, Node v26.7.0, npm 12.0.2, 18 September 2026; SF-8 to
SF-11 on 20 September 2026.

| Package / surface | Version used |
| --- | --- |
| `@okxweb3/x402-core` | 0.1.0 (published 2026-08-04) |
| `@okxweb3/x402-evm` | 0.2.1 |
| `@okxweb3/x402-express` | 0.1.1 |
| `@okxweb3/x402-fetch` | 0.1.0 |
| Payment SDK guide | https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk (read 2026-09-18) |
| A2MCP guide | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp (read 2026-09-18) |
| Mock merchant | https://www.okx.com/api/v1/pay/mock-merchant/resource |
| xStocks API | v2, OpenAPI 2.0.0, https://docs.xstocks.fi/apis/openapi |
| X Layer RPC | https://rpc.xlayer.tech (196), https://testrpc.xlayer.tech (1952) |

Status of the payment integration itself is tracked in [CLAIM_LEDGER.md](CLAIM_LEDGER.md).
In short: Bullseye's paid endpoint is built on the OKX seller SDK. The tests exercise it end to
end against a local facilitator double. One settlement through the real OKX facilitator on
X Layer testnet has been run, on 18 September 2026: an agent buyer paid 3000000 base units of
testnet USD₮0 for Brief `brf_a790c648a87d52dd`.

- Order: `ord_8a2102084ad69dab`
- Transaction: `0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`, X Layer
  testnet block 41310183
  ([explorer](https://www.oklink.com/x-layer-testnet/tx/0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a))
- Delivery envelope: `artifacts/evidence/delivery-ord_8a2102084ad69dab.json`
- Independent receipt check (`npm run verify-payment -- ord_8a2102084ad69dab`, verdict VERIFIED):
  `artifacts/integration/payment-ord_8a2102084ad69dab.json`

That is one settlement, paid with test tokens. It shows the payment mechanics worked once. It is
not revenue and it says nothing about how often settlement succeeds or how long it takes.

---

## SF-1 · The OKX client SDK cannot read the official mock merchant's challenge

**Goal.** Run the smallest documented test payment: point the OKX buyer SDK at the mock
merchant named in the Payment SDK guide.

**Reproduce.** `npm run verify-payment -- --mock-merchant` (no key or funds needed; the failure
happens before anything is signed). Evidence: `artifacts/integration/mock-merchant-*.json`.

**Expected.** `x402HTTPClient.getPaymentRequiredResponse()` returns the challenge so the client
can sign it.

**Actual.** It throws `Invalid payment required response`. The mock merchant answers `402` with
the challenge in the JSON **body** and sends no `PAYMENT-REQUIRED` header. The SDK
(`@okxweb3/x402-core@0.1.0`) reads the challenge **only** from that header, which is also what the
guide describes ("HTTP 402 with PAYMENT-REQUIRED header"). The body additionally uses the v1 field
name `maxAmountRequired` while declaring `x402Version: 2`; the SDK's v2 type calls it `amount`.

**Impact.** The documented "hello world" for buyers fails with OKX's own client, and the error
does not say why. A developer cannot tell whether their setup or the endpoint is at fault.

**Suggested fix.** Make the mock merchant emit the base64 `PAYMENT-REQUIRED` header with a v2
body (`amount`), or have the SDK fall back to the response body when the header is absent. Either
way, include the HTTP status and a hint in the error.

## SF-2 · The mock merchant advertises an EIP-712 domain version that does not match its token

**Reproduce.** `npm run spike` and read `eip712` in `artifacts/integration/spike-*.json`.

**Actual.** The challenge says `extra: { name: "USDC_TEST", version: "1" }` for asset
`0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` on `eip155:1952`. That contract's
`DOMAIN_SEPARATOR()` is `0x7513e76c…ef959`, which equals the EIP-712 domain hash for version
**"2"** (and `version()` returns `"2"`). The hash for version "1" is `0x9d05c77b…7bd0`.

**Impact.** The OKX client builds the `TransferWithAuthorization` signature from
`extra.name`/`extra.version`. A signature made with the advertised version would not recover to
the payer under the token's real domain. Such a payment has **not** been submitted, so whether
the facilitator compensates for this is unknown. The buyer wallet now holds USDC_TEST, but the
mock-merchant payment is still blocked before signing by SF-1. The one real settlement used
USD₮0, whose advertised version matches on-chain (SF-3), so it does not test this case.

**Suggested fix.** Advertise `version: "2"`, or document that the facilitator rewrites the domain.

## SF-3 · The SDK's default testnet asset is not the mock merchant's asset

**Actual.** `@okxweb3/x402-evm@0.2.1` resolves `"$0.01"` on `eip155:1952` to
`0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` (`USD₮0`, domain version "1", which does match
on-chain). The mock merchant charges in `0xcb8bf24c…c79d` (`USDC_TEST`). The guide tells
developers to get "test USDT" from the faucet.

**Observed after funding.** Once the buyer wallet was funded, `npm run wallet` showed 10 `USD₮0`
(`0x9e29b3aa…fb0c`), 10 `USDC_TEST` (`0xcb8bf24c…c79d`) and 0.2 test OKB. How the wallet was
funded was not observed, so which token the faucet dispenses, and whether one request yields
both, is still not confirmed here. The one real settlement (order `ord_8a2102084ad69dab`) paid in
`USD₮0`, signed with the advertised domain version "1", and settled.

**Impact.** A buyer funded for one of the two flows cannot pay the other, and nothing in the
guide says there are two test stablecoins.

**Suggested fix.** Use one test asset for both, or list both contracts and say which the faucet sends.

## SF-4 · A seller cannot emit a 402 challenge until facilitator credentials work, and the failure is a 500

**Reproduce.** Follow the guide's Express example with placeholder credentials and request the
protected route.

**Actual.** `paymentMiddleware` calls `GET /api/v6/pay/x402/supported` on first request. With
missing or wrong credentials that returns `401`, the SDK logs
`Failed to fetch supported kinds from facilitator: Error: OKX getSupported failed: 401`, and
**every request to the protected route returns HTTP 500 with an HTML stack trace**, including
internal file paths.

**Impact.** A new seller cannot see what their challenge will look like, or test clients against
it, before developer-portal approval. In production, a facilitator outage or a rotated key turns
the paid route into a 500 that leaks paths. `OKXFacilitatorClient` also drops the response body
(`{"msg":"Request header OK-ACCESS-KEY can not be empty.","code":"50103"}`), so the useful
error code never reaches the developer.

**Suggested fix.** Include the OKX error `code`/`msg` in thrown errors; return a JSON `503` from
the middleware when the facilitator is unavailable; consider letting the challenge be built
offline, since `ExactEvmScheme.parsePrice` already knows the asset table.

**With working credentials.** The same call succeeds. On 18 September 2026 the seller rail
initialised with `facilitator supports exact on eip155:1952`
(`artifacts/integration/spike-2026-09-18T21-37-16-168Z.json`). The finding is about the path
without working credentials; the SDK versions are the same.

**What Bullseye does.** It answers `503 payment_rail_unavailable` with the reason and never
issues a challenge it could not settle (`apps/api/test/checkout.test.ts`, "does not issue a
challenge when the rail cannot settle"). Once the rail is ready it answers an unpaid request with
`402` and the challenge in the `PAYMENT-REQUIRED` header; that is the challenge order
`ord_8a2102084ad69dab` paid.

## SF-5 · Settlement certainty is left to the integrator

**Observation.** `SettleResponse.status` can be `pending`, `success` or `timeout`, and
`OKXFacilitatorClient.settle` throws on any non-2xx. The guide's example delivers the resource
inside the middleware and does not discuss what a seller should do when the outcome is not known,
or how to avoid charging twice when a buyer retries. `getSettleStatus(txHash)` exists but is not
mentioned in the guide, and it cannot help when no transaction hash came back.

**Suggested fix.** Document a recommended pattern. The one Bullseye uses: derive an idempotency
key from the EIP-3009 authorization (`network:asset:from:nonce`), never call `settle` twice for
one key, record "unknown" as its own state, and reconcile from `getSettleStatus` or from the
token's `authorizationState(from, nonce)`; treat the authorization as dead only after
`validBefore`. A short "payment states" section with this in the guide would save every seller
from rediscovering it.

## SF-6 · X Layer public RPC: `eth_getLogs` is limited to 100 blocks

**Reproduce.** `eth_getLogs` over 500 blocks on `https://rpc.xlayer.tech` returns
`-32602 block range greater than 100 max`. With ~1 s blocks that is a 100-second window.

**Impact.** Finding when a token's state changed by scanning logs is impractical on the public
endpoint. Historical `eth_call` works well, so Bullseye bisects `multiplier()` by block instead
(17 RPC reads for a 75-minute window in the recorded run). viem reports only "Invalid parameters were provided",
so the limit is easy to miss.

**Suggested fix.** State the limit in the X Layer RPC docs next to the endpoint list.

## SF-7 · `syncSettle: true` returned `status: "timeout"` within 1.87 s while the transfer confirmed

This is a single observation: one settlement, order `ord_8a2102084ad69dab`, 18 September 2026.
It is not a rate. It is a developer-experience finding, not a vulnerability: the buyer was
charged once and received one delivery. It is an observed instance of the gap described in SF-5.

**Goal.** Settle an `exact` payment and learn the outcome from the `settle` call itself. Bullseye
builds the client as `OKXFacilitatorClient({ syncSettle: true })` (`apps/api/src/commerce/rail.ts`).
The SDK's comment on that option (`@okxweb3/x402-core@0.1.0`) says the facilitator will "wait for
on-chain confirmation before responding" and that it then answers `success` directly, with no
polling needed.

**Reproduce.** Needs developer-portal credentials and a funded testnet buyer. Start the API, run
`npm run buy -- latest`, then read the order's event trail at `GET /api/orders/<order id>`. A
single run may not return `timeout`; how often it happens is not known.

**Expected.** `settle` returns `status: "success"` once the transfer is confirmed, or a failure.

**Actual.** `settle` returned `status: "timeout"` together with a transaction hash. The order's
event trail shows PAYMENT_PENDING at 22:03:37.692Z and PAYMENT_UNKNOWN at 22:03:39.560Z, 1.87 s
apart, with the reason `facilitator returned status "timeout" without a final outcome`. That
interval covers the `verify` call and the `settle` call, so `settle` answered in at most 1.87 s.
The transfer did confirm: transaction
`0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`, X Layer testnet block
41310183. The buyer re-sent the same authorization. The seller's own receipt check at
22:03:50.211Z found the quoted Transfer in that block, `getSettleStatus` reported `success` in the
same reconciliation, and the order moved to PAID at 22:03:51.434Z. `settle` was called once. Balances read from chain:
buyer `USD₮0` 10 → 7, payTo 0 → 3, exactly one transfer.

The SDK does anticipate this status. Its types describe `timeout` as "on-chain timed out", and it
ships `pollSettleStatus` (default deadline 5000 ms) and an `onSettlementTimeout` hook on
`x402HTTPResourceServer`. None of those comments says how long the facilitator waits before it
answers `timeout`, and the comment on `syncSettle` says polling is not needed.

**Evidence.** The `timeout` status and the state timestamps are in the order's append-only event
trail, kept in the order ledger of the instance that took the payment and served by
`GET /api/orders/ord_8a2102084ad69dab`. The event trail is not copied into either artifact file.
`artifacts/evidence/delivery-ord_8a2102084ad69dab.json` holds the quote terms, the transaction
hash, the block number, the time of the chain check and the facilitator status after
reconciliation (`success`). `artifacts/integration/payment-ord_8a2102084ad69dab.json` is the
independent receipt check: receipt `success`, quoted Transfer found, from the buyer, verdict
VERIFIED.

**Impact.** A seller that treats `timeout` as failure would refuse an order the buyer has paid
for. A seller that calls `settle` again could not charge twice here, because an EIP-3009 nonce is
single-use, but would get an error for a payment that succeeded. A seller who reads the
`syncSettle` comment has no reason to expect either case.

**Suggested fix.** Document what `timeout` means when `syncSettle` is true: the transaction may
already be broadcast and may still confirm, the seller should neither treat it as failure nor call
`settle` again, and the outcome should be read from `getSettleStatus` or the chain. State how long
the facilitator waits before answering `timeout`. Correct the `syncSettle` comment that says
polling is not needed, and point to `pollSettleStatus` and `onSettlementTimeout` wherever
`syncSettle` is documented.

**What Bullseye does.** It records `PAYMENT_UNKNOWN` as its own state, delivers nothing, and
answers `503 payment_outcome_unknown` telling the buyer to retry with the same authorization and
not to sign a new one. It never calls `settle` a second time for the same authorization. When the
buyer re-sent the authorization it reconciled from the transaction receipt and `getSettleStatus`,
moved the order to PAID and delivered once (`apps/api/test/checkout.test.ts`, "treats a settle
timeout as unknown: no delivery, no second charge, then reconciles to PAID").

## SF-8 · `price-data` is a bare, nullable number: no currency, no observation time, no side

Found on 20 September 2026 while establishing whether a price discrepancy could be computed at all
(`npm run market-probe`; artifact `artifacts/integration/market-probe-2026-09-20T13-17-24-494Z.json`).

**Reproduce.** `GET /public/assets/QSRx/price-data`.

- While the underlying market is open (18 September, 19:28 UTC): `{"quote": 72.75}`.
- While it is closed (20 September, 12:58 UTC): `{"quote": null}`, after **20.1 s**.

**Impact.** Three separate problems for anyone valuing a tokenised asset.

1. The response states no currency, no observation time, no venue and no side. The currency can be
   recovered from `GET /public/assets/{symbol}` (`trading.currency`, `underlying.currency`), but the
   price itself can only be dated by the time the caller fetched it — and the asset endpoint is
   served with `cache-control: public, s-maxage=30, stale-while-revalidate=60`, so a fetch time can
   be up to 90 s older than it looks. A consumer cannot tell a fresh quote from a cached one.
2. `quote` is documented as a number and is null in practice. A schema that reads the field as a
   positive number — as this repository's did (`XsPrice` in `apps/api/src/adapters/xstocks.ts`) —
   rejects the body outright, so a caller loses the whole response rather than learning that no
   price is being published. Bullseye's evidence tool for the reference price therefore fails
   whenever the NYSE session is closed, which is most of the week.
3. 20 s is long enough to exhaust a default HTTP timeout, and the slow path is the one that returns
   nothing.

There is also no two-sided quote anywhere in the public API: `/quote`, `/quotes`, `/orderbook`,
`/book` and `/depth` all answer 404 for a valid symbol. Nothing publishes a bid, an ask, a size or
an expiry, so a size-specific spread cannot be computed from these sources and must not be
estimated from the reference price. Bullseye's Market Desk labels every such figure
INSUFFICIENT DATA for this reason.

**Suggested fix.** Return `{"quote": null, "asOf": ..., "currency": ..., "reason": "market_closed"}`
rather than a bare null, document the field as nullable, and say in the OpenAPI description that
the value is a reference price rather than an executable quote.

**Fixed on our side, 20 September 2026.** Both faults, because they compounded: `XsPrice` now reads
`quote` as a nullable positive number and the evidence item records "the issuer publishes no
reference price at this time" with its provenance and hash, and the per-read ceiling moved from 20 s
to 30 s (`SOURCE_TIMEOUT_MS`, `DEFAULT_SOURCE_TIMEOUT_MS`). The second half mattered as much as the
first: at 20 s the answer never arrived, so the read was abandoned and — with caching on — the last
price was served in its place, labelled CACHED. A stale price is a worse answer than "there is no
price". A read that genuinely times out is still CACHED with the reason and never a null quote:
"no price was published" and "we did not get an answer" are different states.

Verified live the same day, through the adapter: `quote=null`, mode LIVE, in 20.8 s (QSRx) and
20.2 s (IFFx) — both of which the old ceiling would have aborted. Tests:
`apps/api/test/transport.test.ts` ("the issuer publishes no price while its market is closed",
4 tests) and `apps/api/test/market.test.ts` ("a closed market publishes no price", 4 tests); the
first of those was written before the fix and confirmed failing against the old code. Anything that
is not a positive number and not null is still refused, so the schema did not become permissive.
The finding above still stands for the sponsor: the response would be far easier to consume with a
stated `asOf`, `currency` and `reason`.

## SF-9 · The three supply figures are not in one unit or one scope

**Reproduce.** For QSRx on 20 September 2026:

| Endpoint | Value |
| --- | --- |
| `GET /public/assets/QSRx/total-supply` | `814558.3231943906` |
| `GET /public/assets/QSRx/circulating-supply` | `0.4329033180347051` |
| `GET /public/proof-of-reserves/QSRx` | `sharesHeld "3"`, `circulatingSupply "0.432903322893486089"` |

**Impact.** Total and circulating supply are 6.3 orders of magnitude apart, and neither is
documented as being per network, per deployment or issuer-wide. `proof-of-reserves` is issuer-wide,
while `totalSupply()` on the X Layer contract covers one deployment, and the same token address is
deployed on eight EVM networks (SF-10). The obvious calculation — shares backing one token — gives
0.0000037 with one denominator and 6.93 with the other, and nothing in the responses says which is
meaningful. Bullseye computes neither, and says so on screen.

**Suggested fix.** State the scope and unit of each supply figure in the OpenAPI description, and
say whether `circulating-supply` is multiplier-adjusted.

## SF-10 · `deployments[]` is unordered and repeats one address across networks

**Reproduce.** `GET /public/assets/QSRx` twice, two days apart. On 18 September the array began
with Ethereum; on 20 September it began with Ton. The same EVM address
`0xc6437a260bf2b7e9d9e402b2ef7e9a84d3622046` appears for Ethereum, BSC, Arbitrum, Mantle,
HyperEVM, Ink, X Layer and Optimism: 10 deployments over 3 distinct addresses.

**Impact.** Code that reads `deployments[0]`, or that keys a cache by address, silently gets the
wrong network. An address is not a network identity here.

**Suggested fix.** Say in the docs that the array has no defined order and that EVM addresses are
shared across networks, so a deployment must be selected by `network`.

## SF-11 · The multiplier endpoint uses `0` as "nothing pending", and 0 is a valid-looking multiplier

**Reproduce.** `GET /public/assets/QSRx/multiplier?network=XLayer` with no pending action:
`{"currentMultiplier": 1.0066516577977895, "newMultiplier": 0, "activationDateTime": 0, "reason": null}`.

**Impact.** `newMultiplier: 0` reads as a multiplier of zero, which would wipe every balance, and
`activationDateTime: 0` reads as 1 January 1970. A consumer that does not know 0 is a sentinel will
either act on it or store it. `reason: null` is the only hint that nothing is pending.

**Suggested fix.** Use `null` for both fields when no change is pending, or add an explicit
`hasPendingChange` boolean.

## What worked well

- xStocks' public endpoints need no key, returned consistent data, and the issuer's multiplier,
  effective time and the on-chain `multiplier()` on X Layer agreed at the contract's 18-decimal
  precision for the two rebases checked on 18 September 2026 (IFFx and QSRx); in both,
  activation landed in the block stamped with the exact effective second.
- Both X Layer public RPC endpoints served historical state, which is what makes independent
  verification possible without an indexer.
- The x402 SDK's lower-level `x402ResourceServer` API (`verifyPayment`, `settlePayment`,
  `findMatchingRequirements`, header codecs) is cleanly separable from the Express middleware, so
  a seller that needs a durable order ledger can use it directly.
- With valid developer-portal credentials the seller SDK initialised against the facilitator,
  Bullseye's endpoint issued a valid x402 v2 challenge in the `PAYMENT-REQUIRED` header, the OKX
  client SDK (`x402HTTPClient` with the exact EVM scheme) signed it, and the facilitator settled
  it on X Layer testnet (order `ord_8a2102084ad69dab`). This has been done once.
- When the buyer re-sent the authorization after the `timeout` in SF-7, `getSettleStatus` reported
  `success` and the X Layer testnet RPC returned the receipt, so the order was reconciled without
  a second `settle` call. Seen once.

## Open items to retest

Credentials and a funded buyer are now in place. One settlement has been run.

1. SF-2 end to end: a `USDC_TEST` payment signed with the advertised domain version. The buyer
   holds `USDC_TEST`, but the mock-merchant payment is still blocked by SF-1.
2. SF-3: which token the faucet dispenses. The wallet held both test stablecoins after funding;
   the funding step was not observed.
3. SF-7: whether `syncSettle: true` returns `timeout` again. One observation cannot say how often
   it happens.
4. Facilitator settlement latency and `syncSettle: true` behaviour over more than one payment and
   under load. No latency measurement exists.
5. Whether `getSettleStatus` works for transactions older than a few minutes. It reported
   `success` for the one transaction less than a minute after the payment arrived; nothing older
   was tried.
