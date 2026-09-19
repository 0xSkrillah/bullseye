import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { createApp } from "./http/app.js";
import { AutoDesk } from "./desk/autoDesk.js";

const config = loadConfig();
const container = buildContainer(config);
const rail = await container.rail.init();
const interrupted = container.investigations.recoverInterrupted();
if (interrupted.length > 0) console.log(`closed ${interrupted.length} investigation(s) cut off by a restart: ${interrupted.join(", ")}`);
const synthesis = container.synthesisStatus();

createApp(container).listen(config.PORT, () => {
  console.log(`bullseye api listening on :${config.PORT}`);
  console.log(`  data source   ${container.transport.primaryMode}`);
  console.log(`  synthesis     ${synthesis.model} via ${synthesis.provider} ${synthesis.ready ? `ready (${synthesis.detail})` : `NOT READY (${synthesis.detail})`}`);
  console.log(`  payment rail  ${rail.rail} on ${rail.network} ${rail.ready ? "ready" : `NOT READY (${rail.detail})`}`);
  if (config.AUTO_DESK) {
    const desk = new AutoDesk(container, { intervalMinutes: config.AUTO_DESK_INTERVAL_MINUTES, maxInvestigationsPerDay: config.AUTO_DESK_MAX_INVESTIGATIONS_PER_DAY, log: (line) => console.log(`${new Date().toISOString()} ${line}`) });
    console.log(`  auto desk     every ${config.AUTO_DESK_INTERVAL_MINUTES} min, at most ${config.AUTO_DESK_MAX_INVESTIGATIONS_PER_DAY} investigations per 24 h (model spend ceiling $${desk.dailySpendCeilingUsd.toFixed(2)} per 24 h)`);
    container.autoDesk = desk;
    desk.start();
  } else {
    console.log("  auto desk     off");
  }
});
