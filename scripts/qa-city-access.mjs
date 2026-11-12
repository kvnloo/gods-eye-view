#!/usr/bin/env node
// Walk-access journey (#206): author park and plaza alternatives on candidate
// sites and watch the baseline-versus-alternative access comparison change.
// Parent starts the app. This script owns only its headless browser and output.
// node scripts/qa-city-access.mjs [--url http://127.0.0.1:4187]
// QA_SHOTS_DIR (default qa-shots/city-access) receives numbered PNGs, the
// MP4 screencast (needs ffmpeg) and summary.json. CHROME_PATH picks Chromium.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  createPedestrianGraph,
  evaluateWalkAccess,
} from '../src/data/walkAccess.js';
import { WALK_ACCESS_FIXTURE as NETWORK } from '../src/data/walkAccessFixture.js';

const args = process.argv.slice(2);
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const output = path.resolve(process.env.QA_SHOTS_DIR || 'qa-shots/city-access');
const SITE = { lat: 37.8007, lon: -122.4103, alt: 1600 };
const report = { base, assertions: [], screenshots: [], pageErrors: [] };
const conceptRequests = [];

// Expected numbers come from the data module, independently of the UI.
const graph = createPedestrianGraph(NETWORK);
function expected(siteId) {
  const site = NETWORK.sites.find((s) => s.id === siteId);
  const result = evaluateWalkAccess({
    graph,
    zones: NETWORK.zones,
    parks: site ? [...NETWORK.parks, site] : NETWORK.parks,
  });
  return {
    mean: `${Math.round(result.meanMeters)} m`,
    worst: `${Math.round(result.worstMeters)} m`,
  };
}

await mkdir(output, { recursive: true });
const env = { ...process.env };
for (const name of [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'WAYLAND_SOCKET',
  'XAUTHORITY',
])
  delete env[name];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: true,
  env,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ozone-platform=headless',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.setDefaultTimeout(30000);
page.on('pageerror', (error) => report.pageErrors.push(String(error)));
await page.setRequestInterception(true);
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/city-concept')) {
    conceptRequests.push(request.url());
    request.abort('blockedbyclient');
  } else request.continue();
});

const beat = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
let step = 0;
async function shot(name, selector) {
  const filename = `${String(++step).padStart(2, '0')}-${name}.png`;
  const target = selector ? await page.$(selector) : page;
  await target.screenshot({ path: path.join(output, filename) });
  report.screenshots.push(filename);
}
async function check(name, run) {
  await run();
  report.assertions.push(name);
  console.log(`PASS ${name}`);
}
const settled = () =>
  page.waitForFunction(
    () =>
      document
        .querySelector('[data-city-builder-editor]')
        ?.getAttribute('aria-busy') === 'false',
  );
const text = (selector) =>
  page.$eval(selector, (element) => element.textContent.trim());
const cell = (id, name) =>
  text(`[data-city-access-row="${id}"] [data-city-access-${name}]`);
const state = (id) =>
  page.$eval(
    `[data-city-access-row="${id}"]`,
    (row) => row.dataset.cityAccessState,
  );
