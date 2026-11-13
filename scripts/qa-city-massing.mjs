#!/usr/bin/env node
// City builder massing v0 journey (behind ?massing=1). The parent starts the
// app; this script owns only its headless browser and output files (same
// conventions as qa-city-play.mjs, which stays the flag-off journey).
// node scripts/qa-city-massing.mjs [--url http://127.0.0.1:4187]
// QA_SHOTS_DIR defaults to qa-shots/city-massing. QA_VIDEO_DIR records .webm
// and, when ffmpeg is on PATH, an .mp4 named for its page. QA_PLOT=<plot id>
// picks the plot. Exit 1 is a failure; exit 3 an INVALID measurement.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { textLegibility } from '../src/ui/legibility.js';
import {
  InvalidMeasurement,
  distinctFrames,
  groundReference,
  siteForPlot,
} from './qa-massing-measure.mjs';

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
// The default plot holds Saints Peter and Paul Church, Washington Square, San
// Francisco: a building on the Esri imagery and on Google's 3D tiles, so a
// photoreal run cuts a real building. The camera looks north at it from 600 m.
const PLOT = process.env.QA_PLOT || 'plot-n105201-126637';
const SITE = siteForPlot(PLOT);
// A morning sun in the east (az 78°, el 23°): the block's shadow falls west,
// through the free gap left of the play wheel.
const SUN_TIME = '2026-06-21T15:00:00Z';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
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
  plot: PLOT,
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
      status: error instanceof InvalidMeasurement ? 'invalid' : 'fail',
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
// The plot centre on screen, on the surface the map shows there (a roof on 3D
// tiles), so a click there snaps to that plot.
async function plotPoint(id) {
  return page.evaluate(async (plotId) => {
    const { plotFromId } = await import('/src/data/cityPlot.js');
    const { viewer } = window.__godsEyeView;
    const { scene } = viewer;
    const { center } = plotFromId(plotId);
    const at = {
      longitude: (center.lon * Math.PI) / 180,
      latitude: (center.lat * Math.PI) / 180,
      height: 0,
    };
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (name) => viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
    );
    const sampled = scene.sampleHeightSupported
      ? scene.sampleHeight(at, exclude)
      : undefined;
    at.height = Number.isFinite(sampled)
      ? sampled
      : (scene.globe.getHeight(at) ?? 0);
    const p = scene.cartesianToCanvasCoordinates(
      scene.globe.ellipsoid.cartographicToCartesian(at),
    );
    if (!p) return null;
    const rect = scene.canvas.getBoundingClientRect();
    const x = Math.round(p.x + rect.left);
    const y = Math.round(p.y + rect.top);
    return { x, y, free: document.elementFromPoint(x, y) === scene.canvas };
  }, id);
}
async function selectPlot() {
  const at = await plotPoint(PLOT);
  assert.ok(at?.free, `${PLOT} is on the free map: ${JSON.stringify(at)}`);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await until(() => window.__gevCityPlay?.snapshot().plot, 'a plot', 20000);
  assert.equal((await play()).plot.id, PLOT, 'the QA_PLOT plot is selected');
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
      return s?.shown && s.plotId === id && s.sampled && s.drawn;
    },
    `massing stands on ${plotId}, drawn`,
    30000,
    plotId,
  );
  await page.waitForTimeout(1000);
}
// The map's surface (without massing or play entities) at the plot centre and
// on the street 6 m outside the middle of each plot edge, with the shown 3D
// tilesets. Sampled before MASSING cuts the plot out of the photoreal mesh.
async function groundSamples() {
  return page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    const { scene } = viewer;
    const { center } = window.__gevCityPlay.snapshot().plot;
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (name) => viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
    );
    const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
    const surface = (east, north) => {
      const at = {
        longitude: ((center.lon + east / kx) * Math.PI) / 180,
        latitude: ((center.lat + north / 111_320) * Math.PI) / 180,
        height: 0,
      };
      const sampled = scene.sampleHeight(at, exclude);
      return Number.isFinite(sampled)
        ? sampled
        : scene.globe.show
          ? scene.globe.getHeight(at)
          : undefined;
    };
    const primitives = scene.primitives;
    return {
      centre: surface(0, 0) ?? null,
      street: [
        [0, 26],
        [26, 0],
        [0, -26],
        [-26, 0],
      ].map(([e, n]) => surface(e, n) ?? null),
      tilesets: Array.from({ length: primitives.length }, (_, i) =>
        primitives.get(i),
      ).filter((p) => p.show && 'tilesLoaded' in p && 'clippingPolygons' in p)
        .length,
    };
  });
}
// On 3D tiles MASSING cuts the plot out of the mesh: inside the plot nothing of
// the mesh stands above the block's base. The keyless Esri globe has no tileset.
async function cutEvidence(samples, s) {
  const inside = await page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    const { center } = window.__gevCityPlay.snapshot().plot;
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (name) => viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
    );
    const h = viewer.scene.sampleHeight(
      {
        longitude: (center.lon * Math.PI) / 180,
        latitude: (center.lat * Math.PI) / 180,
        height: 0,
      },
      exclude,
    );
    return Number.isFinite(h) ? h : null;
  });
  const cut = { tilesets: samples.tilesets, cuts: s.cuts, inside };
  report.measurements.cut = cut;
  if (!samples.tilesets) return cut;
  assert.ok(s.cuts >= samples.tilesets, 'every shown 3D tileset is cut');
  assert.ok(
    inside === null || inside <= s.blockBase + 1,
    `nothing of the mesh stands above the base inside the plot: ${inside} m`,
  );
  return cut;
}
// Ground points given in metres east/north (and up) of the block's footprint
// centre, on screen. The readout is hidden while they are found, so a point
// under it still counts (clearOfMassing checks that); a point under other HUD,
// on the block or within 6 px of the edge is not usable. `measurable` points
// may sit under HUD: canvas captures do not include the DOM.
async function groundPoints(offsets) {
  return page.evaluate((list) => {
    const hud = [
      ...document.querySelectorAll(
        '[data-city-massing], [data-city-massing-leader]',
      ),
    ];
    hud.forEach((el) => (el.style.visibility = 'hidden'));
    try {
      const { scene } = window.__godsEyeView.viewer;
      const s = window.__gevCityMassing.snapshot();
      const fp = s.massing.footprint;
      const lon0 = fp.reduce((a, [x]) => a + x, 0) / fp.length;
      const lat0 = fp.reduce((a, [, y]) => a + y, 0) / fp.length;
      const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
      const canvas = scene.canvas.getBoundingClientRect();
      return list.map(({ east, north, up = 0 }) => {
        const p = scene.cartesianToCanvasCoordinates(
          scene.globe.ellipsoid.cartographicToCartesian({
            longitude: ((lon0 + east / kx) * Math.PI) / 180,
            latitude: ((lat0 + north / 111_320) * Math.PI) / 180,
            height: s.blockBase + up,
          }),
        );
        if (!p) return null;
        const x = Math.round(p.x + canvas.left);
        const y = Math.round(p.y + canvas.top);
        const inside =
          x >= 6 && y >= 6 && x <= innerWidth - 7 && y <= innerHeight - 7;
        const measurable =
          inside &&
          scene.pick({ x: p.x, y: p.y })?.id?.id !== 'city-massing-block';
        const usable =
          measurable && document.elementFromPoint(x, y) === scene.canvas;
        return { x, y, east, north, usable, measurable };
      });
    } finally {
      hud.forEach((el) => (el.style.visibility = ''));
    }
  }, offsets);
}
// Offsets along the line away from the sun (and toward it), `d` metres from
// the footprint centre.
function alongSun(s, distances, side = -1) {
  const az = (s.sun.azimuthDeg * Math.PI) / 180;
  return distances.map((d) => ({
    east: side * Math.sin(az) * d,
    north: side * Math.cos(az) * d,
  }));
}
const shadowLength = (s, heightMeters) =>
  heightMeters / Math.tan((s.sun.elevationDeg * Math.PI) / 180);
