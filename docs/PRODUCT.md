# Product

**Bullseye — autonomous intelligence for tokenised markets.**
Track: OKX Dev Day 2026, *Build a Company* (agent services, data and API services), using X Layer
and tokenised-stock reference data.

## The job

"Tell me what materially changed, investigate it enough that I can trust the summary, show me the
evidence, and let my software consume the result."

For: teams and agents that integrate tokenised equities — collateral and lending, wallets,
accounting and tax, data products, research desks.

## What is sold

A **Bullseye Brief**: a short, evidence-backed note on one event, delivered as one JSON document
(`bullseye.brief/v1`) that the web app renders for people and agents read directly. It states
what happened, why it may matter operationally, what the chain shows, confidence, unknowns,
conflicts and limitations. It never recommends buying, selling or holding anything.

Pay per Brief over x402. The free feed shows that an event happened and where it came from; the
free preview shows the headline, confidence and counts; the findings are behind the payment.

## The first Brief: rebase verification on X Layer

xStocks reinvest dividends by raising a per-token multiplier: every holder's balance changes and
no `Transfer` is emitted. Bullseye detects the issuer's corporate action, confirms the change
against the X Layer contract either side of the effective time, pins the activation block, and
adds reserves, reference price, trading status and supply.

## Not the product

A chatbot, a trading agent, a portfolio dashboard, a marketplace, escrow, or a token. OKX AI
supplies the marketplace and payment rails; xStocks supplies the raw data. Bullseye's work is
detection, bounded investigation, verification, packaging and honest delivery.

## What is unproven

One live-model Brief exists: `brf_a790c648a87d52dd` (QSRx, 2026-09-18, all data LIVE). Its
investigation made 4 model calls with a measured model cost of $0.071725 as billed, against a
$0.60 ceiling (`artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`). That is one run. It
is not an average and says nothing about other events or other routed models.

Still unproven: whether anyone will pay for this signal type (see `DEMAND.md`), how good a
live-model Brief is (see `EVALS.md`), and the price. The architecture is built so that the signal
type can change without touching the gate, the ledger, the checkout or the economics.
