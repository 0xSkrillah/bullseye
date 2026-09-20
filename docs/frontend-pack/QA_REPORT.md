# Frontend QA report

**Date:** 20 September 2026.
**Branch:** `claude/frontend-journey`. **Audit baseline:** `f590f5a8085c8f8b2833bdb227ee6c50163ade0b`, which was
also `HEAD` of `main` when this work started, so every finding in
[FRONTEND_AUDIT.md](FRONTEND_AUDIT.md) was reproduced against the code it was written about.
**Environment:** Windows 11, Node 26.7.0, npm workspaces, `npm ci` from the committed lockfile.
**App modes:** the offline configuration — data `HISTORICAL` (recorded real source responses from 18
September), synthesis `fixture` (deterministic template), payment rail `FIXTURE`, audience
`DIAGNOSTIC` because the desk was on localhost. No keys, no funds, no model spend, no network calls
to a paid API.
**Browser:** Microsoft Edge 153.0.4234.48 driven by Playwright 1.63. One browser engine only.
**Viewports exercised:** 360×800, 390×844, 640×360 (= 1280×720 at 200% zoom), 768×1024, 1024×768,
1199×800, 1200×800, 1280×720, 1335×800, 1336×800, 1440×900.

## Outcome

All nine published findings were reproduced at the audit baseline and all nine are fixed. One
further defect was found while reproducing them (BF-10, a navigation link that rendered a different
screen) and is fixed. Six new browser regression tests were added and each was run against the code
*before* its fix and observed to fail there.

Nothing was deployed. No real wallet, no mainnet, no paid API call and no external submission was
made. The deployed service at its public URL was not touched or re-tested; every result below comes
from a local app. The pack's isolated CSS reproduction was not treated as evidence: the grid defect
was re-measured in the running app.

## Baseline and final commands

| Command | Baseline result | Final result | Evidence | Scope and limitations |
|---|---|---|---|---|
| `npm ci` | OK, exit 0 | OK, exit 0 | one npm warning: `esbuild` postinstall blocked by `allowScripts` (pre-existing) | lockfile install only |
| `npm run typecheck` | clean, exit 0 | clean, exit 0 | `tsc -p apps/api && tsc -p apps/web` | does not cover `tests/e2e` |
| `npm test` | API **294 in 21 files**, web **81 in 6** | API **294 in 21**, web **81 in 6** | unchanged counts; no test was deleted, skipped or weakened | jsdom and `renderToStaticMarkup`, not a browser |
| `npm run build` | OK, exit 0 | OK, exit 0 | `index` 363.43 kB → **368.44 kB** (gzip 108.96 → **110.06 kB**); `MarketDesk` chunk 22.88 → **26.94 kB** (gzip 7.17 → **8.33 kB**) | lab numbers from one build on this machine |
| `PW_CHANNEL=msedge npm run test:e2e` | **11 passed** | **17 passed** | 11 existing + 6 new, [journey.spec.ts](../../tests/e2e/journey.spec.ts) | offline fixture rail, one browser |

## Findings and resolution

