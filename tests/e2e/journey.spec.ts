import { expect, test, type Page } from "@playwright/test";

/**
 * The customer journey, in a browser, against the offline configuration (see playwright.config.ts):
 * recorded real source responses, fixture synthesiser, fixture payment rail. No keys, no funds.
 *
 * Market event → the exact report → back again. These are the paths a link can break silently:
 * an id in the URL that resolves to some other report, a Back button that leaves the address and
 * the screen disagreeing, a dialog that keeps the keyboard, and a layout that only fits the
 * screenshot it was taken on. Each is asserted here rather than looked at.
 */
const API = "http://localhost:4402";

/** the widths this is judged at, plus the boundary either side of the three-column layout */
const WIDTHS = [360, 390, 768, 1024, 1199, 1200, 1280, 1335, 1336, 1440];

async function control(page: Page, body: Record<string, string>) {
  const res = await page.request.post(`${API}/api/_fixture/control`, { data: body });
  expect(res.ok()).toBe(true);
}

/** the detector and one investigation for `symbol`, driven through the API: the screen starts no work */
async function investigated(page: Page, symbol: string): Promise<{ signalId: string; briefId: string }> {
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
  expect((await page.request.post(`${API}/api/signals/scan`)).ok()).toBe(true);
  const rows = (await (await page.request.get(`${API}/api/signals`)).json()).signals as { signal: { id: string; asset: { symbol: string } } }[];
  const row = rows.find((s) => s.signal.asset.symbol === symbol);
  if (!row) throw new Error(`the recording produced no ${symbol} signal`);
  expect([200, 202]).toContain((await page.request.post(`${API}/api/signals/${row.signal.id}/investigate`)).status());
  await expect
    .poll(async () => (await (await page.request.get(`${API}/api/signals/${row.signal.id}`)).json()).investigation?.status, { timeout: 60_000 })
    .not.toBe("RUNNING");
  const after = (await (await page.request.get(`${API}/api/signals/${row.signal.id}`)).json()).investigation as { briefId: string | null };
  if (!after?.briefId) throw new Error(`${symbol} published no Brief, so there is no exact link to test`);
  return { signalId: row.signal.id, briefId: after.briefId };
}

test.describe.configure({ mode: "serial" });

test("the exact report link opens that report, on a direct load and after a reload", async ({ page }) => {
  const first = await investigated(page, "QSRx");
  const second = await investigated(page, "IFFx");
  expect(second.briefId).not.toBe(first.briefId);

  // the Market Desk offers the newest investigated event by default, so open the other one on purpose
  await page.goto(`/market/${first.signalId}`);
  const cta = page.getByTestId("brief-offer-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", `/?brief=${first.briefId}`);
  // the offer says what it costs and on what network before anything is clicked
  const price = page.getByTestId("brief-offer-price");
  await expect(price).toContainText("USD");
  await expect(price).toContainText("X Layer testnet");
  await expect(price).toContainText("TESTNET");

  await cta.click();
  await expect(page).toHaveURL(new RegExp(`\\?brief=${first.briefId}$`));
  // the report on screen is the one that was clicked, not the newest one
  await expect(page.getByTestId("brief-id")).toHaveAttribute("data-brief-id", first.briefId);

  await page.reload();
  await expect(page.getByTestId("brief-id")).toHaveAttribute("data-brief-id", first.briefId);

  // and the same id typed straight into the address bar lands in the same place
  await page.goto(`/?brief=${second.briefId}`);
  await expect(page.getByTestId("brief-id")).toHaveAttribute("data-brief-id", second.briefId);

  // choosing the report never starts a purchase on its own
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
});

test("Back and Forward keep the address and the event on screen in step", async ({ page }) => {
  const a = await investigated(page, "QSRx");
  const b = await investigated(page, "IFFx");

  await page.goto(`/market/${a.signalId}`);
  await expect(page.getByTestId("market-headline")).toContainText("QSRx");

  const picker = page.getByTestId("market-picker");
  await expect(picker).toBeVisible();
  await picker.locator("summary").click();
  await picker.locator(`a[href="/market/${b.signalId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/market/${b.signalId}$`));
  await expect(page.getByTestId("market-headline")).toContainText("IFFx");

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/market/${a.signalId}$`));
  await expect(page.getByTestId("market-headline")).toContainText("QSRx");

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/market/${b.signalId}$`));
  await expect(page.getByTestId("market-headline")).toContainText("IFFx");

  // and the picker is still on the page after a choice, not only before the first one
  await expect(page.getByTestId("market-picker")).toBeVisible();
});

test("the event picker opens from the keyboard and its entries are real links", async ({ page }) => {
  const a = await investigated(page, "QSRx");
  await page.goto(`/market/${a.signalId}`);

  const summary = page.getByTestId("market-picker").locator("summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("market-picker")).toHaveAttribute("open", "");
  // every entry carries the URL it goes to, so it can be copied or opened in a new tab
  const links = page.getByTestId("market-picker").locator("a[href^='/market/']");
  expect(await links.count()).toBeGreaterThan(1);
});

test("an unknown report id says so, and never shows a different report instead", async ({ page }) => {
  await investigated(page, "QSRx");
  await page.goto("/?brief=brf_0000000000000000");

  await expect(page.getByText("Report not found")).toBeVisible();
  await expect(page.getByText("brf_0000000000000000")).toBeVisible();
  // no report is substituted, and nothing offers to buy anything
  await expect(page.getByTestId("brief-id")).toHaveCount(0);
  await expect(page.getByTestId("pay-button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request quote" })).toHaveCount(0);

  // and there is a way out that works
  await page.getByRole("button", { name: "Back to the events" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("no page scrolls sideways at any judged width", async ({ page }) => {
  const a = await investigated(page, "QSRx");
  for (const route of ["/", `/?brief=${a.briefId}`, `/market/${a.signalId}`]) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(route);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // a table inside .mk-scroll may scroll on its own; the page itself may not
      expect(over, `${route} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("the evidence dialog takes the keyboard and gives it back", async ({ page }) => {
  const a = await investigated(page, "QSRx");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/market/${a.signalId}`);

  const opener = page.getByRole("button", { name: /^EV-/ }).first();
  const openerName = (await opener.textContent())?.trim();
  await opener.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByTestId("market-evidence-drawer");
  await expect(drawer).toBeVisible();
  // focus moved into the dialog
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="market-evidence-drawer"]') !== null)).toBe(true);

  // Tab stays inside it, however far it is pressed
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="market-evidence-drawer"]') !== null)).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="market-evidence-drawer"]') !== null)).toBe(true);

  // Escape closes it and the focus goes back to the button that opened it
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(openerName);
});
