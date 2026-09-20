# Bullseye frontend audit · 20 September 2026

## Verdict
**The frontends contain meaningful functionality, but the customer journey is fragmented. Fix discoverability, exact-report navigation, legibility and keyboard access before adding spectacle.** Keep the payment/recovery work and build one coherent Market Desk → Brief experience. Do not commission another isolated trading dashboard.

Reviewed GitHub main at `f590f5a8085c8f8b2833bdb227ee6c50163ade0b`, not the earlier `1ae8e79` audit. Market Desk now exists. The main app now uses buyer-specific `usePurchase`; older global-order and generic wallet-recovery allegations are not repeated here.

## Evidence and coverage
- Current source was fetched through the connected GitHub tool, including App.tsx, main.tsx, MarketDesk.tsx, Comparison.tsx, market.css, desk.css and tokens.css.
- User screenshots of the situation room and regular desk are historical design context, not renders of this commit.
- The local repo clone failed because GitHub DNS could not be resolved in the container. The live site was not accessible via the browsing tool. Those limitations say nothing about whether the app works for users.
- **No full app, wallet flow, CI suite, accessibility scan or performance trace was executed for this audit.**
- An isolated Chromium reproduction using the source grid declarations was executed. At 1280px, the simplified page scrollWidth was **1312px**. This reproduces the geometry, not the whole app.
- Opaque CSS token contrast was calculated: `#75766f` over `#121316` is **4.049:1**, and over `#0b0c0e` **4.265:1**. These normal-text combinations are below 4.5:1. This is not a complete rendered accessibility audit.

The outer pack's `evidence/` contains the isolated reproduction, JSON results and screenshot. Reproduce every finding in the actual current checkout before marking it fixed. File symbols are authoritative here; obtain exact line ranges from that checkout instead of guessing.

## Findings

### BF-01 · High / P0 · Exact Brief link is not consumed by the main app
**Evidence:** SOURCE. `apps/web/src/market/MarketDesk.tsx`, “The Brief” CTA, links to `/?brief=<briefId>`. `apps/web/src/App.tsx` initializes `lockedId` to null and does not read the brief query; `main.tsx` reads only theme and chooses market versus App. No selected-Brief bootstrap appears in the inspected entry flow.
**Impact:** the button promising a specific report can land the buyer back at an unselected desk instead of the item they chose. This breaks the commercial demo path.
**Lenses:** 8 action/object; 15 recovery; 16 consistency.
**Fix:** resolve the requested Brief through an existing authorised preview/catalogue route and select its associated event; handle not-found/withdrawn data. Alternatively introduce a canonical brief route and preserve old query links. Never make a request buy anything on navigation.
**Acceptance:** click from a non-default Market event to its Brief; direct-load and reload its URL; return with Back/Forward; the correct ID/content is selected, not the first item. Unknown ID gets a recoverable state. Existing claim-token recovery survives.

### BF-02 · High / P0 · Desktop grid exceeds the laptop range where it is enabled
**Evidence:** SOURCE + ISOLATED. `apps/web/src/styles/desk.css`, `.be-desk`, uses `320px minmax(560px,1fr) 360px`, 24px gaps and 24px side padding. Full fit requires **1336px**, but the two-column media rule ends at 1199px. The isolated harness at 1280px yields documentScrollWidth **1312px**.
**Impact:** the judged laptop viewport can require page-level sideways scrolling or clip the console/controls. A simple polished journey cannot rely on a 1756px screenshot.
**Lenses:** 2 targets; 17 grouping; 18 access.
**Fix:** use a content-driven three-column threshold or shrink the layout with appropriate intrinsic tracks; move secondary diagnostics into disclosure. Keep the primary report/checkout visible. Do not hide the defect with body overflow-x:hidden, text shrinking or CSS scaling.
**Acceptance:** actual app body width equals viewport at 360/390/768/1024/1199/1200/1280/1336/1440, allowing scroll only inside deliberately contained tables. Test 200% zoom.

### BF-03 · High / P1 · Market evidence modal lacks keyboard lifecycle
**Evidence:** SOURCE. `apps/web/src/market/Comparison.tsx`, `EvidenceDrawer`, uses a div with role=dialog and aria-modal plus backdrop/Close clicks. The component has no initial focus, Tab trap, Escape handler, background inertness or focus restoration.
**Impact:** a keyboard user can remain behind the dialog or lose position; evidence review is core product functionality.
**Lens:** 18 access; 15 recovery.
**Fix:** use an existing tested dialog primitive or native dialog implementation with correct focus lifecycle. Keep provenance and access-sensitive data unchanged.
**Acceptance:** open from a keyboard evidence button; focus inside; Tab/Shift+Tab stay there; Escape and Close work; background cannot be activated; focus returns to that exact button. Test long content at 390px.

### BF-04 · Medium / P1 · Market event navigation does not follow browser history
**Evidence:** SOURCE. `MarketDesk.tsx` reads the URL once into chosen, then pick() calls history.pushState without a popstate subscriber. The other-events selector is rendered only while chosen===null and sits after the footer; it disappears after picking an event.
**Impact:** the URL and visible asset may diverge on Back; selecting another event becomes unexpectedly harder.
**Lenses:** 3 familiar behavior; 9 discoverability; 15 recovery.
**Fix:** synchronize chosen with URL changes using the current routing style. Keep a stable event picker near the heading. Preserve selected asset, drawer closure and scroll intentionally. No new router library required if the existing mechanism can be corrected cleanly.
**Acceptance:** choose A, choose B, Back, Forward, direct-load B and reload; both URL and content always agree. Picker stays available.

