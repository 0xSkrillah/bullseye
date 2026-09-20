import type { Config } from "./config.js";
import { openDb, type Db } from "./db.js";
import { FixtureTransport, LiveTransport, RecordedTransport, type SourceTransport } from "./adapters/transport.js";
import { XStocksAdapter } from "./adapters/xstocks.js";
import { XLayerAdapter } from "./adapters/xlayer.js";
import { buildFixtureResponses, FIXTURE_CLOCK } from "./adapters/fixtures.js";
import { SignalService } from "./signals/signalService.js";
import { InvestigationService } from "./research/investigator.js";
import type { SynthesisProvider } from "./research/model.js";
import { createLiveProvider } from "./research/provider.js";
import { FixtureProvider, type FixtureBehaviour } from "./research/fixtureModel.js";
import { BriefStore } from "./briefs.js";
import { OrderLedger } from "./commerce/orderLedger.js";
import { Checkout } from "./commerce/checkout.js";
import { createOkxRail, FixtureFacilitator, FixtureRail, type PaymentRailAdapter } from "./commerce/rail.js";
import type { AutoDesk } from "./desk/autoDesk.js";

export interface Container {
  config: Config;
  db: Db;
  transport: SourceTransport;
  signals: SignalService;
  investigations: InvestigationService;
  briefs: BriefStore;
  ledger: OrderLedger;
  rail: PaymentRailAdapter;
  checkout: Checkout;
  /** set by the entry point when the unattended loop is switched on */
  autoDesk: AutoDesk | null;
  /** present only on the fixture rail */
  fixtureFacilitator: FixtureFacilitator | null;
  /** test hook: change how the fixture synthesiser behaves */
  setFixtureBehaviour(b: FixtureBehaviour): void;
  synthesisStatus(): { provider: string; model: string; ready: boolean; detail: string };
}

export interface ContainerOverrides {
  transport?: SourceTransport;
  db?: Db;
}

export function buildContainer(config: Config, overrides: ContainerOverrides = {}): Container {
  const db = overrides.db ?? openDb(config.DB_PATH);

  const transport: SourceTransport =
    overrides.transport ??
    (config.DATA_SOURCE === "live"
      ? new LiveTransport({ db, allowCached: true, timeoutMs: config.SOURCE_TIMEOUT_MS, recordDir: process.env.RECORD_DIR || undefined })
      : config.DATA_SOURCE === "recorded"
        ? new RecordedTransport(config.RECORDING_DIR)
        : new FixtureTransport(buildFixtureResponses(), () => FIXTURE_CLOCK));

  const xstocks = new XStocksAdapter(transport, config.XSTOCKS_BASE_URL);
  const xlayer = new XLayerAdapter(transport, config.XLAYER_RPC_URL);
  const signals = new SignalService(db, xstocks, transport, { lookbackHours: transport.primaryMode === "LIVE" ? 96 : 24 * 365, maxAssetsPerScan: 12 });

  let fixtureBehaviour: FixtureBehaviour = "good";
  let cachedProvider: SynthesisProvider | null = null;
  const provider = (): SynthesisProvider => {
    if (config.SYNTHESIS_PROVIDER === "fixture") return new FixtureProvider(fixtureBehaviour);
    cachedProvider ??= createLiveProvider(config);
    return cachedProvider;
  };

  const estimatedReservesUsd = config.EST_PAYMENT_FEE_RESERVE_USD + config.EST_REWORK_RESERVE_USD + config.EST_DATA_TOOL_ALLOWANCE_USD;
  const investigations = new InvestigationService({
    db,
    transport,
    xstocks,
    xlayer,
    provider,
    budget: config.budget,
    priceUsd: Number(config.BRIEF_PRICE_USD),
    estimatedReservesUsd,
    allowFixturePublication: config.ALLOW_FIXTURE_PUBLICATION,
  });

  const briefs = new BriefStore(db);
  const ledger = new OrderLedger(db);

  let fixtureFacilitator: FixtureFacilitator | null = null;
  let rail: PaymentRailAdapter;
  if (config.PAYMENT_RAIL === "fixture") {
    fixtureFacilitator = new FixtureFacilitator("eip155:1952");
    rail = new FixtureRail(fixtureFacilitator, config.PAY_TO_ADDRESS);
  } else {
    const mainnet = config.PAYMENT_RAIL === "okx-mainnet";
    rail = createOkxRail({
      mainnet,
      apiKey: config.OKX_API_KEY,
      secretKey: config.OKX_SECRET_KEY,
      passphrase: config.OKX_PASSPHRASE,
      payTo: config.PAY_TO_ADDRESS,
      rpcUrl: mainnet ? config.XLAYER_RPC_URL : config.XLAYER_TESTNET_RPC_URL,
    });
  }

  const checkout = new Checkout({
    ledger,
    rail,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    priceUsd: config.BRIEF_PRICE_USD,
    quoteTtlSeconds: config.QUOTE_TTL_SECONDS,
    getBrief: (id) => briefs.get(id),
    withdrawnReason: (brief) => {
      const sup = signals.supersession(brief.signal.id);
      return sup ? `the issuer ${sup.reason === "CANCELLED" ? "cancelled" : "replaced"} corporate action ${brief.signal.facts.corporateActionId} v${brief.signal.facts.corporateActionVersion} with v${sup.byVersion}${sup.notes ? ` (${sup.notes})` : ""}; noted ${sup.notedAt}` : null;
    },
  });

  return {
    config,
    db,
    transport,
    signals,
    investigations,
    briefs,
    ledger,
    rail,
    checkout,
    autoDesk: null,
    fixtureFacilitator,
    setFixtureBehaviour: (b) => {
      fixtureBehaviour = b;
    },
    synthesisStatus: () => {
      try {
        const info = provider().info;
        const detail =
          info.mode === "FIXTURE"
            ? "test double; Briefs are labelled FIXTURE"
            : config.SYNTHESIS_PROVIDER === "openrouter"
              ? `cost tier ${config.OPENROUTER_COST_TIER}; price cap $${config.OPENROUTER_MAX_PRICE_PROMPT}/$${config.OPENROUTER_MAX_PRICE_COMPLETION} per million tokens in/out`
              : "configured";
        return { provider: info.provider, model: info.model, ready: true, detail };
      } catch (err) {
        return { provider: config.SYNTHESIS_PROVIDER, model: config.BULLSEYE_MODEL, ready: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
