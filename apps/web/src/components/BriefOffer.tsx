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
        <TargetMark size={14} hit />
        Evidence brief
      </span>

      <p className="mk-offer-line">
        One dated document that answers <em>what actually happened here, and who says so</em> — to file with a close, attach to a reconciliation, or send to whoever asked why the number moved. The
        issuer can revise or cancel its own record later; this one is hashed and does not change.
      </p>
      <ul className="mk-offer-list">
        <li>What happened, and why it may matter</li>
        <li>The X Layer reads either side of the effective time, and the block the change activated at</li>
        <li>Every evidence item with its source URL, fetch time and sha256</li>
        <li>What was checked, what it found, and what stayed unknown</li>
      </ul>
      <p className="mk-offer-line mk-offer-quiet">
        Readable as it stands, or parsed: the same document is one JSON object with a stable schema and a content hash.
      </p>

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
      <p className="mk-offer-recovery">
        You see the exact terms and their hash before you approve anything. If a payment cannot be confirmed, nothing is delivered and pressing pay again cannot charge you twice; this browser
        keeps a claim for the order, so closing the page does not lose a purchase already made.
      </p>
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
