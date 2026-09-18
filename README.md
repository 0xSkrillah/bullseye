# Bullseye

**Autonomous intelligence for tokenised markets.** Bullseye detects a real event in a tokenised
asset, investigates it under a hard budget, checks the evidence against X Layer, publishes only
what a deterministic gate allows, and sells the result to people and agents over x402.

```
SIGNAL → INVESTIGATE → VERIFY → PUBLISH → PURCHASE → DELIVER → MEASURE ECONOMICS
```

OKX Dev Day 2026 · track: **Build a Company** (agent services, data and API services) · X Layer ·
tokenised stocks (xStocks).

> **Read this first.** [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) lists what is verified, what is
> only partly done and what is blocked. Today: live xStocks data and X Layer reads are verified;
> the investigator's live-model run and a real settlement through the OKX facilitator are built
> but **have not been executed**, because they need credentials that were not available yet.
> Everything runs end to end offline from recorded real data, labelled as such.

## What it does

xStocks reinvest dividends by raising a per-token **multiplier**: every holder's balance on X
Layer changes and no `Transfer` event is emitted. Anyone who caches balances, accounts in shares
or prices collateral needs to know that it happened, when, by how much, and whether the chain
agrees with the issuer.

1. **Detect.** A pure function over the issuer's public corporate-action history flags multiplier
   changes on assets deployed on X Layer. Same inputs, same signal ids.
2. **Investigate.** A model chooses which evidence tools to call; a governor enforces ceilings on
   cost, model calls, tool calls and latency before every call. Every fact is an evidence item
   written by code from a schema-validated response, with its URL, fetch time, sha256 and a
   LIVE / CACHED / HISTORICAL / FIXTURE label.
3. **Verify.** Code reads `multiplier()` on the X Layer contract 60 s before the effective time,
   60 s after, and at the head, bisects for the activation block, and compares with the issuer at
   18-decimal precision. Reserves, price, trading status and supply are cross-checked too.
4. **Publish, or not.** A deterministic gate rejects drafts with missing or stale evidence,
   numbers that are not in the cited evidence, undisclosed conflicts, inflated confidence or
   investment-advice language. A rejected draft creates no Brief and nothing can be charged.
5. **Sell.** `GET /api/v1/briefs/:id` is an x402 resource built on the OKX seller SDK. Quotes are
   immutable and hashed. One signed authorization is one order and settles at most once.
   A timeout is `PAYMENT_UNKNOWN`: nothing is delivered and a retry cannot charge twice.
6. **Deliver and account.** The buyer receives one JSON document (`bullseye.brief/v1`), which is
   also what the web app renders. The receipt keeps price, measured cost and estimated allowances
   apart. Testnet payments are never revenue; estimated contribution is never profit.

Run on 18 September 2026 over the issuer's 50 most recent corporate actions, the detector flagged
fifteen dividend rebases on X Layer deployments, six of them effective that day. For the two we
investigated and recorded (IFFx and QSRx) the chain held the old multiplier at 00:29:00Z, the new
one at 00:31:00Z, and activation landed in the block stamped 00:30:00Z, the issuer's effective second.
The unmodified source responses are in `artifacts/recorded/`.

## Run it

Requires Node ≥ 22.13 (developed on 26.7). No native dependencies.

```bash
npm ci
npm test                 # unit and integration tests; no network, no keys
```

**Offline, no keys** — recorded real data (HISTORICAL), template synthesiser and a payment rail
that moves no funds (both FIXTURE), all labelled on screen:

```bash
npm run start:offline    # API on :4402
npm run dev:web          # UI on :5173
npm run demo -- IFFx --buy   # or drive the golden path from the terminal
```

**Live** — copy `.env.example` to `.env` and fill in:

| Variable | For |
| --- | --- |
| `ANTHROPIC_API_KEY` | the investigator's model |
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | OKX x402 facilitator ([developer portal](https://web3.okx.com/onchainos/dev-portal)) |
| `PAY_TO_ADDRESS` | wallet that receives payments |
| `BUYER_PRIVATE_KEY` | a throwaway **testnet** key for the agent buyer, funded from the [X Layer faucet](https://www.okx.com/xlayer/faucet/xlayerfaucet) |

```bash
npm run spike            # checks xStocks, X Layer, the OKX mock merchant and the seller rail; writes artifacts/integration/
npm run dev              # API + UI
npm run detect           # what the detector sees right now
npm run buy -- latest    # an agent discovers, pays for and receives the newest Brief
npm run verify-payment -- ord_…   # re-checks a payment against X Layer without trusting the API
npm run test:e2e         # Playwright: golden path and failure paths in a browser (offline configuration)
```

If a key is missing, Bullseye says so and stops: the API answers `503 payment_rail_unavailable`
rather than issuing a challenge it cannot settle, and an investigation ends `MODEL_UNAVAILABLE`
rather than switching synthesiser. It never substitutes fixtures for live data.

## Integration with OKX and X Layer

| | |
| --- | --- |
| Payments | x402 v2, `exact` scheme, via `@okxweb3/x402-core` 0.1.0, `@okxweb3/x402-evm` 0.2.1 (`x402ResourceServer`, `ExactEvmScheme`, `OKXFacilitatorClient` with `syncSettle`) |
| Networks | X Layer testnet `eip155:1952` for payments; X Layer mainnet `eip155:196` for reading xStock contracts |
| Settlement asset | the SDK's default for the network (testnet `USD₮0` `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`) |
| Contracts read | xStock tokens on X Layer, e.g. IFFx `0xdfae653d721d8cbfb7ff7ab1dc56693cdfb480f5`, QSRx `0xc6437a260bf2b7e9d9e402b2ef7e9a84d3622046` |
| Agent access | `GET /api/v1/catalog` for discovery, `GET /api/v1/briefs/:id` to buy; `scripts/buy-brief.ts` is a reference buyer on the OKX client SDK with spend guards |
| Contracts deployed | none: Bullseye uses the sponsor's payment rails and deploys no escrow or token |

Six documentation and SDK findings, each with a reproduction, are in
[docs/SPONSOR_FEEDBACK.md](docs/SPONSOR_FEEDBACK.md).

## Repository

```
packages/domain    Zod schemas, order state machine, canonical hashing
apps/api           adapters · signals · evidence · research · gate · commerce · economics · http
apps/web           React/Vite desk built from docs/design-system
scripts            spike · record · detect · buy-brief · verify-payment · run-demo
tests/e2e          Playwright
artifacts          integration results · recorded source responses · demo transcripts
docs               product, architecture, data contracts, economics, evals, demand,
                   sponsor feedback, claim ledger, build provenance, demo runbook
```

## Limits

One signal type, one issuer, one chain. A polling detector with no measured latency. No demand
evidence yet ([docs/DEMAND.md](docs/DEMAND.md)). No live-model Brief and no real settlement yet.
The desk endpoints have no authentication. Bullseye Briefs describe observed events and their
evidence; they are not investment, legal or tax advice.

## Licence

MIT. Third-party packages and data sources are listed in
[docs/BUILD_PROVENANCE.md](docs/BUILD_PROVENANCE.md).
