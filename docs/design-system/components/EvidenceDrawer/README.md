A right-hand dialog that shows one `EvidenceItem` exactly as the system holds it: its id and kind, the code-written summary, observed and stale-after instants, the source and hash, and the machine-checkable `values` map that Brief quantities resolve to.

## When to use

Opened from an EVIDENCE row in the InvestigationTimeline, from an evidence-id chip in the Brief, or from a quantity in Brief text. It floats over the working area at 400px on desktop (`canvas-overlay`, `shadow-overlay`) and is full-width on phones.

## Anatomy

1. Head: `id` in `mono` as the title ("EV-ONCHAIN-AFTER"), `kind` and "n of total" under it in `mono-sm`; the `ProvenanceBadge` for `provenance.mode` on the right, plus STALE when `now > staleAfter`.
2. Summary: `summary` verbatim, `body-sm`. When stale, an `invalid` sentence replaces the position: "Past staleAfter since {t}. Cannot support publication."
3. Key/value list (`be-kv`): Observed · Stale after · Source (`provenance.source`) · Fetched (`fetchedAt`) · sha256 (truncated, full in `title`) · Note when present.
4. Values block (`be-excerpt`) on `canvas-inset`, eyebrow "VALUES · MACHINE-CHECKABLE": every `values` key and value in `mono`, aligned. This is what the publication gate checks Brief numbers against; showing it is the point.
5. Actions: "Open source ↗" (opens `provenance.url` in a new tab) and "Close".

## States

- **Default** (fresh): badge by mode.
- **Stale**: STALE badge added, summary line in `invalid`, "Stale after" value in `invalid`.
- **Fixture**: FIXTURE badge; a `fixture` one-line banner above the summary: "Fixture. Not sourced from a real system."
- **Loading**: title and kv skeleton in `line`; "Fetching…" in `mono-sm`. Never a spinner.

## Accessibility

`role="dialog"`, `aria-modal="true"`, labelled by the title; focus moves to the title on open, is trapped inside, and returns to the opening row on close; `Esc` closes.

## The consumer provides

An `EvidenceItem`, `now` for the stale test, `open` and `onClose`.

## Do / don't

- Do show the sha256 and the source URL; a judge should be able to reproduce the fetch.
- Don't paraphrase `summary` or reformat `values`; they are the audit trail.
- Don't add a "trust score", star rating or colour scale to evidence; the mode and the stale test are the only judgements shown.
