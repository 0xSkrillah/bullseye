# Submission drafts

**These are drafts for the owner.** Nothing in this file has been sent, submitted, registered or
accepted by anyone. No message below has gone to OKX. No listing exists. No form has been opened
or filled in. The owner reviews, edits and sends everything himself. Where a fact is the owner's
to supply, it is marked `[OWNER: …]`.

Every claim here is held to [CLAIM_LEDGER.md](CLAIM_LEDGER.md). If the two disagree, the ledger
is right and this file is wrong.

How the OKX pages were read: on 19 September 2026, as text extracted from each page, not by eye
in a browser. That is good enough to find what a page covers and not good enough for exact
wording. Re-open a page before relying on a phrase from it.

| Page | Read | What it gave |
| --- | --- | --- |
| Builder kit, `okx.com/en-us/learn/okx-dev-day-builder-kit` | yes | Track requirement, deadline, finale as 7 October in Singapore with venue and times to follow, video length, repository rule, prior-work evidence, the private Telegram group as the main support channel. Says nothing on testnet versus mainnet. |
| Terms, `okx.com/learn/okx-dev-day-terms` | yes | Build period 17 to 25 September 2026; finale as 6 October 2026, 10:00 to 14:00 SGT, Singapore. Does not mention the track requirement or a contact route. |
| A2MCP guide, `web3.okx.com/onchainos/dev-docs/okxai/howtomcp` | yes | The self-test and its expected result; an example on `eip155:196`. Silent on testnet, fees and review time. Points to the ASP registration page for the fields. |
| ASP registration, `web3.okx.com/onchainos/dev-docs/okxai/registerasp` | yes (linked from the A2MCP guide) | The four A2MCP fields, the order of steps, and a review time of 24 hours. Silent on testnet, listing fees and rejection reasons. |
| OKX AI user page, `web3.okx.com/onchainos/dev-docs/okxai/user` | yes | A navigation page for buyers. Nothing on registering a service. |
| Seller SDK guide, `web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk` | yes | 402 with a `PAYMENT-REQUIRED` header, the mock merchant address, both network ids, the faucet. Nothing on `syncSettle`, settlement statuses or `getSettleStatus`. |
| Submission form, `forms.gle/…` | **not opened** | Nothing. Which questions it asks is not known here. |

---

## 1. Question for the organisers (send first)

Send this before anything else: the answer decides how much of section 2 is needed and on which
network. The builder kit names the private Telegram group as the main support channel.
`[OWNER: confirm the channel and post it there, or name the right one]`

The one quotation below is the kit's wording as read on 19 September 2026. Check it against the
page before sending.

> Hello. I am a solo entrant in Build a Company, project "Bullseye". Two questions before I
> submit.
>
> 1. The kit says: "Publish or integrate a working service through OKX AI". Bullseye is an x402 v2
> pay-per-call service built on the OKX seller SDK. It runs at a public HTTPS URL, answers an
> unpaid POST with 402 and a PAYMENT-REQUIRED header, and uses the OKX facilitator on X Layer
> testnet (eip155:1952). One test purchase has settled that way, against a local instance. Does
> this meet the requirement? Or do you need an approved OKX AI listing, or settlement on X Layer
> mainnet (the A2MCP listing example shows eip155:196), or both?
>
> 2. The builder kit gives the finale as 7 October. The terms page says 6 October, 10:00 to 14:00
> SGT. Which is correct?
>
> Thank you.
> [OWNER: name, team name as registered, contact]

Notes for the owner, not part of the message:

- The message is about 140 words. Keep it under 150.
- "One test purchase has settled that way, against a local instance" is exact today (CLAIM_LEDGER
  V20, V33). If a purchase through the deployed URL settles before this is sent, replace that
  sentence with what happened and nothing more.
- The kit's requirement list also asks for a service, listing or integration URL. That reads as
  if a service URL may be enough. It is a reading, not an answer. Do not act on it until the
  organisers reply.
- Record the reply here, with its date and who gave it: `[OWNER: organisers' answer, date, source]`

---

## 2. ASP / A2MCP registration metadata (owner registers and accepts terms)

