# Conversion sprint — what changed

Branch `claude/cro-conversion`, cut from `main` at `2f7d417`. **Not merged, not pushed, not
deployed.** Six source files, 70 insertions, 16 deletions. No API, schema, gate, hash, payment,
permission or spend-control code was touched.

---

## The defect this sprint fixed

The Market Desk's first screen asked **"Is this opportunity still interesting after checking the
data, the adjustments and the costs?"** and answered **"No transactable opportunity"** — directly
below the headline, in the first viewport.

That is a true and well-evidenced statement about trading. Placed there, it read as *this product
found nothing*, while three sections further down the same page computed the two exact ways a
rebasing token corrupts a set of books (`STALE_BALANCE_ERROR`, `DOUBLE_ADJUSTMENT_ERROR`). The
value was on the page; the framing threw it away. Nothing was hidden to fix this — the trading
verdict is still on the page, in full, with all of its reasons.

---

## The three changes

### 1. The first viewport names a buyer, a job and a use

`apps/web/src/market/MarketDesk.tsx`, `apps/web/src/market/market.css`,
`apps/web/src/market/data.ts`

| Before | After |
|---|---|
| Headline → lede → timestamps → offer. Nothing said who the screen was for or what the document was used for. | A new `.mk-for` block sits directly under the lede: *"For whoever has to explain this balance change in someone else's books…"* — naming the reader, why a transfer-derived ledger misses it, that the arithmetic is free, and that the Brief is a document to attach to a close, a reconciliation or a support ticket. |
| The trading verdict sat immediately after the hero. | The verdict section moved **below the figures**, and its question is rescoped: *"Separately: is there a trade in this event…"*. Its answer, its reasons and its `data-verdict` attribute are unchanged. A sentence was added saying it does not qualify the arithmetic above, which needs no price. |
| Figure section titled *"The event, in exact decimals"*. | Titled *"The event, and the two ways a book gets it wrong"*, and the note now says two of the figures are the size of an **error**, not of the event. |

### 2. The offer leads with the job, not the contents

`apps/web/src/components/BriefOffer.tsx`, `market.css`

| Before | After |
|---|---|
| *"Issuer announcement, the X Layer reads that check it, and the uncertainties that remain — written as one document for a person or an agent."* | *"One dated document that answers **what actually happened here, and who says so** — to file with a close, attach to a reconciliation, or send to whoever asked why the number moved. The issuer can revise or cancel its own record later; this one is hashed and does not change."* |
| Bullet: "The on-chain observations, with their values" | Bullet: "The X Layer reads either side of the effective time, and the block the change activated at" — the thing the issuer's own API does not give you |
| Bullet: "Confidence, unknowns, conflicts and limitations" | Bullet: "What was checked, what it found, and what stayed unknown" |
| The JSON/agent form was only in a collapsed `<details>`. | One quiet line states the same document is one JSON object with a stable schema and a content hash. The `<details>` block is unchanged. |
| Nothing about buyer protection before the button. | A new line under the CTA: terms and their hash are visible before approving; a failed payment delivers nothing and cannot charge twice; **this browser** keeps a claim so closing the page does not lose a purchase. |

**Deliberately not changed:** the CTA still reads exactly *"View this brief"* (pinned by
`tests/e2e/market-desk.spec.ts:143`), the price block, the rail line, the testnet badge and the
economics note.

### 3. The quote says what the money buys, above the hashes

`apps/web/src/components/BriefPaywall.tsx`, `apps/web/src/styles/bullseye.css`

A buyer previously met `IMMUTABLE QUOTE`, a price, and a six-row table of addresses and hashes, with
the only plain-English sentence *below* it. A `.be-paywall-what` paragraph now sits above the terms:
what the findings contain, that it is one document, readable or parsed, hashed so it can be filed
as it stands. Every existing term row, hash, countdown, expiry path, focus handling and the
"cannot charge you twice" paragraph are untouched.

---

## Preserved, deliberately

Checkout and recovery · claim tokens · immutable quotes and `termsHash` · the publication gate and
its version · canonical hashes and `contentHash` · numeric grounding · evidence freshness and
`staleAfter` · spend controls · authorization boundaries · PUBLIC vs DIAGNOSTIC projections ·
the `?brief=` deep link and history behaviour · evidence-dialog focus handling ·
`apps/web/src/situation/**` (untouched, as instructed) · every figure, unit and decimal.

No paid field is exposed in a free view. No failed check is hidden. No testnet label was removed.
No new dashboard, detector, connector, form or payment path was added.

---

## Tests

Run in this worktree, which has its own `node_modules` and its own in-memory database, so no other
session's checkout was touched.

| Check | Result |
|---|---|
| `npm run typecheck` (api + web) | **pass** |
| `npx vitest run` (API) | **293 passed, 1 skipped (294)** — matches the stated baseline |
| `npm run test:web` | **222 passed** — matches the stated baseline |
| `npm run build` | **pass**, built in 2.72s |
| `PW_CHANNEL=msedge npx playwright test` | **17 passed** — matches the stated baseline |

Browser checks by hand, against the offline configuration on `localhost:5173` (recorded
HISTORICAL data, fixture synthesiser, fixture payment rail):

- `/market/<id>` at **1440×900** — the new block renders, the offer reads as a job, and all six
  comprehension questions are answerable in the first viewport.
- `/market/<id>` at **390×844** — no horizontal overflow, the new block wraps cleanly.
- Section order confirmed: figures → *"Separately: is there a trade…"* → four clocks.
- `/?brief=<id>` → **Request quote** → the quote panel shows the new "What you are buying" block
  above the terms table.
- An unknown `?brief=` id still says so and shows no other report.

### Not tested

- **No purchase was made on the changed build.** The paywall was rendered and read; the pay button
  was not pressed. No funds, testnet or otherwise, were spent.
- Not deployed, so no signed-out check against the public host exists for this build.
- One browser engine (Edge/Chromium). No screen reader, no axe scan, no usability session.
- No second person has read any of this copy.

---

## Blockers and owner actions

1. **Timing — the only real one.** The submission session's constraint: this must land *before the
   demo video is recorded*, or the footage will not match the product. Order: review → verify →
   deploy → record. If that window has passed, **hold the code and ship `docs/commercial/` alone** —
   the review stands without the diff.
2. **`README.md`, `docs/SUBMISSION.md` and `docs/CLAIM_LEDGER.md` were not edited**, by agreement
   with the submission session, which owns them. Proposed replacement copy for the README opening
   and the Project Summary is in the handoff message, not applied here.
3. **Data-use terms for `api.xstocks.fi` are unresolved** and should be before any mainnet revenue.
4. **The price unit is unvalidated**, and probably wrong for a human buyer. See `CRO_REVIEW.md` §5.
5. **Chain coverage is the strategic blocker**, not a copy problem: the assets are ~93% on Solana
   and the detector reads X Layer. `CRO_REVIEW.md` §1 and the kill criteria.
