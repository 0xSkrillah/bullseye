The deterministic publication gate's verdict: `GateResult.decision` (PUBLISH or REJECT), every `GateRule` with its finding, the `confidenceCap` it imposed, and one sentence saying what happens next. Code decides publication, not the model; this component is where the judge sees that.

## When to use

Full panel on the Investigation screen once the GATE entry lands, and on the Reconciliation screen for a REJECT. Compact chip in the Brief header and in the Console beside the order state.

## Anatomy (full)

1. Head (`be-gate-head`): glyph `✓`/`✕` · title "Published" / "Not published" in `heading`, coloured `verified` / `invalid` · sub in `mono-sm`: "{gateVersion} · {evaluatedAt} · cap {confidenceCap}".
2. Rules list: one row per `GateFinding`, in `GateRule` enum order for PUBLISH; for REJECT the failing rules are sorted first. Each row: `✓` in `verified` or `✕` in `invalid` · `rule` in `mono` · `detail` in `ink-secondary` after a middle dot when present.
3. Next line (`be-gate-next`): "{pass} of {total} rules passed." then the fixed sentence — PUBLISH: "Brief {id} available for purchase." · REJECT: "Held. Not published. Nothing charged."

## Compact chip (`be-gate-chip`)

20px, `label` style, outlined in the decision colour: "✓ PUBLISH · 11/11", "✕ REJECT · 9/11", or "◐ GATE RUNNING" in `line-strong` while `gate` is null. Clicking opens the full panel.

## States

- **PUBLISH**: `line` border, `verified` title and head glyph; all rows `✓`.
- **REJECT**: 1px `invalid` border, `invalid` title; failing rows first; no red surface fill.
- **Running** (`gate` null): chip only, or the panel with "Gate running…" in `uncertain` and rows greyed.

## The consumer provides

A `GateResult` (or null while running), the `briefId` for the next line, and `compact`.

## Do / don't

- Do list all eleven rules every time, including on PUBLISH; the judge should see how many things were checked.
- Don't summarise a REJECT as "Failed"; the rule name and detail are the message.
- Don't offer a "Publish anyway" or override action anywhere in the UI.
