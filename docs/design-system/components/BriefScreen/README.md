The Verified-intelligence screen assembled from the system: the Brief header (ConfidenceIndicator at 96px, headline, the Brief's own dataMode badge, the model mode and the gate chip), the eight sections in fixed order with evidence-id chips and dotted quantities, the Unknowns and Conflicts panels, the disclaimer and JSON hash, and the BriefPaywall covering everything from "Why it may matter" down. The Console column shows the free BriefPreview counts, an order that has not started, and the gate result.

## What this page demonstrates

- The free/paid line: header, "What happened", and the preview counts are free; the paywall sits on a solid `canvas` block with a `line-strong` top rule, never a fade, so the judge sees exactly where the paid part starts.
- Every number in the prose is dotted-underlined and carries the evidence id and value key in its tooltip; the publication gate's NUMBERS_IN_TEXT_ARE_EVIDENCED rule is visible as a reading experience.
- Evidence items are listed with their kind and their own ProvenanceBadge; the header badge is the weakest of them.
- The paywall reuses the exact BriefPaywall markup; nothing on this screen is a one-off.

## Layout

Desktop: document at `measure` (68ch) in the working area, Console at 360px on the right, 24px gutter. Below 900px the Console stacks under the document. Section gap `space-8`; header separated by a `line` rule.

## In the app

`screens/Brief.tsx` composes `ConfidenceIndicator`, `ProvenanceBadge`, `PublicationGateResult` (compact), `UnknownsPanel` ×2 and `BriefPaywall` over a `BriefDraft`; the locked region starts after the first section and is removed when the order reaches DELIVERED, at which point the delivery envelope's `brief` replaces the preview.
