import Anthropic from "@anthropic-ai/sdk";
import type { Synthesis } from "@bullseye/domain";
import type { ToolSpec } from "../evidence/toolbox.js";
import type { CostBasis } from "@bullseye/domain";
import { RATE_CARD, type ModelRates, type TokenUsage } from "./governor.js";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

export type ModelTurn =
  | { kind: "tool_calls"; calls: ToolCall[]; usage: TokenUsage }
  | { kind: "done"; text: string; usage: TokenUsage }
  | { kind: "refusal"; usage: TokenUsage }
  | { kind: "truncated"; usage: TokenUsage };

export interface SessionInit {
  system: string;
  task: string;
  tools: ToolSpec[];
  maxOutputTokens: number;
  /** milliseconds left in the investigation's latency budget; a provider must not wait longer than this */
  remainingMs?: () => number;
}

/** A single investigation's conversation with a model. The investigator decides whether each step may run. */
export interface ModelSession {
  /** evidence-collection step; pass the results of the previous turn's tool calls */
  collect(results: ToolResult[] | null): Promise<ModelTurn>;
  /** final step: the model must answer with JSON matching schema and may not call tools */
  synthesise(instruction: string, schema: Record<string, unknown>): Promise<ModelTurn>;
}

export interface ProviderPricing {
  /** rates the governor uses to bound the NEXT call before it is made */
  worstCaseRates: ModelRates;
  /** how a call is priced when the provider does not report what it charged */
  basisWhenNotBilled: CostBasis;
}

export interface SynthesisProvider {
  readonly info: Synthesis;
  readonly pricing: ProviderPricing;
  /** throws ModelUnavailableError when the provider cannot be used */
  start(init: SessionInit): ModelSession;
}

export class ModelUnavailableError extends Error {}

/** A model call that failed after it may have been processed. `usage` is what it cost, or a ceiling when that is unknown. */
export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage,
  ) {
    super(message);
  }
}

export class AnthropicProvider implements SynthesisProvider {
  readonly info: Synthesis;
  readonly pricing: ProviderPricing;
  private readonly client: Anthropic;

  constructor(model: string, apiKey: string | undefined) {
    if (!apiKey) throw new ModelUnavailableError("ANTHROPIC_API_KEY is not set");
    const rates = RATE_CARD[model];
    if (!rates) throw new ModelUnavailableError(`no list price on the rate card for model ${model}; refusing to run an unpriced investigation`);
    this.pricing = { worstCaseRates: rates, basisWhenNotBilled: "MEASURED_USAGE_AT_LIST_PRICE" };
    this.info = { provider: "anthropic", model, mode: "LIVE" };
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  start(init: SessionInit): ModelSession {
    const client = this.client;
    const model = this.info.model;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: init.task }];
    const tools: Anthropic.Tool[] = init.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true }));

    const run = async (format?: Record<string, unknown>): Promise<ModelTurn> => {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: init.maxOutputTokens,
          system: init.system,
          thinking: { type: "adaptive" },
          output_config: format ? { effort: "medium", format: { type: "json_schema", schema: format } } : { effort: "medium" },
          tools,
          ...(format ? { tool_choice: { type: "none" as const } } : {}),
          messages,
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ModelUnavailableError(`Anthropic rejected the credentials (${err.status})`);
        }
        if (err instanceof Anthropic.APIConnectionError) throw new ModelUnavailableError(`could not reach Anthropic: ${err.message}`);
        throw err;
      }
      messages.push({ role: "assistant", content: response.content });
      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      if (response.stop_reason === "refusal") return { kind: "refusal", usage };
      if (response.stop_reason === "max_tokens") return { kind: "truncated", usage };
      const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "tool_use" && calls.length > 0) {
        return { kind: "tool_calls", calls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input })), usage };
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { kind: "done", text, usage };
    };

    return {
      async collect(results) {
        if (results) {
          messages.push({
            role: "user",
            content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
          });
        }
        return run();
      },
      async synthesise(instruction, schema) {
        messages.push({ role: "user", content: instruction });
        return run(schema);
      },
    };
  }
}
