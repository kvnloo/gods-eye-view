#!/usr/bin/env node
// City builder site-suggestion journey (#206). The parent starts the app; this
// script owns only its headless browser and output files (same conventions as
// qa-city-play.mjs).
// node scripts/qa-city-sites.mjs [--url http://127.0.0.1:4187]
// It counts the clicks from "plot selected" to a screen that shows the suggested
// site's mean and worst-served walk beside the plan's: once from a blank project
// and once in a fresh session with a sited park saved. Both must stay within
// MAX_CLICKS. QA_SHOTS_DIR defaults to qa-shots/city-sites; QA_VIDEO_DIR records
// a .webm of the journey.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const output = path.resolve(process.env.QA_SHOTS_DIR || 'qa-shots/city-sites');
const videoDir =
  process.env.QA_VIDEO_DIR && path.resolve(process.env.QA_VIDEO_DIR);
const KEY = 'godsEyeView.cityBuilder.v1';
const MAX_CLICKS = 3;
// Camera south of Washington Square, San Francisco, looking north at 45°.
const SITE = { lat: 37.7953, lon: -122.4103, alt: 600, heading: 0, pitch: -45 };
const DESKTOP = { width: 1440, height: 900 };
const S = {
  pill: '#top-center-actions [data-city-builder-open]',
  play: '[data-city-play]',
  records: '[data-city-play-records="bar"]',
  dialog: '[data-community-planning-preview]',
  access: '[data-city-access]',
  suggest: '[data-city-access-suggest]',
  objective: '[data-city-access-objective]',
  count: '[data-city-access-site-count]',
  row: (id) => `[data-city-access-row="${id}"]`,
};
const report = {
  startedAt: new Date().toISOString(),
  base,
  site: SITE,
  assertions: [],
  screenshots: [],
  pageErrors: [],
  forbiddenConceptRequests: [],
  clicks: {},
  marks: {},
};
let browser;
let page;
let phase = 'launch';
let clicks = [];
const started = Date.now();
const mark = (name) => (report.marks[name] = (Date.now() - started) / 1000);
const locator = (selector) => page.locator(selector);
const persisted = () => page.evaluate((key) => localStorage.getItem(key), KEY);

