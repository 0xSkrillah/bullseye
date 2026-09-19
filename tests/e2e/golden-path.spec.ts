import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installTestWallet, SECOND_DEV_KEY } from "./wallet.js";

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
/** the operator's list is open on localhost, where these tests run; the desk under test never reads it on a buyer's behalf */
const allOrders = async (page: Page) => (await (await page.request.get(`${API}/api/orders`)).json()).orders;
const orderById = async (page: Page, id: string) => (await allOrders(page)).find((o: { order: { id: string } }) => o.order.id === id);
const openPaywall = async (page: Page) => {
  await page.goto("/");
  await card(page, "IFFx").click();
  await page.getByRole("button", { name: "Request quote" }).click({ timeout: 45_000 });
  await expect(page.getByTestId("paywall")).toBeVisible();
};

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

  // before anyone pays: the gate's decision is already known, the times are kept apart, and the free side says what is being sold
  await expect(page.getByTestId("gate-chip").first()).toHaveAttribute("data-decision", "PUBLISH");
  await expect(page.getByTestId("event-times")).toContainText("Issuer effective time");
  await expect(page.getByTestId("event-times")).toContainText("Sources last fetched");
  await expect(page.getByTestId("paid-value")).toContainText("Did X Layer apply it?");
  await expect(page.getByTestId("balance-illustration")).toContainText("Illustrative");
  await page.getByRole("button", { name: "View evidence first" }).click();
  await expect(page.getByTestId("evidence-index")).toContainText(/reserves/i);

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

  // every evidence id in a claim opens its source: URL, fetch time, hash and the value the claim used
  await page.getByTestId("evidence-link").first().click();
  const drawer = page.getByTestId("evidence-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(/sha256/i);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // the download is the delivery the seller sent, and carries no claim token or signature
  const downloading = page.waitForEvent("download");
  await page.getByTestId("download-json").click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(`bullseye-${envelope.brief.id}-${envelope.orderId}.json`);
  const saved = JSON.parse(readFileSync(await file.path(), "utf8"));
  expect(saved.brief.contentHash).toBe(envelope.brief.contentHash);
  expect(saved.quote.termsHash).toBe(termsHash);
  expect(JSON.stringify(saved)).not.toMatch(/bullseye-claim|payment-signature|paymentSignature/i);

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
  const orderId = (await state.getAttribute("data-order-id"))!;
  const pending = await orderById(page, orderId);
  expect(pending.order.deliveryCount).toBe(0);
  await expect(page.getByText(pending.order.terms.briefContentHash)).toHaveCount(0);

  // while the outcome is unknown the screen offers no quote and no Pay button: there is nothing to sign a second time
  const notice = page.getByTestId("checkout-notice");
  await expect(notice).toHaveAttribute("data-status", "UNKNOWN");
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request quote" })).toHaveCount(0);

  // reconciliation evidence arrives from the chain; the buyer asks with their own claim token, not through an operator route
  await control(page, { facilitatorMode: "ok", reconcileOutcome: "used" });
  const reconcile = page.waitForResponse((r) => r.url().includes(`/api/orders/${orderId}/reconcile`));
  await page.getByTestId("buyer-reconcile-button").click();
  expect((await reconcile).request().headers()["x-bullseye-claim"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(state).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  for (const name of SECTIONS) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(wallet.signatures()).toBe(1);

  const mine = await orderById(page, orderId);
  expect(orderEvents(mine)).toEqual(["QUOTED", "PAYMENT_PENDING", "PAYMENT_UNKNOWN", "PAID", "DELIVERING", "DELIVERED"]);
});

test("two browsers buying the same Brief stay apart: own order, own claim, and one cannot collect the other", async ({ browser }) => {
  const buy = async (key?: `0x${string}`) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const wallet = await installTestWallet(page, key);
    await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
    await openPaywall(page);
    await page.getByTestId("pay-button").click();
    const state = page.getByTestId("payment-state");
    await expect(state).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bullseye.purchase.")).map((k) => JSON.parse(localStorage.getItem(k)!) as { orderId: string; claim: string }));
    expect(kept).toHaveLength(1);
    expect(wallet.signatures()).toBe(1);
    return { context, page, wallet, orderId: (await state.getAttribute("data-order-id"))!, kept: kept[0]! };
  };
  const a = await buy();
  const b = await buy(SECOND_DEV_KEY);

  expect(a.orderId).not.toBe(b.orderId);
  expect(a.kept.orderId).toBe(a.orderId);
  expect(b.kept.orderId).toBe(b.orderId);
  expect(a.kept.claim).not.toBe(b.kept.claim);
  const payerOf = async (id: string) => (await orderById(a.page, id)).order.payment.payer.toLowerCase();
  expect(await payerOf(a.orderId)).toBe(a.wallet.address.toLowerCase());
  expect(await payerOf(b.orderId)).toBe(b.wallet.address.toLowerCase());

  // the token kept by browser A opens the order of A and nothing of B
  const own = await a.page.request.get(`${API}/api/orders/${a.orderId}/delivery`, { headers: { "x-bullseye-claim": a.kept.claim } });
  expect(own.status()).toBe(200);
  const other = await a.page.request.get(`${API}/api/orders/${b.orderId}/delivery`, { headers: { "x-bullseye-claim": a.kept.claim } });
  expect(other.status()).toBe(403);
  expect(JSON.stringify(await other.json())).not.toContain("whatHappened");
  await a.context.close();
  await b.context.close();
});

