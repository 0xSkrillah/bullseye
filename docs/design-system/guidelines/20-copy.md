# UI copy

Exact strings for the demo. Enum values come from `packages/domain` and are shown raw in the `label` or `mono` style; the human lines beside them are fixed here. Change a string here before changing it in code.

## Stage labels (`label` style, uppercase)

FEED · INVESTIGATION · BRIEF · PURCHASE · CONSOLE · RECONCILIATION

## Provenance (`ProvenanceBadge`) — `DataMode` plus two derived tags

| Label | Colour | Meaning | Tooltip |
| --- | --- | --- | --- |
| LIVE | `verified` dot | Fetched from the named source during this operation | "Fetched 09:41:03Z from api.xstocks.com." |
| CACHED | `uncertain` dot | A previous LIVE response, served because the source failed | "Cached 2026-09-18 08:10Z; source failed at 09:41Z." |
| HISTORICAL | `historical` dot | A recording of a real past response, or a read of past chain state | "Chain state at block 12 884 090." |
| FIXTURE | `fixture` dot, dashed border | Synthetic test data; never from a real system | "Fixture. Not sourced from a real system." |
| STALE | `invalid` `✕` | Past `staleAfter`; cannot support publication | "Stale since 09:52:00Z. Blocks publication." |
| TESTNET | `uncertain` outline, no dot | Rail is `OKX_X402_TESTNET`; never revenue | "X Layer testnet. Not revenue." |

The Brief header shows the Brief's own `dataMode` (the weakest of its inputs) as the first badge, then the `synthesis.mode` as "MODEL: LIVE" or "MODEL: FIXTURE".

## SignalCard

- Eyebrow: `category` humanised — "CORPORATE_ACTION_REBASE" → "Corporate action · rebase"
- Title: `headline` in present tense — "Dividend rebase applied: multiplier 1.000000 → 1.004871"
- Asset line: "KOx · Coca-Cola Co. (xStock) · X Layer"
- Times: "Detected 09:41:07Z · Observed 09:40:52Z"
- Reason: "Flagged: {reasonFlagged}" — "Flagged: multiplier changed +0.4871% against a 30-day median of 0%"
- Facts strip (`mono`): "CA {corporateActionId} v{version} · {caType} · {status}"
- Locked marker: "▸ LOCKED"
- Noise marker: "Not investigated" (`ink-secondary`)
- Empty feed: "No events in the last 15 min." · Loading: "Listening…"

## InvestigationTimeline — `TimelineEntry.type`

| type | glyph | label example | detail example |
| --- | --- | --- | --- |
| STARTED | ○ | "Investigation inv_… started" | "Budget $0.25 · 6 model calls · 12 tool calls · 90 s" |
| MODEL_CALL | ◐ / ✓ | "claude synthesis 1/2" | "1 842 in · 611 out tokens · 3.1 s" |
| TOOL_CALL | → | "xstocks.corporateActions" | "1 record · CA-2026-0918-KO" |
| EVIDENCE | ✓ | "EV-CA-RECORD" | "CORPORATE_ACTION_RECORD · LIVE · stale after 10:41Z" |
| CHECKS | ✓ / ? / ✕ | "5 checks" | "4 PASS · 1 UNKNOWN · 0 FAIL" |
| GATE | ✓ / ✕ | "Publication gate v1" | "11 rules · PUBLISH · confidence cap HIGH" |
| STOPPED | ✕ | "Stopped: BUDGET_TOOL_CALLS_EXCEEDED" | "12 of 12 tool calls used" |
| PUBLISHED | ✓ | "Brief brf_… published" | "09:41:48Z" |
| REJECTED | ✕ | "Rejected by gate" | "EVIDENCE_FRESH failed: EV-PRICE stale" |

Footer: "{n} entries · {model} model calls · {tool} tool calls · {seconds} s · ${cost} measured". Never: any sentence starting with "I", "We think", "Probably", "It seems".

## EvidenceDrawer — `EvidenceItem`

- Title: "{id}" — "EV-ONCHAIN-AFTER" · Subtitle: `kind` — "ONCHAIN_MULTIPLIER_AFTER"
- Summary: code-written, e.g. "On-chain multiplier read at block 12 884 102, 6 s after activation."
- Fields: "Observed" · "Stale after" · "Source" · "Fetched" · "Mode" · "sha256"
- Values table eyebrow: "VALUES · MACHINE-CHECKABLE" with `values` as key/value rows in `mono`
- Actions: "Open source ↗" · "Close"

## Brief — `BriefDraft`

- Title: `headline`
- Header badges: `dataMode`, "MODEL: {synthesis.mode}", confidence level
- Sections, always all present, in this order: "What happened" · "Why it may matter" · "On-chain observations" · "Evidence" · "Confidence" · "Unknowns" · "Conflicts" · "Limitations"
- Each claim ends with its evidence ids as `mono` chips: "[EV-CA-RECORD] [EV-ONCHAIN-AFTER]"; each quantity in text is underlined dotted and links to its evidence value
- Confidence line: "{LEVEL} — {rationale}"; when `gate.confidenceCap` < level: "Capped at {CAP} by the publication gate."
- Conflicts empty: "No conflicts. {n} consistency checks passed." · Conflicts item: "{checkId} · {description}"
- Disclaimer, verbatim from code, always the last line: "Bullseye Briefs describe observed market-structure events and the evidence for them. They are not investment, legal or tax advice and contain no recommendation to buy, sell or hold any asset."
- Machine link: "JSON · bullseye.brief/v1 · sha256 {contentHash…}"

