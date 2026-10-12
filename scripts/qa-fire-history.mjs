#!/usr/bin/env node
/**
 * Keyless browser QA for the composed Historic Fires layer and shared rail.
 *
 * Against a running dev/preview server:
 *   npm run qa:fire-history:fixtures -- --url http://localhost:4173
 *
 * The Node-side route check confirms the real archive provider is mounted.
 * Browser archive requests are then intercepted with synthetic historical
 * detections. No FIRMS key, live archive request, or perimeter fetch is needed.
 * This test does NOT validate current fire activity or emergency access.
 * Original Historic Fires product/replay: lleon-at-navteca, upstream #609.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIRE_HISTORY_QA_EVENTS = Object.freeze([
  {
    id: 'camp-fire-2018',
    name: 'Camp Fire (fixture)',
    region: 'Butte County, California, USA',
    startDate: '2018-11-08',
    endDate: '2018-11-10',
    bbox: [-121.75, 39.65, -121.3, 39.95],
    burnedHa: 62053,
    references: [{
      label: 'CAL FIRE incident page',
      url: 'https://www.fire.ca.gov/incidents/2018/11/8/camp-fire/',
    }],
  },
  {
    id: 'lahaina-2023',
    name: 'Lahaina (fixture)',
    region: 'Maui, Hawaii, USA',
    startDate: '2023-08-08',
    endDate: '2023-08-09',
    bbox: [-156.75, 20.8, -156.55, 20.98],
    references: [],
  },
]);

/** Return only synthetic data or an explicit error; never fall back to live FIRMS. */
export function fireHistoryFixtureReply(pathname) {
  if (pathname === '/api/fire-history')
    return { status: 200, payload: { hasKey: true, events: FIRE_HISTORY_QA_EVENTS } };
  if (pathname === '/api/fire-history/camp-fire-2018')
    return {
      status: 200,
      payload: {
        event: FIRE_HISTORY_QA_EVENTS[0],
        fetchedAt: Date.parse('2024-01-01T00:00:00Z'),
        complete: false,
        windows: [{ source: 'VIIRS_SNPP_SP', ok: false }],
        fires: [
          {
            lat: 39.8, lon: -121.5, frp: 12, acqDate: '2018-11-08',
            acqTime: '0100', instrument: 'VIIRS',
          },
          {
            lat: 39.81, lon: -121.51, frp: 3, acqDate: '2018-11-09',
            acqTime: '1300', instrument: 'MODIS',
          },
        ],
      },
    };
  if (pathname === '/api/fire-history/lahaina-2023')
    return { status: 503, payload: { error: 'no_key' } };
  return { status: 404, payload: { error: 'unknown_fixture_event' } };
}

async function assertProviderMounted(origin) {
  const target = new URL('/api/fire-history', origin);
  const response = await fetch(target, { headers: { Accept: 'application/json' } });
  assert.equal(response.status, 200, 'real keyless catalog route must be mounted');
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const payload = await response.json();
  assert.equal(typeof payload.hasKey, 'boolean');
  assert.ok(Array.isArray(payload.events));
}

