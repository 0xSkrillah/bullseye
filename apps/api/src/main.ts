import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { createApp } from "./http/app.js";

const config = loadConfig();
const container = buildContainer(config);
const rail = await container.rail.init();
const synthesis = container.synthesisStatus();

createApp(container).listen(config.PORT, () => {
  console.log(`bullseye api listening on :${config.PORT}`);
  console.log(`  data source   ${container.transport.primaryMode}`);
  console.log(`  synthesis     ${synthesis.provider}/${synthesis.model} ${synthesis.ready ? "ready" : `NOT READY (${synthesis.detail})`}`);
  console.log(`  payment rail  ${rail.rail} on ${rail.network} ${rail.ready ? "ready" : `NOT READY (${rail.detail})`}`);
});
