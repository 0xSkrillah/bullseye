# Submission

The single source for the OKX Dev Day 2026 form. Every factual claim here is backed by a row in
[CLAIM_LEDGER.md](CLAIM_LEDGER.md) or an artifact in `artifacts/`; where something is not proven,
this file says so rather than softening it. Anything in **[OWNER]** can only be settled by Connel
Bryn Bennett and is listed again at the end.

Prepared 20 September 2026. Deadline **25 September 2026, 23:59 UTC**.

This supersedes [SUBMISSION_DRAFTS.md](SUBMISSION_DRAFTS.md) for final form answers. That file is
kept for its organiser question, its ASP metadata table, its integration diagram and its two
sponsor reports, none of which are repeated here.

---

## 1. Form answers

| Field | Answer |
| --- | --- |
| Team Name | Bullseye |
| Team Size | 1 |
| Team Members' Names | Connel Bryn Bennett **[OWNER: confirm exact spelling as registered]** |
| Track | Build a Company – OKX AI |
| Participation Route | **[OWNER]** In-Person only if the date is confirmed — see §7 |
| Able to attend the in-person finale? | **[OWNER]** The form offers "0: Unable to" and 1–4 without defining them; for a confirmed solo attendee `1` appears intended. Verify against the live form. |
| Team Display Picture (1:1) | Optional in the supplied PDF. Reuse an existing original mark; not a release blocker. |
| Project Name | Bullseye |
| Repository Link | https://github.com/0xSkrillah/bullseye |
| Product Link | https://bullseye-production-5d0c.up.railway.app **[OWNER: test signed out before submitting]** |
| Demo Video | **[OWNER: not recorded. No URL exists. Do not invent one.]** |
| New project or existing? | New project, initialised 18 September 2026 — see §6 |
| Contact | **[OWNER]** the actual Luma registration email and/or Telegram. The PDF being signed in as bryn@bizdev.studio does not establish which address registered. |

### Project Summary

> Bullseye is an automated intelligence desk for tokenised stocks. When an issuer pays a dividend by
> raising a token's balance multiplier, every holder's balance on X Layer changes and no `Transfer`
> event is emitted, so anyone keeping books sees units move with no transaction to explain them.
> Bullseye detects the event, reads the contract either side of the issuer's effective time, pins the
> block the change activated at, and publishes a dated, hashed report stating what was checked and
> what could not be. People buy it in a browser and agents buy it over an OKX x402 endpoint; both
> receive the same document. The prototype reads live issuer and X Layer data and settles on X Layer
> testnet.

---

## 2. What the product actually is, today

xStocks reinvest dividends by raising a per-token **multiplier**. Every holder's balance on X Layer
changes and **no `Transfer` event is emitted**. Anyone who caches balances, accounts in shares or
prices collateral sees the number move with no transaction to explain it.

Bullseye runs the whole path unattended:

```
SIGNAL → INVESTIGATE → VERIFY → PUBLISH → PURCHASE → DELIVER → MEASURE ECONOMICS
```

1. **Detect** — a pure function over the issuer's public corporate-action history flags multiplier
   changes on assets deployed on X Layer. Same inputs, same signal ids.
2. **Investigate** — a model chooses evidence tools; a governor enforces ceilings on cost, model
   calls, tool calls and latency *before every call*. Every fact is written by code from a
   schema-validated response, with URL, fetch time, sha256 and a LIVE/CACHED/HISTORICAL/FIXTURE
   label. **No model ever writes a number.**
3. **Verify** — code reads `multiplier()` on the X Layer contract 60 s before the effective time,
   60 s after and at the head, bisects for the activation block, and compares with the issuer at
   18-decimal precision.
4. **Publish, or not** — a deterministic gate refuses drafts with missing or stale evidence,
   undisclosed conflicts, inflated confidence, advice language, or any figure not bound to
   evidence. A rejected draft creates no Brief and nothing can be charged.
5. **Sell** — `GET /api/v1/briefs/:id` is an x402 resource on the OKX seller SDK. Quotes are
   immutable and hashed; one signed authorization is one order and settles at most once. A timeout
   is `PAYMENT_UNKNOWN`: nothing is delivered and a retry cannot charge twice.
6. **Deliver and account** — one JSON document (`bullseye.brief/v1`), which is also what the web
   app renders. Testnet payments are never counted as revenue.

### Screens a judge can open

