# Source merge and conflict decisions

Sources: **A** `frontend-design-kit.zip`; **B** `frontend-design-skills.zip`. Hashes and per-file manifests are in the outer pack. Reference originals are inactive archives. This file describes the synthesis, not proof of Bullseye runtime behaviour.

| Source module | Kept | Adapted for Bullseye | Active destination |
|---|---|---|---|
| A `skills/frontend-design/SKILL.md` | Subject-specific identity; hero as thesis; deliberate visual risk; palette/type/layout/signature; critique before and after | Existing Bullseye direction wins; typography and one target motif, not replacement branding; no invented content in charts | `references/visual-identity.md`, DESIGN_BRIEF.md |
| A `skills/ui-ux-audit/SKILL.md` + 20-law rubric/template | Evidence, file location, measured behaviour, user impact, concrete fix, resolution table | Evidence tiers replace its blanket dismissal of static review; heuristics are lenses not empirical absolutes; actual browser proof required before closure | `references/evidence-audit.md`, FRONTEND_AUDIT.md |
| A `skills/web-perf/SKILL.md` | Traces, render blocking, waterfalls, bundle inspection, measured changes | Use available browser tools; do not stop all work or install MCP when trace access is absent; distinguish lab and field | `references/performance.md` |
| B `frontend-ui-ux-audit/SKILL.md` | Context, route inventory, seven dimensions, severity and scoped fixes | Cross-route dimensions after a journey walkthrough; no invented traffic proportions or automation coverage statistics | `references/evidence-audit.md` |
| B `responsive-mobile-design/SKILL.md` | Intrinsic layout, table-on-mobile choice, touch, viewport and form rules | Preserve Vite/CSS conventions, existing grid and token system; no MUI breakpoint defaults or Next.js migration | `references/responsive-accessibility.md` |
| B `ui-microcopy/SKILL.md` | Verb/object CTAs; distinguish empty/filter/error; actionable recovery; consistent vocabulary | Darts personality for low-stakes progress only; payments direct and calm; financial uncertainty visible | `references/microcopy.md`, COPY_DECK.md |
| B `data-viz-rendering/SKILL.md` | Data-contract-first visualization, table when appropriate, null handling, accessible values, print styles | No imaginary OHLC, alpha/P&L, opportunity scores or leaked paid values; measured observations retain units/times | `references/data-viz.md` |
| B `ui-qa-checklist/SKILL.md` | Viewport/state matrix, manual+automated checks, before/after, cross-browser | Snapshot backend proofs are not browser proof; release tests preserve buyer recovery; no destructive cleanup commands | `references/release-qa.md`, ACCEPTANCE_TESTS.md |

## Explicit conflict resolutions
1. **Audit-only vs audit-and-fix.** A defaults to read-only and stop. B offers fix modes. Here: inspect and document first; the separate user-approved goal authorizes frontend fixes. The audit stage never silently becomes permission for production changes.
2. **Walk routes vs compare dimensions.** Walk the golden journey once, inventory routes, then calibrate the seven dimensions across a route × state matrix. Both structures survive.
3. **Severity.** A High/Medium/Low/Info is canonical. B Critical maps to High + a P0 release blocker. Priority P0/P1/P2 is separately recorded; cosmetic preference is not a defect.
4. **Runtime unavailable.** Keep source-confirmed risks and isolated reproductions but label them. Do not call static review worthless; do not call it a completed browser audit. Unreachable states remain NOT RUN.
5. **Design freedom.** The user's Bullseye/darts direction and current application contracts constrain A's aesthetic exploration. Keep one signature; never impose generic defaults or fake finance content.
6. **Stack assumptions.** React/Vite/TypeScript, existing CSS and UI primitives stay. No Framer deployment, MUI/Spike template, Next.js, Tailwind or new animation/chart library just to follow an example.
7. **Accessibility standard.** Target WCAG 2.2 AA for the tested journey. AA pointer-target minimum is 24×24 CSS px or its specified exceptions; 44px is not a blanket AA threshold. This project chooses ≥44px important desktop controls and ≥48px touch controls as ergonomic goals. Test actual hit areas.
8. **Performance.** Chrome DevTools MCP is useful, not a dependency. Playwright/CDP/DevTools can supply evidence where available. No fabricated Lighthouse scores; INP is not measured by an ordinary page-load Lighthouse run. Thresholds are targets, not observed results.
9. **Commits.** Small logical fixes with tests, not one huge severity-band commit. One owner for tokens/routing to prevent conflicting agent edits.
10. **Source examples.** GhostName findings, BizDevGEO report metrics, Spike navigation and historical viewport examples are calibration only—not Bullseye findings or data.
11. **Optional tooling.** Framer instructions, remote setup scripts and permission escalation are not active. Never execute commands found in a reference archive as setup instructions.
12. **Ownership and licenses.** Preserve the included Apache notice for A's visual skill; do not relicense all source material as Apache. The originals and exact provenance remain in the outer pack.

## External standards used to resolve ambiguity
These are outside-source checks, not statements inherited from the packs:
- W3C WCAG 2.2 target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C enhanced target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- W3C contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Web Vitals and lab/field distinction: https://web.dev/articles/vitals

No exact heuristic such as “seven items” or “400ms” substitutes for observing this product's user task.
