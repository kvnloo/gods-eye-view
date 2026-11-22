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
import { shadowFit } from '../src/data/cityShadowFit.js';
import { shadowTip } from '../src/ui/cityShadowTip.js';
import { textLegibility } from '../src/ui/legibility.js';
import {
  InvalidMeasurement,
  demoCut,
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
// The shadow study looks south: at winter noon the shadow falls north, toward
// the camera, where one looking north would hide it behind the block.
const SITE_SOUTH = siteForPlot(PLOT, 600, 180);
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
  // On a phone HOMES and SHADOW REACH stand in their own strip.
  extra: '[data-city-massing-extra]',
  // The shadow study beside the readout (PROTECT SIDEWALK).
  study: '[data-city-shadow]',
  studyToggle: '[data-city-shadow-toggle]',
  winter: '[data-city-shadow-winter]',
  farther: '[data-city-shadow-edge="1"]',
  pick: '[data-city-shadow-pick]',
  fit: '[data-city-shadow-fit]',
  tip: '[data-city-shadow-tip]',
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
  // Seconds on the journey page's video clock, for the 30 s demo cut, and the
  // windows in which a capture had the shadow map off.
  marks: { flicker: [] },
};
let browser;
let page;
let phase = 'launch';
const videos = {};
const opened = {};
let role = null;
// Now, on the journey page's video clock.
const clock = () => (Date.now() - opened.journey) / 1000;
const mark = (name) => {
  if (role === 'journey') report.marks[name] = clock();
};
const locator = (selector) => page.locator(selector);
const massing = () => page.evaluate(() => window.__gevCityMassing?.snapshot());
const play = () => page.evaluate(() => window.__gevCityPlay?.snapshot());
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);