| ID | Reproduced at HEAD? | Fix | Regression test | Before/after | Result |
|---|---|---|---|---|---|
| BF-01 exact Brief link is not consumed | **Yes, in the browser.** `/?brief=brf_924513222ced3646` rendered the unselected desk, "Lock an event in the Feed to start" | [lib/route.ts](../../apps/web/src/lib/route.ts) (new); [App.tsx:26–48, 97–124](../../apps/web/src/App.tsx) | `journey.spec.ts` "the exact report link opens that report…" — fails pre-fix by showing a different Brief id | `before/brief-link-1280.png` vs `after/brief-link-1280.png` | **PASS** |
| BF-02 grid exceeds the range where it is enabled | **Yes, in the browser.** `scrollWidth − innerWidth` = **+112 px at 1200**, **+32 px at 1280**; the console column and the Market Desk link were off-screen. Required width measured at **1312 px**, matching the pack's isolated 1312 | [styles/desk.css:6–20, 60](../../apps/web/src/styles/desk.css): three columns from 1336 px, work column `minmax(0, 1fr)` | `journey.spec.ts` "no page scrolls sideways at any judged width" — fails pre-fix | `before/desk-1200.png`, `before/desk-1280.png` vs `after/` | **PASS** |
| BF-03 evidence modal lacks keyboard lifecycle | **Yes, in the browser.** Enter opened the drawer, focus stayed on the page behind it | [lib/dialogFocus.ts](../../apps/web/src/lib/dialogFocus.ts) (new, shared with the desk drawer); [market/Comparison.tsx:83–95](../../apps/web/src/market/Comparison.tsx) | `journey.spec.ts` "the evidence dialog takes the keyboard and gives it back" — fails pre-fix on the focus-moved assertion | `after/evidence-dialog-1280.png` | **PASS** |
| BF-04 event navigation ignores history | **Yes, in source and browser.** `pushState` with no `popstate` listener; the picker rendered only while nothing was chosen, below the footer | [market/MarketDesk.tsx:46–49](../../apps/web/src/market/MarketDesk.tsx) (popstate), [:71–98](../../apps/web/src/market/MarketDesk.tsx) (persistent picker) | `journey.spec.ts` "Back and Forward keep the address and the event on screen in step" and "the event picker opens from the keyboard" | `after/market-1280.png` | **PASS** |
| BF-05 muted text below 4.5:1 | **Yes, computed.** `#75766f` on `--canvas-raised` = 4.05:1, on `--canvas` = 4.27:1 | [styles/tokens.css:13](../../apps/web/src/styles/tokens.css): `--ink-muted: #86877f` → **5.12:1** and **5.39:1**; smallest metadata raised from 10 px to 11–12 px in `market.css` | none automated | `before/market-1280.png` vs `after/` | **PASS (contrast computed, not scanned)** |
| BF-06 the offer is buried | **Yes, in the browser.** At 1280 the first viewport held the headline, the instrument caveat and a negative verdict; no price, no report, no action | [market/MarketDesk.tsx:166–214](../../apps/web/src/market/MarketDesk.tsx) lead section; [components/BriefOffer.tsx](../../apps/web/src/components/BriefOffer.tsx) (new) | `market-desk.spec.ts` asserts the call to action, its text and where it points | `before/market-1280.png` vs `after/market-1280.png` | **PASS (not user-tested — see Not covered)** |
| BF-07 purchase context too technical | **Yes, in source and browser.** `3.00 USD · x402`, no network, no testnet label, and a bare "The paid JSON resource" link | [components/BriefOffer.tsx](../../apps/web/src/components/BriefOffer.tsx) fed by `/api/health`; [lib/networks.ts](../../apps/web/src/lib/networks.ts) shared with the paywall and the checkout notices | `journey.spec.ts` asserts the offer shows USD, "X Layer testnet" and the TESTNET badge before checkout | `after/market-1280.png` | **PASS** |
| BF-08 failure copy assumes a developer | **Yes, in source.** "Start apps/api on :4402"; "run npm run start:offline for the recorded data"; raw `view.error` text | [App.tsx:139](../../apps/web/src/App.tsx), [screens/Feed.tsx:22–23](../../apps/web/src/screens/Feed.tsx), [market/MarketDesk.tsx:112–147](../../apps/web/src/market/MarketDesk.tsx) | none automated (fault injection was manual) | — | **PASS** |
| BF-09 theme and chunk-error affordances | **Yes.** `theme=light` set an attribute no stylesheet answered; the lazy import had no catch | [styles/tokens.css:55–81](../../apps/web/src/styles/tokens.css) (the Projector palette already specified in `docs/design-system/tokens.css`); [main.tsx:26–46](../../apps/web/src/main.tsx) | none automated | `after/light-market-1280.png` | **PASS (light spot-checked at one width)** |
| BF-10 *(found here)* `/room` linked to a screen that does not exist on this branch | **Yes, in the browser.** The Market Desk header linked to `/room`; `apps/api` has no `/room` route, the catch-all serves `index.html`, and `main.tsx` branches only on `/market`, so `/room` rendered the ordinary desk under the wrong address | The header lists only destinations this build serves: [components/SiteNav.tsx](../../apps/web/src/components/SiteNav.tsx) | none automated | — | **PASS** |

## Manual checks

