#!/usr/bin/env node
// City loop v2 capture: 6 fixed beats of the REAL GEV city builder, plus the
// Cozy Valley post-process variant (arm a) of each beat, plus a journey video.
// Reuses the selectors and flows of scripts/qa-city-play.mjs and
// scripts/qa-city-massing.mjs (same plot, same site, same sun).
//
//   node downstream/city-loop/capture/capture.mjs --app <app checkout> \
//        --url http://127.0.0.1:4187 --out <dir> [--video] [--label spike]
//
// The app must already be served by `vite` from <app checkout> (dev server:
// the flows import /src/... modules in the page, as the QA journeys do), and
// <app checkout>/.env must hold CESIUM_ION_TOKEN (never printed here).
// This file must be served by the same vite root so the page can import
// /downstream/city-loop/filter/cozyValley.js (copy or symlink downstream/ in).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      const next = all[i + 1];
      acc.push([a.slice(2), next && !next.startsWith('--') ? next : true]);
    }
    return acc;
  }, []),
);
const APP = path.resolve(args.app || '.');
const BASE = args.url || 'http://127.0.0.1:4187';
const OUT = path.resolve(args.out || 'downstream/city-loop/runs/r0/capture');
const LABEL = args.label || 'app';
const VIDEO = Boolean(args.video);
// Round 1: extra app URL params (e.g. --query cityR1=all) and --look-app, which
// takes each beat's LOOK render from the app's own ?look=cozy chain
// (src/standalone/cozyValleyLook.js) instead of the harness filter.
const QUERY = typeof args.query === 'string' ? args.query : '';
const LOOK_APP = Boolean(args['look-app']);
// exp/city-loop-v3: --no-cozy skips the per-beat Cozy Valley variants (the look is the app's own).
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('playwright-core');
const { siteForPlot } = await import(
  pathToFileURL(path.join(APP, 'scripts/qa-massing-measure.mjs')).href
);

// Frozen capture contract (changing any of these starts a new baseline).
const VIEWPORT = { width: 1600, height: 1000 };
// exp/city-loc-green: ?cityLoc=<key> in --query also picks the QA plot (src/data/cityLocations.js);
// exp/city-loop-v4: so does ?city=hero (its hero location) when no cityLoc is given
const QP = new URLSearchParams(QUERY);
const HERO = QP.get('city') === 'hero';
const { CITY_LOCATIONS, HERO_CITY_LOCATION } = QP.get('cityLoc') || HERO
  ? await import(pathToFileURL(path.join(APP, 'src/data/cityLocations.js')).href)
  : { CITY_LOCATIONS: {} };
const LOC = QP.get('cityLoc') ?? (HERO ? HERO_CITY_LOCATION : null);
if (LOC && !CITY_LOCATIONS[LOC]) throw new Error(`unknown cityLoc ${LOC}`);
const PLOT = process.env.CAPTURE_PLOT || CITY_LOCATIONS[LOC]?.gridPlot || CITY_LOCATIONS[LOC]?.plot || 'plot-n105201-126637'; // QA default: Washington Sq, SF
// exp/city-loop-v4 (licence lane; Google Map Tiles policies and GMP ToS 3.2.3):
// a frame that shows Google photoreal tiles never goes to a judge, the proxy, a
// report, a gallery or git. In-context frames (and the recorded video) are
// written only to ONE ephemeral dir, clearly named and outside --out, to be
// deleted after a human looks; --judge-only writes none at all. Judge frames
// (--own) hide every 3D tileset, are checked Google-free on screen before they
// are written, and are tagged in manifest.frames, which critics/judge_gate.py
// requires before any critic reads an image.
const JUDGE_ONLY = Boolean(args['judge-only']);
const SANITY = fileURLToPath(new URL('../critics/sanity_gate.py', import.meta.url));
const PLACE = CITY_LOCATIONS[LOC]?.place ?? 'San Francisco'; // q03: the location's own place name
// --own: after each beat shot, one more with every 3D tileset hidden (no Google pixels) for judging
const OWN = Boolean(args.own) || JUDGE_ONLY;
const COZY = !args['no-cozy'] && !JUDGE_ONLY;
const EPHEMERAL = path.resolve(
  typeof args['ephemeral-dir'] === 'string' ? args['ephemeral-dir'] : path.join(os.tmpdir(), 'gev-EPHEMERAL-google-tiles-do-not-copy'),
);
if (!EPHEMERAL.includes('gev-EPHEMERAL-google-tiles')) throw new Error('--ephemeral-dir must keep "gev-EPHEMERAL-google-tiles" in its name');
if (EPHEMERAL === OUT || EPHEMERAL.startsWith(OUT + path.sep) || OUT.startsWith(EPHEMERAL + path.sep))
  throw new Error('--ephemeral-dir and --out must not contain each other');