async function showAccess() {
  await page.$eval('[data-city-access]', (section) =>
    section.scrollIntoView({ block: 'start' }),
  );
  await beat(1200);
}
async function author({ title, kind, site }) {
  await page.$eval('#city-builder-title', (input) => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('#city-builder-title', title);
  await page.$eval('#city-builder-description', (input) => {
    input.value = 'A hypothetical public space for neighbours to compare.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.select('#city-builder-kind', kind);
  await page.select('#city-builder-site', site ?? '');
  await beat(500);
  await page.click('[data-city-builder-save]');
  await settled();
}

let recorder;
try {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  url.hash = new URLSearchParams({
    v: '2',
    lat: String(SITE.lat),
    lon: String(SITE.lon),
    alt: String(SITE.alt),
    heading: '0',
    pitch: '-90',
    roll: '0',
    style: 'normal',
  }).toString();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 180000 },
  );
  await page.waitForFunction(
    ({ lat, lon }) => {
      const p = window.__godsEyeView?.viewer?.camera?.positionCartographic;
      return (
        p &&
        Math.abs((p.latitude * 180) / Math.PI - lat) < 0.025 &&
        Math.abs((p.longitude * 180) / Math.PI - lon) < 0.025 &&
        !window.__godsEyeView.viewer.camera._currentFlight
      );
    },
    { timeout: 60000 },
    SITE,
  );
  await beat(5000);
  recorder = await page.screencast({
    path: path.join(output, 'city-access-journey.mp4'),
    format: 'mp4',
  });
  await shot('globe');

  await check(
    'Starting a project shows baseline walk access only',
    async () => {
      await page.click('#top-center-actions [data-city-builder-open]');
      await page.waitForSelector('[data-community-planning-preview]');
      await page.type('#city-builder-project-title', 'Walk access to parks');
      await page.click('[data-city-builder-start]');
      await page.waitForSelector('[data-city-builder-reference] img');
      await settled();
      await page.waitForSelector('[data-city-access]');
      assert.match(await text('[data-city-access-label]'), /HYPOTHETICAL/);
      assert.match(await text('[data-city-access-network]'), /synthetic/);
      const base = expected(null);
      assert.equal(await state('baseline'), 'evaluated');
      assert.equal(await cell('baseline', 'mean'), base.mean);
      assert.equal(await cell('baseline', 'worst'), base.worst);
      await showAccess();
      await shot('baseline-access', '[data-city-access]');
    },
  );

  await check('A park without a site stays explicitly unknown', async () => {
    await author({ title: 'Pocket park, not placed yet', kind: 'park' });
    await showAccess();
    assert.equal(await state('world-1'), 'unknown');
    assert.match(await cell('world-1', 'note'), /choose a site/);
    await shot('unplaced-unknown', '[data-city-access]');
  });

  await check(
    'A park on Site B changes mean and worst-served walk',
    async () => {
      await page.click('[data-city-builder-new]');
      await author({
        title: 'East park on Site B',
        kind: 'park',
        site: 'site-b',
      });
      await showAccess();
      const b = expected('site-b');
      assert.equal(await state('world-2'), 'evaluated');
      assert.equal(await cell('world-2', 'mean'), b.mean);
      assert.equal(await cell('world-2', 'worst'), b.worst);
      assert.match(await cell('world-2', 'delta'), /−\d+ m.*−\d+ m/);
      await shot('park-site-b', '[data-city-access]');
    },
  );

  await check(
    'Bike lanes are not applicable; a plaza on Site C is compared',
    async () => {
      await page.click('[data-city-builder-new]');
      await author({ title: 'Protected bike lane', kind: 'bike-lane' });
      await page.click('[data-city-builder-new]');
      await author({
        title: 'West plaza on Site C',
        kind: 'plaza',
        site: 'site-c',
      });
      await showAccess();
      assert.equal(await state('world-3'), 'not-applicable');
      const c = expected('site-c');
      assert.equal(await cell('world-4', 'mean'), c.mean);
      assert.equal(await cell('world-4', 'worst'), c.worst);
      const rows = await page.$$eval('[data-city-access-row]', (list) =>
        list.map((row) => row.dataset.cityAccessRow),
      );
      assert.deepEqual(rows, [
        'baseline',
        'world-1',
        'world-2',
        'world-3',
        'world-4',
      ]);
      assert.equal((await page.$$('[data-city-access-map]')).length, 3);
      await shot('compare-all', '[data-city-access]');
    },
  );

  await check(
    'Moving the park to Site A saves a version and updates access',
    async () => {
      const before = await cell('world-2', 'mean');
      await page.click(
        '[data-city-builder-alternative="world-2"] [data-city-builder-edit]',
      );
      await beat(500);
      await page.$eval('#city-builder-title', (input) => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.type('#city-builder-title', 'Central park, moved to Site A');
      await page.select('#city-builder-site', 'site-a');
      await beat(500);
      await page.click('[data-city-builder-save]');
      await settled();
      await showAccess();
      const a = expected('site-a');
      assert.equal(await cell('world-2', 'mean'), a.mean);
      assert.equal(await cell('world-2', 'worst'), a.worst);
      assert.notEqual(a.mean, before);
      await shot('moved-site-a', '[data-city-access]');
      await page.click('[data-city-builder-alternative="world-2"] summary');
      await beat(600);
      const history = await text('[data-city-builder-alternative="world-2"]');
      assert.match(history, /Site B[\s\S]*Site A/);
      await page.$eval('[data-city-builder-alternative="world-2"]', (row) =>
        row.scrollIntoView({ block: 'center' }),
      );
      await beat(1000);
      await shot(
        'version-history',
        '[data-city-builder-alternative="world-2"]',
      );
    },
  );

  await check(
    'Access is derived for display; nothing is generated or stored',
    async () => {
      const saved = await page.evaluate(() =>
        localStorage.getItem('godsEyeView.cityBuilder.v1'),
      );
      assert.match(saved, /"site":"site-a"/);
      assert.doesNotMatch(saved, /meanMeters|worstMeters/);
      assert.deepEqual(conceptRequests, []);
      assert.deepEqual(report.pageErrors, []);
      await showAccess();
      await shot('final-compare', '[data-community-planning-preview]');
    },
  );
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = error.stack || String(error);
  await page
    .screenshot({ path: path.join(output, 'failure.png') })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await recorder?.stop().catch((error) => {
    report.videoError = String(error);
  });
  await writeFile(
    path.join(output, 'summary.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await browser.close();
  console.log(
    report.status === 'pass' ? 'City access QA passed' : report.error,
  );
}
