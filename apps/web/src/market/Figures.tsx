import { LABELS, type CostAssumption, type Figure } from "./data";
import { Timestamp } from "../primitives/Timestamp";

/**
 * One figure. The label comes first, because what kind of claim a number is matters more than the
 * number: a reader who takes a REFERENCE DISCREPANCY for a tradable spread has been misled even if
 * every digit is right. A figure with no value shows the inputs it is missing in the space the
 * number would have occupied, so an absence is as legible as a figure.
 *
 * No value on this screen is rendered in the verified colour. None of them is an amount anyone
 * offered, so none of them earns it.
 */
export function FigureCard({ figure, onOpenEvidence }: { figure: Figure; onOpenEvidence: (id: string) => void }) {
  const label = LABELS[figure.label];
  const missing = figure.label === "INSUFFICIENT_DATA";
  return (
    <article className={`mk-figure${missing ? " is-missing" : ""}`} aria-label={figure.key}>
      <span className="mk-label" data-tone={label.tone} title={label.meaning}>
        {label.text}
      </span>

      {missing ? (
        <span className="mk-value is-none">Not shown</span>
      ) : (
        <span className="mk-value">
          {figure.signed && figure.value !== null && !figure.value.startsWith("-") && figure.value !== "0" ? "+" : ""}
          {figure.value}
          <br />
          <span className="mk-unit">{figure.unit}</span>
        </span>
      )}

      <p className="mk-figure-head">{figure.headline}</p>

      {missing && figure.missing.length > 0 && (
        <ul className="mk-missing">
          {figure.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {figure.inputs.length > 0 && (
        <details className="mk-more">
          <summary>Inputs ({figure.inputs.length})</summary>
          <div className="mk-inputs">
            {figure.inputs.map((i) => (
              <div className="mk-input" key={i.name}>
                <b>{i.name}</b>
                <span className={i.value === null ? "mono mk-input-empty" : "mono"}>{i.value ?? "not available"}</span>
                <span className="mk-input-empty">
                  {i.unit}
                  {i.observedAt && (
                    <>
                      {" · "}
                      <Timestamp iso={i.observedAt} full />
                    </>
                  )}
                  {i.evidenceId && (
                    <>
                      {" · "}
                      <button type="button" className="mk-evi-btn" onClick={() => onOpenEvidence(i.evidenceId!)}>
                        {i.evidenceId}
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {figure.limitations.length > 0 && (
        <details className="mk-more">
          <summary>Limitations ({figure.limitations.length})</summary>
          <ul className="mk-limits">
            {figure.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/**
 * The costs a buyer would have to know about. An unknown cost is printed as unknown, never as zero:
 * a zero would quietly turn a missing input into a favourable assumption, and every net figure on
 * this screen is suppressed precisely because these are unknown.
 */
export function Costs({ costs }: { costs: CostAssumption[] }) {
  return (
    <div className="mk-scroll">
      <table className="mk-table">
        <thead>
          <tr>
            <th scope="col">Cost</th>
            <th scope="col">Value</th>
            <th scope="col">Unit</th>
            <th scope="col">Basis</th>
            <th scope="col">What the desk knows</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td className="mk-num">{c.value === null ? <span className="mk-none">unknown</span> : c.value}</td>
              <td className="mk-num">{c.unit}</td>
              <td className="mk-num">{c.basis === "ISSUER_PUBLISHED" ? "issuer published" : "unknown"}</td>
              <td className="mk-why">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
