Bullseye is an autonomous intelligence desk for tokenised markets. Every screen tells one story, left to right and top to bottom: **SIGNAL → INVESTIGATE → VERIFIED INTELLIGENCE → PURCHASE → DELIVERY.** A judge should be able to name which stage they are looking at within two seconds. If a screen cannot be placed on that line, it does not belong in the demo.

This is not "AI trading". Bullseye never predicts price, never shows a P&L curve, never recommends a position. It detects an event, investigates it within a budget, passes a deterministic publication gate, sells a verified Brief over OKX x402 on X Layer, and proves what that Brief cost and what it is worth. Design every surface to make that restraint visible.

## Content fundamentals

Write like a desk analyst filing a wire note, not like a chatbot.

- Lead with the fact, then the asset, then the source. "Dividend rebase applied — KOx — xStocks corporate-action feed, 09:41Z." Never "We noticed something interesting about KOx!"
- Present tense for the event, past tense for what Bullseye did. "Issuer raises multiplier 1.000000 → 1.004871." / "Fetched corporate-action record; read on-chain multiplier before and after."
- No first-person voice, no exclamation marks, no emoji anywhere in the product. Bullseye refers to itself as "Bullseye", never "I" or "we".
- Every claim carries a provenance word. A number without LIVE, CACHED, HISTORICAL or FIXTURE beside it is a bug. The weakest label wins: one FIXTURE input makes the whole Brief FIXTURE, and the Brief header says so.
- Distinguish **measured** from **estimated** in the words, not only the colour: "Measured cost $0.0142", "Estimated contribution ≈ $2.47". Estimates carry the word *estimated* or the `≈` glyph and are set in `uncertain`; measured amounts never are. Measured and estimated lines are never summed under one heading.
- Testnet is never revenue. A price paid on `OKX_X402_TESTNET` shows the TESTNET tag and the sentence "Not revenue." beside it.
- Say what is unknown. Every Brief has an Unknowns section and it is never empty by design; the schema requires at least one line.
- Confidence is a level, not a score: "HIGH", "MEDIUM" or "LOW", with the gate's cap shown when it binds: "MEDIUM · capped by gate (evidence 3 CACHED)". Never a percentage, never the word "certain".
- Chain of thought is never shown. The InvestigationTimeline lists *what happened*: STARTED, MODEL_CALL, TOOL_CALL, EVIDENCE, CHECKS, GATE, STOPPED, PUBLISHED, REJECTED. Entries read "TOOL_CALL onchain.multiplier → 1.004871 at block 12 884 102" not "Bullseye thinks the issuer may have…".
- Casing: sentence case for everything except the `label` style, which is always UPPERCASE (labels, badges, column heads, enum values shown raw). Symbols are uppercase in `mono`.
- Numbers: tabular figures, thin-space thousands separators, ISO-8601 UTC timestamps with a trailing Z (`2026-09-18 09:41:07Z`). Relative time only as a secondary line ("14 s ago"). Multipliers to six decimals, percentages to four, USD to two (six for on-chain amounts).
- Identifiers are shown, never hidden: `sig_…`, `brf_…`, `quo_…`, `ord_…`, `EV-…`, `CHK-…`, tx hashes truncated to `0x8b1d…77e0` with the full value in `title`.

Real copy from the demo, for tone:

> **Dividend rebase applied** · KOx · Detected 09:41:07Z (observed 09:40:52Z) · Flagged: multiplier changed +0.4871% against a 30-day median of 0% · LIVE

> Confidence HIGH — Issuer record and on-chain multiplier agree to six decimals; activation block confirmed by an independent read.

> Payment state: **PAYMENT_UNKNOWN.** The facilitator did not answer within 90 s. This is neither success nor failure. Bullseye will not deliver until the chain confirms the transfer, and a retry cannot charge you twice.

## Visual foundations

### Colour

Charcoal canvas, off-white ink, and three state hues that are spent like money.

- The page is `canvas`; cards are `canvas-raised`; anything that floats is `canvas-overlay`; anything that is raw data (receipts, evidence values, the radar field) sinks to `canvas-inset`. Depth is four flat steps separated by `line`; there is no elevation shadow except `shadow-overlay` under a drawer or the paywall sheet.
- Text is `ink` on every surface. Secondary text is `ink-secondary`. `ink-muted` is for tertiary metadata at 13px and above only; it never carries anything a judge must read.
- `verified` (green) means one of two things: a check that PASSED or evidence that supports publication, or money that has actually moved (PAID, DELIVERED). It is never used for "good news", growth, a rising multiplier, or an upward arrow. If green appears on a screen, a judge should be able to point at the thing that passed or was paid.
- `uncertain` (amber) means Bullseye is telling you the limits of what it knows: MEDIUM or LOW confidence, a gate cap, unknowns, an UNKNOWN check, CACHED, PAYMENT_PENDING, PAYMENT_UNKNOWN, RECONCILIATION_REQUIRED, TESTNET, and every *estimated* number. An estimated contribution is amber text with the word "estimated"; it may never be set in green.
- `invalid` (red) means a thing failed or is not to be trusted: a FAILED check, STALE evidence, PAYMENT_FAILED, DELIVERY_FAILED, a REJECT gate decision, an expired quote. Red is never used for a falling number.
- `fixture` (lavender) marks synthetic or replayed data. It exists so a judge can never mistake a fixture for a live event.
- State fills (`verified-fill`, `uncertain-fill`, `invalid-fill`, `fixture-fill`) are backgrounds for badges and banners only, always paired with the matching hue as text or a 1px border. They are never a panel surface.
- No gradients. No glow. No neon. The only translucency in the system is `radar-sweep`, the sweep wedge in the radar field.
- Two themes, one rule set. **Terminal (dark)** is the product and the demo. **Projector (light)** exists for a bright finale room or a printed screenshot: `<html data-theme="light">`. Every token has a value in both; roles do not change (green still means passed or paid, amber still means estimate). Nothing in a component may reference a hex value; only tokens, so a theme switch is one attribute. Contrast in light: `ink` 16.3:1, `ink-secondary` 7.0:1, `verified` 5.7:1 (5.2:1 on `canvas-inset`), `uncertain` 6.0:1, `invalid` 6.0:1, `fixture` 7.1:1 on `canvas`; `line-strong` 3.6:1.

