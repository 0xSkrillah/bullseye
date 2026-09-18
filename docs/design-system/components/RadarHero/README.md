The hero interaction: a radar field on `canvas-inset` in which noisy events enter one by one, the sweep turns, Bullseye locks onto one event, and that event expands into the first lines of a Brief. It is the demo's opening 20 seconds and the only place motion carries the story.

## When to use

The top of the Feed screen at 480px (`size-radar`) on desktop, 280px on phones. After lock-on it shrinks to 160px above the SignalCard list and stays static. Nowhere else; the ConfidenceIndicator and the inline mark reuse the ring, not the field.

## Anatomy

1. Field: `radius-full`, 1px `line` border, four rings and a crosshair in `radar-grid`.
2. Sweep: a 34° wedge in `radar-sweep`, one turn per 4 s, stops on lock.
3. Noise: 36 dots, `ink-muted`, r 2.5, entering at 70 ms intervals with a 240 ms fade (positions are seeded so the picture is identical every run).
4. Target: one dot becomes `ink`, r 3.5; the reticle (two rings and four ticks in `ink`, 1.5px) contracts from 1.4× over 320 ms with a `radar-sweep` halo.
5. Brief pop (`brief-pop`): a 300px `canvas-overlay` card anchored to the target with the locked event's eyebrow, headline, symbol, time and LIVE badge, fading in 340 ms after lock. Clicking it, or the locked SignalCard, runs the shared-element transition into the Brief.
6. Left copy: stage line in `label`, the 16px mark + "Bullseye" in `display`, the tagline in `body` `ink-secondary`, the five stage words with the current one in `ink`, and the count line "{n} events · 15 min · {0|1} locked" in `mono-sm`.

## Reduced motion

All events appear at once, the reticle is drawn at 1× immediately, the sweep is static, the pop appears without transition.

## The consumer provides

`size`, `noise`, `lockAfterMs`, and `onLock` (which starts the investigation and updates the count line). In the React app the field is an SVG component driven by the real first `SignalEvent`; the helper here is the reference implementation.

## Do / don't

- Do keep the field monochrome apart from the one translucent sweep; colour arrives with the LIVE badge on the pop.
- Don't add a scanline shader, glow, particles, a globe, or a ticker of prices.
- Don't lock onto more than one event; one target is the name.
