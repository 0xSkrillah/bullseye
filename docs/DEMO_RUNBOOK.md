# Demo runbook (3:30)

Two ways to run it. Say which one you are running at the start; the screen says it too.

| Mode | Command | Data | Synthesis | Rail | Needs |
| --- | --- | --- | --- | --- | --- |
| **A · Live** | `npm run dev` | LIVE | OpenRouter Auto Router (`openrouter/auto`, medium tier, price cap), live | OKX x402, X Layer testnet | `.env` with `OPENROUTER_API_KEY`, OKX portal keys, `PAY_TO_ADDRESS`; a buyer holding testnet USD₮0 |
| **B · Offline fallback** | `npm run start:offline` + `npm run dev:web` | HISTORICAL (recorded 18 Sep 2026) | FIXTURE | FIXTURE | nothing |

Mode B exists so that a network or sponsor outage cannot sink the demo. It is honest about what it
is: real recorded source data, a template synthesiser, and a payment rail that moves no funds.
Do not describe a Mode B run as a live investigation or a testnet payment.
A recorded Mode B run is `artifacts/evidence/demo-run-2026-09-18T19-36-43-346Z.json`.

**A recorded Mode A run exists**, from 18 September 2026 (QSRx, signal `sig_24ecf336903c1da1`):

| Artifact | What it holds |
| --- | --- |
| `artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json` | The transcript: health (data LIVE, synthesis `openrouter/auto`, rail `OKX_X402_TESTNET`), scan, signal, investigation timeline, gate, preview of `brf_a790c648a87d52dd`, the unpaid 402. |
| `artifacts/evidence/delivery-ord_8a2102084ad69dab.json` | The delivery envelope for the agent purchase that followed (`npm run buy -- latest`): quote, payment with transaction hash and block, and the Brief with its evidence, checks and gate result. |
| `artifacts/integration/payment-ord_8a2102084ad69dab.json` | `npm run verify-payment`: receipt success, quoted Transfer found, from the buyer, verdict VERIFIED. |
| `artifacts/integration/model-check-2026-09-18T21-57-37-431Z.json` | The pre-flight model call and the note reconciling spend with OpenRouter's key ledger. |
| `artifacts/integration/spike-2026-09-18T21-37-16-168Z.json` | The pre-flight live checks. |

It is one investigation and one testnet settlement. Do not quote it as a rate or a benchmark, and
do not call the testnet payment revenue. The transcript was captured without `--buy`; the purchase
was a separate command. No screen recording exists yet.

## Pre-flight (10 minutes before)

```bash
npm run wallet           # Mode A: buyer address and testnet balances; must end READY (enough USD₮0 for one Brief)
npm run model-check      # Mode A: one tiny metered model call (the recorded one was billed $0.0005055); writes artifacts/integration/model-check-*.json
npm run spike            # every line PASS except the mock-merchant test payment, which is BLOCKED (SF-1)
npm test                 # green
npm run detect           # confirm there is a rebase on X Layer in the last 96 h; pick the symbol
npm run dev              # leave it running; use a second terminal from here on
curl -s localhost:4402/api/health   # data mode, synthesis ready, rail ready
```

`npm run wallet` prints the buyer's address and balances, never the key. `npm run model-check`
reads OpenRouter's key ledger 3 s after the call; in the recorded call the ledger lagged by more
than that, so a usage
delta of 0 there is not a fault. The buyer held 7 testnet USD₮0 after the recorded purchase; one
Brief costs 3.

If `detect` finds nothing in the last 96 hours, use Mode B and say so, or show the recorded Mode A
run and say it is a recording from 18 September. Do not widen the window to make an old event look
fresh. A signal that already has a published Brief is not investigated again on the same
database: **Investigate** returns the existing investigation. Pick a signal that has not been
investigated, or start the API with a fresh `DB_PATH`.

Command forms, from a second terminal while `npm run dev` runs:

```bash
npm run demo -- QSRx             # drive the path for one flagged ticker; transcript in artifacts/evidence/ (add --buy to purchase)
npm run buy -- latest            # agent buyer: newest Brief in the catalogue; prints the order id
npm run verify-payment -- ord_8a2102084ad69dab   # needs a real order id: ord_ + 16 hex characters
```

