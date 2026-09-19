# Architecture

```
xStocks API ─┐
             ├─ transport (LIVE | CACHED | HISTORICAL | FIXTURE) ─ adapters ─┐
X Layer RPC ─┘                                                               │
                                                                             ▼
   detector ──► SignalEvent ──► investigator ──► evidence + checks ──► publication gate
   (pure fn)                    (model, under                             (pure fn)
                                 a governor)                                  │
                                                                 REJECT ◄────┴────► PUBLISH
                                                              (no Brief,            Brief (hashed)
                                                               no charge)               │
                                                                                        ▼
        buyer / agent ──► GET /api/v1/briefs/:id ──► x402 challenge ──► verify ──► settle
                                                                                        │
                                  order ledger: QUOTED → PAYMENT_PENDING → PAID → DELIVERING → DELIVERED
                                                          └► PAYMENT_UNKNOWN → RECONCILIATION_REQUIRED
                                                          └► PAYMENT_FAILED           DELIVERY_FAILED
                                                                                        │
                                                                                        ▼
                                                                          delivery envelope + economics receipt
```

## Who decides what

| Decision | Owner | Why |
| --- | --- | --- |
| What counts as a signal | `detectRebaseSignals` (pure function) | Reproducible; same inputs, same ids. |
| Whether the issuer still stands behind an action | `supersededBy` (pure function) | The issuer's history is append-only by version. Cancelled and replaced versions never become signals. |
| Which facts exist | `EvidenceToolbox` | Every fact is an `EvidenceItem` written by code from a validated source response. The model cannot author evidence. |
| Whether sources agree | `runConsistencyChecks` | Multipliers are compared at the contract's 18-decimal precision, not by a model. |
| How much may be spent | `BudgetGovernor` | Asked before every model call and tool call; projects the worst case of the next call at the provider's worst-case rates (for OpenRouter, the price cap) so the cost ceiling is a ceiling, not a post-mortem. |
| Which model answers | OpenRouter's Auto Router, inside limits set by `OpenRouterProvider` | The investigator only sees a `SynthesisProvider`. The default provider asks for `openrouter/auto` with a cost tier and a hard price cap; the router picks the model per request, and the model that answered is recorded on every usage record. |
| What a model call cost | the provider's reported charge, otherwise code | OpenRouter's `usage.cost` is recorded as billed. A call whose charge is unknown is carried at a ceiling, never at zero. |
| What the Brief says | the model | Investigation order and prose only, inside a JSON schema. |
| Whether it is published | `evaluatePublication` (pure function) | The model has no vote. One bounded revision is allowed for drafting faults; missing or stale evidence cannot be rewritten away. |
| Whether a published Brief is still sold | `SignalService.supersession`, enforced by `Checkout` | A Brief whose action the issuer voided is withdrawn: `410 brief_withdrawn`, nothing settled. |
| Order and payment state | `OrderLedger` | Transition table in `packages/domain`, enforced on every move; events are append-only. |
| Who an order is answered to | `Checkout.holdsClaim`, `Checkout.recognise` | The claim token is the only secret in a purchase. See "Who an order is answered to". |
| What a visitor may read of the desk's work | `audienceOf` (`apps/api/src/http/app.ts`), `apps/api/src/http/projections.ts` | Decided per request, in code, from the `Authorization` header. See "Who may read what". |

## The first intelligence product

**Rebase verification on X Layer.** xStocks reinvest dividends by raising a per-token multiplier,
so `balanceOf` changes for every holder without a single `Transfer` event. Integrators that cache
balances, account in shares, or price collateral need to know that it happened, when, by how much,
and whether the chain agrees with the issuer. The detector reads the issuer's corporate-action
history; the investigation reads `multiplier()` on the X Layer contract 60 s either side of the
effective time and at the head, bisects for the activation block, and adds proof of reserves,
reference price, trading status and supply.

It was chosen against the five gates in the dossier: public keyless access; visible on X Layer;
deterministic to test; explainable without advice; demand **unknown** (see `DEMAND.md`). Changing
the product means a new detector and toolbox; the gate, ledger, checkout and economics do not change.

## Cancelled and corrected actions

