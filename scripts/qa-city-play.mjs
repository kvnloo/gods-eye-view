#!/usr/bin/env node
// City builder play mode journey. The parent starts the app; this script owns
// only its headless browser and output files (same conventions as
// qa-city-builder.mjs).
// node scripts/qa-city-play.mjs [--url http://127.0.0.1:4187] [--only-desktop] [--real]
// --real makes exactly one request through the opted-in local ChatGPT bridge
// (GEV_CITY_CONCEPT_LOCAL=1 dev server) and records that concept in the world.
// QA_SHOTS_DIR defaults to qa-shots/city-play. QA_VIDEO_DIR records .webm and,
// when ffmpeg is on PATH, an .mp4 of the journey.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { textLegibility } from '../src/ui/legibility.js';

const args = process.argv.slice(2);
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
let onlyDesktop = false;
let real = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else if (args[i] === '--only-desktop') onlyDesktop = true;
  else if (args[i] === '--real') real = true;
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const output = path.resolve(process.env.QA_SHOTS_DIR || 'qa-shots/city-play');
// Absolute, like Playwright's own video paths, so videos map to their pages.
const videoDir =
  process.env.QA_VIDEO_DIR && path.resolve(process.env.QA_VIDEO_DIR);
const KEY = 'godsEyeView.cityBuilder.v1';
// Camera south of Washington Square, San Francisco, looking north at 45°.
const SITE = { lat: 37.7953, lon: -122.4103, alt: 600, heading: 0, pitch: -45 };
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const S = {
  pill: '#top-center-actions [data-city-builder-open]',
  play: '[data-city-play]',
  bar: '[data-city-play-bar]',
  ring: '[data-city-play-wheel] .city-play-wheel-ring',
  wheel: '[data-city-play-wheel]',
  carousel: '[data-city-play-carousel]',
  dialog: '[data-community-planning-preview]',
};
const report = {
  startedAt: new Date().toISOString(),
  base,
  site: SITE,
  output,
  assertions: [],
  screenshots: [],
  console: [],
  pageErrors: [],
  forbiddenConceptRequests: [],
  measurements: {},
};
let browser;
let page;
const videos = {};
async function openPage(context, role) {
  const next = await context.newPage();
  next.setDefaultTimeout(20000);
  next.on('console', (m) =>
    report.console.push({
      phase,
      type: m.type(),
      text: m.text(),
      location: m.location(),
    }),
  );
  next.on('pageerror', (e) =>
    report.pageErrors.push({ phase, message: e.message, stack: e.stack }),
  );
  if (next.video()) videos[role] = next.video().path();
  return next;
}
let phase = 'launch';
const locator = (selector) => page.locator(selector);
const probe = () => page.evaluate(() => window.__gevCityPlay?.snapshot());
const persisted = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);

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
  await page.goto(siteUrl(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await until(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    'app ready',
    120000,
  );
  await until(
    ({ lat, lon }) => {
      const v = window.__godsEyeView.viewer;
      const p = v.camera.positionCartographic;
      return (
        Math.abs((p.latitude * 180) / Math.PI - lat) < 0.02 &&
        Math.abs((p.longitude * 180) / Math.PI - lon) < 0.02 &&
        !v.camera._currentFlight
      );
    },
    'camera at site',
    60000,
    SITE,
  );
  await tilesLoaded();
}
async function tilesLoaded(timeout = 120000) {
  await until(
    () => {
      const { viewer, mapStackController } = window.__godsEyeView;
      const primitives = viewer.scene.primitives;
      const loadedTileset = Array.from({ length: primitives.length }, (_, i) =>
        primitives.get(i),
      ).some((item) => item.show && item.tilesLoaded === true);
      const surface = viewer.scene.globe?.show
        ? viewer.scene.globe.tilesLoaded
        : loadedTileset;
      return surface && mapStackController?.getState?.().status === 'ready';
    },
    'map tiles loaded',
    timeout,
  );
}
async function pixelEvidence(name) {
  const bytes = await locator('#cesiumContainer canvas').first().screenshot();
  const { data, info } = await sharp(bytes)
    .resize(160, 100, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set();
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
    sum += luma;
    squares += luma * luma;
  }
  const n = info.width * info.height;
  const evidence = {
    quantizedColors: colors.size,
    lumaDeviation: Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)),
  };
  report.measurements[name] = evidence;
  assert.ok(
    evidence.quantizedColors > 100 && evidence.lumaDeviation > 7,
    `${name}: globe pixels must be real varied map imagery, not a flat colour`,
  );
}
async function center(selector) {
  const box = await locator(selector).first().boundingBox();
  assert.ok(box, `${selector} has a box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function insideViewport(selector, viewport) {
  for (const box of await locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        id: el.dataset.cityPlayAction ?? el.className,
      };
    }),
  )) {
    assert.ok(
      box.left >= -1 &&
        box.top >= -1 &&
        box.right <= viewport.width + 1 &&
        box.bottom <= viewport.height + 1,
      `${selector} ${box.id} must be fully on screen: ${JSON.stringify(box)}`,
    );
  }
}
function rectOf(points) {
  const list = (points ?? []).filter(Boolean);
  if (list.length < 2) return null;
  const xs = list.map((p) => p.x);
  const ys = list.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}
function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}
function gapBetween(a, b) {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}
// Map attribution (Google/Cesium/Esri) must stay readable: nothing may cover it.
async function clearOfCredits(selector) {
  const hits = await page.evaluate((sel) => {
    const c = document
      .querySelector('#cesium-credits .cesium-widget-credits')
      ?.getBoundingClientRect();
    if (!c?.width) return ['no visible map credits'];
    return [...document.querySelectorAll(sel)]
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(
        ([, r]) =>
          r.width &&
          Math.min(r.right, c.right) > Math.max(r.left, c.left) &&
          Math.min(r.bottom, c.bottom) > Math.max(r.top, c.top),
      )
      .map(([el]) => el.className || el.tagName);
  }, selector);
  assert.deepEqual(hits, [], `${selector} must stay clear of the map credits`);
}
// Every visible play-mode label: 4.5:1 over its glass on a white backdrop
// (a bright roof), and caps labels at 12 px or more. Disabled controls are exempt.
async function legibility(label) {
  const texts = await page.evaluate(() => {
    const root = document.querySelector('[data-city-play]');
    const gradient = (image) => {
      const stops = image.match(/(rgba?\([^)]*\)|color\([^)]*\))/g);
      return stops && new Set(stops).size === 1 ? stops[0] : null;
    };
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (!own || el.closest('button:disabled, [aria-hidden="true"]')) continue;
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || style.visibility !== 'visible') continue;
      const layers = [];
      for (
        let node = el;
        node && node !== root.parentElement;
        node = node.parentElement
      ) {
        const cs = getComputedStyle(node);
        const g = cs.backgroundImage.startsWith('linear-gradient')
          ? gradient(cs.backgroundImage)
          : null;
        layers.unshift(...[cs.backgroundColor, g].filter(Boolean));
      }
      const letters = own.replace(/[^\p{L}]/gu, '');
      out.push({
        text: own.slice(0, 48),
        color: style.color,
        fontSize: parseFloat(style.fontSize),
        caps:
          style.textTransform === 'uppercase' ||
          (letters.length > 1 && letters === letters.toUpperCase()),
        layers,
      });
    }
    return out;
  });
  const results = texts.map((t) => ({ ...t, ...textLegibility(t) }));
  const failures = results
    .filter((r) => !r.ok)
    .map(({ text, ratio, fontSize, reason, color, layers }) => ({
      text,
      ratio,
      fontSize,
      reason,
      color,
      layers,
    }));
  (report.measurements.legibility ??= {})[label] = {
    labels: results.length,
    minRatio: Math.min(...results.map((r) => r.ratio)),
    minFontPx: Math.min(...results.map((r) => r.fontSize)),
    failures,
  };
  assert.ok(results.length > 0, `${label}: labels audited`);
  assert.deepEqual(failures, [], `${label}: every label is legible`);
}
// No tag may sit across a wheel button.
async function noOverlap(a, b) {
  const hits = await page.evaluate(
    ([sa, sb]) => {
      const boxes = (sel) =>
        [...document.querySelectorAll(sel)]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width && r.height);
      const out = [];
      for (const r of boxes(sa))
        for (const q of boxes(sb))
          if (
            Math.min(r.right, q.right) > Math.max(r.left, q.left) &&
            Math.min(r.bottom, q.bottom) > Math.max(r.top, q.top)
          )
            out.push([
              Math.round(r.left),
              Math.round(r.top),
              Math.round(q.left),
              Math.round(q.top),
            ]);
      return out;
    },
    [a, b],
  );
  assert.deepEqual(hits, [], `${a} must not overlap ${b}`);
}
async function legend() {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-city-play-legend-row]')].map(
        (row) => [
          row.dataset.cityPlayLegendRow,
          ['plots', 'area', 'share'].map(
            (k) => row.querySelector(`[data-legend-${k}]`).textContent,
          ),
        ],
      ),
    ),
  );
}
async function pickUse(use) {
  await locator(`[data-city-play-action="${use}"]`).click();
  await until(
    (u) =>
      document
        .querySelector(`[data-city-play-action="${u}"]`)
        ?.getAttribute('aria-pressed') === 'true',
    `${use} saved for the plot`,
    20000,
    use,
  );
}
async function clickGlobe(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await until(
    () => window.__gevCityPlay?.snapshot().plot,
    'a plot is selected',
    20000,
  );
}
async function mapPoint(viewport) {
  // The middle of the free map area: walk up from 52 % height past any overlay.
  return page.evaluate(({ width, height }) => {
    const canvas = document.querySelector('#cesiumContainer canvas');
    const x = Math.round(width / 2);
    for (let y = Math.round(height * 0.52); y > 140; y -= 12) {
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return { x, y: Math.round(height * 0.4) };
  }, viewport);
}
async function selectPlotWithWheel(viewport) {
  // Click the free map; the wheel must follow the plot.
  const at = await mapPoint(viewport);
  await clickGlobe(at.x, at.y);
  // A far click swoops the camera in; measure the wheel once the flight lands.
  await until(
    () => !window.__godsEyeView.viewer.camera._currentFlight,
    'camera framed the plot',
    30000,
  );
  await page.waitForTimeout(300);
  // From the district view the plot click flies in before the wheel opens.
  await locator(S.ring).waitFor({ state: 'visible', timeout: 30000 });
  await until(
    () => window.__gevCityPlay.snapshot().anchors?.plot,
    'plot projected',
    20000,
  );
}
/**
 * Where a plot stands on screen now: its centre, `lift` metres above the
 * ground (a standing concept is a 32 m card across that centre, so a lift
 * inside it lands on the card, which the app selects by plot identity).
 */
async function plotOnScreen(plot, lift = 0) {
  const at = await page.evaluate(
    ({ center, lift }) => {
      const { viewer } = window.__godsEyeView;
      const Cartographic = viewer.camera.positionCartographic.constructor;
      const Cartesian3 = viewer.camera.position.constructor;
      const ground =
        viewer.scene.globe.getHeight(
          Cartographic.fromDegrees(center.lon, center.lat),
        ) ?? 0;
      const point = viewer.scene.cartesianToCanvasCoordinates(
        Cartesian3.fromDegrees(center.lon, center.lat, ground + lift),
      );
      return point ? { x: point.x, y: point.y } : null;
    },
    { center: plot.center, lift },
  );
  assert.ok(at, `${plot.id} projects on screen`);
  return at;
}
async function reopenWheel() {
  // A landed concept closes the wheel; clicking the plot brings it back.
  if (await locator(S.ring).isVisible()) return;
  const at = (await probe()).anchors?.plot;
  assert.ok(at, 'selected plot is projected on screen');
  await page.mouse.click(at.x, at.y);
  await locator(S.ring).waitFor({ state: 'visible', timeout: 20000 });
}
async function reimagine(action, alternativeId) {
  await locator(`[data-city-play-action="${action}"]`).click();
  await until(
    (id) => {
      const s = window.__gevCityPlay.snapshot();
      return !s.framing && !s.pending && s.concepts.includes(id);
    },
    `${alternativeId} concept stands on the plot`,
    90000,
    alternativeId,
  );
  await locator(`[data-city-play-card="${alternativeId}"] img`).waitFor({
    state: 'visible',
  });
}
async function wheelZoom(target, deltaY, maxSteps = 60) {
  const box = await locator('#cesiumContainer canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
  for (let i = 0; i < maxSteps; i++) {
    if ((await probe()).tier === target) return i;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(250);
  }
  return (await probe()).tier === target ? maxSteps : -1;
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
  page = await openPage(context, 'journey');
  // Fixture only: any concept network request is a regression. --real allows one.
  let allowOne = false;
  await context.route('**/api/city-concept*', async (route) => {
    if (real && allowOne && route.request().method() === 'POST') {
      allowOne = false;
      report.realConceptRequests = (report.realConceptRequests ?? 0) + 1;
      await route.continue();
      return;
    }
    report.forbiddenConceptRequests.push({ phase, url: route.request().url() });
    await route.abort('blockedbyclient');
  });
  if (real) {
    await check(
      'One real local-bridge concept stands on the plot',
      async () => {
        await startup();
        await pixelEvidence('startupGlobe');
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        await locator('[data-city-play-records="bar"]').click();
        await locator(S.dialog).waitFor({ state: 'visible' });
        await locator('#city-builder-provider').selectOption('local');
        await locator('[data-city-builder-remote-notice]').waitFor({
          state: 'visible',
        });
        await screenshot('r01-provider-disclosed');
        await locator('[data-planning-cancel]').click();
        await locator(S.dialog).waitFor({ state: 'detached' });
        await selectPlotWithWheel(DESKTOP);
        await screenshot('r02-plot-wheel');
        allowOne = true;
        await locator('[data-city-play-action="park"]').click();
        await until(
          () => {
            const s = window.__gevCityPlay.snapshot();
            return (
              !s.framing &&
              !s.pending &&
              (s.concepts.length > 0 ||
                document.querySelector('[data-city-play-error]'))
            );
          },
          'real concept generated or failed visibly',
          420000,
        );
        const doc = await persisted();
        const concept = doc?.alternatives?.[0]?.versions?.[0]?.concept;
        report.realConcept = concept && {
          provider: concept.provider,
          chars: concept.image.length,
          generatedAt: concept.generatedAt,
        };
        assert.equal(
          concept?.provider,
          'chatgpt-subscription/comfyui-codex-image',
          'real provider recorded',
        );
        await page.waitForTimeout(7000); // a real ~460 KB concept texture needs time to upload
        await screenshot('r03-real-concept-in-world');
        await reopenWheel();
        await locator('[data-city-play-action="inspect"]').click();
        await until(
          () => window.__gevCityPlay.snapshot().tier === 'detail',
          'detail tier',
          30000,
        );
        await page.waitForTimeout(1500);
        await screenshot('r04-real-concept-detail');
        assert.equal(report.realConceptRequests, 1, 'exactly one real request');
        assert.deepEqual(report.forbiddenConceptRequests, []);
      },
    );
    report.status = 'pass';
  }

  if (!real) {
    await check(
      'Real globe loads at the site with real map pixels',
      async () => {
        await startup();
        await pixelEvidence('startupGlobe');
        assert.equal(
          await page.evaluate((k) => localStorage.getItem(k), KEY),
          null,
        );
        await screenshot('01-hud');
      },
    );

    await check(
      'City builder pill enters play mode: rails collapse, resource bar shows unknowns',
      async () => {
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        assert.equal(
          await locator(S.pill).getAttribute('aria-pressed'),
          'true',
        );
        const s = await probe();
        assert.equal(s.active, true);
        assert.equal(s.bodyClass, true);
        await until(
          () =>
            getComputedStyle(document.querySelector('#left-panel-stack'))
              .visibility === 'hidden',
          'left rail collapsed',
          5000,
        );
        const values = await locator(
          '[data-city-play-stat] .city-play-stat-value',
        ).allInnerTexts();
        assert.deepEqual(
          values,
          [],
          'no project: missing is never zero and never a dash',
        );
        await locator('[data-city-play-hint]').waitFor({ state: 'visible' });
        await legibility('bar-hint');
        await screenshot('02-play-mode');
      },
    );

    await check(
      'Clicking the globe selects a plot; the wheel is anchored within 40 px',
      async () => {
        await page.mouse.move(DESKTOP.width * 0.4, DESKTOP.height * 0.45);
        await page.waitForTimeout(400);
        await selectPlotWithWheel(DESKTOP);
        const s = await probe();
        assert.equal(s.footprint, true, 'footprint entity drawn on the globe');
        const wheel = await center(S.ring);
        const d = Math.hypot(
          wheel.x - s.anchors.plot.x,
          wheel.y - s.anchors.plot.y,
        );
        report.measurements.wheelOffsetPx = d;
        assert.ok(
          d <= 40,
          `wheel centre ${JSON.stringify(wheel)} within 40 px of plot ${JSON.stringify(s.anchors.plot)} (${d.toFixed(1)} px)`,
        );
        assert.deepEqual(
          await locator('[data-city-play-action]').evaluateAll((els) =>
            els.map((e) => e.dataset.cityPlayAction),
          ),
          ['reimagine', 'park', 'plaza', 'bike-lane', 'zone', 'inspect'],
        );
        await locator('[data-city-play-tag]').waitFor({ state: 'visible' });
        assert.match(
          await locator('[data-city-play-tag] strong').textContent(),
          /^Plot · 1,600 m²$/,
          'the plot tag names the plot by its area, never by a grid code',
        );
        await insideViewport('[data-city-play-action]', DESKTOP);
        await clearOfCredits(
          '[data-city-play-wheel] button, [data-city-play-tag]',
        );
        await legibility('wheel-tag');
        await noOverlap(
          '[data-city-play-tag]',
          '[data-city-play-wheel] button',
        );
        await pixelEvidence('plotSelectedGlobe');
        await screenshot('03-plot-wheel');
      },
    );

    let plotId;
    await check(
      'REIMAGINE frames the plot, saves a sited alternative and stands its concept in the world',
      async () => {
        plotId = (await probe()).plot.id;
        await reimagine('reimagine', 'world-1');
        assert.equal(
          await locator(S.wheel).count(),
          0,
          'the concept takes the stage',
        );
        await locator('[data-city-play-holo-tag]').waitFor({
          state: 'visible',
        });
        assert.match(
          await locator('[data-city-play-holo-tag]').textContent(),
          /^Plot · 1,600 m²\s*Reimagined$/,
          'the reimagined tag names the plot by its area, never by a grid code',
        );
        const doc = await persisted();
        assert.equal(doc.alternatives.length, 1);
        assert.equal(doc.alternatives[0].site.plot.id, plotId);
        assert.equal(
          doc.alternatives[0].versions[0].concept.provider,
          'fixture',
        );
        assert.equal(
          doc.alternatives[0].versions[0].concept.label,
          'AI concept, not a plan or an approval',
        );
        assert.match(
          await locator('[data-city-play-ai-label]').innerText(),
          /AI concept, not a plan or an approval/i,
        );
        await clearOfCredits(
          '[data-city-play-carousel], [data-city-play-holo-tag], [data-city-play-build]',
        );
        await legibility('carousel-holo-tag');
        // Grounded: the card stands on the plot with a contact band, and casts
        // a shadow away from the scene sun exactly when that sun is up.
        const ground = (await probe()).grounding['world-1'];
        report.measurements.grounding = ground;
        assert.ok(ground.baseGapMeters < 1, 'the concept stands on its plot');
        assert.equal(ground.contact, true, 'a contact shadow under the card');
        const sunUp = ground.sun?.elevationDeg > 2;
        assert.equal(ground.cast, sunUp, 'cast shadow iff the scene sun is up');
        if (sunUp)
          assert.ok(
            Math.abs(
              ground.shadowMeters -
                Math.min(
                  32 / Math.tan((ground.sun.elevationDeg * Math.PI) / 180),
                  80,
                ),
            ) < 0.01,
            'shadow length is h / tan(sun elevation), capped',
          );
        await page.waitForTimeout(1600);
        await tilesLoaded(30000);
        await pixelEvidence('reimaginedGlobe');
        await screenshot('04-reimagined');
        // Evidence only: a steeper look shows the shadow beyond the card, then
        // the camera returns to the reimagine frame.
        await page.evaluate(
          ({ lat, lon }) => {
            const v = window.__godsEyeView.viewer;
            const c = v.camera;
            window.__qaView = {
              destination: c.positionWC.clone(),
              orientation: { heading: c.heading, pitch: c.pitch, roll: c.roll },
            };
            c.setView({
              destination: v.scene.globe.ellipsoid.cartographicToCartesian({
                latitude: ((lat - 150 / 111_320) * Math.PI) / 180,
                longitude: (lon * Math.PI) / 180,
                height: 280,
              }),
              orientation: {
                heading: 0,
                pitch: (-62 * Math.PI) / 180,
                roll: 0,
              },
            });
          },
          (await probe()).plot.center,
        );
        await page.waitForTimeout(800);
        await tilesLoaded(30000).catch(() => {});
        await screenshot('04b-grounded-shadow');
        await page.evaluate(() => {
          window.__godsEyeView.viewer.camera.setView(window.__qaView);
          delete window.__qaView;
        });
        await page.waitForTimeout(400);
      },
    );

    await check(
      'REROLL saves version 2 with a new concept and closes the wheel',
      async () => {
        // Start with the wheel open: a landed concept must close it.
        await reopenWheel();
        await locator('[data-city-play-reroll]').click();
        await until(
          (key) =>
            JSON.parse(localStorage.getItem(key)).alternatives[0].versions
              .length === 2,
          'version 2 saved',
          60000,
          KEY,
        );
        await until(
          () => !window.__gevCityPlay.snapshot().pending,
          'reroll settled',
          60000,
        );
        const doc = await persisted();
        assert.ok(
          doc.alternatives[0].versions[1].concept,
          'version 2 has its concept',
        );
        assert.match(
          await locator('[data-city-play-card="world-1"]').innerText(),
          /2/,
        );
        // The card's figures are proposal estimates and say so.
        const chips = await locator(
          '[data-city-play-card="world-1"] [data-city-play-chip] strong',
        ).allInnerTexts();
        assert.equal(chips.length, 3);
        assert.ok(
          chips.every((text) => / EST$/.test(text)),
          `every card figure is labelled EST: ${chips.join(' | ')}`,
        );
        // The bar says what the focused world changes: a before → after from
        // the plan score's assumed baseline (a pocket park's canopy).
        assert.deepEqual(
          await locator(
            '[data-city-play-bar] [data-city-play-move] .city-play-stat-value',
          ).allInnerTexts(),
          ['18 → 60% EST'],
        );
        await until(
          () => !document.querySelector('[data-city-play-wheel]'),
          'the wheel closes once the reroll lands',
          10000,
        );
        await locator('[data-city-play-holo-tag]').waitFor({
          state: 'visible',
        });
        await page.waitForTimeout(1600); // the new version scans in over 1.4 s
        await screenshot('05-reroll-v2');
      },
    );

    await check(
      'ZONE: proposed land uses tint plots, and changing one changes the computed legend',
      async () => {
        await reopenWheel();
        const first = await probe();
        const firstAt = first.anchors.plot;
        const foot = rectOf(first.anchors.footprint);
        await locator('[data-city-play-action="zone"]').click();
        await locator('[data-city-play-legend]').waitFor({ state: 'visible' });
        assert.deepEqual(
          (await legend()).housing,
          ['0', '0 m²', '—'],
          'nothing zoned yet: share unknown, not zero',
        );
        await pickUse('housing');
        assert.deepEqual((await legend()).housing, ['1', '1,600 m²', '100%']);
        // A second plot east of the first, beyond the wheel's reach, on its near
        // half (clear of the standing card and the plot tag).
        const wheelBox = await locator(S.ring).boundingBox();
        await page.mouse.click(
          Math.max(
            foot.right + (foot.right - foot.left) * 0.75,
            wheelBox.x + wheelBox.width + 70,
          ),
          (firstAt.y + foot.bottom) / 2,
        );
        await until(
          (id) => window.__gevCityPlay.snapshot().plot?.id !== id,
          'a second plot is selected',
          20000,
          first.plot.id,
        );
        await locator('[data-city-play-action="zone"]').click();
        await pickUse('open-space');
        const before = await legend();
        assert.deepEqual(before.housing, ['1', '1,600 m²', '50%']);
        assert.deepEqual(before['open-space'], ['1', '1,600 m²', '50%']);
        await screenshot('05b-zoning-legend');
        // Change the first plot from housing to civic: the derived numbers move.
        // Reselect it where it stands now, on its own concept, not at the
        // coordinate saved before the second plot was selected.
        const again = await plotOnScreen(first.plot, 12);
        await page.mouse.click(again.x, again.y);
        await until(
          (id) => window.__gevCityPlay.snapshot().plot?.id === id,
          'the first plot is selected again',
          20000,
          first.plot.id,
        );
        await locator('[data-city-play-action="zone"]').click();
        await pickUse('civic');
        const after = await legend();
        report.measurements.zoning = { before, after };
        assert.deepEqual(after.housing, ['0', '0 m²', '0%']);
        assert.deepEqual(after.civic, ['1', '1,600 m²', '50%']);
        assert.notDeepEqual(
          after,
          before,
          'changing a zone changes the derived numbers',
        );
        const s = await probe();
        assert.deepEqual(s.zoning.map((z) => z.use).sort(), [
          'civic',
          'open-space',
        ]);
        assert.equal(s.zoneTints, 2, 'both zoned plots are tinted on the map');
        // Two plots in the plan now, one reimagined: the canopy chip is the
        // plan's figure weighted by land area ((60 + 18) / 2), not this plot's
        // 60 % against the plan's 18 %.
        assert.deepEqual(
          await locator(
            '[data-city-play-bar] [data-city-play-move] .city-play-stat-value',
          ).allInnerTexts(),
          ['18 → 39% EST'],
        );
        const doc = await persisted();
        assert.deepEqual(
          doc.zoning.map((z) => [z.plot.id, z.use]).sort(),
          s.zoning.map((z) => [z.plotId, z.use]).sort(),
          'saved in the project document',
        );
        await legibility('zoning-legend');
        await clearOfCredits('[data-city-play-legend]');
        await noOverlap(
          '[data-city-play-legend]',
          '[data-city-play-wheel] button',
        );
        await screenshot('05c-zoning-changed');
        await locator('[data-city-play-action="back"]').click();
        await locator('[data-city-play-action="inspect"]').waitFor({
          state: 'visible',
        });
        await page.mouse.move(DESKTOP.width - 40, DESKTOP.height / 2);
        assert.equal((await probe()).tier, 'plot', 'Back only closes the menu');
      },
    );

    await check(
      'Zoom in: INSPECT reaches the detail tier with callouts and a stats card',
      async () => {
        await reopenWheel();
        assert.equal(
          (await probe()).plot.id,
          plotId,
          'the same plot is selected again',
        );
        await locator('[data-city-play-action="inspect"]').click();
        await until(
          () => window.__gevCityPlay.snapshot().tier === 'detail',
          'detail tier',
          30000,
        );
        await locator('[data-city-play-callout] .city-play-callout-label')
          .first()
          .waitFor({ state: 'visible', timeout: 20000 });
        await locator('[data-city-play-stats]').waitFor({ state: 'visible' });
        report.measurements.detailCallouts = await locator(
          '[data-city-play-callout]',
        ).count();
        // The stats card is anchored beside the plot on a leader, not docked at
        // the screen edge, and covers neither the plot nor the map credits.
        await page.waitForTimeout(300);
        const placed = await page.evaluate(() => {
          const box = (el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
            };
          };
          const line = document.querySelector('[data-city-play-stats-leader]');
          return {
            card: box(document.querySelector('[data-city-play-stats]')),
            leader:
              line &&
              ['x1', 'y1', 'x2', 'y2'].map((k) => Number(line.getAttribute(k))),
          };
        });
        const foot = rectOf((await probe()).anchors.footprint);
        report.measurements.statsCard = { ...placed, footprint: foot };
        assert.ok(foot, 'footprint projected on screen');
        assert.ok(placed.leader, 'a leader line joins the card to the plot');
        const [x1, y1, x2, y2] = placed.leader;
        const { card } = placed;
        const onEdge =
          (Math.abs(x1 - card.left) < 1.5 || Math.abs(x1 - card.right) < 1.5) &&
          y1 >= card.top - 1.5 &&
          y1 <= card.bottom + 1.5;
        const onTopOrBottom =
          (Math.abs(y1 - card.top) < 1.5 || Math.abs(y1 - card.bottom) < 1.5) &&
          x1 >= card.left - 1.5 &&
          x1 <= card.right + 1.5;
        assert.ok(onEdge || onTopOrBottom, 'leader starts on the card edge');
        assert.ok(
          x2 >= foot.left - 1.5 &&
            x2 <= foot.right + 1.5 &&
            y2 >= foot.top - 1.5 &&
            y2 <= foot.bottom + 1.5,
          'leader ends on the plot footprint',
        );
        assert.ok(
          gapBetween(card, foot) <= 96,
          `card beside the plot (${gapBetween(card, foot).toFixed(0)} px away)`,
        );
        assert.equal(
          overlapArea(card, foot),
          0,
          'the card does not cover the plot',
        );
        await clearOfCredits(
          '[data-city-play-stats], [data-city-play-holo-tag], .city-play-callout-label',
        );
        await legibility('detail-stats-callouts');
        await tilesLoaded(30000);
        await screenshot('06-detail-callouts');
      },
    );

    await check(
      'Zoom out: the district tier shows a pin for the reimagined plot',
      async () => {
        const steps = await wheelZoom('district', 900);
        report.measurements.zoomOutWheelSteps = steps;
        if (steps < 0) {
          // Recorded, not hidden: fall back to a camera move if wheel input is too slow here.
          report.measurements.zoomOutFallback = 'camera.zoomOut';
          await page.evaluate(() =>
            window.__godsEyeView.viewer.camera.zoomOut(2500),
          );
          await until(
            () => window.__gevCityPlay.snapshot().tier === 'district',
            'district tier',
            20000,
          );
        }
        await locator(`[data-city-play-pin="${plotId}"]`).waitFor({
          state: 'visible',
          timeout: 20000,
        });
        await tilesLoaded(60000).catch(() => {});
        // District v0: the land-use legend and per-plot badges; walk access is
        // the existing estimate (unknown for play worlds), never recomputed.
        await locator('[data-city-play-legend]').waitFor({ state: 'visible' });
        const badges = await page.evaluate(() =>
          [...document.querySelectorAll('[data-city-play-pin]')].map((pin) => ({
            plot: pin.dataset.cityPlayPin,
            walk: pin
              .querySelector('[data-city-play-pin-walk]')
              ?.textContent.trim(),
            use:
              pin
                .querySelector('[data-city-play-pin-use]')
                ?.textContent.trim() ?? null,
          })),
        );
        report.measurements.districtBadges = badges;
        assert.ok(badges.length >= 2, 'a badge per reimagined or zoned plot');
        assert.ok(
          badges.every((b) => /—$/.test(b.walk)),
          'play worlds have no walk-access site: unknown, never 0',
        );
        await legibility('district-pins');
        await clearOfCredits('[data-city-play-legend], [data-city-play-pin]');
        await screenshot('07-district-pin');
      },
    );

    await check('Esc exits play mode and restores the HUD', async () => {
      await page.keyboard.press('Escape');
      await locator(S.play).waitFor({ state: 'detached' });
      const s = await probe();
      assert.equal(s.active, false);
      assert.equal(s.bodyClass, false);
      assert.equal(await locator(S.pill).getAttribute('aria-pressed'), 'false');
      await until(
        () =>
          getComputedStyle(document.querySelector('#left-panel-stack'))
            .visibility !== 'hidden',
        'left rail restored',
        5000,
      );
      await screenshot('08-exit-hud');
    });

    await check(
      'Project records drawer opens from the carousel with the same document',
      async () => {
        // Same page session: re-enter the mode and let any resume flight land.
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        await until(
          () => !window.__godsEyeView.viewer.camera._currentFlight,
          'camera settled after re-entering',
          30000,
        );
        await selectPlotWithWheel(DESKTOP);
        await reimagine('plaza', 'world-2');
        await locator('[data-city-play-records="carousel"]').click();
        await locator(S.dialog).waitFor({ state: 'visible' });
        assert.equal(
          await locator('[data-city-builder-alternative]').count(),
          2,
        );
        await screenshot('10-records-drawer');
        await locator('[data-planning-cancel]').click();
        await locator(S.dialog).waitFor({ state: 'detached' });
      },
    );

    if (!onlyDesktop) {
      await check(
        'Mobile 390x844: wheel and carousel adapt and every control is reachable',
        async () => {
          await page.setViewportSize(MOBILE);
          await page.waitForTimeout(800);
          await locator(S.play).waitFor({ state: 'visible' });
          await selectPlotWithWheel(MOBILE);
          await insideViewport('[data-city-play-action]', MOBILE);
          await insideViewport('[data-city-play-bar]', MOBILE);
          await legibility('mobile-wheel');
          await noOverlap(
            '[data-city-play-tag]',
            '[data-city-play-wheel] button',
          );
          await screenshot('11-mobile-wheel');
          await reimagine('park', 'world-3');
          await insideViewport(
            '[data-city-play-build], [data-city-play-reroll], [data-city-play-records="carousel"]',
            MOBILE,
          );
          await clearOfCredits('[data-city-play-carousel]');
          await legibility('mobile-carousel');
          const strip = await locator('.city-play-cards').evaluate((el) => ({
            w: el.clientWidth,
            sw: el.scrollWidth,
          }));
          report.measurements.mobileCarousel = strip;
          await locator('[data-city-play-build]').click();
          await locator('[data-city-play-card="world-3"].is-built').waitFor({
            state: 'visible',
          });
          await screenshot('12-mobile-carousel');
          await page.setViewportSize(DESKTOP);
        },
      );
    }

    await check(
      'A fresh page session restores the project, frames its latest concept and reselects its plot',
      async () => {
        // The journey page closes first: its recording never shows a reload splash.
        const before = await persisted();
        const latest = before.alternatives
          .filter((a) => a.site && a.versions.at(-1).concept)
          .map((a) => ({
            id: a.id,
            plotId: a.site.plot.id,
            at: Date.parse(a.versions.at(-1).concept.generatedAt),
          }))
          .reduce((best, a) => (a.at >= best.at ? a : best));
        const journey = page;
        await journey.close();
        page = await openPage(context, 'restore');
        await startup();
        assert.deepEqual(
          await persisted(),
          before,
          'storage round-trips intact',
        );
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        const stats = Object.fromEntries(
          await locator('[data-city-play-stat]').evaluateAll((els) =>
            els.map((e) => [
              e.dataset.cityPlayStat,
              e.querySelector('.city-play-stat-value').textContent,
            ]),
          ),
        );
        const plots = new Set(before.alternatives.map((a) => a.site?.plot.id));
        assert.equal(stats.plots, String(plots.size));
        assert.equal(stats.worlds, String(before.alternatives.length));
        assert.equal(
          stats.concepts,
          String(
            before.alternatives.filter((a) => a.versions.at(-1).concept).length,
          ),
        );
        assert.ok(
          !('walk' in stats),
          'play worlds have no walk-access site: the field is left off',
        );
        // Proposal sums and means are estimates and say so; counts are exact.
        assert.match(stats.trees, /^\d+ EST$/);
        assert.match(stats.shade, /^~?\d+% EST$/);
        assert.doesNotMatch(
          `${stats.plots} ${stats.worlds} ${stats.concepts}`,
          /EST|~/,
        );
        assert.equal(
          (await probe()).zoning.length,
          (before.zoning ?? []).length,
          'proposed land uses restored',
        );
        // The restored concept must be on screen, not just counted.
        await until(
          ({ id, plotId }) => {
            const s = window.__gevCityPlay.snapshot();
            return (
              s.plot?.id === plotId &&
              s.concepts.includes(id) &&
              !window.__godsEyeView.viewer.camera._currentFlight
            );
          },
          'restored plot framed with its concept',
          30000,
          latest,
        );
        await tilesLoaded(60000).catch(() => {});
        await page.waitForTimeout(600);
        await locator('[data-city-play-holo-tag]').waitFor({
          state: 'visible',
        });
        await locator(`[data-city-play-card="${latest.id}"] img`).waitFor({
          state: 'visible',
        });
        await insideViewport(
          `[data-city-play-holo-tag], [data-city-play-card="${latest.id}"]`,
          DESKTOP,
        );
        const s = await probe();
        for (const [name, p] of Object.entries({
          plot: s.anchors?.plot,
          concept: s.anchors?.holo,
        }))
          assert.ok(
            p &&
              p.x >= 0 &&
              p.y >= 0 &&
              p.x <= DESKTOP.width &&
              p.y <= DESKTOP.height,
            `restored ${name} projects inside the viewport: ${JSON.stringify(p)}`,
          );
        assert.equal(
          await page.evaluate(
            ({ x, y }) =>
              document.elementFromPoint(x, y) ===
              document.querySelector('#cesiumContainer canvas'),
            s.anchors.plot,
          ),
          true,
          'no HUD panel covers the restored plot',
        );
        report.measurements.restoredInView = {
          alternative: latest.id,
          plot: s.anchors.plot,
          concept: s.anchors.holo,
          tier: s.tier,
          range: Math.round(s.range),
        };
        await screenshot('09-reload-restored');
        // Reselect: clicking the restored plot brings back its anchored wheel.
        await reopenWheel();
        const again = await probe();
        const ring = await center(S.ring);
        assert.equal(
          again.plot.id,
          latest.plotId,
          'the restored plot is reselected',
        );
        const offset = Math.hypot(
          ring.x - again.anchors.plot.x,
          ring.y - again.anchors.plot.y,
        );
        // Above the carousel the wheel may be clamped; then a tether joins it to the plot.
        const tethered = await page.evaluate(
          ({ x, y }) =>
            [...document.querySelectorAll('.city-play-tether-dim')].some(
              (l) =>
                Math.abs(Number(l.getAttribute('x2')) - x) < 2 &&
                Math.abs(Number(l.getAttribute('y2')) - y) < 2,
            ),
          again.anchors.plot,
        );
        report.measurements.reselectWheel = { offset, tethered };
        assert.ok(
          offset <= 40 || tethered,
          `the wheel is anchored (${offset.toFixed(0)} px) or tethered to the reselected plot`,
        );
        await screenshot('09b-reselect-wheel');
      },
    );

    await check(
      'The bar states the walk-access estimate once the focused world has a walk-access site',
      async () => {
        const bar = () =>
          locator('[data-city-play-stat]').evaluateAll((els) =>
            Object.fromEntries(
              els.map((e) => [
                e.dataset.cityPlayStat,
                e.querySelector('.city-play-stat-value').textContent,
              ]),
            ),
          );
        assert.ok(!('walk' in (await bar())), 'no site yet: no figure');
        const id = await locator(
          '[data-city-play-card][aria-pressed="true"]',
        ).getAttribute('data-city-play-card');
        // A walk-access site is chosen in the project records, never in play.
        await locator('[data-city-play-records="bar"]').click();
        await locator(S.dialog).waitFor({ state: 'visible' });
        await locator(
          `[data-city-builder-alternative="${id}"] [data-city-builder-edit]`,
        ).click();
        await locator('#city-builder-site').selectOption('site-a');
        await locator('[data-city-builder-save]').click();
        await until(
          ({ id, key }) =>
            JSON.parse(localStorage.getItem(key))
              .alternatives.find((a) => a.id === id)
              .versions.at(-1).parameters.site === 'site-a',
          'the site is saved',
          10000,
          { id, key: KEY },
        );
        await locator('[data-planning-cancel]').click();
        await locator(S.dialog).waitFor({ state: 'detached' });
        await locator('[data-city-play-stat="walk"]').waitFor({
          state: 'visible',
        });
        // Site A of the offline sample network: a mean of 298.33 m.
        assert.equal((await bar()).walk, '~300 m EST');
        await insideViewport(S.bar, DESKTOP);
        await legibility('bar-walk');
        await screenshot('13-bar-walk-access');
      },
    );

    await check(
      'No concept network calls, page errors, console errors or Vue warnings',
      async () => {
        assert.deepEqual(report.forbiddenConceptRequests, []);
        assert.deepEqual(report.pageErrors, []);
        const noise =
          /Failed to load resource|net::ERR_|NetworkError|Failed to fetch|\[Data:(?:Flights|Satellites|Ships|CCTV)\]/i;
        const errors = report.console.filter(
          (e) =>
            /\[Vue warn\]|vue warn|Unhandled error during execution/i.test(
              e.text,
            ) ||
            (e.type === 'error' && !noise.test(e.text)),
        );
        report.unexpectedErrors = errors;
        assert.deepEqual(
          errors,
          [],
          'unexpected browser errors; see summary.json',
        );
      },
    );
  }
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${error.stack || error}`);
  if (page && !page.isClosed()) {
    try {
      await screenshot('failure');
      report.failure.probe = await probe();
    } catch (e) {
      report.failure.screenshotError = String(e);
    }
  }
} finally {
  if (browser)
    await browser.close().catch((e) => (report.cleanupError = String(e)));
  if (videoDir) {
    // Playwright writes .webm; keep it and add an .mp4 named for its page
    // (journey: the one recorded session; restore: the fresh page).
    const roles = new Map();
    for (const [role, pending] of Object.entries(videos))
      roles.set(await pending.catch(() => null), role);
    report.video = [];
    for (const name of (await readdir(videoDir).catch(() => [])).filter((n) =>
      n.endsWith('.webm'),
    )) {
      const webm = path.join(videoDir, name);
      const role = roles.get(webm) ?? null;
      const mp4 = path.join(
        videoDir,
        `${role ?? name.replace(/\.webm$/, '')}.mp4`,
      );
      const r = spawnSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        webm,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        mp4,
      ]);
      report.video.push({
        role,
        webm,
        mp4: r.status === 0 ? mp4 : null,
        ffmpeg: r.status,
      });
    }
  }
  report.finishedAt = new Date().toISOString();
  await json('summary.json', report);
  console.log(
    `${report.status.toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} assertions; report ${path.join(output, 'summary.json')}`,
  );
}
