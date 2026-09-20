# Handoff

State of the build on 18 September 2026 (build day 2 of 9). Submission closes 25 September 2026,
23:59 UTC. Read [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) before repeating any claim.

## 20 September: the customer journey through the frontend

On branch `claude/frontend-journey`, not yet merged. A frontend design pack reviewed `f590f5a` and
published nine findings; all nine were reproduced against that commit — in a browser where a
browser could show them — and all nine are fixed, along with one more found on the way. The pack
itself is in [docs/frontend-pack](docs/frontend-pack); the evidence, the limits and what was **not**
tested are in [docs/frontend-pack/QA_REPORT.md](docs/frontend-pack/QA_REPORT.md).

**The one that mattered.** The Market Desk offered `/?brief=<id>` and the desk read no such thing:
the button promising one specific paid report landed the buyer on an empty desk, which then locked
whichever event was newest. The query now says what is on screen, `?brief=` resolves through the
existing preview route to the Brief's own event, and Back, Forward, a reload and a pasted link all
agree. An id that resolves to nothing says so rather than quietly showing a different report.

**Second: the desk did not fit a laptop.** Three columns needed 1312 px and switched to two at
1199, so at 1200 and at 1280 the console was pushed off the side of the page. Three columns now
start where three columns fit. Measured at ten widths on three routes: no page scrolls sideways
anywhere.

The rest: the Market Desk leads with the event and the offer — what the document contains, what it
costs, on which rail and network, and that a testnet payment is not revenue — instead of burying it
under the machinery; the event picker stays on the page and works from the keyboard; the evidence
dialog takes the keyboard and gives it back, on one shared implementation with the desk drawer;
`--ink-muted` went from 4.05:1 to 5.12:1; failure states tell a visitor what happened instead of
telling them to start an API; `?theme=light` is a theme the app has rather than one it advertised;
and the `/room` link, which rendered the ordinary desk because there is no such route on `main`, is
gone until the Situation Room branch lands.

Six new browser tests, each run against the code before its fix and observed to fail there. Node
26.7.0: `npm run typecheck` clean; `npm test` API **294 in 21**, web **81 in 6** — unchanged, with
nothing skipped or weakened; `PW_CHANNEL=msedge npm run test:e2e` **17** (was 11); `npm run build`
ok. Nothing was deployed, no wallet was used and no real payment was made.

## 20 September: the Market Desk

A customer-facing, read-only screen at `/market` that reads one verified event as money and answers
one question: is this still interesting once the data, the adjustments and the costs have been
checked. Written up in [docs/MARKET_DESK.md](docs/MARKET_DESK.md); claims are CLAIM_LEDGER V45 to
V51. **Merged to `main` and deployed on 20 September** at the owner's instruction, together with the
SF-8 fix below. Feature freeze is still 24 September.

**The answer it gives is no, and that is the deliverable.** Two hours were budgeted for proving the
data first. Inside that box, `npm run market-probe` established from live responses that the
permitted sources publish no bid, no ask, no size, no expiry, no venue and no fee schedule for any
asset (`/quote`, `/quotes`, `/orderbook`, `/book` and `/depth` all 404), that `price-data` is a bare
nullable number with no currency and no observation time of its own, and that the three supply
figures are not in one unit or scope. So the desk ships EVENT IMPACT ONLY, with missing-data states,
and no opportunity was manufactured to fill the gap. Four new sponsor findings, SF-8 to SF-11.

What it does show, from real recorded data: the balance change in exact decimals; the two ways to be
wrong about a rebase, which are different numbers off different bases; the issuer against the chain
at 18 decimals; the same event valued at the issuer's reference price for a stated holding; and the
price the issuer's own multiplier implies it reinvested at, which reconstructs its arithmetic
exactly (`0.4875` at `73.29`) and differs from its current reference price mostly because the two
were observed nineteen hours apart.

