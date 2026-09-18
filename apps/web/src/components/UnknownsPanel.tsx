import { useId, type CSSProperties } from "react";
import type { BriefDraft, ConsistencyCheck } from "@bullseye/domain";
import { Enum } from "../primitives/Enum";

export type UnknownsPanelProps =
  | { title: "Unknowns"; unknowns: BriefDraft["unknowns"] }
  | { title: "Conflicts"; conflicts: BriefDraft["conflicts"]; checks: readonly ConsistencyCheck[] };

const counter = (tone: "verified" | "uncertain" | "invalid"): CSSProperties => ({ fontSize: 11, color: `var(--${tone})` });

/** Never hidden when empty: an empty panel is a statement, not an absence. */
export function UnknownsPanel(props: UnknownsPanelProps) {
  const headingId = useId();

  if (props.title === "Unknowns") {
    return (
      <section className="be-unknowns" aria-labelledby={headingId}>
        <div className="be-unknowns-head">
          <h3 className="be-unknowns-title" id={headingId}>
            Unknowns
          </h3>
          <span className="mono" style={counter("uncertain")}>
            {props.unknowns.length} open
          </span>
        </div>
        <ol>
          {props.unknowns.map((text, i) => (
            <li key={i}>
              <span className="g" aria-hidden="true">
                ?
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const { conflicts, checks } = props;
  const byId = new Map(checks.map((c) => [c.id, c]));
  const pass = checks.filter((c) => c.status === "PASS").length;
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const unknown = checks.filter((c) => c.status === "UNKNOWN").length;

  return (
    <section className="be-unknowns" aria-labelledby={headingId}>
      <div className="be-unknowns-head">
        <h3 className="be-unknowns-title" id={headingId}>
          Conflicts
        </h3>
        {conflicts.length === 0 ? (
          <span className="mono" style={counter("verified")}>
            0
          </span>
        ) : (
          <span className="mono" style={counter(fail > 0 ? "invalid" : "uncertain")}>
            {conflicts.length} · {pass} PASS · {unknown} UNKNOWN
          </span>
        )}
      </div>
      {conflicts.length === 0 ? (
        <p className="empty" style={{ margin: 0 }}>
          No conflicts. {pass} consistency checks passed.
        </p>
      ) : (
        <ol>
          {conflicts.map((c) => {
            const check = byId.get(c.checkId);
            const failed = check?.status === "FAIL";
            return (
              <li key={c.checkId} className={failed ? "is-conflict" : undefined}>
                <span className="g" aria-hidden="true">
                  {failed ? "✕" : "?"}
                </span>
                <span>
                  <span className="mono">{c.checkId}</span> · {c.description}
                </span>
                {check && (
                  <span className="s">
                    <Enum value={check.status} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
