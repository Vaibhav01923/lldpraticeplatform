import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from './compositionRoot';
import { loadConfig } from './config';
import { consoleLogger } from './domain/ports';

const config = loadConfig();
const container = buildContainer(config, { logger: consoleLogger });

const { recovered } = await container.start();
if (recovered > 0) console.log(`Re-queued ${recovered} unfinished evaluation(s) from the previous run.`);

const clientBuilt = existsSync(join(dirname(fileURLToPath(import.meta.url)), '../../web/dist/index.html'));

const server = container.app.listen(config.port, () => {
  if (!clientBuilt) console.warn('The web client is not built, so only the API is served. Run `npm run build` first (or `npm run dev` for hot reload).');
  const ai = container.ai.enabled ? `AI review: ${container.ai.model}` : 'AI review: off (set ANTHROPIC_API_KEY, or LLD_AI_PROVIDER=demo to try the flow)';
  console.log(`LLD Practice Platform → http://localhost:${config.port}\n${ai}\nDatabase: ${config.databasePath}`);
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received: finishing in-flight evaluations…`);
  server.close();
  // In-flight work is bounded by the pipeline's own timeouts; anything cut short is re-queued on next start.
  await Promise.race([container.shutdown(), new Promise((r) => setTimeout(r, 15_000))]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
