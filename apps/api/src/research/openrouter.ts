import { z } from "zod";
import type { Synthesis } from "@bullseye/domain";
import type { ModelRates, TokenUsage } from "./governor.js";
import { ModelCallError, ModelUnavailableError, type ModelSession, type ModelTurn, type ProviderPricing, type SessionInit, type SynthesisProvider, type ToolResult } from "./model.js";

/**
 * OpenRouter chat completions (https://openrouter.ai/docs), used through its Auto Router.
 *
 * - The router's cost tier is a per-request plugin setting. Each router slug only reads
 *   settings sent under its OWN plugin id and silently ignores the other's, so the id is
 *   derived from the slug here and nowhere else.
 * - `provider.max_price` is a hard filter that also applies to routed models. It is what
 *   lets the budget governor bound a call whose model is not known in advance.
 * - Every response reports `usage.cost`, the amount charged, and `model`, the model that
 *   actually answered.
 * - Tool calling and structured output are not documented as combinable in one request, so
 *   collection requests carry tools only and the writing request carries the schema only.
 * - A request that may have reached a model is never sent twice: one governor approval is
 *   one billable request. When the outcome or the charge is unknown, the call is carried at
 *   a ceiling (request size and max_tokens at the price cap), never at zero.
 */

export const COST_TIERS = ["low", "medium", "high", "xhigh", "max"] as const;
export type CostTier = (typeof COST_TIERS)[number];

const ROUTER_PLUGIN_ID: Record<string, string> = {
  "openrouter/auto": "auto-router",
  "openrouter/auto-beta": "auto-beta-router",
};

export interface OpenRouterOptions {
  apiKey: string | undefined;
  model: string;
  costTier: CostTier;
  /** USD per million tokens; requests are only routed to endpoints at or below these prices */
  maxPrice: { prompt: number; completion: number };
  baseUrl?: string;
  appUrl?: string;
  appTitle?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** delays before re-sending a request that was certainly not processed (rate limited, or never connected); tests pass [] */
  retryDelaysMs?: number[];
}

const ToolCallSchema = z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }).passthrough();

const UsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative().nullable().optional(),
    is_byok: z.boolean().nullable().optional(),
    cost_details: z.object({ upstream_inference_cost: z.number().nonnegative().nullable().optional() }).passthrough().nullable().optional(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nullable().optional(), cache_write_tokens: z.number().nullable().optional() }).passthrough().nullable().optional(),
  })
  .passthrough();

const ChatResponse = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.union([z.string(), z.array(z.unknown())]).nullable().optional(),
                tool_calls: z.array(ToolCallSchema).nullable().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const ErrorBody = z.object({ error: z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).passthrough() }).passthrough();

type ChatMessage = Record<string, unknown>;

/** statuses that mean the request was not processed, so sending it again cannot bill twice */
const NOT_PROCESSED = new Set([429]);
/** credentials, credits, moderation and "no endpoint fits the routing rules": retrying changes nothing */
const UNAVAILABLE = new Set([401, 402, 403, 404, 503]);
/** the socket never opened, so nothing was sent */
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

export class OpenRouterProvider implements SynthesisProvider {
  readonly info: Synthesis;
  readonly pricing: ProviderPricing;
  private readonly opts: OpenRouterOptions & { apiKey: string };

  constructor(opts: OpenRouterOptions) {
    if (!opts.apiKey) throw new ModelUnavailableError("OPENROUTER_API_KEY is not set");
    if (!opts.model.includes("/")) {
      throw new ModelUnavailableError(`BULLSEYE_MODEL=${opts.model} is not an OpenRouter model id; use openrouter/auto, openrouter/auto-beta or a vendor/model id`);
    }
    if (!(opts.maxPrice.prompt > 0) || !(opts.maxPrice.completion > 0)) throw new ModelUnavailableError("OpenRouter price caps must be positive: an investigation cannot be budgeted without them");
    this.opts = { ...opts, apiKey: opts.apiKey };
    this.info = { provider: "openrouter", model: opts.model, mode: "LIVE" };
    const cap: ModelRates = { input: opts.maxPrice.prompt, output: opts.maxPrice.completion, cacheRead: opts.maxPrice.prompt, cacheWrite: opts.maxPrice.prompt };
    this.pricing = { worstCaseRates: cap, basisWhenNotBilled: "UPPER_BOUND_AT_PRICE_CAP" };
  }