The issuer's `GET /public/corporate-actions/history` is append-only by version: the same `eventId`
appears once per version and earlier rows never change. Across all 758 history records on
2026-09-18 the statuses were Initial 726, Corrected 17, Cancelled 15. Cancelled rows have
`effectiveTimeUtc: null`, `multiplierNew` equal to `multiplierOld`, and notes such as
`[CANCELLED v2] Incorrect cash flow`.

`supersededBy` in `apps/api/src/signals/rebaseDetector.ts` decides what a later version means:

- A later Cancelled row voids the version it names in `[CANCELLED vN]`, or the previous live
  version when it names none.
- A later live row that starts from the same `multiplierOld` replaces the earlier row.
- A later live row that starts where the earlier row ended is a further rebase, and both stand
  (seen live: LINx `5cedd8fc` v2, then v3 "Corrected").

Cancelled rows and superseded rows never become signals.

Unreadable records fail closed. A history record that fails the schema is left out and reported in
`scan.skipped`; a page where more than half the records fail still raises `SchemaMismatchError`.
An event with any rejected row is not trusted at all, because that row may be its newest version.
Inside an investigation, `get_corporate_action` throws if the symbol's history contains a rejected
row for this event or a rejected row with no readable event id. `EV-CA` is then missing, mandatory
evidence is incomplete, and the gate rejects.

`EV-CA` describes the signal's own version and adds `newestVersion`, `newestStatus`,
`supersededByVersion`, `supersededReason` and `supersedingNotes`. The core check
`CHK-ACTION-STILL-CURRENT` fails if the issuer cancelled or replaced that version, or if the
record's new multiplier no longer equals the signal's. The core checks are
`CHK-ACTION-STILL-CURRENT`, `CHK-BEFORE-MATCHES-OLD`, `CHK-AFTER-MATCHES-NEW` and
`CHK-LATEST-MATCHES-NEW`; a failed or unknown core check caps confidence at LOW.

Each scan marks stored signals whose version has since been voided (`signals.superseded_json`).
The signal stays in the feed for the record and `GET /api/signals` returns the mark as
`superseded`. A Brief whose action was voided is withdrawn from sale. On
`GET /api/v1/briefs/:id`, a request with no payment header, or with an authorization the ledger
has not seen, gets `410 brief_withdrawn`: no quote, no challenge, no settlement. An authorization
the ledger already knows is answered from its order, so a buyer who already paid still gets
delivery. The catalogue omits the Brief and the free preview reports `withdrawn`.

## The investigator's model

The investigator talks to a `SynthesisProvider` (`apps/api/src/research/model.ts`): `info`
(provider, model, mode), `pricing` (the worst-case rates the governor uses, and the cost basis for
a call with no reported charge) and `start()`, which returns a session with two steps, `collect`
and `synthesise`. `createLiveProvider` (`provider.ts`) is the one place a live provider is built.
`SYNTHESIS_PROVIDER` selects `openrouter` (default), `anthropic`, or `fixture`, a test double whose
Briefs are labelled `FIXTURE`. `BULLSEYE_MODEL` defaults to `openrouter/auto` for `openrouter` and
`claude-opus-5` for `anthropic`.

**Routing under a hard cap.** `OpenRouterProvider` (`openrouter.ts`) calls
`POST https://openrouter.ai/api/v1/chat/completions` with plain `fetch` and a Zod-validated
response; no SDK. With the default model, every request carries `model: "openrouter/auto"`,
`plugins: [{ id: "auto-router", cost_tier }]` and
`provider: { require_parameters: true, max_price: { prompt, completion } }`. The tier is
`OPENROUTER_COST_TIER` (`low`, `medium`, `high`, `xhigh` or `max`; default `medium`). The cap is
`OPENROUTER_MAX_PRICE_PROMPT` (default 3) and `OPENROUTER_MAX_PRICE_COMPLETION` (default 15), in
USD per million tokens. `max_price` is a hard filter that also applies to routed models. Its
values are the governor's worst-case rates, so the governor can refuse a call before it is made
even though the model that will answer is not known in advance. For `openrouter/auto-beta` the
plugin id is `auto-beta-router`. OpenRouter silently ignores tier settings sent under the other
slug's plugin id, so the id is derived from the slug in code and covered by a test.