async function openPage(context, name) {
  const next = await context.newPage();
  opened[name] = Date.now();
  role = name;
  next.setDefaultTimeout(20000);
  next.on('console', (m) =>
    report.console.push({ phase, type: m.type(), text: m.text() }),
  );
  next.on('pageerror', (e) =>
    report.pageErrors.push({ phase, message: e.message, stack: e.stack }),
  );
  if (next.video()) videos[name] = next.video().path();
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
function siteUrl(flag, site) {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  if (flag) url.searchParams.set('massing', '1');
  url.hash = new URLSearchParams({
    v: '2',
    ...Object.fromEntries(Object.entries(site).map(([k, v]) => [k, `${v}`])),
    roll: '0',
    style: 'normal',
  }).toString();
  return url.href;
}
async function startup(flag, site = SITE) {
  await page.goto(siteUrl(flag, site), {
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
    site,
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
// may sit under HUD: canvas captures do not include the DOM. With `terrain`
// each point stands on the ground the map shows there (`ground`), not at the
// block's base height.
async function groundPoints(offsets, { terrain = false } = {}) {
  return page.evaluate(
    ([list, onTerrain]) => {
      const hud = [
        ...document.querySelectorAll(
          '[data-city-massing], [data-city-massing-extra], [data-city-massing-leader]',
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
        const { viewer } = window.__godsEyeView;
        const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
          (name) =>
            viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
        );
        return list.map(({ east, north, up = 0 }) => {
          const at = {
            longitude: ((lon0 + east / kx) * Math.PI) / 180,
            latitude: ((lat0 + north / 111_320) * Math.PI) / 180,
            height: s.blockBase + up,
          };
          let ground = null;
          if (onTerrain) {
            const h = scene.sampleHeight(at, exclude);
            ground = Number.isFinite(h)
              ? h
              : scene.globe.show
                ? (scene.globe.getHeight(at) ?? null)
                : null;
            if (ground === null) return null;
            at.height = ground;
          }
          const p = scene.cartesianToCanvasCoordinates(
            scene.globe.ellipsoid.cartographicToCartesian(at),
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
          return { x, y, east, north, ground, usable, measurable };
        });
      } finally {
        hud.forEach((el) => (el.style.visibility = ''));
      }
    },
    [offsets, terrain],
  );
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
// The canvas of a newly rendered frame, with the scene's shadow map as the app
// keeps it (`shadows` null) or set on or off. One page task sets it, asks the
// scene for a frame and listens to it: preRender records the shadow map the
// frame is drawn with, its postRender reads the canvas (on-demand rendering
// draws nothing until asked; DOM overlays are not in the canvas). No stray
// frame can come between, in which massing would turn the shadow map back on.
async function renderedFrame(shadows = null) {
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
        if (on !== null) viewer.shadows = on;
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
// The shadow-off frame for a capture, then shadow-on again; the video shows
// the shadow off in between, so the demo cut leaves that window out.
async function offFrame() {
  const from = clock();
  const off = await renderedFrame(false);
  await renderedFrame(true);
  if (role === 'journey') report.marks.flicker.push([from, clock()]);
  return off;
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
// The frame the app draws on its own, which must have its shadow map on (a
// failure, not an INVALID measurement, if the app turned it off).
async function appFrame(label) {
  const on = await renderedFrame();
  assert.equal(
    on.shadows,
    true,
    `${label}: the app draws with its shadow map on`,
  );
  return on;
}
// Canvas luminance at usable ground points in the frame the app draws (shadow
// map on) and in the next one rendered with it off: on/off per point.
// Captures from one frame, or byte-identical captures, make the run INVALID.
async function luminance(points, label = phase) {
  const usable = points.filter((p) => p?.usable);
  const on = await appFrame(label);
  const off = await offFrame();
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
// The cast shadow along that line, on the ground the map shows: on/off
// luminance of 3 x 3 px every 0.5 m from the footprint edge out to 1.6 shadow
// lengths, from one frame pair.
async function shadowProfile(s, label) {
  const length = shadowLength(s, s.massing.heightMeters);
  const exit = edgeExit(s);
  const distances = [];
  for (let d = exit + 0.5; d <= exit + 1.6 * length; d += 0.5)
    distances.push(d);
  const points = (
    await groundPoints(alongSun(s, distances), { terrain: true })
  ).map((p, i) => (p?.measurable ? { ...p, d: distances[i] } : null));
  const on = await appFrame(label);
  const off = await offFrame();
  distinctFrames(on, off, label);
  const kept = points.filter(Boolean);
  const lit = await pixels(on, kept, 1);
  const unlit = await pixels(off, kept, 1);
  return {
    exitMeters: exit,
    lengthMeters: length,
    profile: kept.map((p, i) => ({
      d: p.d,
      ground: p.ground,
      ratio: lit[i] / Math.max(1, unlit[i]),
      on: lit[i],
      off: unlit[i],
    })),
    captures: { on, off },
  };
}
// The rendered shadow's tip against the formula. Measured: where the profile
// turns lit for good past the middle of the band (halfway between the band's
// on/off ratio and 1). Formula: the top of the drawn block falls height /
// tan(altitude) away from the sun, height being the block top above the
// ground at the tip (the ground may slope): the first point where the line
// from the top edge, descending tan(altitude) per metre, meets the ground.
function tipEvidence(s, { exitMeters, profile }) {
  const top = s.blockExtrudedHeight;
  const tan = Math.tan((s.sun.elevationDeg * Math.PI) / 180);
  const flat = (top - s.blockBase) / tan;
  const band = profile
    .filter(
      (p) => p.d > exitMeters + 0.2 * flat && p.d < exitMeters + 0.8 * flat,
    )
    .map((p) => p.ratio)
    .sort((a, b) => a - b);
  const shade = band[Math.floor(band.length / 2)];
  const mid = (shade + 1) / 2;
  const start = profile.findIndex((p) => p.d > exitMeters + 0.5 * flat);
  let measured = null;
  for (let i = Math.max(1, start); i + 2 < profile.length; i++) {
    const lit = [0, 1, 2].every((k) => profile[i + k].ratio >= mid);
    if (!lit || profile[i - 1].ratio >= mid) continue;
    const [a, b] = [profile[i - 1], profile[i]];
    measured = a.d + ((mid - a.ratio) / (b.ratio - a.ratio)) * (b.d - a.d);
    break;
  }
  let expected = null;
  for (let i = 1; i < profile.length; i++) {
    const gap = (p) => top - (p.d - exitMeters) * tan - p.ground;
    const [a, b] = [profile[i - 1], profile[i]];
    if (gap(a) > 0 && gap(b) <= 0) {
      expected = a.d + (gap(a) / (gap(a) - gap(b))) * (b.d - a.d);
      break;
    }
  }
  const reach = (d) => (d === null ? null : d - exitMeters);
  return {
    shadeRatio: shade,
    midRatio: mid,
    measuredReach: reach(measured),
    expectedReach: reach(expected),
    flatReach: flat,
    tipGround: expected === null ? null : top - (expected - exitMeters) * tan,
  };
}
function assertTip(label, tip) {
  report.measurements[label] = tip;
  assert.ok(tip.measuredReach !== null, `${label}: the shadow ends on screen`);
  assert.ok(
    tip.expectedReach !== null,
    `${label}: the formula tip is on screen`,
  );
  const allowed = Math.max(1, 0.05 * tip.expectedReach);
  assert.ok(
    Math.abs(tip.measuredReach - tip.expectedReach) <= allowed,
    `${label}: the rendered shadow reaches ${tip.measuredReach.toFixed(2)} m, the formula ${tip.expectedReach.toFixed(2)} m (±${allowed.toFixed(2)} m)`,
  );
}
// Cesium's own scene sun (UniformState's sunDirectionWC, which lights the scene
// and aims its shadow map) in the plot's east-north-up frame.
async function sceneSun() {
  return page.evaluate(() => {
    const { scene } = window.__godsEyeView.viewer;
    const { center } = window.__gevCityPlay.snapshot().plot;
    const d = scene.context.uniformState.sunDirectionWC;
    const [lat, lon] = [center.lat, center.lon].map((v) => (v * Math.PI) / 180);
    const up = [
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
    ];
    const east = [-Math.sin(lon), Math.cos(lon), 0];
    const north = [
      -Math.sin(lat) * Math.cos(lon),
      -Math.sin(lat) * Math.sin(lon),
      Math.cos(lat),
    ];
    const dot = (a) => a[0] * d.x + a[1] * d.y + a[2] * d.z;
    return {
      elevationDeg: (Math.asin(dot(up)) * 180) / Math.PI,
      azimuthDeg:
        ((Math.atan2(dot(east), dot(north)) * 180) / Math.PI + 360) % 360,
    };
  });
}
function sunSeparation(a, b) {
  const r = Math.PI / 180;
  const c =
    Math.sin(a.elevationDeg * r) * Math.sin(b.elevationDeg * r) +
    Math.cos(a.elevationDeg * r) *
      Math.cos(b.elevationDeg * r) *
      Math.cos((a.azimuthDeg - b.azimuthDeg) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
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
// What the readout must show for the block the globe owner stands (en-US):
// HOMES = floor(floor area x 0.64 / 85), SHADOW REACH = height / tan(altitude).
const shows = (s) => ({
  height: `${Number(s.massing.heightMeters.toFixed(1))} m`,
  storeys: String(s.storeys),
  far: s.massing.far.toFixed(2),
  floor: `${Math.round(s.massing.floorAreaSquareMeters).toLocaleString('en-US')} m²`,
  homes: String(Math.floor((s.massing.floorAreaSquareMeters * 0.64) / 85)),
  shadow: `${Math.round(shadowLength(s, s.massing.heightMeters))} m`,
});
const storage = () => page.evaluate(() => ({ ...localStorage }));
// The shadow study as a user reads it: its rows, its FIT TO SUN button and the
// tip labels on the globe, each with its box.
async function study() {
  return page.evaluate(() => {
    const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    const row = (id) =>
      document.querySelector(`[data-city-shadow-row="${id}"]`);
    return {
      rows: Object.fromEntries(
        ['distance', 'sun', 'floors', 'edge'].map((id) => [
          id,
          text(row(id)?.querySelector('[data-city-shadow-value]')),
        ]),
      ),
      edgeLabel: text(row('edge')?.querySelector('dt')),
      assumed: Boolean(document.querySelector('[data-city-shadow-assumed]')),
      cost: text(document.querySelector('[data-city-shadow-cost]')),
      fit: text(document.querySelector('[data-city-shadow-fit]')),
      fitDisabled: document.querySelector('[data-city-shadow-fit]')?.disabled,
      tips: Object.fromEntries(
        [...document.querySelectorAll('[data-city-shadow-tip]')].map((el) => [
          el.dataset.cityShadowTip,
          text(el),
        ]),
      ),
    };
  });
}
// The M1 function's plan for the block that stands, against an edge 20 m away.
const planOf = (s, wasStoreys = s.storeys) =>
  shadowFit({
    storeys: s.storeys,
    wasStoreys,
    storeyHeightMeters: s.massing.storeyHeightMeters,
    sun: s.sun,
    edgeMeters: 20,
  });
// The study on the globe is the plan: the same lines, each drawn entity as
// long as the function says (within half a metre), the edge 20 m from the face.
function assertDrawn(s, plan) {
  assert.deepEqual(
    s.study.plan.lines.map((line) => [line.kind, line.storeys]),
    plan.lines.map((line) => [line.kind, line.storeys]),
  );
  for (const line of plan.lines)
    assert.ok(
      Math.abs(s.study.drawn[line.kind] - line.reachMeters) <= 0.5,
      `the ${line.kind} line on the ground is ${s.study.drawn[line.kind]} m, the function says ${line.reachMeters} m`,
    );
  assert.ok(
    Math.abs(s.study.drawn.edge - 20) <= 0.5,
    `the edge on the ground is ${s.study.drawn.edge} m from the block face`,
  );
}
// A free spot on the map `meters` beyond the block's face along the shadow,
// on the ground as the map shows it there (a street is rarely level with the
// block's base): the protected edge runs through it.
async function edgePoint(meters) {
  return page.evaluate(async (m) => {
    const { shadowBand } = await import('/src/data/cityShadowFit.js');
    const { viewer } = window.__godsEyeView;
    const { scene } = viewer;
    const s = window.__gevCityMassing.snapshot();
    const [, , a, b] = shadowBand(s.massing.footprint, s.sun, m);
    const rect = scene.canvas.getBoundingClientRect();
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (name) => viewer.dataSources.getByName(name)[0]?.entities.values ?? [],
    );
    // Along the edge: across the block's width first, then beyond its sides.
    for (const f of [0.5, 0.25, 0.75, 0, 1, -0.25, 1.25, -0.5, 1.5, -1, 2]) {
      const at = {
        longitude: ((a[0] + (b[0] - a[0]) * f) * Math.PI) / 180,
        latitude: ((a[1] + (b[1] - a[1]) * f) * Math.PI) / 180,
        height: 0,
      };
      const sampled = scene.sampleHeightSupported
        ? scene.sampleHeight(at, exclude)
        : undefined;
      at.height = Number.isFinite(sampled)
        ? sampled
        : (scene.globe.getHeight(at) ?? s.base);
      const p = scene.cartesianToCanvasCoordinates(
        scene.globe.ellipsoid.cartographicToCartesian(at),
      );
      if (!p) continue;
      const x = Math.round(p.x + rect.left);
      const y = Math.round(p.y + rect.top);
      if (document.elementFromPoint(x, y) === scene.canvas)
        return { x, y, f, height: at.height, base: s.base };
    }
    return null;
  }, meters);
}

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
async function legibility(label, selector = S.readout) {
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
  }, selector);
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
async function clearOfMassing(shadowPoints, selector = S.readout) {
  const covered = await page.evaluate(
    ([points, sel]) => {
      const r = document.querySelector(sel).getBoundingClientRect();
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
        (p) =>
          p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
      );
    },
    [shadowPoints.filter(Boolean), selector],
  );
  assert.deepEqual(
    covered,
    [],
    `${selector} covers no block corner or shadow point`,
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
  let tip6 = null;
  await check(
    'With ?massing=1 a selected plot offers one MASSING toggle; zoning saves as before',
    async () => {
      await startup(true);
      mark('ready');
      await setSun(SUN_TIME);
      await locator(S.pill).click();
      await locator(S.play).waitFor({ state: 'visible' });
      mark('select');
      await selectPlot();
      mark('selected');
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
      mark('zone');
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
      mark('massing');
      await massingOn(plotId);
      mark('massingDrawn');
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
      // The massing sun is Cesium's scene sun at the journey's clock.
      const cesiumSun = await sceneSun();
      const separation = sunSeparation(cesiumSun, s.sun);
      report.measurements.sun = {
        scene: cesiumSun,
        massing: s.sun,
        separation,
      };
      assert.ok(
        separation <= 1,
        `Cesium's scene sun is within 1° of the massing sun: ${separation.toFixed(3)}°`,
      );
      const profile = await shadowProfile(s, 'shadow profile');
      report.measurements.profile6 = { ...profile, captures: undefined };
      tip6 = tipEvidence(s, profile);
      assertTip('tip6', tip6);
      report.measurements.crop6 = await shadowCrop(
        '03b-shadow-crop',
        s,
        profile.captures,
      );
      await screenshot('03-cast-shadow');
    },
  );

  await check(
    'Readout beside the plot: HEIGHT m EST, STOREYS, FAR, FLOOR AREA, HOMES EST, SHADOW REACH m EST; at most 3 new controls',
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
        homes: '46',
        shadow: '45 m',
      });
      assert.equal(
        await locator('[data-city-massing-est]:visible').count(),
        3,
        'EST on HEIGHT, HOMES and SHADOW REACH',
      );
      assert.equal(await locator(`${S.readout} button`).count(), 3);
      await insideViewport(S.readout, DESKTOP);
      assert.equal(await locator(S.extra).count(), 0, 'one readout on desktop');
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
      mark('step');
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
      mark('stepDrawn');
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
        homes: '61',
        shadow: '59 m',
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
      const tip8 = tipEvidence(s, await shadowProfile(s, 'shadow-8 profile'));
      assertTip('tip8', tip8);
      const ratio = tip8.measuredReach / tip6.measuredReach;
      report.measurements.tipRatio = {
        measured: ratio,
        expected: tip8.expectedReach / tip6.expectedReach,
      };
      assert.ok(
        Math.abs(ratio - 8 / 6) <= 0.05 * (8 / 6),
        `+2 storeys lengthens the rendered shadow by ${ratio.toFixed(3)} (1.333 ±5%)`,
      );
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
        homes: '46',
        shadow: '45 m',
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
      // HOMES and SHADOW REACH: their own strip, on screen, over nothing.
      await locator(S.extra).waitFor({ state: 'visible' });
      await insideViewport(S.extra, MOBILE);
      for (const other of [...HUD, S.readout]) await noOverlap(S.extra, other);
      const s = await massing();
      const shadowPoints = await groundPoints(
        alongSun(
          s,
          [0.3, 0.45, 0.6].map(
            (f) => halfWidth(s) + f * shadowLength(s, s.massing.heightMeters),
          ),
        ),
      );
      await clearOfMassing(shadowPoints);
      await clearOfMassing(shadowPoints, S.extra);
      await legibility('readout-mobile');
      await legibility('extra-mobile', S.extra);
      await screenshot('07-mobile-readout');
      await page.setViewportSize(DESKTOP);
    },
  );
  await page.close();

  // PROTECT SIDEWALK on its own page: the block at its default six storeys.
  page = await openPage(context, 'shadow-fit');
  const sinceOpen = () => (Date.now() - opened['shadow-fit']) / 1000;
  const fitMarks = {};
  await check(
    'PROTECT SIDEWALK at winter noon: the edge is set 20 m across the street and six storeys reach 15 m onto the sidewalk',
    async () => {
      await startup(true, SITE_SOUTH);
      // A June scene: not winter, so the study offers WINTER NOON.
      await setSun(SUN_TIME);
      await locator(S.pill).click();
      await locator(S.play).waitFor({ state: 'visible' });
      await selectPlot();
      fitMarks.start = sinceOpen();
      await massingOn(PLOT);
      assert.equal(await locator(S.tip).count(), 0, 'no study until asked');
      assert.equal(await locator(`${S.readout} button`).count(), 3);
      await locator(S.studyToggle).click();
      await locator(S.ring).waitFor({ state: 'hidden' });
      await locator(S.winter).click();
      await until(
        () => {
          const s = window.__gevCityMassing.snapshot();
          return (
            Math.abs(s.sun.azimuthDeg - 180) < 1 && s.drawn && s.study.drawn
          );
        },
        'the scene at winter solar noon, the study drawn',
        30000,
      );
      assert.equal(
        await locator(S.winter).count(),
        0,
        'the scene is in winter',
      );
      let s = await massing();
      // The sun is citySun's at 21 Dec solar noon (28.8° at San Francisco).
      assert.ok(
        Math.abs(s.sun.elevationDeg - 28.8) <= 1,
        `sun altitude ${s.sun.elevationDeg}`,
      );
      assert.deepEqual(
        [s.study.edgeMeters, s.study.edgeSet, (await study()).assumed],
        [20, false, true],
        'the edge is 20 m, labelled ASSUMED until the player sets it',
      );
      // The keyboard path: the distance stepper.
      await locator(S.farther).focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
      await until(
        () => window.__gevCityMassing.snapshot().study.edgeMeters === 23,
        'the stepper moved the edge to 23 m',
        20000,
      );
      assert.equal((await study()).rows.distance, '23 m');
      assert.equal((await study()).assumed, false, 'set by the player');
      // The pointer path: SET ON MAP, then a click on the ground 20 m across.
      const at = await edgePoint(20);
      assert.ok(at, 'a free spot 20 m beyond the block face');
      await locator(S.pick).click();
      await page.mouse.move(at.x, at.y);
      await page.mouse.click(at.x, at.y);
      await until(
        () => {
          const s = window.__gevCityMassing.snapshot();
          return (
            s.study.edgeMeters === 20 &&
            !s.study.picking &&
            s.drawn &&
            s.study.drawn
          );
        },
        'the click set the edge 20 m from the block face',
        30000,
      );
      assert.equal((await play()).plot.id, PLOT, 'the plot stays selected');
      await page.waitForTimeout(1500);
      s = await massing();
      const plan = planOf(s);
      assert.equal(s.storeys, 6);
      assert.deepEqual(
        plan.lines.map((line) => [line.kind, line.storeys]),
        [
          ['now', 6],
          ['fit', 3],
        ],
      );
      assertDrawn(s, plan);
      const shown = await study();
      report.measurements.shadowReaches = { study: s.study, shown, at };
      assert.deepEqual(shown.tips, {
        now: shadowTip(plan.now),
        fit: shadowTip(plan.fit),
      });
      assert.deepEqual(shown.tips, {
        now: 'SHADOW NOW 35 m · 15 m ONTO SIDEWALK EST',
        fit: 'FIT TO SUN 17 m · CLEARS SIDEWALK BY 3 m EST',
      });
      assert.deepEqual(shown.rows, {
        distance: '20 m',
        sun: '29° EST',
        floors: '6 EST',
        edge: '15 m EST',
      });
      assert.equal(shown.edgeLabel, 'Onto sidewalk');
      assert.equal(shown.cost, null, 'no change yet, no cost line');
      assert.equal(shown.fit, 'Fit to sun · Floors 6 → 3 EST');
      assert.deepEqual(await readout(), shows(s));
      await insideViewport(S.study, DESKTOP);
      await insideViewport(S.tip, DESKTOP);
      for (const other of [...HUD, S.readout, S.tip])
        await noOverlap(S.study, other);
      await noOverlap(
        `${S.tip}[data-city-shadow-tip="now"]`,
        `${S.tip}:not([data-city-shadow-tip="now"])`,
      );
      fitMarks.reaches = sinceOpen();
      await screenshot('09-shadow-reaches');
    },
  );

  await check(
    'FIT TO SUN: three storeys, the shadow clears the sidewalk by 3 m; WAS dashed and NOW filled on the ground',
    async () => {
      const before = await massing();
      await locator(S.fit).click();
      await until(
        () => {
          const s = window.__gevCityMassing.snapshot();
          return s.storeys === 3 && s.drawn && s.study.drawn;
        },
        'three storeys, the study drawn',
        30000,
      );
      await page.waitForTimeout(1500);
      const s = await massing();
      const plan = planOf(s, 6);
      assert.deepEqual(
        plan.lines.map((line) => [line.kind, line.storeys]),
        [
          ['was', 6],
          ['now', 3],
        ],
      );
      assertDrawn(s, plan);
      assert.ok(
        Math.abs(s.study.drawn.was - before.study.drawn.now) < 1e-6,
        'the dashed WAS line is the six-storey shadow',
      );
      assert.ok(
        Math.abs(s.blockExtrudedHeight - s.base - 9.6) < 1e-6,
        `the block itself re-extruded: ${s.blockExtrudedHeight - s.base} m`,
      );
      const shown = await study();
      const entities = await page.evaluate(() =>
        window.__godsEyeView.viewer.dataSources
          .getByName('gev-city-massing')[0]
          .entities.values.map((entity) => entity.id)
          .filter((id) => id.includes('-shadow-'))
          .sort(),
      );
      report.measurements.shadowFit = {
        study: s.study,
        shown,
        entities,
        // What a reader of either screenshot should answer (the M1 function).
        expected: {
          before_m: Math.round(plan.was.reachMeters),
          after_m: Math.round(plan.now.reachMeters),
          before_reaches: plan.was.overMeters > 0,
          after_reaches: plan.now.overMeters > 0,
          floors_before: plan.was.storeys,
          floors_after: plan.now.storeys,
        },
        marks: { ...fitMarks, fitted: sinceOpen() },
      };
      assert.deepEqual(entities, [
        'city-massing-shadow-edge',
        'city-massing-shadow-now',
        'city-massing-shadow-was',
      ]);
      assert.deepEqual(shown.tips, {
        was: shadowTip(plan.was),
        now: shadowTip(plan.now),
      });
      assert.deepEqual(shown.tips, {
        was: 'SHADOW WAS 35 m · 15 m ONTO SIDEWALK EST',
        now: 'SHADOW NOW 17 m · CLEARS SIDEWALK BY 3 m EST',
      });
      assert.deepEqual(shown.rows, {
        distance: '20 m',
        sun: '29° EST',
        floors: '6 → 3 EST',
        edge: '3 m EST',
      });
      assert.equal(shown.edgeLabel, 'Clears sidewalk by');
      // What the cut cost: the homes and FAR of six storeys beside three.
      assert.equal(shown.cost, 'Homes 46 → 23 EST · FAR 3.84 → 1.92');
      assert.equal(shown.fit, 'Fit to sun');
      assert.equal(shown.fitDisabled, true, 'fitted: nothing more to cut');
      // HOMES and FAR follow in the massing readout.
      const values = await readout();
      assert.deepEqual(values, shows(s));
      assert.deepEqual(values, {
        height: '9.6 m',
        storeys: '3',
        far: '1.92',
        floor: '3,072 m²',
        homes: '23',
        shadow: '17 m',
      });
      await insideViewport(S.study, DESKTOP);
      await insideViewport(S.tip, DESKTOP);
      for (const other of [...HUD, S.readout, S.tip])
        await noOverlap(S.study, other);
      await noOverlap(
        `${S.tip}[data-city-shadow-tip="now"]`,
        `${S.tip}:not([data-city-shadow-tip="now"])`,
      );
      const saved = await storage();
      assert.equal(saved[KEY], doc, 'the study never writes the city document');
      assert.deepEqual(
        Object.keys(saved).filter((k) => /massing|shadow/i.test(k)),
        [],
        'no massing or shadow key in storage',
      );
      await screenshot('10-fit-to-sun');
      await page.waitForTimeout(1500);
      report.measurements.shadowFit.marks.end = sinceOpen();
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
    // The 30 s demo, cut from the journey page alone: no loading splash, no
    // shadow-off frame. Evidence only: a missing cut does not fail the run.
    const journey = report.video.find((v) => v.role === 'journey')?.webm;
    try {
      const cut = demoCut(report.marks);
      const graph = [
        ...cut.map(
          (c, i) =>
            `[0:v]trim=start=${c.from.toFixed(3)}:end=${c.to.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${c.hold.toFixed(3)}[s${i}]`,
        ),
        `${cut.map((_, i) => `[s${i}]`).join('')}concat=n=${cut.length}:v=1:a=0,fps=25,format=yuv420p[v]`,
      ].join(';');
      const mp4 = path.join(videoDir, 'demo.mp4');
      const r = spawnSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        journey,
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-movflags',
        '+faststart',
        '-t',
        '30',
        mp4,
      ]);
      report.demo = {
        cut,
        mp4: r.status === 0 ? mp4 : null,
        error: r.status === 0 ? undefined : String(r.stderr),
      };
    } catch (error) {
      report.demo = { error: String(error) };
    }
  }
  report.finishedAt = new Date().toISOString();
  await json('summary.json', report);
  console.log(
    `${report.status.toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} assertions; report ${path.join(output, 'summary.json')}`,
  );
}
