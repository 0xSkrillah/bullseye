import { expect, test, type Page } from "@playwright/test";

/**
 * The Market Desk in a browser, against the offline configuration (see playwright.config.ts):
 * recorded real source responses from 18 September 2026 (HISTORICAL), fixture synthesiser, fixture
 * payment rail. Two paths are covered, because both have to be right:
 *
 *   QSRx — a genuine-data path. The recording holds a reference price for it, so the figures in
 *          money are computed and shown.
 *   VGKx — the insufficient-data fallback. The recording holds no price for it, so every figure in
 *          money must be withheld with its missing input named, while the balance arithmetic, which
 *          needs no price, still stands. VGKx also entered the event with a multiplier above 1,
 *          which is the case where the double-application error and the rebase differ.
 */
const API = "http://localhost:4402";

/**
 * These specs share one server with golden-path.spec.ts, which leaves the fixture synthesiser set
 * to whatever its last test needed. Put it back to a state that publishes before investigating.
 */
async function control(page: Page, body: Record<string, string>) {
  const res = await page.request.post(`${API}/api/_fixture/control`, { data: body });
  expect(res.ok()).toBe(true);
}

/** the detector and one investigation, driven through the API: the screen itself starts no work */
async function prepare(page: Page, symbol: string): Promise<string> {
  await control(page, { facilitatorMode: "ok", synthesisBehaviour: "good" });
  const scan = await page.request.post(`${API}/api/signals/scan`);
  expect(scan.ok()).toBe(true);
  const signals = (await (await page.request.get(`${API}/api/signals`)).json()).signals as { signal: { id: string; asset: { symbol: string } }; investigation: unknown }[];
  const row = signals.find((s) => s.signal.asset.symbol === symbol);
  if (!row) throw new Error(`the recording produced no ${symbol} signal`);
  const started = await page.request.post(`${API}/api/signals/${row.signal.id}/investigate`);
  expect([200, 202]).toContain(started.status());
  // the run is short offline, but the screen must be right either way: wait for it to finish
  await expect
    .poll(async () => (await (await page.request.get(`${API}/api/signals/${row.signal.id}`)).json()).investigation?.status, { timeout: 60_000 })
    .not.toBe("RUNNING");
  return row.signal.id;
}

const figureByKey = (page: Page, key: string) => page.locator(`[data-testid="market-figure"][data-key="${key}"]`);
const row = (page: Page, what: string) => page.locator(`[data-testid="market-comparison-row"][data-what="${what}"]`);

test.describe.configure({ mode: "serial" });

test("the existing desk still works and offers the Market Desk", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Market Desk" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/market");
});

