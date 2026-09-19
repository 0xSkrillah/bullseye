import {
  Brief,
  BRIEF_SCHEMA_ID,
  BriefDraft,
  canonicalJson,
  DISCLAIMER,
  GateResult,
  InvestigationView,
  ResearchBudget,
  SignalEvent,
  TimelineEntry,
  UsageRecord,
  weakestMode,
  type ConsistencyCheck,
  type EvidenceItem,
  type StopReason,
} from "@bullseye/domain";
import type { Db } from "../db.js";
import { transaction } from "../db.js";
import { sha256, type SourceTransport } from "../adapters/transport.js";
import type { XLayerAdapter } from "../adapters/xlayer.js";
import type { XStocksAdapter } from "../adapters/xstocks.js";
import { runConsistencyChecks } from "../evidence/checks.js";
import { EvidenceToolbox, TOOL_SPECS } from "../evidence/toolbox.js";
import { evaluatePublication } from "../gate/publicationGate.js";
import { BudgetGovernor, priceUsage, type TokenUsage } from "./governor.js";
import { ModelCallError, ModelUnavailableError, type ModelTurn, type ProviderPricing, type SynthesisProvider, type ToolResult } from "./model.js";
import { BRIEF_DRAFT_JSON_SCHEMA, revisionPrompt, synthesisPrompt, SYSTEM_PROMPT, taskPrompt } from "./prompts.js";

export interface InvestigatorDeps {
  db: Db;
  transport: SourceTransport;
  xstocks: XStocksAdapter;
  xlayer: XLayerAdapter;
  provider: () => SynthesisProvider;
  budget: ResearchBudget;
  /** price of the resulting Brief and the per-order reserves, used for the pre-spend economic check */
  priceUsd: number;
  estimatedReservesUsd: number;
  allowFixturePublication: boolean;
  maxRevisions?: number;
}

class Stop extends Error {
  constructor(
    readonly reason: StopReason,
    detail: string,
  ) {
    super(detail);
  }
}

export interface InvestigationSummary {
  id: string;
  signalId: string;
  symbol: string | null;
  status: InvestigationView["status"];
  stopReason: InvestigationView["stopReason"];
  startedAt: string;
  finishedAt: string | null;
  briefId: string | null;
  gate: { decision: GateResult["decision"]; confidenceCap: GateResult["confidenceCap"] } | null;
  /** how many drafts the gate judged in this run */
  draftsJudged: number;
}

export interface RebaseChain {
  network: string;
  token: string;
  symbol: string;
  /** what the issuer said would happen; multipliers are decimal strings, exactly as published */
  issuer: { multiplierOld: string; multiplierNew: string; effectiveTimeUtc: string };
  reads: { key: "BEFORE" | "AFTER" | "HEAD"; evidenceId: string; blockNumber: number; blockTime: string | null; multiplier: string; mode: string }[];
  /** null when the search ran and found no change, or has not run; `activationSearched` tells them apart */
  activation: { evidenceId: string; blockNumber: number; blockTime: string | null; mode: string } | null;
  activationSearched: boolean;
}

