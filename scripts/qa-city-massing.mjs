#!/usr/bin/env node
// City builder massing v0 journey (behind ?massing=1). The parent starts the
// app; this script owns only its headless browser and output files (same
// conventions as qa-city-play.mjs, which stays the flag-off journey).
// node scripts/qa-city-massing.mjs [--url http://127.0.0.1:4187]
// QA_SHOTS_DIR defaults to qa-shots/city-massing. QA_VIDEO_DIR records .webm
// and, when ffmpeg is on PATH, an .mp4 named for its page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { textLegibility } from '../src/ui/legibility.js';

const args = process.argv.slice(2);
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const output = path.resolve(
  process.env.QA_SHOTS_DIR || 'qa-shots/city-massing',
);
const videoDir =
  process.env.QA_VIDEO_DIR && path.resolve(process.env.QA_VIDEO_DIR);
// Camera south of Washington Square, San Francisco, looking north at 45°.
const SITE = { lat: 37.7953, lon: -122.4103, alt: 600, heading: 0, pitch: -45 };
// A morning sun in the east (az 78°, el 23°): the block's shadow falls west,
// through the free gap left of the play wheel.
const SUN_TIME = '2026-06-21T15:00:00Z';
const DESKTOP = { width: 1440, height: 900 };
const KEY = 'godsEyeView.cityBuilder.v1';
// What the readout must never cover: the wheel, the plot tag, the resource bar,
// the map credits and the docks.
const HUD = [
  '[data-city-play-action]',
  '[data-city-play-tag]',
  '[data-city-play-bar]',
  '#cesium-credits .cesium-widget-credits',
  '#command-dock',
  '#mobile-tab-bar',
];
const S = {
  pill: '#top-center-actions [data-city-builder-open]',
  play: '[data-city-play]',
  ring: '[data-city-play-wheel] .city-play-wheel-ring',
  readout: '[data-city-massing]',
  toggle: '[data-city-massing-toggle]',
  plus: '[data-city-massing-step="1"]',
};
const report = {
  startedAt: new Date().toISOString(),
  base,
  site: SITE,
  sunTime: SUN_TIME,
  output,
  assertions: [],
  screenshots: [],
  console: [],
  pageErrors: [],
  measurements: {},
};
let browser;
let page;
let phase = 'launch';
const videos = {};
const locator = (selector) => page.locator(selector);
const massing = () => page.evaluate(() => window.__gevCityMassing?.snapshot());
const play = () => page.evaluate(() => window.__gevCityPlay?.snapshot());
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);

