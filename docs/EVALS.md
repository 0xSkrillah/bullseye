# Evaluation

## What is tested automatically

`npm test` (Vitest, no network, no keys) runs 239 API tests in 20 files under `apps/api/test/`
(`npx vitest run`), then 53 web tests in 5 files (`npm run test:web`). Counts are from a run of
both on the fixes branch on 19 September 2026; all passed.

| Suite | What it proves |
| --- | --- |
| `detector.test.ts` | Reproducible output; required SignalEvent fields; versioned identity; ignores unchanged, future, out-of-window and non-X-Layer actions; weakest-mode labelling. |
| `gate.test.ts` | 15 tests. One passing case and a rejecting case for each rule: missing mandatory evidence, stale evidence, advice, unevidenced number, unevidenced timestamp, wrong quantity, unknown evidence id, undisclosed failed check, confidence above cap, fixture inputs, incomplete investigation, malformed draft. The gate is deterministic. Its passing draft declares every figure it writes, as gate 2.0.0 requires. |
| `gate-grounding.test.ts` | 49 tests of gate 2.0.0's number rule, each run through the whole gate against a base draft that publishes, so a rejection is caused by the one thing the test changes. Unsupported figures: `$10` and `12%` in a claim and in the headline; a bare 7, 2 or 4 (no small-integer exemption); a declared figure whose evidence key has no registered unit. Sign: `-13 USD` for a cashflow of 13; a positive change or surplus written as a fall or a shortfall; "60 seconds after" for an offset of −60, with "60 seconds before" and "−60 seconds" accepted; two offsets in one sentence each bound by its own wording. Unit: a percentage written as `$0.33`, `0.33 USD` or bare; a USD amount written with `%`; a declared unit that contradicts the registry, with the unit to use named in the finding; `50 USD` and a bare 50 for a rate of 0.5, while `50%` and `0.5` pass; basis points and "3 million". Unrelated matches: a block number quoted as a holder count; a number held only by evidence the claim does not cite; a number the cited evidence holds but the claim did not declare; "3 checks passed" when a share count is 3 and 5 checks passed. Rounding: `1` and `1.00` for a multiplier of 1.003297609233 (and `1` accepted for a multiplier that is exactly 1); `0.3%` for 0.329761; `0.33%`, `1.0033` and the full values accepted; `66.5166%` for a ratio of 0.665166 without float noise. Derived counts right and wrong, and `rpcReads` written as a count. Timestamps: absent, held only by an uncited item, cut at a whole component, a bare date, an invented time of day, and a time that matches only as a substring. Stale evidence, missing mandatory evidence and advice still reject; "twelve percent" is refused and number words without a unit are left alone. With the issuer's cancellation in evidence: a disclosed conflict at LOW confidence publishes, and the same draft is rejected once the headline or the rationale claims a confirmation, or when the conflict is not disclosed. The recorded live Brief (`artifacts/evidence/delivery-ord_8a2102084ad69dab.json`) passes every rule of the new gate with its own evidence, judged at the instant it was first judged. The unit registry covers every numeric key the toolbox emits in both outcomes of the activation search. |
| `investigation.test.ts` | Signal → published, hash-verified Brief; fixture output is not published unless allowed; no re-investigation; adverse synthesiser behaviours are blocked; tool-call, model-call and cost ceilings stop the run; uneconomic work is declined before spend; a missing model is reported, not substituted. |
| `ledger.test.ts` | Transition table; quote hash survives storage; tampering is detected; one authorization per order; expired quotes refused; illegal transitions leave the order untouched; state survives a restart. |
| `checkout.test.ts` | The OKX client SDK parses Bullseye's challenge, signs it and is served; state walk; replay and concurrent retries settle once; timeout and dropped connection become PAYMENT_UNKNOWN and reconcile without a second settle; explicit failure; invalid signature; immutable quotes; no challenge when the rail cannot settle; economics separation. |
| `transport.test.ts` | LIVE / CACHED / HISTORICAL / FIXTURE labelling; no silent fallback; schema mismatch is an error; the 18 Sep 2026 recording replays and reproduces the on-chain agreement. |
| `openrouter.test.ts` | The request sent to OpenRouter, against a stubbed `fetch`: `openrouter/auto` with the cost tier under the plugin id that belongs to the slug (`auto-router`; `auto-beta-router` for `openrouter/auto-beta`), `require_parameters` and the `max_price` cap, which a concrete model id keeps without a router plugin; tools on every collection request and never together with a response schema; the writing request is a fresh tool-free conversation with a strict `json_schema`, and a revision continues it. What comes back: the routed model and the billed amount; disjoint token classes; with a bring-your-own-key account the fee alone is not reported as the charge; a response without usage is carried at a ceiling, never at zero; a call that was billed and then failed still reports its cost; `length` is truncated, `content_filter` is a refusal, `error` throws; an error object inside an HTTP 200 is an error; malformed tool arguments reach the toolbox as something it rejects. Failures: 401, 402 and 503 mean the model is unavailable and are not retried; 429 is retried; a timeout and a 502 are sent once and never re-sent, and the timed-out call is carried at a ceiling with no billed amount; a connection that never opened is retried; the investigation's remaining time is consulted for the request timeout; the API key never appears in an error message; no provider without a key, an OpenRouter model id and positive price caps; the price caps are the governor's worst-case rates. Configuration defaults (`openrouter`, `openrouter/auto`, tier `medium`, caps 3 and 15); on a receipt a billed charge is MEASURED and an upper bound at the price cap is ESTIMATED. |
| `cancelled-actions.test.ts` | A Cancelled record with a null effective time does not stop the scan and never becomes a signal, even if it still carries a multiplier change; after a cancellation the earlier version still listed does not fire; after a correction the signal is raised on the corrected version only; a record that fails the schema is left out and reported in `skipped`; a page where most records fail is a `SchemaMismatchError`. For an action that was already flagged: a later cancellation appears in `EV-CA`, fails `CHK-ACTION-STILL-CURRENT` and caps confidence at LOW; a later version that starts from the same multiplier replaces it; a later version that starts where it ended is a further rebase and both stand; if an unreadable row might be a newer version, no version of the event is flagged and `get_corporate_action` throws; a stored signal is marked superseded on the next scan; an unchanged issuer record passes the check. |
| `spend-guard.test.ts` | The agent buyer's limits (`scripts/spend-guard.ts`) apply to the payment terms that would be signed: a quote within the limits is accepted, whatever the letter case of the asset address; with a limit of 5, a base-unit amount of `5000000` is accepted and `5000001` refused; any network that was not allowed is refused, not only X Layer mainnet; an unknown token contract is refused, including the testnet asset offered on `eip155:196`; non-integer, negative and zero amounts, schemes other than `exact` and a zero-address recipient are refused. |
| `costing-and-withdrawal.test.ts` | A model call that was billed and then failed is recorded at the billed amount (`MEASURED_PROVIDER_BILLED`); a call whose outcome is unknown is recorded at the price cap as `UPPER_BOUND_AT_PRICE_CAP`, never as measured and never as zero; a call that never reached a model costs 0 with `NO_MARGINAL_PRICE`. The usage summary keeps measured, upper-bound and budget spend apart and lists the routed models; usage rows written before the routed-model field existed still load. A Brief about an action the issuer has voided is withdrawn from sale: `410 brief_withdrawn`, no challenge, an authorization signed before the withdrawal is not settled, a buyer who had already paid still gets delivery, the catalogue omits the Brief and `GET /api/signals` shows the supersession. |
| `listing.test.ts` | What a marketplace listing needs from the paid endpoint: `POST` gets the same v2 challenge as `GET` and reuses the open quote; a payment sent with `POST` settles once and delivers; other methods get `405`; `/api/v1/briefs/latest` names itself as `resource.url` and its quote is separate from the Brief's own address; the `symbol` filter works from the query and from a POST body; with nothing on sale the reply is `404 nothing_for_sale` with no challenge and no order; a buyer quoted one Brief still receives it after a newer one is published, with one settle call, and a replay is served from the same order; a withdrawn Brief is not offered; the catalogue advertises the address. The quoted-Brief test was checked against the code with the payment-to-quote lookup removed: it fails there. |
| `auto-desk.test.ts` | The unattended loop: a tick scans, investigates one new signal and a Brief is published; a signal whose first run was rejected is never started again; the daily ceiling stops a tick before it scans; nothing starts while an investigation is running, when the payment rail is not ready, or when the scan fails (reported as idle, not thrown); the worst-case daily model spend is the ceiling times the per-investigation budget. |
| `public-deployment.test.ts` | On a public `PUBLIC_BASE_URL` with no operator token, scan, investigate, the order list and the fixture control all answer `403 operator_routes_disabled`, reconcile answers `403 claim_token_required` to a bearer token that is not the operator's, and no investigation starts; with a token only `Authorization: Bearer <token>` is accepted (missing, wrong and bare tokens get `401`) and the right one starts the run; a configured token applies on localhost too; with none, localhost stays open; the buying path and the read-only desk stay open to everyone and quote the public address; a token too short to be a secret is a configuration error. The paid routes answer `429` with `Retry-After` and no challenge once one client passes the limit, while the desk's read routes and the health check are unaffected. |
| `payment-abuse.test.ts` | Found by a review of the service as a public deployment, each reproduced before it was fixed. A header forged from a settled order's public payer and nonce gets a `402` and no Brief, at the Brief's address and at the stable one. The exact signed payload replayed after delivery gets `403 claim_token_required`, a wrong token too, and the token from the first response gets the Brief, with one settle call throughout. A buyer whose outcome is unknown recovers with the same payload and no token, and is handed a token that works. The order routes never publish the payment key. A nonce consumed without the quoted transfer (`cancelAuthorization`) leaves the order at `RECONCILIATION_REQUIRED`, unverified and undelivered. A `PAYMENT_PENDING` order left behind by an interrupted settlement becomes `PAYMENT_UNKNOWN`, reconciles and delivers without a second settle. A payload with no signature, the wrong amount or recipient, an expired window or a malformed nonce opens no order and reaches no facilitator. Presenting payments is rate-limited separately from asking for challenges. A production build does not open the operator routes because `PUBLIC_BASE_URL` was left at localhost. Six of the first nine fail against the checkout code from before the fix; the other three exercise the HTTP layer. A second review of the fix itself added eight more: a buyer's token from the `503` still works after someone else recovers the same order with a copied payload; a buyer who chose their own token is never answered without it, even before delivery, and gets no server token; a delivery that was built but never written is not counted, so the payload still collects; two reconciliations of one order asked for at once are one reconciliation and overlapping recoveries produce no `500` and one token; a header that decodes to `null`, a string, an array or a number gets a `402`; an empty symbol filter is no filter; a body that is not JSON gets `400` and counts against the rate limit; a cross-origin preflight is granted the headers an x402 client asks for. |
| `prompts.test.ts` | 6 tests. The writing prompt names every key of the schema the provider is sent, so the Brief's shape does not depend on the routed endpoint enforcing `response_format`; it carries no sample values a model could copy; it names the unit of every registered value key, generated from the gate's own registry, and the gate accepts each unit it names; it tells the writer how figures are judged (declared, typed, signed, counted, not spelled out); a revision repeats the shape only when the rejection was about the shape, and the rules about figures only when the rejection was about figures. Written after the deployed desk's first run was rejected twice on `SCHEMA`. |
| `buyer-access.test.ts` | 11 tests. `GET /api/orders` answers `403` on a public deployment, `401` without the operator's token when one is set, and stays open on localhost. Two buyers of one Brief each read and collect only their own order; the other's token, and no token, get `403` on the order, its delivery and its reconcile, with two settle calls in all. An order that does not exist is answered exactly as a wrong token is, on the order and on its delivery. A token in the URL is ignored. With the claim token alone a delivered Brief is collected again with no `PAYMENT-RESPONSE`, no new quote and one settle call, and the delivery is counted; the server-issued token works the same way. A buyer reconciles an unknown payment with the token: it stays unknown and delivers nothing until the chain answers, then is `PAID`, collected, and never settled again. A failed payment is answered `409` with its state and no challenge or quote. A buyer who paid before the Brief was withdrawn still collects. `GET /api/commerce/summary` holds counts by state and Brief, labelled, with no order id, quote id, terms hash, payer or transaction hash, and no receipt for a visitor. |
| `access-projections.test.ts` | 12 tests. With one Brief published and bought on a public deployment, none of thirteen free routes contains an evidence summary other than the issuer's record, a block number from that evidence, or the text of a claim, an unknown, a limitation or the rationale; the public timeline keeps each evidence row's id and label with `detail` null, and usage is counts only. The public chain view keeps the issuer's figures and the shape of the reads with the numbers null. A run that finished with no Brief keeps its gate findings and chain numbers. A run that is still `RUNNING` does not: its chain figures are null, its evidence details are null and the figure quoted by a rejected first draft appears nowhere in the response, so a run cannot be read in full during the minutes before its Brief exists. The detail of a rejected first draft is withheld once its revision is on sale. `VIEWER_TOKEN` gets the `DIAGNOSTIC` view and real order ids in the activity feed, and gets `401` on scan and the order list and `403` on a single order; a wrong token gets the `PUBLIC` view; diagnostics are open on a localhost desk, `DISABLED` on a public deployment with no token, and a short viewer token is a configuration error. The public activity feed names no order and no quote and still groups one order's rows. `deskEconomics` counts each investigation once however many orders its Brief has, counts rejected, stopped and unsold work, reports test payments as zero revenue, counts a mainnet order as revenue only when its transfer was read back from the chain, and is served with no run, Brief, order or payer in it. |
| `restart.test.ts` | 1 test, over a database file closed and reopened. The Brief, the quote and two orders survive. An order left `PAYMENT_UNKNOWN` is still unknown, still undelivered and still answered only to its claim token; the new process reconciles and delivers it from the delivery route without a settle call. The token the first process issued still opens its order, and the settled authorization re-sent afterwards is recognised and opens no third order. |
| `room-api.test.ts` | The read routes a wall display needs: the run list carries times, the gate's verdict, drafts judged and usage but no timeline; a rejected draft and its revision are both counted and both kept as `gateAttempts`; a run reports the ceilings it was started with after the configuration changes, and reports attempts as not recorded for a run stored before they were kept; the chain route returns exactly the stored evidence values, null before any read and `404` for an unknown run; desk status reports off, the day's count, the live window, the last tick and the next; the activity feed is newest first, uses only its declared kinds, labels quote and order events with their rail, honours its limit, and never repeats what a facilitator said. None of the free routes contains a sentence of the paid Brief. |
| `apps/web/test/brand.test.ts` | The five brand rules from the design system: estimates never green, badges carry their word, the PAYMENT_UNKNOWN sentence and no pay-again, no total spanning measured and estimated, a price is green only when paid and chain-verified. |
| `apps/web/src/__tests__` | Four files. `components.test.tsx` (20): component contracts. `signer.test.ts` (3): no signer without a wallet; the signer returns the `PAYMENT-SIGNATURE` value for the seller's challenge; nothing is signed when the 402 challenge differs from the quote on screen. `checkout.test.ts` (15), the browser purchase against a scripted seller and wallet: the claim token is chosen before signing and sent with the payment; two browsers buying one Brief keep their own claim and order and neither collects the other's; two presses of Pay sign once and pay once; a lost paid response is recovered as the same order without a second signature; a delivered Brief comes back after a reload with the claim token alone; a storage write that throws does not lead to a second signature and turns `durable` false; an unknown outcome stays unknown until the chain answers and the wallet is never offered a second authorization; a wrong claim token is refused and nothing is signed; a declined signature, a wrong network, a terms mismatch, no wallet and an expired quote each leave nothing signed and say so; insufficient funds marks the purchase failed and only then allows a new authorization; a delivery whose content hash is not the quoted one is not shown; what is stored is the order id, the quote, the claim token and the signed authorization, and no key. `brief-value.test.tsx` (10), the Brief screen: a detection more than an hour after the effective time is labelled retrospective and claims no early warning, one within the hour is not; a voided action is shown as withdrawn with no quote and no Pay button; the balance illustration follows its stated formula from the issuer's figures and is labelled; the issuer's notice is kept apart from what the desk checked, with no advice; the gate's decision is shown before purchase; "View evidence first" shows the free index and no values; a claim's evidence id opens the drawer on the value the claim used, and the delivered JSON can be downloaded. |

