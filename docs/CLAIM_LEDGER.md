# Claim ledger

Every claim Bullseye makes about itself, what backs it, and what does not. If a claim is not in
the "Verified" table with evidence you can run or open, do not repeat it in a pitch, a README or
a demo. Last reviewed: 18 September 2026.

Status values: **VERIFIED** (evidence in this repo, reproducible) · **PARTIAL** (mechanism built
and tested, but not against the real external system) · **BLOCKED** (cannot be done yet; reason
given) · **NOT CLAIMED**.

## Verified

| # | Claim | Evidence |
| --- | --- | --- |
| V1 | Bullseye fetches genuine RWA reference data from the xStocks public API and validates it against strict schemas before use. | `npm run spike` step 1; `apps/api/src/adapters/xstocks.ts`; `artifacts/integration/spike-*.json` (URL, sha256 of the response, 50 actions). |
| V2 | Bullseye connects to X Layer mainnet (chain id 196) and reads contract state, including historical state. | `npm run spike` step 2; `apps/api/src/adapters/xlayer.ts`. |
| V3 | On 18 Sep 2026 the detector flagged real dividend rebases on xStocks deployed on X Layer, and for IFFx and QSRx the on-chain `multiplier()` was the old value 60 s before the issuer's effective time and the new value 60 s after, with activation in the block stamped 00:30:00Z. | `artifacts/recorded/xstocks-2026-09-18/` (unmodified responses with sha256 and fetch time); replayed in `apps/api/test/transport.test.ts`. |
| V4 | Detector output is reproducible: identical inputs give identical SignalEvents, including ids and input hashes. | `apps/api/test/detector.test.ts`. |
| V5 | A SignalEvent carries category, asset, observation and detection timestamps, sources and provenance. | `packages/domain/src/signal.ts`; detector test "carries category, asset, …". |
| V6 | Investigations run under a hard ceiling on variable cost, model calls, tool calls and latency, enforced by code before each call; an uneconomic investigation is declined before any spend. | `apps/api/src/research/governor.ts`; `investigation.test.ts` "research budget governor" (5 tests). |
| V7 | The publication gate is deterministic and rejects: missing mandatory evidence, stale evidence, numbers or timestamps not found in cited evidence, quantities that disagree with evidence, undisclosed failed checks, confidence above the computed cap, investment-advice language, and fixture inputs. | `apps/api/src/gate/publicationGate.ts`; `gate.test.ts` (15 tests); `investigation.test.ts` adverse cases. |
| V8 | A rejected or stopped investigation produces no Brief, and nothing can be charged for it. | `investigation.test.ts` "blocks a Brief when …". |
| V9 | The human Brief and the machine JSON are the same object: the UI renders the delivered `bullseye.brief/v1` JSON, whose sha256 content hash is re-checked on every read. | `apps/api/src/briefs.ts`; `investigation.test.ts` first test. |
| V10 | Bullseye's paid endpoint speaks x402 v2 using the OKX seller SDK (`@okxweb3/x402-core` resource server, `ExactEvmScheme`), and the OKX client SDK can parse its challenge, sign it and be served. | `apps/api/src/commerce/`; `checkout.test.ts` (uses the real OKX client SDK as the buyer). |
| V11 | Order states distinguish QUOTED, PAYMENT_PENDING, PAYMENT_UNKNOWN, PAID, DELIVERING, DELIVERED, PAYMENT_FAILED, DELIVERY_FAILED and RECONCILIATION_REQUIRED; illegal transitions are refused; events are append-only. | `packages/domain/src/order.ts`; `ledger.test.ts`. |
| V12 | One signed authorization maps to one order and is settled at most once, including under replay and concurrent retries; a timeout is recorded as unknown, never as success or failure. | `checkout.test.ts` "replayed", "concurrently", "settle timeout", "dropped settle connection". |
| V13 | Quote terms cannot change after issue: database triggers refuse updates and deletes, the order stores the terms hash, and a mismatch is detected on read. | `apps/api/src/db.ts`; `checkout.test.ts` "keeps quote terms immutable"; `ledger.test.ts` "detects terms that were altered". |
| V14 | Data is labelled LIVE, CACHED, HISTORICAL or FIXTURE by the transport that produced it; a failed live source yields CACHED only when allowed and otherwise an error; nothing falls back to fixtures. | `apps/api/src/adapters/transport.ts`; `transport.test.ts`. |
| V15 | Economics show price, measured usage and costs, and estimated allowances in separate lists with separate totals; testnet and fixture payments are reported as not revenue. | `apps/api/src/economics/receipt.ts`; `checkout.test.ts` last test. |
| V16 | The whole pipeline runs offline from recorded real data with no keys: `npm run start:offline`, then `npm run demo -- IFFx --buy`. | `artifacts/evidence/demo-run-*.json` (data HISTORICAL, synthesis FIXTURE, rail FIXTURE, all stated in the transcript). |
| V17 | In a real browser, the golden path and two failure paths behave as claimed: a gate-rejected draft is never offered for sale; a delivered Brief on screen is a rendering of the delivered JSON and its order carries the terms hash the buyer saw; an unknown payment delivers nothing and completes after reconciliation with one wallet signature. | `tests/e2e/golden-path.spec.ts` (`npm run test:e2e`; offline configuration, so data HISTORICAL, synthesis and rail FIXTURE). |

