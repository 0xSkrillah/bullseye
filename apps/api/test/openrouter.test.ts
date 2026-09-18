import { describe, expect, it } from "vitest";
import { OpenRouterProvider, type OpenRouterOptions } from "../src/research/openrouter.js";
import { ModelCallError, ModelUnavailableError } from "../src/research/model.js";
import { buildReceipt } from "../src/economics/receipt.js";
import { loadConfig } from "../src/config.js";
import { TOOL_SPECS } from "../src/evidence/toolbox.js";
import type { Order, UsageRecord } from "@bullseye/domain";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function stub(replies: (Response | (() => Response))[]) {
  const seen: Captured[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (!next) throw new Error("no stubbed reply left");
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fail = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message } }), { status });

const toolTurn = {
  model: "vendor/routed-model",
  choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_corporate_action", arguments: "{}" } }] } }],
  usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, cost: 0.00421, prompt_tokens_details: { cached_tokens: 100 } },
};
const textTurn = (content: string, over: Record<string, unknown> = {}) => ({
  model: "vendor/routed-model",
  choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, cost: 0.0062 },
  ...over,
});

const options = (fetchImpl: typeof fetch, over: Partial<OpenRouterOptions> = {}): OpenRouterOptions => ({
  apiKey: "sk-or-test",
  model: "openrouter/auto",
  costTier: "medium",
  maxPrice: { prompt: 3, completion: 15 },
  fetchImpl,
  retryDelaysMs: [],
  ...over,
});
const init = { system: "sys", task: "task", tools: TOOL_SPECS, maxOutputTokens: 8000 };

