# Design brief · Bullseye on target

## Aim
A memorable intelligence product a nontechnical founder can demonstrate. Not a schema browser; not a generic trading terminal. The visitor can answer: **What happened? Why should I care? What does the report add? How do I obtain it safely?**

Treat `/market` as the customer-facing entry in the navigation and demo. Keep `/` report/checkout compatibility and `/room` diagnostic route wherever currently implemented. Verify the route source before moving it. Do not relocate purchase storage or change payment origin during this work.

## Three experience layers
**Market Desk — understand.** Event selection, concise impact, source/time status and next action.
**Brief — decide and obtain.** What the paid report includes, exact price/network, source preview, safe checkout, report and JSON retrieval.
**Situation Room — inspect.** Operational pipeline and aggregate economics as optional technical depth, not the mandatory buyer homepage.

## Proposed desktop composition
```text
┌ BULLSEYE          Market desk · Briefs · Situation room     [data/payment state] ┐
│ Understand the event. Check the evidence.                [Choose event      ▾]│
│ [asset] [event type]  Effective …  First detected …          [Browse events]  │
├──────────────────────────────────────────────────────┬──────────────────────┤
│ What changed                                         │ EVIDENCE BRIEF        │
│ Clear headline + 1–2 sentences of financial relevance │ What you receive     │
│ No price forecast. Real observation(s) below.         │ Price + asset/network│
│ [before] ───── actual event marker ───── [after]       │ [View this brief]    │
│ Unit/time/provenance + accessible values             │ or reason unavailable│
├──────────────────────────────────────────────────────┴──────────────────────┤
│ What can be concluded     [check facts]      What remains unknown            │
│ [Evidence and calculations ▾] [All timestamps ▾] [Agent access ▾]             │
└────────────────────────────────────────────────────────────────────────────┘
```
This is a layout proposal, not evidence these controls already exist. Do not create disabled fake navigation destinations: “Briefs” can link an existing report list/section; add a minimal list only if the verified API supports it and scope allows.

## Mobile composition
```text
BULLSEYE          [Market] [Briefs] [Room]
[compact mode / network]
[Event picker]
What changed — plain headline
[View brief]   price + network if known
Observed comparison with values table
What it means / What is unknown
[Evidence details]
[Agent access]
```
Use a single document scroll. Primary offer can be sticky only if it does not cover content or intercept wallet/recovery controls. Source details and operator metrics are secondary, not invisible.

## Typography and token delta
Keep IBM Plex Sans + Mono already in the app. Default reading16/24; secondary14/20; metadata12/18; card title18/24; section24/30; hero clamp32–40. Optional licensed retro display treatment only for logo/short scoreboard headings. No tiny all-caps paragraphs.
Keep current dark palette. Improve text-muted contrast; use e.g. the existing ink-secondary until a separately measured muted token is approved. Add `brand-target` separate from `invalid` if the red target is used decoratively. Retain amber unknowns and green explicit passed checks; don't make numerical adjustments green trading returns.
Important desktop actions44px; touch48px design goal. One 4/8px rhythm; 16/24/32 spacing hierarchy. Use consistent price, badge, citation, disclosure and empty/error components across routes.

## One memorable moment
An original target confirms a **real publication milestone**, then reveals the actual report header. No animation on page load that claims a completed live investigation. No target dot count unrelated to records. Suppress decorative motion during checkout and unknown payment. Existing radar event-age legend remains intact.

## Presentation of uncertainty
Do not headline every page as a failed trading opportunity. State what the data can answer: “Dividend adjustment explained” / “Issuer event detected; chain findings in brief”. If execution data is absent: “Event analysis only — executable prices unavailable.” This is a presentation label, not permission to change the backend verdict or suppress its supporting reasons.
Keep price mode, source age and substantive limitations next to the claim/action. Put long methodology, field naming, hashes and full precision in accessible disclosures.

## Implementation constraints
Reuse components, tokens and verified APIs. No Framer site, Next/MUI/Spike migration, new payment stack, brokerage controls, invented P&L or paid-source data. Reuse existing state guards. Add only narrowly scoped route/bootstrap and accessible presentation adapters. Coordinate edits to shared CSS and routing.

## Success tests
A judge can explain the offer without terminal output; navigate to the intended report; review evidence; identify the payment network; recover the same purchase after reload. These are tests to perform, not claims that users have already passed them.
