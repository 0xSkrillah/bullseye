# Bullseye

**Autonomous intelligence for tokenised markets.** Bullseye detects a real event in a tokenised
asset, investigates it under a hard budget, checks the evidence against X Layer, publishes only
what a deterministic gate allows, and sells the result to people and agents over x402.

```
SIGNAL → INVESTIGATE → VERIFY → PUBLISH → PURCHASE → DELIVER → MEASURE ECONOMICS
```

OKX Dev Day 2026 · track: **Build a Company** (agent services, data and API services) · X Layer ·
tokenised stocks (xStocks).

## For a judge, in one minute

| | |
| --- | --- |
| **What** | An automated desk that catches dividend rebases on tokenised stocks — where a holder's balance changes on X Layer with **no `Transfer` event** — proves them against the contract, and sells the evidence-backed report. |
| **For whom** | Wallet, custody, data and treasury-operations teams who must reconcile those balance changes, and **AI agents** that need the same answer machine-readably and can pay per call. |
| **Try it** | https://bullseye-production-5d0c.up.railway.app — start at `/`, pick an event, open its Brief, inspect the evidence, then the checkout. `/market` reads one event as money. |
| **Integration URL** | `POST /api/v1/briefs/latest` — an x402 resource on the OKX seller SDK. An unpaid call answers `402` with a `PAYMENT-REQUIRED` header: `exact` / `eip155:1952` / `3000000` to the quoted pay-to address. That is OKX's own listing self-test, passing on the deployed address. |
| **Demo video** | Not yet recorded. There is no URL, and this file will not pretend there is one. |
| **One proof** | On 20 September the unattended desk published a QQQx Brief at 10:31:50Z and it was bought from the deployed address at 18:38 — and the payment went **`PAYMENT_UNKNOWN` and recovered to `PAID` without a second charge**, on the real OKX facilitator. [`artifacts/evidence/deployed-purchase-2026-09-20.json`](artifacts/evidence/deployed-purchase-2026-09-20.json), ledger V53. |
| **Limits** | Testnet only; three settlements, all made by the project itself; no stranger has bought anything; no demand evidence; runs counted in ones and twos. The full list is [docs/SUBMISSION.md](docs/SUBMISSION.md) §5 and the ledger below. |

> **Read this first.** [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) lists what is verified, what is
> only partly done and what is blocked. On 18 September 2026 the whole path ran live once: a real
> xStocks event, X Layer reads, a model investigation through OpenRouter, a Brief published by the
> gate, and a purchase settled through the OKX facilitator on X Layer **testnet** and confirmed
> on-chain. That was one investigation and one settlement. Testnet payments are not revenue, and
> nothing here is evidence of demand. That purchase was made by the agent buyer against a server
> on localhost. A second one has since been made **from the deployed address**: on 20 September a
> QQQx Brief was bought there for 3 testnet USD₮0 and delivered, and the payment was recovered from
> an unknown outcome before delivery (CLAIM_LEDGER V53). The owner reports making that one from the
> browser with a wallet extension; the chain and the desk's public record show the settlement and
> the delivery, not which client signed (V34, P6). A third has since been made by the **agent
> buyer** against the same deployed address — a DTEx Brief, which also answered
> `payment_outcome_unknown` first and was recovered by re-sending the same authorization (V54). That
> is three settlements, all on testnet, all made by the project itself. Nobody outside the project
> has bought anything, and revenue is zero.

## What it does

xStocks reinvest dividends by raising a per-token **multiplier**: every holder's balance on X
Layer changes and no `Transfer` event is emitted. Anyone who caches balances, accounts in shares
or prices collateral needs to know that it happened, when, by how much, and whether the chain
agrees with the issuer.

1. **Detect.** A pure function over the issuer's public corporate-action history flags multiplier
   changes on assets deployed on X Layer. Same inputs, same signal ids.
2. **Investigate.** A model chooses which evidence tools to call; a governor enforces ceilings on
   cost, model calls, tool calls and latency before every call. The model is reached through
   OpenRouter's Auto Router at a chosen cost tier, under a hard price cap, and each call is
   costed at what the provider reports charging. Every fact is an evidence item
   written by code from a schema-validated response, with its URL, fetch time, sha256 and a
   LIVE / CACHED / HISTORICAL / FIXTURE label.
3. **Verify.** Code reads `multiplier()` on the X Layer contract 60 s before the effective time,
   60 s after, and at the head, bisects for the activation block, and compares with the issuer at
   18-decimal precision. Reserves, price, trading status and supply are cross-checked too.
4. **Publish, or not.** A deterministic gate rejects drafts with missing or stale evidence,
   undisclosed conflicts, inflated confidence or investment-advice language, and any figure that
   is not bound to evidence: in a claim, every number must match one of the claim's declared
   quantities by unit, sign and rounding; counts are computed by the gate; a small number gets no
   pass for being small. A rejected draft creates no Brief and nothing can be charged. If the
   issuer later cancels or replaces the action, the Brief is withdrawn from sale.
