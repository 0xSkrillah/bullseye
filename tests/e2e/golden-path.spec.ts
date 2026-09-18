import { expect, test, type Page } from "@playwright/test";
import { installTestWallet } from "./wallet.js";

const API = "http://localhost:4402";

async function control(page: Page, body: Record<string, string>) {
  const res = await page.request.post(`${API}/api/_fixture/control`, { data: body });
  expect(res.ok()).toBe(true);
}

async function lockAndInvestigate(page: Page, symbol: string) {
  await page.goto("/");
  await page.getByTestId("scan-button").click();
  const card = page.getByTestId("signal-card").filter({ hasText: symbol }).first();
  await expect(card).toBeVisible();
  await card.click();
  await page.getByTestId("investigate-button").click();
  await expect(page.getByTestId("investigation-status")).not.toHaveText("RUNNING", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test("failure path: a draft with an unevidenced number is held, not published and not for sale", async ({ page }) => {
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "unevidenced_number" });
  await lockAndInvestigate(page, "IFFx");
  await expect(page.getByTestId("investigation-status")).toHaveText("REJECTED");
  const gate = page.getByTestId("gate-result");
  await expect(gate).toHaveAttribute("data-decision", "REJECT");
  await expect(gate).toContainText("NUMBERS_IN_TEXT_ARE_EVIDENCED");
  await expect(gate).toContainText("41250");
  await expect(page.getByTestId("paywall")).toHaveCount(0);
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
  const briefs = await (await page.request.get(`${API}/api/briefs`)).json();
  expect(briefs.briefs).toEqual([]);
  await control(page, { synthesisBehaviour: "good" });
});

test("golden path: recorded event → investigation → gate → Brief → x402 purchase → delivery → economics", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good", reconcileOutcome: "unreadable" });

  // the desk says what it is running on, and never calls recorded data live
  await page.goto("/");
  await expect(page.getByTestId("health-datamode")).toContainText("HISTORICAL");
  await expect(page.getByTestId("health-datamode")).not.toContainText("LIVE");
  await expect(page.getByTestId("health-rail")).toContainText("FIXTURE");

  await lockAndInvestigate(page, "IFFx");
  await expect(page.getByTestId("investigation-status")).toHaveText("PUBLISHED");
  await expect(page.getByTestId("timeline-row").filter({ hasText: "EV-CHAIN-AFTER" }).first()).toBeVisible();
  await expect(page.getByTestId("gate-result")).toHaveAttribute("data-decision", "PUBLISH");

  // free preview: a headline and a mode, but no findings
  await expect(page.getByTestId("brief-headline")).toBeVisible();
  await expect(page.getByTestId("brief-datamode")).toContainText("FIXTURE");
  await expect(page.getByTestId("paywall")).toBeVisible();
  await expect(page.getByTestId("brief-json")).toHaveCount(0);

  // the quote is fixed before the buyer approves it
  const termsHash = (await page.getByTestId("quote-terms-hash").getAttribute("title")) ?? (await page.getByTestId("quote-terms-hash").innerText());
  await expect(page.getByTestId("quote-price")).toContainText("3.00");

  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("payment-state")).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  expect(wallet.signatures()).toBe(1);

  // human Brief and machine JSON are the same document
  const sections = page.getByTestId("brief-section");
  await expect(sections).toHaveCount(8);
  const hash = (await page.getByTestId("brief-content-hash").getAttribute("title")) ?? "";
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole("button", { name: /machine-readable json/i }).click();
  const json = JSON.parse(await page.getByTestId("brief-json").innerText());
  expect(json.schema).toBe("bullseye.brief/v1");
  expect(json.contentHash).toBe(hash);
  for (const claim of json.draft.whatHappened) await expect(page.getByTestId("brief-section").filter({ hasText: claim.text.slice(0, 60) }).first()).toBeVisible();
  expect(json.evidence.every((e: { provenance: { mode: string } }) => e.provenance.mode === "HISTORICAL")).toBe(true);

  // the order the server holds is bound to the terms the buyer saw
  const orders = await (await page.request.get(`${API}/api/orders`)).json();
  const order = orders.orders[0].order;
  expect(order.state).toBe("DELIVERED");
  expect(termsHash).toContain(order.termsHash.slice(0, 8));
  expect(order.events.map((e: { to: string }) => e.to)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAID", "DELIVERING", "DELIVERED"]);

  // economics: not revenue, estimates labelled, nothing measured passed off from a test double
  await expect(page.getByTestId("receipt-revenue-note")).toContainText(/not revenue/i);
  await expect(page.getByTestId("receipt-contribution")).toContainText(/estimated/i);
  await expect(page.getByTestId("receipt-estimated")).toBeVisible();
});

test("failure path: an unknown payment delivers nothing, cannot be paid twice, and reconciles", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "settle_timeout", synthesisBehaviour: "good", reconcileOutcome: "unreadable" });

  await lockAndInvestigate(page, "QSRx");
  await expect(page.getByTestId("investigation-status")).toHaveText("PUBLISHED");
  await page.getByTestId("pay-button").click();

  const state = page.getByTestId("payment-state");
  await expect(state).toHaveAttribute("data-state", "PAYMENT_UNKNOWN", { timeout: 30_000 });
  await expect(state).toContainText("A retry cannot charge you twice.");
  await expect(page.getByTestId("brief-json")).toHaveCount(0);
  await expect(page.getByTestId("pay-button")).toHaveCount(0);

  await control(page, { facilitatorMode: "ok", reconcileOutcome: "used" });
  await page.getByTestId("reconcile-button").click();
  await expect(state).toHaveAttribute("data-state", /PAID|DELIVERED/, { timeout: 30_000 });
  await page.getByTestId("retry-same-authorization").click();
  await expect(state).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  expect(wallet.signatures()).toBe(1);

  const orders = await (await page.request.get(`${API}/api/orders`)).json();
  const mine = orders.orders.find((o: { order: { events: { to: string }[] } }) => o.order.events.some((e) => e.to === "PAYMENT_UNKNOWN"));
  expect(mine.order.events.map((e: { to: string }) => e.to)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED"]);
});