The cancellation regression tests were checked against the pre-fix source: 5 of the 6 tests that
existed at the time failed there, and all passed with the fix. `cancelled-actions.test.ts` now has
12 tests.

`npm run test:e2e` (Playwright, `tests/e2e/golden-path.spec.ts`) holds seven browser tests against
the offline configuration. The count is read from the spec file; the suite was not run for this
revision of the document.

1. A draft with an unevidenced number is held and never offered for sale.
2. The golden path from recorded event to delivered Brief and receipt. Before anyone pays, the
   gate's decision is on the page, the event's times are kept apart, the free side says what is
   being sold, and "View evidence first" opens the free index. After delivery the page renders
   the delivered JSON, the order is bound to the terms hash the buyer saw, an evidence id in a
   claim opens its source, and the downloaded JSON is the delivery, with no claim token or
   signature in it.
3. An unknown payment delivers nothing, cannot be charged twice, and reconciles.
4. Two browsers buying the same Brief stay apart: own order, own claim, and one cannot collect the
   other's.
5. A reload after delivery brings the same Brief back with no wallet prompt and no new order.
6. A paid response that never arrives is recovered as the same order, with the one signature
   already given.
7. A declined signature and a wallet on the wrong network charge nothing and say so; with no
   wallet the page points at the agent buyer.