## Partial

| # | Claim | What exists | What is missing |
| --- | --- | --- | --- |
| P1 | "An AI investigator researches the event and writes the Brief." | The Claude tool-use loop, prompts, structured output and usage metering are implemented (`apps/api/src/research/model.ts`). | It has **not been run against the live model**: no `ANTHROPIC_API_KEY` was available during this build. Every Brief produced so far was written by the deterministic test double and is labelled `MODEL: FIXTURE`. No claim about Brief quality is made. |
| P2 | "Measured model cost per Brief." | Token usage is recorded per call and priced at list rates. | No real usage has been measured yet (see P1). The receipts so far show no measured model cost, and say so. |
| P3 | "Payments settle on X Layer through the OKX facilitator and are verified on-chain." | The OKX facilitator client is wired with `syncSettle`, and the independent receipt check and `authorizationState` reconciliation are implemented. | **No real settlement has been performed.** All payment tests use a local facilitator double that verifies real EIP-3009 signatures but never touches a chain; those orders are labelled `FIXTURE` rail and "not revenue". |

## Blocked

| # | Item | Exact blocker |
| --- | --- | --- |
| B1 | Smallest documented OKX test payment (mock merchant). | The OKX client SDK cannot parse the mock merchant's challenge (SPONSOR_FEEDBACK SF-1), and no faucet-funded buyer wallet exists yet. |
| B2 | Bullseye's endpoint settling through the real OKX facilitator on X Layer testnet. | Needs `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` from the OKX developer portal, a `PAY_TO_ADDRESS`, and a buyer funded from the X Layer faucet. Without credentials the OKX SDK cannot initialise (SF-4), so the server answers 503 rather than issuing a challenge. |
| B3 | Listing on OKX AI as an A2MCP pay-per-call service. | Needs a public HTTPS domain and ASP registration; not attempted. |
| B4 | Demand evidence. | No interviews or usability sessions have been run. `docs/DEMAND.md` contains the plan and an empty results table. |

## Not claimed

Guaranteed alpha or profit · investment advice · autonomous trading · customer revenue · that
testnet or fixture payments are revenue · that estimated contribution is profit · real-time
detection (no latency has been measured; the detector polls) · comprehensive market coverage
(one signal type, one issuer, one chain) · that a content hash proves a source was truthful (it
proves the Brief and the stored responses have not changed) · marketplace approval.

## The strongest honest statement today

"Bullseye detected this rebase from the issuer's public record, confirmed it independently
against X Layer contract state, and can take the result through a budgeted investigation, a
deterministic publication gate, an x402 purchase built on the OKX SDK and a delivery receipt.
The live model run and a real testnet settlement are wired but have not been executed yet."
