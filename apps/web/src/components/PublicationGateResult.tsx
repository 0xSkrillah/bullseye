import { GateRule, type GateResult } from "@bullseye/domain";
import { Enum } from "../primitives/Enum";
import { Id } from "../primitives/Id";
import { Timestamp } from "../primitives/Timestamp";

export interface PublicationGateResultProps {
  gate: GateResult | null;
  briefId?: string | null;
  compact?: boolean;
}

const RULE_ORDER = new Map<string, number>(GateRule.options.map((rule, i) => [rule, i]));

export function PublicationGateResult({ gate, briefId, compact = false }: PublicationGateResultProps) {
  const passed = gate ? gate.findings.filter((f) => f.passed).length : 0;

  if (compact) {
    if (!gate) {
      return (
        <span className="be-gate-chip" data-testid="gate-chip" data-decision="PENDING">
          ◐ GATE RUNNING
        </span>
      );
    }
    const publish = gate.decision === "PUBLISH";
    return (
      <span className={`be-gate-chip ${publish ? "is-publish" : "is-reject"}`} data-testid="gate-chip" data-decision={gate.decision}>
        {publish ? "✓" : "✕"} {gate.decision} · {passed}/{gate.findings.length}
      </span>
    );
  }

  if (!gate) {
    return (
      <section className="be-gate is-held" data-testid="gate-result" data-decision="PENDING">
        <div className="be-gate-head">
          <span className="g mono" aria-hidden="true">
            ◐
          </span>
          <h3 className="be-gate-title">Gate running</h3>
        </div>
      </section>
    );
  }

  const publish = gate.decision === "PUBLISH";
  const inSchemaOrder = [...gate.findings].sort((a, b) => (RULE_ORDER.get(a.rule) ?? 0) - (RULE_ORDER.get(b.rule) ?? 0));
  const rows = publish ? inSchemaOrder : [...inSchemaOrder.filter((f) => !f.passed), ...inSchemaOrder.filter((f) => f.passed)];

  return (
    <section className={`be-gate ${publish ? "is-passed" : "is-rejected"}`} data-testid="gate-result" data-decision={gate.decision}>
      <div className="be-gate-head">
        <span className="g mono" aria-hidden="true">
          {publish ? "✓" : "✕"}
        </span>
        <h3 className="be-gate-title">{publish ? "Published" : "Not published"}</h3>
        <span className="be-gate-sub">
          gate {gate.gateVersion} · <Timestamp iso={gate.evaluatedAt} /> · confidence cap <Enum value={gate.confidenceCap} />
        </span>
      </div>
      <ul>
        {rows.map((f) => (
          <li key={f.rule} data-rule={f.rule} data-passed={f.passed}>
            <span className={`g ${f.passed ? "v-pass" : "v-fail"}`} aria-hidden="true">
              {f.passed ? "✓" : "✕"}
            </span>
            <span className={f.passed ? undefined : "v-fail"}>
              <Enum mono value={f.rule} />
              {f.detail && <span className="why"> · {f.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="be-gate-next">
        {passed} of {gate.findings.length} rules passed.{" "}
        {publish ? (
          briefId ? (
            <>
              Brief <Id value={briefId} short /> available for purchase.
            </>
          ) : null
        ) : (
          "Held. Not published. Nothing charged."
        )}
      </div>
    </section>
  );
}