  /** the body fields that select the router tier and cap what any routed model may cost */
  routingFields(): Record<string, unknown> {
    const pluginId = ROUTER_PLUGIN_ID[this.opts.model];
    return {
      model: this.opts.model,
      ...(pluginId ? { plugins: [{ id: pluginId, cost_tier: this.opts.costTier }] } : {}),
      provider: { require_parameters: true, max_price: { prompt: this.opts.maxPrice.prompt, completion: this.opts.maxPrice.completion } },
    };
  }

  start(init: SessionInit): ModelSession {
    const collection: ChatMessage[] = [
      { role: "system", content: init.system },
      { role: "user", content: init.task },
    ];
    const tools = init.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    let writing: ChatMessage[] | null = null;

    return {
      collect: async (results: ToolResult[] | null): Promise<ModelTurn> => {
        for (const r of results ?? []) collection.push({ role: "tool", tool_call_id: r.id, content: r.content });
        // the tool list is re-sent on every request of the loop, as the API requires
        const { turn, message } = await this.complete({ messages: collection, ...(tools.length > 0 ? { tools } : {}), max_tokens: init.maxOutputTokens }, init.remainingMs);
        collection.push(message);
        return turn;
      },
      synthesise: async (instruction: string, schema: Record<string, unknown>): Promise<ModelTurn> => {
        // a fresh, tool-free conversation; the instruction carries the evidence exactly as the gate holds it
        if (writing === null) {
          writing = [
            { role: "system", content: init.system },
            { role: "user", content: `${init.task}\n\n${instruction}` },
          ];
        } else {
          writing.push({ role: "user", content: instruction });
        }
        const { turn, message } = await this.complete(
          { messages: writing, max_tokens: init.maxOutputTokens, response_format: { type: "json_schema", json_schema: { name: "bullseye_brief_draft", strict: true, schema } } },
          init.remainingMs,
        );
        writing.push(message);
        return turn;
      },
    };
  }