| Route | What it is |
| --- | --- |
| `/` | The desk: events, the Brief, permitted evidence, and the checkout. **The product entry.** |
| `/?brief=<id>` | One exact Brief by link. Resolves to that Brief's own event, survives reload. |
| `/market` | Market Desk: one verified event read as money, event impact only. |
| `/room` | Situation Room: a read-only wall display of the whole pipeline. Supplementary. |

### Intended user

Whoever has to explain a balance change to someone who checks it: fund accounting, reconciliation,
treasury and operations teams holding tokenised equities — and the software doing that work for
them, which buys the same document over x402. The unit of sale is one dated, hashed report for one
corporate action, filed with a close workpaper in place of a screenshot of an issuer page that can
be revised later. The reasoning behind that choice, and the criteria that would kill it, are in
[commercial/CRO_REVIEW.md](commercial/CRO_REVIEW.md) and [commercial/BUYER_STORY.md](commercial/BUYER_STORY.md).

The agent case is why the paid resource is x402 rather than a subscription: software doing a
reconciliation can buy one report per call, without a human and without an account.

**Demand is not evidenced.** No interviews or usability sessions have been run
([DEMAND.md](DEMAND.md) holds the plan and an empty results table; ledger B4). Nothing here should
be read as evidence that anyone wants to buy this.

---

## 3. OKX integration

| | |
| --- | --- |
| Rail | OKX x402, `exact` scheme |
| Network | X Layer **testnet**, `eip155:1952` (mainnet `eip155:196` is implemented but never run) |
| Asset | testnet USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Price | 3.00 USD₮0 per Brief (`3000000` base units) |
| SDK | `@okxweb3/x402-core` 0.1.0, `@okxweb3/x402-evm` 0.2.1, `@okxweb3/x402-express` 0.1.1, `@okxweb3/x402-fetch` 0.1.0 |
| Settlement | The OKX hosted facilitator, verified independently against X Layer by our own reconciliation |
| Chain reads | X Layer mainnet RPC for contract state; X Layer testnet RPC to confirm settlements |

**Integration URL (paid resource):**
`https://bullseye-production-5d0c.up.railway.app/api/v1/briefs/brf_0d55468f0c4045ef`

An unpaid `GET` answers `402` with a `PAYMENT-REQUIRED` header carrying `x402Version` 2 and
`accepts[0]` = `exact` / `eip155:1952` / `3000000` / `maxTimeoutSeconds` 300 — this is OKX's own
documented listing self-test, passing on the deployed address (ledger V33).
`POST /api/v1/briefs/latest` is the stable address for agents that want the newest Brief.

### The strongest honest claim

On **20 September 2026**, on the public deployment, with nobody driving it:

- the unattended desk detected a QQQx dividend rebase, investigated it under budget, and gate 2.0.0
  passed the draft — PUBLISH across all 11 rules — publishing `brf_0d55468f0c4045ef` at 10:31:50Z;