**Collection and writing are separate requests.** OpenRouter does not document whether tools and
structured output can be combined in one request. Collection requests carry `tools` only. The
writing request is a fresh, tool-free conversation with `response_format: json_schema`, and its
instruction includes the evidence items exactly as the publication gate holds them (the latest
item per id). The Anthropic provider keeps one conversation and sets `tool_choice: none` for the
writing step.

**One approval is one billable request.** The governor approves each model call, and the
OpenRouter provider sends at most one request that could be billed for it. A timeout, a dropped
connection, an unreadable 200 body, a 408 or a 5xx is not re-sent: the model may have run and
been billed. Only HTTP 429 and connections that never opened (`ECONNREFUSED`, `ENOTFOUND`,
`EAI_AGAIN`) are retried. The request timeout is min(120 s, time left in the investigation's
latency budget), with a 5 s floor.

**How calls are costed.** Every model call writes a `UsageRecord` with the model that answered
and a `costBasis`:

| `costBasis` | Meaning |
| --- | --- |
| `MEASURED_PROVIDER_BILLED` | OpenRouter's `usage.cost`, the amount charged. With a bring-your-own-key account `usage.cost` is only OpenRouter's fee, so billed = cost + `cost_details.upstream_inference_cost`, or unknown if that is absent. |
| `MEASURED_USAGE_AT_LIST_PRICE` | Anthropic: reported tokens × list price. |
| `UPPER_BOUND_AT_PRICE_CAP` | The charge is unknown. Tokens are priced at the price cap; when no usage was reported either, the request's size in bytes stands in for input tokens and `max_tokens` for output. Shown under estimated costs on the receipt, never under measured. |
| `NO_MARGINAL_PRICE` | Tool calls (public API, public RPC), and a model call that never reached a model: $0. |
| `FIXTURE` | Produced by the test double; not a real cost. |

A call that fails after it may have been processed throws `ModelCallError` carrying its usage, so
it is still recorded and counted against the budget: the billed amount if one was reported,
otherwise the ceiling. A call that never reached a model costs $0. Token classes are kept
disjoint: OpenRouter's `prompt_tokens` includes cached and cache-written tokens, so those are
subtracted from the input count.

One live investigation has been run (2026-09-18, signal `sig_24ecf336903c1da1`, QSRx; transcript
`artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`). It made 4 model calls, all
`MEASURED_PROVIDER_BILLED`: three routed to `deepseek/deepseek-v4-pro` and the revision to
`openai/gpt-5.6-terra`, $0.071725 in total against a $0.60 ceiling. The first draft did not match
the JSON schema (that endpoint did not enforce `strict`), the gate rejected it on rule `SCHEMA`,
and the one permitted revision passed all 11 rules. This is one run; no rejection rate, cost
distribution or latency figure can be inferred from it.

## Data modes

A transport has one primary mode and stamps everything it returns. `LiveTransport` can return
`CACHED` (the last good response, with its original fetch time and the failure reason) only when
asked to; `RecordedTransport` returns `HISTORICAL` or throws; `FixtureTransport` returns `FIXTURE`
or throws. A Brief's mode is the weakest of its inputs, and a fixture synthesiser makes the whole
Brief `FIXTURE`. A live read of past chain state is `LIVE` with `observedAt` set to the block
time: the label says how the data was obtained, the timestamp says what instant it describes.

## Payments

`PaymentRailAdapter` wraps the OKX SDK's `x402ResourceServer` with `ExactEvmScheme` and one
facilitator client: `OKXFacilitatorClient` (`syncSettle: true`) for `okx-testnet` / `okx-mainnet`,
or a local double for tests. `POST` is accepted as well as `GET`, and `/api/v1/briefs/latest` resolves to
the newest Brief on sale and then follows the same flow (a request that carries a payment resolves to
the Brief it was quoted for instead). The flow for `GET /api/v1/briefs/:id`:

1. No payment header → issue or reuse an immutable quote, answer `402` with `PAYMENT-REQUIRED`.
   If the rail is not ready, answer `503` and issue nothing. If the Brief was withdrawn, answer
   `410 brief_withdrawn` and issue nothing (see "Cancelled and corrected actions").