The CI workflow (`.github/workflows/ci.yml`) runs `npm run typecheck`, `npm test` and
`npm run build` on Node 22.x and 24.x, and `npm run test:e2e` on Node 24.x, on every pull request
and every push to `main`.

`npm run spike` is the live check of the data sources and the payment rail. `npm run model-check`
makes one small metered model call and compares it with OpenRouter's own usage figure for the key.
Neither is part of `npm test`: both need the network, and `model-check` needs a key.

## The gate's number rule, precisely

Gate 2.0.0 (`GATE_VERSION` in `apps/api/src/gate/publicationGate.ts`; the rule itself is
`apps/api/src/gate/numericGrounding.ts`). The eleven `GateRule` values are unchanged. What changed
is what `QUANTITIES_RESOLVE_TO_EVIDENCE`, `NUMBERS_IN_TEXT_ARE_EVIDENCED` and
`FAILED_CHECKS_DISCLOSED` require. The gate is still a pure function: no check was handed to a
model. It is on a branch that is not merged or deployed; `main`, which the public deployment is
built from, still has gate 1.0.0.

The rule it replaces accepted any integer from 0 to 12 as prose, compared magnitudes so a sign
could flip, tried a ×100 form of every value, and let a figure match any number anywhere in the
cited items (anywhere at all, for the headline).