- at 18:38 the same day that Brief was **bought from the deployed address** and delivered. Tx
  [`0x30313b87…73b726`](https://web3.okx.com/explorer/x-layer-testnet/tx/0x30313b87921dd68f07ae95320442ac5510fd89be371b8200bded84912573b726),
  block 41470689, receipt success: an EIP-3009 `transferWithAuthorization` of 3.000000 testnet
  USD₮0 to the desk's quoted pay-to address, submitted by a relayer rather than the payer;
- **the payment went uncertain and recovered without a second charge.** The order's own public trail
  reads `QUOTED → PAYMENT_PENDING → PAYMENT_UNKNOWN → PAID → DELIVERING → DELIVERED`. Nothing was
  delivered while the outcome was unknown, and one transfer exists on chain. This is the hardest
  part of x402 to get right, and it ran for real on the real facilitator — not on fixtures.

Evidence: `artifacts/evidence/deployed-purchase-2026-09-20.json` (9 checks, all passed, built from
JSON-RPC reads of the receipt and its block, the seller's own `PAYMENT-REQUIRED` terms, and the
deployment's public aggregates). Ledger V52, V53.

**And the agent buyer did the same thing, an hour later.** `npm run buy` against the deployed HTTPS
address bought a DTEx Brief for 3.00 testnet USD₮0. Its **first attempt also answered
`503 payment_outcome_unknown`**; it re-sent the same authorization and reached DELIVERED. Tx
[`0x430525a8…95c4`](https://www.oklink.com/x-layer-testnet/tx/0x430525a87991a33efd6c88eeafdad5fd0dae6783308cfdada447f91e301495c4),
block 41472731 at 19:12:48Z, receipt success, 3000000 base units. Collecting the order again
afterwards returned the same document and signed and paid nothing. The payer's balance went **4 → 1**
USD₮0 — one charge, not two — and the deployment now reports `total 2, DELIVERED 2, chainVerified 2`.
Evidence: `artifacts/evidence/delivery-ord_3e49405a17afe27a.json`, ledger V54.

So **both** halves of the buyer story — browser and agent — have now settled against the deployed
service, and both recovered from a genuine uncertain payment on the real facilitator without a
second charge. That case did not have to be staged on fixtures.

**The exact form of the claim.** The owner confirms this purchase was made from the browser with a
wallet extension. Keep the split: **the settlement is verified, the client is reported.** The chain
and the desk's public record show the payment and the delivery; they cannot show which client
signed, because the payer is the project's own buyer address — the same one as the 18 September
agent run. The strongest sentence the evidence supports is:

> The browser purchase path has been exercised end to end on the deployed service, by the project
> itself, on testnet.

**What it does not say.** It is testnet with test tokens, so this is payment and delivery mechanics,
not revenue. **No stranger has bought anything** (ledger P6) — so no "a customer bought one", no
"users can buy" in the past tense, and no conversion or demand framing anywhere in the pitch. The
transaction is joined to the order by
network, asset, amount, pay-to and time, because operator routes are disabled on the deployment and
the seller's own record of the order was deliberately not read.

---

## 4. Test results

Run on the submitted tree. Node **26.7.0**, Windows 11.

| Command | Result |
| --- | --- |
| `npm ci` | clean, from `package-lock.json` |
| `npm run typecheck` | clean |
| `npm test` | API **294 passed** (21 files) · web **222 passed** (12 files) |
| `npm run build` | ok — `/market` and `/room` are separate chunks; the desk at `/` loads neither |
| `PW_CHANNEL=msedge npm run test:e2e` | **17 passed** |

Nothing is skipped and no test was weakened to pass. CI runs Node 22 and 24 on GitHub Actions.

Two things worth stating rather than letting someone find them:

- **CI silently skipped a test until 20 September.** `apps/api/test/public-deployment.test.ts` skips
  itself unless `apps/web/dist` exists, and the workflow ran `npm test` *before* `npm run build`, so
  on a fresh checkout it never ran — on every run, both Node versions. It covers Express serving
  `index.html` for a deep link, which is the `/?brief=` route, and Playwright points at the vite dev
  server with its own history fallback, so nothing else covered it either. The workflow now builds
  first and CI runs 9 tests in that file rather than 8. A skip is not a failure, which is why it
  survived so long; `npm test` on an unbuilt tree still reports 293 + 1 where a built tree reports 294.
- **The browser job flaked once on the submission commit.** The first attempt failed with
  `apiRequestContext.get: socket hang up` in the golden-path spec — a transport error, not an
  assertion — and ended the run early at 11 passed. The unit jobs passed on both Node versions in
  that same attempt, and a re-run of the same commit passed 17/17. It is a harness flake, observed
  once and not reproduced; it is recorded here because one green run after a red one is weaker
  evidence than an unbroken green, and a judge re-running CI deserves to know it can happen.

**Coverage of the release-critical journey**, and its limits, from
[frontend-pack/QA_REPORT.md](frontend-pack/QA_REPORT.md):

- Choosing a non-default event on `/market` opens **that** Brief, on click, direct load and reload —
  browser-proven, and each test was run against the pre-fix code and observed to fail there.
- Back/Forward keep address and event in step — proven **between events on `/market`**. Back/Forward
  between the desk and a `?brief=` link is *not* covered.
- No page-wide horizontal overflow at 360, 390, 768, 1024, 1199, 1200, 1280, 1335, 1336 and 1440 px
  across `/`, `/?brief=<id>` and `/market/<id>`.
- The evidence dialog takes the keyboard and gives it back: focus enters, is trapped over 12 Tabs
  and a Shift+Tab, Escape closes, and focus returns to the button that opened it.
- An unknown Brief id says so and never shows a different report instead.

---

## 5. Limitations

Stated plainly, because the ledger is the point of this project.

- **Testnet only.** Three settlements, all testnet, all made by the project itself. No mainnet
  payment has ever been made. Testnet payments are not revenue and revenue is $0.
- **No stranger has bought anything.** The one browser-wallet purchase is owner-reported; the public
  record does not establish which client signed (P6). Nobody outside the project has bought anything.
- **No demand evidence.** No interviews, no usability sessions, no customer metrics (B4).
- **Scale is ones and twos.** A handful of live investigations and two settlements: no quality
  evaluation, no rejection rate, no measured detector recall.
- **Not an early warning.** The first live Brief was detected 21 h 29 min after the event took
  effect. It is a look back, and the desk labels it so.
- **The Market Desk deliberately shows no tradable edge.** The permitted sources publish no bid, no
  ask, no size, no expiry and no fee schedule, so no spread and no net edge is computable. It ships
  EVENT IMPACT ONLY with missing-data states rather than manufacturing an opportunity (V45–V51).
- **`/room` has no Playwright coverage, so CI would not catch a visual regression there.** What it
  does have: 141 unit tests, including a suite that holds four rendered walls to nine honesty rules,
  and those tests were proven to bite by planting 25 violations one at a time and confirming each
  one failed at least one test. Its request budget was measured at 0.55 requests/second against the
  deployed address. It was checked by hand at 1920/1440/1280/390 px, against a populated server, an
  empty database and the deployed address, and with the API stopped — where it degrades honestly
  rather than blanking. It makes no POST and never calls operator routes.
- **`/room` has no link out**: reach it from the header and leave with the browser's Back button.
  The wall is deliberately non-interactive — it starts nothing, and `PAYMENT_UNKNOWN` offers no
  pay-again — and the test enforcing that currently forbids *all* anchors, so making the wordmark a
  link back to `/` fails it. Its author has since confirmed the rule is about **command, not
  movement**, and that the blanket assertion was wider than intended; the exact narrowing (allow
  exactly one anchor, whose `href` must be `/`) is agreed and recorded, and is a two-minute change.
  It was deliberately **not** made on release night, because weakening a green safety test to land a
  navigation convenience is the wrong trade at the wrong hour.
- **"No `Transfer` event is emitted" is an inference, not a measurement.** It follows from how a
  multiplier rebase works — balances are shares times a global multiplier, so raising the multiplier
  moves every balance without a transfer — and Bullseye does **not** demonstrate it by sweeping the
  contract's logs for the period. A Brief's own limitations say so. The claim is sound; it is
  reasoned from the mechanism rather than measured, and that distinction should survive being
  pressed on.
- **Coverage: the assets are mostly not on the chain Bullseye reads.** The detector and the verifier
  read X Layer, and the X Layer deployments are real — but they hold a minority of each asset's
  all-chain supply, and most of the float sits on other chains. A buyer with this problem at scale
  may well hold the asset somewhere Bullseye does not read, and reading another chain is not a small
  change. This is the single biggest reason the intended user may not convert and no wording fixes
  it; the sourced figures and the criteria that would kill the idea are in
  [commercial/CRO_REVIEW.md](commercial/CRO_REVIEW.md).
- **No ASP marketplace listing.** Not registered, not submitted, not approved (B3).
- **One browser engine.** Edge 153. No screen reader, no axe scan, no real phone.
- **The OKX mock merchant is still blocked** — its challenge arrives with no `PAYMENT-REQUIRED`
  header and OKX's own client SDK cannot parse it (B1, sponsor report SF-1).

---

## 6. Reuse and provenance disclosure

Checked against the actual history, not assumed. First commit `5011886`, **18 September 2026
21:26:51 +0200**; nothing in the history predates the build period (17–25 September).

- **New project.** Before 18 September the project was planning documents only — a product dossier
  and an implementation brief. No code, schemas, prompts or designs were carried in.
- **Third-party code** is installed from npm and pinned in `package-lock.json`; none is vendored.
  The OKX x402 packages, `viem`, `express`, `zod`, `react`, `vite`, `vitest`, `@playwright/test`,
  `typescript`. Fonts: IBM Plex Sans/Mono, and Share Tech Mono / VT323 on `/room` (all open
  licences). Full table in [BUILD_PROVENANCE.md](BUILD_PROVENANCE.md).
- **AI coding tools were used throughout**, as stated in the registration answers. All code was run
  and tested as described in the README, and the team is responsible for it and can explain it.
- **Design guidance was used and is disclosed.** The interface was developed with project-local
  design skills and briefs written for this repository during the build period
  (`.claude/skills/bullseye-frontend`, `private/CLAUDE_DESIGN_*.md`). These are instructions and
  review method, not imported code or a purchased template; they are git-ignored and ship with
  nothing. The design system in `docs/design-system` was authored during the period.
- At runtime the **only** AI component is the investigator's model call. Schemas, budgets, checks,
  the publication gate and all payment state are ordinary deterministic code.

Using npm libraries and written guidance does not make this a pre-existing project; carrying in code
or designs would have, and none was.

---

## 7. Owner-only blockers

Nothing below can be done by an agent. Ordered by what blocks the submission.

1. **Record and upload the 2–4 minute demo video.** It does not exist. Run sheet:
   [DEMO_RUN_SHEET.md](DEMO_RUN_SHEET.md). Upload publicly, then **check the link signed out and on
   another device**.
2. ~~Deploy.~~ **Done, on your approval, 20 September.** `main` was pushed as a fast-forward
   `3d005c1..4eb94c0`, CI passed (run 35531401515), Railway rebuilt, and `/`, `/market`, `/room` and
   a `?brief=` link were re-checked signed out. `/room` renders the Situation Room populated from
   the live service. The repository a judge clones and the service a judge opens are now the same
   build.
3. **Confirm the finale date.** The supplied PDF says **In-Person, 7 October 2026**; the terms page
   read on 19 September said **6 October, 10:00–14:00 SGT**. Unresolved. Do not book travel on it.
   This is question 2 in [SUBMISSION_DRAFTS.md](SUBMISSION_DRAFTS.md).
4. **Ask the organisers whether the testnet x402 integration meets the track minimum** without an
   approved ASP listing. The kit requires publishing **or** integrating a working service through
   OKX AI and a service/listing/integration URL; it does not say every project needs an approved
   marketplace listing, and it is silent on testnet vs mainnet. A drafted <150-word question is in
   SUBMISSION_DRAFTS.md. Log submitted / pending / approved separately — **pending is neither
   approval nor disqualification.**
5. **Top up the buyer wallet before the demo if you intend to buy on camera.** The agent purchase is
   done (V54) and the wallet now holds **1 test USD₮0**, below the 3.00 price. Any further purchase
   needs the [X Layer faucet](https://www.okx.com/xlayer/faucet/xlayerfaucet). The run sheet's
   fallback covers recording without a live purchase.
6. **Optional, one minute: paste the order id** for the QQQx purchase. Your browser holds the
   purchase record for `brf_0d55468f0c4045ef`. The **order id alone is inert** — an order is answered
   only to its buyer — so it can be pasted safely and would let the ledger name the order the way
   V20 names `ord_8a2102084ad69dab`, instead of joining the transaction to it by network, asset,
   amount, pay-to and time. **Do not paste the claim token**, which sits beside it; nobody will ask
   for it.
7. **Confirm registration contact, team name spelling, and personally accept the terms.** No agent
   submits the form. Retain the email receipt; organisers may ask about inaccessible links and the
   form requires a reply within 24 hours.
7. **Send the sponsor reports** (SF-1 mock merchant, SF-7 `syncSettle` timeout) if not already sent.
   Log sent and acknowledged separately.

**Do not** switch to mainnet to make the pitch stronger, and do not raise model budgets.

---

## 8. What remains to finish the release

- [x] `npm ci && npm run typecheck && npm test && npm run build && npm run test:e2e` — all clean on
      `4eb94c0`, which is the code that was pushed and deployed.
- [x] **Pushed and deployed** — `3d005c1..4eb94c0`, CI run 35531401515 passed, public routes
      re-checked signed out.
- [x] **Agent purchase against the deployed host** — done and verified (V54). Both buyer paths have
      now settled against the deployed service.
- [ ] Record the **submitted commit** here once the last doc commit lands: the code was verified at
      `4eb94c0`; anything after it is documentation only, and `git log --oneline 4eb94c0..HEAD`
      shows exactly what.
- [ ] **[OWNER]** video recorded, uploaded, link checked signed out. **This is the last real blocker.**
- [ ] **[OWNER]** finale date resolved (6 vs 7 October), organiser question asked about the testnet
      integration, form submitted, receipt retained.

### Done condition

If a core payment or integration requirement is still unresolved when the form is submitted, this is
a **prepared submission package with an explicit blocker**, not a completed release. Say so rather
than rounding up.