2. Payment header → idempotency key = `sha256(network:asset:from:nonce)` of the EIP-3009
   authorization. A known key is answered from the ledger and never settled again, but only to
   the buyer: see "Who an order is answered to".
3. New key → the authorization is checked against the quote without any network call (recipient,
   amount, 32-byte nonce, validity window, a signature is present); a payload that cannot pay the
   quote gets a `402` and costs no order row and no facilitator call. Then the order opens at
   `PAYMENT_PENDING` (the UNIQUE key makes concurrent duplicates lose), then `verify`, then
   `settle`.
4. `success` → independent receipt check on X Layer (exact `Transfer` to `payTo`) → `PAID` →
   `DELIVERING` → `DELIVERED`. `pending`, `timeout` or a thrown call → `PAYMENT_UNKNOWN`, `503`,
   nothing delivered. An explicit refusal → `PAYMENT_FAILED`.
5. Reconciliation never calls `settle`. It asks `getSettleStatus`, reads the receipt, and reads the
   token's `authorizationState(from, nonce)`; an unused authorization is declared failed only after
   its `validBefore`. A consumed authorization is not proof of payment, because EIP-3009's
   `cancelAuthorization` consumes a nonce and moves nothing. So when there is no transaction hash
   to check, reconciliation looks for the token's `AuthorizationUsed(payer, nonce)` event and
   requires the quoted `Transfer` in that same transaction (and no more of that payer's
   authorizations in it than quoted transfers). The event can only exist between the order opening
   and the authorization's `validBefore`, so the search starts at the block for that time (found
   by bisection) and walks forward in windows of 100 blocks, the RPC's `eth_getLogs` limit, up to
   40 windows. It therefore works however old the order is. Run against the real settlement of 18
   September twelve hours later it found the transaction in about 20 s; that is slow, and it only
   runs on this path. Consumed with no transfer found → `RECONCILIATION_REQUIRED`, never `PAID`.
   One reconciliation runs per order at a time; overlapping retries share it.
6. A `PAYMENT_PENDING` order that this process is not working on (it stopped, or threw, between
   opening the order and recording an outcome) is an unknown outcome, not a dead end: the next
   request with that authorization moves it to `PAYMENT_UNKNOWN` and reconciles it.

### Who an order is answered to

Once a payment is on-chain, the payer, the nonce and the signature are all public calldata, so
none of them shows that a caller is the buyer. The claim token is the only secret in a purchase.
It travels in the `X-Bullseye-Claim` header, in both directions, and is never read from a URL or
written into a body. There are two kinds.

- **Chosen by the buyer.** A buyer who sends `X-Bullseye-Claim` (32 to 128 URL-safe characters)
  with the paying request has committed to a secret before anything about the payment is public.
  Only its sha256 is stored. That order is never answered without it, delivered or not, and no
  server token is issued for it. The browser checkout (`apps/web/src/checkout/purchase.ts`) and
  the reference buyer (`scripts/buy-brief.ts`) both do this, and the OKX fetch client keeps a
  caller's own headers on the paying request.
- **Issued by the server**, for clients that send nothing: an HMAC of the order id under a secret
  kept in the database, returned in the `X-Bullseye-Claim` response header of `200`, `503` and
  `409` replies (never in a body, so it does not end up in a saved delivery envelope). It is the
  same token every time, before and after a restart, so handing it out again can never invalidate
  the one a buyer already holds.

An order can be reached through two doors. Both are answered from the same ledger, and neither
ever calls `settle` for an order that exists.

**The paid resource, with the signed payload** (`Checkout.recognise`). A request that carries an
authorization the ledger already knows:

- is only answered if it carries the exact payload that opened the order. A header rebuilt from
  `(payer, nonce)` gets a fresh `402`.
- If the buyer chose a token, it needs that token: `403 claim_token_required` otherwise.
- If the buyer chose none, it needs the server's token once the Brief has been delivered. Until
  the first delivery the payload alone is accepted and the token is returned again, because that
  is the path a buyer retries on when the payment outcome is unknown and the first response may
  not have arrived.
- A delivery is counted when the response has been written (`finish`), not when it was built, so
  a buyer whose connection dropped before the first `200` can still collect with the payload.