const SITE = siteForPlot(PLOT); // 600 m, looking north
const SUN_TIME = '2026-06-21T15:00:00Z'; // QA morning sun (az 78, el 23)
const DISTRICT_ALT = 1500;
const BEATS = ['district', 'select', 'reimagine', 'build', 'shadow', 'growth'];
const S = {
  pill: '#top-center-actions [data-city-builder-open]',
  play: '[data-city-play]',
  ring: '[data-city-play-wheel] .city-play-wheel-ring',
  toggle: '[data-city-massing-toggle]',
  studyToggle: '[data-city-shadow-toggle]',
  winter: '[data-city-shadow-winter]',
  fit: '[data-city-shadow-fit]',
  growth: '[data-city-growth]',
  growthToggle: '[data-city-growth-toggle]',
  credits: '#cesium-credits',
};

const manifest = {
  schema: 'city-loop-v2/capture@2',
  label: LABEL,
  startedAt: new Date().toISOString(),
  app: {},
  url: null,
  viewport: VIEWPORT,
  plot: PLOT,
  site: SITE,
  sunTime: SUN_TIME,
  browser: {},
  tiles: {},
  frameTiming: {},
  beats: {},
  cozy: {},
  own: {},
  // every file in --out with its tiles tag (critics/judge_gate.py reads this)
  frames: {},
  // in-context files (may show Google tiles): names only; the files live in ephemeralDir
  ephemeral: [],
  ephemeralDir: EPHEMERAL,
  judgeOnly: JUDGE_ONLY,
  location: LOC ?? 'northbeach(default)',
  console: [],
  pageErrors: [],
  marks: {},
};
const git = (...a) =>
  spawnSync('git', ['-C', APP, ...a], { encoding: 'utf8' }).stdout.trim();
manifest.app = {
  sha: git('rev-parse', 'HEAD'),
  subject: git('log', '-1', '--format=%s'),
  dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
};

let page;
let t0;
const mark = (k) => (manifest.marks[k] = (Date.now() - t0) / 1000);
const sleep = (ms) => page.waitForTimeout(ms);
async function until(fn, label, timeout = 60000, arg) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 250 });
  } catch (e) {
    throw new Error(`${label}: ${e.message.split('\n')[0]}`);
  }
}
const sha256 = async (f) =>
  createHash('sha256').update(await readFile(f)).digest('hex');