### BF-05 · Medium / P1 · Small metadata uses insufficient normal-text contrast
**Evidence:** SOURCE + COMPUTED TOKEN PAIRS. `tokens.css --ink-muted:#75766f` is used by small labels in `market.css`. Contrast against raised background is 4.049:1; base background 4.265:1. Metadata often uses 10–12px type. Actual effective styles must be checked in browser.
**Impact:** provenance, age and unit labels are hard to read at laptop/projector scale, although those labels change the meaning of the numbers.
**Lenses:** 4 label proximity; 18 accessibility.
**Fix:** improve semantic secondary-text tokens, scale and display density while preserving non-text decoration separation. Do not require every decorative border to meet text contrast.
**Acceptance:** normal text meets the project 4.5:1 target on its actual background; 1280px screenshot readable without magnification. Key metadata ≥12px is a product design target, not a WCAG font-size rule.

### BF-06 · Medium / P1 · The report offer is buried beneath the machinery
**Evidence:** SOURCE + DESIGN. MarketDesk presents lengthy instrument caveats, a negative/unknown opportunity verdict, four clocks, observations, figure groups, comparison table, costs and evidence before “The Brief”. Its CTA says “Open brf_<id> on the desk”. At '/', the entry copy tells users to “Lock an event”.
**Impact:** the buyer needs a founder to explain what is for sale and how to get it. Dense diagnostics can be impressive yet fail the first-time task.
**Lenses:** 1 choices; 7 focal point; 8 action near object; 19 disclosure.
**Fix:** above-fold event summary + plain-language value + primary View brief/quote action for the selected event. Stable picker and compact mode status. Keep all actual uncertainties but move method detail into disclosure. Show data-missing and no-report states with useful next actions.
**Acceptance:** within the first viewport a user can state the event, the paid deliverable and next action. Validate with actual people; do not claim a five-second test passed without one.

### BF-07 · Medium / P1 · Purchase context on Market Desk is too technical/incomplete
**Evidence:** SOURCE. The offer displays `${priceUsd} USD · x402` and a link labelled “The paid JSON resource”; its rendered offer has no explicit payment-network/testnet badge. Full checkout may provide that information; this audit did not execute it.
**Impact:** a nominal test-token price can be read as a real-dollar purchase, and a raw resource link looks like an ordinary report download although it may return a 402 challenge.
**Lenses:** 12 truthful reading; 14 prevention; 16 consistency.
**Fix:** use a shared offer/price component fed by the actual current rail and quote data, with “Testnet purchase” and no-real-revenue context when applicable. Keep the paid JSON route under an Agent access disclosure with explained challenge/recovery instructions. Unknown rail is “Payment availability not confirmed”, not hardcoded testnet.
**Acceptance:** read the offer without entering checkout and correctly identify report, price, payment asset and network. No backend secret or paid detail is fetched just to decorate the card.

### BF-08 · Medium / P1 · Public failure copy assumes the visitor is a developer
**Evidence:** SOURCE. App.tsx says “Start apps/api on :4402”; MarketDesk's feed-error state suggests starting the API or npm offline command. It also exposes raw view.error text.
**Impact:** the ordinary visitor has no useful next action and may mistake a recoverable outage for unfinished software.
**Lenses:** 15 recovery; 16 consistent language.
**Fix:** Retry this view / Choose another event and preserve last-good data with explicit age when valid. Put developer setup guidance in operator-only details. Distinguish unrequested, empty, unauthorized, stale and actual request failure.
**Acceptance:** local fault injection covers each view. No state invites an extra payment after unknown outcome, no retry triggers unapproved paid research, and no data mode silently changes.

### BF-09 · Low / P2 · Theme and chunk-error affordances need closure
**Evidence:** SOURCE. main.tsx accepts theme=light, while inspected active tokens.css defines only root/dark. Its lazy MarketDesk import has no local catch/fallback in the entry code. Neither has been browser-reproduced here.
**Impact:** advertised variants can be incomplete; a failed chunk can leave little recovery context.
**Fix:** finish only the theme currently advertised, or remove unsupported affordances until after submission. Add a simple accessible route-load failure state. Do not spend the final day building an optional theme suite.
**Acceptance:** supported entry variants render consistently; blocked chunk produces a recoverable message. No fake performance claims.

## Keep, do not regress
Buyer-scoped usePurchase; separate MarketDesk lazy chunk; declared data/permission modes; null and unknown-cost handling; exact values behind access controls; source evidence drawers; current domain/payment tests; original Bullseye visual direction. Chart honesty and payment uncertainty are product value, not clutter to remove.

## Release priorities
P0 navigation + geometry first. P1 modal/history/legibility/offer/error states next. P2 only after these pass. A coherent frontend is preferable to a new chart library, a fourth dashboard or more speculative trading UI.

## Sources
All repository links are pinned, not moving main:
- [App.tsx](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/App.tsx)
- [main.tsx](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/main.tsx)
- [MarketDesk.tsx](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/market/MarketDesk.tsx)
- [Comparison.tsx](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/market/Comparison.tsx)
- [desk.css](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/styles/desk.css)
- [tokens.css](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/styles/tokens.css)
- [market.css](https://github.com/0xSkrillah/bullseye/blob/f590f5a8085c8f8b2833bdb227ee6c50163ade0b/apps/web/src/market/market.css)

## Resolution log — fill after implementation
| ID | Current reproduction | Files/lines changed | Test and artifact | Status | Remaining limitation |
|---|---|---|---|---|---|
| BF-01 … BF-09 | Pending actual checkout validation | None by this audit | See isolated evidence only | NOT FIXED BY THIS PACK | Full browser coverage pending |
