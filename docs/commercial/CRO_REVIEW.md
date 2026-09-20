# Commercial review: who buys a Bullseye Brief, and why

Reviewed commit: `2f7d417` (branch `claude/cro-conversion`, cut from `main`).
Deployed service inspected live: https://bullseye-production-5d0c.up.railway.app — 20 September 2026.
Delivered Brief read in full: `artifacts/evidence/delivery-ord_3e49405a17afe27a.json` (order `ord_3e49405a17afe27a`, Brief `brf_7e0e3aabb79768ca`, DTEx).

Every claim below is labelled **FACT** (observed in this repo, in a live API response, or in a
dated public source), **INFERENCE** (reasoning from those facts) or **UNKNOWN**. Nothing here is
customer evidence. No person has been interviewed. See `VALIDATION.md`.

---

## The conclusion, in one page

**Sell a per-event Evidence Brief to the person who has to explain a balance change in a set of
books that somebody else will check.**

> The **fund accountant or reconciliation analyst** at a **digital-asset fund administrator, crypto
> fund, or treasury team that holds tokenised equities** buys **one Evidence Brief for one corporate
> action** when **a token balance changes during a period with no transaction against it**, because
> they must **book the dividend gross, record the withholding, and be able to show an auditor why
> the units moved**. They use it as **the supporting document attached to the period-close or
> reconciliation workpaper**, instead of **screenshotting an issuer API page that can be revised
> later, or emailing the issuer and waiting**.

Said to a nontechnical judge:

> These tokenised stocks pay dividends by quietly making everyone's balance bigger. There is no
> transaction — the number just changes. If you keep books, that is a nightmare: your ledger says
> one thing, the chain says another, and your auditor wants to know why. Bullseye watches for those
> events, checks the blockchain actually did what the company said it would, and sells you a
> dated, tamper-evident one-page record you can file. Three dollars, paid by the report.

### Why this buyer and not the others

The product already computes, for every event, the two specific ways a book gets this wrong —
`STALE_BALANCE_ERROR` and `DOUBLE_ADJUSTMENT_ERROR` (**FACT**, `apps/api/src/market/impact.ts:144`
and `:169`; both returned live by `/api/market/sig_9045bfe981e2e6a0`). It is already a
reconciliation-integrity product. It has been presented as a trading desk, and the first screen
asked a trading question and answered "No transactable opportunity" (**FACT**, observed live).
That is the conversion defect, and it is a framing defect rather than a missing feature.

### Fallback ICP

**The integration engineer at a venue, wallet or indexer that lists an xStocks asset on X Layer**,
whose balance display or subgraph diverges from contract state after a rebase. Better product fit
(they care about X Layer specifically), weaker evidence of willingness to pay, and they are more
likely to fix it once in code than to buy a report per event (**INFERENCE**).

### The honest headline risk