## ConfidenceIndicator

- Levels: HIGH (3 arcs, `verified`) · MEDIUM (2 arcs, `uncertain`) · LOW (1 arc, `uncertain`)
- Cap note: "Capped at {CAP} by the publication gate: {detail}"
- Withdrawn (gate REJECT): 0 arcs, `invalid`, "Not published"

## UnknownsPanel

- Titles: "Unknowns" · "Conflicts"
- Unknown item: `?` + text · Conflict item: `✕` + "{checkId} · {description}"
- Counter: "{n} open" · Conflicts empty: "No conflicts. {n} checks passed."

## BriefPaywall — `Quote` / `QuoteTerms`

- Eyebrow: "IMMUTABLE QUOTE" · Price: "$3.00" · Sub: "3.000000 USDC · eip155:1952" · Tag: "TESTNET"
- Meta: "quo_… · terms sha256 {termsHash…} · expires 09:59:00Z ({mm:ss})"
- Body: "Pay once to unlock the full Brief. These terms are frozen and hashed; they cannot change after you approve. If payment cannot be confirmed, nothing is delivered and a retry cannot charge you twice."
- Primary: "Pay $3.00 via OKX x402" · Secondary: "View evidence first"
- Expired: "Quote expired at 09:59:00Z." · Button: "Request new quote"

## PaymentState — `OrderState`

| state | colour | line |
| --- | --- | --- |
| QUOTED | `ink-secondary` | "Quote quo_… issued 09:43:50Z · $3.00 · TESTNET" |
| PAYMENT_PENDING | `uncertain` | "Authorization received 09:44:02Z · awaiting facilitator settlement" |
| PAYMENT_UNKNOWN | `uncertain` pulse | "No answer from facilitator after 90 s. Neither success nor failure. Bullseye will not deliver until the chain confirms. A retry cannot charge you twice." |
| RECONCILIATION_REQUIRED | `uncertain` | "Reading X Layer for tx 0x8b1d…77e0 · checked 09:46:10Z" |
| PAYMENT_FAILED | `invalid` | "Payment failed: {reason}. Nothing delivered. Nothing charged." |
| PAID | `verified` | "Paid 09:44:47Z · tx 0x8b1d…77e0 · chain-verified at block 4 182 990" |
| DELIVERING | `ink` | "Delivering Brief brf_… (attempt {n})" |
| DELIVERY_FAILED | `invalid` | "Delivery failed: {reason}. Payment stands; delivery will be retried." |
| DELIVERED | `verified` | "Brief delivered 09:44:48Z · sha256 matches quote terms" |

Payment evidence sub-lines: "Facilitator: {facilitatorStatus}" · "Chain verified: yes/no" · "Explorer ↗".

## EconomicsReceipt — `EconomicsReceipt`

- Title: "Receipt · ord_… · brf_…" · Rail tag: "OKX_X402_TESTNET" + TESTNET
- Sections (never summed together): "Price" · "Measured usage" · "Measured costs" · "Estimated costs" · "Estimated contribution"
- Price line: "$3.00" + "Not revenue (testnet)." from `revenueNote`
- Usage lines: "Model calls" · "Tool calls" · "Input tokens" · "Output tokens" · "Investigation latency" · "Usage is fixture: yes/no"
- Measured cost line: "{label} · {detail}" — "Claude synthesis · MEASURED_USAGE_AT_LIST_PRICE"; "X Layer RPC · NO_MARGINAL_PRICE"
- Estimated cost line: "{label} · estimated · {detail}" — "Payment fee reserve · estimated"
- Contribution: "≈ $2.47 · estimated" + `contributionNote`: "Price − measured − estimated. Excludes labour, hosting, acquisition, overhead, tax. Not profit."
- Paid stamp: "✓ PAID 09:44:47Z" only when `state` ≥ PAID

## PublicationGateResult — `GateResult`

- Decision heading: PUBLISH → "Published" (`verified`) · REJECT → "Not published" (`invalid`) · pending → "Gate running" (`uncertain`)
- Sub: "gate {gateVersion} · {evaluatedAt} · confidence cap {confidenceCap}"
- Findings, one row per `GateRule` in schema order, glyph + rule + detail: SCHEMA · INVESTIGATION_COMPLETED · MANDATORY_EVIDENCE_PRESENT · EVIDENCE_FRESH · EVIDENCE_MODE_ALLOWED · CLAIMS_CITE_KNOWN_EVIDENCE · QUANTITIES_RESOLVE_TO_EVIDENCE · NUMBERS_IN_TEXT_ARE_EVIDENCED · NO_INVESTMENT_ADVICE · FAILED_CHECKS_DISCLOSED · CONFIDENCE_WITHIN_CAP
- Next line, REJECT: "Held. Not published. Nothing charged." · PUBLISH: "Brief brf_… available for purchase."
