# Sponsor integration feedback

Observations from integrating OKX x402 payments, X Layer and the xStocks API into Bullseye.
Each item has a reproduction that runs from this repository. These are developer-experience
and documentation findings. None of them is a security vulnerability, and none was tested
beyond what is described.

Environment for every item: Windows 11, Node v26.7.0, npm 12.0.2, 18 September 2026.

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
In short: Bullseye's paid endpoint is built on the OKX seller SDK and is exercised end to end
against a local facilitator double; a settlement through the real OKX facilitator has **not**
been run yet because it needs developer-portal credentials and a faucet-funded buyer.

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
the payer under the token's real domain. We have **not** submitted such a payment (no funded
buyer yet), so whether the facilitator compensates for this is unknown.

**Suggested fix.** Advertise `version: "2"`, or document that the facilitator rewrites the domain.

## SF-3 · The SDK's default testnet asset is not the mock merchant's asset

**Actual.** `@okxweb3/x402-evm@0.2.1` resolves `"$0.01"` on `eip155:1952` to
`0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` (`USD₮0`, domain version "1", which does match
on-chain). The mock merchant charges in `0xcb8bf24c…c79d` (`USDC_TEST`). The guide tells
developers to get "test USDT" from the faucet.

**Impact.** A buyer funded for one of the two flows cannot pay the other, and nothing in the
guide says there are two test stablecoins. We could not confirm which token the faucet dispenses
without a funded wallet.

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

**What Bullseye does.** It answers `503 payment_rail_unavailable` with the reason and never
issues a challenge it could not settle (`apps/api/test/checkout.test.ts`, "does not issue a
challenge when the rail cannot settle").

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

## What worked well

- xStocks' public endpoints need no key, returned consistent data, and the issuer's multiplier,
  effective time and the on-chain `multiplier()` on X Layer agreed at the contract's 18-decimal
  precision for the two rebases we checked on 18 September 2026 (IFFx and QSRx); in both,
  activation landed in the block stamped with the exact effective second.
- Both X Layer public RPC endpoints served historical state, which is what makes independent
  verification possible without an indexer.
- The x402 SDK's lower-level `x402ResourceServer` API (`verifyPayment`, `settlePayment`,
  `findMatchingRequirements`, header codecs) is cleanly separable from the Express middleware, so
  a seller that needs a durable order ledger can use it directly.

## Open items to retest once credentials are available

1. SF-2 and SF-3 end to end with a faucet-funded buyer.
2. Real facilitator latency and the `syncSettle: true` behaviour under load.
3. Whether `getSettleStatus` works for transactions older than a few minutes.
