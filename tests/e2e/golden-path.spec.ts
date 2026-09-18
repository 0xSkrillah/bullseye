import { expect, test, type Page } from "@playwright/test";
import { installTestWallet } from "./wallet.js";

/**
 * Offline configuration (see playwright.config.ts): recorded real source data
 * (HISTORICAL), fixture synthesiser, fixture payment rail. The three tests share
 * one server and run in order.
 */
const API = "http://localhost:4402";
const SECTIONS = ["What happened", "Why it may matter", "On-chain observations", "Evidence", "Confidence", "Unknowns", "Conflicts", "Limitations"];

async function control(page: Page, body: Record<string, string>) {
  const res = await page.request.post(`${API}/api/_fixture/control`, { data: body });
  expect(res.ok()).toBe(true);
}

const card = (page: Page, symbol: string) => page.getByTestId("signal-card").filter({ hasText: symbol }).first();
const orderEvents = (o: { order: { events: { to: string }[] } }) => o.order.events.map((e) => e.to);

test.describe.configure({ mode: "serial" });

test("a draft with an unevidenced number is held: not published, not for sale", async ({ page }) => {
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "unevidenced_number" });
  await page.goto("/");

  // the radar locks the newest recorded event (QSRx) and the desk investigates it
  const investigation = page.getByTestId("investigation");
  await expect(investigation).toHaveAttribute("data-status", "REJECTED", { timeout: 45_000 });
  await expect(card(page, "QSRx")).toContainText("LOCKED");

  const gate = page.getByTestId("gate-result").first();
  await expect(gate).toHaveAttribute("data-decision", "REJECT");
  await expect(gate).toContainText("NUMBERS_IN_TEXT_ARE_EVIDENCED");
  await expect(gate).toContainText("41250");
  await expect(gate).toContainText("Nothing charged");

  await expect(page.getByRole("button", { name: "Request quote" })).toHaveCount(0);
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
  expect((await (await page.request.get(`${API}/api/briefs`)).json()).briefs).toEqual([]);
});

test("golden path: recorded event → investigation → gate → Brief → x402 purchase → delivery → economics", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good", reconcileOutcome: "unreadable" });
  await page.goto("/");

  await card(page, "IFFx").click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 45_000 });

  // the desk says what it is running on and never calls recorded data live
  await expect(page.locator('[data-kind="HISTORICAL"]:visible').first()).toBeVisible();
  await expect(page.locator('[data-kind="LIVE"]')).toHaveCount(0);
  await expect(page.locator('[data-kind="FIXTURE"]:visible').first()).toBeVisible();
  await expect(page.locator('[data-kind="TESTNET"]:visible').first()).toBeVisible();
  await expect(page.getByTestId("gate-result").first()).toHaveAttribute("data-decision", "PUBLISH");

  // the quote is fixed and hashed before the buyer approves it
  await page.getByRole("button", { name: "Request quote" }).click();
  await expect(page.getByTestId("paywall")).toBeVisible();
  await expect(page.getByTestId("quote-price")).toContainText("3.00");
  const termsHash = await page.getByTestId("quote-terms-hash").getAttribute("title");
  expect(termsHash).toMatch(/^[0-9a-f]{64}$/);

  const delivery = page.waitForResponse((r) => r.url().includes("/api/v1/briefs/") && r.status() === 200, { timeout: 45_000 });
  await page.getByTestId("pay-button").click();
  const envelope = await (await delivery).json();
  await expect(page.getByTestId("payment-state")).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  expect(wallet.signatures()).toBe(1);

  // the order is bound to exactly the terms the buyer saw
  expect(envelope.quote.termsHash).toBe(termsHash);
  expect(envelope.state).toBe("DELIVERED");
  const orders = await (await page.request.get(`${API}/api/orders`)).json();
  const mine = orders.orders.find((o: { order: { id: string } }) => o.order.id === envelope.orderId);
  expect(orderEvents(mine)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAID", "DELIVERING", "DELIVERED"]);

  // the human Brief is a rendering of the machine JSON that was delivered
  expect(envelope.brief.schema).toBe("bullseye.brief/v1");
  for (const name of SECTIONS) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(envelope.brief.draft.headline);
  for (const claim of [...envelope.brief.draft.whatHappened, ...envelope.brief.draft.onchainObservations]) {
    await expect(page.getByText(claim.text.slice(0, 70), { exact: false }).first()).toBeVisible();
  }
  for (const unknown of envelope.brief.draft.unknowns) await expect(page.getByText(unknown).first()).toBeVisible();
  await expect(page.getByText(envelope.brief.disclaimer)).toBeVisible();
  await expect(page.locator(`[title="${envelope.brief.contentHash}"]`).first()).toBeVisible();
  expect(envelope.brief.evidence.every((e: { provenance: { mode: string } }) => e.provenance.mode === "HISTORICAL")).toBe(true);
  expect(envelope.brief.dataMode).toBe("FIXTURE"); // written by the test double, and labelled so

  // economics: not revenue, estimates labelled as estimates, nothing measured claimed for a test double
  await expect(page.getByTestId("receipt-revenue-note")).toContainText(/not revenue/i);
  await expect(page.getByTestId("receipt-contribution")).toContainText(/estimated/i);
  await expect(page.getByTestId("receipt-estimated")).toBeVisible();
  expect(mine.receipt.countsAsRevenue).toBe(false);
  expect(mine.receipt.measuredCosts).toEqual([]);
});

test("an unknown payment delivers nothing, cannot be charged twice, and reconciles", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "settle_timeout", synthesisBehaviour: "good", reconcileOutcome: "unreadable" });
  await page.goto("/");

  await card(page, "IFFx").click();
  await page.getByRole("button", { name: "Request quote" }).click({ timeout: 45_000 });
  await page.getByTestId("pay-button").click();

  const state = page.getByTestId("payment-state");
  await expect(state).toHaveAttribute("data-state", "PAYMENT_UNKNOWN", { timeout: 30_000 });
  await expect(state).toContainText("A retry cannot charge you twice.");
  const pending = (await (await page.request.get(`${API}/api/orders`)).json()).orders.find((o: { order: { state: string } }) => o.order.state === "PAYMENT_UNKNOWN");
  expect(pending.order.deliveryCount).toBe(0);
  await expect(page.getByText(pending.order.terms.briefContentHash)).toHaveCount(0);

  // reconciliation evidence arrives from the chain; the facilitator is healthy again
  await control(page, { facilitatorMode: "ok", reconcileOutcome: "used" });
  await page.getByTestId("reconcile-button").click();
  await expect(state).toHaveAttribute("data-state", "PAID", { timeout: 30_000 });

  // paying again re-sends the same authorization: no second signature, no second settle
  await page.getByTestId("pay-button").click();
  await expect(state).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  expect(wallet.signatures()).toBe(1);

  const orders = await (await page.request.get(`${API}/api/orders`)).json();
  const mine = orders.orders.find((o: { order: { events: { to: string }[] } }) => o.order.events.some((e) => e.to === "PAYMENT_UNKNOWN"));
  expect(orderEvents(mine)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED"]);
});