async function run() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--url');
  if (at >= 0 && !argv[at + 1]) throw new Error('--url requires an address');
  const origin = new URL(at >= 0 ? argv[at + 1] : process.env.QA_BASE_URL || 'http://localhost:4173');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'fixture QA requires localhost');
  await assertProviderMounted(origin);

  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      ...(process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu']
        : ['--use-gl=angle', '--use-angle=swiftshader']),
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const errors = [];
  const calls = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await page.createCDPSession();
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: origin.origin + '/api/fire-history*' }],
    });
    cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
      const url = new URL(request.url);
      if (url.origin !== origin.origin || !url.pathname.startsWith('/api/fire-history')) {
        void cdp.send('Fetch.continueRequest', { requestId }).catch((e) => errors.push(e.message));
        return;
      }
      const reply = request.method === 'GET'
        ? fireHistoryFixtureReply(url.pathname)
        : { status: 405, payload: { error: 'fixture_get_only' } };
      calls.push({ path: url.pathname, status: reply.status });
      void cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: reply.status,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(reply.payload)).toString('base64'),
      }).catch((e) => errors.push(e.message));
    });

    await page.goto(new URL('/?welcome=0', origin).href, {
      waitUntil: 'domcontentloaded', timeout: 90_000,
    });
    await page.waitForFunction(() =>
      Boolean(window.__godsEyeView?.dataManager && window.__gevFireHistory?.layer),
    { timeout: 120_000 });
    await page.evaluate(() => document.querySelector('.first-run-explore')?.click());
    await page.evaluate(() => {
      const context = document.getElementById('global-context-panel');
      if (context?.classList.contains('collapsed'))
        document.querySelector('[data-collapse-target="global-context-panel"]')?.click();
    });
    await page.evaluate(async () => {
      await window.__godsEyeView.dataManager.setEnabled('fire-history', true);
    });
    await page.waitForFunction(() => {
      const state = window.__gevFireHistory?.layer?.getPresentationState();
      return state && !state.loading && state.enabled &&
        state.event?.id === 'camp-fire-2018' && state.count === 2;
    }, { timeout: 45_000 });

    const first = await page.evaluate(() => {
      const layer = window.__gevFireHistory.layer;
      const state = layer.getPresentationState();
      const root = document.querySelector('#fire-history-panel-body .fire-history-readout');
      return {
        hidden: root?.hidden,
        cards: root?.querySelectorAll('.rail-card').length,
        readout: root?.querySelector('.rail-timeline-readout')?.textContent,
        reference: root?.querySelector('a[href]')?.href,
        complete: state.complete,
        timeline: state.timeline.map((day) => day.count),
      };
    });
    assert.equal(first.hidden, false);
    assert.equal(first.cards, 2);
    assert.equal(first.complete, false);
    assert.deepEqual(first.timeline, [1, 1, 0]);
    assert.match(first.readout, /2 detections .* PARTIAL/);
    assert.match(first.reference, /^https:\/\/www\.fire\.ca\.gov\//);

    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.fire-history-timeline button')];
      const play = buttons.find((button) => button.textContent.trim() === 'Play');
      if (!play) throw new Error('Historic Fires Play control missing');
      play.click();
    });
    await page.waitForFunction(() =>
      window.__gevFireHistory.layer.getPresentationState().replay?.status === 'playing',
    { timeout: 5_000 });
    const playText = await page.$eval('.fire-history-timeline .rail-timeline-readout',
      (node) => node.textContent);
    assert.doesNotMatch(playText, /\bburning\b|\bsafe\b/i);

    await page.evaluate(() => {
      const slider = document.querySelector('.fire-history-timeline input[type="range"]');
      if (!slider) throw new Error('Historic Fires timeline slider missing');
      slider.value = '1';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const tick = await page.evaluate(() =>
      window.__gevFireHistory.layer.getPresentationState().replay.cursorMs);
    assert.ok(tick >= Date.parse('2018-11-09T00:00:00Z'));
    assert.ok(tick < Date.parse('2018-11-10T00:00:00Z'));

    await page.evaluate(() => {
      const latest = [...document.querySelectorAll('.fire-history-timeline button')]
        .find((button) => button.textContent.trim() === 'Latest');
      if (!latest) throw new Error('Historic Fires Latest control missing');
      latest.click();
    });
    assert.equal(await page.evaluate(() =>
      window.__gevFireHistory.layer.getPresentationState().replay.status), 'idle');

    const out = path.join('qa-artifacts', 'fire-history');
    await mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'partial.png') });

    await page.evaluate(() => {
      const button = document.querySelector(
        '#fire-history-panel-body .fire-history-card:nth-child(2) [data-action-id="select"]',
      );
      if (!button) throw new Error('Lahaina selection button missing');
      button.click();
    });
    await page.waitForFunction(() => {
      const state = window.__gevFireHistory?.layer?.getPresentationState();
      return state && !state.loading && state.event?.id === 'lahaina-2023'
        && state.keyRequired;
    }, { timeout: 20_000 });
    const missingKey = await page.evaluate(() => {
      const layer = window.__gevFireHistory.layer;
      return {
        state: layer.getPresentationState(),
        text: document.querySelector('.fire-history-timeline .rail-timeline-readout')?.textContent,
      };
    });
    assert.equal(missingKey.state.count, 0);
    assert.equal(missingKey.state.lastUpdate, null);
    assert.equal(missingKey.text, 'FIRMS KEY REQUIRED');
    await page.screenshot({ path: path.join(out, 'key-required.png') });

    await page.evaluate(async () =>
      window.__godsEyeView.dataManager.setEnabled('fire-history', false));
    const disabled = await page.evaluate(() => ({
      hidden: document.querySelector('.fire-history-readout')?.hidden,
      ...window.__gevFireHistory.layer.getDiagnostics(),
    }));
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.hidden, true);
    assert.equal(disabled.replayFrameActive, false);
    assert.deepEqual(errors, []);
    const expected = [
      { path: '/api/fire-history', status: 200 },
      { path: '/api/fire-history/camp-fire-2018', status: 200 },
      { path: '/api/fire-history/lahaina-2023', status: 503 },
    ];
    for (const call of expected) assert.ok(calls.some(
      (observed) => observed.path === call.path && observed.status === call.status,
    ));
    assert.ok(calls.every((call) => expected.some(
      (allowed) => allowed.path === call.path && allowed.status === call.status,
    )), 'unrecognized archive call');
    console.log('PASS: Historic Fires fixture browser QA (partial, playback, key-required, cleanup)');
    console.log('Evidence: ' + out);
  } finally {
    await browser.close();
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
