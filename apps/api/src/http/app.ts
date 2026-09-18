import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Container } from "../container.js";
import { REPO_ROOT } from "../config.js";
import { toPreview } from "../briefs.js";
import { buildReceipt } from "../economics/receipt.js";
import { RailNotReadyError } from "../commerce/checkout.js";
import { SDK_VERSIONS } from "../commerce/rail.js";
import { SourceUnavailableError } from "../adapters/transport.js";
import { SchemaMismatchError } from "../adapters/xstocks.js";

const X402_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-Bullseye-Order", "Retry-After"];

export function createApp(c: Container) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  // agents and wallets call the paid endpoint from other origins; nothing here relies on cookies
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, payment-signature, x-payment, idempotency-key");
    res.setHeader("Access-Control-Expose-Headers", X402_HEADERS.join(", "));
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const allowances = {
    paymentFeeReserveUsd: c.config.EST_PAYMENT_FEE_RESERVE_USD,
    reworkReserveUsd: c.config.EST_REWORK_RESERVE_USD,
    dataToolAllowanceUsd: c.config.EST_DATA_TOOL_ALLOWANCE_USD,
  };

  app.get("/api/health", (_req, res) => {
    res.json({
      service: "bullseye",
      dataSource: { mode: c.transport.primaryMode, asOf: c.transport.now().toISOString() },
      synthesis: c.synthesisStatus(),
      paymentRail: c.rail.status(),
      priceUsd: c.config.BRIEF_PRICE_USD,
      budget: c.config.budget,
      sdk: SDK_VERSIONS,
    });
  });

  app.post("/api/signals/scan", async (_req, res) => {
    const result = await c.signals.scan();
    res.json(result);
  });

  app.get("/api/signals", (_req, res) => {
    const signals = c.signals.list().map((signal) => {
      const inv = c.investigations.latestForSignal(signal.id);
      return { signal, investigation: inv ? { id: inv.id, status: inv.status, stopReason: inv.stopReason, briefId: inv.briefId } : null };
    });
    res.json({ dataMode: c.transport.primaryMode, signals });
  });

  app.get("/api/signals/:id", (req, res) => {
    const signal = c.signals.get(req.params.id);
    if (!signal) return res.status(404).json({ error: "signal_not_found" });
    res.json({ signal, investigation: c.investigations.latestForSignal(signal.id) });
  });

  app.post("/api/signals/:id/investigate", (req, res) => {
    const signal = c.signals.get(req.params.id);
    if (!signal) return res.status(404).json({ error: "signal_not_found" });
    const started = c.investigations.start(signal);
    res.status(started.created ? 202 : 200).json(started);
  });

  app.get("/api/investigations/:id", (req, res) => {
    const view = c.investigations.view(req.params.id);
    if (!view) return res.status(404).json({ error: "investigation_not_found" });
    const usage = c.investigations.usage(view.id);
    res.json({
      investigation: view,
      budget: c.config.budget,
      usage: {
        modelCalls: usage.filter((u) => u.kind === "MODEL_CALL").length,
        toolCalls: usage.filter((u) => u.kind === "TOOL_CALL").length,
        measuredModelCostUsd: Math.round(usage.reduce((s, u) => s + u.costUsd, 0) * 1e6) / 1e6,
        costBasis: usage.find((u) => u.kind === "MODEL_CALL")?.costBasis ?? null,
      },
    });
  });

  app.get("/api/briefs", (_req, res) => {
    res.json({ priceUsd: c.config.BRIEF_PRICE_USD, rail: c.rail.status(), briefs: c.briefs.list().map(toPreview) });
  });

  app.get("/api/briefs/:id/preview", (req, res) => {
    const brief = c.briefs.get(req.params.id);
    if (!brief) return res.status(404).json({ error: "brief_not_found" });
    res.json({ preview: toPreview(brief), signal: brief.signal, priceUsd: c.config.BRIEF_PRICE_USD, rail: c.rail.status(), resource: `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/${brief.id}` });
  });

  app.post("/api/briefs/:id/quotes", async (req, res) => {
    const brief = c.briefs.get(req.params.id);
    if (!brief) return res.status(404).json({ error: "brief_not_found" });
    if (!c.rail.status().ready) return res.status(503).json({ error: "payment_rail_unavailable", detail: c.rail.status().detail });
    res.status(201).json(await c.checkout.quote(brief));
  });

  // machine-readable catalogue so an agent can discover what is for sale and where
  app.get("/api/v1/catalog", (_req, res) => {
    res.json({
      schema: "bullseye.catalog/v1",
      seller: "Bullseye",
      payment: { protocol: "x402", version: 2, rail: c.rail.status() },
      priceUsd: c.config.BRIEF_PRICE_USD,
      items: c.briefs.list().map((b) => ({ ...toPreview(b), resource: `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/${b.id}`, method: "GET" })),
    });
  });

  // the paid resource
  app.get("/api/v1/briefs/:id", async (req, res) => {
    const header = req.header("payment-signature") ?? req.header("x-payment") ?? undefined;
    const quoteId = typeof req.query.quote === "string" ? req.query.quote : undefined;
    const reply = await c.checkout.handle(req.params.id, header, quoteId);
    for (const [k, v] of Object.entries(reply.headers)) res.setHeader(k, v);
    res.status(reply.status).json(reply.body);
  });

  const receiptFor = (orderId: string) => {
    const order = c.ledger.get(orderId);
    if (!order) return null;
    const brief = c.briefs.get(order.terms.briefId);
    const usage = brief ? c.investigations.usage(brief.investigationId) : [];
    return { order, receipt: buildReceipt(order, usage, brief?.synthesis.model ?? "unknown", allowances), briefHeadline: brief?.draft.headline ?? null };
  };

  app.get("/api/orders", (_req, res) => {
    res.json({ orders: c.ledger.list().map((o) => receiptFor(o.id)) });
  });

  app.get("/api/orders/:id", (req, res) => {
    const found = receiptFor(req.params.id);
    if (!found) return res.status(404).json({ error: "order_not_found" });
    res.json(found);
  });

  app.post("/api/orders/:id/reconcile", async (req, res) => {
    const order = await c.checkout.reconcile(req.params.id);
    if (!order) return res.status(404).json({ error: "order_not_found" });
    res.json(receiptFor(order.id));
  });

  if (c.fixtureFacilitator) {
    const Control = z.object({
      facilitatorMode: z.enum(["ok", "verify_invalid", "settle_failed", "settle_timeout", "settle_throws"]).optional(),
      reconcileOutcome: z.enum(["used", "unused", "unreadable"]).optional(),
      synthesisBehaviour: z.enum(["good", "gives_advice", "unevidenced_number", "skips_mandatory_evidence", "never_stops", "hides_conflict", "invalid_json"]).optional(),
    });
    // exists only on the fixture rail, which can never move funds
    app.post("/api/_fixture/control", (req, res) => {
      const body = Control.parse(req.body ?? {});
      if (body.facilitatorMode) c.fixtureFacilitator!.mode = body.facilitatorMode;
      if (body.reconcileOutcome) c.fixtureFacilitator!.reconcileOutcome = body.reconcileOutcome;
      if (body.synthesisBehaviour) c.setFixtureBehaviour(body.synthesisBehaviour);
      res.json({ facilitatorMode: c.fixtureFacilitator!.mode, reconcileOutcome: c.fixtureFacilitator!.reconcileOutcome });
    });
  }

  const webDist = resolve(REPO_ROOT, "apps/web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(webDist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SourceUnavailableError) return res.status(502).json({ error: "source_unavailable", detail: err.message });
    if (err instanceof SchemaMismatchError) return res.status(502).json({ error: "source_schema_mismatch", detail: err.message });
    if (err instanceof RailNotReadyError) return res.status(503).json({ error: "payment_rail_unavailable", detail: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid_request", detail: err.issues });
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
