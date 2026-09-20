# Frontend acceptance tests
Status of every test below is **PLANNED**, not executed by this pack. Integrate with current Vitest/Playwright setup; use existing valid fixture data and stand-in wallet, not a second backend mock that skips safety checks.

## A. Navigation and report identity
**NAV01:** From `/market/<non-default signal>` use View brief. Confirm heading/selected event and Brief ID match the clicked report. Reload and direct entry preserve identity. Invalid/withdrawn IDs have distinct states.
**NAV02:** Pick A→B, Back→Forward. URL, heading, comparison and permitted evidence agree. A late API response for A cannot overwrite B.
**NAV03:** Event picker remains visible and keyboard operable after selection; generic /market link returns to the collection as specified.
**NAV04:** All nav destinations work on refresh; no invented `/room` React route if the server serves its own implementation. Preserve old paid/deep links.

## B. Layout and readability
**LAY01:** At360/390/768/1024/1280/1440 and breakpoint boundaries, `document.documentElement.scrollWidth <= innerWidth + 1`. This does not forbid a documented inner table scroller. Do not fix by clipping the page.
**LAY02:** Long asset name, exact multiplier, hash and error string wrap without pushing CTA offscreen. Dialog close accessible at390px.
**LAY03:** At200%zoom and1280x720 the primary action is reachable; sticky sections do not cover focused controls. Fonts failing to load do not make the page unusable.
**LAY04:** Measure actual normal-text contrast and focus visibility; metadata must remain readable. Project44/48px interaction goals are evaluated separately from WCAG AA minimum/exception logic.

## C. Dialog and keyboard
**A11Y01:** Open evidence by Enter; focus moves inside. Tab/Shift+Tab loop appropriately; Escape closes; focus returns to original trigger; background can't be clicked/tabbed while modal.
**A11Y02:** Navigate market→report→quote→recovery without a mouse; no keyboard trap outside intended dialog. Announce consequential changes with restrained aria-live, not every polling tick.
**A11Y03:** Chart data has an accessible equivalent. No required hover-only tooltip; full source strings available to copy/inspect when permitted.

## D. Purchase guardrails (reuse existing tests)
**PAY01:** Quote display shows actual amount/token/network/testnet status. Display formatting cannot change signed amount.
**PAY02:** User rejects signing: clear feedback, no success animation, no missing-capability data loss.
**PAY03:** Payment response lost/unknown: recovery uses same buyer order/capability and authorization path; no new payment is offered while outcome remains unknown.
**PAY04:** Delivered report returns after reload, including when authorization's signing validity expired. No repeat charge; second buyer cannot see this buyer's receipt or claim.
**PAY05:** New UI does not expose full Brief/evidence values in unauthenticated DOM, tooltip, network request or screen-reader label.
**PAY06:** New route/default selection never triggers model spend, wallet connect/sign or quote acceptance without the intended user action/permission.

## E. Data truth and states
**DATA01:** LIVE/CACHED/HISTORICAL/FIXTURE, effective/detection/retrieval times, confidence and payment status remain distinct.
**DATA02:** Missing quote/cost renders Unknown/Unavailable, actual zero remains zero, withheld evidence says included in Brief. No green profit implication from a rebase.
**DATA03:** Rejected, stopped, missing and withdrawn reports are distinct. No publication reveal on failed/unknown data. Report-specific ID/terms always follow selection.
**STATE01:** Slow/loading, empty first run, empty filter, request error and permission states have honest, usable next steps. A GET retry does not trigger paid research.
**STATE02:** Lazy route/chunk failure can be recovered without losing buyer purchase data. Network/font loss does not manufacture a success state.

## F. Demo and performance
**DEMO01:** Run a90-second customer story: select event, understand impact, enter exact report, inspect permitted evidence, demonstrate existing test purchase/recovery or clearly identify it as pending/not run. Never simulate a successful purchase silently.
**PERF01:** Production build bundle report plus a repeatable browser trace where tooling exists. Note environment/cache/throttle; no field Core Web Vitals claim from lab runs.
**QA01:** Before/after captures same route, mode, fixture, viewport and commit; sanitized report contains no buyer capability or secret.

All checks finish PASS/FAIL/NOT RUN with an evidence path. Include unchanged baseline failures separately. The current user request does not authorize live payments or production deployment.