5. **Sell.** `GET /api/v1/briefs/:id` is an x402 resource built on the OKX seller SDK. Quotes are
   immutable and hashed. One signed authorization is one order and settles at most once.
   A timeout is `PAYMENT_UNKNOWN`: nothing is delivered and a retry cannot charge twice.
   The buyer, browser or agent, chooses a claim token before signing and sends it with the
   payment. After a lost response, a reload or a crash, the same authorization is sent again or
   the order is collected with the token (`GET /api/orders/:id/delivery`); neither can become a
   second purchase, and an order is answered to nobody but its buyer and the operator.
6. **Deliver and account.** The buyer receives one JSON document (`bullseye.brief/v1`), which is
   also what the web app renders. The receipt keeps price, measured cost and estimated allowances
   apart. Testnet payments are never revenue; estimated contribution is never profit.

### The Market Desk

`/market` reads one verified event as money, for a customer deciding whether it is still worth
anything: the balance change in exact decimals, the two ways to get it wrong, the same event valued
at the issuer's reference price, and then everything the desk cannot tell you. Its answer for every
event so far is **no transactable opportunity**, and that is the finding. No source Bullseye may
read publishes a bid, an ask, a size or an expiry, so no spread can be quoted; the costs that would
be netted against one are unknown, and an unknown cost is not zero. Figures are computed by integer
arithmetic on `BigInt` at 36 decimal places, never in floating point and never by a model, and each
carries its label before its value, its inputs, its limitations, and — when an input is missing or
stale — the names of what is missing in place of a number. Read-only: no brokerage, no execution,
no leverage, no key custody, no new contract. [docs/MARKET_DESK.md](docs/MARKET_DESK.md).

A rebase changes how many tokens a holder has. It is not a price return, and applying a multiplier
to a balance that already includes it is the likeliest way to be wrong about one of these events —
on the recorded VGKx rebase that error is +1.116517183338 % against a rebase of +0.1741971579 %.

Run on 18 September 2026 over the issuer's 50 most recent corporate actions, the detector flagged
fifteen dividend rebases on X Layer deployments, six of them effective that day. For the two that were
investigated and recorded (IFFx and QSRx) the chain held the old multiplier at 00:29:00Z, the new
one at 00:31:00Z, and activation landed in the block stamped 00:30:00Z, the issuer's effective second.
The unmodified source responses are in `artifacts/recorded/`.

### The first live run

