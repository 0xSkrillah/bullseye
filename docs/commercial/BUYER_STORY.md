# The buyer story

Companion to `CRO_REVIEW.md`. This file is the version Bryn says out loud.

---

## 1. The 20-second explanation

> **Tokenised stocks pay dividends by quietly making everyone's balance bigger. There is no
> transaction — the number just changes. So if you keep books, your ledger and the chain disagree
> and you have to explain why. Bullseye spots the event, checks the blockchain actually did what
> the issuer said, and sells you a dated, tamper-evident record you can put in the file. Three
> dollars a report, paid by a person or by software.**

If there is time for one more sentence:

> Right now it is one issuer, one chain and test money — the machinery is real, the market is not
> proven.

### Say it this way, not that way

| Say | Not |
|---|---|
| "a record you can file" | "an evidence-backed brief over x402" |
| "the balance changed with no transaction" | "a rebase event with no `Transfer` emitted" |
| "we check the chain agrees with the issuer" | "multiplier verification against X Layer" |
| "we write down what we could not confirm" | "the publication gate enforces numeric grounding" |
| "no transaction to point at" | "transfer-log-derived balance reconstruction diverges" |

The technical words are all correct and all belong in the second minute, not the first.

---

## 2. One concrete before/after

**Grounded in a real delivered Brief**: `brf_7e0e3aabb79768ca`, order `ord_3e49405a17afe27a`,
DTE Energy xStock (DTEx), bought against the deployed service on 20 September 2026.
**The event and every figure are real. The accountant is illustrative** — no such person has been
interviewed, and this scenario is a hypothesis, not a case study.

### Before

A fund accountant closing the quarter sees the DTEx position is larger than the opening balance
plus trades. Nothing in the transaction history explains it — because there is nothing to find.
She checks the wallet, then the block explorer, then finds her way to the issuer's website, reads
that a dividend was paid as a multiplier change, and pastes a screenshot into the workpaper with a
note saying "per issuer site". Her auditor will, in March, ask what the multiplier was before, when
it changed, and how she knows the chain did it.

The screenshot cannot answer any of those. It is also a picture of a page that can be edited — the
record Bullseye read was already at **version 2**.

### After

She opens the Market Desk. Free, before paying anything:

- **every DTEx balance on X Layer grew by 0.634532%, and no transfer was emitted to show it**
- a cache holding the pre-rebase balance now **understates** the holding by 0.630532%
- applying the multiplier to a balance that already includes it **overstates** it by 0.634532%

She buys the Brief for $3.00 and files it. It contains, as real fields:

| What she needs | Field | Value |
|---|---|---|
| Why the units moved | `signal.facts.caType` | `CashDividend` |
| Gross income | `grossCashflowUsd` | 1.165 |
| Withholding | `withholdingTaxRate` | 0.3 |
| Net | `netCashflowUsd` | 0.8155 |
| The security | `signal.asset.isin` | CH1580494586 |
| Before / after | `multiplierOld` / `multiplierNew` | 1 → 1.006345315904 |
| When the chain did it | `EV-CHAIN-ACTIVATION` | block 71008764, activation lag **0s** |
| Independent confirmation | `CHK-AFTER-MATCHES-NEW` | PASS — on-chain 1.006345315904 vs issuer 1.006345315904 |
| What is *not* established | `CHK-REBASE-SIZE-PLAUSIBLE` | **UNKNOWN** — no reference price was collected |
| Proof it has not been edited | `brief.contentHash` | sha256 over the document |

In March, the auditor's question has a one-line answer and a file behind it.

**The unglamorous part, stated:** she does this by saving a document, not by pressing a button in
her accounting system. There is no connector. The handoff is a file and a citation.

---

## 3. Three objections, answered

### "The issuer publishes all this for free. Why would I pay you?"

