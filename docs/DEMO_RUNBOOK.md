# Demo runbook (3:30)

Two ways to run it. Say which one you are running at the start; the screen says it too.

| Mode | Command | Data | Synthesis | Rail | Needs |
| --- | --- | --- | --- | --- | --- |
| **A · Live** | `npm run dev` | LIVE | Claude (live) | OKX x402, X Layer testnet | `.env` with Anthropic key, OKX portal keys, `PAY_TO_ADDRESS`; a faucet-funded buyer |
| **B · Offline fallback** | `npm run start:offline` + `npm run dev:web` | HISTORICAL (recorded 18 Sep 2026) | FIXTURE | FIXTURE | nothing |

Mode B exists so that a network or sponsor outage cannot sink the demo. It is honest about what it
is: real recorded source data, a template synthesiser, and a payment rail that moves no funds.
Do not describe a Mode B run as a live investigation or a testnet payment.
A recorded Mode B run is in `artifacts/evidence/demo-run-*.json`. **A recorded Mode A run does not
exist yet** (see `CLAIM_LEDGER.md` P1, P3, B2); capture one with `npm run demo -- <SYMBOL> --buy`
and a screen recording as soon as the credentials are in place.

## Pre-flight (10 minutes before)

```bash
npm run spike            # every line PASS except the two that need credentials you do not have
npm test                 # green
npm run detect           # confirm there is a rebase on X Layer in the last 96 h; pick the symbol
curl -s localhost:4402/api/health   # data mode, synthesis ready, rail ready
```

If `detect` finds nothing in the last 96 hours, use Mode B and say so. Do not widen the window to
make an old event look fresh.

## Script

| Time | Screen | Say | Do |
| --- | --- | --- | --- |
| 0:00–0:20 | Feed, radar | "Tokenised markets are becoming machine-readable, but the intelligence around them is fragmented. Bullseye is an intelligence desk that turns market events into products humans and agents can buy." | Point at the data-mode badge. |
| 0:20–0:50 | Feed | "This is a real event: the issuer raised this xStock's balance multiplier for a dividend. Every holder's balance on X Layer changed, with no Transfer event. Here is when it took effect, when we saw it, and where it came from." | Click **Scan sources**, lock the card. |
| 0:50–1:35 | Investigation | "The investigation runs under a hard budget. You are watching tool calls and evidence arrive, not reasoning: the issuer's record, then the X Layer contract a minute before, a minute after, and now." | Click **Investigate**. Open one on-chain evidence row. Point at the budget bar. |
| 1:35–2:05 | Brief | "Code, not the model, decides whether this is published: every number must trace to evidence, failed checks must be disclosed, no advice. Here is the finding, the confidence, and what we do not know." | Show the gate result, then Unknowns. |
| 2:05–2:40 | Purchase | "A separate buyer pays over x402 using the OKX SDK. The quote is frozen and hashed before approval." | Click **Pay**, or run `npm run buy -- latest` in a terminal as the agent buyer. Show the state ladder and the transaction on the explorer (Mode A only). |
| 2:40–3:05 | Console | "Price, measured usage and cost, and estimated allowances are kept apart. This was testnet: it is not revenue, and the contribution figure is an estimate." | Point at each block. |
| 3:05–3:20 | Reconciliation | "When the facilitator times out we say unknown, deliver nothing, and a retry cannot charge twice. And when evidence is missing, nothing is published and nothing is sold." | Show a PAYMENT_UNKNOWN order or a REJECTED investigation (see below). |
| 3:20–3:30 | Console | "Bullseye does not sell another AI. It sells verified intelligence, produced and delivered by an AI-native business." | |

## Showing the failure cases

On the fixture rail only (`/api/_fixture/control` does not exist on the OKX rails):

```bash
# payment outcome unknown, then reconciled
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"facilitatorMode":"settle_timeout"}'
#   ... pay in the UI: the order stops at PAYMENT_UNKNOWN ...
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"facilitatorMode":"ok","reconcileOutcome":"used"}'
#   ... click "Reconcile from chain": PAID, then DELIVERED, with exactly one settle call

# a draft the gate refuses
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"synthesisBehaviour":"unevidenced_number"}'
```

In Mode A the honest adverse case is the budget: start the API with `BUDGET_MAX_TOOL_CALLS=3` and
the investigation stops with `BUDGET_TOOL_CALLS_EXCEEDED`, publishes nothing and sells nothing.

## If something breaks

| Symptom | What it means | What to do |
| --- | --- | --- |
| Badge says CACHED | The live source failed; you are looking at the last good response. | Say so and continue; the gate caps confidence at MEDIUM. |
| Banner "payment rail unavailable" | OKX facilitator credentials missing or rejected. | Switch to Mode B. Do not present the fixture rail as OKX. |
| Investigation STOPPED: MODEL_UNAVAILABLE | No model key, or the provider is down. | Switch to Mode B. |
| Order stuck at PAYMENT_UNKNOWN | The outcome is genuinely unknown. | Click "Reconcile from chain". This is the product working. |