function budgetOrNull(json: string | null | undefined): ResearchBudget | null {
  if (!json) return null;
  try {
    const parsed = ResearchBudget.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function symbolOrNull(signalJson: string): string | null {
  try {
    return (JSON.parse(signalJson) as { asset?: { symbol?: string } }).asset?.symbol ?? null;
  } catch {
    return null;
  }
}

export class InvestigationService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: InvestigatorDeps) {}

  /** One investigation per signal at a time; a published Brief is never re-investigated. */
  start(signal: SignalEvent): { investigationId: string; created: boolean } {
    const { db } = this.deps;
    const existing = db
      .prepare("SELECT id FROM investigations WHERE signal_id = ? AND status IN ('RUNNING', 'PUBLISHED') ORDER BY started_at DESC LIMIT 1")
      .get(signal.id) as { id: string } | undefined;
    if (existing) return { investigationId: existing.id, created: false };

    const startedAt = new Date().toISOString();
    const id = `inv_${sha256(`${signal.id}:${startedAt}`).slice(0, 16)}`;
    let providerInfo = { provider: "unavailable", model: "none", mode: "LIVE" as "LIVE" | "FIXTURE" };
    try {
      providerInfo = this.deps.provider().info;
    } catch {
      // recorded as MODEL_UNAVAILABLE when the run starts
    }
    db.prepare("INSERT INTO investigations (id, signal_id, status, started_at, budget_json, synthesis_json) VALUES (?, ?, 'RUNNING', ?, ?, ?)").run(
      id,
      signal.id,
      startedAt,
      JSON.stringify(this.deps.budget),
      JSON.stringify(providerInfo),
    );
    const run = this.run(id, signal).finally(() => this.running.delete(id));
    this.running.set(id, run);
    return { investigationId: id, created: true };
  }

  /**
   * Runs live in this process, so a run the database still calls RUNNING at start-up was cut off by a
   * restart. It is closed as STOPPED rather than resumed: its budget accounting died with the process.
   */
  recoverInterrupted(): string[] {
    const { db } = this.deps;
    const rows = (db.prepare("SELECT id FROM investigations WHERE status = 'RUNNING'").all() as { id: string }[]).filter((r) => !this.running.has(r.id));
    const at = new Date().toISOString();
    for (const { id } of rows) {
      const next = db.prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM timeline WHERE investigation_id = ?").get(id) as { n: number };
      const entry: TimelineEntry = { seq: next.n, at, type: "STOPPED", label: "Stopped: ERROR", detail: "The server restarted while this investigation was running. It was not resumed and nothing was published.", evidenceId: null, ok: false };
      transaction(db, () => {
        db.prepare("INSERT INTO timeline (investigation_id, seq, json) VALUES (?, ?, ?)").run(id, entry.seq, JSON.stringify(entry));
        db.prepare("UPDATE investigations SET status = 'STOPPED', stop_reason = 'ERROR', finished_at = ? WHERE id = ?").run(at, id);
      });
    }
    return rows.map((r) => r.id);
  }

  /** resolves when the background run for this investigation has finished (tests and scripts) */
  async wait(id: string): Promise<void> {
    await this.running.get(id);
  }

  view(id: string): InvestigationView | null {
    const { db } = this.deps;
    const row = db.prepare("SELECT * FROM investigations WHERE id = ?").get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    const timeline = (db.prepare("SELECT json FROM timeline WHERE investigation_id = ? ORDER BY seq").all(id) as { json: string }[]).map((r) => TimelineEntry.parse(JSON.parse(r.json)));
    return InvestigationView.parse({
      id: row.id,
      signalId: row.signal_id,
      status: row.status,
      stopReason: row.stop_reason,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      briefId: row.brief_id,
      gate: row.gate_json ? JSON.parse(row.gate_json) : null,
      gateAttempts: row.gate_attempts_json ? JSON.parse(row.gate_attempts_json) : null,
      budgetAtStart: budgetOrNull(row.budget_json),
      timeline,
    });
  }

  /** newest first, without timelines: enough to draw every run and pick the one worth watching */
  list(limit = 50): InvestigationSummary[] {
    const rows = this.deps.db
      .prepare(
        `SELECT i.id, i.signal_id, i.status, i.stop_reason, i.started_at, i.finished_at, i.brief_id, i.gate_json, s.json AS signal_json,
                (SELECT COUNT(*) FROM timeline t WHERE t.investigation_id = i.id AND t.json LIKE '%"type":"GATE"%') AS drafts_judged
         FROM investigations i LEFT JOIN signals s ON s.id = i.signal_id ORDER BY i.started_at DESC LIMIT ?`,
      )
      .all(limit) as Record<string, string | number | null>[];
    return rows.map((r) => {
      const gate = r.gate_json ? (JSON.parse(String(r.gate_json)) as GateResult) : null;
      return {
        id: String(r.id),
        signalId: String(r.signal_id),
        symbol: r.signal_json ? symbolOrNull(String(r.signal_json)) : null,
        status: String(r.status) as InvestigationView["status"],
        stopReason: (r.stop_reason as InvestigationView["stopReason"]) ?? null,
        startedAt: String(r.started_at),
        finishedAt: r.finished_at === null ? null : String(r.finished_at),
        briefId: r.brief_id === null ? null : String(r.brief_id),
        gate: gate ? { decision: gate.decision, confidenceCap: gate.confidenceCap } : null,
        draftsJudged: Number(r.drafts_judged),
      };
    });
  }

  /**
   * The on-chain part of a rebase investigation as numbers instead of prose: the issuer's stated change,
   * the multiplier() reads around it and the block it changed in. Everything here is already public in
   * the timeline's evidence summaries; nothing comes from the Brief.
   */
  chain(id: string): RebaseChain | null {
    const row = this.deps.db.prepare("SELECT s.json AS signal_json FROM investigations i JOIN signals s ON s.id = i.signal_id WHERE i.id = ?").get(id) as { signal_json: string } | undefined;
    if (!row) return null;
    const signal = SignalEvent.parse(JSON.parse(row.signal_json));
    const evidence = new Map(this.evidence(id).map((e) => [e.id, e]));
    const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    const reads = (
      [
        ["BEFORE", "EV-CHAIN-BEFORE"],
        ["AFTER", "EV-CHAIN-AFTER"],
        ["HEAD", "EV-CHAIN-LATEST"],
      ] as const
    ).flatMap(([key, evidenceId]) => {
      const e = evidence.get(evidenceId);
      const blockNumber = num(e?.values.blockNumber);
      const multiplier = str(e?.values.multiplierExact);
      if (!e || blockNumber === null || multiplier === null) return [];
      return [{ key, evidenceId, blockNumber, blockTime: str(e.values.blockTimestamp), multiplier, mode: e.provenance.mode }];
    });
    const act = evidence.get("EV-CHAIN-ACTIVATION");
    const activationBlock = num(act?.values.activationBlock);
    if (reads.length === 0 && !act) return null;
    return {
      network: `eip155:${signal.asset.chainId}`,
      token: signal.asset.tokenAddress,
      symbol: signal.asset.symbol,
      issuer: { multiplierOld: signal.facts.multiplierOld, multiplierNew: signal.facts.multiplierNew, effectiveTimeUtc: signal.observedAt },
      reads,
      activation: act && activationBlock !== null ? { evidenceId: act.id, blockNumber: activationBlock, blockTime: str(act.values.activationTimestamp), mode: act.provenance.mode } : null,
      activationSearched: act !== undefined,
    };
  }

  latestForSignal(signalId: string): InvestigationView | null {
    const row = this.deps.db.prepare("SELECT id FROM investigations WHERE signal_id = ? ORDER BY started_at DESC LIMIT 1").get(signalId) as { id: string } | undefined;
    return row ? this.view(row.id) : null;
  }

  /**
   * Every run of a signal reads the same event at the same blocks, so an old run that published nothing
   * still holds what a later run of that signal sells, or is about to.
   */
  signalMayStillSell(signalId: string): boolean {
    return this.deps.db.prepare("SELECT 1 FROM investigations WHERE signal_id = ? AND (brief_id IS NOT NULL OR status = 'RUNNING') LIMIT 1").get(signalId) !== undefined;
  }

  usage(id: string): UsageRecord[] {
    return (this.deps.db.prepare("SELECT json FROM usage WHERE investigation_id = ? ORDER BY seq").all(id) as { json: string }[]).map((r) => UsageRecord.parse(JSON.parse(r.json)));
  }

  evidence(id: string): EvidenceItem[] {
    return (this.deps.db.prepare("SELECT json FROM evidence WHERE investigation_id = ? ORDER BY id").all(id) as { json: string }[]).map((r) => JSON.parse(r.json) as EvidenceItem);
  }

  private async run(id: string, signal: SignalEvent): Promise<void> {
    const { db, deps } = { db: this.deps.db, deps: this.deps };
    let seq = 0;
    let usageSeq = 0;
    const timeline = (type: TimelineEntry["type"], label: string, ok = true, detail: string | null = null, evidenceId: string | null = null) => {
      const entry: TimelineEntry = { seq: seq++, at: new Date().toISOString(), type, label, detail, evidenceId, ok };
      db.prepare("INSERT INTO timeline (investigation_id, seq, json) VALUES (?, ?, ?)").run(id, entry.seq, JSON.stringify(entry));
    };

    const gateAttempts: GateResult[] = [];
    let governor: BudgetGovernor | null = null;
    const recordUsage = (partial: Omit<UsageRecord, "investigationId" | "seq">) => {
      const rec = UsageRecord.parse({ investigationId: id, seq: usageSeq++, ...partial });
      db.prepare("INSERT INTO usage (investigation_id, seq, json) VALUES (?, ?, ?)").run(id, rec.seq, JSON.stringify(rec));
      governor?.record(rec);
    };

    const routed = new Set<string>();
    let stopReason: StopReason = "COMPLETED";
    let stopDetail = "";
    let draft: unknown = null;
    let checks: ConsistencyCheck[] = [];
    let gate: GateResult | null = null;
    const toolbox = new EvidenceToolbox(id, signal, deps.xstocks, deps.xlayer);

    try {
      timeline("STARTED", `Investigating ${signal.asset.symbol}: ${signal.headline}`, true, `budget: $${deps.budget.maxVariableCostUsd} max variable cost, ${deps.budget.maxModelCalls} model calls, ${deps.budget.maxToolCalls} tool calls`);

      const worstCase = deps.budget.maxVariableCostUsd + deps.estimatedReservesUsd;
      if (deps.priceUsd <= worstCase) {
        throw new Stop("DECLINED_UNECONOMIC", `price $${deps.priceUsd.toFixed(2)} does not cover the research budget plus reserves ($${worstCase.toFixed(2)}); declined before any spend`);
      }

      let provider: SynthesisProvider;
      try {
        provider = deps.provider();
      } catch (err) {
        throw new Stop("MODEL_UNAVAILABLE", err instanceof Error ? err.message : String(err));
      }
      const pricing = provider.pricing;
      governor = new BudgetGovernor(deps.budget, pricing.worstCaseRates);
      const gov = governor;

      const session = provider.start({ system: SYSTEM_PROMPT, task: taskPrompt(signal, deps.budget), tools: TOOL_SPECS, maxOutputTokens: deps.budget.maxOutputTokensPerCall, remainingMs: () => gov.remainingMs() });

      const modelCall = async (label: string, fn: () => Promise<ModelTurn>): Promise<ModelTurn> => {
        const denied = gov.beforeModelCall();
        if (denied) throw new Stop(denied, `model call "${label}" denied by the budget governor (spent $${gov.totals().spentUsd}, next call projected at up to $${gov.projectedNextCallUsd()})`);
        const startedAt = new Date();
        try {
          const turn = await fn();
          const rec = modelUsage(label, startedAt, turn.usage, pricing, true, null);
          recordUsage(rec);
          if (rec.model) routed.add(rec.model);
          timeline("MODEL_CALL", label, true, `${rec.model ? `${rec.model} · ` : ""}${describeTokens(turn.usage)} · $${rec.costUsd.toFixed(4)} ${rec.costBasis}`);
          return turn;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // a call that may have been processed is costed even though it failed; one that never ran costs nothing
          const spent = err instanceof ModelCallError ? err.usage : null;
          const rec = spent ? modelUsage(label, startedAt, spent, pricing, false, message) : { ...modelUsage(label, startedAt, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, pricing, false, message), costBasis: "NO_MARGINAL_PRICE" as const };
          recordUsage(rec);
          timeline("MODEL_CALL", label, false, spent ? `${message} · carried at $${rec.costUsd.toFixed(4)} ${rec.costBasis}` : message);
          if (err instanceof ModelUnavailableError) throw new Stop("MODEL_UNAVAILABLE", message);
          throw err;
        }
      };

      // phase A: evidence collection, every step gated by the governor
      let results: ToolResult[] | null = null;
      for (;;) {
        const turn = await modelCall("plan evidence collection", () => session.collect(results));
        if (turn.kind === "refusal") throw new Stop("MODEL_REFUSED", "the model declined the request");
        if (turn.kind === "truncated") throw new Stop("MODEL_OUTPUT_INVALID", "model output hit the token ceiling during collection");
        if (turn.kind === "done") break;
        results = [];
        for (const call of turn.calls) {
          const denied = gov.beforeToolCall();
          if (denied) throw new Stop(denied, `tool call ${call.name} denied by the budget governor after ${gov.totals().toolCalls} tool calls`);
          const startedAt = new Date();
          try {
            const item = await toolbox.call(call.name, call.input);
            db.prepare("INSERT INTO evidence (investigation_id, id, json) VALUES (?, ?, ?) ON CONFLICT(investigation_id, id) DO UPDATE SET json = excluded.json").run(id, item.id, JSON.stringify(item));
            recordUsage(toolUsage(call.name, startedAt, true, null));
            timeline("TOOL_CALL", call.name, true, JSON.stringify(call.input ?? {}));
            timeline("EVIDENCE", `${item.id} · ${item.provenance.mode}`, true, item.summary, item.id);
            results.push({ id: call.id, content: JSON.stringify(item), isError: false });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            recordUsage(toolUsage(call.name, startedAt, false, message));
            timeline("TOOL_CALL", call.name, false, message);
            results.push({ id: call.id, content: `tool failed: ${message}`, isError: true });
          }
        }
      }

      // phase B: code computes the checks, the model writes, the gate decides
      checks = runConsistencyChecks(signal, toolbox.all());
      timeline("CHECKS", `${checks.filter((c) => c.status === "PASS").length} passed, ${checks.filter((c) => c.status === "FAIL").length} failed, ${checks.filter((c) => c.status === "UNKNOWN").length} unknown`, true, checks.map((c) => `${c.id}: ${c.status}`).join("; "));

      const maxRevisions = deps.maxRevisions ?? 1;
      // the writer is handed the evidence exactly as the gate holds it: latest item per id, nothing else
      let instruction = synthesisPrompt(toolbox.all(), checks);
      for (let attempt = 0; ; attempt++) {
        const turn = await modelCall(attempt === 0 ? "write brief" : "revise brief after gate rejection", () => session.synthesise(instruction, BRIEF_DRAFT_JSON_SCHEMA));
        if (turn.kind === "refusal") throw new Stop("MODEL_REFUSED", "the model declined to write the brief");
        if (turn.kind !== "done") throw new Stop("MODEL_OUTPUT_INVALID", "model did not return a complete brief");
        try {
          draft = JSON.parse(turn.text);
        } catch {
          throw new Stop("MODEL_OUTPUT_INVALID", "model output was not valid JSON");
        }
        gate = evaluatePublication({ draft, evidence: toolbox.all(), checks, stopReason: "COMPLETED", synthesis: provider.info, asOf: deps.transport.now(), allowFixture: deps.allowFixturePublication });
        // kept as each draft is judged, so a rejected first draft is on record even when its revision publishes
        gateAttempts.push(gate);
        db.prepare("UPDATE investigations SET gate_attempts_json = ? WHERE id = ?").run(JSON.stringify(gateAttempts), id);
        const failures = gate.findings.filter((f) => !f.passed);
        timeline("GATE", gate.decision === "PUBLISH" ? "Publication gate: PUBLISH" : `Publication gate: REJECT (${failures.map((f) => f.rule).join(", ")})`, gate.decision === "PUBLISH", failures.map((f) => `${f.rule}: ${f.detail}`).join(" | ") || null);
        // only drafting faults are worth a second attempt; missing or stale evidence cannot be fixed by rewriting
        const fixable = failures.every((f) => ["NUMBERS_IN_TEXT_ARE_EVIDENCED", "QUANTITIES_RESOLVE_TO_EVIDENCE", "NO_INVESTMENT_ADVICE", "FAILED_CHECKS_DISCLOSED", "CONFIDENCE_WITHIN_CAP", "CLAIMS_CITE_KNOWN_EVIDENCE", "SCHEMA"].includes(f.rule));
        if (gate.decision === "PUBLISH" || attempt >= maxRevisions || !fixable) break;
        instruction = revisionPrompt(gate);
      }
    } catch (err) {
      if (err instanceof Stop) {
        stopReason = err.reason;
        stopDetail = err.message;
      } else {
        stopReason = "ERROR";
        stopDetail = err instanceof Error ? err.message : String(err);
      }
      timeline("STOPPED", `Stopped: ${stopReason}`, false, stopDetail);
    }

    const finishedAt = new Date().toISOString();
    if (stopReason !== "COMPLETED" || !gate) {
      db.prepare("UPDATE investigations SET status = 'STOPPED', stop_reason = ?, finished_at = ?, checks_json = ? WHERE id = ?").run(stopReason, finishedAt, JSON.stringify(checks), id);
      return;
    }

    if (gate.decision === "REJECT") {
      timeline("REJECTED", "Not published. No Brief was created and nothing can be charged for.", false);
      db.prepare("UPDATE investigations SET status = 'REJECTED', stop_reason = ?, finished_at = ?, draft_json = ?, checks_json = ?, gate_json = ? WHERE id = ?").run(
        stopReason,
        finishedAt,
        JSON.stringify(draft),
        JSON.stringify(checks),
        JSON.stringify(gate),
        id,
      );
      return;
    }

    const provider = deps.provider();
    const evidence = toolbox.all();
    const body = {
      schema: BRIEF_SCHEMA_ID,
      id: `brf_${sha256(id).slice(0, 16)}`,
      investigationId: id,
      publishedAt: finishedAt,
      dataMode: provider.info.mode === "FIXTURE" ? ("FIXTURE" as const) : weakestMode([signal.provenance.mode, ...evidence.map((e) => e.provenance.mode)]),
      synthesis: routed.size > 0 && !routed.has(provider.info.model) ? { ...provider.info, routedModels: [...routed].sort() } : provider.info,
      signal,
      draft: BriefDraft.parse(draft),
      evidence,
      checks,
      gate,
      disclaimer: DISCLAIMER,
    };
    // Hash exactly what a reader will re-hash: the value after a JSON round trip and after
    // schema parsing (which strips unknown keys), so write and read canonicalise identically.
    const { contentHash: _placeholder, ...normalised } = Brief.parse({ ...(JSON.parse(JSON.stringify(body)) as typeof body), contentHash: "0".repeat(64) });
    const brief: Brief = { ...normalised, contentHash: sha256(canonicalJson(normalised)) };
    transaction(db, () => {
      db.prepare("INSERT INTO briefs (id, investigation_id, signal_id, json, content_hash, published_at) VALUES (?, ?, ?, ?, ?, ?)").run(brief.id, id, signal.id, JSON.stringify(brief), brief.contentHash, brief.publishedAt);
      db.prepare("UPDATE investigations SET status = 'PUBLISHED', stop_reason = 'COMPLETED', finished_at = ?, draft_json = ?, checks_json = ?, gate_json = ?, brief_id = ? WHERE id = ?").run(
        finishedAt,
        JSON.stringify(draft),
        JSON.stringify(checks),
        JSON.stringify(gate),
        brief.id,
        id,
      );
    });
    timeline("PUBLISHED", `Published ${brief.id}`, true, `content hash ${brief.contentHash.slice(0, 16)}…`);
  }
}

