import type { MarketSignalRow } from "./data";

/**
 * The explanatory layer, above the event.
 *
 * The screen used to open on a balance having changed with no transfer to show for it. That
 * sentence only means something to a reader who already knows that a tokenised stock pays its
 * dividend by multiplying balances. This says that first, in the order the pitch deck proved:
 * these are real companies · the dividend has nowhere to land · one number moves and every
 * balance follows. Only then the event.
 *
 * On provenance, which this screen is otherwise strict about. Two of the three bands describe a
 * MECHANISM — how a rebasing token works — which is documented, is not event-specific and is not
 * a claim about anything Bullseye observed, so it carries no LIVE/CACHED/HISTORICAL label and
 * nothing here is bound to evidence. The two bands that do carry data say where it came from: the
 * asset strip names its route and its data mode, and the worked example uses the multipliers the
 * issuer published for the event on screen, with the holding sizes marked as chosen illustrations
 * rather than anything observed. Nothing in this file states the absence of a transfer as
 * measured: no log sweep was carried out, and the wording reasons from how a multiplier works.
 */

/** the issuer names every asset "<Company> xStock"; the company is what a reader recognises */
const company = (name: string) => name.replace(/\s+xStock$/i, "");

interface PrimerProps {
  rows: MarketSignalRow[];
  dataMode: string | null;
  /** the event on screen, so the worked example is the one whose figures follow */
  symbol: string;
  multiplierOld: string | null;
  multiplierNew: string | null;
  /** choosing another event, so the spread table doubles as a way into the extremes */
  onChoose: (signalId: string) => void;
  chosenId: string | null;
}

/**
 * Three holdings, chosen to span the sizes a reader pictures: a person, a fund, a custodian.
 * They are illustrations and are labelled as such — no holder of this size is observed anywhere.
 * The arithmetic is the issuer's own ratio applied to a round number, at three decimals, which is
 * far inside what a double represents exactly for values of this size.
 */
const HOLDINGS = [
  { who: "A small holder", tokens: 42 },
  { who: "A fund", tokens: 1_000 },
  { who: "A custodian", tokens: 8_500 },
];

/** thin-space thousands separators and three decimals, per the design system's number rules */
const tokens = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/,/g, " ");

