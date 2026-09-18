/**
 * Records real source responses so the pipeline can later be replayed offline,
 * labelled HISTORICAL. Runs the detector and then every evidence tool for the
 * chosen signals against the live xStocks API and the live X Layer RPC.
 *
 *   npx tsx scripts/record.ts artifacts/recorded/<name> [SYMBOL ...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../apps/api/src/config.js";
import { openDb } from "../apps/api/src/db.js";
import { LiveTransport } from "../apps/api/src/adapters/transport.js";
import { XStocksAdapter } from "../apps/api/src/adapters/xstocks.js";
import { XLayerAdapter } from "../apps/api/src/adapters/xlayer.js";
import { SignalService } from "../apps/api/src/signals/signalService.js";
import { EvidenceToolbox, TOOL_SPECS } from "../apps/api/src/evidence/toolbox.js";

const [dir, ...symbols] = process.argv.slice(2);
if (!dir) {
  console.error("usage: tsx scripts/record.ts <output-dir> [SYMBOL ...]");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const config = loadConfig();
const capturedAt = new Date();
const transport = new LiveTransport({ allowCached: false, recordDir: dir });
const xstocks = new XStocksAdapter(transport, config.XSTOCKS_BASE_URL);
const xlayer = new XLayerAdapter(transport, config.XLAYER_RPC_URL);
const signals = new SignalService(openDb(":memory:"), xstocks, transport);

const scan = await signals.scan();
const chosen = (symbols.length > 0 ? scan.signals.filter((s) => symbols.includes(s.asset.symbol)) : scan.signals).slice(0, 3);
if (chosen.length === 0) {
  console.error(`no matching signals; detector found: ${scan.signals.map((s) => s.asset.symbol).join(", ") || "none"}`);
  process.exit(1);
}

const recorded: { signalId: string; symbol: string; evidence: string[] }[] = [];
for (const signal of chosen) {
  const toolbox = new EvidenceToolbox("recording", signal, xstocks, xlayer);
  for (const tool of TOOL_SPECS) {
    const inputs = tool.name === "read_onchain_multiplier" ? [{ when: "before_effective" }, { when: "after_effective" }, { when: "latest" }] : [{}];
    for (const input of inputs) {
      const item = await toolbox.call(tool.name, input);
      console.log(`${signal.asset.symbol} ${item.id}: ${item.summary}`);
    }
  }
  recorded.push({ signalId: signal.id, symbol: signal.asset.symbol, evidence: toolbox.all().map((e) => e.id) });
}

writeFileSync(
  join(dir, "_manifest.json"),
  JSON.stringify(
    {
      capturedAt: capturedAt.toISOString(),
      sources: { xstocks: config.XSTOCKS_BASE_URL, xlayerRpc: config.XLAYER_RPC_URL },
      detectorSignals: scan.signals.map((s) => ({ id: s.id, symbol: s.asset.symbol, observedAt: s.observedAt })),
      investigable: recorded,
      note: "Unmodified responses from the live sources named above, captured at capturedAt. Replayed by RecordedTransport and labelled HISTORICAL.",
    },
    null,
    2,
  ),
);
console.log(`\nrecorded ${recorded.length} signal(s) into ${dir}`);