test("a reload after delivery brings the same Brief back: no wallet prompt, no new order", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
  await openPaywall(page);
  await page.getByTestId("pay-button").click();
  const state = page.getByTestId("payment-state");
  await expect(state).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  const orderId = await state.getAttribute("data-order-id");
  const before = (await allOrders(page)).length;

  await page.reload();
  await card(page, "IFFx").click();
  for (const name of SECTIONS) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("payment-state")).toHaveAttribute("data-order-id", orderId!);
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
  expect(wallet.signatures()).toBe(1);
  expect((await allOrders(page)).length).toBe(before);
});

test("a paid response that never arrives is recovered as the same order, with the one signature already given", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
  await openPaywall(page);

  // the seller settles and answers; the answer is lost on the way back to the browser
  let dropped = 0;
  await page.route("**/api/v1/briefs/**", async (route) => {
    if (dropped === 0 && route.request().headers()["payment-signature"]) {
      dropped += 1;
      await route.fetch();
      return route.abort("connectionreset");
    }
    return route.fallback();
  });
  const before = (await allOrders(page)).length;
  await page.getByTestId("pay-button").click();

  const notice = page.getByTestId("checkout-notice");
  await expect(notice).toHaveAttribute("data-issue", "NO_ANSWER", { timeout: 30_000 });
  await expect(notice).toHaveAttribute("data-status", "SUBMITTED");
  await expect(notice).toContainText("cannot charge you twice");
  await expect(page.getByTestId("pay-button")).toHaveCount(0);

  await page.getByTestId("resume-button").click();
  await expect(page.getByTestId("payment-state")).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  for (const name of SECTIONS) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(dropped).toBe(1);
  expect(wallet.signatures()).toBe(1);
  const after = await allOrders(page);
  expect(after.length).toBe(before + 1);
  expect(orderEvents(after[0]).filter((to: string) => to === "PAID")).toHaveLength(1);
});

test("a declined signature and a wallet on the wrong network charge nothing and say so; no wallet points at the agent buyer", async ({ page, browser }) => {
  const wallet = await installTestWallet(page);
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
  await openPaywall(page);
  const before = (await allOrders(page)).length;
  const notice = page.getByTestId("checkout-notice");

  await wallet.setMode("wrong_chain");
  await page.getByTestId("pay-button").click();
  await expect(notice).toHaveAttribute("data-issue", "WRONG_NETWORK", { timeout: 30_000 });
  await expect(notice).toContainText("X Layer testnet");

  await wallet.setMode("decline");
  await page.getByTestId("pay-button").click();
  await expect(notice).toHaveAttribute("data-issue", "WALLET_DECLINED", { timeout: 30_000 });
  await expect(notice).toContainText("Nothing charged");
  expect(wallet.signatures()).toBe(0);
  expect((await allOrders(page)).length).toBe(before);

  // nothing was signed, so being asked again is safe, and it completes
  await wallet.setMode("sign");
  await page.getByTestId("pay-button").click();
  await expect(page.getByTestId("payment-state")).toHaveAttribute("data-state", "DELIVERED", { timeout: 30_000 });
  expect(wallet.signatures()).toBe(1);

  const bare = await (await browser.newContext()).newPage();
  await openPaywall(bare);
  await bare.getByTestId("pay-button").click();
  const bareNotice = bare.getByTestId("checkout-notice");
  await expect(bareNotice).toHaveAttribute("data-issue", "NO_WALLET", { timeout: 30_000 });
  await expect(bareNotice).toContainText("npm run buy");
  await bare.context().close();
});