// What is on screen now. Google-free only when no 3D tileset is shown (photoreal
// may come through ion, so any tileset counts), the globe, if shown, has no
// Google imagery, and no Google logo is in the credits. Unknown counts as Google.
async function tilesNow() {
  return page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    const s = v.scene;
    const p = s.primitives;
    let shownTilesets = 0;
    for (let i = 0; i < p.length; i++) {
      const x = p.get(i);
      if ('tilesLoaded' in x && typeof x.root !== 'undefined' && x.show) shownTilesets++;
    }
    const layers = [];
    const il = v.imageryLayers;
    for (let i = 0; i < (il?.length ?? 0); i++) {
      const l = il.get(i);
      if (l.show) layers.push(String(l.imageryProvider?.url ?? l.imageryProvider?._resource?.url ?? l.imageryProvider?.constructor?.name ?? ''));
    }
    const googleLogos = [...document.querySelectorAll('#cesium-credits img, .cesium-credit-lightbox img')].filter((i) => /google/i.test(i.src)).length;
    const globe = Boolean(s.globe?.show);
    const globeGoogle = globe && layers.some((u) => /google/i.test(u));
    return {
      shownTilesets,
      globe,
      imagery: globe ? layers.map((u) => u.replace(/([?&](key|access_token|token)=)[^&]+/g, '$1REDACTED').slice(0, 120)) : [],
      googleLogos,
      googleTiles: shownTilesets > 0 || globeGoogle || googleLogos > 0,
    };
  });
}
// kind 'judge': refused unless Google-free, written to --out and tagged.
// kind 'context' (default): may show Google tiles; written only to EPHEMERAL, or not at all with --judge-only.
async function shot(name, kind = 'context') {
  const tiles = await tilesNow().catch((e) => ({ error: e.message.split('\n')[0], googleTiles: true }));
  if (kind === 'judge') {
    if (tiles.googleTiles !== false) throw new Error(`judge frame ${name} refused: Google tiles may be on screen ${JSON.stringify(tiles)}`);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, timeout: 60000 });
    const rec = { file: path.basename(file), sha256: await sha256(file) };
    manifest.frames[rec.file] = { ...rec, kind: 'judge', googleTiles: false, tilesSource: 'none: every 3D tileset hidden', tiles };
    return rec;
  }
  if (JUDGE_ONLY) return { file: null, skipped: 'judge-only: in-context frame not written', googleTiles: tiles.googleTiles };
  await mkdir(EPHEMERAL, { recursive: true });
  const file = path.join(EPHEMERAL, `${LABEL}--${name}.png`);
  await page.screenshot({ path: file, timeout: 60000 });
  const rec = { file: path.basename(file), dir: 'ephemeral', sha256: await sha256(file), googleTiles: tiles.googleTiles };
  manifest.ephemeral.push({ ...rec, tiles });
  return rec;
}
async function render(ms = 1200) {
  await page.evaluate(() => {
    const g = window.__godsEyeView;
    g?.requestRender?.('capture');
    g?.viewer?.scene?.requestRender?.();
  });
  await sleep(ms);
}
async function tilesLoaded(timeout = 120000) {
  await until(
    () => {
      const { viewer, mapStackController } = window.__godsEyeView;
      const prim = viewer.scene.primitives;
      const ts = Array.from({ length: prim.length }, (_, i) => prim.get(i)).some(
        (p) => p.show && p.tilesLoaded === true,
      );
      const surface = viewer.scene.globe?.show ? viewer.scene.globe.tilesLoaded : ts;
      return surface && mapStackController?.getState?.().status === 'ready';
    },
    'map tiles loaded',
    timeout,
  );
}
async function settle() {
  // Tiles must report loaded on 3 consecutive checks 1 s apart (SwiftShader refines slowly).
  for (let ok = 0, i = 0; ok < 3 && i < 40; i++) {
    await tilesLoaded(90000).catch((e) => manifest.console.push({ type: 'capture-warn', text: e.message }));
    await render(1000);
    ok = (await page.evaluate(() => {
      const p = window.__godsEyeView.viewer.scene.primitives;
      return Array.from({ length: p.length }, (_, k) => p.get(k)).some((x) => x.show && x.tilesLoaded === true);
    })) ? ok + 1 : 0;
  }
  await render(1500);
}
async function plotPoint(id) {
  return page.evaluate(async (plotId) => {
    const { isGridPlot, plotFromId } = await import('/src/data/cityPlot.js');
    const { viewer } = window.__godsEyeView;
    const { scene } = viewer;
    const plot = plotFromId(plotId);
    const { center } = plot;
    const at = { longitude: (center.lon * Math.PI) / 180, latitude: (center.lat * Math.PI) / 180, height: 0 };
    const exclude = ['gev-city-massing', 'gev-city-play'].flatMap(
      (n) => viewer.dataSources.getByName(n)[0]?.entities.values ?? [],
    );
    const s = scene.sampleHeightSupported ? scene.sampleHeight(at, exclude) : undefined;
    const diorama = window.__gevDiorama;
    at.height = isGridPlot(plot) && diorama?.state.ready
      ? diorama.groundAt([center.lon, center.lat])
      : Number.isFinite(s) ? s : (scene.globe.getHeight(at) ?? 0);
    const p = scene.cartesianToCanvasCoordinates(scene.globe.ellipsoid.cartographicToCartesian(at));
    if (!p) return null;
    const r = scene.canvas.getBoundingClientRect();
    const x = Math.round(p.x + r.left);
    const y = Math.round(p.y + r.top);
    return { x, y, free: document.elementFromPoint(x, y) === scene.canvas };
  }, id);
}
async function noFlight() {
  await until(() => !window.__godsEyeView.viewer.camera._currentFlight, 'camera settled', 30000);
}
async function reopenWheel() {
  if (await page.locator(S.ring).isVisible()) return;
  const at = await page.evaluate(() => window.__gevCityPlay.snapshot().anchors?.plot);
  if (!at) throw new Error('selected plot not projected');
  await page.mouse.click(at.x, at.y);
  await page.locator(S.ring).waitFor({ state: 'visible', timeout: 90000 });
}
async function frameTiming(name, ms = 3000) {
  // rAF cadence while the scene renders continuously (forced requestRender).
  manifest.frameTiming[name] = await page.evaluate(async (dur) => {
    const v = window.__godsEyeView.viewer;
    const times = [];
    const off = v.scene.postRender.addEventListener(() => times.push(performance.now()));
    const end = performance.now() + dur;
    while (performance.now() < end) {
      v.scene.requestRender();
      await new Promise((r) => requestAnimationFrame(r));
    }
    off();
    const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
    return { frames: times.length, seconds: dur / 1000, fps: times.length / (dur / 1000), p50ms: q(0.5), p95ms: q(0.95) };
  }, ms);
}
async function attribution() {
  const text = await page
    .locator(S.credits)
    .innerText({ timeout: 5000 })
    .catch(() => '');
  const html = await page.evaluate(() => {
    const out = [];
    const v = window.__godsEyeView?.viewer;
    const cd = v?.creditDisplay;
    const all = [
      ...(cd?._currentFrameCredits?.lightboxCredits?.values ?? []),
      ...(cd?._currentFrameCredits?.screenCredits?.values ?? []),
    ];
    for (const c of all) out.push(c.credit?.html ?? c.html ?? '');
    const imgs = [...document.querySelectorAll('#cesium-credits img')].map((i) => i.src.slice(0, 120));
    // static credits (the diorama's OSM credit, the live terrain's ion attributions) and their on-screen box
    const statics = (cd?._staticCredits ?? []).map((c) => String(c?.html ?? '').slice(0, 240));
    const el = document.querySelector('#cesium-credits');
    const cs = el && getComputedStyle(el);
    const r = el?.getBoundingClientRect();
    const box = el ? { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, rect: [r.x, r.y, r.width, r.height].map(Math.round) } : null;
    return { credits: out.slice(0, 20), imgs, statics, box };
  });
  const prim = await page.evaluate(() => {
    const v = window.__godsEyeView.viewer;
    const p = v.scene.primitives;
    return {
      globeShown: v.scene.globe.show,
      stack: window.__godsEyeView.mapStackController?.getState?.(),
      tilesets: Array.from({ length: p.length }, (_, i) => p.get(i))
        .filter((x) => 'tilesLoaded' in x)
        .map((x) => ({ show: x.show, url: String(x.resource?.url ?? x._url ?? '').replace(/([?&](key|access_token)=)[^&]+/g, '$1REDACTED').slice(0, 160) })),
    };
  });
  const blob = JSON.stringify([text, html, prim]);
  return {
    creditText: text.replace(/\s+/g, ' ').trim().slice(0, 400),
    ...html,
    ...prim,
    google: /google/i.test(blob),
    // Verdict from what renders, not from the credit list (which names every provider):
    rendering:
      prim.stack?.activeId === 'photoreal' && !prim.globeShown && prim.tilesets.some((t) => t.show && /tile\.googleapis\.com\/v1\/3dtiles/.test(t.url))
        ? 'google-photoreal-3d-tiles'
        : prim.globeShown ? `imagery-globe:${prim.stack?.activeId}` : 'unknown',
  };
}
async function cozyVariants(beat) {
  // Arm (a): install the Cozy Valley chain, shoot full + 50 % wipe, remove.
  const report = await page.evaluate(async (app) => {
    window.__gevCozyValley?.remove?.();
    const look = app
      ? (await import('/src/standalone/cozyValleyLook.js')).installCozyValleyLook(window.__godsEyeView.viewer, { wipe: 0 })
      : (await import('/downstream/city-loop/filter/cozyValley.js')).installCozyValley(window.__godsEyeView.viewer, { wipe: 0 });
    window.__gevCozyValley = look;
    return { ...look.report, source: app ? 'app:src/standalone/cozyValleyLook.js' : 'harness:filter/cozyValley.js' };
  }, LOOK_APP);
  await render(1800);
  const full = await shot(`${beat}--cozy`);
  // Diagnostic: the grade stage alone (no bloom/AO) to attribute look changes per stage.
  await page.evaluate((app) => {
    const v = window.__godsEyeView.viewer;
    if (app) return window.__gevCozyValley.set({ bloom: 0 });
    window.__cozyBloomWas = v.scene.postProcessStages.bloom.enabled;
    v.scene.postProcessStages.bloom.enabled = false;
  }, LOOK_APP);
  await render(1200);
  const gradeOnly = await shot(`${beat}--cozy-grade-only`);
  await page.evaluate((app) => {
    if (app) return window.__gevCozyValley.set({ bloom: 0.9 });
    window.__godsEyeView.viewer.scene.postProcessStages.bloom.enabled = window.__cozyBloomWas;
  }, LOOK_APP);
  await page.evaluate(() => window.__gevCozyValley.set({ wipe: 0.5 }));
  await render(1200);
  const wipe = await shot(`${beat}--cozy-wipe`);
  await page.evaluate(() => {
    window.__gevCozyValley.remove();
    delete window.__gevCozyValley;
  });
  await render(600);
  manifest.cozy[beat] = { report, full, gradeOnly, wipe };
}
async function ownShot(beat) {
  // Judge frame: every shown 3D tileset (Google photoreal) hidden, a plain
  // backdrop behind; the diorama, HUD and massing stay. Restored right after.
  // window.__gevJudgeFrame tells massing this is not a map switch (exp/city-loop-v4:
  // without it massing rebuilt the block, which was missing from Presidio's frames).
  const hidden = await page.evaluate(() => {
    window.__gevJudgeFrame = true;
    const v = window.__godsEyeView.viewer;
    const s = v.scene;
    const p = s.primitives;
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const x = p.get(i);
      if ('tilesLoaded' in x && x.show && typeof x.root !== 'undefined') {
        x.show = false;
        out.push(i);
      }
    }
    window.__ownWas = { idx: out, bg: s.backgroundColor.clone(), sky: s.skyAtmosphere?.show, box: s.skyBox?.show };
    s.backgroundColor = window.Cesium?.Color?.fromCssColorString?.('#e6e8d6') ?? s.backgroundColor.constructor.fromCssColorString('#e6e8d6');
    if (s.skyAtmosphere) s.skyAtmosphere.show = false;
    if (s.skyBox) s.skyBox.show = false;
    return out.length;
  });
  let f;
  let credits;
  let massing;
  let sanity;
  try {
    await render(2500);
    await until(() => {
      const m = window.__gevCityMassing?.snapshot?.();
      return !m?.shown || m.drawn;
    }, 'massing drawn in the judge frame', 20000).catch((e) => manifest.console.push({ type: 'capture-warn', text: e.message }));
    massing = await page.evaluate(() => {
      const m = window.__gevCityMassing?.snapshot?.();
      return m ? { shown: m.shown, drawn: m.drawn, plotId: m.plotId ?? null } : null;
    });
    const evidence = await page.evaluate(() => {
      const diorama = window.__gevDiorama;
      return {
        fixture: diorama?.state.fixture,
        hud: document.querySelector('[data-city-game-place] [translate="no"]')?.innerText?.trim() ?? '',
        placements: window.__gevCityPlacements?.()?.map((p) => {
          const centre = [0, 1].map((i) =>
            p.footprint.reduce((sum, point) => sum + point[i], 0) / p.footprint.length,
          );
          return {
            ...p,
            terrain: [...p.footprint, centre].map((point) =>
              diorama?.covers(point) ? diorama.groundAt(point) : null,
            ),
          };
        }),
      };
    });
    // Keep live terrain samples in memory. The written manifest holds the verdict
    // and measured offsets so the terrain grid and raw heights stay ephemeral.
    const input = { ...evidence, beat, expectedPlace: PLACE };
    if (evidence.fixture?.startsWith('/city-diorama/') && evidence.placements) {
      const fixture = path.join(APP, 'public', evidence.fixture);
      const osm = args['sanity-osm'] ? [path.resolve(args['sanity-osm'])] : [];
      const checked = spawnSync('python3', [SANITY, fixture, ...osm], {
        input: JSON.stringify(input),
        encoding: 'utf8',
      });
      if (checked.stdout && [0, 2].includes(checked.status)) sanity = JSON.parse(checked.stdout);
    }
    sanity ??= { pass: false, failures: [{ check: 'missing-sanity-evidence' }] };
    f = await shot(`${beat}--own`, 'judge');
    Object.assign(manifest.frames[f.file], { sanity });
    credits = await attribution().catch((e) => ({ error: e.message.split('\n')[0] }));
  } finally {
    await page.evaluate(() => {
      const s = window.__godsEyeView.viewer.scene;
      const w = window.__ownWas;
      if (w) {
        for (const i of w.idx) s.primitives.get(i).show = true;
        s.backgroundColor = w.bg;
        if (s.skyAtmosphere) s.skyAtmosphere.show = w.sky;
        if (s.skyBox) s.skyBox.show = w.box;
      }
      delete window.__ownWas;
      delete window.__gevJudgeFrame;
    });
  }
  await render(1500);
  manifest.own[beat] = { ...f, hiddenTilesets: hidden, googleTiles: false, massing, credits, sanity };
}
async function beat(name, run) {
  const started = Date.now();
  const rec = { status: 'pending' };
  manifest.beats[name] = rec;
  try {
    const extra = await run();
    await settle();
    mark(name);
    Object.assign(rec, await shot(name), extra || {}, { status: 'ok' });
    if (OWN) await ownShot(name).catch((e) => (manifest.own[name] = { error: e.message.split('\n')[0] }));
    if (COZY) await cozyVariants(name).catch((e) => (manifest.cozy[name] = { error: e.message.split('\n')[0] }));
  } catch (e) {
    rec.status = 'failed';
    rec.error = e.message.split('\n')[0];
    try {
      Object.assign(rec, { failureShot: await shot(`${name}--failure`) });
    } catch {}
  }
  rec.seconds = (Date.now() - started) / 1000;
  console.log(`BEAT ${name} ${rec.status}${rec.error ? ' ' + rec.error : ''}`);
}