describe("OpenRouter provider: request shape", () => {
  it("selects the medium tier under the plugin id that belongs to the slug, and caps the price", async () => {
    const auto = stub([ok(textTurn("READY"))]);
    await new OpenRouterProvider(options(auto.fetchImpl)).start(init).collect(null);
    expect(auto.seen[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(auto.seen[0]!.headers.Authorization).toBe("Bearer sk-or-test");
    expect(auto.seen[0]!.body).toMatchObject({
      model: "openrouter/auto",
      plugins: [{ id: "auto-router", cost_tier: "medium" }],
      provider: { require_parameters: true, max_price: { prompt: 3, completion: 15 } },
      max_tokens: 8000,
    });

    // the beta slug silently ignores settings sent under the stable plugin id
    const beta = stub([ok(textTurn("READY"))]);
    await new OpenRouterProvider(options(beta.fetchImpl, { model: "openrouter/auto-beta", costTier: "low" })).start(init).collect(null);
    expect(beta.seen[0]!.body.plugins).toEqual([{ id: "auto-beta-router", cost_tier: "low" }]);

    // a concrete model needs no router plugin, but keeps the price cap
    const direct = stub([ok(textTurn("READY"))]);
    await new OpenRouterProvider(options(direct.fetchImpl, { model: "vendor/some-model" })).start(init).collect(null);
    expect(direct.seen[0]!.body.plugins).toBeUndefined();
    expect(direct.seen[0]!.body.provider.max_price).toEqual({ prompt: 3, completion: 15 });
  });

  it("sends tools on every collection request and never together with a response schema", async () => {
    const s = stub([ok(toolTurn), ok(textTurn("READY")), ok(textTurn('{"headline":"x"}'))]);
    const session = new OpenRouterProvider(options(s.fetchImpl)).start(init);
    const first = await session.collect(null);
    expect(first).toMatchObject({ kind: "tool_calls", calls: [{ id: "call_1", name: "get_corporate_action", input: {} }] });
    await session.collect([{ id: "call_1", content: '{"id":"EV-CA"}', isError: false }]);
    await session.synthesise("write it", { type: "object" });

    const [c1, c2, w] = s.seen.map((r) => r.body);
    expect(c1!.tools).toHaveLength(TOOL_SPECS.length);
    expect(c2!.tools).toHaveLength(TOOL_SPECS.length);
    expect(c1!.response_format).toBeUndefined();
    expect(c2!.messages.slice(-2)).toEqual([expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }), { role: "tool", tool_call_id: "call_1", content: '{"id":"EV-CA"}' }]);

    expect(w!.tools).toBeUndefined();
    expect(w!.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "bullseye_brief_draft", strict: true, schema: { type: "object" } } });
    expect(w!.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    // the writer gets the task and the investigator's instruction (which carries the gate's evidence); the provider adds nothing of its own
    expect(w!.messages[1].content).toBe("task\n\nwrite it");
    expect(w!.provider.require_parameters).toBe(true);
  });

  it("a revision continues the writing conversation with alternating roles", async () => {
    const s = stub([ok(textTurn("READY")), ok(textTurn("{}")), ok(textTurn("{}"))]);
    const session = new OpenRouterProvider(options(s.fetchImpl)).start(init);
    await session.collect(null);
    await session.synthesise("write", {});
    await session.synthesise("revise", {});
    expect(s.seen[2]!.body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("OpenRouter provider: what comes back", () => {
  it("reports the routed model and the amount the provider charged", async () => {
    const s = stub([ok(toolTurn)]);
    const turn = await new OpenRouterProvider(options(s.fetchImpl)).start(init).collect(null);
    // prompt_tokens includes cached tokens; the classes handed on are disjoint so nothing is counted twice
    expect(turn.usage).toEqual({ inputTokens: 1100, outputTokens: 80, cacheReadTokens: 100, cacheWriteTokens: 0, billedCostUsd: 0.00421, model: "vendor/routed-model" });
  });

  it("with a bring-your-own-key account, the fee alone is not reported as the charge", async () => {
    const byok = (cost_details: unknown) => ({ ...toolTurn, usage: { ...toolTurn.usage, cost: 0.0003, is_byok: true, cost_details } });
    const known = await new OpenRouterProvider(options(stub([ok(byok({ upstream_inference_cost: 0.004 }))]).fetchImpl)).start(init).collect(null);
    expect(known.usage.billedCostUsd).toBeCloseTo(0.0043, 6);
    const unknown = await new OpenRouterProvider(options(stub([ok(byok(null))]).fetchImpl)).start(init).collect(null);
    expect(unknown.usage.billedCostUsd).toBeNull();
  });

  it("a response without usage is carried at a ceiling, never at zero", async () => {
    const { usage: _dropped, ...noUsage } = textTurn("READY");
    const turn = await new OpenRouterProvider(options(stub([ok(noUsage)]).fetchImpl)).start(init).collect(null);
    expect(turn.usage.billedCostUsd).toBeNull();
    expect(turn.usage.outputTokens).toBe(8000);
    expect(turn.usage.inputTokens).toBeGreaterThan(1000);
  });

  it("a call that was billed and then failed still reports what it cost", async () => {
    const billedError = { model: "vendor/routed-model", choices: [{ finish_reason: "error", message: { role: "assistant", content: null } }], usage: { prompt_tokens: 12000, completion_tokens: 900, cost: 0.049 } };
    const err = await new OpenRouterProvider(options(stub([ok(billedError)]).fetchImpl)).start(init).collect(null).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ModelCallError);
    expect((err as ModelCallError).usage).toMatchObject({ billedCostUsd: 0.049, inputTokens: 12000, outputTokens: 900, model: "vendor/routed-model" });

    const malformed = { model: "m", choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c", function: { name: "x", arguments: 7 } }] } }], usage: { prompt_tokens: 50, completion_tokens: 5, cost: 0.002 } };
    const err2 = await new OpenRouterProvider(options(stub([ok(malformed)]).fetchImpl)).start(init).collect(null).then(() => null, (e: unknown) => e);
    expect((err2 as ModelCallError).usage.billedCostUsd).toBe(0.002);
  });

  it("maps finish reasons: length is truncated, content_filter is a refusal, error throws", async () => {
    const provider = (body: unknown) => new OpenRouterProvider(options(stub([ok(body)]).fetchImpl)).start(init).collect(null);
    const withReason = (finish_reason: string) => ({ ...textTurn("partial"), choices: [{ finish_reason, message: { role: "assistant", content: "partial" } }] });
    expect((await provider(withReason("length"))).kind).toBe("truncated");
    expect((await provider(withReason("content_filter"))).kind).toBe("refusal");
    await expect(provider(withReason("error"))).rejects.toThrow(/finish_reason "error"/);
  });

  it("treats an error object inside an HTTP 200 as an error, classified like the same HTTP status", async () => {
    const run = (code: number, message: string) => new OpenRouterProvider(options(stub([ok({ error: { code, message } })]).fetchImpl)).start(init).collect(null);
    await expect(run(502, "upstream exploded")).rejects.toThrow(/upstream exploded/);
    await expect(run(502, "upstream exploded")).rejects.toBeInstanceOf(ModelCallError);
    await expect(run(402, "Insufficient credits")).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("survives malformed tool arguments by handing the toolbox something it will reject", async () => {
    const bad = { ...toolTurn, choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "read_onchain_multiplier", arguments: "{when:" } }] } }] };
    const turn = await new OpenRouterProvider(options(stub([ok(bad)]).fetchImpl)).start(init).collect(null);
    expect(turn).toMatchObject({ kind: "tool_calls", calls: [{ input: { unparseableArguments: "{when:" } }] });
  });
});

