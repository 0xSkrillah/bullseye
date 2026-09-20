# The 90-second customer path

The customer-facing part of the demo, on the local offline build. It is the journey a judge should
be able to follow without a founder translating anything: an event, what it means, the report, the
price, the evidence.

Written 20 September 2026 against `claude/frontend-journey`. This is the *local* path. It is not a
recording of the deployed service, and it contains no purchase on a real network.

## Before recording

```bash
npm ci
npm run build
```

Then two terminals:

```bash
npm run start:offline
```

```bash
npm run dev:web
```

The desk is at `http://localhost:5173`, the API at `:4402`. Data mode is `HISTORICAL` (recorded real
source responses from 18 September), the writer is the deterministic template, the payment rail is
`FIXTURE`. Those labels are on screen throughout and should stay there.

Seed one investigated event so there is a Brief to sell:

```bash
curl -s -X POST http://localhost:4402/api/signals/scan > /dev/null && curl -s http://localhost:4402/api/signals | head -c 400
```

Take the `id` of the QSRx signal from that output and start its investigation:

```bash
curl -s -X POST http://localhost:4402/api/signals/<sig_id>/investigate
```

Wait for `GET /api/signals/<sig_id>` to report a status other than `RUNNING`, then open
`http://localhost:5173/market/<sig_id>`. Set the window to 1280×720 or 1440×900, turn on reduced
motion if the room is bright, and close anything that can notify.

## The path

**0–15 s · the event.** Open `/market/<sig_id>`. Read the headline aloud: *every QSRx balance on X
Layer grew by 0.665165779779%, and no transfer was emitted to show it.* Point at the line beneath
it: the event took effect on 18 September at 00:30 UTC and Bullseye first detected it at 19:27 —
*a look back, not an early warning*, which the screen says itself.

**15–35 s · why it matters, and what it is not.** Scroll to **What was observed**: one dot per
recorded read of the multiplier, nothing drawn between them, with the effective time marked. Then
the verdict: *No transactable opportunity* — and say why, from the screen: no source the desk may
read publishes a bid, an ask, a size or an expiry, so no spread is quoted and none is estimated.
*This is a balance adjustment, not a forecast that the stock will rise.* Scroll past one figure
card labelled **INSUFFICIENT DATA** with its missing inputs named.

**35–50 s · the product.** Back to the top. The offer sits beside the event: what the document
contains, **3.00 USD**, the rail and **X Layer testnet** with the TESTNET badge, and the sentence
under it — *a test payment on a test network. It is not revenue and no real money moves.* Open one
evidence item from the comparison table with the keyboard: it carries the source URL, the fetch time
and the sha256 of the response. Escape closes it and the focus goes back where it was.

**50–75 s · the purchase.** Click **View this brief**. The address becomes `/?brief=<brf_id>` and
that exact report opens — its id is on screen, the gate's decision is shown *before* anything is
bought, and the findings are behind the paywall. Say plainly that the next step is the fixture rail:
*this is the offline recorded build, so the payment is a fixture and nothing settles on a chain.*
Request the quote and show the frozen terms — the amount, the asset, the network and the terms hash
that cannot change after approval.

**75–90 s · what a buyer gets back.** Reload the page: the same report comes back from this
browser's own claim, with no wallet prompt and no second order. Show **Download JSON** if the Brief
was delivered: one `bullseye.brief/v1` document with the quoted terms and the payment evidence, and
no key, signature or claim token in it. End on: *one checked intelligence report, usable by a person
or by another agent.*

Optionally, and only after this, show the machinery.

## What not to say

- Do not call the fixture or testnet payment revenue, or a sale.
- Do not describe the rebase percentage as a price return, or the reference figures as a quote.
- Do not claim the deployed service has had a purchase from a browser. It has not.
- Do not present a stored screenshot as live. The captures in
  [`artifacts/frontend-2026-09-20/`](../../artifacts/frontend-2026-09-20) are dated evidence of a
  local run on 20 September.

## If something fails on the night

Every failure state on this path is a screen with a next action, not a stack trace: the feed, the
event, the report link and the Market Desk chunk all have one. If the API is not running, the desk
says so and offers Retry — that is a legitimate thing to show. Do not mime a success.
