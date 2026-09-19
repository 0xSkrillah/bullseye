# Evaluation

## What is tested automatically

`npm test` (Vitest, no network, no keys) runs 105 API tests in 10 files under `apps/api/test/`
(`npx vitest run`), then 23 web tests in 3 files:

| Suite | What it proves |
| --- | --- |
| `detector.test.ts` | Reproducible output; required SignalEvent fields; versioned identity; ignores unchanged, future, out-of-window and non-X-Layer actions; weakest-mode labelling. |
| `gate.test.ts` | One passing case and a rejecting case for each rule: missing mandatory evidence, stale evidence, advice, unevidenced number, unevidenced timestamp, wrong quantity, unknown evidence id, undisclosed failed check, confidence above cap, fixture inputs, incomplete investigation, malformed draft. The gate is deterministic. |
| `investigation.test.ts` | Signal → published, hash-verified Brief; fixture output is not published unless allowed; no re-investigation; adverse synthesiser behaviours are blocked; tool-call, model-call and cost ceilings stop the run; uneconomic work is declined before spend; a missing model is reported, not substituted. |
| `ledger.test.ts` | Transition table; quote hash survives storage; tampering is detected; one authorization per order; expired quotes refused; illegal transitions leave the order untouched; state survives a restart. |
| `checkout.test.ts` | The OKX client SDK parses Bullseye's challenge, signs it and is served; state walk; replay and concurrent retries settle once; timeout and dropped connection become PAYMENT_UNKNOWN and reconcile without a second settle; explicit failure; invalid signature; immutable quotes; no challenge when the rail cannot settle; economics separation. |
| `transport.test.ts` | LIVE / CACHED / HISTORICAL / FIXTURE labelling; no silent fallback; schema mismatch is an error; the 18 Sep 2026 recording replays and reproduces the on-chain agreement. |
| `openrouter.test.ts` | The request sent to OpenRouter, against a stubbed `fetch`: `openrouter/auto` with the cost tier under the plugin id that belongs to the slug (`auto-router`; `auto-beta-router` for `openrouter/auto-beta`), `require_parameters` and the `max_price` cap, which a concrete model id keeps without a router plugin; tools on every collection request and never together with a response schema; the writing request is a fresh tool-free conversation with a strict `json_schema`, and a revision continues it. What comes back: the routed model and the billed amount; disjoint token classes; with a bring-your-own-key account the fee alone is not reported as the charge; a response without usage is carried at a ceiling, never at zero; a call that was billed and then failed still reports its cost; `length` is truncated, `content_filter` is a refusal, `error` throws; an error object inside an HTTP 200 is an error; malformed tool arguments reach the toolbox as something it rejects. Failures: 401, 402 and 503 mean the model is unavailable and are not retried; 429 is retried; a timeout and a 502 are sent once and never re-sent, and the timed-out call is carried at a ceiling with no billed amount; a connection that never opened is retried; the investigation's remaining time is consulted for the request timeout; the API key never appears in an error message; no provider without a key, an OpenRouter model id and positive price caps; the price caps are the governor's worst-case rates. Configuration defaults (`openrouter`, `openrouter/auto`, tier `medium`, caps 3 and 15); on a receipt a billed charge is MEASURED and an upper bound at the price cap is ESTIMATED. |
| `cancelled-actions.test.ts` | A Cancelled record with a null effective time does not stop the scan and never becomes a signal, even if it still carries a multiplier change; after a cancellation the earlier version still listed does not fire; after a correction the signal is raised on the corrected version only; a record that fails the schema is left out and reported in `skipped`; a page where most records fail is a `SchemaMismatchError`. For an action that was already flagged: a later cancellation appears in `EV-CA`, fails `CHK-ACTION-STILL-CURRENT` and caps confidence at LOW; a later version that starts from the same multiplier replaces it; a later version that starts where it ended is a further rebase and both stand; if an unreadable row might be a newer version, no version of the event is flagged and `get_corporate_action` throws; a stored signal is marked superseded on the next scan; an unchanged issuer record passes the check. |
| `spend-guard.test.ts` | The agent buyer's limits (`scripts/spend-guard.ts`) apply to the payment terms that would be signed: a quote within the limits is accepted, whatever the letter case of the asset address; with a limit of 5, a base-unit amount of `5000000` is accepted and `5000001` refused; any network that was not allowed is refused, not only X Layer mainnet; an unknown token contract is refused, including the testnet asset offered on `eip155:196`; non-integer, negative and zero amounts, schemes other than `exact` and a zero-address recipient are refused. |
| `costing-and-withdrawal.test.ts` | A model call that was billed and then failed is recorded at the billed amount (`MEASURED_PROVIDER_BILLED`); a call whose outcome is unknown is recorded at the price cap as `UPPER_BOUND_AT_PRICE_CAP`, never as measured and never as zero; a call that never reached a model costs 0 with `NO_MARGINAL_PRICE`. The usage summary keeps measured, upper-bound and budget spend apart and lists the routed models; usage rows written before the routed-model field existed still load. A Brief about an action the issuer has voided is withdrawn from sale: `410 brief_withdrawn`, no challenge, an authorization signed before the withdrawal is not settled, a buyer who had already paid still gets delivery, the catalogue omits the Brief and `GET /api/signals` shows the supersession. |
| `apps/web/test/brand.test.ts` | The five brand rules from the design system: estimates never green, badges carry their word, the PAYMENT_UNKNOWN sentence and no pay-again, no total spanning measured and estimated, a price is green only when paid and chain-verified. |
| `apps/web/src/__tests__` | Component contracts, and the wallet signer: nothing is signed when the 402 challenge differs from the quote on screen; one authorization per quote. |

