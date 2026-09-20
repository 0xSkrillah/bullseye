# Proposed copy deck
Design suggestions, not already implemented product results. Fill dynamic values only from verified APIs.

## Navigation and introduction
- Market desk / Briefs / Situation room. Use actual reachable destinations.
- Headline: **Understand the event. Check the evidence.**
- Supporting line: **Bullseye turns tokenised-asset events into evidence-backed reports for people and agents.**
- Primary action when report available: **View brief**.
- Offer explanation: **Issuer announcement, blockchain checks and the uncertainties that remain.** Only name checks actually included in the output.

## Event and information status
- Effective → **Event took effect**.
- First detected → **First detected by Bullseye**.
- Newest fetch → **Latest source retrieval**.
- Answered → **Page assembled** (secondary details).
- CORPORATE_ACTION_REBASE → **Dividend-related balance adjustment**, only for the matching event type.
- Reference-only data → **Reference observation — not a trade quote**.
- No executable quotes → **Event analysis only. Executable prices are unavailable.**
- Missing required sources → **Not enough data to assess this comparison.**
- Values withheld → **Full findings included in the paid brief**.
- Actual zero → show **0**; do not replace with Unknown.

## Offer and payment
- “Open brf_… on the desk” → **View this brief**; show ID in details/copy.
- TESTNET offer → **Testnet purchase · [quoted amount] [token] · [network]**.
- Rail unknown → **Payment availability not confirmed**.
- “The paid JSON resource” → **Agent access: x402 endpoint** with a short explanation of the402 challenge.
- Quote requested → **Preparing your quote…** (do not invent timing).
- Wallet action → **Review the amount and network in your wallet**.
- Payment unknown → **Payment outcome not confirmed. Check this order; don't pay again.**
- Recovery CTA → **Check payment status** or **Retrieve purchased brief**, mapped to the existing permitted mechanism.
- Delivered → **Your brief is ready**; **Read report / Download JSON / View receipt**.
- Signature refusal → exact state wording based on what was and was not submitted; never assert “no funds moved” after an ambiguous settlement.

## Empty and failure
- No events: **No events found yet. The desk will show events once the detector records them.**
- No report: **This event has no published brief yet. Browse available briefs.**
- Report rejected: **Report withheld. The draft didn't pass the required checks.**
- Withdrawn: **This report is no longer on sale.** Existing owners retain their documented retrieval rights.
- Public API unavailable: **We couldn't load this view. Retry or choose another event.**
- Daily allowance: **Research allowance reached. Existing briefs remain available.**

## Tone
Reserve “On target” / an original Bullseye reveal for true publication success. No “missed the bullseye” on payment problems, no casino terminology, no false urgency, no fake gains. Financial and payment notices remain literal and calm.
