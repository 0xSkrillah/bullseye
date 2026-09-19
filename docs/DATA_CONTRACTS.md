# Data contracts

The schemas in `packages/domain/src` are the contracts; this page is a map. Everything that
crosses a boundary (source response, model output, HTTP body, stored row) is parsed with Zod.

## External sources → adapters (`apps/api/src/adapters/xstocks.ts`)

Strict on the fields Bullseye depends on, tolerant of additions. Nothing is patched over: a value
that fails validation is never repaired or defaulted.

- A single-object response that does not match raises `SchemaMismatchError` and the request fails
  (`502 source_schema_mismatch` on an HTTP route).
- The corporate-action history is a list and is validated record by record. A record that fails is
  left out and returned in `rejected` (`index`, `eventId` if readable, `reason`); the other records
  are used. `SchemaMismatchError` is still raised when more than half the records of a page fail,
  or when the page itself has no `nodes` array.
- A rejected record is surfaced, not dropped silently. The scan lists it in `skipped` and trusts no
  version of its event until it parses. Inside an investigation `get_corporate_action` throws if
  the symbol's history contains a rejected record for the signal's event, or one with no readable
  `eventId`.

| Endpoint (xStocks API v2, public) | Schema | Fields relied on |
| --- | --- | --- |
| `GET /public/corporate-actions/history` | `{ nodes: unknown[] }`, each node parsed as `XsCorporateAction`; failures go to `rejected[]` | `eventId`, `version`, `xstockSymbol`, `caType`, `effectiveTimeUtc` (nullable; null on cancelled actions), `multiplierOld`, `multiplierNew` (both nullable), cashflows, `withholdingTaxRate`, `createdTimeUtc`, `status` (Initial, Corrected and Cancelled seen on 2026-09-18), `notes` (optional, nullable; a cancellation names the cancelled version here: `[CANCELLED v2] reason`) |
| `GET /public/assets/{symbol}` | `XsAsset` | `symbol`, `name`, `isin`, `underlyingSymbol`, `deployments[].network/address` |
| `GET /public/assets/{symbol}/multiplier?network=XLayer` | `XsMultiplier` | `currentMultiplier`, `newMultiplier` |
| `GET /public/proof-of-reserves/{symbol}` | `XsProofOfReserves` | `timestamp`, `sharesHeld`, `circulatingSupply`, `holdings[]` |
| `GET /public/assets/{symbol}/price-data` | `XsPrice` | `quote` |
| `GET /public/system/status/{symbol}` | `XsTradingStatus` | halt flags |
| `GET /public/assets/{symbol}/total-supply`, `/circulating-supply` | `XsSupply` | `value` |

X Layer reads (`xlayer.ts`): `multiplier()`, `totalSupply()`, `decimals()` on the xStock token at
a given block, plus block headers. Values are returned as decimal strings and block references so
they are JSON-safe and hash the same before and after storage.

Model provider (`apps/api/src/research/openrouter.ts`): the chat-completions response is parsed
with Zod. Fields relied on: `choices[0].message.content`, `choices[0].message.tool_calls[]` (`id`,
`function.name`, `function.arguments`), `choices[0].finish_reason`, the top-level `model` (the
model that answered) and `usage` (`prompt_tokens`, `completion_tokens`, `cost`, `is_byok`,
`cost_details.upstream_inference_cost`, `prompt_tokens_details.cached_tokens` and
`cache_write_tokens`). `usage` is read before anything that can throw. A 200 body that does not
match the shape raises `ModelCallError`. A 200 body that carries an error object raises
`ModelUnavailableError` for codes 401, 402, 403, 404 and 503 (the call is recorded at $0) and
`ModelCallError` for any other code. `ModelCallError` carries the reported usage, or a ceiling when
none was reported, so the call is still costed.

## Domain objects

