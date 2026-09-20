# Bounded implementation plan

**Target: 20 focused hours**, including a two-hour reserve, not a new product build. Planning date20 September2026. Confirm deadline25 September23:59UTC from the organiser before release; freeze new UI features on24 September. If fewer hours remain, cut optional theme/animation/extra views before payment tests or clarity.

| Phase | Hours | Work and exit condition |
|---|---:|---|
| 0 Baseline | 2 | Inspect HEAD, source packs' merge log, current instructions/checkout; run build/tests; capture actual key-route screenshots. Confirm which audit issues persist. |
| 1 Task wiring | 4 | Exact-Brief links, URL history, persistent event picker, shared reachable nav. Preserve all existing entry URLs and recovery storage. Browser route tests pass. |
| 2 Design and readability | 5 | One coherent hero/event/offer composition; repair grid breakpoints; type and contrast token pass; move technical explanations to accessible disclosure. No fake metrics or extra app. |
| 3 Interaction completeness | 3 | Dialog focus lifecycle, public error/empty/loading states, clear testnet offer and safe recovery notices, reduced-motion signature tied to actual state. |
| 4 QA and demo | 4 | Existing tests+build, new browser regression checks, all relevant sizes, keyboard/200%zoom, performance observations, screenshots and90-second demo. Record coverage honestly. |
| Reserve | 2 | External blockers, unexpected regressions, clean handoff. |

## Touch files intentionally
Likely frontend scope: `apps/web/src/App.tsx`, `main.tsx`, layout/nav components, `market/MarketDesk.tsx`, `market/Comparison.tsx`, market presentation files, shared CSS tokens and responsive layout, frontend tests. Verify current structure before editing. Existing checkout implementation is reused, not replaced. Backend/API changes only if essential to routing/public projection and explicitly documented/tested, not a pretext for feature expansion.

## No scope creep
No full trading dashboard, execution buttons, new token, extra market data vendor, authentication rewrite, Framer/MUI/Next migration, design-only fourth route, invented performance targets met by placeholder content or bypass of the paywall. Do not raise model budgets to make the demo animate more often.

## Coordination
One owner of main entry/routing and shared tokens. Separate component/QA tasks may run in parallel only with agreed file boundaries. Stop before resolving unexplained concurrent changes or a dirty index destructively.

## Final handoff
Current commit/branch; actual commands and outputs; before/after screenshots; resolved and open findings; source+payment mode per demo; known wallet/deployed test limits; owner actions before submission. Do not claim the new UI is deployed unless it was separately authorized and verified.