**The unit registry.** `VALUE_UNITS` gives every numeric key the toolbox writes one of eleven
unit classes: `MULTIPLIER`, `PERCENT`, `USD`, `RATIO`, `SECONDS`, `BLOCK`, `CHAIN_ID`, `VERSION`,
`SHARES`, `TOKENS`, `COUNT`. It is owned by code. A draft cannot widen it, and a numeric key that
is not in it cannot support a number at all. Four keys are `signed` (`changePct`,
`offsetSeconds`, `lagSecondsVsIssuerEffectiveTime`, `surplusShares`). Two hold a fraction that may
also be written as a percentage (`withholdingTaxRate`, `coverageRatio`). A test runs every tool in
both outcomes of the activation search and fails if any numeric key is unregistered. The writing
prompt's list of units is generated from the same registry.

**Declared quantities** (`QUANTITIES_RESOLVE_TO_EVIDENCE`). As before, a quantity must name an
evidence item the claim cites and equal its value. Now the key must also have a registered unit,
and the quantity's `unit` string must name that unit. Wording is lenient, because nothing binds
through the string: synonyms are accepted ("x", "pct", "US dollars", "block height"), "USD per
share" is read by what stands before "per", a fraction may be declared as "%", and an empty unit
or "none" is accepted only for the classes that are written bare (`MULTIPLIER`, `RATIO`, `BLOCK`,
`CHAIN_ID`, `VERSION`, `COUNT`). A unit that contradicts the registry is rejected and the finding
names the unit to use.

