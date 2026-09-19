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
or a local double for tests. The flow for `GET /api/v1/briefs/:id`:

1. No payment header → issue or reuse an immutable quote, answer `402` with `PAYMENT-REQUIRED`.
   If the rail is not ready, answer `503` and issue nothing. If the Brief was withdrawn, answer
   `410 brief_withdrawn` and issue nothing (see "Cancelled and corrected actions").
2. Payment header → idempotency key = `sha256(network:asset:from:nonce)` of the EIP-3009
   authorization. A known key is answered from the ledger and never settled again.
3. New key → order opens at `PAYMENT_PENDING` (the UNIQUE key makes concurrent duplicates lose),
   then `verify`, then `settle`.
4. `success` → independent receipt check on X Layer (exact `Transfer` to `payTo`) → `PAID` →
   `DELIVERING` → `DELIVERED`. `pending`, `timeout` or a thrown call → `PAYMENT_UNKNOWN`, `503`,
   nothing delivered. An explicit refusal → `PAYMENT_FAILED`.
5. Reconciliation never calls `settle`. It asks `getSettleStatus`, reads the receipt, and reads the
   token's `authorizationState(from, nonce)`; an unused authorization is declared failed only after
   its `validBefore`.

The `PAYMENT_UNKNOWN` path has been exercised once on the testnet rail (`OKX_X402_TESTNET`,
`eip155:1952`). For order `ord_8a2102084ad69dab` on 2026-09-18, `settle` returned
`status: "timeout"` together with a transaction hash. The order went to `PAYMENT_UNKNOWN` and
nothing was delivered. The buyer re-sent the same authorization, reconciliation found the
`Transfer` of 3000000 base units in X Layer testnet block 41310183, and the order moved to `PAID`
and `DELIVERED`. `settle` was called once and there was one delivery. Evidence:
`artifacts/integration/payment-ord_8a2102084ad69dab.json` and
`artifacts/evidence/delivery-ord_8a2102084ad69dab.json`. This is one settlement with test tokens.
It shows the payment mechanics; it is not revenue and not a rate.

## Storage

SQLite through `node:sqlite`. Quotes are insert-only, `orders.quote_id` and `orders.terms_hash`
are frozen, `order_events` is append-only; all three are enforced by triggers as well as by code.
Briefs are stored as JSON with a sha256 over their canonical form, computed after the same JSON
round trip and schema parse a reader applies, and re-checked on every read.

## Known limits

Single process, single SQLite file, no auth on the desk endpoints (the investigation timeline is
an operator view), a detector that scans only on request and has no measured latency, one issuer, one chain, one signal type.

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
