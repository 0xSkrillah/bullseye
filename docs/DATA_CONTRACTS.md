# Data contracts

The schemas in `packages/domain/src` are the contracts; this page is a map. Everything that
crosses a boundary (source response, model output, HTTP body, stored row) is parsed with Zod.

## External sources → adapters (`apps/api/src/adapters/xstocks.ts`)

Strict on the fields Bullseye depends on, tolerant of additions. A mismatch raises
`SchemaMismatchError` and the request fails; it is never patched over.

| Endpoint (xStocks API v2, public) | Schema | Fields relied on |
| --- | --- | --- |
| `GET /public/corporate-actions/history` | `XsCorporateAction[]` | `eventId`, `version`, `xstockSymbol`, `caType`, `effectiveTimeUtc`, `multiplierOld`, `multiplierNew`, cashflows, `withholdingTaxRate`, `createdTimeUtc`, `status` |
| `GET /public/assets/{symbol}` | `XsAsset` | `symbol`, `name`, `isin`, `underlyingSymbol`, `deployments[].network/address` |
| `GET /public/assets/{symbol}/multiplier?network=XLayer` | `XsMultiplier` | `currentMultiplier`, `newMultiplier` |
| `GET /public/proof-of-reserves/{symbol}` | `XsProofOfReserves` | `timestamp`, `sharesHeld`, `circulatingSupply`, `holdings[]` |
| `GET /public/assets/{symbol}/price-data` | `XsPrice` | `quote` |
| `GET /public/system/status/{symbol}` | `XsTradingStatus` | halt flags |
| `GET /public/assets/{symbol}/total-supply`, `/circulating-supply` | `XsSupply` | `value` |

X Layer reads (`xlayer.ts`): `multiplier()`, `totalSupply()`, `decimals()` on the xStock token at
a given block, plus block headers. Values are returned as decimal strings and block references so
they are JSON-safe and hash the same before and after storage.

## Domain objects

| Object | File | Notes |
| --- | --- | --- |
| `Provenance`, `DataMode`, `weakestMode` | `provenance.ts` | `mode`, `source`, `url`, `fetchedAt`, `sha256` of the raw body, optional `note`. |
| `SignalEvent` | `signal.ts` | `id = sig_` + sha256(`eventId:version`)[0:16]; `category`, `asset` (symbol, X Layer token address, chain id 196), `observedAt`, `detectedAt`, `headline`, `reasonFlagged`, `facts`, `sources[]`, `provenance` (mode, detector, version, `inputHash`). |
| `EvidenceItem`, `ConsistencyCheck` | `evidence.ts` | Stable ids (`EV-CA`, `EV-CHAIN-BEFORE`, …); flat `values` map; `observedAt`; `staleAfter`; provenance. Checks are PASS / FAIL / UNKNOWN with the evidence they used. |
| `ResearchBudget`, `UsageRecord`, `StopReason` | `budget.ts` | One usage record per model or tool call with tokens, latency, cost and `costBasis`. |
| `BriefDraft` | `brief.ts` | The only part a model writes: headline, three claim sections, confidence, unknowns (≥1), conflicts, limitations (≥1). Each claim lists `evidenceIds` and `quantities` (`value`, `evidenceId`, `valueKey`). |
| `GateResult` | `brief.ts` | Decision, gate version, confidence cap, one finding per rule. |
| `Brief` (`bullseye.brief/v1`) | `brief.ts` | Signal, draft, evidence, checks, gate, synthesis info, `dataMode`, disclaimer, `contentHash`. This JSON is the machine-readable product and the source the UI renders. |
| `QuoteTerms`, `Quote`, `Order`, `OrderState`, `ORDER_TRANSITIONS`, `PaymentEvidence` | `order.ts` | Terms are hashed at issue; an order stores the hash and can never point at other terms. |
| `EconomicsReceipt`, `CostLine` | `economics.ts` | `measuredCosts[]` and `estimatedCosts[]` are separate arrays with separate totals. |

## HTTP

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Data mode, synthesis readiness, rail readiness, budget, SDK versions. |
| `POST /api/signals/scan`, `GET /api/signals`, `GET /api/signals/:id` | Detector and feed. |
| `POST /api/signals/:id/investigate`, `GET /api/investigations/:id` | Start and watch an investigation (idempotent per signal). |
| `GET /api/briefs`, `GET /api/briefs/:id/preview` | Free previews: headline, counts, mode, hash. No findings. |
| `GET /api/v1/catalog` | Machine-readable list of what is for sale, for agents. |
| `POST /api/briefs/:id/quotes` | Issue or reuse an immutable quote. |
| **`GET /api/v1/briefs/:id[?quote=]`** | The paid x402 resource. `402` + `PAYMENT-REQUIRED`; with `PAYMENT-SIGNATURE`: `200` delivery envelope + `PAYMENT-RESPONSE`, `503 payment_outcome_unknown`, `409 payment_in_progress`, or `402` on failure. `503 payment_rail_unavailable` when the rail cannot settle. |
| `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/reconcile` | Order, event trail, payment evidence and economics receipt; reconciliation never re-settles. |

Delivery envelope (`bullseye.delivery/v1`): `orderId`, `state`, `quote` (id, terms hash, terms),
`payment` (rail, payer, tx hash, facilitator status, chain verification), `brief`.