`demo` takes an xStock ticker the detector has flagged and lists the flagged tickers if it does not
match.

## Script

| Time | Screen | Say | Do |
| --- | --- | --- | --- |
| 0:00–0:20 | Feed, radar | "Tokenised markets are becoming machine-readable, but the intelligence around them is fragmented. Bullseye is an intelligence desk that turns market events into products humans and agents can buy." | Point at the data-mode badge. |
| 0:20–0:50 | Feed | "This is a real event: the issuer raised this xStock's balance multiplier for a dividend. Every holder's balance on X Layer changed, with no Transfer event. Here is when it took effect, when we saw it, and where it came from." | Click **Scan sources**, lock the card. |
| 0:50–1:35 | Investigation | "The investigation runs under a hard budget. You are watching tool calls and evidence arrive, not reasoning: the issuer's record, then the X Layer contract a minute before, a minute after, and now." | Click **Investigate**. Open one on-chain evidence row. Point at the budget bar. |
| 1:35–2:05 | Brief | "Code, not the model, decides whether this is published: every number must be bound to evidence by unit, sign and precision, failed checks must be disclosed, no advice. The free page says what the issuer announced and what we went and checked. Here is when it happened, and when we first saw it." | Show the gate chip (it reads PUBLISH before anyone pays), "What this Brief adds", then "When". If the event is labelled Retrospective, say so: it is a look back, not an early warning. |
| 2:05–2:40 | Purchase | "A separate buyer pays over x402 using the OKX SDK. The quote is frozen and hashed before approval." | Click **Pay**, or run `npm run buy -- latest` in a terminal as the agent buyer. Show the state ladder and the transaction on the explorer (Mode A only). If the facilitator answers `timeout`, the order shows PAYMENT_UNKNOWN and the agent buyer re-sends the same authorization every 10 s, for at most 6 attempts, and exits with "not delivered" if the order has not reconciled by then: that is the 3:05 case happening live. |
| 2:40–3:05 | Console | "Price, measured usage and cost, and estimated allowances are kept apart. This was testnet: it is not revenue, and the contribution figure is an estimate." | Point at each block. |
| 3:05–3:20 | Reconciliation | "When the facilitator times out we say unknown, deliver nothing, and a retry cannot charge twice. And when evidence is missing, nothing is published and nothing is sold." | Show a PAYMENT_UNKNOWN order or a REJECTED investigation (see below). The recorded live run of 18 September contains both adverse cases without any staging: the gate rejected the model's first draft on SCHEMA and published the one permitted revision, and order `ord_8a2102084ad69dab` went PAYMENT_UNKNOWN on a facilitator `timeout` and was reconciled from the chain to PAID, then delivered once. The rejection is in the recorded transcript; the payment's chain-verified result is in the delivery envelope and the `verify-payment` artifact, and its state-by-state trail is in that run's database (see below). Say that it is one run. |
| 3:20–3:30 | Console | "Bullseye does not sell another AI. It sells verified intelligence, produced and delivered by an AI-native business." | |

## Showing the failure cases

On the fixture rail only (`/api/_fixture/control` does not exist on the OKX rails):

```bash
# payment outcome unknown, then reconciled
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"facilitatorMode":"settle_timeout"}'
#   ... pay in the UI: the order stops at PAYMENT_UNKNOWN ...
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"facilitatorMode":"ok","reconcileOutcome":"used"}'
#   ... the screen shows "Purchase in progress" and offers no quote and no Pay button.
#   Click "Check the chain again" (or "Reconcile from chain" in the console): the buyer's own
#   claim token authorises the read, the order goes PAID, then DELIVERED, and the Brief opens,
#   with exactly one settle call and one wallet signature

# a draft the gate refuses
curl -s -XPOST localhost:4402/api/_fixture/control -H 'content-type: application/json' -d '{"synthesisBehaviour":"unevidenced_number"}'
```

Recovery, which needs no fixture switch:

- **Reload after delivery.** Buy a Brief, reload the page, lock the same card: the Brief opens
  again from the claim token this browser kept. No wallet prompt and no new order.
