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
| Which facts exist | `EvidenceToolbox` | Every fact is an `EvidenceItem` written by code from a validated source response. The model cannot author evidence. |
| Whether sources agree | `runConsistencyChecks` | Multipliers are compared at the contract's 18-decimal precision, not by a model. |
| How much may be spent | `BudgetGovernor` | Asked before every model call and tool call; projects the worst case of the next call so the cost ceiling is a ceiling, not a post-mortem. |
| What the Brief says | the model | Investigation order and prose only, inside a JSON schema. |
| Whether it is published | `evaluatePublication` (pure function) | The model has no vote. One bounded revision is allowed for drafting faults; missing or stale evidence cannot be rewritten away. |
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
   If the rail is not ready, answer `503` and issue nothing.
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

## Storage

SQLite through `node:sqlite`. Quotes are insert-only, `orders.quote_id` and `orders.terms_hash`
are frozen, `order_events` is append-only; all three are enforced by triggers as well as by code.
Briefs are stored as JSON with a sha256 over their canonical form, computed after the same JSON
round trip and schema parse a reader applies, and re-checked on every read.

## Known limits

Single process, single SQLite file, no auth on the desk endpoints (the investigation timeline is
an operator view), a polling detector with no measured latency, one issuer, one chain, one signal type.