async function openPage(context, role) {
  const next = await context.newPage();
  next.setDefaultTimeout(20000);
  next.on('console', (m) =>
    report.console.push({ phase, type: m.type(), text: m.text() }),
  );
  next.on('pageerror', (e) =>
    report.pageErrors.push({ phase, message: e.message, stack: e.stack }),
  );
  if (next.video()) videos[role] = next.video().path();
  return next;
}
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
function siteUrl(flag) {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  if (flag) url.searchParams.set('massing', '1');
  url.hash = new URLSearchParams({
    v: '2',
    ...Object.fromEntries(Object.entries(SITE).map(([k, v]) => [k, `${v}`])),
    roll: '0',
    style: 'normal',
  }).toString();
  return url.href;
}
async function startup(flag) {
  await page.goto(siteUrl(flag), {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
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
// The page's one world clock (src/time/worldClock.js) drives the scene sun.
async function setSun(iso) {
  await page.evaluate(async (ms) => {
    const { worldClock } = await import('/src/time/worldClock.js');
    worldClock.seek(ms);
    window.__godsEyeView.requestRender?.('qa-sun');
  }, Date.parse(iso));
  await until(
    (ms) => {
      const { viewer } = window.__godsEyeView;
      const t = viewer.clock.currentTime;
      const at = (t.dayNumber - 2440587.5) * 86400000 + t.secondsOfDay * 1000;
      return Math.abs(at - ms) < 60000;
    },
    'scene clock at the pinned sun time',
    20000,
    Date.parse(iso),
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
async function selectPlot(viewport) {
  const at = await mapPoint(viewport);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await until(() => window.__gevCityPlay?.snapshot().plot, 'a plot', 20000);
  await until(
    () => !window.__godsEyeView.viewer.camera._currentFlight,
    'camera framed the plot',
    30000,
  );
  await locator(S.ring).waitFor({ state: 'visible', timeout: 30000 });
}
async function massingShown(plotId) {
  await until(
    (id) => {
      const s = window.__gevCityMassing?.snapshot();
      return s?.shown && s.plotId === id && s.sampled;
    },
    `massing stands on ${plotId}`,
    30000,
    plotId,
  );
  // Let the extruded geometry and its shadow map build.
  await page.waitForTimeout(3000);
}
// Ground at the plot centre as the map shows it, without massing or play entities.
async function groundAtCentre() {
  return page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    const { center } = window.__gevCityPlay.snapshot().plot;
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (name) => viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
    );
    const at = {
      longitude: (center.lon * Math.PI) / 180,
      latitude: (center.lat * Math.PI) / 180,
      height: 0,
    };
    const sampled = viewer.scene.sampleHeight(at, exclude);
    return Number.isFinite(sampled)
      ? sampled
      : viewer.scene.globe.getHeight(at);
  });
}
// Canvas luminance at ground points inside the cast shadow and on the sun side,
// with the scene's shadow map on and then off. A cast shadow darkens only the
// shadow side; a dark edge band or a global dimming would not pass.
async function shadowEvidence(label) {
  const points = await page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    const scene = viewer.scene;
    const s = window.__gevCityMassing.snapshot();
    const fp = s.massing.footprint;
    const lon0 = fp.reduce((a, [x]) => a + x, 0) / fp.length;
    const lat0 = fp.reduce((a, [, y]) => a + y, 0) / fp.length;
    const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const half = Math.max(...fp.map(([x]) => Math.abs(x - lon0) * kx));
    const az = (s.sun.azimuthDeg * Math.PI) / 180;
    const length =
      s.massing.heightMeters / Math.tan((s.sun.elevationDeg * Math.PI) / 180);
    const canvas = scene.canvas.getBoundingClientRect();
    const at = (east, north) => {
      const lon = lon0 + east / kx;
      const lat = lat0 + north / 111_320;
      const world = scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (lon * Math.PI) / 180,
        latitude: (lat * Math.PI) / 180,
        height: s.base,
      });
      const p = scene.cartesianToCanvasCoordinates(world);
      if (!p) return null;
      const x = Math.round(p.x + canvas.left);
      const y = Math.round(p.y + canvas.top);
      const hit = scene.pick({ x: p.x, y: p.y });
      const visible =
        document.elementFromPoint(x, y) === scene.canvas &&
        hit?.id?.id !== 'city-massing-block';
      return visible ? { x, y, east, north } : null;
    };
    // Away from the sun the shadow runs `length` beyond the block's face.
    const shade = [0.3, 0.45, 0.6]
      .map((f) => half + f * length)
      .map((d) => at(-Math.sin(az) * d, -Math.cos(az) * d))
      .filter(Boolean);
    const lit = [0.3, 0.45, 0.6]
      .map((f) => half + f * length)
      .map((d) => at(Math.sin(az) * d, Math.cos(az) * d))
      .filter(Boolean);
    return { shade, lit, lengthMeters: length, halfMeters: half };
  });
  assert.ok(points.shade.length, `${label}: a shadow point is on screen`);
  assert.ok(points.lit.length, `${label}: a sun-side point is on screen`);
  const luma = async () => {
    const shot = await page.screenshot();
    const { data, info } = await sharp(shot)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mean = ({ x, y }) => {
      let sum = 0;
      let n = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const i = ((y + dy) * info.width + (x + dx)) * info.channels;
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          n++;
        }
      return sum / n;
    };
    return {
      shade: points.shade.map(mean),
      lit: points.lit.map(mean),
    };
  };
  const frames = async () => {
    await page.evaluate(() => window.__godsEyeView.requestRender?.('qa'));
    await page.waitForTimeout(1200);
  };
  const on = await luma();
  await page.evaluate(() => {
    window.__godsEyeView.viewer.shadows = false;
  });
  await frames();
  const off = await luma();
  await page.evaluate(() => {
    window.__godsEyeView.viewer.shadows = true;
  });
  await frames();
  const ratio = (a, b) =>
    a.reduce((s, v) => s + v, 0) / b.reduce((s, v) => s + v, 0);
  const evidence = {
    ...points,
    shadeRatio: ratio(on.shade, off.shade),
    litRatio: ratio(on.lit, off.lit),
    on,
    off,
  };
  report.measurements[label] = evidence;
  assert.ok(
    evidence.shadeRatio < 0.8,
    `${label}: the ground in the cast shadow is darker with the sun's shadow map (${evidence.shadeRatio.toFixed(2)})`,
  );
  assert.ok(
    evidence.litRatio > 0.9,
    `${label}: the sun side is not darkened (${evidence.litRatio.toFixed(2)})`,
  );
  return evidence;
}