**Figures in a claim** (`NUMBERS_IN_TEXT_ARE_EVIDENCED`). Every figure written in digits must bind
to one of that claim's own declared quantities, and only a quantity that names a registered
numeric value of an item the claim cites counts as one. A number that the cited evidence holds
but the claim did not declare does not bind. To bind, a figure must pass four tests against the
same quantity:

| Test | Rule |
| --- | --- |
| Value | The written digits are the value's magnitude exactly, or correctly rounded at the number of decimals written. An exact half may go either way. The comparison is done on decimal digits, not floats. |
| Unit marker | A figure followed by `%`, "percent", "pct", "per cent" or "percentage points" binds only to a `PERCENT` value. A figure with `$`, `US$` or `USD` before it, or "USD" or "dollars" after it, binds only to a `USD` value. A figure with neither binds only to a value that is neither. The one conversion is typed: a fraction field may be written as its ×100 form, and then it must carry `%`. "50 USD" does not bind to a rate of 0.5; "50%" does. |
| Sign | Signed values are compared, never magnitudes. A minus sign binds only to a negative value. A figure written without a minus sign binds to a negative value only on a `signed` field, and only when a word such as "before", "earlier", "fell", "lower", "deficit" or "shortfall" stands within six words of it in the same sentence, at least as near as any "after", "later", "rose", "higher" or "surplus". A positive value of a signed field does not bind when one of the negative words is the nearer. On every other field the words around a figure are not read for sign. |
| Precision | A rounded figure keeps at least two significant digits, so "0.3%" does not stand for 0.329761. A multiplier that moved is never rounded back onto 1, however many zeros are written: "1" and "1.00" do not stand for 1.0033. An exact value is always accepted, so "1" is fine for a multiplier that is 1, and "0 seconds" for a lag of 0. |