| Step | What happened | Evidence |
| --- | --- | --- |
| Signal | QSRx dividend rebase, multiplier 1 → 1.0066516577977895, effective 2026-09-18T00:30:00Z, all data LIVE | `artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json` |
| Investigation | 10 tool calls, 9 of 9 consistency checks passed; 4 model calls through `openrouter/auto` (medium tier), routed to `deepseek/deepseek-v4-pro` and `openai/gpt-5.6-terra` | same |
| Gate | The first draft did not match the schema and was **rejected**; the one permitted revision passed all 11 rules and was published as `brf_a790c648a87d52dd` | same |
| Model cost | **$0.071725**, as billed by the provider, against a $0.60 ceiling. OpenRouter's own ledger for the key agrees to within rounding ($0.0000013) | same transcript; ledger reconciliation in `artifacts/integration/model-check-2026-09-18T21-57-37-431Z.json` |
| Purchase | An agent buyer signed one authorization for 3,000,000 base units of testnet USD₮0. The facilitator answered `timeout` after 1.9 s, so the order went to `PAYMENT_UNKNOWN` and nothing was delivered. The buyer re-sent the same authorization, the transfer was found on-chain, and the Brief was delivered | delivery: `artifacts/evidence/delivery-ord_8a2102084ad69dab.json`; the event trail is in the order record (`GET /api/orders/ord_8a2102084ad69dab`), not in an artifact |
| Settlement | [`0xa2f4058c…f28a`](https://www.oklink.com/x-layer-testnet/tx/0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a), X Layer testnet block 41310183. Buyer balance 10 → 7, seller 0 → 3: one transfer. `npm run verify-payment` reads the chain directly: VERIFIED | `artifacts/integration/payment-ord_8a2102084ad69dab.json` |
| Receipt | Price $3.00, **not revenue** (testnet). Measured cost $0.071725. Estimated allowances $0.45. Estimated contribution $2.478275, an estimate that excludes labour, hosting, acquisition, overhead and tax | `GET /api/orders/ord_8a2102084ad69dab` on the desk that ran it; not saved as an artifact |

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
| `OPENROUTER_API_KEY` | the investigator's model, through OpenRouter's Auto Router (`OPENROUTER_COST_TIER`, default `medium`; price caps `OPENROUTER_MAX_PRICE_PROMPT` / `_COMPLETION`). `ANTHROPIC_API_KEY` only if `SYNTHESIS_PROVIDER=anthropic` |
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | OKX x402 facilitator ([developer portal](https://web3.okx.com/onchainos/dev-portal)) |
| `PAY_TO_ADDRESS` | wallet that receives payments |
| `BUYER_PRIVATE_KEY` | a throwaway **testnet** key for the agent buyer (with or without `0x`), funded with test USD₮0 from the [X Layer faucet](https://www.okx.com/xlayer/faucet/xlayerfaucet) |

```bash
npm run spike            # checks xStocks, X Layer, the OKX mock merchant and the seller rail; writes artifacts/integration/
npm run wallet           # is the buyer funded? prints its address and testnet balances, never the key
npm run model-check      # one tiny metered model call, reconciled against the provider's own ledger
npm run dev              # API + UI. Leave it running; the commands below talk to it from a second terminal
npm run detect           # what the detector sees right now
npm run market-probe     # what the permitted sources really publish for one asset, and what they do not
npm run demo -- QSRx     # drive the golden path for one flagged ticker and save a transcript (add --buy to purchase)
npm run buy -- latest    # an agent discovers, pays for and receives the newest Brief; prints the order id
npm run verify-payment -- ord_8a2102084ad69dab   # re-checks that order against X Layer without trusting the API
npm run buy -- --collect ord_…   # fetch a purchase again with its claim token; signs nothing, needs no key
npm run test:e2e         # Playwright: golden path, recovery and failure paths in a browser (offline configuration)
                         # first run: `npx playwright install chromium`, or set PW_CHANNEL=msedge|chrome to use an installed browser
```

On Windows, clone into a short path (or set `git config --global core.longpaths true`): the
recorded source responses have long file names, and the longest tracked path is 121 characters.

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
| Agent access | `GET /api/v1/catalog` for discovery, `GET` or `POST /api/v1/briefs/:id` to buy, and `/api/v1/briefs/latest` as one stable paid address for marketplace listings ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); deployed at https://bullseye-production-5d0c.up.railway.app, not listed yet); `scripts/buy-brief.ts` is a reference buyer on the OKX client SDK whose spend limits apply to the terms it signs (network, token contract, base-unit amount), not to the seller's stated price |
| First settlement | order `ord_8a2102084ad69dab`, tx `0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`, X Layer testnet block 41310183, seller `0xa8bcd760a7c280c05090431c6afdf15df324d64a` |
| Contracts deployed | none: Bullseye uses the sponsor's payment rails and deploys no escrow or token |

Seven documentation and SDK findings, each with a reproduction, are in
[docs/SPONSOR_FEEDBACK.md](docs/SPONSOR_FEEDBACK.md).

## Repository

```
packages/domain    Zod schemas, order state machine, canonical hashing
apps/api           adapters · signals · evidence · research · gate · commerce · economics · market · http
apps/web           React/Vite desk built from docs/design-system; src/market is the Market Desk at /market
scripts            spike · record · detect · market-probe · wallet-check · model-check · buy-brief · spend-guard · verify-payment · run-demo
tests/e2e          Playwright
artifacts          integration results · recorded source responses · demo transcripts
docs               product, architecture, data contracts, market desk, economics, evals, demand,
                   sponsor feedback, claim ledger, build provenance, demo runbook, deployment
Dockerfile         API and built web desk in one container (docs/DEPLOYMENT.md)
```

## Limits

One signal type, one issuer, one chain. A polling detector with no measured latency, reading the
issuer's 50 most recent corporate actions. The Market Desk shows no spread and no net edge for any
event, because the permitted sources publish no two-sided quote, no size and no fee schedule; that
is a limit of the data, established from live responses (`npm run market-probe`) and not worked
around. It computes no shares-backing-per-token figure either, because the issuer's supply figures
are not in one unit or scope. There is no forward tracker: an honest one needs observations
accumulated over days, and this slice does not pretend to have them. Live runs are counted in ones
and twos rather than hundreds, and settlements in twos:
no quality evaluation, no rejection rate, no measured detector recall. In the first live run the
routed endpoint did not enforce strict structured output: the first draft failed the schema and cost a revision. No
demand evidence yet ([docs/DEMAND.md](docs/DEMAND.md)). The one live Brief was first detected
21 h 29 min after the event took effect: a look back, not an early warning, and the desk labels
it so. Gate 2.0.0 has now judged live model drafts on the deployed service, and has both published
and refused (CLAIM_LEDGER V52); a handful of runs is still not a rejection rate.
The free view shows that each step of an investigation happened and what the issuer announced;
what the chain showed, each check's verdict and per-run cost are in the Brief or behind a
read-only viewer token; a buyer reads one order with its claim token; the routes that start paid
work need an operator token anywhere but localhost. Bullseye Briefs describe observed events and their evidence; they are not
investment, legal or tax advice.

## Licence

MIT. Third-party packages and data sources are listed in
[docs/BUILD_PROVENANCE.md](docs/BUILD_PROVENANCE.md).
