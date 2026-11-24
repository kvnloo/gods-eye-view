#!/usr/bin/env node
/**
 * Headless end-to-end check of the opt-in z0live display bridge.
 *
 * Needs a running app (`npm run dev`) and a z0live desktop broker on a test
 * data directory, with the app's origin in its Z0LIVE_CORS_ORIGINS. The page
 * registers as the `gev` display with DISPLAY_TOKEN; this script then asks
 * the broker, as a different paired device (AGENT_TOKEN), to fly to Tokyo,
 * and checks that the result is ok and the camera really moved there.
 * With SESSION_ID (a voice session owned by AGENT_TOKEN's device) the second
 * command goes through the phone's `POST /v1/tools/globe` route.
 *
 *   APP_URL=http://localhost:4173 BROKER_URL=http://127.0.0.1:PORT \
 *   DISPLAY_TOKEN=... AGENT_TOKEN=... [SESSION_ID=...] [OUT_DIR=...] \
 *   node scripts/qa-z0live-display.mjs
 *
 * Tokens are read from the environment and never printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const appUrl = process.env.APP_URL || 'http://localhost:4173';
const broker = (process.env.BROKER_URL || '').replace(/\/+$/, '');
const displayToken = process.env.DISPLAY_TOKEN || '';
const agentToken = process.env.AGENT_TOKEN || '';
const sessionId = process.env.SESSION_ID || '';
const outDir = process.env.OUT_DIR || path.resolve('.qa-z0live-display');
// Optional: HOLD_MS=<ms> keeps the page registered after the checks.
if (!broker || !displayToken || !agentToken) {
  console.error('BROKER_URL, DISPLAY_TOKEN and AGENT_TOKEN are required');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const report = { appUrl: new URL(appUrl).origin, steps: [] };
const step = (name, data) => {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(`[qa-z0live-display] ${name}`, JSON.stringify(data));
};

async function brokerCall(route, body) {
  const response = await fetch(`${broker}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: await puppeteer.executablePath(),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
  ],
});
let failed = false;
const consoleErrors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const url = `${appUrl}/?z0live=${encodeURIComponent(broker)}#z0live_token=${encodeURIComponent(displayToken)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__godsEyeView?.voiceCommands && window.__godsEyeView?.viewer,
    { timeout: 90_000 },
  );
  const address = await page.evaluate(() => location.href);
  step('page ready', { tokenLeftAddress: !address.includes('z0live_token') });

  const readCamera = () =>
    page.evaluate(() => {
      const c = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        latitude: (c.latitude * 180) / Math.PI,
        longitude: (c.longitude * 180) / Math.PI,
        heightM: c.height,
      };
    });

  let status;
  for (let i = 0; i < 60; i++) {
    status = (await brokerCall('/v1/displays/gev')).body;
    if (status.connected) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  step('display registered', {
    bridge: await page.evaluate(
      () => window.__godsEyeView?.z0liveDisplay ?? null,
    ),
    connected: status.connected,
    actions: status.actions?.length,
    context: status.context,
  });
  if (!status.connected) throw new Error('display never registered');

  const before = await readCamera();
  await page.screenshot({ path: path.join(outDir, '1-before.png') });
  step('camera before', before);

  const started = Date.now();
  const flown = await brokerCall('/v1/displays/gev/command', {
    action: 'fly_to_location',
    args: { query: 'Tokyo', waitForArrival: true },
  });
  step('fly_to_location Tokyo (agent route)', {
    http: flown.status,
    ms: Date.now() - started,
    result: flown.body,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await readCamera();
  await page.screenshot({ path: path.join(outDir, '2-after-tokyo.png') });
  const tokyoKm = distanceKm(after, TOKYO);
  step('camera after Tokyo', { ...after, kmFromTokyo: Math.round(tokyoKm) });
  if (!flown.body.ok) throw new Error('fly to Tokyo was not ok');
  if (tokyoKm > 150) throw new Error('camera is not over Tokyo');

  if (sessionId) {
    const viaTool = await brokerCall('/v1/tools/globe', {
      session_id: sessionId,
      call_id: 'qa-call-1',
      arguments: {
        action: 'fly_to_location',
        args: { ...SYDNEY, waitForArrival: true },
      },
    });
    step('globe tool (phone route) Sydney', {
      http: viaTool.status,
      result: viaTool.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const sydney = await readCamera();
    await page.screenshot({ path: path.join(outDir, '3-after-sydney.png') });
    const sydneyKm = distanceKm(sydney, SYDNEY);
    step('camera after Sydney', {
      ...sydney,
      kmFromSydney: Math.round(sydneyKm),
    });
    if (!viaTool.body.ok || sydneyKm > 150)
      throw new Error('globe tool route did not move the camera');
    const view = await brokerCall('/v1/tools/globe_context', {
      session_id: sessionId,
      arguments: {},
    });
    step('globe_context (phone route)', {
      http: view.status,
      context: view.body.context,
    });
  }

  const refused = await brokerCall('/v1/displays/gev/command', {
    action: 'set_voice_inactivity_timeout',
    args: { minutes: 1 },
  });
  step('unlisted action refused', { result: refused.body });
  step('bridge status at end', {
    bridge: await page.evaluate(
      () => window.__godsEyeView?.z0liveDisplay ?? null,
    ),
  });
  // HOLD_MS keeps the display open for an outside caller (e.g. `z0live globe`).
  const hold = Number(process.env.HOLD_MS || 0);
  if (hold > 0) {
    const pose = await readCamera();
    step('holding for outside callers', { ms: hold, camera: pose });
    await new Promise((resolve) => setTimeout(resolve, hold));
    const held = await readCamera();
    await page.screenshot({ path: path.join(outDir, '4-after-hold.png') });
    step('camera after hold', held);
  }
  if (refused.body.ok !== false)
    throw new Error('unlisted action was not refused');
} catch (error) {
  failed = true;
  step('FAILED', { error: error.message });
} finally {
  report.consoleErrors = consoleErrors.slice(0, 20);
  await browser.close();
  writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(report, null, 2),
  );
}
process.exit(failed ? 1 : 0);
