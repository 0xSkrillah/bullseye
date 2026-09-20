import { networkName } from "../lib/networks";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { TargetMark } from "./SiteNav";

/** what the payment rail is, as the API reports it; null while /api/health has not answered */
export interface OfferRail {
  rail: string;
  network: string;
  ready: boolean;
  isTestnet: boolean;
  detail: string;
}

export interface BriefOfferProps {
  briefId: string | null;
  withdrawn: boolean;
  priceUsd: string;
  rail: OfferRail | null;
  /** the x402 resource an agent buys from, when the desk publishes one */
  resourcePath: string | null;
  /** the desk's own note on how its money is accounted; shown as written */
  economicsNote: string;
}

/**
 * The offer, on the same screen as the event it is about.
 *
 * It states what is for sale, what it costs, on which network, and what that network means for the
 * money, before anyone clicks anything. Nothing here is fetched from a paid route and nothing here
 * is a value a buyer pays for: the price and the rail are public configuration, and the link opens
 * the report's own page, where the existing quote and payment flow runs unchanged.
 *
 * The target is marked only when a Brief actually exists — the gate published it — and never for a
 * withdrawn or missing one.
 */
export function BriefOffer({ briefId, withdrawn, priceUsd, rail, resourcePath, economicsNote }: BriefOfferProps) {
  if (briefId === null) {
    return (
      <aside className="mk-offer is-empty" data-testid="brief-offer" aria-label="Report">
        <span className="mk-offer-eyebrow">Evidence brief</span>
        <p className="mk-offer-line">No brief has been published for this event. The issuer's side above is everything the desk has, and nothing is for sale.</p>
      </aside>
    );
  }

  if (withdrawn) {
    return (
      <aside className="mk-offer is-empty" data-testid="brief-offer" aria-label="Report">
        <span className="mk-offer-eyebrow">Evidence brief</span>
        <p className="mk-offer-line">This report is no longer on sale: the issuer cancelled or replaced the action it describes. Anyone who bought it earlier can still open it.</p>
        <p className="mk-offer-id mono">{briefId}</p>
      </aside>
    );
  }

  return (
    <aside className="mk-offer" data-testid="brief-offer" aria-label="Report for sale">
      <span className="mk-offer-eyebrow">
        <TargetMark size={14} />
        Evidence brief
      </span>

      <p className="mk-offer-line">Issuer announcement, the X Layer reads that check it, and the uncertainties that remain — written as one document for a person or an agent.</p>
      <ul className="mk-offer-list">
        <li>What happened, and why it may matter</li>
        <li>The on-chain observations, with their values</li>
        <li>Every evidence item with its source URL, fetch time and sha256</li>
        <li>Confidence, unknowns, conflicts and limitations</li>
      </ul>

      <div className="mk-offer-price" data-testid="brief-offer-price">
        <strong className="mono">{priceUsd} USD</strong>
        {rail === null ? (
          <span className="mk-offer-rail">Payment availability not confirmed.</span>
        ) : (
          <>
            <span className="mk-offer-rail mono" title={rail.network}>
              {rail.rail} · {networkName(rail.network)}
            </span>
            {rail.isTestnet && <ProvenanceBadge kind="TESTNET" />}
            <span className="mk-offer-rail">{rail.isTestnet ? "A test payment on a test network. It is not revenue and no real money moves." : rail.ready ? "Paid over x402 when you open the report." : "The payment rail is not accepting payments right now."}</span>
          </>
        )}
      </div>

      <a className="be-btn be-btn-primary mk-offer-cta" href={`/?brief=${encodeURIComponent(briefId)}`} data-testid="brief-offer-cta">
        View this brief
      </a>
      <p className="mk-offer-id mono">{briefId}</p>

      {resourcePath && (
        <details className="mk-more">
          <summary>Agent access: x402 endpoint</summary>
          <p className="mk-offer-line">
            <span className="mono">{resourcePath}</span> answers <span className="mono">402 Payment Required</span> with the quoted terms in a header, not an error page. An agent signs those terms and repeats the
            request to receive the same document. A browser opening it directly will see the challenge, which is what it is meant to do.
          </p>
        </details>
      )}

      <p className="mk-offer-note">{economicsNote}</p>
    </aside>
  );
}
