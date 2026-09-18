# Accessibility

The desk is dense; it must still be readable by a judge on a projector and navigable without a mouse.

## Colour and contrast

- Body text is `ink` (16.4:1) or `ink-secondary` (8.3:1) on every canvas surface. `ink-muted` (4.3:1 on `canvas`, 4.1:1 on `canvas-raised`) is confined to 13px+ tertiary metadata that repeats information available elsewhere.
- Every state hue passes 4.5:1 as text on `canvas`, `canvas-raised` and `canvas-overlay`: `verified` 7.6:1, `uncertain` 8.7:1, `invalid` 5.6:1 (4.9:1 on `canvas-overlay`), `fixture` 9.2:1. On their tinted fills they stay above 4.5:1 (verified on verified-fill 6.1:1, uncertain on uncertain-fill 7.0:1, invalid on invalid-fill 4.7:1, fixture on fixture-fill 7.7:1).
- No state is carried by colour alone. Every badge has a word; every verdict has a glyph and a word; the locked card has a border, a marker and the word LOCKED; the estimated contribution has `≈`, the word *estimated* and a footnote.
- Green and red are never adjacent as the only difference between two values: Paid (`verified ✓`) and Failed (`invalid ✕`) differ by glyph and word. `verified` and `invalid` differ in lightness by roughly 1.3:1 only, so the words are load-bearing by design.
- Meaningful borders use `line-strong` (3.1:1 on `canvas`, 3.0:1 on `canvas-raised`). `line` is decorative and may fall below 3:1.
- The focus ring is 2px solid `focus` with 2px offset, so it sits on the surface around the control (16.4:1 on `canvas`, 15:1 on `canvas-overlay`), never on the control's own fill.

## Motion

All four story transitions and the Unknown pulse are disabled under `prefers-reduced-motion: reduce`. The radar sweep stops; events appear in place. Nothing in the product flashes faster than 1 Hz.

## Keyboard and structure

- The three regions are `<section>`s with `aria-labelledby` pointing at their stage label; `F6` cycles regions.
- The Feed is a listbox: `↑/↓` move, `Enter` locks the event and moves focus to the Investigation header.
- The InvestigationTimeline is an ordered list; each row is a button that opens the EvidenceDrawer (`role="dialog"`, `aria-modal="true"`, focus trapped, `Esc` closes and returns focus to the row).
- The BriefPaywall sheet is also a dialog; the primary button has the full price in its label: "Pay 0.25 USDC on testnet".
- PaymentState is `role="status"` with `aria-live="polite"`; each state change announces its full line. The Unknown state announces once, not on every pulse.
- The ConfidenceIndicator ring is `role="img"` with `aria-label="Confidence high, 0.82"`; the number is also visible text.
- Tables in the EconomicsReceipt are real `<table>`s with `<th scope>`; the estimate row's footnote is linked with `aria-describedby`.
- All timestamps carry a `<time datetime>` attribute with the ISO value; relative times are `title`-annotated with the absolute one.

## Type size

Minimum 11px, and only for the `label` and `mono-sm` styles, which are uppercase or figures. Body copy is 14px, dense lists 13px. On a projector the desk is meant to be shown at 125% browser zoom; nothing may overflow at that zoom on a 1440px-wide window.

## Language

Plain English, one idea per sentence, no jargon a judge outside crypto would not know without the tooltip. "Custodian", "issuer", "testnet" and "quote" are the only domain words allowed without explanation.
