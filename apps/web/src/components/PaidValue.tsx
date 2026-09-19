import type { BriefPreview, SignalEvent } from "@bullseye/domain";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface PaidValueProps {
  signal: SignalEvent;
  preview: BriefPreview;
}

/** balance a holder of `held` tokens shows after the rebase: held × new ÷ old. Null when the issuer's figures cannot give one. */
export function rebasedBalance(held: number, multiplierOld: string, multiplierNew: string): number | null {
  const before = Number(multiplierOld);
  const after = Number(multiplierNew);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return null;
  return Math.round(((held * after) / before) * 1e6) / 1e6;
}

const ILLUSTRATION_HELD = 100;

/**
 * The free part of a Brief, in ordinary language: what the issuer announced (public), what Bullseye
 * went and checked (sold), and why a balance that was cached before the event is now wrong.
 * Every figure here comes from the issuer's public record; nothing the chain showed is on this side of the paywall.
 */
export function PaidValue({ signal, preview }: PaidValueProps) {
  const f = signal.facts;
  const symbol = signal.asset.symbol;
  return (
    <>
      <section data-testid="issuer-announcement">
        <h2>What the issuer announced</h2>
        <p>
          The issuer's corporate-action record for {symbol} ({f.caType}, status {f.status}) changes the balance multiplier from <span className="mono">{f.multiplierOld}</span> to{" "}
          <span className="mono">{f.multiplierNew}</span>, a change of <span className="mono">{f.changePct}%</span>. <ProvenanceBadge kind={signal.provenance.mode} title="How the issuer's record was obtained" />
        </p>
        <p style={{ color: "var(--ink-secondary)" }}>This is the issuer's public notice of what is meant to happen. It does not say whether, or when, the token contract on X Layer did it.</p>
      </section>

      <section data-testid="paid-value">
        <h2>What this Brief adds</h2>
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
          <li><b>Did X Layer apply it?</b> <span className="mono">multiplier()</span> read from the token contract before the effective time, after it and at the chain head, compared with the issuer's figure at full precision.</li>
          <li><b>When?</b> The first block in which the new multiplier appears, its timestamp, and its lag against the issuer's stated time.</li>
          <li><b>Is the action still current?</b> Later cancellations and replacements in the issuer's history are checked; a voided action fails a core check and withdraws the Brief.</li>
          <li><b>Do the books still balance?</b> Proof of reserves against circulating supply, supply on X Layer, trading status and the rebase size against the reference price.</li>
          <li><b>Can you check it yourself?</b> {preview.evidenceCount} evidence items, each with its source URL, fetch time, sha256 and a LIVE / CACHED / HISTORICAL / FIXTURE label, plus the consistency checks and every conflict or unknown ({preview.conflictCount} {preview.conflictCount === 1 ? "conflict" : "conflicts"}, {preview.unknownCount} {preview.unknownCount === 1 ? "unknown" : "unknowns"}).</li>
          <li><b>One document for people and agents.</b> The same <span className="mono">bullseye.brief/v1</span> JSON renders here and is delivered to an agent over x402; you can download it after purchase.</li>
        </ul>
      </section>
    </>
  );
}

/** Why the event matters to anyone who stores a balance, with one worked figure from the issuer's own numbers. */
export function BalanceIllustration({ signal }: { signal: SignalEvent }) {
  const f = signal.facts;
  const after = rebasedBalance(ILLUSTRATION_HELD, f.multiplierOld, f.multiplierNew);
  const symbol = signal.asset.symbol;
  return (
      <section data-testid="balance-illustration">
        <h2>Why a cached balance goes wrong</h2>
        <p>
          A rebase changes every holder's balance and emits no <span className="mono">Transfer</span> event, so a wallet, indexer or ledger that cached balances keeps showing the old number until it reads the chain again.
          {after !== null && (
            <> Illustration: an account that showed <span className="mono">{ILLUSTRATION_HELD}</span> {symbol} before the change shows <span className="mono">{after}</span> after it.</>
          )}
        </p>
        <p style={{ fontSize: 11, lineHeight: "16px", color: "var(--ink-secondary)" }}>
          Illustrative. Formula: balance × new multiplier ÷ old multiplier, from the issuer's announced figures, rounded to 6 decimals, assuming the contract applied exactly that change. Whether it did is what the Brief checks. This is a change in
          token count, not an investment return, and nothing here is advice.
        </p>
      </section>
  );
}