| | |
| --- | --- |
| Arithmetic | Integer arithmetic on `BigInt` at 36 decimal places, from decimal strings, rounded once. No model writes a number. A value that does not parse is refused, not repaired. |
| Labels | EVENT IMPACT · REFERENCE DISCREPANCY · ESTIMATED QUOTED SPREAD (never used; it exists so the screen can name what is missing) · INSUFFICIENT DATA. The label renders before the value. |
| Costs | Each named, with `ISSUER_PUBLISHED` or `UNKNOWN`. An unknown cost stays unknown and no net figure is offered while one is. |
| Access | No access rule changed. It reuses `projectChain`: a visitor gets the issuer's public figures, is told how many chain reads exist, and gets none of their values — nor any figure derived from them, which would give the number away by arithmetic. |
| Cost to run | A page load makes no external call and spends nothing. The probe makes ten free unauthenticated reads and one free `eth_call`. No model, no payment, nothing signed. |
| Scope | Read-only. No brokerage, execution, leverage, key custody or new contract. The Situation Room, the detector, the gates, the buyer flow and the paid Briefs are untouched. |

Tests at the end of the slice, Node 26.7.0: `npm run typecheck` clean; `npm test` API **294 in 21
files**, web **81 in 6**; `PW_CHANNEL=msedge npm run test:e2e` **11 browser tests**; `npm run build`
ok. Baseline before it, at `e0b9892`: API 250 in 20, web 59 in 5, 7 browser tests. Layout checked at
375, 768 and 1440 px with no horizontal overflow.

**Deliberately not built: the forward tracker.** The brief made it optional and conditional on the
core passing. An honest tracker has to accumulate observations over days before it shows anything,
the submission closes on 25 September, and it would need new persistence during a feature freeze. A
tracker that could not produce an outcome series before the deadline would look like evidence
without being any.

**SF-8 is fixed, at the owner's instruction.** The live `price-data` endpoint returns
`{"quote": null}` whenever the underlying market is closed, which is most of the week, and two
faults compounded to lose that answer: `XsPrice` read `quote` as a positive number, so the body was
rejected; and the read was abandoned at the transport's 20 s ceiling, because the endpoint answers at
about 20.1 s, after which — with caching on — the last price was served in its place, labelled
CACHED. A stale price is a worse answer than "there is no price".

Both are fixed. `quote` is a nullable positive number, `EV-PRICE` records a null as "the issuer
publishes no reference price at this time" with its provenance and hash, and the per-read ceiling is
now 30 s (`SOURCE_TIMEOUT_MS`, default `DEFAULT_SOURCE_TIMEOUT_MS`). Anything that is not a positive
number and not null is still refused, so the schema did not become permissive, and a read that
genuinely times out is still CACHED with its reason rather than becoming a null quote. A null cannot
ground a figure in a draft, and `CHK-REBASE-SIZE-PLAUSIBLE`, which divides by the price, reports
UNKNOWN instead of failing; the four core checks are untouched.

Verified live through the adapter on 20 September: `quote=null`, mode LIVE, in 20.8 s (QSRx) and
20.2 s (IFFx), both of which the old ceiling would have aborted. Eight tests cover it, four in
`transport.test.ts` and four in `market.test.ts`; the first was written before the fix and confirmed
failing against the old code. No stored record changes shape: `EvidenceValue` already allowed null,
and only new runs are affected.

**The Situation Room is still not on `main`,** and it is not in this branch either. It exists only
as uncommitted work in the worktree at `.claude/worktrees/bullseye-situation-room-a091ef`, based on
`84e4a22`, which is now behind `main`. Nothing in this slice touched it. To keep a later merge cheap
this branch adds its route as a four-line branch in `apps/web/src/main.tsx` — the same shape the
Room uses, so both `if` blocks can be kept — puts every other file under `apps/web/src/market/`,
reads the API through the existing `getJson` rather than editing `lib/api.ts`, and puts the link to
`/market` in `apps/web/src/layout/Desk.tsx`, which the Room does not modify. The Room worktree does
modify `App.tsx`, `main.tsx`, `lib/api.ts`, `lib/usePoll.ts`, `screens/Console.tsx` and the design
tokens, and its `App.tsx` predates the buyer-flow hardening, so that merge still needs a careful
read.

## 19 September: fixes after an outside review