The cancellation regression tests were checked against the pre-fix source: 5 of the 6 tests that
existed at the time failed there, and all passed with the fix. `cancelled-actions.test.ts` now has
12 tests.

`npm run test:e2e` (Playwright) runs three browser tests against the offline configuration: a draft
with an unevidenced number is held and never offered for sale; the golden path from recorded event
to delivered Brief and receipt, checking that the page renders the delivered JSON and that the
order is bound to the terms hash the buyer saw; and an unknown payment that delivers nothing,
reconciles, and completes with exactly one wallet signature.

`npm run spike` is the live check of the data sources and the payment rail. `npm run model-check`
makes one small metered model call and compares it with OpenRouter's own usage figure for the key.
Neither is part of `npm test`: both need the network, and `model-check` needs a key.

## The gate's number rule, precisely

Identifiers (`EV-…`, `CHK-…`, `0x…`, names like `x402`) are ignored. ISO timestamps, dates and
clock times must appear in the cited evidence. Every other number must equal some numeric value
in the cited evidence, its magnitude, or its ×100 percentage form, at the precision written.
Integers from 0 to 12 without a decimal point are treated as prose. Claims are checked against
the evidence they cite; headline, rationale, unknowns, conflicts and limitations are checked
against all evidence. The rule is blunt by design: a false rejection costs one revision, a false
acceptance publishes an unsupported number.

## Live runs

One investigation and one settlement have been run live, both on 2026-09-18. Each is a single
observation, not a rate.

**Investigation.** Signal `sig_24ecf336903c1da1`: QSRx, CashDividend, multiplier 1 →
1.0066516577977895. All data LIVE; synthesis through `openrouter/auto` at the medium tier. 10 tool
calls, 10 evidence items, 9 of 9 consistency checks PASS. 4 model calls, all
`MEASURED_PROVIDER_BILLED`, $0.071725 in total against a $0.60 ceiling. The first draft, from
`deepseek/deepseek-v4-pro`, did not match the Brief schema, because the routed endpoint did not
enforce strict structured output. The gate rejected it on rule SCHEMA. The one permitted revision,
routed to `openai/gpt-5.6-terra`, passed all 11 rules: decision PUBLISH, confidence cap HIGH, Brief
`brf_a790c648a87d52dd`. The recorded charges agree with OpenRouter's usage figure for the key:
$0.0722305 recorded, including the $0.0005055 `model-check` call, against $0.07222918 reported; the
difference is rounding to 6 decimals per record. Transcript:
`artifacts/evidence/demo-run-2026-09-18T22-01-13-583Z.json`.

It shows that the gate rejects a malformed draft from a real model, not only constructed ones, and
that the revision path works with a routed model. It does not show a rejection or revision rate,
or that the Brief is useful to a reader. SCHEMA was the only rule that fired, so the number, advice
and evidence rules have still only rejected constructed drafts.

**Settlement.** Order `ord_8a2102084ad69dab`: the project's own agent buyer (`npm run buy -- latest`)
paid `3000000` base units of testnet USD₮0 on X Layer testnet (`eip155:1952`) for that Brief. The
facilitator's `settle` returned `timeout` without a final outcome, so the order went to
PAYMENT_UNKNOWN and nothing was delivered. The buyer re-sent the same authorization; the seller found
the Transfer in block 41310183, moved the order to PAID and delivered once. The buyer signed one
authorization and `settle` was called once. `npm run verify-payment -- ord_8a2102084ad69dab` returned
VERIFIED (`artifacts/integration/payment-ord_8a2102084ad69dab.json`). USD₮0 balances read from the
chain: buyer 10 → 7, payTo 0 → 3, exactly one transfer. Transaction
`0xa2f4058c4a839f58e3dcdc574f2cd0090d76cffd0848d89cebd32d6cb723f28a`.

It shows that the PAYMENT_UNKNOWN path covered offline by `checkout.test.ts` also held once against
the real facilitator. It does not show how often the facilitator answers `timeout`, anything about
mainnet, or any demand: buyer and seller were both this project. The payment used test tokens and is
not revenue (`countsAsRevenue: false` on the receipt).

## What is not evaluated

- **Brief quality with the live model.** One live-model Brief exists (see Live runs). Nobody has
  graded it, so there is still no quality evaluation. One run gives no gate pass rate, rejection
  rate or revision rate, and its cost is one measurement, not an average. Still to do: run the
  investigator over every signal in `artifacts/recorded/`, record gate pass rate, revision rate,
  cost and latency per Brief, and have a domain reader grade usefulness blind.
- **Detector recall.** The detector's precision is checked against the chain; nothing measures
  events it misses.
- **Supersession rule.** The rule that decides which issuer versions are cancelled or replaced is
  tested against constructed histories and one recorded day, not a labelled corpus. The recorded day
  (`artifacts/recorded/xstocks-2026-09-18`) holds 50 rows, all `Initial`, one per event, so it
  exercises the rule only where nothing is superseded. The further-rebase case is modelled on one pair
  of rows seen live (LINx, v2 then v3 "Corrected"). The live history on 2026-09-18 held 17 Corrected
  and 15 Cancelled rows among 758; nobody has labelled which versions they void.
- **Advice filter recall.** The patterns are tested for the phrases they name, not against a corpus.
- **Latency.** Not measured, neither from event to detection nor per Brief; "real-time" is not
  claimed. In the live run the action took effect at 2026-09-18T00:30:00Z and was detected at
  21:58 UTC because that is when the scan was run, which is not a latency figure.