Status: **not started**. No Agentic Wallet has been created or chosen for this, no service is
registered, no listing has been submitted (CLAIM_LEDGER B3).

**Mainnet in OKX's example.** The A2MCP guide's example uses X Layer mainnet, `eip155:196`.
Bullseye's deployed rail is X Layer testnet, `eip155:1952`. Neither the guide nor the
registration page says whether a testnet endpoint is accepted. That is question 1. Mainnet
settlement has never been run here (CLAIM_LEDGER P5), and switching rails two days before a
deadline is the owner's decision, not a default.

The registration page asks an A2MCP provider for four things: service name, description, price
per call, endpoint URL. The other rows are what a reviewer or a buyer's agent is likely to ask
next, filled from this repository.

| Field | Value | Source |
| --- | --- | --- |
| Service name | Bullseye `[OWNER: confirm the name to list under]` | `seller` in `GET /api/v1/catalog` |
| One-line description | Independently checks whether issuer-announced tokenised-asset events actually happened on-chain, and sells a source-linked verification brief to people and agents. | README, PRODUCT.md |
| Longer description, if the form has room | Each call returns the newest published Bullseye Brief: one event, what the issuer announced, what the X Layer contract shows either side of the effective time, the evidence items with URL, fetch time and sha256, the consistency checks, confidence, unknowns and limitations. Today it covers one event type (xStocks dividend rebases, a change to the token's balance multiplier), one issuer and one chain. It describes observed events. It is not investment, legal or tax advice. | README "Limits"; PRODUCT.md |
| Service type | A2MCP, paid per call over x402 | DEPLOYMENT.md |
| Endpoint URL | `https://bullseye-production-5d0c.up.railway.app/api/v1/briefs/latest` | DEPLOYMENT.md; CLAIM_LEDGER V33 |
| Methods | `GET` and `POST`. Anything else: `405`. | `apps/api/src/http/app.ts` |
| Request parameters | `symbol`, optional, not case-sensitive: `?symbol=QSRx`, or `{"symbol":"QSRx"}` as a JSON `POST` body. Without it: the newest Brief on sale. | `app.ts`; CLAIM_LEDGER V27 |
| Request headers when paying | `PAYMENT-SIGNATURE` (x402 v2; `X-PAYMENT` is also read). Optional `X-Bullseye-Claim`: a secret of 32 to 128 URL-safe characters chosen by the buyer, needed later to fetch the order again. | `apps/api/src/commerce/checkout.ts`; ARCHITECTURE.md "Who an order is answered to" |
| Price per call | $3.00, as `3000000` base units (6 decimals) | `BRIEF_PRICE_USD` default; V21, V33 |
| Payment protocol | x402 v2, scheme `exact`, EIP-3009 authorization, `maxTimeoutSeconds` 300 | V21, V27 |
| Network | X Layer **testnet**, `eip155:1952` | V20, V33 |
| Settlement asset | test USD₮0, contract `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, EIP-712 domain version "1". Test tokens. Not revenue. | V21; SPONSOR_FEEDBACK SF-3 |
| Pay-to address | `0xa8bcd760a7c280c05090431c6afdf15df324d64a`. The same address in the local run of 18 September (V20, V21) and in the deployed challenge decoded on 19 September (`listingSelfTest.decodedPaymentRequired.accepts[0].payTo` in `artifacts/evidence/deployed-snapshot-2026-09-19.json`). `[OWNER: confirm this is still the wallet you want paid on the day you register]` | CLAIM_LEDGER V20, V21, V41 |
| Response when unpaid | `402`, a `PAYMENT-REQUIRED` header (base64 JSON: `x402Version` 2, `resource`, `accepts[0]`), and the same challenge in the body with `bullseye.quoteId` and `bullseye.termsHash` | `checkout.ts`; V27 |
| Response when paid | `200`, one JSON document: a `bullseye.delivery/v1` envelope (`orderId`, `state`, `quote`, `payment`, `brief`) whose `brief` is a `bullseye.brief/v1` document. Headers: `PAYMENT-RESPONSE`, `X-Bullseye-Order`, and `X-Bullseye-Claim` when the server issued the token. | `checkout.ts`; DATA_CONTRACTS.md |
| Sample response | `artifacts/evidence/delivery-ord_8a2102084ad69dab.json` (from the local run; its `resource` is a localhost address) | artifact |
| Other replies a client must handle | `404 nothing_for_sale` (no Brief on sale, or none for that symbol); `410 brief_withdrawn` (the issuer voided the action; nothing charged); `429` with `Retry-After`; `503 payment_rail_unavailable`; `503 payment_outcome_unknown` with `Retry-After: 10` (re-send the same authorization; do not sign again) | `checkout.ts`, `app.ts` |
| Discovery endpoint | `https://bullseye-production-5d0c.up.railway.app/api/v1/catalog` (`bullseye.catalog/v1`: price, rail status, the stable address, items on sale) | `app.ts` |
| Health | `https://bullseye-production-5d0c.up.railway.app/api/health` | V29 |
| Self-test | `curl -i -X POST https://bullseye-production-5d0c.up.railway.app/api/v1/briefs/latest` | OKX A2MCP guide; DEPLOYMENT.md |
| Self-test, expected | Status `402` and a `PAYMENT-REQUIRED` header. Recorded once on the deployed address, 19 September 2026 (V33). `404 nothing_for_sale` means no Brief is on sale on that database. `503` means the rail is not ready; `/api/health` says why. | V33; DEPLOYMENT.md |
| Repository | https://github.com/0xSkrillah/bullseye | HANDOFF.md |
| Support contact | `[OWNER: support email or handle]` | – |
| Logo or icon, if asked | `[OWNER: file]` | – |

What the owner must do personally. Nobody else can, and nothing here has been done:

- [ ] Get the organisers' answer to question 1, or decide to register without it.
- [ ] Re-run the self-test on the day. A listing is reviewed against the live endpoint, and the
      endpoint sells nothing when no Brief is on sale.
- [ ] Create or choose the Agentic Wallet. The registration page describes installing OKX's
      Onchain OS tooling and signing in to an Agentic Wallet by email. `[OWNER: which wallet,
      which email]` The review result goes to that email.
- [ ] Find out whether the listing requires payment to go to the Agentic Wallet. The pages read
      do not say. Bullseye pays to `PAY_TO_ADDRESS`. `[OWNER: answer]`
- [ ] Read and accept OKX's terms yourself. None were read or accepted in preparing this file.
- [ ] Register the service as A2MCP with the four fields above, then submit the listing.
- [ ] Allow for review. The registration page, as read on 19 September 2026, says review
      completes within 24 hours. It gives no rejection reasons and no route of appeal. Start by
      23 September so that one rejection and one resubmission still fit before the deadline.
- [ ] Record the outcome in CLAIM_LEDGER B3, whatever it is. "Submitted" is not "listed", and
      "listed" is not "approved" until OKX says so in writing.

---

## 3. Integration diagram

Derived from `apps/api/src/commerce/checkout.ts` and `apps/api/src/http/app.ts` on this branch.

```
BUYER                          BULLSEYE (seller)                      OKX facilitator      X Layer testnet
browser wallet or agent        apps/api                               verify / settle      eip155:1952
      |                              |                                      |                    |
  1.  |-- GET or POST -------------->|  /api/v1/briefs/latest[?symbol=]     |                    |
      |   no payment header          |  /api/v1/briefs/:id[?quote=]         |                    |
      |                              |  no Brief on sale -> 404             |                    |
      |                              |  rail not ready   -> 503, no challenge                    |
      |                              |  Brief withdrawn  -> 410, no challenge                    |
      |                              |  else: issue or reuse a frozen, hashed quote              |
  2.  |<-- 402 ----------------------|  header PAYMENT-REQUIRED (x402 v2, exact, asset,          |
      |                              |  amount, payTo); body adds quoteId and termsHash          |
      |                              |                                      |                    |
  3.  |  sign ONE EIP-3009 authorization for the quoted terms               |                    |
      |                              |                                      |                    |
  4.  |-- same request ------------->|  PAYMENT-SIGNATURE: signed payload   |                    |
      |   + X-Bullseye-Claim         |  payment key = hash(network, asset, payer, nonce)         |
      |   (buyer's own secret,       |  key already known -> no settle; go to R1                 |
      |    optional)                 |  local checks fail -> 402, no order, no facilitator call  |
      |                              |  open order: PAYMENT_PENDING         |                    |
  5.  |                              |-- verify --------------------------->|                    |
      |                              |<-- valid, or invalid (-> PAYMENT_FAILED, new 402) --------|
  6.  |                              |-- settle, once per authorization --->|-- transfer ------->|
      |                              |<-- success | pending | timeout | refusal -----------------|
      |                              |                                      |                    |
  7a. |                              |  success: read the receipt from the chain, -------------->|
      |                              |  find the quoted Transfer to payTo                        |
      |                              |  PAID -> DELIVERING -> DELIVERED                          |
      |<-- 200 ----------------------|  bullseye.delivery/v1 envelope holding the                |
      |                              |  bullseye.brief/v1 document; headers PAYMENT-RESPONSE,    |
      |                              |  X-Bullseye-Order, X-Bullseye-Claim (if server-issued)    |
      |                              |                                      |                    |
  7b. |<-- 503 ----------------------|  pending, timeout or no answer: PAYMENT_UNKNOWN           |
      |   payment_outcome_unknown    |  nothing delivered; Retry-After 10; orderUrl, deliveryUrl |
      |                              |                                      |                    |
  7c. |<-- 402 payment_failed -------|  explicit refusal: PAYMENT_FAILED; nothing charged        |
```

Recovery. None of these calls `settle` again, and none asks for a second signature.

```
R1  Re-send the same request with the same PAYMENT-SIGNATURE (and the same claim token).
    The order is found by its payment key and answered only to the exact payload that opened it.
    PAYMENT_UNKNOWN or an interrupted PAYMENT_PENDING -> reconcile -> PAID -> 200 and the envelope.
    Already DELIVERED -> the same envelope again.

R2  GET /api/orders/:id/delivery   with X-Bullseye-Claim
    For a buyer who kept the token and lost the authorization: a reload, another tab, a later day.
    Reconciles if the outcome is unknown, then delivers. No signature, no settle, no challenge.
    Wrong or missing token -> 403 claim_token_required, the same whether or not the order exists.

R3  POST /api/orders/:id/reconcile   with X-Bullseye-Claim, or the operator's bearer token
    Returns the order and its receipt. Delivers nothing itself.

Reconcile reads, in this order:
    facilitator getSettleStatus(txHash) and the transaction receipt on X Layer;
    then the token's authorizationState(payer, nonce) and a search for AuthorizationUsed plus the
    quoted Transfer in one transaction.
    Found -> PAID.  Expired unused -> PAYMENT_FAILED, buyer not charged.
    Consumed with no transfer found -> RECONCILIATION_REQUIRED, never PAID.
```

Two limits on this diagram:

- The path through R1 ran once on the real testnet rail, against a local server (V20, V26). The
  rest is verified by tests on the fixture rail (V12, V27, V31). No payment has been made through
  the deployed address.
- R2, and R3 for a buyer, exist on this branch. On `main`, which is what the deployment runs,
  there is no `/api/orders/:id/delivery` route and reconcile is an operator route. They reach
  buyers of the deployed service only after this branch is merged and deployed.

---

## 4. Sponsor feedback reports, ready to send

Built only from [SPONSOR_FEEDBACK.md](SPONSOR_FEEDBACK.md) and the committed artifacts. Nothing
here has been sent. OKX has acknowledged none of it.

Each report ends with an evidence-level block. Its four lines mean:

- **Read in source**: seen in the published SDK's code, types or comments, or in OKX's guide.
- **Reproduced locally**: run from a developer machine, with a command anyone can repeat.
- **Observed on the real rail**: seen in a payment through the real OKX facilitator on X Layer.
- **Acknowledged by OKX**: OKX has confirmed it. This is "no" for every item.

### Report SF-1

**Title.** The official mock merchant's 402 challenge cannot be parsed by OKX's own client SDK.

**Environment.** Windows 11, Node v26.7.0, npm 12.0.2. `@okxweb3/x402-core` 0.1.0,
`@okxweb3/x402-evm` 0.2.1, `@okxweb3/x402-fetch` 0.1.0. Mock merchant:
`https://www.okx.com/api/v1/pay/mock-merchant/resource`. Payment SDK guide as read on
18 September 2026. Observed 18 September 2026, 19:35 UTC and again at 21:37 UTC.
`[OWNER: re-run on the day of sending and give that date as well; it may have been fixed]`

**Steps to reproduce.** No key and no funds are needed. The failure comes before anything is
signed.

1. `git clone https://github.com/0xSkrillah/bullseye && cd bullseye && npm ci`
2. `npm run verify-payment -- --mock-merchant`
3. Read the JSON it prints. It is also written to `artifacts/integration/mock-merchant-*.json`.

The script requests the mock merchant with `GET`, then passes the response headers to
`x402HTTPClient.getPaymentRequiredResponse()`, with the exact EVM scheme registered on the client.

**Expected.** `getPaymentRequiredResponse()` returns the challenge, so the client can sign it.
That is the smallest test payment the guide describes.

**Actual.** It throws `Invalid payment required response`. The mock merchant answers `402` with
the challenge in the JSON body and sends no `PAYMENT-REQUIRED` header. The SDK reads the
challenge only from that header, which is also what the guide describes. The body declares
`x402Version: 2` and names the amount `maxAmountRequired`; the SDK's v2 type calls that field
`amount`.

**Impact on an integrator.** The first thing a new buyer tries fails with OKX's own client, and
the error does not say why. A developer cannot tell whether their setup or the endpoint is at
fault. For this project it blocks the smallest documented test payment (CLAIM_LEDGER B1), and
with it an end-to-end test of SF-2.

**Suggested fix.** Have the mock merchant send the base64 `PAYMENT-REQUIRED` header with a v2
body that uses `amount`. Or have the SDK fall back to the response body when the header is
absent. Either way, put the HTTP status and a hint in the error.

**Evidence.**
`artifacts/integration/mock-merchant-2026-09-18T19-35-31-514Z.json`: `httpStatus: 402`,
`paymentRequiredHeaderPresent: false`, `challengeInBody: true`, `sdkParsedChallenge: false`,
outcome "FAILED before signing: Invalid payment required response".
`artifacts/integration/spike-2026-09-18T21-37-16-168Z.json`, step "okx: mock merchant returns an
x402 v2 challenge on X Layer testnet": the body as received, with `x402Version: 2` and
`maxAmountRequired`.

**Evidence level.**

| | |
| --- | --- |
| Read in source | Yes. `@okxweb3/x402-core` 0.1.0 reads the challenge only from the `PAYMENT-REQUIRED` header; its v2 type names the field `amount`. |
| Reproduced locally | Yes. One command, no credentials, against OKX's live mock merchant. Two committed artifacts. |
| Observed on the real rail | Not applicable. Nothing is signed, so no payment is attempted. |
| Acknowledged by OKX | No. |

### Report SF-7

**Title.** With `syncSettle: true`, `settle` returned `status: "timeout"` with a transaction
hash, and the transfer then confirmed.

**Scope.** One observation: one settlement, order `ord_8a2102084ad69dab`, 18 September 2026,
X Layer testnet. It is not a rate. It is a documentation and developer-experience finding and
not a vulnerability: the buyer was charged once and received one delivery.

**Environment.** Windows 11, Node v26.7.0, npm 12.0.2. `@okxweb3/x402-core` 0.1.0,
`@okxweb3/x402-evm` 0.2.1. Seller built on `x402ResourceServer` with
`OKXFacilitatorClient({ syncSettle: true })` (`apps/api/src/commerce/rail.ts`). Network
`eip155:1952`, asset test USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, amount `3000000`
base units. The seller ran on localhost. It was not the deployed service.

**Steps to reproduce.** Needs developer-portal credentials and a testnet buyer holding test
USD₮0. A single run may not return `timeout`. How often it happens is not known.

1. `npm ci`, then fill `.env` as the README describes.
2. `npm run dev`
3. In a second terminal: `npm run buy -- latest`
4. Read the order's event trail: `GET /api/orders/<order id>` on that server.

**Expected.** `settle` returns `status: "success"` once the transfer is confirmed, or a failure.
The SDK's comment on `syncSettle` says the facilitator waits for on-chain confirmation before it
responds, and that polling is then not needed.

**Actual.** `settle` returned `status: "timeout"` together with a transaction hash. The order
went from PAYMENT_PENDING at 22:03:37.692Z to PAYMENT_UNKNOWN at 22:03:39.560Z, 1.87 s apart,
with the reason `facilitator returned status "timeout" without a final outcome`. That interval
covers the `verify` call and the `settle` call, so `settle` answered in at most 1.87 s. The
transfer did confirm: transaction
`0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`, X Layer testnet block
41310183. The buyer re-sent the same authorization. The seller's receipt check at 22:03:50.211Z
found the quoted Transfer in that block, `getSettleStatus` reported `success` in the same
reconciliation, and the order moved to PAID at 22:03:51.434Z. `settle` was called once. Balances
read from the chain: buyer 10 → 7, pay-to 0 → 3. One transfer.

The SDK does anticipate the status. Its types describe `timeout` as an on-chain timeout, and it
ships `pollSettleStatus` (default deadline 5000 ms) and an `onSettlementTimeout` hook on
`x402HTTPResourceServer`. None of those comments says how long the facilitator waits before it
answers `timeout`. The Payment SDK guide, as read on 19 September 2026, does not mention
`syncSettle`, the settlement statuses or `getSettleStatus`.

**Impact on an integrator.** A seller that treats `timeout` as failure refuses an order the
buyer has paid for. A seller that calls `settle` again cannot charge twice here, because an
EIP-3009 nonce is single-use, but gets an error for a payment that succeeded. A seller who reads
the `syncSettle` comment has no reason to expect either case.

**Suggested fix.** Document what `timeout` means when `syncSettle` is true: the transaction may
already be broadcast and may still confirm; the seller should neither treat it as failure nor
call `settle` again; the outcome should be read from `getSettleStatus` or from the chain. State
how long the facilitator waits before answering `timeout`. Correct the `syncSettle` comment that
says polling is not needed, and point to `pollSettleStatus` and `onSettlementTimeout` wherever
`syncSettle` is documented. A short "payment states" section in the guide would cover this and
SF-5 together.

**Evidence, and its gap.** The committed artifacts show the outcome. They do not show the trail.

- `artifacts/evidence/delivery-ord_8a2102084ad69dab.json`: quote terms, transaction hash, block
  41310183, `chainCheckedAt` 22:03:50.211Z, `chainVerified: true`, and the facilitator status
  **after** reconciliation, which is `success`. The word `timeout` is not in this file.
- `artifacts/integration/payment-ord_8a2102084ad69dab.json`: the independent receipt check.
  Receipt `success`, quoted Transfer found, from the buyer, verdict VERIFIED.
- The `timeout` status and the state timestamps exist only in the order's append-only event
  trail. That lives in a local database, `data/live-run.sqlite`, which is git-ignored and is not
  committed. Every timestamp in this report other than `chainCheckedAt` was copied from that
  trail into the documents. A reader of the repository cannot check them.

**Before this report leans on the trail, produce a sanitised export of it and commit it.** None
exists yet. Proposed name: `artifacts/evidence/order-trail-ord_8a2102084ad69dab.json`. It should
contain exactly:

| Field | Content |
| --- | --- |
| `orderId` | `ord_8a2102084ad69dab` |
| `rail`, `network` | `OKX_X402_TESTNET`, `eip155:1952` |
| `state` | the order's final state |
| `events[]`: `seq` | position in the trail |
| `events[]`: `from` | state before; null for the first event |
| `events[]`: `to` | state after |
| `events[]`: `at` | timestamp, ISO 8601 UTC, exactly as stored |
| `events[]`: `reason` | the stored reason text. It is the only place the word `timeout` was recorded. Read each one before committing. If it is left out, the report must say that the export shows timing and not the status. |
| `txHash`, `chainBlockNumber` | already public in the two artifacts above |
| `exportedAt`, `exportedFrom` | when, and the file name of the database; no path |

It must not contain: any private key or seed; the signed payment payload or its signature; the
`PAYMENT-SIGNATURE` header; the claim token or its hash; the ledger's payment key; OKX API
credentials; anything from `.env`.

How: DEMO_RUNBOOK.md gives the read (start the API with `DB_PATH` pointing at that database,
then `GET /api/orders/ord_8a2102084ad69dab` on localhost). Work on a copy of the database and its
`-wal` and `-shm` files. Opening a database with current code can add a column to it, and this
file is the only copy of that evidence. Keep only the fields above.
`[OWNER: produce the export, or send SF-7 with the gap stated as it is here]`

**Evidence level.**

| | |
| --- | --- |
| Read in source | Yes. The `syncSettle` comment, the `timeout` status in the types, `pollSettleStatus` and `onSettlementTimeout`, all in `@okxweb3/x402-core` 0.1.0. |
| Reproduced locally | The seller's handling is reproduced under test with a facilitator double (`apps/api/test/checkout.test.ts`, "treats a settle timeout as unknown…"). The facilitator's behaviour has not been reproduced at will. |
| Observed on the real rail | Once. Order `ord_8a2102084ad69dab`, X Layer testnet, 18 September 2026. The outcome is in committed artifacts; the trail is not. |
| Acknowledged by OKX | No. |

### Index of SF-2 to SF-6

The full text is in [SPONSOR_FEEDBACK.md](SPONSOR_FEEDBACK.md). None is acknowledged by OKX.
**SF-2** (the mock merchant advertises EIP-712 domain version "1" for USDC_TEST while the token's
on-chain domain is version "2"): reproduced locally by `npm run spike`, which records both domain
separators in `artifacts/integration/spike-2026-09-18T21-37-16-168Z.json`; not tested on the real
rail, because SF-1 stops the payment before signing, so whether the facilitator compensates is
unknown. **SF-3** (the SDK's default testnet asset, USD₮0, is not the mock merchant's asset,
USDC_TEST): read in the SDK and the guide; the funded wallet's balances were observed, the faucet
itself was not, so which token it sends is still open. The guide as read on 19 September 2026
names the faucet's stablecoin as test USD₮0, where SF-3 records "test USDT" from 18 September:
re-read the guide before sending SF-3. **SF-4** (without working facilitator credentials the
seller middleware answers every request with a 500 and an HTML stack trace): reproduced locally
with the guide's Express example and placeholder credentials; no artifact is committed for it;
with working credentials the rail initialises (same spike artifact). **SF-5** (what to do when a
settlement outcome is unknown is left to the integrator): read in the SDK and the guide; SF-7 is
its one observed instance. **SF-6** (the public X Layer RPC limits `eth_getLogs` to 100 blocks):
reproduced with a direct RPC call; no artifact is committed for it.

Where to send: `[OWNER: the builders' channel or contact the organisers name]`

Feedback is a contribution to the ecosystem. It is not claimed as a scoring bonus.

---

## 5. Submission checklist

In dependency order. **Owner** means only the owner can do it. **Done in repo** means the work
is in the repository and the owner only checks it. **Needs owner approval first** means it
spends something, contacts someone or publishes something, and must not start without a yes.

- [ ] **Organiser question sent** (section 1). Owner.
- [ ] **Organiser question answered**, and the answer recorded in section 1 with its date. Owner.
      If no answer comes by 23 September, register on testnet anyway and say so in the form.
- [ ] **Finale date confirmed** (6 or 7 October) **before any travel is booked.** Owner. The kit
      and the terms page disagree. This file does not resolve it.
- [ ] **Repository public.** Done in repo; owner re-checks. GitHub reported the repository as
      PUBLIC when read on 19 September 2026. HANDOFF.md still says it was created private.
- [ ] **Branch reviewed and merged to `main`.** Owner. The working branch is ahead of `main` and
      has not been pushed. It holds the buyer recovery routes, the desk's reader separation, the
      page copy that says what is sold, and the CI workflow.
- [ ] **CI green on `main`.** Done in repo as a workflow (`.github/workflows/ci.yml`: typecheck,
      unit tests and build on Node 22 and 24, browser tests; offline, no secrets). It is on the
      branch only. No workflow run was listed for the repository on 19 September 2026. It counts
      when a run on `main` is green, not before.
- [ ] **Deployed service redeployed and health checked.** Owner. Railway deploys from `main`
      when code changes. Then: `GET /api/health` shows data LIVE, synthesis ready, rail ready on
      `eip155:1952` and `operatorRoutes: DISABLED` or `TOKEN_REQUIRED`; `GET /api/v1/catalog`
      lists a Brief; the self-test returns `402` with the header. Check that the volume kept its
      orders across the deploy.
- [ ] **One agent purchase against the deployed HTTPS URL, on testnet.** Needs owner approval
      first; the owner holds the buyer key and runs it:
      `npm run buy -- latest --base https://bullseye-production-5d0c.up.railway.app --max-usd 3`.
      Budget: one Brief, 3 test USD₮0. HANDOFF.md records the buyer as holding 7 after the first
      purchase. Never pass `--allow-mainnet`. Then `npm run verify-payment -- <order id>` with
      the same `--base`.
- [ ] **One browser purchase against the deployed HTTPS URL, on testnet.** Needs owner approval
      first. A browser wallet on X Layer testnet holding test USD₮0, one Brief. The browser
      purchase has so far run only in the offline configuration (HANDOFF.md). If it fails, write
      down what failed. A failure recorded is worth more than a pass claimed.
- [ ] **Sanitised evidence committed.** Needs owner approval first. Delivery envelopes and
      `verify-payment` results for the deployed purchases, and the order-trail export from
      section 4. No keys, no raw payment signatures, no `PAYMENT-SIGNATURE` headers, no claim
      tokens, nothing from `data/purchases/` or `.env`. Read each file before committing. Then
      update CLAIM_LEDGER: new rows for what ran, and "no payment has been made through the
      deployed address" removed only where it has stopped being true.
- [ ] **ASP registration started by 23 September** (section 2). Owner: wallet, terms,
      submission. The registration page gives review as within 24 hours; the margin is for one
      rejection and one resubmission.
- [ ] **Five interviews and three usability sessions attempted** ([DEMAND.md](DEMAND.md)).
      Owner supplies the participants and approves every outreach message before it goes. Record
      the results truthfully, including negative results, null results and sessions that did not
      happen. A testnet payment by a participant is not a customer.
- [ ] **2 to 4 minute video, recorded only after the deployed purchase flow works.** Owner. Follow
      [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). Say at the start which mode is on screen. The kit asks
      for the working product on video and for the service, listing or integration URL.
- [ ] **Sponsor feedback sent** (section 4), if the owner chooses to. Needs owner approval first.
      It is not a submission requirement.
- [ ] **Feature freeze: 24 September.** Owner. After it, only fixes to something that is broken,
      and documents.
- [ ] **Disclosures carried into the form from [BUILD_PROVENANCE.md](BUILD_PROVENANCE.md).**
      Owner. Prior work: none; the repository was initialised on 18 September 2026 and the commit
      history is the record. The kit asks for a list of features and integrations added, and for
      commit history or other evidence of the new work. Third-party code and data sources: as
      listed in that file. AI assistance: the form answer must be consistent with that file's
      "Tooling" paragraph and with the registration answers it refers to. Use that paragraph as
      it stands. The form was not opened in preparing this file, so which questions it asks is
      not known here.
- [ ] **Form answers hold to CLAIM_LEDGER.** Owner. Say only what its Verified table lists: the
      live investigations in V18, V32 and V33, one testnet settlement (V20), and whatever the
      deployed purchases above add. No demand evidence unless DEMAND.md by then records some. No
      revenue, no mainnet, no listing approval unless OKX has given one in writing.
- [ ] **Submit by 20:00 UTC on 25 September.** Owner. The form closes at 23:59 UTC. The four
      hours are for a failed upload, a wrong link or a private video.
- [ ] **After submitting:** open the repository link, the video link and the service URL in a
      private browser window, signed out. Owner.