/** the whole prompt, with the part that was served from or written to a cache named rather than hidden */
function describeTokens(u: TokenUsage): string {
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const cache = [u.cacheReadTokens > 0 ? `${u.cacheReadTokens} cached` : "", u.cacheWriteTokens > 0 ? `${u.cacheWriteTokens} cache-written` : ""].filter(Boolean).join(", ");
  return `${prompt} in${cache ? ` (${cache})` : ""} / ${u.outputTokens} out tokens`;
}

function modelUsage(name: string, startedAt: Date, u: TokenUsage, pricing: ProviderPricing, ok: boolean, error: string | null): Omit<UsageRecord, "investigationId" | "seq"> {
  const billed = typeof u.billedCostUsd === "number";
  return {
    kind: "MODEL_CALL",
    name,
    model: u.model ?? null,
    startedAt: startedAt.toISOString(),
    latencyMs: Date.now() - startedAt.getTime(),
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    // what the provider charged beats anything computed from tokens
    costUsd: billed ? Math.round(u.billedCostUsd! * 1e6) / 1e6 : priceUsage(pricing.worstCaseRates, u),
    costBasis: billed ? "MEASURED_PROVIDER_BILLED" : pricing.basisWhenNotBilled,
    ok,
    error,
  };
}

function toolUsage(name: string, startedAt: Date, ok: boolean, error: string | null): Omit<UsageRecord, "investigationId" | "seq"> {
  return {
    kind: "TOOL_CALL",
    name,
    model: null,
    startedAt: startedAt.toISOString(),
    latencyMs: Date.now() - startedAt.getTime(),
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costUsd: 0,
    costBasis: "NO_MARGINAL_PRICE",
    ok,
    error,
  };
}