export function Primer({ rows, dataMode, symbol, multiplierOld, multiplierNew, onChoose, chosenId }: PrimerProps) {
  const live = rows.filter((r) => !r.superseded);
  const assets = [...new Map(live.map((r) => [r.signal.asset.symbol, r.signal.asset])).values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  const mOld = multiplierOld === null ? null : Number(multiplierOld);
  const mNew = multiplierNew === null ? null : Number(multiplierNew);
  const scale = mOld !== null && mNew !== null && mOld > 0 ? mNew / mOld : null;

  return (
    <section className="mk-primer" aria-labelledby="mk-primer-h">
      <h2 className="mk-h2" id="mk-primer-h">
        What a tokenised stock does with a dividend
      </h2>

      <div className="mk-band">
        <span className="mk-eyebrow">WHAT THESE ARE</span>
        <h3 className="mk-band-h">Real companies, held as tokens.</h3>
        <p className="mk-band-p">
          A share in Meta or Broadcom, issued on a blockchain instead of held at a broker. The company behind it still pays a dividend.
        </p>
        <ul className="mk-assets" data-testid="primer-assets">
          {assets.map((a) => (
            <li className="mk-asset" key={a.symbol}>
              <span className="mono mk-asset-sym">{a.symbol}</span>
              <span className="mk-asset-co">{a.name === undefined ? "" : company(a.name)}</span>
            </li>
          ))}
        </ul>
        <p className="mk-band-foot mono">
          {assets.length} assets on X Layer · {live.length} dividend events on record · GET /api/signals{dataMode ? ` · ${dataMode}` : ""}
        </p>
      </div>

      <div className="mk-band">
        <span className="mk-eyebrow">WHY THE BALANCE MOVES</span>
        <h3 className="mk-band-h">A dividend with nowhere to land.</h3>
        <p className="mk-band-p">
          A token has no cash account. So the dividend is not paid to you — it is ploughed back in, and your holding is made bigger instead.
        </p>
        <div className="mk-compare" data-testid="primer-compare">
          <div className="mk-compare-col">
            <span className="mk-eyebrow">AT A BROKER, AS YOU KNOW IT</span>
            <ol className="mk-steps">
              <li>The company pays a dividend</li>
              <li>Cash lands in your account</li>
              <li>A line appears on your statement</li>
            </ol>
          </div>
          <div className="mk-compare-col mk-compare-col-focus">
            <span className="mk-eyebrow">AS A TOKEN, ON A BLOCKCHAIN</span>
            <ol className="mk-steps">
              <li>The company pays a dividend</li>
              <li>Tax is withheld; the rest buys more shares</li>
              <li className="mk-step-key">Every holder&rsquo;s balance is made bigger</li>
              <li className="mk-step-key">No line appears anywhere</li>
            </ol>
          </div>
        </div>
        <p className="mk-band-foot mono">
          The issuer publishes the gross amount, the withholding rate and the net · nobody publishes what the chain then did
        </p>
      </div>

      {scale !== null && (
        <div className="mk-band">
          <span className="mk-eyebrow">ON THE CHAIN</span>
          <h3 className="mk-band-h">One number moves. Every balance follows.</h3>
          <p className="mk-band-p">
            Your balance is your raw balance multiplied by one figure the contract holds. Raise it once and every holding is scaled at the
            same instant, whoever holds it.
          </p>
          <p className="mk-fan-mult mono" data-testid="primer-multiplier">
            <span className="mk-eyebrow">ONE MULTIPLIER, FOR EVERYONE</span>
            <span className="mk-fan-mult-v">
              {multiplierOld} &rarr; {multiplierNew}
            </span>
          </p>
          <ul className="mk-fan" data-testid="primer-fanout">
            {HOLDINGS.map((h) => (
              <li className="mk-fan-cell" key={h.who}>
                <span className="mk-eyebrow">{h.who.toUpperCase()}</span>
                <span className="mono mk-fan-v">
                  {tokens(h.tokens)} &rarr; {tokens(h.tokens * scale)}
                </span>
                <span className="mono mk-fan-d">+{tokens(h.tokens * scale - h.tokens)} {symbol}</span>
              </li>
            ))}
          </ul>
          <div className="mk-fan-history" data-testid="primer-history">
            <span className="mk-eyebrow">AND THE TRANSACTION HISTORY</span>
            <p className="mk-band-p">Empty. Nobody sent anything, so there is nothing to record.</p>
          </div>
          <p className="mk-band-foot mono">
            Multipliers as the issuer published them for this event. The three holdings are chosen illustrations, not observed balances.
          </p>
        </div>
      )}

      <Spread rows={live} onChoose={onChoose} chosenId={chosenId} />
    </section>
  );
}

/**
 * The reason to buy a report for one event rather than eyeball it.
 *
 * Two of the figures below the fold are errors, and the gap between them is not a constant: on an
 * asset whose multiplier has been climbing for years, counting a rebase twice is wrong by far more
 * than the rebase itself, and on an asset at 1.0 the two are the same number. Nothing on the screen
 * used to say that, and a reader cannot tell which case they are in by looking.
 *
 * The ratio is (multiplierNew − 1) · multiplierOld / (multiplierNew − multiplierOld), which is the
 * double-application error over the event impact. It is computed here from the issuer's published
 * multipliers and rounded to one decimal: the exact percentages are the API's own figures, shown to
 * their full precision on the cards below, and this is a ratio between them rather than a new claim.
 */
function Spread({ rows, onChoose, chosenId }: { rows: MarketSignalRow[]; onChoose: (id: string) => void; chosenId: string | null }) {
  const scored = rows
    .map((r) => {
      const o = Number(r.signal.facts?.multiplierOld);
      const n = Number(r.signal.facts?.multiplierNew);
      if (!Number.isFinite(o) || !Number.isFinite(n) || n === o || o <= 0) return null;
      return { id: r.signal.id, symbol: r.signal.asset.symbol, ratio: ((n - 1) * o) / (n - o) };
    })
    .filter((x): x is { id: string; symbol: string; ratio: number } => x !== null)
    .sort((a, b) => b.ratio - a.ratio);
  const worst = scored[0];
  if (worst === undefined) return null;
  return (
    <div className="mk-band">
      <span className="mk-eyebrow">WHY YOU CANNOT TELL BY LOOKING</span>
      <h3 className="mk-band-h">Counting it twice costs a different amount on every asset.</h3>
      <p className="mk-band-p">
        Applying the multiplier to a balance that already includes it is the commonest way to get one of these events wrong. How wrong is
        set by how far the multiplier has drifted from 1 over the asset&rsquo;s whole life, not by the size of this dividend.
      </p>
      <ul className="mk-spread" data-testid="primer-spread">
        {scored.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`mk-spread-row${s.id === chosenId ? " is-chosen" : ""}`}
              onClick={() => onChoose(s.id)}
              aria-current={s.id === chosenId ? "true" : undefined}
            >
              <span className="mono mk-spread-sym">{s.symbol}</span>
              <span className="mk-spread-bar" aria-hidden="true">
                <span style={{ width: `${(Math.log10(s.ratio) / Math.log10(worst.ratio || 10)) * 100}%` }} />
              </span>
              <span className="mono mk-spread-x">{s.ratio < 1.05 ? "1×" : `${s.ratio.toFixed(1)}×`}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mk-band-foot mono">
        The double-application error over the event itself, from the issuer&rsquo;s published multipliers, rounded. Choose a row to open that
        event.
      </p>
    </div>
  );
}
