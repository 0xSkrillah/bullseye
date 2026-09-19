# Handoff

State of the build on 18 September 2026 (build day 2 of 9). Submission closes 25 September 2026,
23:59 UTC. Read [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) before repeating any claim.

## 19 September: fixes after an outside review

An outside review of commit `1ae8e79` found three things that mattered: the browser could not
finish or recover a purchase as the buyer's own, the read routes gave away buyers' orders and
most of what a Brief sells, and the gate's number rule accepted figures with no evidence. All
three were reproduced and fixed on branch `claude/bullseye-okx-submission-10d181`. **That branch
is not merged and not deployed**: a push to `main` deploys, and that is the owner's call. Until
then the deployed service behaves as it did on 19 September (CLAIM_LEDGER V41).

What the branch adds, with the ledger row that says how each is verified:

| | |
| --- | --- |
| Buyer flow (V34, V35) | A claim token chosen before signing; one signature per purchase; recovery after a lost response, a reload, a second click or a failed write to storage; buyer-authorised reconcile; `GET /api/orders/:id/delivery`; the agent buyer journals its purchase and resumes instead of re-signing. |
| Access (V37) | `GET /api/orders` is an operator route; one order is answered to its claim token only; the public view of an investigation keeps the steps and leaves out what the chain showed, each check's verdict and per-run cost; `VIEWER_TOKEN` reads diagnostics and starts nothing. |
| Gate 2.0.0 (V36) | Figures bind to declared, typed quantities by unit, sign and rounding; counts are computed; no small-integer exemption; still eleven rules and still no model in the gate. |
| Value and evidence | The Brief screen states the issuer's notice, what the desk checked, and the purchase, in that order; the gate's decision shows before purchase; evidence ids open the drawer; the delivery downloads as JSON; four clocks are kept apart and a late first detection is labelled retrospective. |
| Economics (V38) | `GET /api/desk/economics`: each investigation counted once, rejected and unsold work included, revenue only for chain-verified mainnet orders. |
| Proof (V39 to V41) | A restart test over a database file; a fresh-clone run of every suite; a CI workflow; a read-only snapshot of the deployed service. |

Tests on the branch, 19 September, Node 26.7.0: `npm run typecheck` clean; `npm test` API 238 in
20 files, web 53 in 5; `npm run test:e2e` 7 browser tests (`PW_CHANNEL=msedge`); `npm run build`
ok. The same from a fresh clone (V40). Baseline before the branch, at `84e4a22`: API 162 and 1
skipped in 16 files, web 27 in 3, 3 browser tests.

**What is proved where.** Everything above is proved offline: recorded data, fixture synthesiser,
fixture rail, a stand-in wallet. On a real rail there is still exactly one settlement, by the
agent buyer, against localhost (18 September). Nothing has been bought from the deployed address,
no browser purchase has used a wallet extension, and no live model draft has met gate 2.0.0. An
unknown outcome cannot be forced on the real facilitator; if it does not recur by itself that
case stays a fixture-rail demonstration and has to be labelled as one.

**Decisions waiting for the owner**, in the order they unblock things:

1. Send the organisers' question in [docs/SUBMISSION_DRAFTS.md](docs/SUBMISSION_DRAFTS.md): does a
   testnet x402 integration at a public URL satisfy "publish or integrate a working service
   through OKX AI", and is the finale on 6 October (terms page) or 7 October (builder kit)? Do not
   book travel until that is answered.
2. Review and merge the branch. The Situation Room changes that move the wall to
   `/api/commerce/summary` and `/api/desk/economics` belong in the same merge, or the wall loses
   its order and cost panels when the public view ships.
3. Decide whether the wall gets a `VIEWER_TOKEN` on Railway (read-only; without it the public wall
   shows steps and counts, not on-chain figures or cost). This is a change to production
   configuration and is the owner's to make.
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

Tests on `main`, all passing on 19 September: `npm test` (API 163 tests in 16 files, web 27 in
3 files including the design system's five brand rules), `npm run test:e2e` (3 browser tests,
offline configuration; `PW_CHANNEL=msedge` uses an installed browser; the fixes branch has more,
see the section above), `npm run spike` (live checks; every
step PASS except the mock-merchant payment, which is BLOCKED). Offline fallback:
`npm run start:offline`.
Repository: https://github.com/0xSkrillah/bullseye. It was created **private**; check its
visibility, because it has to be public or shared with the review team before submission.

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
4. **Make the repository public**, or share it with the review team, if that has not been done.
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
- The investigation timeline endpoint is unauthenticated and shows evidence summaries on `main`.
  The fixes branch answers this: the public view keeps the steps and withholds what they found
  (CLAIM_LEDGER V37). Open until that branch is deployed.

## Web app: what is whose, and what is still open

`apps/web` is the design scaffold (`App.tsx`, `main.tsx`, `layout/`, `screens/`, `lib/`,
`test/brand.test.ts`) plus components, primitives, the wallet signer and the desk layout CSS written
to that scaffold's call sites. During integration `components/EconomicsReceipt.tsx` and
`components/RadarField.tsx` from the scaffold were replaced; the versions here satisfy the
scaffold's call sites and brand tests, and the design originals can be re-exported over them.

Open items in the scaffold. Closed on the fixes branch: the "Gate running" chip on a published,
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