Figures in basis points, scaled figures ("3 million", "5k") and anything that does not read as one
plain figure with at most one unit ("1.2.3", "rose10%") are refused outright: no evidence value
is written that way. There is no small-integer exemption. A bare 7 or 2 is a figure like any
other.

**Derived counts.** A whole, unsigned, unmarked number followed within four words by "checks",
"evidence", "items", "sources", "records", "reads", "unknowns", "conflicts" or "limitations" is
not looked up in evidence. The gate counts for itself: checks in total or by the status word
beside them ("5 of 5 checks passed", "0 failed"); evidence items in total, cited by the claim, or
per data mode; on-chain multiplier reads; the draft's own unknowns, conflicts and limitations.
The one evidence value that is itself a count of reads, `rpcReads`, is accepted as a read count
(in a claim, only when declared). A unit word, a preposition or the end of a clause between the
number and the noun stops the search, so in "3 shares and 5 checks passed" the 3 is a share
figure to be bound and only the 5 is a count of checks.

**Free text.** The headline, the confidence rationale, unknowns, limitations and conflict
descriptions declare no quantities. A figure there is tested against every numeric evidence value
with the same four tests. A figure with no `%` or USD marker also needs a word beside it that
says what it measures ("multiplier", "block", "seconds", "shares", "tokens", "ratio", "chain",
"version", "reads"), within six words in the same sentence. "70922304 holders" does not bind to a
block number; "at block 70922424" does. A conflict description is tested against the evidence of
the check it names, when that check lists any.

