/**
 * Runs the detector once against the live xStocks API and prints what it found.
 *
 *   npm run detect
 */
import { loadConfig } from "../apps/api/src/config.js";
import { openDb } from "../apps/api/src/db.js";
import { LiveTransport } from "../apps/api/src/adapters/transport.js";
import { XStocksAdapter } from "../apps/api/src/adapters/xstocks.js";
import { SignalService } from "../apps/api/src/signals/signalService.js";

const config = loadConfig();
const transport = new LiveTransport({ allowCached: false });
const scan = await new SignalService(openDb(":memory:"), new XStocksAdapter(transport, config.XSTOCKS_BASE_URL), transport).scan();

console.log(`${scan.actionsSeen} corporate actions seen, ${scan.candidates} rebase candidates, ${scan.signals.length} on X Layer\n`);
for (const s of scan.signals) {
  console.log(`${s.id}  ${s.provenance.mode}  observed ${s.observedAt}  ${s.headline}`);
  console.log(`    token ${s.asset.tokenAddress} · CA ${s.facts.corporateActionId} v${s.facts.corporateActionVersion} · input ${s.provenance.inputHash.slice(0, 16)}…`);
}
for (const k of scan.skipped) console.log(`skipped ${k.symbol}: ${k.reason}`);