const halfWidth = (s) => {
  const fp = s.massing.footprint;
  const lon0 = fp.reduce((a, [x]) => a + x, 0) / fp.length;
  const kx = 111_320 * Math.cos((fp[0][1] * Math.PI) / 180);
  return Math.max(...fp.map(([x]) => Math.abs(x - lon0) * kx));
};
// The canvas of a newly rendered frame with the scene's shadow map on or off.
// One page task sets the shadow map, asks the scene for a frame and listens to
// it: preRender records the shadow map it is drawn with, its postRender reads
// the canvas (on-demand rendering draws nothing until asked; DOM overlays are
// not in the canvas). No stray frame can come between, in which massing would
// turn the shadow map back on.
async function renderedFrame(shadows) {
  const { url, frame, drawnWith, canvas } = await page.evaluate(
    (on) =>
      new Promise((resolve, reject) => {
        const { viewer } = window.__godsEyeView;
        const { scene } = viewer;
        const after = scene.frameState.frameNumber;
        let drawnWith = null;
        const timer = setTimeout(() => {
          stop();
          reject(new Error('no frame was rendered within 30 s'));
        }, 30000);
        const unpre = scene.preRender.addEventListener(() => {
          drawnWith = scene.shadowMap.enabled;
        });
        const unpost = scene.postRender.addEventListener(() => {
          if (scene.frameState.frameNumber <= after || drawnWith === null)
            return;
          stop();
          const rect = scene.canvas.getBoundingClientRect();
          resolve({
            url: scene.canvas.toDataURL('image/png'),
            frame: scene.frameState.frameNumber,
            drawnWith,
            canvas: {
              left: rect.left,
              top: rect.top,
              sx: scene.canvas.width / rect.width,
              sy: scene.canvas.height / rect.height,
            },
          });
        });
        function stop() {
          clearTimeout(timer);
          unpre();
          unpost();
        }
        viewer.shadows = on;
        scene.requestRender();
      }),
    shadows,
  );
  return {
    png: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    frame,
    shadows: drawnWith,
    canvas,
  };
}
// Mean luminance of the (2r+1)^2 CSS px around each page point in a frame.
async function pixels({ png, canvas }, points, radius = 4) {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return points.map(({ x, y }) => {
    const cx = Math.round((x - canvas.left) * canvas.sx);
    const cy = Math.round((y - canvas.top) * canvas.sy);
    const r = Math.round(radius * canvas.sx);
    let sum = 0;
    let n = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const i = ((cy + dy) * info.width + (cx + dx)) * info.channels;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++;
      }
    return sum / n;
  });
}
// Canvas luminance at usable ground points in a frame rendered with the scene's
// shadow map on and in the next one rendered with it off: on/off per point.
// Captures from one frame, or byte-identical captures, make the run INVALID.
async function luminance(points, label = phase) {
  const usable = points.filter((p) => p?.usable);
  const on = await renderedFrame(true);
  const off = await renderedFrame(false);
  await renderedFrame(true);
  distinctFrames(on, off, label);
  const lit = await pixels(on, usable);
  const unlit = await pixels(off, usable);
  const ratio =
    lit.reduce((a, v) => a + v, 0) /
    Math.max(
      1e-9,
      unlit.reduce((a, v) => a + v, 0),
    );
  return {
    points: usable,
    on: lit,
    off: unlit,
    ratio,
    frames: [on.frame, off.frame],
    captures: { on, off },
  };
}
// The cast shadow, measured: ground inside it is darker with the shadow map on
// than off, the sun side is not. A dark edge band or a global dimming fails.
async function shadowEvidence(label) {
  const s = await massing();
  const length = shadowLength(s, s.massing.heightMeters);
  const half = halfWidth(s);
  const distances = [0.3, 0.45, 0.6].map((f) => half + f * length);
  const shadePoints = await groundPoints(alongSun(s, distances));
  const shade = await luminance(shadePoints, `${label} shade`);
  const lit = await luminance(
    await groundPoints(alongSun(s, distances, 1)),
    `${label} sun side`,
  );
  const evidence = {
    lengthMeters: length,
    halfMeters: half,
    shadePoints,
    shadeRatio: shade.ratio,
    litRatio: lit.ratio,
    shade: { ...shade, captures: undefined },
    lit: { ...lit, captures: undefined },
  };
  report.measurements[label] = evidence;
  assert.ok(shade.points.length, `${label}: a shadow point is on screen`);
  assert.ok(lit.points.length, `${label}: a sun-side point is on screen`);
  assert.ok(
    shade.ratio < 0.8,
    `${label}: the ground in the cast shadow is darker with the sun's shadow map (${shade.ratio.toFixed(2)})`,
  );
  assert.ok(
    lit.ratio > 0.9,
    `${label}: the sun side is not darkened (${lit.ratio.toFixed(2)})`,
  );
  return evidence;
}