**The order routes, with the token alone** (`Checkout.holdsClaim`). `GET /api/orders/:id` and
`POST /api/orders/:id/reconcile` are answered to whoever presents the order's claim token, and to
the operator. `GET /api/orders/:id/delivery` is answered to the token holder only. The payload is
not asked for. That is no weaker than payload plus token: once the payment has settled, the
payer, the nonce and the signature are public, so the payload proves nothing the token does not
already prove, and a buyer who reloads a page, opens another tab or comes back after the
authorization's `validBefore` no longer has it. An order that does not exist and a wrong token
get the same `403 claim_token_required` with the same body, so order ids cannot be probed; the
operator gets `404 order_not_found` for a missing order. A token that is empty or longer than 256
characters is never compared. For an order opened with a buyer's token, the server's HMAC for
that order id opens nothing.

`GET /api/orders`, the list of every buyer's order, is an operator route.

**Collecting** (`Checkout.collect`, behind `GET /api/orders/:id/delivery`) is delivery for a buyer
who holds the token but no longer the signed authorization. By order state:

| Order state | Reply |
| --- | --- |
| `PAYMENT_PENDING`, settlement running in this process | `409 payment_in_progress`, `Retry-After: 3` |
| `PAYMENT_PENDING`, nobody working on it | moved to `PAYMENT_UNKNOWN`, then as the next row |
| `PAYMENT_UNKNOWN`, `RECONCILIATION_REQUIRED` | reconciled (chain and facilitator record are read; `settle` is not called), then answered by the state the order's row is in once that finishes: overlapping requests share one reconcile, and another of them may have delivered by then |
| `PAID`, `DELIVERING`, `DELIVERY_FAILED`, `DELIVERED` | `200` and the delivery envelope, with no `PAYMENT-RESPONSE` header; counted when written |
| `PAYMENT_FAILED` | `409 payment_failed` with the state. Not a challenge. |
| still unknown after reconciliation | `503 payment_outcome_unknown`, nothing delivered |

Collecting never settles, never issues a quote and never answers with a `402` challenge, so
collecting what was bought cannot turn into a second purchase. The paid resource answers a failed
authorization with a fresh challenge, because there the caller is buying; the delivery route
answers the same order with its state, because there the caller is only asking for what they
already paid for. Withdrawal does not apply to it: a buyer who paid before the issuer voided the
action still collects.

What is left, for a buyer who did not choose a token: someone who copies the signed payload out of
the settlement transaction can, before the first delivery is counted, present it at the paid
resource and get the Brief that buyer paid for, together with the server's token for that order.
That token also opens the three order routes for that one order. The window is widest after a
`503 payment_outcome_unknown`, when the transfer can be on-chain while nothing has been
delivered. The buyer's token is the same token and keeps working, so the buyer still gets theirs.
Choosing a token closes it: `payment-abuse.test.ts` shows the copied payload getting `403` and no
token while the order is still undelivered, and the order staying at `PAYMENT_UNKNOWN` until the
buyer's own token arrives.

`GET /api/orders`, `GET /api/orders/:id` and `POST /api/orders/:id/reconcile` never include the
ledger's payment key.

The `PAYMENT_UNKNOWN` path has been exercised once on the testnet rail (`OKX_X402_TESTNET`,
`eip155:1952`). For order `ord_8a2102084ad69dab` on 2026-09-18, `settle` returned
`status: "timeout"` together with a transaction hash. The order went to `PAYMENT_UNKNOWN` and
nothing was delivered. The buyer re-sent the same authorization, reconciliation found the
`Transfer` of 3000000 base units in X Layer testnet block 41310183, and the order moved to `PAID`
and `DELIVERED`. `settle` was called once and there was one delivery. Evidence:
`artifacts/integration/payment-ord_8a2102084ad69dab.json` and
`artifacts/evidence/delivery-ord_8a2102084ad69dab.json`. This is one settlement with test tokens.
It shows the payment mechanics; it is not revenue and not a rate.

## Keeping one purchase to one signature

The seller's ledger stops one authorization settling twice. It cannot stop a buyer signing a
second authorization for the same purchase. That is the buyer side's job, and both reference
buyers hold to one rule: **a second authorization is never requested because a response was lost,
a page was reloaded, or a write to storage failed.**