// The readout's values by row, as a user reads them.
async function readout() {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-city-massing-row]')].map((row) => [
        row.dataset.cityMassingRow,
        row.querySelector('[data-city-massing-value]').textContent.trim(),
      ]),
    ),
  );
}
// What the readout must show for the block the globe owner stands (en-US).
const shows = (s) => ({
  height: `${Number(s.massing.heightMeters.toFixed(1))} m`,
  storeys: String(s.storeys),
  far: s.massing.far.toFixed(2),
  floor: `${Math.round(s.massing.floorAreaSquareMeters).toLocaleString('en-US')} m²`,
});
const storage = () => page.evaluate(() => ({ ...localStorage }));
async function massingOn(plotId) {
  await locator(S.toggle).click();
  await massingShown(plotId);
  await locator('[data-city-massing-rows]').waitFor({ state: 'visible' });
}
async function insideViewport(selector, viewport) {
  for (const box of await locator(selector).evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON()),
  ))
    assert.ok(
      box.left >= -1 &&
        box.top >= -1 &&
        box.right <= viewport.width + 1 &&
        box.bottom <= viewport.height + 1,
      `${selector} must be fully on screen: ${JSON.stringify(box)}`,
    );
}
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
            out.push([Math.round(q.left), Math.round(q.top)]);
      return out;
    },
    [a, b],
  );
  assert.deepEqual(hits, [], `${a} must not overlap ${b}`);
}
// Every visible readout label: 4.5:1 over its glass on a white backdrop (a
// bright roof) and caps at 12 px or more, as qa-city-play audits play mode.
async function legibility(label) {
  const texts = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
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
  }, S.readout);
  const results = texts.map((t) => ({ ...t, ...textLegibility(t) }));
  const failures = results.filter((r) => !r.ok);
  (report.measurements.legibility ??= {})[label] = {
    labels: results.length,
    minRatio: Math.min(...results.map((r) => r.ratio)),
    minFontPx: Math.min(...results.map((r) => r.fontSize)),
    failures,
  };
  assert.ok(results.length > 0, `${label}: labels audited`);
  assert.deepEqual(failures, [], `${label}: every label is legible`);
}
// The readout covers neither the block nor the ground its shadow falls on.
async function clearOfMassing(shadow) {
  const covered = await page.evaluate((points) => {
    const r = document
      .querySelector('[data-city-massing]')
      .getBoundingClientRect();
    const { viewer } = window.__godsEyeView;
    const scene = viewer.scene;
    const s = window.__gevCityMassing.snapshot();
    const canvas = scene.canvas.getBoundingClientRect();
    const corners = [s.base, s.blockTop].flatMap((height) =>
      s.massing.footprint.map(([lon, lat]) => {
        const p = scene.cartesianToCanvasCoordinates(
          scene.globe.ellipsoid.cartographicToCartesian({
            longitude: (lon * Math.PI) / 180,
            latitude: (lat * Math.PI) / 180,
            height,
          }),
        );
        return p && { x: p.x + canvas.left, y: p.y + canvas.top };
      }),
    );
    return [...corners.filter(Boolean), ...points].filter(
      (p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
    );
  }, shadow.shade);
  assert.deepEqual(
    covered,
    [],
    'the readout covers no block corner or shadow point',
  );
}
async function zonePlot(use) {
  await locator('[data-city-play-action="zone"]').click();
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
  // Massing makes no network requests of its own; concepts stay fixture-only.
  await context.route('**/api/city-concept*', (route) =>
    route.abort('blockedbyclient'),
  );
  page = await openPage(context, 'journey');

  let plotId = null;
  let doc = null;
  let shadow6 = null;
  await check(
    'With ?massing=1 a selected plot offers one MASSING toggle; zoning saves as before',
    async () => {
      await startup(true);
      await setSun(SUN_TIME);
      await locator(S.pill).click();
      await locator(S.play).waitFor({ state: 'visible' });
      await selectPlot(DESKTOP);
      plotId = (await play()).plot.id;
      await locator(S.readout).waitFor({ state: 'visible' });
      assert.equal(await locator(`${S.readout} button`).count(), 1);
      assert.equal(
        await locator(S.toggle).getAttribute('aria-pressed'),
        'false',
      );
      assert.equal(
        (await massing()).shown,
        false,
        'massing waits for the toggle',
      );
      // A saved document to compare with: the plot's proposed land use.
      await zonePlot('housing');
      const area = await locator(
        '[data-city-play-legend-row="housing"] [data-legend-area]',
      ).textContent();
      const plotArea = (await massing()).massing?.plotAreaSquareMeters;
      report.measurements.legendArea = { legend: area, plotId };
      assert.equal(
        area.trim(),
        '1,600 m²',
        'the zoning legend shows the 1,600 m² cell',
      );
      await locator('[data-city-play-action="back"]').click();
      doc = (await storage())[KEY];
      assert.ok(doc, 'the zoned plot is saved');
      assert.equal(
        plotArea,
        undefined,
        'nothing computed before massing is on',
      );
      await screenshot('01-plot-massing-toggle');
    },
  );

  await check(
    'MASSING on: a ground plate and a block on the sampled ground',
    async () => {
      await massingOn(plotId);
      const s = await massing();
      const ground = await groundAtCentre();
      report.measurements.grounding = {
        plotId,
        base: s.base,
        sampleHeight: ground,
        plateTop: s.plateTop,
        blockTop: s.blockTop,
      };
      assert.ok(
        Math.abs(s.base - ground) <= 0.5,
        `block base ${s.base} within 0.5 m of the sampled ground ${ground}`,
      );
      assert.ok(s.plateTop > s.base, 'the plate top covers the block base');
      assert.ok(Math.abs(s.massing.plotAreaSquareMeters - 1600) < 1e-6);
      await screenshot('02-massing-block');
    },
  );

  await check(
    'The block casts a shadow from the scene sun onto the ground',
    async () => {
      const s = await massing();
      assert.equal(s.shadowMap, true, 'the scene shadow map is on');
      assert.equal(s.blockShadows, true, 'the block casts shadows');
      assert.ok(s.sun.elevationDeg > 0, 'the sun is up');
      shadow6 = await shadowEvidence('shadow');
      await screenshot('03-cast-shadow');
    },
  );

  await check(
    'Readout beside the plot: HEIGHT m EST, STOREYS, FAR, FLOOR AREA; at most 3 new controls',
    async () => {
      const s = await massing();
      const values = await readout();
      report.measurements.readout6 = values;
      assert.deepEqual(values, shows(s));
      assert.deepEqual(values, {
        height: '19.2 m',
        storeys: '6',
        far: '3.84',
        floor: '6,144 m²',
      });
      assert.ok(
        await locator('[data-city-massing-est]').isVisible(),
        'EST shown',
      );
      assert.equal(await locator(`${S.readout} button`).count(), 3);
      await insideViewport(S.readout, DESKTOP);
      for (const other of HUD) await noOverlap(S.readout, other);
      await clearOfMassing(shadow6);
      await legibility('readout');
      await screenshot('04-readout');
    },
  );

  await check('No page errors, console errors or Vue warnings', async () => {
    assert.deepEqual(report.pageErrors, []);
    const noise =
      /Failed to load resource|net::ERR_|NetworkError|Failed to fetch|\[Data:(?:Flights|Satellites|Ships|CCTV)\]/i;
    const errors = report.console.filter(
      (e) =>
        /\[Vue warn\]|Unhandled error during execution/i.test(e.text) ||
        (e.type === 'error' && !noise.test(e.text)),
    );
    report.unexpectedErrors = errors;
    assert.deepEqual(errors, [], 'unexpected browser errors; see summary.json');
  });
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${error.stack || error}`);
  if (page && !page.isClosed()) {
    try {
      await screenshot('failure');
      report.failure.massing = await massing();
      report.failure.play = await play();
    } catch (e) {
      report.failure.screenshotError = String(e);
    }
  }
} finally {
  if (browser)
    await browser.close().catch((e) => (report.cleanupError = String(e)));
  if (videoDir) {
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
      report.video.push({ role, webm, mp4: r.status === 0 ? mp4 : null });
    }
  }
  report.finishedAt = new Date().toISOString();
  await json('summary.json', report);
  console.log(
    `${report.status.toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} assertions; report ${path.join(output, 'summary.json')}`,
  );
}
