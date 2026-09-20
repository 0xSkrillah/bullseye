# Demo run sheet · 3 minutes

For the owner, who records and uploads. Target **3:00–3:30**, inside the required 2–4 minutes.
A screen recording of the working product, not slides.

Mechanics of the buyer flow — what each screen does, what the recovery path looks like — are in
[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). This file is the shot list and the script.

## Before you record

- [ ] Decide **local or deployed** and say which on screen. Deployed is stronger; local is fine if
      the Situation Room has not been pushed.
- [ ] Have the QQQx Brief open in a tab: `brf_0d55468f0c4045ef`.
- [ ] **Close anything with a key, a seed phrase, a claim token or a raw authorization in it.**
      Wallet extension: show the confirmation dialog, never the settings or the recovery phrase.
- [ ] Recording size: 1440×900 or 1280×720. The desk has no horizontal overflow at either.
- [ ] Have the explorer page pre-loaded so it does not spin on camera.
- [ ] If you re-record a section, use an obvious cut. Do not stitch a local clip into a deployed
      sequence without saying so.

## Labels that must appear or be spoken

Say these out loud; a judge cannot infer them and getting caught rounding up is worse than the
limitation itself.

- **testnet** — every payment shown is X Layer testnet with test tokens, and is **not revenue**
- **recorded / live** — which one this footage is
- **mainnet reads** — the contract data is read from X Layer mainnet; only payments are testnet

---

## The run

### 0:00–0:20 · The problem
**Show:** a wallet or balance view where the number moved, then the absence of a `Transfer`.

> "If you hold a tokenised stock on X Layer, your balance can change with no transaction to explain
> it. The issuer reinvested a dividend by raising a multiplier — every holder's balance moved, and
> no Transfer event was emitted. If you cache balances, account in shares or price collateral, that
> is a reconciliation problem and there is nothing in your logs to reconcile against."

### 0:20–0:50 · A real event
**Show:** the desk at `/` with the QQQx event selected. Point at the effective time and the
detected time.

> "This is a real QQQx dividend rebase. Effective here, detected here — about twenty-one hours
> later, so this is a look back, not an early warning, and the desk says so. The multiplier went
> from 1.00272… to 1.00345…, a rebase of plus nought-point-零-seven-three percent."

*(Say "plus zero point zero seven three percent" — just do not round it to "nearly nothing".)*

### 0:50–1:25 · Investigation and the gate
**Show:** the investigation panel — tool calls, the cost gauge against its ceiling — then the
evidence chain with the on-chain multiplier values, then the gate result.

> "A model chose which evidence to gather, under a hard budget: cost, model calls, tool calls and
> latency are all capped before every call. But no model writes a number. Code read `multiplier()`
> on the X Layer contract either side of the effective time, found the activation block, and
> compared it with the issuer at eighteen decimals. Then a deterministic gate judged the draft
> against eleven rules — every figure has to be bound to evidence. A rejected draft publishes
> nothing and can charge nobody. This one passed."

### 1:25–2:15 · The purchase
**Show:** the paywalled Brief, the quote with **amount, network and recipient**, the wallet
confirmation, then the delivered document.

> "The report is an x402 resource on the OKX seller SDK. Here is the quote — three USD-T-zero, on
> X Layer **testnet**, to this address. The quote is immutable and hashed; one signed authorization
> is one order and settles at most once. I sign once…"

**If you have the 20 September order on screen, this is the strongest thirty seconds in the demo:**

> "…and watch this. The facilitator did not come back with a final outcome, so the order went to
> PAYMENT_UNKNOWN. Nothing was delivered while it was unknown. The desk reconciled *the same
> authorization* against the chain, found the transfer, and only then delivered. It never signs a
> second payment to clear an uncertain one — that is how you double-charge someone. This ran for
> real, on the real facilitator, on the deployed service."

**Then:** reload the page and show the report still there.

> "Reload — and the report is still mine, collected with a claim token. No second charge."

### 2:15–2:45 · One source, machine-readable, and the cost
**Show:** one evidence item with its URL, fetch time and sha256 — then the `bullseye.brief/v1`
JSON — then the receipt.

> "Every fact carries its source URL, the time it was fetched and a sha256, labelled live, cached,
> historical or fixture. The same document is JSON, so an agent buys and parses it without a human.
> And the accounting stays honest: this investigation's measured model cost against the price, with
> test payments kept out of revenue. Revenue is zero."

### 2:45–3:15 · What it is, and what it is not
**Show:** the Market Desk at `/market`, or the Situation Room at `/room` if it is deployed.

> "Bullseye is an automated intelligence desk for tokenised assets, for wallet, data and operations
> teams — and for agents that need the same answer and can pay per call. It reads live network data
> and settles payments through OKX x402 on X Layer testnet.
>
> What it is not: there is no proven demand, no mainnet payment, and the runs are counted in ones
> and twos. When the desk looks for a tradable edge it answers *no* — the sources publish no bid,
> no ask and no size, so it reports event impact only rather than inventing an opportunity. That
> answer is the deliverable."

---

## After recording

- [ ] Upload somewhere **publicly viewable**.
- [ ] Open the link **signed out**, and on **another device**. A link that only works for you is the
      single most common way a submission gets marked inaccessible.
- [ ] Keep a local copy of the recording.
- [ ] Put the URL in [SUBMISSION.md](SUBMISSION.md) §1. Until it plays signed out, there is no URL.

## Fallback, if the deployed purchase cannot be shown live

The supplied form allows an explanation and a video where a product environment is unavailable.

1. Use the **recorded** 20 September purchase and say on camera that it is recorded, with its date.
2. Show `artifacts/evidence/deployed-purchase-2026-09-20.json` and the explorer page for
   `0x30313b87…73b726`. The chain does not care when you look at it.
3. If you have to demonstrate payment recovery on the fixture rail instead of the real facilitator,
   **say "fixture rail" on camera.** Do not force a failure on the real facilitator to film it.

Never re-run a purchase just to get better footage. The wallet holds **4 test USD₮0** — one more
3.00 purchase and no more without a faucet top-up.