An outside review of commit `1ae8e79` found three things that mattered: the browser could not
finish or recover a purchase as the buyer's own, the read routes gave away buyers' orders and
most of what a Brief sells, and the gate's number rule accepted figures with no evidence. All
three were reproduced and fixed, reviewed before merging by readers who had not written the fixes
(nine further findings, all fixed: CLAIM_LEDGER V42), and **merged to `main` as `826820d` and
deployed on 19 September** at the owner's instruction (V43). The first CI run on that commit is
green (V44). What the deployed service showed before the merge is kept in V41.

What the branch adds, with the ledger row that says how each is verified:

| | |
| --- | --- |
| Buyer flow (V34, V35) | A claim token chosen before signing; one signature per purchase; recovery after a lost response, a reload, a second click or a failed write to storage; buyer-authorised reconcile; `GET /api/orders/:id/delivery`; the agent buyer journals its purchase and resumes instead of re-signing. |
| Access (V37) | `GET /api/orders` is an operator route; one order is answered to its claim token only; the public view of an investigation keeps the steps and leaves out what the chain showed, each check's verdict and per-run cost; `VIEWER_TOKEN` reads diagnostics and starts nothing. |
| Gate 2.0.0 (V36) | Figures bind to declared, typed quantities by unit, sign and rounding; counts are computed; no small-integer exemption; still eleven rules and still no model in the gate. |
| Value and evidence | The Brief screen states the issuer's notice, what the desk checked, and the purchase, in that order; the gate's decision shows before purchase; evidence ids open the drawer; the delivery downloads as JSON; four clocks are kept apart and a late first detection is labelled retrospective. |
| Economics (V38) | `GET /api/desk/economics`: each investigation counted once, rejected and unsold work included, revenue only for chain-verified mainnet orders. |
| Proof (V39 to V44) | A restart test over a database file; a fresh-clone run of every suite; CI, green on its first run; a read-only snapshot of the deployed service before the merge and a 19-point read-only check of it after. |

Tests at `826820d`, 19 September, Node 26.7.0: `npm run typecheck` clean; `npm test` API 250 in
20 files, web 59 in 5; `npm run test:e2e` 7 browser tests (`PW_CHANNEL=msedge`); `npm run build`
ok. The same from a fresh clone (V40). Baseline before the branch, at `84e4a22`: API 162 and 1
skipped in 16 files, web 27 in 3, 3 browser tests.

**What is proved where.** Everything above is proved offline: recorded data, fixture synthesiser,
fixture rail, a stand-in wallet. The deployed service has been read back and serves the new
contract (V43), which is not the same as anyone buying from it. On a real rail there is still
exactly one settlement, by the agent buyer, against localhost (18 September). Nothing has been
bought from the deployed address,
no browser purchase has used a wallet extension, and no live model draft has met gate 2.0.0. An
unknown outcome cannot be forced on the real facilitator; if it does not recur by itself that
case stays a fixture-rail demonstration and has to be labelled as one.

**Decisions waiting for the owner**, in the order they unblock things:

1. Send the organisers' question in [docs/SUBMISSION_DRAFTS.md](docs/SUBMISSION_DRAFTS.md): does a
   testnet x402 integration at a public URL satisfy "publish or integrate a working service
   through OKX AI", and is the finale on 6 October (terms page) or 7 October (builder kit)? Do not
   book travel until that is answered.
2. Done: merged and deployed (V43). Run `git pull` in the main checkout, which is behind
   `origin/main` until then. The Situation Room is not on `main` yet; when it lands it has to read
   `/api/commerce/summary` and `/api/desk/economics`, because `GET /api/orders` now answers `403`
   to visitors.
3. Decide whether the wall gets a `VIEWER_TOKEN` on Railway (read-only; without it a public wall
   shows steps and counts, not on-chain figures or cost). None is set. This is a change to
   production configuration and is the owner's to make.
4. Approve a bounded testnet spend (each purchase is 3 test USD₮0; the buyer held 7) and run, from
   the main checkout where `.env` holds the buyer key: one agent purchase
   (`npm run buy -- latest --base https://bullseye-production-5d0c.up.railway.app`), then
   `npm run verify-payment -- <orderId>`, then one browser purchase with a wallet extension on X
   Layer testnet. Keep the delivery envelopes; they carry no key, signature or claim token.
   `data/purchases/` does carry them and must never be committed.
