import { createHash, timingSafeEqual } from "node:crypto";
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

const X402_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-Bullseye-Order", "X-Bullseye-Claim", "Retry-After"];

export function createApp(c: Container) {
  const app = express();
  app.disable("x-powered-by");

  // agents and wallets call the paid endpoint from other origins; nothing here relies on cookies
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // x402 clients add headers of their own to the paying request, so a preflight is granted what it asks for; nothing here uses cookies
    res.setHeader("Access-Control-Allow-Headers", req.header("access-control-request-headers") ?? "content-type, payment-signature, x-payment, x-bullseye-claim, authorization, idempotency-key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", X402_HEADERS.join(", "));
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  /**
   * Operator routes start work that costs money or calls third parties. On localhost they are open.
   * Anywhere else they need OPERATOR_TOKEN, and without one configured they are refused outright.
   */
  // a production build is never treated as local, whatever PUBLIC_BASE_URL was left at
  const isLocal = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.config.PUBLIC_BASE_URL).hostname);
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const operator = (req: Request, res: Response, next: NextFunction) => {
    const token = c.config.OPERATOR_TOKEN;
    if (!token) {
      if (isLocal) return next();
      return res.status(403).json({ error: "operator_routes_disabled", detail: "operator actions are not available on this deployment" });
    }
    const given = /^Bearer (.+)$/i.exec(req.header("authorization") ?? "")?.[1] ?? "";
    if (!timingSafeEqual(digest(given), digest(token))) return res.status(401).json({ error: "operator_token_required" });
    next();
  };

  /** fixed one-minute windows per client address; enough to stop one caller flooding the facilitator, the quote table or the read routes */
  app.set("trust proxy", 1);
  const limiter = (name: string, max: number, applies: (req: Request) => boolean = () => true) => {
    const windows = new Map<string, { count: number; resetAt: number }>();
    return (req: Request, res: Response, next: NextFunction) => {
      if (!applies(req)) return next();
      const now = Date.now();
      if (windows.size > 5_000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      const key = req.ip ?? "unknown";
      const w = windows.get(key);
      if (!w || w.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + 60_000 });
        return next();
      }
      if (++w.count > max) {
        res.setHeader("Retry-After", String(Math.ceil((w.resetAt - now) / 1000)));
        return res.status(429).json({ error: "rate_limited", limit: name, detail: `more than ${max} requests in a minute` });
      }
      next();
    };
  };
  const carriesPayment = (req: Request) => req.header("payment-signature") !== undefined || req.header("x-payment") !== undefined;
  const paidRoutes = limiter("paid_routes", c.config.PAID_ROUTE_RATE_LIMIT_PER_MINUTE);
  const paymentAttempts = limiter("payment_attempts", c.config.PAYMENT_ATTEMPT_RATE_LIMIT_PER_MINUTE, carriesPayment);
  const limited = [paidRoutes, paymentAttempts];
  app.use("/api", limiter("api", c.config.API_RATE_LIMIT_PER_MINUTE, (req) => req.path !== "/health"));
  // bodies are parsed after the limiter, so a flood of malformed JSON is counted like anything else
  app.use(express.json({ limit: "100kb" }));

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
      operatorRoutes: c.config.OPERATOR_TOKEN ? "TOKEN_REQUIRED" : isLocal ? "OPEN_ON_LOCALHOST" : "DISABLED",
      autoDesk: c.config.AUTO_DESK ? { enabled: true, intervalMinutes: c.config.AUTO_DESK_INTERVAL_MINUTES, maxInvestigationsPerDay: c.config.AUTO_DESK_MAX_INVESTIGATIONS_PER_DAY } : { enabled: false },
      sdk: SDK_VERSIONS,
    });
  });

  app.post("/api/signals/scan", operator, async (_req, res) => {
    const result = await c.signals.scan();
    res.json(result);
  });

  app.get("/api/signals", (_req, res) => {
    const signals = c.signals.list().map((signal) => {
      const inv = c.investigations.latestForSignal(signal.id);
      return { signal, superseded: c.signals.supersession(signal.id), investigation: inv ? { id: inv.id, status: inv.status, stopReason: inv.stopReason, briefId: inv.briefId } : null };
    });
    res.json({ dataMode: c.transport.primaryMode, signals });
  });

  app.get("/api/signals/:id", (req, res) => {
    const signal = c.signals.get(req.params.id);
    if (!signal) return res.status(404).json({ error: "signal_not_found" });
    res.json({ signal, investigation: c.investigations.latestForSignal(signal.id) });
  });

  app.post("/api/signals/:id/investigate", operator, (req, res) => {
    const signal = c.signals.get(String(req.params.id));
    if (!signal) return res.status(404).json({ error: "signal_not_found" });
    const started = c.investigations.start(signal);
    res.status(started.created ? 202 : 200).json({ ...started, id: started.investigationId });
  });

  app.get("/api/investigations/:id", (req, res) => {
    const view = c.investigations.view(req.params.id);
    if (!view) return res.status(404).json({ error: "investigation_not_found" });
    const usage = c.investigations.usage(view.id);
    const models = usage.filter((u) => u.kind === "MODEL_CALL");
    const sum = (rows: typeof usage) => Math.round(rows.reduce((t, u) => t + u.costUsd, 0) * 1e6) / 1e6;
    res.json({
      investigation: view,
      budget: c.config.budget,
      usage: {
        modelCalls: models.length,
        toolCalls: usage.filter((u) => u.kind === "TOOL_CALL").length,
        /** only what a provider reported: billed amounts, or reported tokens at list price */
        measuredModelCostUsd: sum(models.filter((u) => u.costBasis.startsWith("MEASURED"))),
        /** calls whose charge is unknown, carried at the price cap */
        upperBoundModelCostUsd: sum(models.filter((u) => u.costBasis === "UPPER_BOUND_AT_PRICE_CAP")),
        /** what the budget governor has counted against the ceiling: every basis */
        budgetSpentUsd: sum(models),
        costBases: [...new Set(models.map((u) => u.costBasis))],
        costBasis: models[0]?.costBasis ?? null,
        routedModels: [...new Set(models.map((u) => u.model).filter((m): m is string => m !== null))].sort(),
      },
    });
  });

  app.get("/api/briefs", (_req, res) => {
    res.json({ priceUsd: c.config.BRIEF_PRICE_USD, rail: c.rail.status(), briefs: c.briefs.list().map(toPreview) });
  });

  app.get("/api/briefs/:id/preview", (req, res) => {
    const brief = c.briefs.get(req.params.id);
    if (!brief) return res.status(404).json({ error: "brief_not_found" });
    res.json({ preview: toPreview(brief), signal: brief.signal, withdrawn: c.signals.supersession(brief.signal.id), priceUsd: c.config.BRIEF_PRICE_USD, rail: c.rail.status(), resource: `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/${brief.id}` });
  });

  app.post("/api/briefs/:id/quotes", limited, async (req: Request, res: Response) => {
    const brief = c.briefs.get(String(req.params.id));
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
      latest: { resource: `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/latest`, methods: ["GET", "POST"], filter: "symbol" },
      items: c.briefs
        .list()
        .filter((b) => c.signals.supersession(b.signal.id) === null)
        .map((b) => ({ ...toPreview(b), resource: `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/${b.id}`, method: "GET" })),
    });
  });

  const paid = async (req: Request, res: Response, briefId: string, resource?: string) => {
    const header = req.header("payment-signature") ?? req.header("x-payment") ?? undefined;
    const quoteId = typeof req.query.quote === "string" ? req.query.quote : undefined;
    const reply = await c.checkout.handle(briefId, header, quoteId, resource, req.header("x-bullseye-claim") ?? undefined);
    for (const [k, v] of Object.entries(reply.headers)) res.setHeader(k, v);
    // "finish" does not fire for a connection that went away first, so a delivery nobody received is not counted
    if (reply.onSent) res.once("finish", reply.onSent);
    res.status(reply.status).json(reply.body);
  };

  /**
   * One stable paid address, for listings that take a single endpoint: the newest Brief on sale,
   * optionally for one asset (?symbol=QSRx, or {"symbol":"QSRx"} in a POST body). Which Brief that
   * is gets decided when the request arrives; the quote then freezes it by content hash.
   */
  app.all("/api/v1/briefs/latest", limited, async (req: Request, res: Response) => {
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    const asked = typeof req.query.symbol === "string" ? req.query.symbol : typeof req.body?.symbol === "string" ? (req.body.symbol as string) : undefined;
    const wanted = asked?.trim() ? asked.trim() : undefined;
    const newest = c.briefs
      .list()
      .filter((b) => c.signals.supersession(b.signal.id) === null)
      .find((b) => wanted === undefined || b.signal.asset.symbol.toLowerCase() === wanted.toLowerCase());
    // the address is spelled with the asset's own symbol, so "qsrx" and "QSRX" share one quote instead of minting one each
    const known = wanted === undefined ? undefined : (newest?.signal.asset.symbol ?? c.briefs.list().find((b) => b.signal.asset.symbol.toLowerCase() === wanted.toLowerCase())?.signal.asset.symbol);
    const resource = `${c.config.PUBLIC_BASE_URL}/api/v1/briefs/latest${known ? `?symbol=${encodeURIComponent(known)}` : ""}`;
    // a buyer who is paying gets the Brief they were quoted, even if a newer one has been published since
    const header = req.header("payment-signature") ?? req.header("x-payment");
    const quoted = header && (wanted === undefined || known !== undefined) ? c.checkout.briefForPayment(header, resource) : null;
    const briefId = quoted ?? newest?.id;
    if (!briefId) return res.status(404).json({ error: "nothing_for_sale", detail: wanted ? `no Brief on sale for ${wanted}` : "no Brief on sale yet", catalog: `${c.config.PUBLIC_BASE_URL}/api/v1/catalog` });
    await paid(req, res, briefId, resource);
  });

  // the paid resource for one Brief; agents and marketplaces call it with GET or POST
  app.all("/api/v1/briefs/:id", limited, async (req: Request, res: Response) => {
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    await paid(req, res, String(req.params.id));
  });

  const receiptFor = (orderId: string) => {
    const order = c.ledger.get(orderId);
    if (!order) return null;
    const brief = c.briefs.get(order.terms.briefId);
    const usage = brief ? c.investigations.usage(brief.investigationId) : [];
    return { order: { ...order, paymentKey: null }, receipt: buildReceipt(order, usage, brief?.synthesis.model ?? "unknown", allowances), briefHeadline: brief?.draft.headline ?? null };
  };

  app.get("/api/orders", (_req, res) => {
    res.json({ orders: c.ledger.list().map((o) => receiptFor(o.id)) });
  });

  app.get("/api/orders/:id", (req, res) => {
    const found = receiptFor(req.params.id);
    if (!found) return res.status(404).json({ error: "order_not_found" });
    res.json(found);
  });

  app.post("/api/orders/:id/reconcile", operator, async (req, res) => {
    const order = await c.checkout.reconcile(String(req.params.id));
    if (!order) return res.status(404).json({ error: "order_not_found" });
    res.json(receiptFor(order.id));
  });

  if (c.fixtureFacilitator) {
    const Control = z.object({
      facilitatorMode: z.enum(["ok", "verify_invalid", "settle_failed", "settle_timeout", "settle_throws"]).optional(),
      reconcileOutcome: z.enum(["used", "unused", "unreadable", "cancelled"]).optional(),
      synthesisBehaviour: z.enum(["good", "gives_advice", "unevidenced_number", "skips_mandatory_evidence", "never_stops", "hides_conflict", "invalid_json"]).optional(),
    });
    // exists only on the fixture rail, which can never move funds
    app.post("/api/_fixture/control", operator, (req, res) => {
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
    // a body that is not JSON, or is too large, is the caller's mistake: no stack trace, no 500
    const status = (err as { status?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) return res.status(status).json({ error: "invalid_request" });
    if (err instanceof SourceUnavailableError) return res.status(502).json({ error: "source_unavailable", detail: err.message });
    if (err instanceof SchemaMismatchError) return res.status(502).json({ error: "source_schema_mismatch", detail: err.message });
    if (err instanceof RailNotReadyError) return res.status(503).json({ error: "payment_rail_unavailable", detail: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid_request", detail: err.issues });
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
