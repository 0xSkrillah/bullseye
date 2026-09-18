A target ring with three arcs — one lit for LOW, two for MEDIUM, three for HIGH — beside the level word, the model's one-sentence rationale, and the publication gate's cap when it binds. Confidence in Bullseye is a `ConfidenceLevel`, never a score.

## When to use

The Brief header at 96px (`size: 96`), the BriefPreview and Feed hover card at 56px. One per Brief. Never on a SignalCard (events have provenance, not confidence).

## Anatomy

1. Ring (`size-ring`, `radius-full`): three equal arcs with 4px gaps on a `line-strong` track. Lit arcs are `verified` for an uncapped HIGH, `uncertain` for MEDIUM, LOW and any capped level. The centre is the target dot in `ink`; the number of lit arcs is repeated as a digit in the middle so the ring reads without colour.
2. Level word in `mono`, letter-spaced: "HIGH" · "MEDIUM" · "LOW"; with a cap: "HIGH · CAP MEDIUM".
3. Rationale (`draft.confidence.rationale`) in `body-sm`, `ink-secondary`, max 44ch.
4. Cap note in `uncertain` when `gate.confidenceCap` is below the level: "Capped at MEDIUM by the publication gate: {finding detail}". The arcs above the cap are drawn dotted in `line-strong` so the judge sees both what the model said and what the gate allowed.

## States

- **HIGH / MEDIUM / LOW**: as above.
- **Capped**: level word keeps the model's level; colour and the dotted arcs show the cap; note explains why.
- **Withdrawn** (gate decision REJECT): no lit arcs, `✕` in the centre, word "WITHDRAWN" in `invalid`, rationale replaced by "Gate decision REJECT. Not published."
- **Loading**: track only, "—" in the centre, "Investigating…" as the word.

## Accessibility

`role="img"` with `aria-label="Confidence high"`, `"Confidence high, capped at medium"` or `"Confidence withdrawn, not published"`; the level word is also visible text.

## The consumer provides

`level`, `rationale`, optional `cap` (from `GateResult.confidenceCap`) with the finding detail, `withdrawn`, and `size`.

## Do / don't

- Do keep the ring the same size as the 56px target mark; it is the same motif.
- Don't show a percentage, a decimal, a gauge needle or the word "certain". There is no number to show.
- Don't animate the arcs filling; confidence is a verdict, not progress.
