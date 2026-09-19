import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { REPO_ROOT } from "../src/config.js";
import { investigateFirstSignal, testContainer } from "./helpers.js";

const PUBLIC = { PUBLIC_BASE_URL: "https://bullseye.example.com" };
const TOKEN = "an-operator-token-of-sufficient-length";
const investigations = (c: Awaited<ReturnType<typeof testContainer>>) => (c.db.prepare("SELECT COUNT(*) AS n FROM investigations").get() as { n: number }).n;

describe("operator routes on a public deployment", () => {
  it("refuses every operator action when no token is configured, and starts nothing", async () => {
    const c = await testContainer(PUBLIC);
    const scan = await c.signals.scan();
    const app = createApp(c);
    for (const path of ["/api/signals/scan", `/api/signals/${scan.signals[0]!.id}/investigate`, "/api/_fixture/control"]) {
      const res = await request(app).post(path).set("authorization", "Bearer anything");
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe("operator_routes_disabled");
    }
    // reconcile belongs to the order's buyer as well as the operator; a bearer token that is not the operator's opens neither door
    const reconcile = await request(app).post("/api/orders/ord_0000000000000000/reconcile").set("authorization", "Bearer anything");
    expect(reconcile.status).toBe(403);
    expect(reconcile.body.error).toBe("claim_token_required");
    expect((await request(app).get("/api/orders").set("authorization", "Bearer anything")).body.error).toBe("operator_routes_disabled");
    expect(investigations(c)).toBe(0);
    expect((await request(app).get("/api/health")).body.operatorRoutes).toBe("DISABLED");
  });

  it("with a token configured, accepts only that token", async () => {
    const c = await testContainer({ ...PUBLIC, OPERATOR_TOKEN: TOKEN });
    const scan = await c.signals.scan();
    const app = createApp(c);
    const path = `/api/signals/${scan.signals[0]!.id}/investigate`;
    expect((await request(app).post(path)).status).toBe(401);
    expect((await request(app).post(path).set("authorization", `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await request(app).post(path).set("authorization", TOKEN)).status).toBe(401);
    expect(investigations(c)).toBe(0);
    const ok = await request(app).post(path).set("authorization", `Bearer ${TOKEN}`);
    expect(ok.status).toBe(202);
    await c.investigations.wait(ok.body.investigationId);
    expect(investigations(c)).toBe(1);
    expect((await request(app).get("/api/health")).body.operatorRoutes).toBe("TOKEN_REQUIRED");
  });

  it("a configured token is required on localhost too", async () => {
    const c = await testContainer({ OPERATOR_TOKEN: TOKEN });
    expect((await request(createApp(c)).post("/api/signals/scan")).status).toBe(401);
  });

  it("leaves localhost open when no token is configured, so the desk works in development", async () => {
    const c = await testContainer();
    const app = createApp(c);
    expect((await request(app).post("/api/signals/scan")).status).toBe(200);
    expect((await request(app).get("/api/health")).body.operatorRoutes).toBe("OPEN_ON_LOCALHOST");
  });

  it("keeps the buying path and the read-only desk open to everyone", async () => {
    const c = await testContainer(PUBLIC);
    const { view } = await investigateFirstSignal(c);
    const app = createApp(c);
    expect((await request(app).get("/api/signals")).status).toBe(200);
    expect((await request(app).get("/api/v1/catalog")).status).toBe(200);
    const challenge = await request(app).post("/api/v1/briefs/latest");
    expect(challenge.status).toBe(402);
    expect(challenge.body.resource.url).toBe("https://bullseye.example.com/api/v1/briefs/latest");
    expect((await request(app).get(`/api/v1/briefs/${view.briefId}`)).status).toBe(402);
  });

  it("rejects an operator token that is too short to be a secret", async () => {
    await expect(testContainer({ OPERATOR_TOKEN: "short" })).rejects.toThrow();
  });
});

describe("rate limit on the paid routes", () => {
  it("keys on the edge's client-address header when one is configured, and ignores X-Forwarded-For", async () => {
    const c = await testContainer({ PAID_ROUTE_RATE_LIMIT_PER_MINUTE: "2", CLIENT_IP_HEADER: "x-real-ip" });
    const app = createApp(c);
    const from = (ip: string, xff: string) => request(app).get("/api/v1/briefs/latest").set("x-real-ip", ip).set("x-forwarded-for", xff);
    expect((await from("203.0.113.7", "10.0.0.1")).status).toBe(404);
    expect((await from("203.0.113.7", "10.0.0.2")).status).toBe(404);
    expect((await from("203.0.113.7", "10.0.0.3")).status).toBe(429);
    expect((await from("203.0.113.8", "10.0.0.3")).status).toBe(404);
  });

  it("answers 429 with Retry-After once one client passes the limit, and leaves the desk's read routes alone", async () => {
    const c = await testContainer({ PAID_ROUTE_RATE_LIMIT_PER_MINUTE: "3" });
    const { view } = await investigateFirstSignal(c);
    const app = createApp(c);
    const path = `/api/v1/briefs/${view.briefId}`;
    for (let i = 0; i < 3; i++) expect((await request(app).get(path)).status).toBe(402);
    const blocked = await request(app).post("/api/v1/briefs/latest");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.headers["payment-required"]).toBeUndefined();
    expect((await request(app).get("/api/signals")).status).toBe(200);
    expect((await request(app).get("/api/health")).status).toBe(200);
  });
});

describe("the built web desk", () => {
  const dist = resolve(REPO_ROOT, "apps/web/dist/index.html");

  // needs `npm run build`; skipped on a checkout that has never built the desk
  it.skipIf(!existsSync(dist))("serves index.html for a deep link, even when the checkout sits below a dot-directory", async () => {
    const c = await testContainer();
    const app = createApp(c);
    for (const path of ["/room", "/room/anything", "/favicon.ico"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('<div id="root">');
    }
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });
});
