import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Synthesis } from "@bullseye/domain";
import { createApp } from "../src/http/app.js";
import { InvestigationService } from "../src/research/investigator.js";
import { ModelCallError, type ModelSession, type ModelTurn, type ProviderPricing, type SynthesisProvider } from "../src/research/model.js";
import { XStocksAdapter } from "../src/adapters/xstocks.js";
import { XLayerAdapter } from "../src/adapters/xlayer.js";
import { investigateFirstSignal, testBuyer, testContainer } from "./helpers.js";

const usage = (over: Partial<ModelTurn["usage"]> = {}) => ({ inputTokens: 1500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, billedCostUsd: 0.004 as number | null, model: "vendor/routed-model", ...over });

/** a routed, billing provider whose second call fails after the provider has charged for it */
class BilledThenFailing implements SynthesisProvider {
  readonly info: Synthesis = { provider: "openrouter", model: "openrouter/auto", mode: "LIVE" };
  readonly pricing: ProviderPricing = { worstCaseRates: { input: 3, output: 15, cacheRead: 3, cacheWrite: 3 }, basisWhenNotBilled: "UPPER_BOUND_AT_PRICE_CAP" };
  constructor(private readonly second: () => Promise<ModelTurn>) {}
  start(): ModelSession {
    let turn = 0;
    const second = this.second;
    return {
      async collect() {
        turn++;
        if (turn === 1) return { kind: "tool_calls", calls: [{ id: "c1", name: "get_corporate_action", input: {} }], usage: usage() };
        return second();
      },
      async synthesise() {
        throw new Error("not reached");
      },
    };
  }
}

async function investigateWith(provider: SynthesisProvider) {
  const c = await testContainer();
  const service = new InvestigationService({
    db: c.db,
    transport: c.transport,
    xstocks: new XStocksAdapter(c.transport, "https://example.test"),
    xlayer: new XLayerAdapter(c.transport, "https://rpc.example.test"),
    provider: () => provider,
    budget: c.config.budget,
    priceUsd: 3,
    estimatedReservesUsd: 0.45,
    allowFixturePublication: true,
  });
  const signal = (await c.signals.scan()).signals[0]!;
  const { investigationId } = service.start(signal);
  await service.wait(investigationId);
  return { view: service.view(investigationId)!, rows: service.usage(investigationId).filter((u) => u.kind === "MODEL_CALL") };
}

describe("what a failed model call costs", () => {
  it("a call that was billed and then failed is counted at what the provider charged", async () => {
    const { view, rows } = await investigateWith(new BilledThenFailing(async () => {
      throw new ModelCallError('OpenRouter reported finish_reason "error"', usage({ billedCostUsd: 0.049, inputTokens: 12000, outputTokens: 900 }));
    }));
    expect(view).toMatchObject({ status: "STOPPED", stopReason: "ERROR" });
    expect(rows.map((r) => [r.ok, r.costUsd, r.costBasis, r.model])).toEqual([
      [true, 0.004, "MEASURED_PROVIDER_BILLED", "vendor/routed-model"],
      [false, 0.049, "MEASURED_PROVIDER_BILLED", "vendor/routed-model"],
    ]);
  });

  it("a call whose outcome is unknown is carried at the price cap as an upper bound, never as measured and never as zero", async () => {
    const { rows } = await investigateWith(new BilledThenFailing(async () => {
      throw new ModelCallError("no response within 120s; the request may have been billed", usage({ billedCostUsd: null, inputTokens: 20000, outputTokens: 8000, model: null }));
    }));
    expect(rows[1]).toMatchObject({ ok: false, costBasis: "UPPER_BOUND_AT_PRICE_CAP", model: null });
    expect(rows[1]!.costUsd).toBeCloseTo((20000 * 3 + 8000 * 15) / 1e6, 6);
  });

  it("a call that never reached a model costs nothing and says so", async () => {
    const { rows } = await investigateWith(new BilledThenFailing(async () => {
      throw new Error("could not reach the provider");
    }));
    expect(rows[1]).toMatchObject({ ok: false, costUsd: 0, costBasis: "NO_MARGINAL_PRICE" });
  });
});