test("a genuine-data path: the event as money, with every figure labelled and sourced", async ({ page }) => {
  const signalId = await prepare(page, "QSRx");
  await page.goto(`/market/${signalId}`);

  // the headline says what happened, in the direction it happened, and carries that one number
  await expect(page.getByTestId("market-headline")).toContainText("every QSRx balance on X Layer grew by 0.665165779779%");
  // it no longer ends "no transfer was emitted": no event-log sweep is carried out, so that reads
  // as measured. The absence is reasoned from the mechanism, in the layer above.
  await expect(page.getByTestId("market-headline")).not.toContainText("no transfer was emitted");

  // the question this screen exists to answer, answered
  const verdict = page.getByTestId("market-verdict");
  await expect(verdict).toHaveAttribute("data-verdict", "NO_TRANSACTABLE_OPPORTUNITY");
  await expect(verdict).toContainText("No transactable opportunity");
  await expect(verdict).toContainText("no spread can be quoted and none is estimated");

  // the four clocks are separate, and a late first detection says so
  const clocks = page.getByTestId("market-clocks");
  await expect(clocks).toContainText("Effective");
  await expect(clocks).toContainText("First detected");
  await expect(clocks).toContainText("Newest fetch");
  await expect(clocks).toContainText("Answered");
  await expect(clocks).toContainText("A look back, not an early warning");

  // the balance arithmetic, exact, and labelled as what it is
  const impact = figureByKey(page, "BALANCE_IMPACT");
  await expect(impact).toHaveAttribute("data-label", "EVENT_IMPACT");
  await expect(impact).toContainText("+0.665165779779");
  await expect(impact).toContainText("% of a holder's token balance");

  // the two ways to be wrong, which are different numbers
  await expect(figureByKey(page, "STALE_BALANCE_ERROR")).toContainText("-0.66077056013");
  await expect(figureByKey(page, "DOUBLE_ADJUSTMENT_ERROR")).toContainText("+0.665165779779");

  // the reference figures, labelled REFERENCE DISCREPANCY and never as a quote
  const implied = figureByKey(page, "IMPLIED_REINVESTMENT_PRICE");
  await expect(implied).toHaveAttribute("data-label", "REFERENCE_DISCREPANCY");
  await expect(implied).toContainText("73.2900");
  await expect(implied).toContainText("REFERENCE DISCREPANCY");
  const position = figureByKey(page, "POSITION_VALUE");
  await expect(position).toContainText("+48.39");
  await expect(position).toContainText("7275.00");
  await expect(position).toContainText("7323.39");

  // no spread and no net edge, with the missing inputs named rather than assumed
  const spread = figureByKey(page, "QUOTED_SPREAD");
  await expect(spread).toHaveAttribute("data-label", "INSUFFICIENT_DATA");
  await expect(spread).toContainText("Not shown");
  for (const needed of ["no buy-side ask price", "no sell-side bid price", "no quote size", "no quote expiry", "no published fee schedule"]) {
    await expect(spread).toContainText(needed);
  }
  const net = figureByKey(page, "NET_EDGE");
  await expect(net).toHaveAttribute("data-label", "INSUFFICIENT_DATA");
  await expect(net).toContainText("an unknown cost is not zero");

  // the chart: one mark per recorded observation, the effective time marked, nothing joining them
  const chart = page.getByTestId("market-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator("circle")).toHaveCount(6);
  await expect(chart.locator("polyline")).toHaveCount(0);
  await expect(chart.locator("path")).toHaveCount(0);
  await expect(chart).toContainText("EFFECTIVE");
  await expect(chart).toContainText("Nothing is drawn between them");

  // the comparison panel keeps the rows it has nothing for
  await expect(row(page, "Issuer reference price")).toContainText("72.75");
  await expect(row(page, "Issuer reference price")).toContainText("HISTORICAL");
  await expect(row(page, "Executable buy quote (ask)")).toContainText("none published");
  await expect(row(page, "Executable sell quote (bid)")).toContainText("none published");
  await expect(row(page, "Quote expiry")).toContainText("No quote, so nothing expires");
  await expect(row(page, "Multiplier on X Layer")).toContainText("1.0066516577977895");

  // costs: the unknown ones stay unknown
  const costs = page.getByTestId("market-costs");
  await expect(costs).toContainText("slippage at size");
  await expect(costs.locator("tr", { hasText: "slippage at size" })).toContainText("unknown");
  await expect(costs.locator("tr", { hasText: "withholding tax" })).toContainText("issuer published");

  // the evidence drawer opens on an id and carries the hash of the response it came from
  await page.getByRole("button", { name: "EV-PRICE" }).first().click();
  const drawer = page.getByTestId("market-evidence-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("sha256 of the response");
  await expect(drawer).toContainText("api.xstocks.fi");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();

  // it points at the existing paid Brief rather than reproducing it, and keeps the price out of the figures
  const cta = page.getByTestId("brief-offer-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText("View this brief");
  await expect(cta).toHaveAttribute("href", /^\/\?brief=brf_/);
  await expect(page.getByTestId("brief-offer")).toContainText("brf_");
  await expect(page.getByText("separate ledgers")).toBeVisible();

  // nothing on this screen reads as advice or a promise
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const forbidden of ["guaranteed", "risk-free", "profit score", "you should buy", "you should sell"]) {
    expect(body, forbidden).not.toContain(forbidden);
  }
  await expect(page.getByText("not investment, legal or tax advice")).toBeVisible();
});

test("the insufficient-data fallback: no price, so no figure in money, and the balance arithmetic still stands", async ({ page }) => {
  const signalId = await prepare(page, "VGKx");
  await page.goto(`/market/${signalId}`);

  // the recording holds no reference price for this asset
  await expect(row(page, "Issuer reference price")).toContainText("none published");

  // Both figures in this section are absent for the same one reason, so the section says it once
  // rather than each card repeating it — three statements of one fact read as noise, not an answer.
  const why = page.getByTestId("market-section-why");
  await expect(why).toHaveCount(1);
  await expect(why).toContainText("Nothing in this section can be computed");
  await expect(why).toContainText("no reference price");

  for (const key of ["POSITION_VALUE", "IMPLIED_REINVESTMENT_PRICE"]) {
    const f = figureByKey(page, key);
    await expect(f, key).toHaveAttribute("data-label", "INSUFFICIENT_DATA");
    await expect(f, key).toContainText("Not shown");
    // the card still says what it cannot state, and keeps its inputs; it just does not repeat the cause
    await expect(f, key).not.toContainText("no reference price");
    await expect(f, key).toContainText("Inputs");
  }

  // where the reasons differ, every card keeps its own list: the de-duplication is not a blanket rule
  await expect(figureByKey(page, "QUOTED_SPREAD")).toContainText("no buy-side ask price");

  // and the part of the event that needs no price is unaffected
  const impact = figureByKey(page, "BALANCE_IMPACT");
  await expect(impact).toHaveAttribute("data-label", "EVENT_IMPACT");
  await expect(impact).toContainText("+0.1741971579");

  // VGKx came in with a multiplier already above 1, so the double-application error is not the rebase
  const double = figureByKey(page, "DOUBLE_ADJUSTMENT_ERROR");
  await expect(double).toContainText("+1.116517183338");
  await expect(double).toContainText("not the 0.1741971579%");

  await expect(page.getByTestId("market-verdict")).toContainText("No transactable opportunity");
  await expect(figureByKey(page, "NET_EDGE")).toContainText("Not shown");
});

test("an event with no investigation gets the issuer's side and nothing that needs one", async ({ page }) => {
  const scan = await page.request.post(`${API}/api/signals/scan`);
  expect(scan.ok()).toBe(true);
  const signals = (await (await page.request.get(`${API}/api/signals`)).json()).signals as { signal: { id: string }; investigation: unknown }[];
  const untouched = signals.find((s) => s.investigation === null);
  if (!untouched) throw new Error("every recorded signal has been investigated; this test needs one that has not");
  await page.goto(`/market/${untouched.signal.id}`);

  await expect(figureByKey(page, "BALANCE_IMPACT")).toHaveAttribute("data-label", "EVENT_IMPACT");
  await expect(figureByKey(page, "ISSUER_VERSUS_CHAIN")).toHaveAttribute("data-label", "INSUFFICIENT_DATA");
  await expect(page.getByTestId("market-chart")).toContainText("No on-chain read has been recorded");
  await expect(page.getByTestId("brief-offer")).toContainText("No brief has been published for this event");
  await expect(page.getByTestId("brief-offer-cta")).toHaveCount(0);
  // two issuer points, and no chain marks invented to fill the chart
  await expect(page.getByTestId("market-chart").locator("circle")).toHaveCount(2);
});

/**
 * The thing standing between a judge and the product was that the screen reported an event before
 * establishing that the event can happen. This walks the order a first-time reader meets.
 */
test("the screen explains what a tokenised stock does with a dividend before it reports one", async ({ page }) => {
  const signalId = await prepare(page, "QSRx");
  await page.goto(`/market/${signalId}`);

  const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;

  // the explanation comes first: the companies, the mechanism, then one multiplier fanning out
  await expect(page.getByTestId("primer-assets")).toBeVisible();
  await expect(page.locator(".mk-primer")).toContainText("Real companies, held as tokens.");
  await expect(page.locator(".mk-primer")).toContainText("A dividend with nowhere to land.");
  await expect(page.locator(".mk-primer")).toContainText("One number moves. Every balance follows.");

  // the worked example is this event's own arithmetic, on holdings marked as illustrations
  await expect(page.getByTestId("primer-fanout")).toContainText("42.279");
  await expect(page.locator(".mk-primer")).toContainText("chosen illustrations, not observed balances");

  // and the empty history is reasoned, never claimed as a measurement
  await expect(page.getByTestId("primer-history")).toContainText("Nobody sent anything, so there is nothing to record");

  // order on the page: explanation, then this event's headline, then its figures
  expect(await top(".mk-primer")).toBeLessThan(await top('[data-testid="market-headline"]'));
  expect(await top('[data-testid="market-headline"]')).toBeLessThan(await top('[data-testid="market-figure-section"]'));

  // the offer survives the rebuild intact: price, rail, the testnet sentence and the way in
  const offer = page.getByTestId("brief-offer");
  await expect(offer).toContainText("TESTNET");
  await expect(offer).toContainText("not revenue");
  await expect(page.getByTestId("brief-offer-cta")).toHaveText("View this brief");
});

test("how much counting a rebase twice costs varies across the book, and an extreme is one click away", async ({ page }) => {
  const signalId = await prepare(page, "QSRx");
  await page.goto(`/market/${signalId}`);

  const rows = page.locator(".mk-spread-row");
  // count() does not auto-wait, and the table is built from the signals feed: wait for the list
  await expect(page.getByTestId("primer-spread")).toBeVisible();
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);

  // QSRx started at a multiplier of exactly 1, so its two errors are the same number
  await expect(rows.filter({ hasText: "QSRx" }).first()).toContainText("1×");

  // SATAx's multiplier has drifted far from 1 over its life, so the same mistake costs far more.
  // The ratio is computed from the issuer's published multipliers, so the figure follows the data.
  const worst = rows.first();
  const text = (await worst.innerText()).replace(/\s+/g, " ");
  expect(text).toMatch(/\d+(\.\d)?×/);
  const multiple = Number(text.match(/([\d.]+)×/)![1]);
  expect(multiple, "the worst offender should be an order of magnitude worse than the event").toBeGreaterThan(10);

  // and choosing it opens that event, so the extreme is reachable rather than merely stated
  await worst.click();
  await expect(page).toHaveURL(/\/market\/sig_[0-9a-f]{16}$/);
  await expect(page.getByTestId("market-headline")).not.toBeEmpty();
});
