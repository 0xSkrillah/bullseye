import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { loadConfig, type Config } from "../src/config.js";
import { buildContainer, type Container } from "../src/container.js";
import { openDb } from "../src/db.js";
import { FixtureTransport } from "../src/adapters/transport.js";
import { buildFixtureResponses, FIXTURE_CLOCK, type FixtureOptions } from "../src/adapters/fixtures.js";

/** well-known Hardhat development key; holds nothing on any real network */
export const TEST_BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const TEST_PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    DB_PATH: ":memory:",
    DATA_SOURCE: "fixture",
    SYNTHESIS_PROVIDER: "fixture",
    PAYMENT_RAIL: "fixture",
    ALLOW_FIXTURE_PUBLICATION: "true",
    PAY_TO_ADDRESS: TEST_PAY_TO,
    PUBLIC_BASE_URL: "http://localhost:4402",
    BRIEF_PRICE_USD: "1.00",
    BUDGET_MAX_COST_USD: "0.40",
    ...env,
  });
}

export async function testContainer(env: Record<string, string> = {}, fixture: FixtureOptions = {}, clock: () => Date = () => FIXTURE_CLOCK): Promise<Container & { fixtureTransport: FixtureTransport }> {
  const config = testConfig(env);
  const transport = new FixtureTransport(buildFixtureResponses(fixture), clock);
  const container = buildContainer(config, { db: openDb(":memory:"), transport });
  await container.rail.init();
  return Object.assign(container, { fixtureTransport: transport });
}

/** scan, investigate the first signal, wait for the run to finish */
export async function investigateFirstSignal(c: Container) {
  const scan = await c.signals.scan();
  const signal = scan.signals[0];
  if (!signal) throw new Error("fixture produced no signal");
  const { investigationId } = c.investigations.start(signal);
  await c.investigations.wait(investigationId);
  const view = c.investigations.view(investigationId);
  if (!view) throw new Error("investigation vanished");
  return { signal, view };
}

/** A real x402 buyer built from the OKX client SDK, signing with a throwaway key. */
export function testBuyer(key: `0x${string}` = TEST_BUYER_KEY) {
  const account = privateKeyToAccount(key);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  return { account, http: new x402HTTPClient(client) };
}
