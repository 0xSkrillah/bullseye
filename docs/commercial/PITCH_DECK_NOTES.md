# Notes for the pitch deck

Written 20 September 2026 for whoever next opens the deck (ten 1280×720 slides on the Design
canvas, outside this repo). The deck exists; this is what to change in it, not a new deck.

**Diagnosis in one line.** The deck sells a trading/market desk. The product is not one — and says
so itself on screen: the Market Desk asks whether the opportunity is still interesting and answers
*No transactable opportunity*. Meanwhile the same page computes the two exact ways a rebasing token
corrupts a set of books. **It is a reconciliation-evidence product.** Every slide implying trading,
alpha or opportunity costs the sale.

## The buyer to name

The fund accountant or reconciliation analyst at a digital-asset fund administrator or crypto fund
holding tokenised equities. One report, one event, when a balance changes with no transaction
against it — because they must book the dividend gross, record the 30% withholding, and show an
auditor why the units moved. They file it with the close workpaper.

Not "wallets, accounting teams and AI agents". One person, one job, one moment.

## The opening slide, verbatim

> Tokenised stocks pay dividends by quietly making everyone's balance bigger. There is no
> transaction — the number just changes. So if you keep books, your ledger and the chain disagree
> and you have to explain why. Bullseye spots the event, checks the blockchain actually did what
> the issuer said, and sells you a dated, tamper-evident record you can put in the file. Three
> dollars a report, paid by a person or by software.

## Slide by slide

| Slide | Change |
|---|---|
| **Problem** | Do not headline "no `Transfer` event is emitted". Headline *the balance changes and there is no transaction to point at*. The technical phrasing is body copy. |
| **Who it's for** | One role, one moment: quarter-end close, the position is bigger, nothing in the history explains it. Delete the segment list. |
| **Product / demo** | Lead with the two error figures — a stale cached balance **understates** the holding, applying the multiplier to an already-scaled balance **overstates** it, and they are different numbers. This is the "you have this bug" moment and it is the most sellable thing in the product. |
| **Why pay** | Say first that the issuer publishes the announcement free. Then the three things it does not give: the chain reads either side of the effective time, the block the change activated at, and a hashed record that does not change when the issuer revises theirs (the record read was already at version 2). Plus: we write down what we could **not** confirm. |
| **Traction / market** | Cut any demand, market-size or revenue claim. Three settlements exist and all three were made by this project. Say *the machinery is real, the market is the next thing to prove.* |

## Two things that will save the deck under questioning

1. The Brief's own limitations state that **no Transfer-event log sweep was carried out** — the
   absence of transfers is inferred from how a multiplier works, not measured. No slide may state
   it as a measurement.
2. **xStocks' float is ~93% on Solana; the detector reads X Layer.** If asked about market size:
   the architecture separates the detector from the gate, ledger and payments, so the chain is a
   detector change rather than a rewrite — but it is unbuilt, and saying so is stronger than being
   caught.

## Words to delete

alpha · opportunity · traders · profit · "mad profits" · any figure for money saved or losses
prevented. No saving has been measured; inventing one is the fastest way to lose a technical judge.

Full reasoning and sources: `CRO_REVIEW.md`. Spoken version, objections and the 3-minute demo with
actual clicks: `BUYER_STORY.md`.