  /** what this request could cost at most: every request byte is at least one token, and the reply cannot exceed max_tokens */
  private ceiling(body: Record<string, unknown>): TokenUsage {
    return { inputTokens: Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools ?? [] })), outputTokens: Number(body.max_tokens ?? 0), cacheReadTokens: 0, cacheWriteTokens: 0, billedCostUsd: null, model: null };
  }

  private async complete(body: Record<string, unknown>, remainingMs?: () => number): Promise<{ turn: ModelTurn; message: ChatMessage }> {
    const full = { ...this.routingFields(), ...body };
    const json = await this.post(full, remainingMs);

    // usage is read before anything that can throw, so a billed call that ends badly is still costed
    const usage = readUsage(json) ?? this.ceiling(full);

    const inBand = ErrorBody.safeParse(json);
    if (inBand.success) {
      const code = Number(inBand.data.error.code);
      const text = `OpenRouter returned an error inside a 200 response: ${inBand.data.error.message ?? "no message"} (${String(inBand.data.error.code ?? "no code")})`;
      if (UNAVAILABLE.has(code)) throw new ModelUnavailableError(text);
      throw new ModelCallError(text, usage);
    }
    const parsed = ChatResponse.safeParse(json);
    if (!parsed.success) {
      throw new ModelCallError(`OpenRouter response did not match the expected shape: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, usage);
    }
    const choice = parsed.data.choices[0]!;
    const message: ChatMessage = { ...choice.message, role: "assistant" };

    switch (choice.finish_reason) {
      case "error":
        throw new ModelCallError('OpenRouter reported finish_reason "error" for this completion', usage);
      case "content_filter":
        return { turn: { kind: "refusal", usage }, message };
      case "length":
        return { turn: { kind: "truncated", usage }, message };
    }
    const calls = choice.message.tool_calls ?? [];
    if (calls.length > 0) {
      return { turn: { kind: "tool_calls", usage, calls: calls.map((c) => ({ id: c.id, name: c.function.name, input: parseArguments(c.function.arguments) })) }, message };
    }
    const content = choice.message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("") : "";
    return { turn: { kind: "done", text, usage }, message };
  }

  private async post(body: Record<string, unknown>, remainingMs?: () => number): Promise<unknown> {
    const delays = this.opts.retryDelaysMs ?? [1_500, 4_000];
    const doFetch = this.opts.fetchImpl ?? fetch;
    for (let attempt = 0; ; attempt++) {
      // never wait longer than the investigation has left; the floor keeps a nearly spent budget from aborting instantly
      const timeoutMs = Math.max(5_000, Math.min(this.opts.timeoutMs ?? 120_000, remainingMs ? remainingMs() : Number.POSITIVE_INFINITY));
      let res: Response;
      try {
        res = await doFetch(`${this.opts.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            "Content-Type": "application/json",
            ...(this.opts.appUrl ? { "HTTP-Referer": this.opts.appUrl } : {}),
            "X-OpenRouter-Title": this.opts.appTitle ?? "Bullseye",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const code = (err as { cause?: { code?: string } }).cause?.code;
        if (code && NEVER_SENT.has(code)) {
          if (attempt < delays.length) {
            await sleep(delays[attempt]!);
            continue;
          }
          throw new ModelUnavailableError(`could not reach OpenRouter (${code})`);
        }
        // a timeout or a dropped connection after sending: the model may have run and been billed, so this is not re-sent
        throw new ModelCallError(`no response from OpenRouter within ${Math.round(timeoutMs / 1000)}s or the connection dropped (${err instanceof Error ? err.name : "error"}); the request may have been billed`, this.ceiling(body));
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new ModelCallError("OpenRouter answered 200 but the body could not be read; the request may have been billed", this.ceiling(body));
        }
      }
      const detail = await describeError(res);
      if (NOT_PROCESSED.has(res.status) && attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }
      if (UNAVAILABLE.has(res.status) || NOT_PROCESSED.has(res.status)) throw new ModelUnavailableError(`OpenRouter ${res.status}: ${detail}`);
      // 408, 5xx: the upstream may have started generating
      throw new ModelCallError(`OpenRouter ${res.status}: ${detail}`, this.ceiling(body));
    }
  }
}

/** Token classes are made disjoint here: OpenRouter's prompt_tokens already includes cached and cache-written tokens. */
function readUsage(json: unknown): TokenUsage | null {
  const raw = (json as { usage?: unknown; model?: unknown } | null) ?? {};
  const parsed = UsageSchema.safeParse(raw.usage);
  if (!parsed.success) return null;
  const u = parsed.data;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const written = u.prompt_tokens_details?.cache_write_tokens ?? 0;

  // with a bring-your-own-key account `cost` is only OpenRouter's fee; the inference itself is billed upstream
  let billed: number | null = typeof u.cost === "number" ? u.cost : null;
  if (u.is_byok === true) {
    const upstream = u.cost_details?.upstream_inference_cost;
    billed = billed !== null && typeof upstream === "number" ? billed + upstream : null;
  }
  return {
    inputTokens: Math.max(0, u.prompt_tokens - cached - written),
    outputTokens: u.completion_tokens,
    cacheReadTokens: cached,
    cacheWriteTokens: written,
    billedCostUsd: billed,
    model: typeof raw.model === "string" ? raw.model : null,
  };
}

function parseArguments(raw: string): unknown {
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    // the toolbox validates inputs and reports a tool error back to the model
    return { unparseableArguments: raw.slice(0, 200) };
  }
}

async function describeError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.error.message ?? text.slice(0, 300);
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || res.statusText;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