| Object | File | Notes |
| --- | --- | --- |
| `Provenance`, `DataMode`, `weakestMode` | `provenance.ts` | `mode`, `source`, `url`, `fetchedAt`, `sha256` of the raw body, optional `note`. |
| `SignalEvent` | `signal.ts` | `id = sig_` + sha256(`eventId:version`)[0:16]; `category`, `asset` (symbol, X Layer token address, chain id 196), `observedAt`, `detectedAt`, `headline`, `reasonFlagged`, `facts`, `sources[]`, `provenance` (`mode`, `detector`, `detectorVersion`, `inputHash`). Only a version the issuer still stands behind becomes a signal. A later cancellation or replacement does not change the stored signal; it is recorded beside it in `signals.superseded_json` as `byVersion`, `reason` (`CANCELLED` or `REPLACED`), `status`, `notes`, `notedAt`. |
| `EvidenceItem`, `ConsistencyCheck` | `evidence.ts` | Stable ids (`EV-CA`, `EV-CHAIN-BEFORE`, …); flat `values` map; `observedAt`; `staleAfter`; provenance. `EV-CA` holds the signal's own version of the issuer record plus `newestVersion`, `newestStatus`, `supersededByVersion`, `supersededReason` (`CANCELLED` or `REPLACED`) and `supersedingNotes`; the last three are null while the version stands. Checks are PASS / FAIL / UNKNOWN with the evidence they used. There are 9: `CHK-ACTION-STILL-CURRENT`, `CHK-BEFORE-MATCHES-OLD`, `CHK-AFTER-MATCHES-NEW`, `CHK-LATEST-MATCHES-NEW`, `CHK-API-STATE-MATCHES-CHAIN`, `CHK-RESERVES-COVER-SUPPLY`, `CHK-ACTIVATION-ON-SCHEDULE`, `CHK-REBASE-SIZE-PLAUSIBLE`, `CHK-TRADING-NOT-HALTED`. The first 4 are the core checks (`CORE_CHECKS` in `apps/api/src/evidence/checks.ts`); a failed or unknown core check caps confidence at LOW. |
| `ResearchBudget`, `UsageRecord`, `CostBasis`, `StopReason` | `budget.ts` | One usage record per model or tool call with tokens, latency, cost and `costBasis`. `UsageRecord.model` is the model that actually answered a model call (null for tool calls); it differs from the requested id when a router chose it. `CostBasis` is one of `MEASURED_PROVIDER_BILLED` (the amount the provider reports it charged), `MEASURED_USAGE_AT_LIST_PRICE` (reported tokens × list price), `UPPER_BOUND_AT_PRICE_CAP` (charge unknown; priced at the configured price cap; a ceiling, not a measurement), `NO_MARGINAL_PRICE` (tool calls, and a model call that never reached a model) and `FIXTURE` (test double; not a real cost). |
| `BriefDraft` | `brief.ts` | The only part a model writes: headline, three claim sections, confidence, unknowns (≥1), conflicts, limitations (≥1). Each claim lists `evidenceIds` and `quantities` (`value`, `evidenceId`, `valueKey`). |
| `GateResult` | `brief.ts` | Decision, gate version, confidence cap, one finding per rule. |
| `Synthesis` | `brief.ts` | `provider`, `model` (the id that was requested, e.g. `openrouter/auto`), `mode` (LIVE or FIXTURE) and optional `routedModels`: when `model` is a router, the sorted list of models it actually chose in this investigation. It is set only when at least one answering model was reported and the requested id is not among them. |
| `Brief` (`bullseye.brief/v1`) | `brief.ts` | Signal, draft, evidence, checks, gate, `synthesis` (a `Synthesis`), `dataMode`, disclaimer, `contentHash`. This JSON is the machine-readable product and the source the UI renders. |
| `QuoteTerms`, `Quote`, `Order`, `OrderState`, `ORDER_TRANSITIONS`, `PaymentEvidence` | `order.ts` | Terms are hashed at issue; an order stores the hash and can never point at other terms. |
| `EconomicsReceipt`, `CostLine` | `economics.ts` | `measuredCosts[]` and `estimatedCosts[]` are separate arrays with separate totals. Model calls at `MEASURED_PROVIDER_BILLED` or `MEASURED_USAGE_AT_LIST_PRICE` are measured lines; calls at `UPPER_BOUND_AT_PRICE_CAP` are an estimated line, never a measured one. |

## HTTP