describe("the usage summary says what the governor counted", () => {
  it("keeps measured, upper-bound and total budget spend apart", async () => {
    const c = await testContainer();
    const { view } = await investigateFirstSignal(c);
    const insert = c.db.prepare("INSERT INTO usage (investigation_id, seq, json) VALUES (?, ?, ?)");
    const row = (seq: number, costUsd: number, costBasis: string) =>
      JSON.stringify({ investigationId: view.id, seq, kind: "MODEL_CALL", name: "x", model: "vendor/m", startedAt: "2026-01-15T09:00:00.000Z", latencyMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd, costBasis, ok: true, error: null });
    insert.run(view.id, 900, row(900, 0.01, "MEASURED_PROVIDER_BILLED"));
    insert.run(view.id, 901, row(901, 0.15, "UPPER_BOUND_AT_PRICE_CAP"));

    const { usage: u } = (await request(createApp(c)).get(`/api/investigations/${view.id}`)).body;
    expect(u.measuredModelCostUsd).toBe(0.01);
    expect(u.upperBoundModelCostUsd).toBe(0.15);
    expect(u.budgetSpentUsd).toBeGreaterThanOrEqual(0.16);
    expect(u.costBases).toEqual(expect.arrayContaining(["MEASURED_PROVIDER_BILLED", "UPPER_BOUND_AT_PRICE_CAP", "FIXTURE"]));
    expect(u.routedModels).toEqual(["vendor/m"]);
  });

  it("still reads usage rows written before the routed-model field existed", async () => {
    const c = await testContainer();
    const { view } = await investigateFirstSignal(c);
    c.db.prepare("INSERT INTO usage (investigation_id, seq, json) VALUES (?, ?, ?)").run(
      view.id,
      950,
      JSON.stringify({ investigationId: view.id, seq: 950, kind: "TOOL_CALL", name: "old", startedAt: "2026-01-15T09:00:00.000Z", latencyMs: 1, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: 0, costBasis: "NO_MARGINAL_PRICE", ok: true, error: null }),
    );
    expect(c.investigations.usage(view.id).find((r) => r.seq === 950)!.model).toBeNull();
  });
});

describe("a Brief about an action the issuer has voided", () => {
  it("is withdrawn from sale: no quote, no challenge, nothing signed is settled; an earlier buyer still gets delivery", async () => {
    const c = await testContainer();
    const { view } = await investigateFirstSignal(c);
    const app = createApp(c);
    const path = `/api/v1/briefs/${view.briefId}`;
    const buyer = testBuyer();
    const sign = async () => {
      const challenge = await request(app).get(path);
      const required = buyer.http.getPaymentRequiredResponse((name) => challenge.headers[name.toLowerCase()]);
      return buyer.http.encodePaymentSignatureHeader(await buyer.http.createPaymentPayload(required));
    };
    const paidBefore = await sign();
    expect((await request(app).get(path).set(paidBefore)).status).toBe(200);
    const signedButUnsent = await sign();

    // the issuer cancels the action; the next scan notices
    const hist = (c.fixtureTransport as unknown as { responses: Record<string, { nodes: Record<string, unknown>[] }> }).responses["xstocks.ca-history.all"]!;
    const v1 = hist.nodes[0]!;
    hist.nodes.unshift({ ...v1, version: 2, status: "Cancelled", effectiveTimeUtc: null, multiplierNew: v1.multiplierOld, notes: "[CANCELLED v1] Incorrect cash flow", createdTimeUtc: "2026-01-15T08:30:00.000Z" });
    await c.signals.scan();

    const unpaid = await request(app).get(path);
    expect(unpaid.status).toBe(410);
    expect(unpaid.body).toMatchObject({ error: "brief_withdrawn" });
    expect(unpaid.body.detail).toContain("cancelled");
    expect(unpaid.headers["payment-required"]).toBeUndefined();

    const settlesBefore = c.fixtureFacilitator!.settleCalls.length;
    expect((await request(app).get(path).set(signedButUnsent)).status).toBe(410);
    expect(c.fixtureFacilitator!.settleCalls).toHaveLength(settlesBefore);

    expect((await request(app).get(path).set(paidBefore)).status).toBe(200);
    expect((await request(app).get("/api/v1/catalog")).body.items).toEqual([]);
    expect((await request(app).get("/api/signals")).body.signals[0].superseded).toMatchObject({ reason: "CANCELLED", byVersion: 2 });
  });
});