describe("OpenRouter provider: failures", () => {
  it.each([
    [401, "invalid key"],
    [402, "insufficient credits"],
    [503, "no available model provider that meets your routing requirements"],
  ])("HTTP %i means the model is unavailable, and is not retried", async (status, message) => {
    const s = stub([fail(status, message), ok(textTurn("never"))]);
    const call = new OpenRouterProvider(options(s.fetchImpl, { retryDelaysMs: [0, 0] })).start(init).collect(null);
    await expect(call).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(call).rejects.toThrow(message);
    expect(s.seen).toHaveLength(1);
  });

  it("retries a rate limit, then succeeds", async () => {
    const s = stub([fail(429, "slow down"), ok(textTurn("READY"))]);
    const turn = await new OpenRouterProvider(options(s.fetchImpl, { retryDelaysMs: [0] })).start(init).collect(null);
    expect(turn.kind).toBe("done");
    expect(s.seen).toHaveLength(2);
  });

  it("one approval is one billable request: a timeout, a dropped connection or a 5xx is never re-sent, and is carried at a ceiling", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    let sent = 0;
    const timingOut = (async () => {
      sent++;
      throw timeout;
    }) as unknown as typeof fetch;
    const err = await new OpenRouterProvider(options(timingOut, { retryDelaysMs: [0, 0] })).start(init).collect(null).then(() => null, (e: unknown) => e);
    expect(sent).toBe(1);
    expect(err).toBeInstanceOf(ModelCallError);
    expect((err as ModelCallError).message).toContain("may have been billed");
    expect((err as ModelCallError).usage).toMatchObject({ outputTokens: 8000, billedCostUsd: null });
    expect((err as ModelCallError).usage.inputTokens).toBeGreaterThan(0);

    const s = stub([fail(502, "bad gateway"), ok(textTurn("never"))]);
    await expect(new OpenRouterProvider(options(s.fetchImpl, { retryDelaysMs: [0, 0] })).start(init).collect(null)).rejects.toBeInstanceOf(ModelCallError);
    expect(s.seen).toHaveLength(1);
  });

  it("a connection that never opened is retried, because nothing was sent", async () => {
    let sent = 0;
    const refusing = (async () => {
      sent++;
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    await expect(new OpenRouterProvider(options(refusing, { retryDelaysMs: [0, 0] })).start(init).collect(null)).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(sent).toBe(3);
  });

  it("does not wait longer than the investigation has left", async () => {
    let asked = 0;
    const s = stub([ok(textTurn("READY"))]);
    await new OpenRouterProvider(options(s.fetchImpl)).start({ ...init, remainingMs: () => (asked++, 30_000) }).collect(null);
    expect(asked).toBe(1);
  });

  it("never puts the API key in an error message, whatever the transport throws", async () => {
    const key = "sk-or-SECRET-VALUE";
    // a transport error that quotes the request, the worst case for a leak
    const leaky = (async (_url: string, req: RequestInit) => {
      throw new Error(`request failed: ${JSON.stringify(req.headers)}`);
    }) as unknown as typeof fetch;
    const viaTransport = new OpenRouterProvider(options(leaky, { apiKey: key })).start(init).collect(null);
    await expect(viaTransport).rejects.toBeInstanceOf(ModelCallError);
    await expect(viaTransport).rejects.not.toThrow(/SECRET-VALUE/);

    const viaStatus = new OpenRouterProvider(options(stub([fail(401, "No auth credentials found")]).fetchImpl, { apiKey: key })).start(init).collect(null);
    await expect(viaStatus).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(viaStatus).rejects.not.toThrow(/SECRET-VALUE/);
  });

  it("refuses to exist without a key, a routable model id or positive price caps", () => {
    const f = stub([]).fetchImpl;
    expect(() => new OpenRouterProvider(options(f, { apiKey: undefined }))).toThrow(/OPENROUTER_API_KEY is not set/);
    expect(() => new OpenRouterProvider(options(f, { model: "claude-opus-5" }))).toThrow(/not an OpenRouter model id/);
    expect(() => new OpenRouterProvider(options(f, { maxPrice: { prompt: 0, completion: 15 } }))).toThrow(/price caps/);
  });

  it("uses the price caps as the governor's worst case", () => {
    const p = new OpenRouterProvider(options(stub([]).fetchImpl, { maxPrice: { prompt: 2, completion: 10 } }));
    expect(p.pricing).toEqual({ worstCaseRates: { input: 2, output: 10, cacheRead: 2, cacheWrite: 2 }, basisWhenNotBilled: "UPPER_BOUND_AT_PRICE_CAP" });
  });
});

describe("configuration and economics", () => {
  it("defaults to OpenRouter's auto router at the medium tier", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ SYNTHESIS_PROVIDER: "openrouter", BULLSEYE_MODEL: "openrouter/auto", OPENROUTER_COST_TIER: "medium", OPENROUTER_MAX_PRICE_PROMPT: 3, OPENROUTER_MAX_PRICE_COMPLETION: 15 });
    expect(loadConfig({ SYNTHESIS_PROVIDER: "anthropic" }).BULLSEYE_MODEL).toBe("claude-opus-5");
    expect(() => loadConfig({ OPENROUTER_COST_TIER: "cheap" })).toThrow();
  });

  it("a billed charge is measured; a call the provider did not price is an estimate at the cap, never measured", () => {
    const call = (over: Partial<UsageRecord>): UsageRecord => ({
      investigationId: "inv",
      seq: 0,
      kind: "MODEL_CALL",
      name: "write brief",
      model: "vendor/routed-model",
      startedAt: "2026-09-18T12:00:00.000Z",
      latencyMs: 1000,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.004,
      costBasis: "MEASURED_PROVIDER_BILLED",
      ok: true,
      error: null,
      ...over,
    });
    const order = { id: "ord_0000000000000001", state: "DELIVERED", payment: null, terms: { briefId: "brf_0000000000000001", priceUsd: "3.00", rail: "OKX_X402_TESTNET" } } as unknown as Order;
    const receipt = buildReceipt(order, [call({}), call({ seq: 1, costUsd: 0.0045, costBasis: "UPPER_BOUND_AT_PRICE_CAP" })], "openrouter/auto", { paymentFeeReserveUsd: 0.15, reworkReserveUsd: 0.2, dataToolAllowanceUsd: 0.1 });

    const billed = receipt.measuredCosts.find((l) => l.label === "Model usage, as billed")!;
    expect(billed).toMatchObject({ amountUsd: 0.004, basis: "MEASURED" });
    expect(billed.detail).toContain("vendor/routed-model");
    expect(receipt.measuredCosts.every((l) => l.basis === "MEASURED")).toBe(true);
    expect(receipt.measuredTotalUsd).toBe(0.004);
    expect(receipt.estimatedCosts.find((l) => l.label === "Model usage, upper bound")).toMatchObject({ amountUsd: 0.0045, basis: "ESTIMATED" });
    expect(receipt.countsAsRevenue).toBe(false);
  });
});