5. Start the ASP registration by 23 September if the organisers' answer makes it useful.
6. Record the video only after step 4 works.
7. Interviews and usability sessions: the guides are in [docs/DEMAND.md](docs/DEMAND.md). Record
   what actually happens, including nothing.

Feature freeze is 24 September. The target is to submit by 20:00 UTC on 25 September.

## Where things stand

Every golden-path stage has now run live once, on 18 September 2026 between 21:37 and 22:04 UTC,
with one exception: the purchase ran live as an agent purchase only, not from the browser wallet.
"The transcript" below is `artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`.

| Golden-path stage | Status |
| --- | --- |
| Real sourced RWA event | **Ran live.** QSRx CashDividend, issuer action `7b14c6dc-1532-4d64-908f-3c98b05efe94` v2, multiplier 1 → 1.0066516577977895, effective 2026-09-18T00:30:00Z. Artifact: `artifacts/integration/spike-2026-09-18T21-37-16-168Z.json`; the transcript, step `signal`. |
| Detect | **Ran live.** 15 signals from the 50 newest corporate actions; `sig_24ecf336903c1da1` (QSRx) was taken forward. Pure, reproducible detector. Artifact: the transcript, step `detect`. |
| Bounded investigation | **Ran live once.** 4 model calls through `openrouter/auto` (medium tier), routed to `deepseek/deepseek-v4-pro` and `openai/gpt-5.6-terra`; 10 tool calls; $0.071725 against the $0.60 ceiling. Artifact: the transcript, step `investigation`. |
| Evidence | **Ran live.** 10 evidence items, all LIVE; 9 of 9 consistency checks PASS. On X Layer the multiplier was 1 at block 70922304, 1.0066516577977895 at block 70922424, and first changed in block 70922364 (00:30:00Z). Artifact: the transcript, step `investigation`; the evidence items are inside the delivery envelope. |
| Publication gate | **Ran live once.** It rejected the first draft on rule SCHEMA, then published the one permitted revision after all 11 rules passed. Artifact: the transcript, steps `investigation` and `gate`. |
| Bullseye Brief | **One live Brief.** `brf_a790c648a87d52dd`, dataMode LIVE, confidence cap HIGH, content hash `a2062d65d7e88c01…`. No quality evaluation exists. Artifact: `artifacts/evidence/delivery-ord_8a2102084ad69dab.json`. |
| Human / agent purchase | **Agent purchase ran live once** (`npm run buy -- latest`): unpaid request answered 402 with a `PAYMENT-REQUIRED` header, quote `quo_7fde34706f1b7eba`, 3000000 base units of testnet USD₮0, one signed authorization, order `ord_8a2102084ad69dab`. The browser-wallet purchase has run only in the offline configuration (`npm run test:e2e`). Artifact: the transcript, step `unpaid request`; the delivery envelope. |
| Verified OKX / X Layer payment state | **Ran live once, on testnet.** The facilitator answered `timeout`; the order went PAYMENT_UNKNOWN, was reconciled from the chain to PAID, then DELIVERED. Tx `0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`, X Layer testnet block 41310183; buyer USD₮0 10 → 7, payTo 0 → 3, one transfer. `npm run verify-payment` verdict: VERIFIED. Artifact: `artifacts/integration/payment-ord_8a2102084ad69dab.json`. |
| Delivery | **Ran live once.** One delivery, after reconciliation; `settle` was called once. Idempotent; replay-safe. Artifact: `artifacts/evidence/delivery-ord_8a2102084ad69dab.json`. |
| Measured delivery economics | **Measured once.** Model cost $0.071725 as billed by the provider; OpenRouter's own ledger for the key agrees to within $0.0000013 (rounding). Receipt: price $3.00, not revenue (testnet), estimated allowances $0.45, estimated contribution $2.478275, which is an estimate and excludes labour, hosting, acquisition, overhead and tax. Artifact: the transcript, `usage` block; `artifacts/integration/model-check-2026-09-18T21-57-37-431Z.json`. The receipt itself is not in an artifact file; `GET /api/orders/ord_8a2102084ad69dab` serves it from that run's database, `data/live-run.sqlite` (git-ignored). |

