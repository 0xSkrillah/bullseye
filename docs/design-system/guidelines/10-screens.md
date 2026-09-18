# Screens and layouts

Six screens, one per stage plus one for failure. The 3.5-minute demo walks them in order; design nothing that is not on this path.

## Grid

| Breakpoint | Layout | Gutter | Notes |
| --- | --- | --- | --- |
| Desktop ≥1200px | Feed 320px · Working area fluid (min 560px) · Console 360px | `space-6` | All three regions visible. The stage label sits top-left of each region. |
| Tablet 768–1199px | Feed rail 280px · Working area fluid; Console collapses to a 72px strip of four figures above the working area | `space-6` | Console strip: Price · Measured cost · Est. contribution · Order state. |
| Phone <768px | One region at a time; segmented control FEED / WORK / CONSOLE pinned at top | `space-4` | The radar hero is 280px in diameter and scrolls away. |

Regions are panels: `canvas-raised`, 1px `line`, `radius-md`, padding `space-6`. The working area is the only region that scrolls independently.

## Demo timeline (3.5 min)

0:00 hero radar, events entering (screen 1) · 0:20 lock-on, Feed card locked · 0:35 Investigation timeline runs live (screen 2) · 1:20 gate PUBLISH, Brief header appears (screen 3) · 1:50 paywall, pay via OKX x402 (screen 4) · 2:20 PAID → DELIVERED, receipt fills (screen 5) · 2:50 failure states: PAYMENT_UNKNOWN, stale evidence, REJECT (screen 6) · 3:20 close on the receipt.

## 1 · Bullseye Feed — stage SIGNAL

A vertical list of `SignalCard`s, newest first, in the Feed region. Above the list: the radar field at 160px (the hero shrinks into this after lock-on) and the count line in `mono-sm` — "38 events · 15 min · 1 locked". Each card shows `asset.symbol`, `headline`, `detectedAt`/`observedAt`, `reasonFlagged`, the facts strip and a `ProvenanceBadge` for `provenance.mode`. Exactly one card is *locked* at a time (border `line-strong`, `▸ LOCKED`). Empty state: "No events in the last 15 min." Loading: "Listening…" in `mono-sm` with the sweep running.

## 2 · Investigation — stage INVESTIGATE

The working area shows the locked signal's header (symbol · headline · detected time) and the `InvestigationTimeline`: one row per `TimelineEntry`, newest at the bottom, glyph by `type` and `ok`, `label` in `mono`, `detail` in `ink-secondary`. Rows of type EVIDENCE open the `EvidenceDrawer` from the right (400px, `canvas-overlay`, `shadow-overlay`). A budget bar under the header shows used/ceiling for cost, model calls, tool calls and latency in `mono-sm`. No reasoning text appears anywhere on this screen; the footer reads "14 entries · 2 model calls · 7 tool calls · 41 s · $0.0142 measured". A STOPPED entry ends the timeline with its `StopReason` in `invalid`.

## 3 · Bullseye Brief — stage VERIFIED INTELLIGENCE

The working area becomes a document at `measure` width with a fixed header: the `ConfidenceIndicator` at 96px on the left; `headline` in `title`, then the badges `dataMode`, "MODEL: LIVE|FIXTURE" and the `PublicationGateResult` compact chip on the right. Sections in this order, always all present: **What happened · Why it may matter · On-chain observations · Evidence · Confidence · Unknowns · Conflicts · Limitations**, then the disclaimer verbatim and the JSON link with `contentHash`. Claims end with evidence-id chips; quantities in text link to the `EvidenceItem.values` entry that backs them. Unknowns and Conflicts use the `UnknownsPanel`. The `BriefPaywall` covers the body from "Why it may matter" down until the order is DELIVERED; the header, "What happened" and the `BriefPreview` counts (evidence, unknowns, conflicts) are always free.

## 4 · Purchase — stage PURCHASE

The `BriefPaywall` sheet: `QuoteTerms` rendered as an immutable block (`numeral` `priceUsd`, `amount`/`asset` in base units, `network` as `eip155:…`, `payTo`, `termsHash`, `expiresAt` countdown), the TESTNET tag when `rail` is `OKX_X402_TESTNET`, and one primary button "Pay $3.00 via OKX x402". After the click the sheet body swaps to `PaymentState`, which walks QUOTED → PAYMENT_PENDING → PAID → DELIVERING → DELIVERED, or stops honestly at PAYMENT_UNKNOWN / PAYMENT_FAILED / DELIVERY_FAILED / RECONCILIATION_REQUIRED. The terms block never re-renders with different values; if the quote expires, a new `Quote` with a new id is requested explicitly.

## 5 · Bullseye Console — stage DELIVERY

The Console region is the `EconomicsReceipt` plus the order line. Price (with `revenueNote`), Measured usage, Measured costs (one row per `CostLine` with `basis` MEASURED), Estimated costs (rows with `basis` ESTIMATED, all amber), Estimated contribution (`uncertain`, `≈`, `contributionNote`), and the current `OrderState` with `PaymentEvidence` (facilitator status, chain verified, block, explorer link). Only PAID/DELIVERED get a `verified` `✓`; `countsAsRevenue` false prints "Not revenue." beside the price.

## 6 · Failure and reconciliation — stage RECONCILIATION

Same layout as Purchase/Console, with three honest failure states shown in words and never hidden behind a retry spinner:

- **Payment unknown** — `PaymentState` in PAYMENT_UNKNOWN: amber pulse, the fixed sentence from the copy section, `paymentKey` hash shown truncated so the judge sees why a retry maps to the same order. Button: "Reconcile from chain" → RECONCILIATION_REQUIRED, then PAID or PAYMENT_FAILED.
- **Stale evidence** — an EVIDENCE row past `staleAfter` gets the STALE badge and a strike-through; the gate finding EVIDENCE_FRESH fails; `PublicationGateResult` shows REJECT with that rule's detail. The Brief is not offered for sale.
- **Publication rejected** — `PublicationGateResult` in REJECT: every rule listed, the failing ones first in `invalid` with `detail` ("NUMBERS_IN_TEXT_ARE_EVIDENCED: '0.49%' has no evidence value"), and the next line "Held. Not published. Nothing charged." Red text and a red 1px border; no red surface.
