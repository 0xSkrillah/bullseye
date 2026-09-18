Two lists that make the Brief honest: Unknowns (`draft.unknowns`, what Bullseye could not establish) and Conflicts (`draft.conflicts` joined to their `ConsistencyCheck`, where sources disagree). Both are always rendered; the schema requires at least one unknown, and an empty Conflicts list is stated in words.

## When to use

The Unknowns and Conflicts sections of every Brief, in that order, after Confidence and before Limitations. Also the Investigation screen once CHECKS has run (Conflicts only).

## Anatomy

1. Head: title in `heading` ("Unknowns" / "Conflicts") and a counter in `mono-sm` on the right — "3 open" in `uncertain` for unknowns; for conflicts "{fail} · {pass} PASS · {unknown} UNKNOWN" in `invalid` when any FAIL, else "0" in `verified`.
2. Rows: glyph column (16px) · text · optional right-hand source in `mono-sm`. Unknowns use `?` in `uncertain`. Conflicts use `✕` in `invalid` for a FAIL check and `?` in `uncertain` for UNKNOWN, with the `checkId` in `mono` before the description and the `CheckStatus` word on the right.
3. Empty Conflicts: "No conflicts. {n} consistency checks passed." in `body-sm`, `ink-secondary`. The panel never disappears.

## States

Default; empty (Conflicts only); fixture (a FIXTURE badge in the head when the Brief's `dataMode` is FIXTURE). No hover or selection: rows are not interactive except the `checkId`, which opens the check's evidence ids in the EvidenceDrawer.

## The consumer provides

For Unknowns: `string[]`. For Conflicts: `{checkId, description}[]` plus the `ConsistencyCheck[]` to look up status and detail.

## Do / don't

- Do keep each unknown one sentence, ending with a full stop; the model writes them, the panel does not edit.
- Don't hide the panel when a Brief looks clean; "No conflicts. 5 checks passed." is a feature.
- Don't colour the whole panel by severity; only the glyph and counter carry state.