Correct, and we should say so first — the corporate-action record is a public, unauthenticated
endpoint, and we cite it in the Brief with its URL and hash. You are not paying for the
announcement. You are paying because (a) the issuer tells you what it *intended* and only the chain
says what *happened*, and reading `multiplier()` at the block before and after an effective time is
archival work you would otherwise do yourself; (b) the issuer's record is mutable — the one in this
Brief is version 2, and we run a check specifically for actions being cancelled or replaced —
whereas ours is hashed and dated; and (c) we write down what we could **not** confirm, which no data
feed will ever do for you.

If your auditor accepts a screenshot, you do not need us. That is a real answer, and it is one of
our kill criteria.

### "Doesn't my accounting platform already handle rebasing tokens?"

Possibly — Bitwave, Cryptio and TRES all market multi-chain reconciliation and rebasing tokens are a
known category problem. Two honest distinctions. First, those tools tell you **what to book**; they
do not hand you a dated evidence bundle explaining **why**, with the unverified parts named.
Second, we do not know whether any of them covers this issuer on this chain, and neither, probably,
do you — that is worth ten minutes of your time to check whatever you decide about us. If they do
both, they are the better product and we should hear that.

### "You only cover X Layer, and I hold these on Solana."

That is the strongest objection and the honest answer is: then we cannot help you today. xStocks'
float is about 93% on Solana. Our detector reads X Layer. The architecture separates the detector
from the gate, the ledger and the payment path — so the chain is a detector change rather than a
rewrite — but it is unbuilt, and I am not going to tell you it is a configuration flag. What I would
ask for instead is fifteen minutes: if the job is right and only the chain is wrong, that is worth
knowing before we build anything.

---

## 4. The three-minute demo, with the actual clicks

All on the deployed service, signed out, in one tab. Testnet throughout — say so once, early.

**0:00 — the problem, on the screen that shows it** (`/market`)

> "This is a tokenised Nasdaq ETF. Yesterday every holder's balance grew by seven ten-thousandths
> of a percent, and there is no transaction anywhere that shows it. If you keep books, you now have
> a number you cannot explain."

Point at the headline, then at the line directly beneath it naming who the screen is for.

**0:35 — the two ways it goes wrong** — scroll to *"The event, and the two ways a book gets it wrong"*.

> "We do the arithmetic for free. This one is what a stale cached balance now understates by. This
> one is what you overstate by if you apply the multiplier to a balance that already includes it.
> Those are the two mistakes, and they are different numbers."

**1:05 — what is for sale, and what it is for** — the offer panel, right of the headline.

> "Three dollars. Not for the announcement — the issuer publishes that free. For the chain reads
> either side of the effective time, the block it activated at, and a hashed record that does not
> change when the issuer revises theirs."

**1:30 — buy it.** Click **View this brief** → the immutable quote appears.

> "The terms are frozen and hashed before I approve anything — amount, network, who is paid, and the
> hash of the exact document I am buying. If the payment cannot be confirmed, nothing is delivered
> and pressing it again cannot charge me twice."

Pay. Show the delivered Brief.

**2:10 — the part nobody else ships.** Scroll to the checks.

> "Eight checks passed. This one says UNKNOWN — we could not test whether the rebase size matches
> the cash dividend, because no reference price was collected. We sell you the gap as well as the
> answer. A gate refuses to publish a brief whose numbers are not bound to collected evidence."

**2:35 — the agent buys it too.**

> "Same document, same content hash, bought by software over x402 — the endpoint answers 402 with
> the terms in a header. That purchase settled against this host on chain an hour before this
> recording."

**2:50 — close, honestly.**

> "One issuer, one chain, test money, and nobody outside this project has bought one yet. The
> machinery is real. The market is the next thing to prove, and I know exactly which five
> conversations prove it."

**Do not say:** "traders", "profit", "alpha", "opportunity", or any figure for money saved. The
screen itself says *No transactable opportunity* under a trading heading — if a judge asks, that is
a feature: the desk refuses to invent an edge it cannot evidence.
