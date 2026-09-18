The live record of an investigation: one row per `TimelineEntry` (STARTED, MODEL_CALL, TOOL_CALL, EVIDENCE, CHECKS, GATE, STOPPED, PUBLISHED, REJECTED), with the research budget above and measured usage below. It shows what Bullseye *did*, never what it *thought*.

## When to use

The working area of the Investigation screen, and read-only under a published Brief's Evidence section. Nowhere else.

## Anatomy

1. Header line in `label`: "Investigation · {id} · {symbol}".
2. Budget bar (`be-budget`): four cells — Cost, Model calls, Tool calls, Latency — each "used / ceiling" from `ResearchBudget` in `mono`, with a 2px track in `line-strong` and fill in `ink`. Turns `invalid` only when a ceiling is hit (a STOPPED entry follows).
3. Rows (`be-tl-row`, one `<button>` per entry): glyph · `label` in `mono` (148px, ellipsised) · `detail` in `ink-secondary` with figures in `ink` · a `ProvenanceBadge` for EVIDENCE rows · `at` as `hh:mm:ssZ`.
4. Footer in `mono-sm`: entries · model calls · tool calls · seconds · "$x measured" (sum of `UsageRecord.costUsd` where `costBasis` ≠ FIXTURE; a FIXTURE basis prints "$0 · fixture").

## Glyph and tone by type

| type | glyph | tone |
| --- | --- | --- |
| STARTED, TOOL_CALL | `○`, `→` | `ink-secondary` (`is-neutral`) |
| MODEL_CALL running | `◐` | `uncertain` (`is-running`) |
| EVIDENCE, CHECKS, GATE ok, PUBLISHED | `✓` | `verified` (`is-ok`) |
| any entry with `ok: false`, STOPPED, REJECTED | `✕` | `invalid` (`is-bad`) |
| EVIDENCE past `staleAfter` | `✕` + STALE badge | `is-stale`: label and detail struck through in `invalid`; the row stays |

## States

- **Running**: the last row is a MODEL_CALL or TOOL_CALL with `◐` and "Running…"; the footer's seconds tick.
- **Complete**: ends with PUBLISHED or REJECTED.
- **Stopped**: ends with STOPPED and the `StopReason` in bold `ink` inside the detail ("BUDGET_TOOL_CALLS_EXCEEDED · 12 of 12 tool calls used"). Nothing after it.
- **Hover** on an EVIDENCE row: `canvas-overlay`; click opens the `EvidenceDrawer`. Other rows are focusable but open nothing.

## The consumer provides

`InvestigationView.timeline`, the `UsageRecord[]` for the footer, the `ResearchBudget` for the bar, and `onOpenEvidence(id)`.

## Do / don't

- Do render `label` and `detail` verbatim; they are code-written.
- Don't collapse, group or summarise rows; the count is part of the story.
- Don't render any model text here. Synthesis output appears only in the Brief.