- **Two buyers.** Buy the same Brief in a second browser profile: each console shows its own
  order, and neither can open the other's.
- **No wallet.** In a profile without a wallet extension, Pay shows the agent alternative
  (`npm run buy -- <briefId> --base <origin>`) and says that nothing was signed.
- **The agent, interrupted.** With `{"facilitatorMode":"settle_timeout"}` set, run
  `npm run buy -- latest`, stop it with Ctrl-C after its first retry, set the fixture back to
  `{"facilitatorMode":"ok","reconcileOutcome":"used"}` and run the same command again. It prints
  "resuming … Nothing new will be signed" and is delivered. `npm run buy -- --collect <orderId>`
  then fetches it once more with no key in the environment.

All of these are fixture-rail demonstrations. Say so on screen. On a real rail an unknown outcome
cannot be produced on demand: it happened once by itself (below), and that recording is the only
real-rail evidence of it.

In Mode A, the recorded live run of 18 September 2026 contains two adverse cases that nobody
staged:

- **A gate rejection.** In `artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`, step
  `investigation`, the timeline reads `MODEL_CALL write brief`, then
  `GATE Publication gate: REJECT (SCHEMA)`, then `MODEL_CALL revise brief after gate rejection`,
  then `GATE Publication gate: PUBLISH`. The first draft did not match the JSON schema (that routed
  endpoint did not enforce `strict`). The one permitted revision passed all 11 rules and became
  `brf_a790c648a87d52dd`.
- **A PAYMENT_UNKNOWN that reconciled.** Order `ord_8a2102084ad69dab`: the facilitator answered
  `timeout` 1.87 s after `settle` was called, the order went PAYMENT_UNKNOWN (22:03:39.560Z) and
  nothing was delivered. The agent buyer re-sent the same authorization, the seller found the
  Transfer of 3000000 base units in block 41310183, and the order went PAID (22:03:51.434Z), then
  DELIVERED, once. `settle` was called once and one authorization was signed.
  `artifacts/evidence/delivery-ord_8a2102084ad69dab.json` shows the result (`chainVerified: true`,
  block 41310183, explorer link) and `artifacts/integration/payment-ord_8a2102084ad69dab.json` the
  independent check (VERIFIED). The state-by-state event trail is not in those files; it is in
  that run's database, `data/live-run.sqlite`, which is git-ignored (keep its `-wal` and `-shm`
  files next to it). To show it, start the API on localhost with `DB_PATH=./data/live-run.sqlite`
  and run `curl -s localhost:4402/api/orders/ord_8a2102084ad69dab`. An order is answered only to
  its buyer or the operator; on localhost with no `OPERATOR_TOKEN` set, the operator's routes are
  open, which is why this works there and would answer `403` on a public address.

Each is one observation. No rejection rate and no timeout rate can be inferred from them.

To produce an adverse case on demand in Mode A, use the budget: start the API with
`BUDGET_MAX_TOOL_CALLS=3` and the investigation stops with `BUDGET_TOOL_CALLS_EXCEEDED`, publishes
nothing and sells nothing.

## If something breaks

| Symptom | What it means | What to do |
| --- | --- | --- |
| Badge says CACHED | The live source failed; you are looking at the last good response. | Say so and continue; the gate caps confidence at MEDIUM. |
| Banner "payment rail unavailable" | OKX facilitator credentials missing or rejected. | Switch to Mode B. Do not present the fixture rail as OKX. |
| Investigation STOPPED: MODEL_UNAVAILABLE | No `OPENROUTER_API_KEY`, the key was rejected or has no credit, no endpoint fits the price cap, or OpenRouter cannot be reached. | Run `npm run model-check` to see which. Otherwise switch to Mode B. |
| Investigation REJECTED on SCHEMA | The routed model's draft did not match the schema and the one permitted revision did not fix it. | Nothing was published and nothing can be sold. Say so, and investigate another signal or switch to Mode B. |
| Order stuck at PAYMENT_UNKNOWN | The outcome is genuinely unknown. The facilitator can answer `timeout` for a payment that lands; it did in the recorded run. | Click "Reconcile from chain", or let the agent buyer re-send the same authorization. Do not treat it as a failure and never settle again. This is the product working. |