That is one investigation and one testnet settlement: n=1. It is not a rate, not a benchmark and
not evidence of demand. No quality evaluation, rejection rate, detector recall or latency
measurement exists. Testnet payments are not revenue, and estimated contribution is not profit.

Still blocked: the mock-merchant test payment (CLAIM_LEDGER B1; SF-1: OKX's client SDK cannot
parse the mock merchant's challenge). SF-2 is still untested end to end.

Tests before the fixes, all passing on the morning of 19 September: `npm test` (API 163 tests in
16 files, web 27 in 3 files including the design system's five brand rules), `npm run test:e2e`
(3 browser tests, offline configuration; `PW_CHANNEL=msedge` uses an installed browser; today's
totals are in the section above), `npm run spike` (live checks; every
step PASS except the mock-merchant payment, which is BLOCKED). Offline fallback:
`npm run start:offline`.
Repository: https://github.com/0xSkrillah/bullseye. GitHub reported it as public on 19 September
2026; open it in a signed-out window before submitting all the same.

## What only a person can do, in order

The credentials are in place (OpenRouter key, OKX portal keys, `PAY_TO_ADDRESS`, a funded testnet
buyer) and the live commands have been run once; their artifacts are in the table above. What
remains:

1. **Demand**: five interviews and three usability sessions ([docs/DEMAND.md](docs/DEMAND.md)). None
   has been run. If they point at another signal type, swap the detector and toolbox; nothing
   else needs to change.
2. **Demo video**: 2–4 minutes, following [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md). Not recorded
   yet. A recorded Mode A run exists to work from; a new live run spends model credit and testnet
   tokens.
3. **OKX AI A2MCP listing** (the track minimum: "publish or integrate a working service through
   OKX AI"). The endpoint side is ready: `/api/v1/briefs/latest` answers `POST` with a `402` and a
   `PAYMENT-REQUIRED` header (OKX's self-test, passed on localhost), and `AUTO_DESK=true` keeps
   Briefs coming without an operator. It is deployed at https://bullseye-production-5d0c.up.railway.app
   (Railway, from `main`). What is left needs the owner: enter `OPENROUTER_API_KEY`, `OKX_API_KEY`,
   `OKX_SECRET_KEY` and `OKX_PASSPHRASE` in the Railway service's variables (the auto desk then
   starts investigating, at most 3 a day), run the self-test against the deployed address once a
   Brief is on sale, and register the ASP. Steps in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
4. **Repository visibility**: public as of 19 September 2026. Check it signed out before submitting.
5. **Submission form**: https://forms.gle/81S2gnFCzqSoeDEA7.
6. **Sponsor feedback**: send SF-1 to SF-7 from [docs/SPONSOR_FEEDBACK.md](docs/SPONSOR_FEEDBACK.md)
   to the OKX builders' channel. SF-7 is the facilitator `timeout` observed on
   `ord_8a2102084ad69dab`. SF-1 still blocks the mock-merchant payment and SF-2 is still untested
   end to end. How the buyer wallet was funded was not observed, so SF-3's question (which token
   the faucet sends) is still open.

Checked against the deployed address on 19 September 2026, after the hardening commits: scan,
investigate and reconcile answer `403`, with or without a bearer token (none is configured); a
`PAYMENT-SIGNATURE` header that decodes to `null` gets the normal reply, not a `500`; and of 14
payment attempts in a minute from one machine, each with a different forged `X-Real-IP` and
`X-Forwarded-For`, the 13th and 14th were answered `429` (the limit is 12). Before
`CLIENT_IP_HEADER=x-real-ip` was set, all 14 passed. Later that day, with the keys entered on the
host, the auto desk published `brf_9aac63b6842fb78e` and `POST /api/v1/briefs/latest` on the
deployed address returned `402` with a complete `PAYMENT-REQUIRED` header (OKX's self-test). A
payment through the deployed address is still to do:
`npm run buy -- latest --base https://bullseye-production-5d0c.up.railway.app` from the main
checkout, where `.env` holds the buyer key (3 testnet USD₮0; the buyer held 7).

To repeat the live run, and keep the artifacts:

```bash
npm run wallet                    # buyer address and testnet balances; READY or NOT READY
npm run model-check               # one tiny metered model call, checked against OpenRouter's key ledger
npm run spike                     # every step PASS except the mock-merchant payment (BLOCKED, SF-1)
npm run dev                       # leave it running; the commands below use a second terminal
npm run demo -- <SYMBOL>          # scan → investigate → gate → unpaid 402; transcript in artifacts/evidence/
npm run buy -- latest             # agent purchase on X Layer testnet; prints the order id
npm run verify-payment -- ord_8a2102084ad69dab   # independent on-chain check of that order
```

`<SYMBOL>` is an xStock ticker the detector has flagged, such as `QSRx`; `demo` lists the flagged
tickers if it does not match. `npm run demo -- <SYMBOL> --buy` does the purchase in the same
transcript. The buyer held 7 testnet USD₮0 after the first purchase. If a run fails, write down
what happened; do not relabel an offline run.

## Decisions taken, and why

- **First product: rebase verification on X Layer.** Only candidate that passed four of the five
  gates today with keyless public data and an independent on-chain check. Demand is the open gate.
- **Low-level OKX SDK, not the Express middleware.** The middleware delivers inside the request
  and has no notion of a durable order; using `x402ResourceServer` directly lets the ledger own
  idempotency, unknown outcomes and reconciliation.
- **No challenge without a working rail.** With missing credentials the API answers 503. A 402
  nobody can settle would look like an integration and would not be one.
- **Default price $3.00, budget $0.60, reserves $0.45.** Dossier's illustrative price; at $1.00 the
  economic pre-check correctly declines the default budget.
- **`node:sqlite`.** No native build step on any judge's machine.
- **Synthesis through OpenRouter's Auto Router (`openrouter/auto`), medium cost tier, under a hard
  price cap.** The router picks the model, so it is not known before the call.
  `provider.max_price` ($3 prompt, $15 completion per million tokens) is a hard filter that also
  applies to routed models, and the same figures are the budget governor's worst-case rates, so
  the governor can refuse a call before it is made. Each call is costed at what OpenRouter reports
  charging (`usage.cost`), and the usage record names the model that answered. `medium` is the
  default tier (`OPENROUTER_COST_TIER`). `SYNTHESIS_PROVIDER=anthropic` remains as an option;
  `fixture` is the test double.
- **No blind retries of model calls.** One governor approval is one billable request. A timeout,
  a dropped connection, an unreadable 200 body, a 408 or a 5xx is not re-sent, because the model
  may have run and been billed. Only HTTP 429 and connections that never opened are retried. A
  call whose charge is unknown is carried at a ceiling (request size and `max_tokens` at the
  price cap, shown under ESTIMATED), never at zero.
- **No fallback between providers.** If OpenRouter rejects the request (credentials, credit, no
  endpoint within the price cap) or cannot be reached, the investigation stops with
  `MODEL_UNAVAILABLE`; a model refusal stops it with `MODEL_REFUSED`. Neither switches to
  Anthropic or to the fixture.
- **Supersession rule for issuer records.** The issuer's history is append-only by version: the
  same `eventId` appears once per version and earlier rows never change. Without a rule, an
  earlier version of a cancelled action could still fire. A later Cancelled row voids the version
  it names in `[CANCELLED vN]` (or the previous live version). A later live row that starts from
  the same `multiplierOld` replaces the earlier row. A later live row that starts where the
  earlier row ended is a further rebase and both stand (seen live: LINx `5cedd8fc` v2 then v3
  "Corrected"). Cancelled and superseded rows never become signals, core check
  `CHK-ACTION-STILL-CURRENT` fails if the issuer voids an action after it was flagged, and a Brief
  about a voided action is withdrawn from sale (`410 brief_withdrawn`); a buyer who already paid
  still gets delivery. The rule is `supersededBy` in `apps/api/src/signals/rebaseDetector.ts`.

## Open questions for the owner

- The design system's copy defines HISTORICAL as "a recording of a real past response, **or a read
  of past chain state**". The code labels a live archive read LIVE with a past `observedAt`, and
  reserves HISTORICAL for replayed recordings. One of the two should change.
- `docs/design-system/design-system.json` is git-ignored because it records the tool it was made
  with. Everything else in that folder is committed as delivered.
- Closed on 19 September: the investigation timeline was unauthenticated and showed evidence
  summaries. The public view now keeps the steps and withholds what they found (CLAIM_LEDGER V37,
  read back from the deployment in V43).

## Web app: what is whose, and what is still open

`apps/web` is the design scaffold (`App.tsx`, `main.tsx`, `layout/`, `screens/`, `lib/`,
`test/brand.test.ts`) plus components, primitives, the wallet signer and the desk layout CSS written
to that scaffold's call sites. During integration `components/EconomicsReceipt.tsx` and
`components/RadarField.tsx` from the scaffold were replaced; the versions here satisfy the
scaffold's call sites and brand tests, and the design originals can be re-exported over them.

Open items in the scaffold. Closed on 19 September: the "Gate running" chip on a published,
unpurchased Brief; "View evidence first" doing nothing; a declined signature or a quote mismatch
raising no banner; and delivery after a reconciled unknown payment needing a second press of Pay
(the buyer's reconcile now collects the Brief, and the screen says what is happening). Still open:

- The Console does not pass `payment.chainVerified` to the receipt, so a chain-verified price
  would not turn green; `EconomicsReceipt` accepts an optional `chainVerified` prop for this.
- The PAYMENT_UNKNOWN sentence says "after 90 s"; nothing in the API enforces that figure.
- `tokens.css` in the app lacks the light theme block that `docs/design-system/tokens.css` has
  (the Situation Room work adds it).

## Things that will bite

- Something other than this build writes to the repo and runs git in it (the design system
  arrived mid-build, and `.git/index.lock` was left behind twice). Before deleting a lock, check
  that no `git.exe` is running.
- The public X Layer RPC caps `eth_getLogs` at 100 blocks; the activation search bisects
  `eth_call` instead. Keep it that way.
- Recorded data covers IFFx and QSRx only. Other signals in offline mode stop with "not present
  in recording", by design.
- The detector looks back 96 hours over the 50 newest corporate actions and at most 12 assets per
  scan. If nothing qualifies on demo day, use the offline fallback and say so.
- The 50-row history page. The scan reads the 50 newest rows of the issuer's history across all
  symbols, and the `get_corporate_action` tool reads the 50 newest rows for one symbol. The history
  is append-only by version and held 758 records on 18 September, so supersession is judged only
  among the rows on the page, and an action can fall off it. If the signal's own row is no longer
  on the symbol's page the tool throws, mandatory evidence is missing and the gate rejects.
- Routed endpoints may not enforce strict structured output. In the live run the first draft did
  not match the JSON schema (that endpoint did not enforce `strict`), the gate rejected it on
  SCHEMA, and the one permitted revision passed. Budget for that revision: it was the dearest call
  of the run ($0.037156 of $0.071725) and it counts against the 6-call and $0.60 ceilings. One
  run; no rejection rate can be inferred from it.
- The facilitator can answer `timeout` for a payment that lands. With `syncSettle: true`, `settle`
  for `ord_8a2102084ad69dab` returned `status: "timeout"` with a transaction hash 1.87 s after it
  was called, and the transfer was confirmed in block 41310183. Do not treat `timeout` as failure
  and never settle again: record PAYMENT_UNKNOWN, deliver nothing, reconcile from the chain. One
  observation, not a rate.
- OpenRouter's key ledger (`GET /api/v1/key`) lagged the response by more than 3 s in the one
  call observed.
  `npm run model-check` read it 3 s after a billed call ($0.0005055) and still saw no change, so
  its artifact shows a usage delta of 0. Reconcile from a later read; the later read agreed with
  the recorded calls to within $0.0000013.
- `npm run model-check` stops before spending when the OpenRouter key has a limit and less than $1
  of it remains. A key with no limit passes that check, and then the only ceilings on model spend
  are Bullseye's own: the per-investigation budget ($0.60, 6 model calls) and the price cap.
- The router's cost tier is a plugin setting keyed by the router slug (`auto-router` for
  `openrouter/auto`, `auto-beta-router` for `openrouter/auto-beta`). OpenRouter silently ignores
  a tier sent under the other id. The id is derived from the slug in code; do not hard-code it.