**Timestamps.** ISO datetimes, dates and times of day are compared with `observedAt`, `fetchedAt`
and every ISO datetime held as a string value, in the cited evidence for a claim and in all
evidence for free text. A written timestamp may be cut short only at a whole component:
`2026-09-18T00:30Z` and `00:30` match `2026-09-18T00:30:00.000Z`. It never matches as a
substring: `00:30` does not match `10:00:30`.

**Spelled-out figures.** A number word followed by a unit ("twelve percent", "two hundred
dollars", "half a percent") is refused, because a figure in words cannot be tied to evidence.

**Confirmation language** (`FAILED_CHECKS_DISCLOSED`). Every failed check must still be listed in
`conflicts`. In addition, while any core check is not PASS, the headline and the confidence
rationale may not contain "confirm", "confirms", "confirmed", "confirmation", "verified", "verifies",
"matches", "agree", "agrees", "agreed", "consistent with" or "in line with". Listing the conflict
further down does not license a headline that announces the opposite. The match is on the word,
so a negated use ("not confirmed") is rejected as well; the writing prompt says so.

Each rejected figure is reported as `where: "token" (reason)`, with the nearest candidate and what
was wrong with it (unit, context, sign or precision), so that the one permitted revision knows
what to repair. The revision prompt repeats the rules about figures only when the rejection was
about figures.

The rule is blunt by design: a false rejection costs one revision, a false acceptance publishes an
unsupported number. The recorded live Brief (`brf_a790c648a87d52dd`, as delivered in
`artifacts/evidence/delivery-ord_8a2102084ad69dab.json`) passes all eleven rules of gate 2.0.0
with its own evidence and checks, judged at the instant it was first judged. That is one Brief.
No live draft has been judged by gate 2.0.0, so how often it rejects a real model's first draft
is not known.

### What it still does not catch

From the module's own header and from reading the code:

- **Free text binds to a kind of number, not to a named metric.** A headline can still quote the
  right kind of number about the wrong thing, as long as that number exists in evidence with that
  unit and a fitting word stands beside it: the BEFORE block number written as the activation
  block, for instance.
- **Within a claim, a figure binds to any declared quantity that fits.** The gate does not read
  which quantity a sentence is about. Two declared values of the same unit can be written the
  wrong way round ("from the new multiplier to the old") and both still bind.
- **Direction words are read only for the four signed fields.** "The multiplier fell to 1.0033"
  binds to a declared multiplier of 1.0033. The word lists are fixed and the window is six words;
  a direction expressed any other way is not seen.
- **Number words without a unit** ("the two reads agree", "one of the three checks") are left
  alone. Refusing them would refuse ordinary prose.
- **Paraphrase** ("roughly doubled", "a little under a third") carries a quantity in no digits at
  all and is not seen.
- **Names that contain digits** ("x402", "v2", "ERC20") are skipped as identifiers. A version
  written "v3" is therefore not checked, while "version 3" is.
- **A count is accepted if it equals any tally its noun allows.** With no status word, "3 checks"
  passes if 3 is the total, the PASS, the FAIL or the UNKNOWN count.
- **A timestamp binds to any timestamp of the cited evidence**, not to a named one. A fetch time
  can be written where the effective time was meant. A bare date matches the date of any of them.
- **Confirmation language is tested in the headline and the rationale only**, against a fixed word
  list. A claim can still say "matches". A synonym outside the list is not seen.
- **The advice filter is unchanged**: a pattern list, tested for the phrases it names.
- **Whether a bound figure is used in a true sentence is not tested at all.** The gate ties
  figures to evidence. It does not read meaning.

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
