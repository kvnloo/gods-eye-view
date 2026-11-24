#!/usr/bin/env node
/**
 * Headless end-to-end check of the situation room (?situation=1) driven the
 * way a z0live call or agent drives it: through a z0live test broker's
 * display route. Five OSINT asks run end to end; each captures a 1920×1080
 * frame before and after, records the display's result, and runs the hard
 * gates (scripts/situation-gates.mjs) on the after frame.
 *
 *   APP_URL=http://localhost:4173 BROKER_URL=http://127.0.0.1:PORT \
 *   DISPLAY_TOKEN=... AGENT_TOKEN=... OUT_DIR=... \
 *   node scripts/qa-situation-room.mjs
 *
 * ASKS_FILE may name a JSON list of {ask, action, args} to run instead.
 * Tokens are read from the environment and never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { collectGateData, evaluateGates } from './situation-gates.mjs';

const appUrl = process.env.APP_URL || 'http://localhost:4173';
const broker = (process.env.BROKER_URL || '').replace(/\/+$/, '');
const displayToken = process.env.DISPLAY_TOKEN || '';
const agentToken = process.env.AGENT_TOKEN || '';
const outDir = process.env.OUT_DIR || path.resolve('.qa-situation-room');
const settleMs = Number(process.env.SETTLE_MS || 9000);
if (!broker || !displayToken || !agentToken) {
  console.error('BROKER_URL, DISPLAY_TOKEN and AGENT_TOKEN are required');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

export const DEFAULT_ASKS = [
  {
    id: 'hormuz',
    ask: 'show flights over the Strait of Hormuz',
    action: 'show_card',
    args: { kind: 'aircraft', place: 'Strait of Hormuz' },
    expect: { kind: 'aircraft' },
  },
  {
    id: 'japan',
    ask: 'any earthquakes in the last day near Japan',
    action: 'show_card',
    args: { kind: 'quakes', place: 'Japan' },
    expect: { kind: 'quakes' },
  },
  {
    id: 'california',
    ask: "what's burning in California",
    action: 'show_card',
    args: { kind: 'fires', place: 'California' },
    expect: { kind: 'fires' },
  },
  {
    id: 'oakland',
    ask: 'ships headed to Oakland',
    action: 'show_card',
    args: { kind: 'vessels', place: 'Oakland, California', filter: 'Oakland' },
    expect: { kind: 'vessels' },
  },
  {
    id: 'bayarea',
    ask: 'brief me on the Bay Area right now',
    action: 'brief',
    args: { place: 'San Francisco Bay Area' },
    expect: { kind: 'brief' },
  },
];
const asks = process.env.ASKS_FILE
  ? JSON.parse(readFileSync(process.env.ASKS_FILE, 'utf8'))
  : DEFAULT_ASKS;

const report = { appUrl: new URL(appUrl).origin, started: new Date().toISOString(), asks: [], frames: [] };
const log = (name, data) => console.log(`[qa-situation-room] ${name}`, JSON.stringify(data));

async function brokerCall(route, body) {
  const response = await fetch(`${broker}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
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
    '--window-size=1920,1080',
  ],
});
let failed = false;
const consoleErrors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      consoleErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  const url = `${appUrl}/?situation=1&z0live=${encodeURIComponent(broker)}#z0live_token=${encodeURIComponent(displayToken)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__godsEyeView?.situation?.enabled, { timeout: 90_000 });
  let status;
  for (let i = 0; i < 60; i++) {
    status = (await brokerCall('/v1/displays/gev')).body;
    if (status?.connected) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const actions = (status?.actions ?? []).map((a) => a.name ?? a);
  log('display registered', { connected: status?.connected, actions: actions.length, cards: actions.includes('show_card') });
  report.display = { connected: Boolean(status?.connected), actions };
  // Let the feeds land before the first frame.
  await page.waitForFunction(() => document.querySelectorAll('#situation-room .sit-event').length > 3, { timeout: 60_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, settleMs));

  const capture = async (name) => {
    const file = path.join(outDir, `${name}.png`);
    const errorsBefore = consoleErrors.length;
    const data = await collectGateData(page);
    const png = await page.screenshot({ path: file });
    const gates = await evaluateGates(data, png, { consoleErrors: consoleErrors.splice(0) });
    report.frames.push({ name, file: path.basename(file), gates });
    log('frame', { name, pass: gates.pass, counts: gates.counts, minFont: gates.minFont, worstContrast: gates.worstContrast, errorsBefore });
    return { file, gates };
  };

  await capture('00-idle');
  for (const [index, ask] of asks.entries()) {
    const n = String(index + 1).padStart(2, '0');
    const before = await capture(`${n}-${ask.id}-before`);
    const t0 = Date.now();
    const result = await brokerCall('/v1/displays/gev/command', { action: ask.action, args: ask.args });
    const ms = Date.now() - t0;
    // The card plays, then holds; capture while it holds.
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const card = await page.evaluate(() => {
      const lead = document.querySelector('#situation-room .sit-card:not(.sit-card--compact)');
      return lead
        ? {
            id: lead.dataset.cardId,
            classes: lead.className,
            text: lead.innerText.replace(/\s+/g, ' ').slice(0, 600),
          }
        : null;
    });
    const after = await capture(`${n}-${ask.id}-after`);
    const body = result.body ?? {};
    const output = body.output ?? body.result ?? {};
    const kindShown = Boolean(card && new RegExp(`sit-kind--${ask.expect.kind}`).test(card.classes));
    const honest =
      body.status === 'done' ||
      (body.status === 'failed' && /needs|unavailable|key|did not answer/i.test(JSON.stringify(output)));
    const entry = {
      ask: ask.ask,
      action: ask.action,
      args: ask.args,
      http: result.status,
      status: body.status ?? null,
      ok: body.ok ?? null,
      ms,
      output,
      card,
      kindShown,
      answered: kindShown && honest,
      before: path.basename(before.file),
      after: path.basename(after.file),
      gatesPass: after.gates.pass,
    };
    report.asks.push(entry);
    log('ask', { ask: ask.ask, status: entry.status, ok: entry.ok, ms, kindShown, answered: entry.answered });
    if (!entry.answered) failed = true;
  }
  // The rest of the grammar: pin, focus the top change, dismiss to receipts.
  const pin = await brokerCall('/v1/displays/gev/command', { action: 'pin_card', args: {} });
  const focus = await brokerCall('/v1/displays/gev/command', { action: 'focus_event', args: { rank: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await capture('90-focus-pinned');
  const dismiss = await brokerCall('/v1/displays/gev/command', { action: 'dismiss_card', args: { all: true } });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await capture('91-receipts');
  report.grammar = { pin: pin.body, focus: focus.body, dismiss: dismiss.body };
  report.context = (await brokerCall('/v1/displays/gev')).body?.context ?? null;
} catch (error) {
  failed = true;
  report.error = String(error?.stack || error);
  console.error(error);
} finally {
  report.finished = new Date().toISOString();
  report.answered = report.asks.filter((a) => a.answered).length;
  report.gatesPassed = report.frames.filter((f) => f.gates.pass).length;
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
log('done', { answered: `${report.answered}/${asks.length}`, framesPassingGates: `${report.gatesPassed}/${report.frames.length}` });
process.exit(failed ? 1 : 0);
