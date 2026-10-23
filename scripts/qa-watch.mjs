// Run on the build worker: NTFY_SERVER=http://127.0.0.1:PORT node scripts/qa-watch.mjs
// Requires a real ntfy server. This is synthetic end-to-end delivery, not live hazard/phone proof.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';

const server = process.env.NTFY_SERVER;
if (!server || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(server).hostname)) throw new Error('Provide a real worker-local NTFY_SERVER');
const topic = `gev-test-${randomUUID()}`;
const loaded = [];
const hook = registerHooks({ resolve(specifier, context, next) {
  if (/cesium|puppeteer|playwright|vite/.test(specifier)) throw new Error('T0 imported a renderer/browser/build dependency');
  const result = next(specifier, context);
  loaded.push(result.url);
  return result;
} });
const { createWatchRuntime } = await import('../server/watch/runtime.js');
const { createWatchStore } = await import('../server/watch/store.js');
const { createNtfyNotifier } = await import('../server/watch/notifiers.js');
// Import the actual production acquisition graph as well; no GPU modules may resolve.
await import('../server/watch/sources.js');
const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-watch-proof-'));
const now = Date.now();
const notifier = createNtfyNotifier({ server, topic });
const options = {
  rules: [{ id: 'synthetic-proof', source: 'usgs', enabled: true, lat: 0, lon: 0, radiusKm: 100, minMagnitude: 4, maxAgeMs: 3600000, cooldownMs: 0 }],
  sources: { usgs: { intervalMs: 1000, getSnapshot: async () => [{ id: 'usgs:synthetic-proof', source: 'USGS synthetic fixture', observedAt: now, lat: 0, lon: 0, magnitude: 5, title: 'GEV TEST — synthetic event', url: 'https://earthquake.usgs.gov/' }] } },
  notifier, store: createWatchStore(path.join(dir, 'state.json')),
};
let runtime;
const start = process.cpuUsage();
const started = performance.now();
try {
  runtime = await createWatchRuntime(options);
  const deliveryStarted = performance.now();
  await runtime.tick();
  const acknowledgedDeliveryMs = performance.now() - deliveryStarted;
  assert.equal(runtime.getState().events[0].status, 'delivered');
  await runtime.close();
  runtime = await createWatchRuntime(options);
  await new Promise((r) => setTimeout(r, 1100));
  await runtime.tick();
  const response = await fetch(`${server}/${topic}/json?poll=1`);
  assert.equal(response.ok, true);
  const messages = (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.event === 'message');
  assert.equal(messages.length, 1, 'real ntfy must receive one message across restart/replay');
  assert.match(messages[0].message, /synthetic fixture/);
  assert.equal(messages[0].click, 'https://earthquake.usgs.gov/');
  const cpu = process.cpuUsage(start);
  console.log(JSON.stringify({ gate: 'watch-real-ntfy', status: 'PASS', synthetic: true, physicalPhone: false, realNtfy: true, messages: messages.length, acknowledgedDeliveryMs, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss, cpuMicroseconds: cpu, loadedModuleCount: loaded.length, rendererImportGuard: 'passed', resourceComparison: 'not measured by this gate' }));
} finally {
  await runtime?.close();
  hook.deregister();
  await rm(dir, { recursive: true, force: true });
}