// Where the line away from the sun through the footprint centre leaves the
// (axis-aligned, square) footprint.
const edgeExit = (s) => {
  const az = (s.sun.azimuthDeg * Math.PI) / 180;
  return (
    halfWidth(s) / Math.max(Math.abs(Math.sin(az)), Math.abs(Math.cos(az)))
  );
};
// The cast shadow along that line: on/off luminance of 3 x 3 px every 0.5 m
// from the footprint edge out to 1.6 shadow lengths, from one frame pair.
async function shadowProfile(s, label) {
  const length = shadowLength(s, s.massing.heightMeters);
  const exit = edgeExit(s);
  const distances = [];
  for (let d = exit + 0.5; d <= exit + 1.6 * length; d += 0.5)
    distances.push(d);
  const points = (await groundPoints(alongSun(s, distances))).map((p, i) =>
    p?.measurable ? { ...p, d: distances[i] } : null,
  );
  const on = await renderedFrame(true);
  const off = await renderedFrame(false);
  await renderedFrame(true);
  distinctFrames(on, off, label);
  const kept = points.filter(Boolean);
  const lit = await pixels(on, kept, 1);
  const unlit = await pixels(off, kept, 1);
  return {
    exitMeters: exit,
    lengthMeters: length,
    profile: kept.map((p, i) => ({
      d: p.d,
      ratio: lit[i] / Math.max(1, unlit[i]),
      on: lit[i],
      off: unlit[i],
    })),
    captures: { on, off },
  };
}
// The block and its shadow, cropped from the shadow-on and shadow-off frames
// side by side (canvas pixels: no HUD over them).
async function shadowCrop(name, s, { on, off }) {
  const length = shadowLength(s, s.massing.heightMeters);
  const h = halfWidth(s);
  const [tx, ty] = alongSun(s, [length]).map((o) => [o.east, o.north])[0];
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const points = (
    await groundPoints([
      ...corners.map(([e, n]) => ({ east: e, north: n })),
      ...corners.map(([e, n]) => ({
        east: e,
        north: n,
        up: s.massing.heightMeters,
      })),
      ...corners.map(([e, n]) => ({ east: e + tx, north: n + ty })),
    ])
  ).filter(Boolean);
  const { canvas } = on;
  const meta = await sharp(on.png).metadata();
  const xs = points.map((p) => (p.x - canvas.left) * canvas.sx);
  const ys = points.map((p) => (p.y - canvas.top) * canvas.sy);
  const pad = 30 * canvas.sx;
  const left = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const top = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const box = {
    left,
    top,
    width: Math.min(meta.width, Math.ceil(Math.max(...xs) + pad)) - left,
    height: Math.min(meta.height, Math.ceil(Math.max(...ys) + pad)) - top,
  };
  const label = (text) =>
    Buffer.from(
      `<svg width="${box.width}" height="28"><rect width="100%" height="28" fill="#05080b"/><text x="10" y="19" font-family="monospace" font-size="14" letter-spacing="2" fill="#2ec8e8">${text}</text></svg>`,
    );
  const tile = async (frame, text) =>
    sharp({
      create: {
        width: box.width,
        height: box.height + 28,
        channels: 3,
        background: '#05080b',
      },
    })
      .composite([
        { input: label(text), top: 0, left: 0 },
        {
          input: await sharp(frame.png).extract(box).png().toBuffer(),
          top: 28,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
  const gap = 8;
  const pair = await sharp({
    create: {
      width: box.width * 2 + gap,
      height: box.height + 28,
      channels: 3,
      background: '#05080b',
    },
  })
    .composite([
      { input: await tile(on, 'SHADOW MAP ON'), top: 0, left: 0 },
      {
        input: await tile(off, 'SHADOW MAP OFF'),
        top: 0,
        left: box.width + gap,
      },
    ])
    .png()
    .toBuffer();
  // Twice the canvas size, so the band reads at a glance.
  await sharp(pair)
    .resize({ width: (box.width * 2 + gap) * 2 })
    .toFile(path.join(output, `${name}.png`));
  report.screenshots.push(`${name}.png`);
  return box;
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
// The readout covers neither the block nor the ground its shadow falls on
// (shadow points found with the readout hidden, so they can be under it).
async function clearOfMassing(shadowPoints) {
  const covered = await page.evaluate((points) => {
    const r = document
      .querySelector('[data-city-massing]')
      .getBoundingClientRect();
    const { scene } = window.__godsEyeView.viewer;
    const s = window.__gevCityMassing.snapshot();
    const canvas = scene.canvas.getBoundingClientRect();
    const corners = [s.blockBase, s.blockExtrudedHeight].flatMap((height) =>
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
  }, shadowPoints.filter(Boolean));
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
      await selectPlot();
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
      report.measurements.legendArea = { legend: area, plotId };
      assert.equal(
        area.trim(),
        '1,600 m²',
        'the zoning legend shows the 1,600 m² cell',
      );
      await locator('[data-city-play-action="back"]').click();
      doc = (await storage())[KEY];
      assert.ok(doc, 'the zoned plot is saved');
      await screenshot('01-plot-massing-toggle');
    },
  );

  await check(
    'MASSING on: a ground plate and a block on the sampled ground',
    async () => {
      // Before the toggle: on 3D tiles MASSING cuts the plot out of the mesh.
      const samples = await groundSamples();
      const reference = groundReference(samples.centre, samples.street);
      await massingOn(plotId);
      const s = await massing();
      assert.ok(reference, 'the ground was sampled before MASSING');
      const ground = reference.ground;
      // Read off the drawn entities, not the owner's own variables.
      report.measurements.grounding = {
        plotId,
        blockBase: s.blockBase,
        sampleHeight: ground,
        sampledFrom: reference.from,
        samples,
        plateTop: s.plateTop,
        plateBottom: s.plateBottom,
        blockTop: s.blockExtrudedHeight,
      };
      assert.ok(
        Math.abs(s.blockBase - ground) <= 0.5,
        `block base ${s.blockBase} within 0.5 m of the ${reference.from} ground ${ground}`,
      );
      assert.ok(
        s.plateTop > s.blockBase && s.plateBottom < ground,
        'the plate reaches below the ground and covers the block base',
      );
      assert.ok(Math.abs(s.massing.plotAreaSquareMeters - 1600) < 1e-6);
      await cutEvidence(samples, s);
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
      report.measurements.shadowSettings = await page.evaluate(() => {
        const { scene } = window.__godsEyeView.viewer;
        const m = scene.shadowMap;
        return {
          enabled: m.enabled,
          size: m.size,
          maximumDistance: m.maximumDistance,
          darkness: m.darkness,
          softShadows: m.softShadows,
          cascades: m._numberOfCascades,
          globeShadows: scene.globe.shadows,
          requestRenderMode: scene.requestRenderMode,
        };
      });
      shadow6 = await shadowEvidence('shadow');
      const profile = await shadowProfile(s, 'shadow profile');
      report.measurements.profile6 = { ...profile, captures: undefined };
      report.measurements.crop6 = await shadowCrop(
        '03b-shadow-crop',
        s,
        profile.captures,
      );
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
      await clearOfMassing(shadow6.shadePoints);
      await legibility('readout');
      await screenshot('04-readout');
    },
  );

  await check(
    'Stepper +2: the numbers, the block and its shadow change consistently; nothing is saved',
    async () => {
      const before = await massing();
      // Ground between the 6- and the 8-storey shadow tips: lit now, shaded after +2.
      const between =
        halfWidth(before) +
        (shadowLength(before, before.massing.heightMeters) +
          shadowLength(before, 8 * before.massing.storeyHeightMeters)) /
          2;
      const lit6 = await luminance(
        await groundPoints(alongSun(before, [between])),
      );
      assert.equal(
        lit6.points.length,
        1,
        'a point between the tips is on screen',
      );
      await locator(S.plus).click();
      await locator(S.plus).click();
      await until(
        () => {
          const s = window.__gevCityMassing.snapshot();
          return s.storeys === 8 && s.drawn;
        },
        'eight storeys, drawn',
        30000,
      );
      await page.waitForTimeout(1000);
      const s = await massing();
      const values = await readout();
      report.measurements.readout8 = values;
      assert.deepEqual(values, shows(s));
      assert.deepEqual(values, {
        height: '25.6 m',
        storeys: '8',
        far: '5.12',
        floor: '8,192 m²',
      });
      assert.ok(
        Math.abs(s.blockExtrudedHeight - s.base - 25.6) < 1e-6,
        `the block itself re-extruded: ${s.blockExtrudedHeight - s.base} m`,
      );
      assert.ok(
        Math.abs(
          s.massing.floorAreaSquareMeters /
            before.massing.floorAreaSquareMeters -
            8 / 6,
        ) < 1e-9 && Math.abs(s.massing.far / before.massing.far - 8 / 6) < 1e-9,
        'floor area and FAR scale with storeys',
      );
      await shadowEvidence('shadow-8');
      const shade8 = await luminance(
        await groundPoints(alongSun(s, [between])),
      );
      report.measurements.longerShadow = {
        meters: between,
        ratio6: lit6.ratio,
        ratio8: shade8.ratio,
      };
      assert.ok(
        lit6.ratio > 0.9 && shade8.points.length === 1 && shade8.ratio < 0.8,
        `the ground between the tips is lit at 6 storeys (${lit6.ratio.toFixed(2)}) and shaded at 8 (${shade8.ratio.toFixed(2)})`,
      );
      const saved = await storage();
      assert.equal(saved[KEY], doc, 'massing never writes the city document');
      assert.deepEqual(
        Object.keys(saved).filter((k) => /massing/i.test(k)),
        [],
        'no massing key in storage',
      );
      await screenshot('05-stepper-plus-2');
    },
  );
  // The journey page closes; a fresh page in the same browser proves reload.
  await page.close();

  page = await openPage(context, 'restore');
  await check(
    'A fresh page recomputes massing from the plot, not from the save',
    async () => {
      await startup(true);
      await setSun(SUN_TIME);
      await locator(S.pill).click();
      await locator(S.play).waitFor({ state: 'visible' });
      assert.deepEqual(
        (await play()).zoning,
        [{ plotId, use: 'housing' }],
        'zoning is restored from the save',
      );
      await selectPlot();
      assert.equal((await play()).plot.id, plotId, 'the same plot');
      assert.equal(
        await locator(S.toggle).getAttribute('aria-pressed'),
        'false',
      );
      assert.equal(
        (await massing()).storeys,
        6,
        'storeys start from the default',
      );
      await massingOn(plotId);
      assert.deepEqual(await readout(), {
        height: '19.2 m',
        storeys: '6',
        far: '3.84',
        floor: '6,144 m²',
      });
      assert.equal((await storage())[KEY], doc, 'the save is untouched');
      await screenshot('06-reload-recomputed');
    },
  );

  await check(
    'Mobile 390x844: the readout and its stepper fit and work',
    async () => {
      await page.setViewportSize(MOBILE);
      await page.waitForTimeout(1500);
      await locator(S.readout).waitFor({ state: 'visible' });
      await locator(S.plus).click();
      await until(
        () => {
          const s = window.__gevCityMassing.snapshot();
          return s.storeys === 7 && s.drawn;
        },
        'seven storeys on the phone, drawn',
        30000,
      );
      await page.waitForTimeout(1500);
      assert.deepEqual(await readout(), shows(await massing()));
      await insideViewport(S.readout, MOBILE);
      for (const other of HUD) await noOverlap(S.readout, other);
      const s = await massing();
      await clearOfMassing(
        await groundPoints(
          alongSun(
            s,
            [0.3, 0.45, 0.6].map(
              (f) => halfWidth(s) + f * shadowLength(s, s.massing.heightMeters),
            ),
          ),
        ),
      );
      await legibility('readout-mobile');
      await screenshot('07-mobile-readout');
      await page.setViewportSize(DESKTOP);
    },
  );
  await page.close();

  page = await openPage(context, 'flag-off');
  await check(
    'Without the flag play mode has no massing: no readout, entities, shadows or probe',
    async () => {
      await startup(false);
      await locator(S.pill).click();
      await locator(S.play).waitFor({ state: 'visible' });
      await selectPlot();
      await page.waitForTimeout(1500);
      const off = await page.evaluate(() => ({
        probe: '__gevCityMassing' in window,
        source:
          window.__godsEyeView.viewer.dataSources.getByName('gev-city-massing')
            .length,
        shadows: window.__godsEyeView.viewer.shadows,
        readout: Boolean(document.querySelector('[data-city-massing]')),
      }));
      report.measurements.flagOff = off;
      assert.deepEqual(off, {
        probe: false,
        source: 0,
        shadows: false,
        readout: false,
      });
      await screenshot('08-flag-off');
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
  // An INVALID measurement is neither a pass nor a shadow failure.
  const invalid = error instanceof InvalidMeasurement;
  report.status = invalid ? 'invalid' : 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = invalid ? 3 : 1;
  console.error(
    `${invalid ? 'INVALID' : 'FAIL'} ${phase}: ${error.stack || error}`,
  );
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
