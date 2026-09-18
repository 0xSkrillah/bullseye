# Handoff

State of the build on 18 September 2026 (build day 2 of 9). Submission closes 25 September 2026,
23:59 UTC. Read [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) before repeating any claim.

## Where things stand

| Golden-path stage | Status |
| --- | --- |
| Real sourced RWA event | **Done, live.** xStocks corporate actions; 15 rebases on X Layer flagged on 18 Sep. |
| Detect | **Done.** Pure, reproducible detector. |
| Bounded investigation | **Built, not run live.** Governor and tool loop tested with a test double; no model key yet. |
| Evidence | **Done, live.** xStocks + X Layer mainnet reads, schema-validated, hashed, labelled. |
| Publication gate | **Done.** 11 rules, deterministic, tested per rule. |
| Bullseye Brief | **Done** as a product format; no live-model Brief exists yet. |
| Human / agent purchase | **Done** against a local facilitator double, using the real OKX client and seller SDKs. |
| Verified OKX / X Layer payment state | **Blocked.** Needs OKX portal credentials and a funded testnet buyer. |
| Delivery | **Done.** Idempotent; replay-safe. |
| Measured delivery economics | **Built.** Nothing real has been measured yet; receipts say so. |

Tests, all passing on 18 September: `npm test` (API 60, web 23 including the design system's five
brand rules), `npm run test:e2e` (3 browser tests, offline configuration; `PW_CHANNEL=msedge` uses
an installed browser), `npm run spike` (live checks). Offline fallback: `npm run start:offline`.
Repository: https://github.com/0xSkrillah/bullseye, currently **private**; it has to be public or
shared with the review team before submission.

## What only a person can do, in order

1. **OKX developer portal** → create API key, secret, passphrase → put them in `.env`
   (`OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`). Set `PAY_TO_ADDRESS` to a wallet you control.
2. **Anthropic API key** → `ANTHROPIC_API_KEY` in `.env`.
3. **Buyer wallet**: generate a throwaway key, fund it from the X Layer testnet faucet, put it in
   `BUYER_PRIVATE_KEY`. Check which token the faucet sends: the OKX SDK charges in `USD₮0`
   (`0x9e29…fb0c`) but the OKX mock merchant charges in `USDC_TEST` (`0xcb8b…c79d`). See SF-3.
4. Then run, and keep the artifacts:
   ```bash
   npm run spike                     # the two BLOCKED lines should turn PASS
   npm run dev                       # scan → investigate a fresh signal (first live-model Brief)
   npm run buy -- latest             # first real testnet settlement
   npm run verify-payment -- ord_…   # independent on-chain confirmation
   npm run demo -- <SYMBOL> --buy    # transcript for artifacts/evidence/
   ```
   Move CLAIM_LEDGER items P1, P2, P3 and B2 to **Verified** with those artifact paths. If any of
   them fails, write down what happened instead; do not relabel an offline run.
5. **Demand**: five interviews and three usability sessions ([docs/DEMAND.md](docs/DEMAND.md)). If they
   point at another signal type, swap the detector and toolbox; nothing else needs to change.
6. **Submission**: public repo, 2–4 minute video following [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md),
   the form at https://forms.gle/81S2gnFCzqSoeDEA7, and (for the track minimum "publish or
   integrate a working service through OKX AI") an A2MCP listing, which needs a public HTTPS
   deployment of the API and ASP registration.
7. Send SF-1 to SF-4 from [docs/SPONSOR_FEEDBACK.md](docs/SPONSOR_FEEDBACK.md) to the OKX builders'
   channel; retest SF-2 and SF-3 once the buyer is funded.

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
- **No server-side model fallback.** A refusal or outage stops the investigation; the cost ledger
  prices exactly one model.

## Open questions for the owner

- The design system's copy defines HISTORICAL as "a recording of a real past response, **or a read
  of past chain state**". The code labels a live archive read LIVE with a past `observedAt`, and
  reserves HISTORICAL for replayed recordings. One of the two should change.
- `docs/design-system/design-system.json` is git-ignored because it records the tool it was made
  with. Everything else in that folder is committed as delivered.
- The investigation timeline endpoint is unauthenticated and shows evidence summaries. Fine for a
  demo desk; it should sit behind operator auth before anything real is sold.

## Web app: what is whose, and what is still open

`apps/web` is the design scaffold (`App.tsx`, `main.tsx`, `layout/`, `screens/`, `lib/`,
`test/brand.test.ts`) plus components, primitives, the wallet signer and the desk layout CSS written
to that scaffold's call sites. During integration `components/EconomicsReceipt.tsx` and
`components/RadarField.tsx` from the scaffold were replaced; the versions here satisfy the
scaffold's call sites and brand tests, and the design originals can be re-exported over them.

Open items in the scaffold, left for its owner:

- The Brief header chip reads "Gate running" on a published, unpurchased Brief (it is given the
  gate only after delivery).
- "View evidence first" on the paywall does nothing yet.
- A declined wallet signature or a quote mismatch raises no banner (`pay` has no catch).
- The Console does not pass `payment.chainVerified` to the receipt, so a chain-verified price
  would not turn green; `EconomicsReceipt` accepts an optional `chainVerified` prop for this.
- The PAYMENT_UNKNOWN sentence says "after 90 s"; nothing in the API enforces that figure.
- `tokens.css` in the app lacks the light theme block that `docs/design-system/tokens.css` has.
- After an unknown payment is reconciled to PAID, delivery happens when the buyer presses Pay
  again: the signer re-sends the same authorization (one per quote, held for its validity
  window), so nothing is signed or settled twice. The screen does not explain this yet.

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