Operator routes (`POST /api/signals/scan`, `POST /api/signals/:id/investigate`,
`POST /api/orders/:id/reconcile`, and `POST /api/_fixture/control` on the fixture rail) are open on
localhost. On any other `PUBLIC_BASE_URL` they answer `403 operator_routes_disabled`, or with
`OPERATOR_TOKEN` set `401 operator_token_required` to anything but `Authorization: Bearer <token>`.
Three fixed one-minute limits per client address answer `429 rate_limited` with `Retry-After` and
name themselves in `limit`: `paid_routes` on the paid resource and the quote route
(`PAID_ROUTE_RATE_LIMIT_PER_MINUTE`, 60), `payment_attempts` on requests to those routes that
carry a payment (`PAYMENT_ATTEMPT_RATE_LIMIT_PER_MINUTE`, 12), and `api` on every `/api` route
except the health check (`API_RATE_LIMIT_PER_MINUTE`, 600). Request bodies are parsed after that limit; a body that is not
JSON, or is over 100 kB, gets `400 invalid_request`. A CORS preflight is granted the request
headers it asks for (nothing uses cookies). In a production build
(`NODE_ENV=production`) the operator routes are never treated as local.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Data mode, synthesis readiness (`provider`, `model`, `ready`, `detail`; for OpenRouter the detail states the cost tier and the price cap), rail readiness, budget, `operatorRoutes` (`OPEN_ON_LOCALHOST`, `TOKEN_REQUIRED` or `DISABLED`), `autoDesk` (`enabled`, and when enabled `intervalMinutes` and `maxInvestigationsPerDay`), SDK versions. |
| `POST /api/signals/scan`, `GET /api/signals`, `GET /api/signals/:id` | Detector and feed. The scan result carries `skipped[]` (`symbol`, `reason`): assets that could not be read and issuer records rejected by the schema. Each entry of `GET /api/signals` is `signal`, `superseded` and `investigation`; `superseded` is null, or `byVersion`, `reason` (`CANCELLED` or `REPLACED`), `status`, `notes`, `notedAt` once a scan has seen the issuer cancel or replace the signal's version. |
| `POST /api/signals/:id/investigate`, `GET /api/investigations/:id` | Start and watch an investigation (idempotent per signal). The view's `usage` summary has `modelCalls`, `toolCalls`, `measuredModelCostUsd` (only what a provider reported: billed amounts, or reported tokens at list price), `upperBoundModelCostUsd` (calls whose charge is unknown, carried at the price cap), `budgetSpentUsd` (what the governor counted against the ceiling: every basis), `costBases`, `costBasis` (the first model call's basis) and `routedModels`. |
| `GET /api/briefs`, `GET /api/briefs/:id/preview` | Free previews: headline, counts, mode, hash. No findings. The preview response also carries `withdrawn`: null, or the same object as `superseded` when the Brief's action was voided. `GET /api/briefs` still lists a withdrawn Brief and does not mark it. |
| `GET /api/v1/catalog` | Machine-readable list of what is for sale, for agents. Withdrawn Briefs are omitted. `latest` names the stable paid address and its methods. |
| `POST /api/briefs/:id/quotes` | Issue or reuse an immutable quote. This route does not check withdrawal; a quote for a withdrawn Brief cannot be paid, because the paid resource answers `410`. |
| **`GET` or `POST /api/v1/briefs/:id[?quote=]`** | The paid x402 resource; both methods behave the same and any other answers `405`. `402` + `PAYMENT-REQUIRED`; with `PAYMENT-SIGNATURE`: `200` delivery envelope + `PAYMENT-RESPONSE`, `503 payment_outcome_unknown`, `409 payment_in_progress`, or `402` on failure. `503 payment_rail_unavailable` when the rail cannot settle. `410 brief_withdrawn` (`briefId`, `detail`, `message`) when the Brief's action was voided and the request carries no payment or an authorization the ledger has not seen: no quote, no challenge, no settlement. An authorization the ledger already knows is answered from its order, so a buyer who already paid still gets delivery: but only to a request carrying the exact payload that opened the order, and with the claim token in `X-Bullseye-Claim` (`403 claim_token_required` otherwise; a payload that does not match gets a fresh `402`). The token is either one the buyer sent with the paying request (32 to 128 URL-safe characters; then it is always required) or the one the server returns in the `X-Bullseye-Claim` response header of `200`, `503` and `409` replies (then it is required once the Brief has been delivered, and the payload alone is enough before that). A payload that cannot pay the quote (no signature, wrong recipient or amount, malformed nonce, outside its validity window) gets a `402` whose error starts "payment rejected before verification" and opens no order. |
| **`GET` or `POST /api/v1/briefs/latest[?symbol=]`** | One stable paid address for the newest Brief on sale, optionally for one asset (`?symbol=QSRx`, or `{"symbol":"QSRx"}` in a POST body). Same replies as the row above, with `resource.url` set to this address, so a quote issued here is separate from a quote for the Brief's own address. `404 nothing_for_sale` and no challenge when no Brief is on sale; withdrawn Briefs are never offered. A request that carries a payment is matched to the quote it was signed against (an existing order first, then the quotes issued at this address, preferring the Brief named in the echoed resource description), so a buyer quoted Brief A still receives A after a newer Brief is published. |
| `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/reconcile` | Order, event trail, payment evidence and economics receipt; reconciliation never re-settles. `order.paymentKey` is always null in these responses. |

Delivery envelope (`bullseye.delivery/v1`): `orderId`, `state`, `quote` (id, terms hash, terms),
`payment` (rail, payer, tx hash, facilitator status, chain verification), `brief`.