Contrast: `ink` 16.4:1, `ink-secondary` 8.3:1, `verified` 7.6:1, `uncertain` 8.7:1, `invalid` 5.6:1 and `fixture` 9.2:1 on `canvas`; all stay above 4.5:1 on `canvas-raised` and `canvas-overlay` (the lowest pair is `invalid` on `canvas-overlay`, 4.9:1). `ink-muted` is 4.3:1 on `canvas` and is therefore restricted as described. `line-strong` is 3.1:1 on `canvas` and is the only border that carries meaning; `line` is decorative. The focus ring is offset 2px so it always sits on the surface around a control, never on a `verified` fill.

### Typography

Two families, both hosted by Google Fonts: **IBM Plex Sans** for words and **IBM Plex Mono** for anything a terminal would print.

- Prose (`body`, `body-sm`), headings (`heading`, `title`, `display`) and eyebrow labels (`label`) are Plex Sans.
- Timestamps, symbols, hashes, identifiers, amounts, multipliers, tool names, enum values, table cells and every figure a person might compare are Plex Mono (`mono`, `mono-sm`, `numeral`) with `font-variant-numeric: tabular-nums`.
- One `numeral` per panel: the price, the multiplier change, the contribution estimate. Two big numbers on one panel compete; pick the one the stage is about.
- Brief prose never exceeds `measure` (68ch).
- Load: `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap`.

### Spacing and layout

A 4px grid. Cards pad `space-4`, panels `space-6`, the Brief's sections are separated by `space-8`. Desktop gutter `space-6`, phone gutter `space-4`.

The desk is a three-column terminal on desktop (≥1200px): **Feed | Working area | Console**, at 320px | fluid | 360px. On tablets (768–1199px) the Console collapses into a top strip of four figures and the Feed becomes a left rail of 280px. On phones (<768px) the three regions are stacked and switched with a segmented control. The stage a screen belongs to is always printed in the `label` style at the top-left of its region: FEED, INVESTIGATION, BRIEF, PURCHASE, CONSOLE, RECONCILIATION.

### Borders, radii, shadows

- Panels: 1px `line`, `radius-md`. Selected or focused panel: 1px `line-strong`.
- Badges and cells: `radius-sm`. Dots, rings and the reticle: `radius-full`.
- The only shadow is `shadow-overlay` under floating layers.
- Meaning is carried by borders and words, never by shade alone: a locked SignalCard has a `line-strong` border *and* a `▸ LOCKED` marker in its header.

### The target motif

Bullseye's mark is a target: concentric rings from `radius-full` in `ink` at 1px, with a filled centre dot of `size-dot`. It appears at three sizes: 16px (inline, before the product name), 56px (the ConfidenceIndicator ring, whose three arcs are the three confidence levels), and as the full radar field (`size-radar`) in the hero. The radar field draws rings and a crosshair in `radar-grid` on `canvas-inset`, a sweep wedge in `radar-sweep`, noisy events as `ink-muted` dots, and the locked event as an `ink` reticle that expands into a Brief. No other iconography borrows the ring.

### Motion

Motion is reserved for the four transitions that tell the story; everything else is instant.

1. Events enter the radar field: 240ms ease-out, opacity 0→1 at their position.
2. Lock-on: the reticle contracts from 1.4× to 1× over 320ms, then the sweep stops.
3. Feed → Brief: the SignalCard's header travels to the Brief title over 280ms (a shared-element transition); the rest of the Brief fades in after.
4. Order states advance with a 160ms cross-fade; PAYMENT_UNKNOWN pulses its amber dot at 1.2 s, the only looping animation in the product.

Respect `prefers-reduced-motion: reduce`: all four become instant, the pulse becomes static.

### States

Every component has these states where they apply, and each is named in words in the component's preview: default, hover (`canvas-overlay` background), selected (`line-strong` border + marker), focus (2px `focus` ring, 2px offset), disabled (`ink-muted` text, no border change), loading (a `mono-sm` "Fetching…" line, never a spinner larger than 12px), empty ("No events in the last 15 min."), and error (an `invalid` banner with a retry button).

## Iconography

Glyphs, not an icon set. Bullseye uses Unicode glyphs set in `mono` so they align with figures: `●` dot, `◐` running, `○` empty, `▸` selected, `→` result, `≈` estimate, `✓` passed (only in `verified`), `✕` failed (only in `invalid`), `?` unknown (only in `uncertain`), `⟳` re-check. No emoji. No filled shields, bulls, coins, dollar signs, lightning bolts or rockets. If an icon set becomes necessary in the implementation, use Lucide at 16px, 1.5px stroke, in `ink-secondary`, and keep the glyph vocabulary above for state.

## What Bullseye never shows

A price chart of any kind, a projected-profit curve, a portfolio balance, a "buy" or "sell" affordance, a sponsor logo wall, a chat input, a streaming reasoning transcript, a glowing lock or shield, a green number that is an estimate, a testnet payment presented as revenue, a fixture presented as live.
