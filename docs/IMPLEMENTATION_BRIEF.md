# IMPLEMENTATION_BRIEF.md --- Bullseye

## Objective

Build Bullseye, the autonomous intelligence desk for tokenised markets.

Golden vertical slice:
`real/sourced event → detect → bounded investigation → evidence → publication gate → Bullseye Brief → paid access → delivery → economics`.

Primary track: OKX AI. X Layer and RWA/reference data support the
workflow.

## Mandatory constraints

-   Read final event rules, repo instructions and HANDOFF before
    editing.
-   Validate risky external integrations before UI polish.
-   Never claim an integration, payment, data source or test works
    without evidence.
-   Strict schemas at every external/model boundary.
-   Persist order/payment states durably.
-   Never silently replace live data with fixtures.
-   AI may investigate/synthesise; deterministic code owns publication
    and payment state.
-   No investment advice or trading.
-   Build one vertical slice before breadth.
-   Keep secrets out of source and provide `.env.example`.

## Acceptance

1.  One genuine RWA/reference response contributes to a SignalEvent.
2.  Detector output is reproducible.
3.  Investigator produces strict structured output under a configured
    budget.
4.  Quantitative claims map to EvidenceItem IDs.
5.  Publication gate rejects missing/stale evidence and prohibited
    advice.
6.  Human Brief and machine JSON agree.
7.  Bullseye's service completes the genuine supported OKX/X Layer
    test-payment flow where access permits.
8.  Payment states distinguish pending/unknown/paid/failure.
9.  Retries cannot create duplicate paid work.
10. Economics distinguish measured usage, estimated cost and testnet
    payment.
11. Playwright covers the golden path.
12. README and claim ledger state exact limitations.

## Non-goals

Marketplace implementation, custom escrow, trading, portfolio
optimisation, token creation, multi-chain, subscriptions, broad agent
swarms.

## Security and honesty

No private keys in prompts/logs/source. Treat payment timeout as unknown
until reconciled. Preserve immutable quote terms. Validate external
data. Label LIVE/CACHED/HISTORICAL/FIXTURE. Testnet is never revenue.
Estimated contribution is never net profit.

## Definition of done

A judge can watch a real/sourced market event become a useful
evidence-backed Bullseye Brief, purchase it through the supported test
flow, receive it, inspect payment evidence and understand delivery
economics in under 3.5 minutes.