**Browser** (`apps/web/src/checkout/purchase.ts`, `usePurchase.ts`, `components/CheckoutNotice.tsx`).
One record per Brief, under `localStorage` key `bullseye.purchase.v1:<briefId>`, with a copy in the
page's memory that answers when storage cannot:

| Kept | Why |
| --- | --- |
| `quote` | The immutable quote the buyer approved: id, terms and their hash. A `200` whose terms hash or Brief content hash differs from it is not shown (`CONTENT_MISMATCH`). |
| `claim` | 32 random bytes, base64url. Chosen and saved before anything is signed, and sent with the payment, so no lost response can leave the buyer without it. |
| `paymentSignature` | The `PAYMENT-SIGNATURE` header value. Saved before it is sent, re-sent as is, never replaced. |
| `orderId`, `status`, `detail`, `createdAt`, `updatedAt` | Where the purchase stands. |

No private key is kept anywhere: the key stays in the injected wallet, which is only asked to sign
the seller's challenge. `signer.ts` also keeps the signature per quote id in page memory and
`sessionStorage` for the quote's `maxTimeoutSeconds`, so a second press of Pay on the same quote
gets the same signature even when storage refuses the write.

| Status | Meaning |
| --- | --- |
| `INTENT` | Recorded, claim token chosen, nothing signed. |
| `SIGNED` | The wallet signed; the request is not known to have been sent. |
| `SUBMITTED` | Sent to the seller; no answer recorded. |
| `UNKNOWN` | The seller says the payment's outcome is not known (`503 payment_outcome_unknown`, or a reconcile that settled nothing). |
| `PAID` | Paid; the Brief has not reached this browser. |
| `DELIVERED` | The envelope arrived and matched the quote. |
| `FAILED` | The seller says nothing was charged. Only now, or from `INTENT`, may a new purchase start. |

Pay signs only when no earlier purchase of that Brief is unresolved. With a record in any status
but `INTENT` or `FAILED`, Pay recovers instead: it collects by order id and claim token when the
order id is known, and otherwise re-sends the held signature. `resume`, `reconcile` and collecting
never sign. Two presses of Pay share one promise and one signature. A wallet that produces no
signature throws a typed `WalletError` (`DECLINED`, `NO_ACCOUNT`, `NETWORK_MISSING`,
`NETWORK_NOT_SWITCHED`, `SIGN_FAILED`); each means nothing was signed, and the notice says so. A
`402` in answer to a held authorization marks the purchase `FAILED`, except when its reason
speaks of a used nonce: then the status is left alone and the buyer is told not to pay again.

An unknown outcome, or a settlement still in progress, is re-checked without the buyer:
`AUTO_CHECKS` is 6 checks, 10 s apart, each a reconcile by claim token (or a re-send of the held
signature when no order id is known yet). After that the page waits for the buyer to press "Check
the chain again". On load, a record that has an order id and is not `FAILED` is collected with
its token; nothing on that path signs or sends an authorization. `App.tsx` reads this browser's
own order with its token and does not read `GET /api/orders`.

Known limit: when a write does not reach `localStorage` (a private window, blocked storage) the
record lives only in the page's memory. `Checkout.durable` turns false and the notice warns:
keep the tab open until the Brief is delivered. If such a page is reloaded before delivery, the
claim token and the authorization are gone. The order still exists in the seller's ledger, but
nothing in that browser leads back to it, and a new press of Pay would start a new purchase.

**Agent** (`scripts/buy-brief.ts`, `scripts/purchase-journal.ts`). One JSON file per purchase under
`data/purchases/`, which is git-ignored, written whole (temporary file, then rename) with mode
`0600`. It holds `base`, `briefId`, `path`, `quoteId`, `termsHash`, `payer`, `claim`,
`paymentHeaders` (exactly as sent), `orderId` and `state` (`SIGNED`, `UNKNOWN`, `DELIVERED`,
`FAILED`). The buyer's private key is never written or printed, and nothing from the journal is
printed. The entry is written before the authorization is sent; if it cannot be written, the
script refuses to send and the authorization expires unused. A later run that finds an entry in
state `SIGNED` or `UNKNOWN` for the same seller, Brief and payer re-sends the same headers and
signs nothing. `--collect <orderId>` fetches a purchase again through
`GET /api/orders/:id/delivery` with the journal's token; it needs no key. `verify-payment.ts` and
`run-demo.ts` read an order with the journal's token, as any buyer must. The delivery envelope
saved under `artifacts/evidence/` carries no claim token and no signature.

