import { useEffect, useId, useMemo, useRef } from "react";
import type { Quote } from "@bullseye/domain";
import { networkName } from "../lib/networks";
import { countdown, instantMs } from "../format";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Money } from "../primitives/Money";
import { Timestamp } from "../primitives/Timestamp";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface BriefPaywallProps {
  quote: Quote;
  /** drives the countdown and the expired state */
  now: Date | string;
  /** the paid request, or a wallet signature for it, is in flight */
  paying?: boolean;
  onPay(): void;
  onViewEvidence?(): void;
  onRequote?(): void;
}


const actions = { display: "flex", gap: 8, flexWrap: "wrap" } as const;

export function BriefPaywall({ quote, now, paying = false, onPay, onViewEvidence, onRequote }: BriefPaywallProps) {
  const headingId = useId();
  const payRef = useRef<HTMLButtonElement>(null);
  const remainingMs = Date.parse(quote.terms.expiresAt) - instantMs(now);
  const expired = remainingMs <= 0;

  useEffect(() => {
    payRef.current?.focus({ preventScroll: true });
  }, [quote.termsHash]);

  // Terms are rendered once per termsHash and never rebuilt from later props.
  const frozen = useMemo(() => {
    const t = quote.terms;
    const network = networkName(t.network);
    return {
      price: <Money usd={t.priceUsd} basis="PRICE" />,
      notRevenue: t.rail !== "OKX_X402_MAINNET",
      fixtureRail: t.rail === "FIXTURE",
      payAria: `Pay ${t.priceUsd} US dollars via OKX x402 on ${network}`,
      list: (
        <dl className="be-kv" style={{ gridTemplateColumns: "88px 1fr" }}>
          <dt>Amount</dt>
          <dd>
            {t.amount} · {t.assetName} ({t.assetDecimals} dp) · <Id value={t.asset} />
          </dd>
          <dt>Network</dt>
          <dd>
            {t.network}
            {network !== t.network ? ` · ${network}` : ""}
          </dd>
          <dt>Pay to</dt>
          <dd>
            <Id value={t.payTo} />
          </dd>
          <dt>Scheme</dt>
          <dd>
            {t.scheme} · <Enum value={t.rail} />
          </dd>
          <dt>Brief</dt>
          <dd>
            <Id value={t.briefId} /> · sha256 <Id value={t.briefContentHash} />
          </dd>
          <dt>Terms</dt>
          <dd>
            <Id value={quote.id} /> · terms sha256{" "}
            <span data-testid="quote-terms-hash" title={quote.termsHash}>
              <Id value={quote.termsHash} />
            </span>
          </dd>
        </dl>
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.termsHash]);

  return (
    <section className={`be-paywall${expired ? " is-expired" : ""}`} role="dialog" aria-labelledby={headingId} data-testid="paywall" data-quote-id={quote.id} data-expired={expired}>
      <span className="be-stage" id={headingId}>
        IMMUTABLE QUOTE
      </span>
      <div className="be-price">
        <span className="numeral" data-testid="quote-price">
          {frozen.price}
        </span>
        {frozen.notRevenue && (
          <span>
            <ProvenanceBadge kind="TESTNET" title={frozen.fixtureRail ? "Fixture rail: no funds move on any chain. Not revenue." : undefined} />
            <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}> Not revenue.</span>
          </span>
        )}
      </div>

      {expired ? (
        <>
          <span className="be-quote-meta">
            <Id value={quote.id} /> · Quote expired at <Timestamp iso={quote.terms.expiresAt} />.
          </span>
          <p>Quote expired before payment. Nothing was charged. A new quote will carry a new id and its own hash.</p>
          <div>
            <button className="be-btn" type="button" onClick={onRequote} data-testid="requote-button">
              Request new quote
            </button>
          </div>
        </>
      ) : (
        <>
          {frozen.list}
          <span className="be-quote-meta" aria-live="off">
            Issued <Timestamp iso={quote.terms.issuedAt} /> · expires <Timestamp iso={quote.terms.expiresAt} /> ({countdown(remainingMs)})
          </span>
          <p>
            Pay once to unlock the full Brief. These terms are frozen and hashed; they cannot change after you approve. If payment cannot be confirmed, nothing is delivered and a retry cannot
            charge you twice.
          </p>
          <div style={actions}>
            <button className="be-btn be-btn-primary" type="button" ref={payRef} onClick={onPay} disabled={paying} aria-label={frozen.payAria} data-testid="pay-button">
              Pay {frozen.price} via OKX x402
            </button>
            {onViewEvidence && (
              <button className="be-btn" type="button" onClick={onViewEvidence}>
                View evidence first
              </button>
            )}
          </div>
          {paying && (
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
              Authorising…
            </span>
          )}
        </>
      )}
    </section>
  );
}