**Bullseye reads X Layer. The assets are not meaningfully on X Layer.** xStocks' float is ~93% on
Solana (~$182M of ~$196M as of 19 January 2026), with BNB Chain and TON also live; X Layer did not
appear in any market-share source found (**FACT**, [Solana case study](https://solana.com/news/case-study-xstocks),
[xStocks on BNB Chain](https://xstocks.fi/us/news/xstocks-launches-on-bnb-chain)). The X Layer
deployments are real and the detector reads them (**FACT** — DTEx `totalSupply()` on X Layer is
40,042.92 against an issuer-reported all-chain total of 399,390.23), but the buyer who has this
problem at scale holds the asset on a chain Bullseye does not read. **This is the single biggest
reason the ICP above may not convert, and no copy change fixes it.** See "Kill criteria".

---

## 1. Challenging the premise

### Does the issuer already give this away free? Partly — and that is the point.

**FACT.** The Brief's own sources are two unauthenticated public endpoints:
`api.xstocks.fi/api/v2/public/corporate-actions/history` and `/public/assets/DTEx`. The corporate
action record already contains `multiplierOld`, `multiplierNew`, `changePct`, `grossCashflowUsd`,
`netCashflowUsd` and `withholdingTaxRate`. xStocks' developer docs confirm assets endpoints expose
multipliers, proof of reserves and corporate-action schedules with no authentication
([docs.xstocks.fi/developers](https://docs.xstocks.fi/developers)).

So **detecting the event is not the scarce thing.** Anyone can poll that endpoint.

What the issuer does *not* provide, and what the delivered Brief does:

| | Issuer API | Bullseye Brief |
|---|---|---|
| What the issuer *intended* | yes | yes, copied and hashed |
| Whether **X Layer actually did it** | no | `multiplier()` read at the block before and the block after the effective time |
| **Which block it activated at** | no | `EV-CHAIN-ACTIVATION` — block 71008764, lag 0s against a 900s tolerance |
| A record that **cannot be revised** | no — the record read here is `corporateActionVersion: 2`, and the desk runs a check called `CHK-ACTION-STILL-CURRENT` precisely because actions get cancelled or replaced | yes — `contentHash`, per-item `sha256` and `fetchedAt` |
| A statement of **what was not checked** | no | `CHK-REBASE-SIZE-PLAUSIBLE: UNKNOWN`, plus 4 unknowns and 5 limitations |

**INFERENCE.** The product is not selling data. It is selling *the fact that somebody independent
checked, on a date, and wrote down what they could not confirm*. That is an attestation good, and
attestation goods are bought by people whose numbers get audited — not by people who are merely
curious.

### Is transfer-based tracking actually broken?

**Careful — the repo is more honest than the pitch.** The Brief states: *"No Transfer-event log
sweep was carried out, so the absence of Transfer events around the rebase is inferred from how a
multiplier change works rather than demonstrated from logs"* (**FACT**, limitation 3 of
`brf_7e0e3aabb79768ca`). The mechanism is independently documented — Crypto.com describes the same
model for tokenised stocks: *"Your token balance equals your on-chain raw balance multiplied by the
current multiplier"*, with a 30% US withholding deducted before reinvestment and the balance
updated automatically with no cash credit
([Crypto.com help centre](https://help.crypto.com/en/articles/15431644-corporate-actions-and-dividends-of-tokenized-stocks))
— so the claim is well-founded, but the marketing line "no transfer was emitted" is an inference
from the token design, not a log sweep. **Do not let a judge hear it as a measurement.**

### Do existing vendors already solve it?

**FACT.** Bitwave, Cryptio and TRES Finance all market multi-chain reconciliation with
protocol-level transaction parsing, and rebasing-token handling is a named category problem
("a rebasing token grows your balance with no transfer") in the vendor literature
([Bitwave](https://www.bitwave.io/blog/multi-chain-reconciliation-platforms),
[Fortress Accounting](https://fortress-accounting.com/rebasing-token-accounting/)).

**UNKNOWN.** Whether any of them supports *xStocks on X Layer specifically*, and whether any
produces an auditor-facing evidence artifact rather than a ledger entry. Those are two different
jobs: a subledger tells you what to book; it does not hand you a dated, hashed record of why.
**This distinction is the commercial wedge and it is currently untested with a single human.**

### Knowing the balance vs explaining the change

A current-balance query answers "what do I hold". It does not answer "why did it change, on what
authority, and can I prove that in March". The remaining painful work is the second one
(**INFERENCE**), and the product's own unknowns and limitations sections are the part a subledger
cannot generate.

### Frequency — better than expected

**FACT.** The deployed feed held 15 detected events across 12 distinct assets when read on
20 September 2026, every one `CORPORATE_ACTION_REBASE` / `CashDividend`. This is not a rare
anomaly; it is a recurring, per-asset, roughly quarterly accounting event. **INFERENCE.** Across
the 100+ equities xStocks tokenises, a holder of a diversified book faces these continuously,
which is what makes it a close-cycle problem rather than an incident.

### Data-use rights

**UNKNOWN and flagged for the owner.** xStocks' developer docs set out no redistribution or
commercial-use terms on the page reviewed; Terms of Service are referenced but not included. A paid
deliverable derived from a public issuer API needs that checked before any real revenue. Not a
blocker for a testnet submission; a blocker before mainnet.

---

## 2. The three segments considered

| | **A. Fund accountant / fund administrator** (chosen) | **B. Venue / wallet / indexer integrator** (fallback) | **C. Lending or collateral venue risk engineer** (rejected) |
|---|---|---|---|
| Organisation | Digital-asset fund administrator, crypto fund, tokenised-asset treasury | Exchange, wallet or data pipeline listing an xStocks asset | Lending market accepting tokenised equity collateral |
| Daily user | Fund accountant, reconciliation analyst | Backend / integrations engineer | Risk engineer |
| Champion | Controller / Head of Fund Accounting | Eng lead owning balances | Head of Risk |
| Economic buyer | CFO or Head of Fund Operations | Same eng lead's tooling budget | Head of Risk |
| Trigger | Period close: units moved, no transaction | Support tickets, or subgraph vs contract divergence | Multiplier change alters collateral value |
| Frequency | Quarterly per holding, continuous across a book (**INFERENCE** from 15 live events / 12 assets) | Per listed asset per event | Per event |
| Alternative today | Screenshot the issuer page; email the issuer; a subledger vendor | Read `multiplier()` themselves — a few lines of code | Their own oracle |
| Paid substitute | Fund administrators already sell tax-lot and income categorisation as a service (**FACT**, [NAV Fund Services](https://www.navfundservices.com/fund-strategies/digital-assets)) | None identified | None identified |
| Product fit today | **High** — fields exist: gross, net, withholding rate, effective time, activation block, evidence hashes | High on chain fit, low on need | Low — needs price and liquidity the desk correctly refuses to publish |
| Pilot without a connector? | **Yes** — the deliverable is a document | Yes | No |
| Strongest reason not to buy | Their holdings are on Solana, not X Layer; and a subledger vendor may already book it | One engineer fixes it once in code and never buys again | On X Layer there is no such market to speak of |

**Disqualifiers for the chosen ICP:** holds no tokenised equities; holds them only on a chain
Bullseye does not read; has no external party checking their numbers (no audit, no LPs); already
runs a subledger that produces an auditor-acceptable evidence trail for corporate actions.

---

## 3. Named prospects — and the gap

The brief asks for up to five with dated evidence. **I could verify four organisations with
relevant public workflows, and zero organisations that hold xStocks on X Layer.** That second fact
matters more than the list.

1. **Crypto.com** — **FACT**: publishes holder-facing documentation of the exact multiplier
   mechanism, automatic reinvestment and the 30% withholding for tokenised stocks
   ([source](https://help.crypto.com/en/articles/15431644-corporate-actions-and-dividends-of-tokenized-stocks)).
   **INFERENCE**: an internal ops team reconciles these positions. **UNKNOWN**: their chain
   coverage (the page describes Cronos), their stack, any willingness to pay. Observed public
   capability, not a customer.
2. **NAV Fund Services** — **FACT**: markets digital-asset fund administration including tax-lot
   reporting and income categorisation to support year-end tax and audit
   ([source](https://www.navfundservices.com/fund-strategies/digital-assets)). **INFERENCE**: the
   closest match to the chosen ICP's job. **UNKNOWN**: whether any administered fund holds
   tokenised equities at all.
3. **Bitwave**, 4. **Cryptio**, 5. **TRES Finance** — **FACT**: market multi-chain reconciliation
   with protocol-level parsing. These are listed as **alternatives or channel partners, not
   prospects**: if they already book rebases correctly they are the competitor; if they do not,
   they are a route to many buyers at once. **UNKNOWN**: which.
6. **Backed Finance (xStocks)** — the issuer, and therefore the counterparty whose record Bullseye
   checks. Not a buyer.

**A prospect is not a customer.** None of these has been contacted, none has expressed a need, and
publishing documentation about a mechanism is not evidence of an unmet internal need.

---

## 4. Two concrete workflows

### Workflow 1 — the chosen ICP, and what actually happens today

| Step | Detail |
|---|---|
| Role / org | Fund accountant, digital-asset fund administrator |
| Existing system | Fund accounting / subledger + a spreadsheet close pack + an audit workpaper folder |
| Trigger | Quarter-end reconciliation: custodian/wallet position in an xStock is higher than the opening balance plus trades |
| Task today (**INFERENCE**, to be tested) | Confirm it is not a transfer; find the issuer's corporate-action record; work out gross vs net and the withholding; screenshot or paste it into the workpaper; write a memo |
| Bullseye input | The asset and the event — free on the Market Desk |
| Free, before paying | Headline, effective time, detection time, `BALANCE_IMPACT`, `STALE_BALANCE_ERROR`, `DOUBLE_ADJUSTMENT_ERROR`, evidence item list, price and network |
| Paid output — **exact fields that exist today** | `signal.facts.grossCashflowUsd` (1.165), `netCashflowUsd` (0.8155), `withholdingTaxRate` (0.3), `caType` (`CashDividend`), `multiplierOld`/`multiplierNew`, `changePct`, `signal.asset.isin` (CH1580494586), `draft.whatHappened[]` with per-figure `quantities` bound to evidence ids, `evidence[]` (9 items, each with `url`, `fetchedAt`, `sha256`), `checks[]` (9, one `UNKNOWN`), `gate.decision`, `contentHash` |
| Handoff | **A document.** Save the JSON, or the rendered page, into the workpaper folder; cite the `contentHash` and the Brief id in the memo. **This is a file handoff, not an integration.** No connector to any accounting system exists, is implied, or is being built. |
| Next action | Controller reviews; the entry is booked gross with the withholding split out; the file is the audit support |
| Value hypothesis | Replaces manual chasing per event, and turns a screenshot of a mutable page into a fixed record |
| Evidence and gaps | Fields: **FACT**. Withholding mechanism: **FACT** (Crypto.com). That accountants find this painful, how long it takes, and that they would pay: **UNKNOWN** |

### Workflow 2 — the agent channel, and who funds it

| Step | Detail |
|---|---|
| Role / org | Engineer who owns the reconciliation pipeline at the same administrator, or at a subledger vendor |
| Who funds the agent | Not "an AI agent". The **Head of Finance Operations' tooling budget**, spent by an engineer who sets a cap. The agent is a consumption channel, not a customer |
| Existing system | A nightly job that diffs positions across wallets and flags unexplained deltas |
| Trigger | A delta with no matching transfer |
| Bullseye input | `GET /api/v1/briefs/<id>` returns **402 Payment Required** with the quoted terms in a header |
| Output | The identical JSON document — same `contentHash` as the browser buyer receives |
| Handoff | The pipeline stores the JSON against the exception row and links it in the exception report |
| Status | **Working today, not hypothetical**: `ord_3e49405a17afe27a` was bought by an agent against the deployed host on 20 September 2026 and verified on chain (block 41472731) |
| Why they might not | A $3 per-event charge inside a nightly job needs a spend policy no finance team has written yet (**INFERENCE**) |

---

## 5. The offer

- **Category, in plain English:** a corporate-action evidence report for tokenised stocks.
- **One-line promise:** *When a tokenised stock quietly changes everyone's balance, we check the
  chain agrees with the issuer and give you a dated record you can file.*
- **Buyer:** as above. **Job:** explain and evidence a balance change to someone who checks.
- **Free to inspect:** the event, the exact arithmetic, the two error figures, the evidence item
  list, the price, the network, and every check's existence.
- **Paid:** the findings, the values, the full evidence bundle with hashes, the unknowns.
- **Freshness the product actually supports:** detection is **retrospective**, and the desk says so
  on screen. The DTEx event was effective 2026-09-19T00:30:00Z and first detected
  2026-09-20T11:30:02Z — about 35 hours. **That is fine for a close and useless for a trade**, which
  is a further argument for this buyer and against a trading buyer.
- **Price unit — and a real problem with it.** $3.00 per Brief is **configured, not validated**.
  A per-event unit fits the agent channel. It probably does not fit the human close, who wants
  *"everything that touched my 40 holdings this quarter"*, not 40 separate $3 purchases
  (**INFERENCE**). **Recommendation: keep pay-per-Brief for this submission and test the period-pack
  unit in interviews. Do not build subscriptions.**

### Value hypothesis — with every input labelled

Structure only. **Do not present these numbers as findings.**

```
events_per_quarter × minutes_to_investigate × loaded_cost_per_minute = time cost today
```

- `events_per_quarter`: **OBSERVED INPUT** — 15 events / 12 assets appeared in the live feed in one
  window. A book of 40 dividend-paying holdings implies roughly 40 events a quarter (**INFERENCE**).
- `minutes_to_investigate`: **ASSUMPTION, NOT MEASURED.** No source. Question 4 of the interview
  guide exists to obtain it.
- `loaded_cost_per_minute`: **ASSUMPTION, NOT MEASURED.**

Therefore: **no saving is claimed, and none should be shown to a judge.** What can be said
truthfully is the shape: *if an event takes a qualified person more than a few minutes to
reconstruct, a $3 record is cheap; if it takes thirty seconds, it is not.* The interview establishes
which. Three settlements exist to date and **all three were made by this project** — they prove the
mechanism and are not revenue.

### Wallet-payment friction — stated honestly

A fund accountant does not have a browser wallet holding USD₮0 on an OKX testnet, and will not get
one to buy a $3 report (**INFERENCE**, and a strong one). The current checkout is therefore a
credible demonstration for judges and for the agent channel, and **not** a path this buyer would
complete. The practical post-hackathon path is an invoice or a card, which is out of scope tonight
and must not be faked. **No inquiry form, mail capture or fake booking link has been added** —
there is no working destination for one, and a dead form is worse than no form.

---

## 6. Kill criteria

Stop or pivot if any of these hold after the first five interviews:

1. **Coverage.** No reachable prospect holds tokenised equities on a chain Bullseye reads, and
   reading Solana is not a small change. *(Currently the most likely outcome on the evidence.)*
2. **Already solved.** Three of five say their subledger books rebases correctly and produces
   audit-acceptable support.
3. **Not their problem.** The balance change is handled by the venue, and the accountant only ever
   sees a reconciled statement.
4. **Wrong unit.** Everyone wants a period pack across holdings and nobody wants a per-event
   report — the current product shape is wrong even if the job is right.
5. **No checker.** The people with the problem have nobody auditing them, so a hashed record buys
   them nothing over a screenshot.

**Decision taken tonight: option B — repackage the existing verified outputs around the
reconciliation job, ship the conversion changes, and treat the buyer as a stated hypothesis with a
falsifiable pilot.** Option D's honesty is preserved: demand remains unproven and `DEMAND.md` should
not be softened.