## Who may read what

Three readers, decided per request.

| Reader | Recognised by | Reads |
| --- | --- | --- |
| Visitor (`PUBLIC`) | Nothing. Anyone. | The public projection of the desk's read routes, the free previews, the catalogue and the two aggregates (`GET /api/commerce/summary`, `GET /api/desk/economics`). |
| Buyer | `X-Bullseye-Claim` | One order: its row and receipt, its reconciliation, its delivery. Nothing of anyone else's. |
| Diagnostics (`DIAGNOSTIC`) | `Authorization: Bearer` with `OPERATOR_TOKEN` or `VIEWER_TOKEN`; or, with no operator token configured, a localhost desk that is not a production build | The desk's working detail: evidence summaries, on-chain figures, per-run cost, real ids in the activity feed. |

`audienceOf` answers `DIAGNOSTIC` when the operator check grants access, or when the bearer token
equals `VIEWER_TOKEN`; otherwise `PUBLIC`. Tokens are compared as sha256 digests in constant
time. Every projected response carries `audience`, so a client can say which view it is showing.
`GET /api/health` reports who may read diagnostics as `diagnostics` (`OPEN_ON_LOCALHOST`,
`TOKEN_REQUIRED` or `DISABLED`).

`VIEWER_TOKEN` reads and starts nothing. It is not accepted by the operator routes (scan,
investigate, the order list, the fixture control) and it opens no order: `GET /api/orders/:id`
answers it `403` like anyone else without the claim token. It exists so that a wall display can
show diagnostics without the operator's token sitting in a browser. With it a reader does see
order and quote ids in the activity feed; those open nothing without a claim token.

What a Brief sells is what the chain showed, checked against the issuer: the reads, the activation
block, each check's verdict. Evidence summaries and per-check results say exactly that, so a
visitor is shown that each step happened, when, and whether it succeeded, and not what it found.
Model and tool call details (models routed to, tokens, cost) are the desk's working records. The
issuer's own figures are public and stay. The public projection (`projections.ts`):