| Journey / state | Viewport | Input | Observed | Artifact | Result |
|---|---|---|---|---|---|
| Market event → exact report → reload | 1280×720 | mouse | CTA href `/?brief=<id>`; click, reload and a pasted URL all show that Brief's id | `after/brief-link-1280.png` | PASS |
| Exact report, non-default event | 1280×720 | mouse | the older investigated event's Brief opened, not the newest | e2e `journey.spec.ts` | PASS |
| Back / Forward between two events | 1280×720 | mouse | address and headline agreed at every step | e2e | PASS |
| Unknown report id | 1280×720 | keyboard + mouse | "Report not found", the id echoed, nothing charged, two ways out; no other report substituted, no quote or pay control rendered | `after/unknown-brief-1280.png` | PASS |
| Evidence dialog | 1280×720 | keyboard only | Enter opens, focus lands on the heading, 12× Tab and Shift+Tab stay inside, Escape closes, focus returns to the same button | `after/evidence-dialog-1280.png` | PASS |
| Page overflow | 11 widths × 3 routes | — | `scrollWidth − innerWidth` ≤ 0 everywhere (34 captures, 0 page errors) | `layout-after.json` | PASS |
| 200% zoom | 640×360 CSS px | — | no sideways scroll; the offer and its action remain reachable | `after/zoom200-market-640.png` | PASS |
| Reduced motion | 1280×720 | — | computed `animation-name` on the target is `be-hit` normally and **`none`** under `prefers-reduced-motion: reduce`; the radar sweep is `none` too | computed style probe | PASS |
| Projector (light) theme | 1280×720 | — | `--canvas` resolves to `#f4f3ee` and the body paints it on both `/` and `/market` | `after/light-market-1280.png` | PASS |
| Event with no investigation | 1280×720 | — | the offer says no brief has been published and renders no call to action; the issuer-side figures still render | `after/market-no-brief-1280.png` | PASS |
| Feed request failure | 1280×720 | fault injection (API stopped) | visitor-facing banner, Retry, no developer instructions | — | PASS |
| Phone | 360, 390 | — | one column, header wraps, offer follows the event, no overflow | `after/market-390.png` | PASS |

## Purchase guardrails

Not re-implemented and not re-verified by hand: `usePurchase`, the claim-token recovery, the frozen
quote terms, the `PAYMENT_UNKNOWN` handling and the buyer isolation are untouched. Their coverage is
the seven pre-existing tests in `tests/e2e/golden-path.spec.ts` plus the API suite, which all still
pass unchanged — including refused signature, wrong network, lost response, reload after delivery
and a second buyer being unable to collect the first buyer's order. That coverage is against the
**fixture** payment rail offline; it is not evidence about a real wallet or a real network.

One purchase-adjacent change was made: the exact-report route hands `usePurchase` the Brief id from
the URL instead of one derived from the selected event. Nothing about storage, scoping or the
payment path changed, and `journey.spec.ts` asserts that opening a report renders no pay control.

## Performance

Lab only, from `npm run build` on this machine: `index` 368.44 kB (gzip 110.06 kB), `x402` 277.85 kB
(gzip 85.64 kB), `MarketDesk` 26.94 kB (gzip 8.33 kB), CSS 17.60 + 8.87 kB. The Market Desk remains a
separate chunk, so the desk at `/` still does not download it. No throttled trace, no Lighthouse run
and no field data: there is no Core Web Vitals claim here.

## Not covered

- **The deployed service.** Nothing was deployed and the public URL was not exercised. Every result
  above is from `localhost`.
- **Real payments.** No wallet, no mainnet, no testnet transaction, no paid model call.
- **Other browsers.** Edge/Chromium only. Firefox, Safari and real phone hardware were not tested.
- **Assistive technology.** No screen-reader session and no automated accessibility scan (axe or
  similar). The keyboard lifecycle was tested; how the dialog is announced was not. The Market Desk
  dialog relies on `aria-modal` and a focus trap; sibling content is not marked `inert`.
- **Real users.** BF-06 is judged against the audit's acceptance wording, not a five-second test
  with a person. No usability session was run and none is claimed.
- **Contrast beyond the token pair.** `--ink-muted` was computed against its two backgrounds. A full
  rendered-page contrast audit was not run.
- **Light theme breadth.** Spot-checked on `/` and `/market` at 1280 px. Not checked at other widths
  or in the checkout and evidence states.

## Owner actions

1. Review this branch and merge it. It is `claude/frontend-journey`, six commits on top of
   `f590f5a`, fast-forward onto `main`.
2. Decide whether to deploy. Nothing here has been deployed, and the deployed service still serves
   the old frontend.
3. If the Situation Room is wanted in the header, merge `claude/bullseye-situation-room-a091ef`
   first. `/room` is not served on `main`, which is why the link is not there; re-adding it is one
   line in `SiteNav.tsx` once the route exists.
4. Run the 90-second path in [DEMO_PATH.md](DEMO_PATH.md) once before recording, on the machine that
   will record it.
5. Nothing in this branch changes what the claim ledger may say about revenue, demand or a purchase
   from the deployed address. Those claims are unaffected and unverified by this work.