async function check(name, run) {
  phase = name;
  try {
    await run();
    report.assertions.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.assertions.push({
      name,
      status: 'fail',
      error: error.stack || String(error),
    });
    throw error;
  }
}
async function screenshot(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(output, filename), timeout: 30000 });
  report.screenshots.push(filename);
}
async function until(predicate, label, timeout = 60000, arg) {
  try {
    await page.waitForFunction(predicate, arg, { timeout, polling: 250 });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}
// Every counted step is one real pointer click on a visible control.
async function click(selector) {
  await locator(selector).click();
  clicks.push(selector);
}
function siteUrl() {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  url.hash = new URLSearchParams({
    v: '2',
    lat: String(SITE.lat),
    lon: String(SITE.lon),
    alt: String(SITE.alt),
    heading: String(SITE.heading),
    pitch: String(SITE.pitch),
    roll: '0',
    style: 'normal',
  }).toString();
  return url.href;
}
async function startup() {
  // Through a blank page, so a second start is a new session, not a hash change.
  await page.goto('about:blank');
  await page.goto(siteUrl(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await until(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    'app ready',
    120000,
  );
  await until(
    () => {
      const { viewer, mapStackController } = window.__godsEyeView;
      return (
        !viewer.camera._currentFlight &&
        viewer.scene.globe.tilesLoaded &&
        mapStackController?.getState?.().status === 'ready'
      );
    },
    'map tiles loaded',
    120000,
  );
  await locator(S.pill).click();
  await locator(S.play).waitFor({ state: 'visible' });
}
// "Plot selected": one click on the free map, then the camera settles on it.
async function selectPlot() {
  const at = await page.evaluate(({ width, height }) => {
    const canvas = document.querySelector('#cesiumContainer canvas');
    const x = Math.round(width / 2);
    for (let y = Math.round(height * 0.52); y > 140; y -= 12)
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    return { x, y: Math.round(height * 0.4) };
  }, DESKTOP);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await until(
    () =>
      window.__gevCityPlay?.snapshot().plot &&
      !window.__godsEyeView.viewer.camera._currentFlight,
    'a plot is selected',
    30000,
  );
  await page.waitForTimeout(600);
  clicks = [];
}
const cell = (id, name) =>
  locator(`${S.row(id)} [data-city-access-${name}]`).innerText();
async function suggestion(objective, count) {
  await locator(S.objective).selectOption(objective);
  await locator(S.count).selectOption(String(count));
  await locator(S.suggest).click();
  await locator(
    `${S.row('suggestion')}[data-city-access-suggested="${objective}:${count}"]`,
  ).waitFor();
  return {
    site: await cell('suggestion', 'site'),
    mean: await cell('suggestion', 'mean'),
    worst: await cell('suggestion', 'worst'),
  };
}

await mkdir(output, { recursive: true });
try {
  const env = { ...process.env };
  for (const key of [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'WAYLAND_SOCKET',
    'MIR_SOCKET',
    'XAUTHORITY',
  ])
    delete env[key];
  browser = await chromium.launch({
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
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    ...(videoDir && { recordVideo: { dir: videoDir, size: DESKTOP } }),
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) =>
    report.pageErrors.push({ phase, message: e.message }),
  );
  // Fixture concepts only: any concept network request is a regression.
  await context.route('**/api/city-concept*', async (route) => {
    report.forbiddenConceptRequests.push({ phase, url: route.request().url() });
    await route.abort('blockedbyclient');
  });

  await check('A plot is selected on the test site', async () => {
    await startup();
    await selectPlot();
    mark('plotSelected');
    await screenshot('01-plot-selected');
  });

  await check(
    `Blank project: at most ${MAX_CLICKS} clicks from the selected plot to the suggested site beside the plan`,
    async () => {
      await click('[data-city-play-action="park"]');
      await until(
        () => {
          const s = window.__gevCityPlay.snapshot();
          return !s.framing && !s.pending && s.concepts.includes('world-1');
        },
        'the pocket park stands on the plot',
        90000,
      );
      await click(S.records);
      await locator(S.dialog).waitFor({ state: 'visible' });
      await locator(S.access).scrollIntoViewIfNeeded();
      await locator(S.row('baseline')).waitFor();
      mark('walkAccess');
      await screenshot('02-walk-access-before-suggestion');
      const before = await persisted();
      await click(S.suggest);
      await locator(
        `${S.row('suggestion')}[data-city-access-state="evaluated"]`,
      ).waitFor({ timeout: 5000 });
      mark('suggestion');
      report.clicks.blankProject = [...clicks];
      assert.ok(clicks.length <= MAX_CLICKS, `${clicks.length} clicks`);
      // Suggested site B beside the plan: the existing park, and a park with no site yet.
      assert.equal(await cell('suggestion', 'site'), 'Site B');
      assert.equal(await cell('suggestion', 'mean'), '231 m');
      assert.equal(await cell('suggestion', 'worst'), '480 m');
      assert.equal(await cell('baseline', 'mean'), '432 m');
      assert.equal(await cell('baseline', 'worst'), '710 m');
      assert.match(await cell('world-1', 'note'), /choose a site/);
      assert.match(
        await locator('[data-city-access-suggestion-label]').innerText(),
        /HYPOTHETICAL OPTION/,
      );
      assert.equal(
        await locator(
          '[data-city-access-map="suggestion"] rect[fill="#d5b67b"]',
        ).count(),
        1,
      );
      // Asking for a suggestion saves nothing and changes no possible world.
      assert.equal(await persisted(), before);
      await locator(S.row('suggestion')).scrollIntoViewIfNeeded();
      await screenshot('03-suggested-site-beside-baseline');
    },
  );

  await check(
    'Objective and site count change the suggestion; a tie is stated',
    async () => {
      assert.deepEqual(await suggestion('worst-served', 1), {
        site: 'Site A',
        mean: '298 m',
        worst: '450 m',
      });
      assert.deepEqual(await suggestion('average', 2), {
        site: 'Site B + Site C',
        mean: '169 m',
        worst: '320 m',
      });
      assert.deepEqual(await suggestion('worst-served', 2), {
        site: 'Site B + Site C',
        mean: '169 m',
        worst: '320 m',
      });
      assert.match(
        await locator('[data-city-access-suggestion-note]').innerText(),
        /tie/i,
      );
      await locator(S.access).scrollIntoViewIfNeeded();
      await screenshot('04-two-sites-worst-served-tie');
    },
  );

  await check(
    `Sited plan, fresh session: at most ${MAX_CLICKS} clicks from the selected plot to the suggestion beside the plan's own walk`,
    async () => {
      // Setup, not counted: place the pocket park on site A and start a new session.
      await locator(
        '[data-city-builder-alternative="world-1"] [data-city-builder-edit]',
      ).click();
      await locator('#city-builder-site').selectOption('site-a');
      await locator('[data-city-builder-save]').click();
      await locator(
        `${S.row('world-1')}[data-city-access-state="evaluated"]`,
      ).waitFor();
      await locator('[data-planning-cancel]').click();
      await locator(S.dialog).waitFor({ state: 'detached' });
      await startup();
      await selectPlot();
      mark('plotSelectedAgain');
      await click(S.records);
      await locator(S.dialog).waitFor({ state: 'visible' });
      await locator(S.access).scrollIntoViewIfNeeded();
      assert.equal(await locator(S.row('suggestion')).count(), 0);
      await page.waitForTimeout(1500);
      await click(S.suggest);
      await locator(
        `${S.row('suggestion')}[data-city-access-state="evaluated"]`,
      ).waitFor({ timeout: 5000 });
      mark('comparison');
      report.clicks.sitedPlan = [...clicks];
      assert.ok(clicks.length <= MAX_CLICKS, `${clicks.length} clicks`);
      assert.equal(await cell('world-1', 'site'), 'Site A');
      assert.equal(await cell('world-1', 'mean'), '298 m');
      assert.equal(await cell('world-1', 'worst'), '450 m');
      assert.equal(await cell('suggestion', 'site'), 'Site B');
      assert.equal(await cell('suggestion', 'mean'), '231 m');
      assert.equal(await cell('suggestion', 'worst'), '480 m');
      // Both rows sit in the one comparison table.
      assert.equal(
        await locator(
          `[data-city-access-table] ${S.row('world-1')}, [data-city-access-table] ${S.row('suggestion')}`,
        ).count(),
        2,
      );
      await locator(S.row('suggestion')).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      await screenshot('05-suggested-site-beside-the-plan');
      await locator(
        '[data-city-access-map="suggestion"]',
      ).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      await screenshot('06-suggested-site-on-the-sample-network');
      mark('end');
    },
  );

  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.forbiddenConceptRequests, []);
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = error.stack || String(error);
  process.exitCode = 1;
  if (page) await screenshot('failure').catch(() => {});
} finally {
  report.video = page?.video()
    ? await page
        .video()
        .path()
        .catch(() => null)
    : null;
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const count = (list) => list?.length ?? 'unreachable';
  console.log(
    `CLICKS blank-project=${count(report.clicks.blankProject)} sited-plan=${count(report.clicks.sitedPlan)} max=${MAX_CLICKS}`,
  );
  console.log(
    report.status === 'pass' ? 'PASS: city sites' : `FAIL: ${report.error}`,
  );
}
