# Situation Room (`/room`)

A read-only wall view of the desk running itself. It starts nothing: no scan, no investigation, no
quote, no payment, no call to the paid resource. `main.tsx` mounts it when the path is `/room`; it
is its own chunk, so the desk at `/` never loads its code, its stylesheet or its fonts.

The rule for every panel: **a figure on screen is a named field of an API response, or a count of
such fields.** A field that is not there prints as `—`. A route that is not there (404) prints
"not available yet". Nothing is averaged, trended or estimated by the room.

## Panel → field

| Panel | What is shown | Source |
| --- | --- | --- |
| Status strip · Data source | mode badge, "API clock" | `GET /api/health` → `dataSource.mode`, `dataSource.asOf` (the transport's clock when it answered, not a freshness time) |
| Status strip · Model | READY / NOT READY, model id or the reason. When the health check stops answering, the word stays without tick or colour and the line says "last known" | `health.synthesis.ready`, `.model`, `.detail` |
| Status strip · Payment rail | READY / NOT READY, TESTNET + "Not revenue.", rail and network or the reason | `health.paymentRail.ready`, `.isTestnet`, `.rail`, `.network`, `.detail` |
| Status strip · Auto desk | ON / OFF; when the loop last ticked and what it did (STARTED, or IDLE and why, as the server's enums; the tick's `detail` can carry an error's text and is never shown); the interval, how many runs started in the last 24 h (every investigation, whoever started it) beside the count at which the loop stops starting more, and the next tick while it is still ahead. When the desk status stops answering, the cell says "last known" | `health.autoDesk.enabled`, `.intervalMinutes`, `.maxInvestigationsPerDay`; `GET /api/desk/status` → `lastTick.at`, `.action`, `.reason`, `investigationsLast24h`, `nextTickAt` |
| Status strip · Operator routes | the mode, and what it means for a visitor | `health.operatorRoutes` |
| Status strip · Clock | UTC time and date | the browser's clock |
| Opportunity field | data mode badge; one mark per signal through `RadarField`'s `events` (no decorative dots, no sweep, no `onLock`). Bearing: one per asset, alphabetical. Range: age of the effective time inside the live window, rim = now; the rings are labelled with that window cut into quarters (24, 48 and 72 H for a 96 h window), and only while something is plotted. State: open ●, investigating (amber, with a half ring), published (with a reticle), superseded (dimmed, struck through with a slash); a red cross on a run the gate rejected or that was stopped. The legend names every mark. Signals older than the window are counted in words, not plotted. Nothing is plotted until the server gives the scale | `GET /api/signals` → `dataMode`, `signal.asset.symbol`, `signal.observedAt`, `superseded`, `investigation.status`; `GET /api/desk/status` → `liveWindowHours` |
| Opportunity board · header | count of opportunities; investigated, rejected by gate, on sale, paid. The signals and Briefs routes answer with their newest 50: a full list makes every count taken from it a floor (`50+`). "On sale" counts the Briefs whose signal is among the rows and not voided; a Brief whose signal is older than the rows cannot be checked, is not counted, and makes the figure a floor too. "N paid" counts only orders at PAID or later that the chain confirmed; the others are said apart, in amber: "N paid, not chain-verified". A read that has not answered is `—`, and a failed one is named | `signals.length`; rows with `investigation`; `investigation.status === "REJECTED"`; `GET /api/briefs` → Briefs whose signal has no `superseded` mark (a withdrawn Brief is listed there but no longer sold); the order counts below → `byState[state].count`, `.chainVerified` for the states at PAID or later |
| Opportunity board · blocked stages | ✕ on INVESTIGATION / PAYMENT | `health.synthesis.ready`, `health.paymentRail.ready` |
| Opportunity board · rows | one per signal, newest effective time first, at most 14 lines (the rest counted: "+N more, not shown"; the focused run always stays). Provenance word, asset, effective time, change to four decimals with a bar scaled to the largest change shown (the header prints that maximum), SUPERSEDED · vN REASON when the issuer voided it (where the change column is not shown, the word SUPERSEDED stands next to the asset, and the row's sentence for a screen reader begins "superseded by vN, REASON") | `signal.provenance.mode`, `signal.asset.symbol`, `signal.observedAt`, `signal.facts.changePct`, `superseded.byVersion`, `superseded.reason` |
| Opportunity board · track | one node per stage. SIGNAL: always reached (the row is the signal). INVESTIGATION: running / reached / STOPPED. GATE: PUBLISH ✓ / REJECT ✕. BRIEF: on sale with the confidence level as a word, or WITHDRAWN. PAYMENT: PAID ✓ only when chain-verified, otherwise UNVERIFIED ◌; PENDING or UNKNOWN ◔ while the outcome is open, FAILED ✕. DELIVERY: DELIVERED (✓ or ◌ by the same rule), running ◐ while DELIVERING, FAILED ✕. ECONOMICS: reached when an order for that Brief is PAID or later, which means a receipt exists; it is not a revenue claim and is never green. `?` on all three while the order counts have not answered. Every state has its own glyph, and the row's meaning is also real text for a reader who cannot see the drawing. On every layout but the wall, where the words beside the glyphs are not shown, a key under the board says what each glyph means; a phone names the columns in four letters (SIG INV GATE BRF PAY DLV ECO) | `investigation.status`, `.stopReason`, `.briefId`; `GET /api/briefs` → `confidence`; the order counts → `byBrief[].briefId`, `.furthestState`, `.count`, `.chainVerified` (green only when `chainVerified === count`) |
| Investigation · which run | the RUNNING one, else the newest. Read every 3 s while RUNNING; a finished run is read once | `GET /api/investigations` (newest first) → `id`, `status`; without that route, the signals' `investigation` |
| Investigation · gauges | measured cost / ceiling, and apart from it `+ ≈ $x estimated upper bound` in amber when any call was carried at the price cap; model calls, tool calls, elapsed against their ceilings; the gauge a STOPPED run hit turns red and the stop reason is printed. When the server withholds cost from a visitor the gauge is named COST · WITHHELD and its value is the word "withheld", never zero; the call counts are still shown. Usage from the test double carries the FIXTURE badge and "not a real cost" | `GET /api/investigations/:id` → `usage.costBases`, `usage.measuredModelCostUsd` (absent = withheld), `usage.upperBoundModelCostUsd`, `usage.modelCalls`, `usage.toolCalls`, `investigation.startedAt`, `.finishedAt` (a finished run's elapsed is `finishedAt − startedAt`; a RUNNING run's is the browser's clock minus `startedAt`, frozen at the last answer and marked "last known" when the reads fail; the figure turns red only on the server's word: `BUDGET_LATENCY_EXCEEDED`, or a finished run that overran), `.stopReason`; ceilings from `investigation.budgetAtStart`, else `budget`, else `health.budget` (the group's label says which) |
| Investigation · run chart | one mark per timeline entry at the second it happened, in four lanes (model call, tool call, evidence, checks and gate); a failed call is a cross; the axis runs to the latency ceiling, or further if the run did. It never prints an entry's `label` or `detail`, except the CHECKS entry's label in the foot: its counts ("8 passed, 0 failed, 1 unknown"), or for a visitor the server's fixed sentence "Consistency checks computed", printed as it comes and never parsed | `investigation.timeline[].at`, `.type`, `.ok`; `timeline[type=CHECKS].label`; `usage.routedModels` |
| Investigation · counts | on record (`50+` when the list came back full), how many RUNNING | `GET /api/investigations` → length and `status` (else the signals that carry an investigation) |
| Evidence chain | a step chart of `multiplier()` by block for the focused run: the issuer's old and new multiplier to six decimals, a dot per read, block numbers and block times, the block it changed in. Slots sit in block order. A read is green only when it returned what its slot should (old BEFORE, new AFTER and at the HEAD); anything else is red with its value. The line is drawn only where reads support it. "NO CHANGE FOUND ON CHAIN" when the search ran and found none, "ACTIVATION BLOCK NOT SEARCHED YET" before it has run. The caption names the asset and the chain, from the response's `network` (eip155:196 is written X Layer, eip155:1952 X Layer testnet, any other network as it comes). The badge is the weakest mode among the reads and the activation. When the server withholds the figures (`withheld: true`, null blocks and values) the panel shows which reads were collected (squares on the axis, on neither multiplier level) and their modes, and says why: sold in the Brief when one is on sale, withheld while the run may still publish, or the Brief was withdrawn | `GET /api/investigations/:id/chain` → `withheld`, `symbol`, `network`, `issuer.multiplierOld`, `.multiplierNew`, `reads[].key`, `.blockNumber`, `.blockTime`, `.multiplier`, `.mode`, `activation.blockNumber`, `.blockTime`, `.mode`, `activationSearched` |
| Gate | a table: the domain's rules down the side, the three newest judged runs across (oldest first; the focused run carries the board's ▸ and a rule over its column). A finished run is kept by id once read, so a new run pushes the others along without reading them again or blanking a column. A cell is that run's finding for that rule: ✓ passed, ✕ failed, · not evaluated. When the server recorded every draft a cell holds one glyph per draft, oldest first ("✕✓" is a rejected draft, then a revision that passed); when it did not, the count of drafts carries `*` and the panel head says the findings were kept for the last draft only. While a judged run the list names has not been read, the head says "Fetching…", or "✕ no answer" when the read failed. Under the rules: drafts judged, then confidence as words in two rows, the level the Brief claims and under it the cap the gate allowed. A finding's `detail` is never shown | `GateRule.options` from `@bullseye/domain`; `GET /api/investigations` → the newest three with a `gate`, their `symbol`, `draftsJudged`; `GET /api/investigations/:id` (read once each; the focused run is reused) → `investigation.gate.decision`, `.gate.findings[].rule`, `.passed`, `.gate.confidenceCap`, `investigation.gateAttempts[]`; `GET /api/briefs` → `confidence` |
| Payment · Delivery | orders in total and per state, as counts only: no buyer, order, quote or payment identifier is kept. The transitions are the domain's table drawn as edges; the newest order's path is drawn over them. A PAID or DELIVERED node is green with a ✓ beside it only when every order in it is chain-verified; otherwise amber with a ◌, and the drawing's spoken label gives the count the chain confirmed. One line for the newest order: its state, time, number of steps, and "chain-verified" or "not chain-verified". While any order is in PAYMENT_UNKNOWN an amber line gives their count and reads "A retry cannot charge you twice.", with nothing to press; on the wall it takes the newest-order line's place, narrower layouts show both. The same sentence follows a PAYMENT_UNKNOWN event in the activity line and is said with that row of the board. When the orders list comes back full (50 on `/api/orders`, 500 behind the summary) every count is a floor: the headline reads `50+ ORDERS`, and a Brief with no order in the list is "not known" on the board, never "not reached". With no order yet the line reads "no orders yet", or, when the rail cannot settle, "✕ rail not ready · nothing can be charged". When neither route answers a visitor the panel says the counts are not available, never "no orders"; when the read fails, the last counts stay and the head says "✕ no answer" and the time of the last answer. The route's `note` is printed under the panel (on the wall only when the lines above leave room for it whole) | `GET /api/commerce/summary` → `total`, `byState[state].count`, `.chainVerified`, `latest.at`, `.state`, `.chainVerified`, `.trail[].from`, `.to`, `label`, `note`; `health.paymentRail.ready`; on a server without that route the same shape is folded in `data.ts` from `GET /api/orders` → `order.state`, `order.payment.chainVerified`, `order.updatedAt`, `order.events[]`, `order.terms.briefId`; `ORDER_TRANSITIONS` from `@bullseye/domain` |
| Economics · desk totals | one bar of measured research cost split by how the run ended, the measured total, and apart from it the upper bound in amber; runs per outcome and how many ran on the fixture writer (no price); revenue orders and revenue (green only when there is a revenue order), test payments with TESTNET + "Not revenue."; paid mainnet orders the chain has not confirmed, in amber and "not counted as revenue"; delivery allowances and contribution as estimates, "not profit". The caveat under the panel is the order summary's `note` (row above); this route's own `note` stands in only when the summary has none, and then only on layouts that scroll, because at three lines it never fits the wall whole | `GET /api/desk/economics` → `label`, `note`, `rail`, `research.total.measuredUsd`, `.upperBoundUsd`, `research.byOutcome[outcome].runs`, `.measuredUsd`, `research.runsWithoutAPrice`, `sales.revenueOrders`, `.revenueUsd`, `.testOrders`, `.testPaymentsUsd`, `.unverifiedMainnetOrders`, `.unverifiedMainnetUsd`, `delivery.estimatedTotalUsd`, `estimatedContributionUsd` |
| Economics · without desk totals | the newest order's receipt, only when that order is PAID or later (the server builds a receipt for every order, paid or not): price (TESTNET + "Not revenue." whenever the receipt's rail is not mainnet; green only when it counts as revenue and the chain confirmed the payment; a mainnet payment the chain has not confirmed prints plain, and the contribution line says it is not counted as revenue), measured cost, estimated allowances, estimated contribution with the reason it is not revenue ("on a test payment" on a test rail, "not counted as revenue" on mainnet), "not profit". A run on the test double has no measured cost: the FIXTURE badge and "model cost not measured" stand where a zero would. The summary route's receipt does not carry that flag, so a zero from it reads "model cost not reported", never a measured zero. Otherwise one bar per judged run: its measured model cost against the cost ceiling, fixture runs counted in words instead. Otherwise the price per Brief. When `/api/desk/economics` stops answering, the last totals stay with "✕ no answer" and the time of the last answer | `GET /api/commerce/summary` → `latestReceipt.priceUsd`, `.rail`, `.countsAsRevenue`, `.measuredTotalUsd`, `.estimatedTotalUsd`, `.estimatedContributionUsd` (a diagnostic reader only; a visitor gets none); on a server without that route, `GET /api/orders` → the newest order's `receipt.*` with `receipt.usage.usageIsFixture`; `GET /api/investigations/:id` → `usage.measuredModelCostUsd`, `usage.costBases`; `health.budget.maxVariableCostUsd`; `health.priceUsd`, `health.paymentRail.rail` |
| Activity | a ticker that only ticks when something happened: two rows of whole events, newest first, read like text; an event that does not fit is left out, never cut (one wider than a whole row is measured and dropped, so the next whole one takes its place). At most 8 of the 30 asked for; layouts that scroll show all 8 and wrap a long one. Time (with the date when the event is from another UTC day) and the server's own sentence per event; "A retry cannot charge you twice." follows an event whose `state` is PAYMENT_UNKNOWN; TESTNET + "Not revenue." on a testnet order or quote event. A quote prints as "SYMBOL: quote issued": its sentence carries a price as text, and an amount only renders through `<Money>` | `GET /api/activity?limit=30` → `events[].at`, `.kind`, `.symbol`, `.summary`, `.rail`, `.state` (`.refId` only identifies an event; it is never shown) |
| Feeds and their age | The opportunity field, the board and the evidence chain end in a foot: route, pace, time of the last answer, or "✕ no answer". The order panel says its route and pace in its head, and on a failure "✕ no answer" with the time of the last answer; the desk totals do the same in their block. The investigation panel's foot is about the run on screen (routed models, checks) and says "✕ no answer" when its read fails. The gate matrix reads each finished run once and says "Fetching…" or "✕ no answer" in its head. The activity line names its route, and "✕" with the error when it fails | the poll itself |

Every dollar amount in the room is drawn by `<Money>`, which adds the basis word (`≈ … estimated`,
TESTNET, "Not revenue."). The room never adds, averages or divides money itself: the bar widths in
Economics are a field divided by a field of the same response, used for length only and never printed.

## Which routes a server has

`GET /api/health` carries a `diagnostics` key on a server that has `/api/commerce/summary` and
`/api/desk/economics`. The room asks for those two only when that key is there, so an older server
is never sent a request it answers with 404. If the summary is missing after all, the room falls
back to `/api/orders` and looks again a minute later.

A server may answer a visitor with less than it answers its operator (`audience: "PUBLIC"`): call
counts without costs, a chain without blocks and values, no receipt. The room prints "withheld" for
those, never a zero. If `sessionStorage["bullseye.viewerToken"]` holds a token, every read carries
it as a bearer header; the room has no field to enter one.

Two kinds of mark on the wall are the room's choice, not a field. A signal's bearing on the radar:
the asset's place in the alphabetical list of assets on record, spread evenly round the field; it
means nothing else. And scale labels, which are fields cut into even steps so a reader can measure
against them: the radar's rings (`liveWindowHours` in quarters) and the run chart's axis (every
60 s up to the latency ceiling, `maxLatencyMs` / 1000). The gauges' ceilings are the budget's own
fields: `maxVariableCostUsd`, `maxModelCalls`, `maxToolCalls`, `maxLatencyMs`.

## Motion

Something on the wall moves only because an API answer changed it, once, for under two seconds
(`useFresh.ts`): a new event slides into the ticker, a new row or gate column is washed, a node
that reached a new state or an order state whose count rose pulses, and a count, a readiness, a
run's status, a new mark on the run chart or a tick of the unattended loop blinks. Every read has
its own baseline, taken from its first answer with data: nothing is news at load, after a failed
read recovers, when the focus moves to another run, or when the room switches from one orders
route to the other. "Not reached" and "not known yet" are never news, and neither is a count that
fell (a count of the newest orders falls when an old one leaves the window). Nothing loops: a wall that is always moving says
the desk is always busy. With `prefers-reduced-motion` nothing moves, and what is new carries a
still rule or underline for as long as it counts as new. `test/situation.motion.test.tsx` holds
the stylesheet to both rules.

## Requests

Pace is set in `data.ts` (`POLL_MS`) and checked by a test: under 60 requests a minute with one
investigation RUNNING (33 idle; a RUNNING run adds 20 for itself and 6 for its chain; the three gate columns are read once each). A finished
investigation and its chain are read once. Polling stops while the tab is hidden, waits for the last answer before
asking again, and doubles its wait after a failure (up to a minute). A 404 route is asked again
once a minute; that pace is taken from the answer itself, so finding a route missing costs one
request. Every request has a 15 second deadline: one that never answers becomes "no answer" and is
retried, instead of holding its poll for good. When the focus moves to another run, the last
answer, error and time are dropped with it, so nothing from the previous run is shown under the next.

## The wall's height

The no-scroll layout engages at 1900 × 1078 and up, which in practice is a 1080 viewport. The
bottom row is what is left after the rest of the column (728 px), and its panels are budgeted line
by line: a line that only some desks need (an upper bound, unconfirmed mainnet orders, an unknown
outcome beside a newer order) takes the place of a less important one on the wall and is shown in
full on every layout that scrolls. Nothing is clamped with an ellipsis; a caveat that cannot fit
whole is left out on the wall rather than cut mid-sentence.

## Type and colour

`room.css` overrides `--font-sans`, `--font-mono` and `--font-display` on the room's root only, so
shared components inside it follow. No colour literal appears in this folder; green means a check
passed or money moved, amber means not known yet or estimated, red means failed or cannot run.

## Accessibility

One `main`, one `h1`, and every panel a region named by its own `h2`. Every drawing is either an
image with a sentence that says what it shows (the order counts and the newest order's path, the
run's calls and outcome, the reads and whether they match the issuer) or is hidden from a reader
who is given the same thing in words: a row of the board is a drawing plus a sentence, and the gate
matrix is a real table with a caption and "passed / failed / not evaluated" in every cell. No state
rests on colour: each has its own glyph (`○ ? ● ◐ ◔ ✓ ◌ ✕`), and a ring that can be green or amber
carries ✓ or ◌ beside it. Text is the ink, the secondary ink or a state colour, all 4.9:1 or better
on every surface the room uses; drawn marks are 3:1 or better; nothing is set under 11 px. The
ticker is a polite live region that announces additions only; it is there from the start, empty, so
the first event is announced like every other, and while a re-measure puts dropped events back it is
marked busy. Failed reads are announced in one place, a status line that is always there and says in
one sentence which reads stopped answering; no panel carries a status of its own. On every layout
but the wall a key under the board explains the glyphs, and a phone keeps four-letter column names.
The "new" highlight's background is one of the checked surfaces, so new text is legible the moment
it draws the eye. Nothing takes focus, because nothing can be pressed. While the room is mounted the tab is
titled "Bullseye · Situation Room". Motion: see above.

## Tests

`test/situation.brand.test.tsx` holds the room to the nine honesty rules. It draws three whole
walls (an operator's on the testnet rail, a visitor's on a mainnet desk, a test-rail desk that has
sold nothing) from fixtures in which every free-text field carries a marker and every figure a
value found nowhere else, then checks: every number on the wall is a field of a response or a small
count, and no sum of fields is; the only percentages are a signal's own; every test-rail payment
says TESTNET and "Not revenue." and nothing about it is green; green needs the chain; every
estimate says so; no `$` exists outside `<Money>`; every badge says its word; PAYMENT_UNKNOWN keeps
its promise and the room has nothing to press; confidence is words; the marker is nowhere in the
markup; nothing reads as advice. Figures, percentages and words are checked in what a screen reader
or a hover is told (labels, titles) as well as in the text; a dollar figure of any response is
looked for outside `<Money>` by its value, with or without a `$`; a fourth wall shows a RUNNING run,
where a projection would tempt. The same file checks the accessibility claims above, from the DOM
and from the tokens. `test/situation.room.test.tsx` runs the whole room against a stubbed API on
fake timers and counts the requests it really makes. The other `situation.*.test.tsx` files cover
each panel's branches, the adapter and the motion rules.

The tests were checked by planting violations in the room's source one at a time (a sum printed, a
percentage from two counts, green for a partly confirmed Brief, TESTNET dropped, a hand-written
amount, an amount in USD, a bare mode word, the retry promise dropped, a button, confidence as a
number or a bar, a finding's detail or a Brief's headline shown, advice wording, a projection, an
invented count, a 1 s poll, an hourly re-read): each one fails at least one test.