| Route | Kept | Withheld |
| --- | --- | --- |
| `GET /api/investigations` | Every summary field: ids, symbol, status, stop reason, times, `briefId`, the gate's decision and cap, `draftsJudged`. `usage.modelCalls`, `usage.toolCalls`. | What the run cost, its cost bases and the models it was routed to. `usage.costsWithheld` is `true`. |
| `GET /api/investigations/:id`, and `investigation` in `GET /api/signals/:id` | Every timeline entry with its time, type, evidence id and `ok`, and its label (the `CHECKS` entry's label only on a run with nothing to protect). The gate's decision, version, cap, and each finding's rule and `passed`. `budget`, `budgetAtStart`. | `detail` of `EVIDENCE`, `CHECKS`, `MODEL_CALL` and `TOOL_CALL` entries, on every run. For a run of a signal that may still sell, also `detail` of `GATE` entries; the `detail` of every failed finding, and of `FAILED_CHECKS_DISCLOSED` passed or not, in `gate` and `gateAttempts`, replaced by a sentence saying it is withheld; and the counts in the `CHECKS` entry's label, replaced by "Consistency checks computed". Usage as above. |
| `GET /api/investigations/:id/chain` | `network`, `token`, `symbol`, the issuer's multipliers and effective time, `activationSearched`; for each read its `key`, `evidenceId` and `mode`; for the activation its `evidenceId` and `mode`. | For a run of a signal that may still sell: `blockNumber`, `blockTime` and `multiplier` of every read, and `blockNumber` and `blockTime` of the activation, all `null`, with `withheld: true`. |
| `GET /api/activity` | Every event, its time, kind, symbol, summary, rail and state. Signal and investigation ids. | The `refId` of `QUOTE_ISSUED` and `ORDER_STATE` events, replaced by a stand-in. |

"May still sell" follows the signal, not the run (`signalMayStillSell` in `investigator.ts`): some
run of the signal has a Brief, or is still `RUNNING`. Every run of a signal reads the same event
at the same blocks, so an earlier `REJECTED` or `STOPPED` run holds what a later run of that
signal sells. A signal has something to protect while a run of it may still publish, and once
one has, so a run is not readable in full during the minutes before its Brief exists. Only a
run that finished with no Brief (`REJECTED`, `STOPPED`), of a signal with no Brief and no run in
progress, has nothing to sell, and its rejection is the point: its gate findings, its `CHECKS`
label ("N passed, M failed, K unknown") and its on-chain figures are shown in full
(`withheld: false`). Its evidence and check details stay withheld like any other run's. On a
protected run the passed finding `FAILED_CHECKS_DISCLOSED` names the checks that failed, and the
`CHECKS` label counts the verdicts, so both are withheld; the `CHECKS` entry itself stays, with
a neutral label. A rejected first draft of a run whose revision
was published can quote the very figures the Brief sells, so the detail of its failed findings
is withheld.

The stand-in is `ref_` plus 16 hex characters of an HMAC of the real id under a secret kept in
the database. It is the same every time, so one order's rows still group, and it names no order
and no quote.

`access-projections.test.ts` checks the projection from the outside: with one Brief published and
bought, none of thirteen free routes contains an evidence summary other than the issuer's record,
a block number from that evidence, or the text of a claim, an unknown, a limitation or the
confidence rationale.

Status: the claim-token order routes, the browser and agent purchase records, and the
projections in this section are on a branch that has not been merged to `main`, and are not
deployed. The public deployment is built from `main`, where `GET /api/orders` and
`GET /api/orders/:id` answer anyone, reconcile is an operator route, and the investigation routes
return full detail. See `DEPLOYMENT.md`.

SQLite through `node:sqlite`. Quotes are insert-only, `orders.quote_id` and `orders.terms_hash`
are frozen, `order_events` is append-only; all three are enforced by triggers as well as by code.
Briefs are stored as JSON with a sha256 over their canonical form, computed after the same JSON
round trip and schema parse a reader applies, and re-checked on every read.

## Known limits

Single process, single SQLite file, no accounts (a visitor gets the public projection, a buyer is
known only by a claim token, diagnostics by one of two shared bearer tokens), a detector that
scans only on request and has no measured latency, one issuer, one chain, one signal type.

- A claim token is a bearer secret. Whoever holds it reads, reconciles and collects that order,
  and there is no way to revoke or rotate it. A buyer who loses it cannot reach the order; only
  the operator's order list still shows it.
- A browser whose storage is unusable keeps the purchase in page memory only. See "Keeping one
  purchase to one signature".
- `GET /api/commerce/summary` and `GET /api/desk/economics` read the 500 newest orders and
  investigations. Past that they undercount.

- One live investigation and one live testnet settlement exist. No quality evaluation, rejection
  rate, detector recall or latency measurement exists.
- A scan runs only when `POST /api/signals/scan` is called, and it reads one page of the 50 most
  recently created history records. A cancellation or replacement is noticed, and a Brief
  withdrawn, only on a scan whose page still contains the signal's own version.
- Withdrawal is enforced on the paid resource and in the catalogue, and reported by the preview.
  `GET /api/briefs` still lists a withdrawn Brief, and `POST /api/briefs/:id/quotes` still issues
  a quote for one; that quote cannot be paid.
- The model that answers is chosen by OpenRouter per request and can differ between calls of one
  investigation. Bullseye bounds its price and records which model answered; it does not pin it.
- The writing request asks for `strict` JSON schema output. In the one live run the endpoint that
  answered did not enforce it. The gate's `SCHEMA` rule is the control, and a schema fault uses up
  the one permitted revision.
- `UPPER_BOUND_AT_PRICE_CAP` is a ceiling, not a measurement. A call carried at it may have cost
  less, or nothing.
- The one-request rule and the costing of failed calls are implemented in the OpenRouter provider.
  The Anthropic provider uses its SDK's retries (`maxRetries: 2`), and a failed Anthropic call is
  recorded at $0.
- The only settlement run so far was on X Layer testnet with test tokens.
