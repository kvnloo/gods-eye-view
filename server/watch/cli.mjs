import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { createWatchRuntime } from './runtime.js';
import { createWatchStore } from './store.js';
import { createWatchSources } from './sources.js';
import { createNtfyNotifier, createKdeConnectNotifier } from './notifiers.js';

/** Read private server-owned configuration, never a browser/Vite environment. */
export async function readWatchConfig(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (info.mode & 0o077 || info.size > 256 * 1024) throw new Error('Watch configuration must be private (0600) and bounded');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

/** Start only explicit watch sources and outbound notification delivery; no listener. */
export async function runWatch({ configFile, once = false, signal } = {}) {
  if (!configFile) throw new TypeError('--config is required');
  const config = await readWatchConfig(configFile);
  const directory = path.resolve(path.dirname(configFile), config.stateDirectory || '.gev-watch');
  const delivery = config.notifier;
  if (!delivery || !['ntfy', 'kdeconnect'].includes(delivery.type)) throw new TypeError('Configure an explicit notification adapter');
  const notifier = delivery.type === 'ntfy'
    ? createNtfyNotifier({ server: delivery.server, topic: delivery.topic, token: process.env.GEV_NTFY_TOKEN })
    : createKdeConnectNotifier({ deviceId: delivery.deviceId });
  const runtime = await createWatchRuntime({ rules: config.rules, sources: createWatchSources(), notifier, store: createWatchStore(path.join(directory, 'state.json')) });
  try {
    do {
      if (signal?.aborted) break;
      await runtime.tick();
      if (once) break;
      await setTimeout(1000, undefined, { signal });
    } while (!signal?.aborted);
    return { status: 'stopped', rssBytes: process.memoryUsage().rss, cpuMicroseconds: process.cpuUsage() };
  } catch (error) {
    if (!signal?.aborted) throw error;
    return { status: 'stopped' };
  } finally { await runtime.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  if (configIndex < 0 || !args[configIndex + 1] || args.some((a, i) => a !== '--config' && a !== '--once' && i !== configIndex + 1)) {
    console.error('Usage: node server/watch/cli.mjs --config private-watch.json [--once]');
    process.exitCode = 2;
  } else {
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
    runWatch({ configFile: args[configIndex + 1], once: args.includes('--once'), signal: controller.signal }).then((result) => console.log(JSON.stringify(result))).catch(() => {
      console.error('Watch stopped: check private configuration, state ownership and delivery status');
      process.exitCode = 1;
    });
  }
}
