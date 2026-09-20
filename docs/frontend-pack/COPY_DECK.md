# Copy deck — superseded

**This file is no longer the source of the Market Desk's words.** It was written for the frontend
audit on 20 September 2026, before the screen was rebuilt around explaining the concept rather than
reporting the event, and parts of it now describe copy that is not on the screen. Keeping two copy
sources that disagree is worse than keeping one, so this one defers.

Where the words live now:

| What | Where |
| --- | --- |
| The explanatory layer above the event — the companies, the mechanism, the fan-out, the spread | `apps/web/src/market/Primer.tsx`, with the reasoning in its file comment |
| The event's own headline and the reader block | `apps/web/src/market/MarketDesk.tsx` and `plainHeadline` in `market/data.ts` |
| Figure labels and what each kind of claim means | `LABELS` in `apps/web/src/market/data.ts` |
| The offer, the price, the rail and the recovery sentence | `apps/web/src/components/BriefOffer.tsx`, `BriefPaywall.tsx` |
| Tone, casing, number formatting, colour meaning | the Bullseye design system artifact, `project/README.md` |
| What may and may not be claimed | [docs/CLAIM_LEDGER.md](../CLAIM_LEDGER.md) — the authority over all of the above |

## What changed, and why the old deck is stale

The audit's deck treated the screen as a report on one event and proposed wording for its parts. The
defect that mattered was not in any of those parts: the screen opened on a balance having changed
with no transfer to show for it, which only means something to a reader who already knows that a
tokenised stock pays its dividend by multiplying balances. A fund accountant meeting it for the
first time had no footing, and neither did a judge. No amount of better wording on the event fixes
a missing layer above it.

Three of the deck's lines are now actively wrong:

- **"Headline: Understand the event. Check the evidence."** The screen's first words are now
  "What a tokenised stock does with a dividend", because establishing that the event *can happen*
  has to come before inviting anyone to understand it.
- **"Offer explanation: Issuer announcement, blockchain checks and the uncertainties that remain."**
  Replaced during the conversion review: the offer now leads with the job the document does — one
  dated record to file with a close — rather than its table of contents.
- **Anything implying the desk states that no transfer was emitted.** It does not, and must not: no
  event-log sweep is carried out. The absence is reasoned from how a multiplier rebase works, in the
  explanatory layer, where it is plainly a mechanism rather than an observation.

## What is still worth keeping from it

The clock names (`Event took effect`, `First detected by Bullseye`), the withheld-value wording
(`Full findings included in the paid brief`), the payment-state sentences, and the rule that an
actual zero is shown as **0** and never as Unknown. All of those are implemented and are unchanged
by the rebuild.