await mkdir(OUT, { recursive: true });
const env = { ...process.env };
for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY']) delete env[k];
const launchArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ozone-platform=headless',
  '--ignore-gpu-blocklist',
];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  env,
  args: launchArgs,
});
manifest.browser = { version: browser.version(), args: launchArgs };
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  serviceWorkers: 'block',
  // the recorded video shows Google tiles: ephemeral dir only, never with --judge-only
  ...(VIDEO && !JUDGE_ONLY && { recordVideo: { dir: path.join(EPHEMERAL, `${LABEL}-video-raw`), size: VIEWPORT } }),
});
// The fixture concept provider only: any network concept request is blocked.
await context.route('**/api/city-concept*', (r) => r.abort('blockedbyclient'));
page = await context.newPage();
page.setDefaultTimeout(60000); // v3: SwiftShader + video recording is slower than the 20 s default
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) || /\[Init\]/.test(m.text()))
    manifest.console.push({ type: m.type(), text: m.text().replace(/(key|token|access_token)=[^&\s"]+/gi, '$1=REDACTED').slice(0, 300) });
});
page.on('pageerror', (e) => manifest.pageErrors.push(e.message.slice(0, 300)));

const url = new URL(BASE);
url.searchParams.set('welcome', '0');
url.searchParams.set('massing', '1');
for (const [k, v] of new URLSearchParams(QUERY)) url.searchParams.set(k, v);
manifest.query = QUERY;
manifest.lookSource = LOOK_APP ? 'app' : 'harness';
url.hash = new URLSearchParams({
  v: '2',
  ...Object.fromEntries(Object.entries(SITE).map(([k, v]) => [k, `${v}`])),
  roll: '0',
  style: 'normal',
}).toString();
manifest.url = url.href;
t0 = Date.now();
try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await until(
    () => window.__godsEyeView?.viewer && document.querySelector('#loading-screen')?.classList.contains('hidden'),
    'app ready',
    180000,
  );
  await until(
    ({ lat, lon }) => {
      const p = window.__godsEyeView.viewer.camera.positionCartographic;
      return Math.abs((p.latitude * 180) / Math.PI - lat) < 0.02 && Math.abs((p.longitude * 180) / Math.PI - lon) < 0.02;
    },
    'camera at site',
    90000,
    SITE,
  );
  await tilesLoaded(180000);
  mark('ready');
  manifest.tiles = await attribution();
  await frameTiming('startup');
  await page.evaluate(async (ms) => {
    const { worldClock } = await import('/src/time/worldClock.js');
    worldClock.seek(ms);
    window.__godsEyeView.requestRender?.('capture-sun');
  }, Date.parse(SUN_TIME));

  await beat('district', async () => {
    await page.locator(S.pill).click();
    await page.locator(S.play).waitFor({ state: 'visible' });
    // District = far zoom: same heading, camera pulled back/up (DISTRICT_ALT).
    await page.evaluate(({ lat, lon, alt }) => {
      const v = window.__godsEyeView.viewer;
      const e = v.scene.globe.ellipsoid;
      v.camera.setView({
        destination: e.cartographicToCartesian({ latitude: ((lat - 0.0135) * Math.PI) / 180, longitude: (lon * Math.PI) / 180, height: alt }),
        orientation: { heading: 0, pitch: (-42 * Math.PI) / 180, roll: 0 },
      });
    }, { lat: SITE.lat, lon: SITE.lon, alt: DISTRICT_ALT });
    await sleep(8000);
    // FORK-ONLY (exp/city-look-diorama): ?look=diorama builds its district in the page; wait for it.
    if (/look=diorama|city=(v3|hero)/.test(QUERY)) {
      await until(() => window.__gevDiorama?.state?.ready || window.__gevDioramaError, 'diorama ready', 300000).catch((e) => manifest.console.push({ type: 'capture-warn', text: e.message }));
      manifest.diorama = await page.evaluate(() => ({ state: window.__gevDiorama?.state ?? null, error: window.__gevDioramaError ?? null }));
      await sleep(3000);
    }
    return { tier: await page.evaluate(() => window.__gevCityPlay?.snapshot()?.tier ?? null), cameraAlt: DISTRICT_ALT };
  });
  await beat('select', async () => {
    await page.evaluate((site) => {
      const v = window.__godsEyeView.viewer;
      v.camera.setView({
        destination: v.scene.globe.ellipsoid.cartographicToCartesian({ latitude: (site.lat * Math.PI) / 180, longitude: (site.lon * Math.PI) / 180, height: site.alt }),
        orientation: { heading: (site.heading * Math.PI) / 180, pitch: (site.pitch * Math.PI) / 180, roll: 0 },
      });
    }, SITE);
    await settle();
    const at = await plotPoint(PLOT);
    if (!at?.free) throw new Error(`plot not on free map ${JSON.stringify(at)}`);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    await until(() => window.__gevCityPlay?.snapshot().plot, 'a plot', 20000);
    await noFlight();
    await page.locator(S.ring).waitFor({ state: 'visible', timeout: 30000 });
    const s = await page.evaluate(() => window.__gevCityPlay.snapshot());
    return { plotId: s.plot?.id, tier: s.tier };
  });
  await beat('reimagine', async () => {
    await reopenWheel();
    await page.locator('[data-city-play-action="reimagine"]').click();
    await until(
      () => {
        const s = window.__gevCityPlay.snapshot();
        return !s.framing && !s.pending && s.concepts.length > 0;
      },
      'concept stands on the plot',
      300000,
    );
    // The concept texture uploads slowly under SwiftShader; give it time.
    await sleep(5000);
    const label = await page.locator('[data-city-play-ai-label]').innerText().catch(() => null);
    return { aiLabel: label };
  });
  await beat('build', async () => {
    if (!(await page.locator(S.toggle).isVisible().catch(() => false))) await reopenWheel();
    await page.locator(S.toggle).click({ timeout: 120000 });
    await until(
      (id) => {
        const s = window.__gevCityMassing?.snapshot();
        return s?.shown && s.plotId === id && s.sampled && s.drawn;
      },
      'massing drawn',
      45000,
      PLOT,
    );
    await sleep(1200);
    const m = await page.evaluate(() => {
      const s = window.__gevCityMassing.snapshot();
      return { storeys: s.storeys, blockMaterial: s.blockMaterial };
    });
    return m;
  });
  await beat('shadow', async () => {
    await page.locator(S.studyToggle).click({ timeout: 120000 });
    await page.locator(S.winter).click({ timeout: 120000 });
    await until(
      () => {
        const s = window.__gevCityMassing.snapshot();
        return Math.abs(s.sun.azimuthDeg - 180) < 1 && s.drawn;
      },
      'winter solar noon',
      30000,
    );
    await page.locator(S.fit).click({ timeout: 90000 });
    await until(() => window.__gevCityMassing.snapshot().locks?.[window.__gevCityPlay.snapshot().plot.id], 'sun fit lock', 30000).catch(() => {});
    await sleep(1200);
    return { storeys: await page.evaluate(() => window.__gevCityMassing.snapshot().storeys) };
  });
  await beat('growth', async () => {
    const has = await page.evaluate(async () => {
      try {
        await import('/src/data/cityGrowth.js');
        return true;
      } catch {
        return false;
      }
    });
    if (!has) throw new Error('ABSENT: this app SHA has no growth timeline (src/data/cityGrowth.js)');
    const opposite = CITY_LOCATIONS[LOC]?.gridOppositePlot;
    const { far } = opposite ? { far: [opposite] } : await page.evaluate(async (plotId) => {
      const { PLOT_METERS, plotFromId, snapPlot } = await import('/src/data/cityPlot.js');
      const p = plotFromId(plotId);
      const list = [[4, 4], [4, -4], [-4, 4], [-4, -4]].map(([r, c]) =>
        snapPlot({
          lat: p.center.lat + (r * PLOT_METERS) / 111_320,
          lon: p.center.lon + (c * PLOT_METERS) / (111_320 * Math.cos((p.center.lat * Math.PI) / 180)),
        }).id,
      );
      return { far: list };
    }, PLOT);
    let hit = null;
    for (const id of far) {
      const at = await plotPoint(id);
      if (at?.free) { hit = at; break; }
    }
    if (!hit) throw new Error('no free far plot for the district');
    await page.mouse.move(hit.x, hit.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(hit.x, hit.y);
    await page.keyboard.up('Shift');
    // exp/city-loc-green: the district's size follows the picked cell (a click through dense canopy can land a row off: 20 plots); any district of 16+ counts, its size is recorded
    await until(() => (window.__gevCityPlay.snapshot().district?.length ?? 0) >= 16, 'district of 16+', 90000);
    const districtPlots = await page.evaluate(() => window.__gevCityPlay.snapshot().district.length);
    await noFlight();
    await page.locator(S.growthToggle).click({ timeout: 90000 });
    await page.locator('[data-city-growth-rail]').waitFor({ state: 'visible' });
    const stages = {};
    const stops = await page.locator('[data-city-growth-stop]').evaluateAll((els) => els.map((e) => e.dataset.cityGrowthStop));
    for (const id of stops) {
      // SwiftShader at ~1 fps needs longer than the 20 s default to settle a click (capture env, not app).
      await page.locator(`[data-city-growth-stop="${id}"]`).click({ timeout: 90000 });
      await sleep(1500);
      await settle();
      stages[id] = await shot(`growth--stage-${id}`);
    }
    return { stops, stages, districtPlots };
  });
  await frameTiming('end');
  if (/look=diorama|city=(v3|hero)/.test(QUERY)) {
    // fps with the diorama vs. without it, same camera (the growth beat's), same browser
    await page.evaluate(() => { const d = window.__gevDiorama; if (d) { d.model.show = false; d.stage.enabled = false; } });
    await frameTiming('end-diorama-hidden');
    await page.evaluate(() => { const d = window.__gevDiorama; if (d) { d.model.show = true; d.stage.enabled = true; } });
    manifest.dioramaEnd = await page.evaluate(() => window.__gevDiorama?.state ?? null);
  }
} catch (e) {
  manifest.fatal = e.message.split('\n')[0];
  try { await shot('fatal'); } catch {}
}
manifest.finishedAt = new Date().toISOString();
await page.close();
await context.close();
await browser.close();

if (VIDEO && !JUDGE_ONLY) {
  // in-context journey video (Google tiles): stays in the ephemeral dir
  const raw = path.join(EPHEMERAL, `${LABEL}-video-raw`);
  const webm = (await readdir(raw).catch(() => [])).find((f) => f.endsWith('.webm'));
  if (webm) {
    const src = path.join(raw, webm);
    const full = path.join(EPHEMERAL, `${LABEL}--journey-full.mp4`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', full]);
    // ~28 s cut: 4.5 s ending at each beat mark (click -> wheel -> reimagine -> build -> shadow -> growth).
    const parts = [];
    const order = BEATS.filter((b) => manifest.marks[b]);
    for (const [i, b] of order.entries()) {
      const end = manifest.marks[b] + 1.2;
      const start = Math.max(0, end - 4.6);
      const part = path.join(raw, `part-${i}.mp4`);
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', `${start}`, '-to', `${end}`, '-i', full,
        '-vf', `drawtext=text='${b.toUpperCase()}':x=24:y=h-48:fontsize=22:fontcolor=0x2EC8E8:box=1:boxcolor=0x000000AA:boxborderw=8`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', part]);
      parts.push(part);
    }
    const list = path.join(raw, 'parts.txt');
    await writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
    const cut = path.join(EPHEMERAL, `${LABEL}--journey.mp4`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', cut]);
    manifest.video = { full: path.basename(full), cut: path.basename(cut), beatsInCut: order, dir: 'ephemeral', googleTiles: true };
    for (const k of ['full', 'cut']) {
      const f = path.join(EPHEMERAL, manifest.video[k]);
      try { manifest.video[`${k}Sha256`] = await sha256(f); } catch { manifest.video[`${k}Error`] = 'missing'; }
    }
  }
}
// exp/city-loop-v4: the 20 s journey of judge frames (Google-free): 6 beats x 3.33 s
const judged = BEATS.filter((b) => manifest.own[b]?.file);
if (OWN && judged.length) {
  const dir = path.join(OUT, 'judge-parts');
  await mkdir(dir, { recursive: true });
  const parts = [];
  for (const [i, b] of judged.entries()) {
    const part = path.join(dir, `part-${i}.mp4`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '25', '-t', '3.333', '-i', path.join(OUT, manifest.own[b].file),
      '-vf', `drawtext=text='${b.toUpperCase()} · judge frame (no Google tiles)':x=24:y=h-48:fontsize=22:fontcolor=0x2EC8E8:box=1:boxcolor=0x000000AA:boxborderw=8`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-r', '25', part]);
    parts.push(part);
  }
  const list = path.join(dir, 'parts.txt');
  await writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
  const out = path.join(OUT, `judge20-${LABEL}.mp4`);
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
  try {
    const rec = { file: path.basename(out), sha256: await sha256(out) };
    manifest.frames[rec.file] = { ...rec, kind: 'judge-video', googleTiles: false, sanity: {
      pass: judged.every((b) => manifest.own[b].sanity?.pass === true),
    }, from: judged.map((b) => manifest.own[b].file) };
    manifest.judgeVideo = rec;
  } catch {
    manifest.judgeVideo = { error: 'missing' };
  }
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ app: manifest.app.sha, tiles: manifest.tiles.rendering, beats: Object.fromEntries(Object.entries(manifest.beats).map(([k, v]) => [k, v.status])), judgeFrames: Object.keys(manifest.frames).length, ephemeral: manifest.ephemeral.length, fatal: manifest.fatal ?? null }));
