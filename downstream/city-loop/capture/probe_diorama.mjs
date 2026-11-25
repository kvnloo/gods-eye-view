#!/usr/bin/env node
// FORK-ONLY (exp/city-look-diorama): fast look probe, not a beat capture.
//   node probe_diorama.mjs --app . --url http://127.0.0.1:4191 --out dir --query 'look=diorama&dio=...' [--views site,district,near]
// Opens the app at the capture site, opens the City builder (which mounts the
// diorama), and shoots each named camera at 1600x1000. Writes probe.json with
// the diorama state, page errors and console errors.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const APP = path.resolve(args.app);
const OUT = path.resolve(args.out);
await mkdir(OUT, { recursive: true });
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('playwright-core');
const { siteForPlot } = await import(pathToFileURL(path.join(APP, 'scripts/qa-massing-measure.mjs')).href);
// exp/city-loc-green: the plot follows ?cityLoc= in --query (exp/city-loop-v4: and ?city=hero)
const QP = new URLSearchParams(args.query || '');
const { CITY_LOCATIONS, HERO_CITY_LOCATION } = await import(pathToFileURL(path.join(APP, 'src/data/cityLocations.js')).href);
const LOC = QP.get('cityLoc') ?? (QP.get('city') === 'hero' ? HERO_CITY_LOCATION : null);
const SITE = siteForPlot(LOC ? CITY_LOCATIONS[LOC].plot : 'plot-n105201-126637');
// exp/city-loop-v4: in-context views may show Google tiles: ephemeral dir only
// (capture.mjs explains); --judge-only 1 skips them; --own frames are tagged.
const JUDGE_ONLY = Boolean(args['judge-only']);
const EPHEMERAL = path.join(os.tmpdir(), 'gev-EPHEMERAL-google-tiles-do-not-copy');
const VIEWS = {
  site: { lat: SITE.lat, lon: SITE.lon, alt: SITE.alt, heading: 0, pitch: -45 },
  district: { lat: SITE.lat - 0.0135, lon: SITE.lon, alt: 1500, heading: 0, pitch: -42 },
  near: { lat: SITE.lat + 0.0032, lon: SITE.lon - 0.0004, alt: 260, heading: 0, pitch: -38 },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ozone-platform=headless', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, timezoneId: 'UTC' })).newPage();
const log = { console: [], pageErrors: [], frames: {}, ephemeral: [], ephemeralDir: EPHEMERAL };
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log.console.push(m.text().replace(/(key|token|access_token)=[^&\s"]+/gi, '$1=REDACTED').slice(0, 400)));
page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 400)));
const url = new URL(args.url);
url.searchParams.set('welcome', '0');
url.searchParams.set('massing', '1');
for (const [k, v] of new URLSearchParams(args.query || '')) url.searchParams.set(k, v);
url.hash = new URLSearchParams({ v: '2', ...Object.fromEntries(Object.entries(SITE).map(([k, v]) => [k, `${v}`])), roll: '0', style: 'normal' }).toString();
await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer && document.querySelector('#loading-screen')?.classList.contains('hidden'), null, { timeout: 180000, polling: 500 });
await page.waitForFunction(() => window.__godsEyeView.mapStackController?.getState?.().status === 'ready', null, { timeout: 180000, polling: 500 });
await page.evaluate(async () => {
  const { worldClock } = await import('/src/time/worldClock.js');
  worldClock.seek(Date.parse('2026-06-21T15:00:00Z'));
});
await page.locator('#top-center-actions [data-city-builder-open]').click();
if (/look=diorama|city=(v3|hero)/.test(args.query || ''))
  await page.waitForFunction(() => window.__gevDiorama?.state?.ready || window.__gevDioramaError, null, { timeout: 300000, polling: 500 }).catch(() => {});
log.diorama = await page.evaluate(() => ({ state: window.__gevDiorama?.state ?? null, error: window.__gevDioramaError ?? null }));
for (const name of (args.views || 'site,district').split(',')) {
  const v = VIEWS[name];
  await page.evaluate((c) => {
    const vw = window.__godsEyeView.viewer;
    vw.camera.setView({
      destination: vw.scene.globe.ellipsoid.cartographicToCartesian({ latitude: (c.lat * Math.PI) / 180, longitude: (c.lon * Math.PI) / 180, height: c.alt }),
      orientation: { heading: (c.heading * Math.PI) / 180, pitch: (c.pitch * Math.PI) / 180, roll: 0 },
    });
  }, v);
  // tiles settle (3 consecutive loaded checks)
  for (let ok = 0, i = 0; ok < 3 && i < 60; i++) {
    await page.evaluate(() => window.__godsEyeView.viewer.scene.requestRender());
    await page.waitForTimeout(1000);
    ok = (await page.evaluate(() => {
      const p = window.__godsEyeView.viewer.scene.primitives;
      return Array.from({ length: p.length }, (_, k) => p.get(k)).some((x) => x.show && x.tilesLoaded === true);
    })) ? ok + 1 : 0;
  }
  await page.evaluate(() => window.__godsEyeView.viewer.scene.requestRender());
  await page.waitForTimeout(2500);
  if (!JUDGE_ONLY) {
    await mkdir(EPHEMERAL, { recursive: true });
    await page.screenshot({ path: path.join(EPHEMERAL, `probe--${name}.png`) });
    log.ephemeral.push(`probe--${name}.png`);
  }
  if (args.own || JUDGE_ONLY) {
    // judge frame: every 3D tileset hidden (no Google pixels), plain backdrop
    await page.evaluate(() => {
      window.__gevJudgeFrame = true;
      const s = window.__godsEyeView.viewer.scene;
      for (let i = 0; i < s.primitives.length; i++) {
        const x = s.primitives.get(i);
        if ('tilesLoaded' in x && typeof x.root !== 'undefined') x.show = false;
      }
      s.backgroundColor = s.backgroundColor.constructor.fromCssColorString('#e6e8d6');
      if (s.skyAtmosphere) s.skyAtmosphere.show = false;
      if (s.skyBox) s.skyBox.show = false;
      s.requestRender();
    });
    await page.waitForTimeout(2500);
    const shown = await page.evaluate(() => {
      const s = window.__godsEyeView.viewer.scene;
      let n = 0;
      for (let i = 0; i < s.primitives.length; i++) {
        const x = s.primitives.get(i);
        if ('tilesLoaded' in x && typeof x.root !== 'undefined' && x.show) n++;
      }
      return n + (s.globe?.show ? 1 : 0);
    });
    if (shown) throw new Error(`judge frame ${name} refused: ${shown} tileset/globe still shown`);
    const file = path.join(OUT, `${name}--own.png`);
    await page.screenshot({ path: file });
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    log.frames[path.basename(file)] = { file: path.basename(file), sha256: createHash('sha256').update(await readFile(file)).digest('hex'), kind: 'judge', googleTiles: false };
    await page.evaluate(() => {
      const s = window.__godsEyeView.viewer.scene;
      for (let i = 0; i < s.primitives.length; i++) {
        const x = s.primitives.get(i);
        if ('tilesLoaded' in x && typeof x.root !== 'undefined') x.show = true;
      }
      delete window.__gevJudgeFrame;
    });
  }
}
await writeFile(path.join(OUT, 'probe.json'), JSON.stringify(log, null, 2));
// the gate reads frames from manifest.json next to the image
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({ schema: 'city-loop-v2/probe@1', frames: log.frames, ephemeral: log.ephemeral, ephemeralDir: EPHEMERAL }, null, 2));
console.log(JSON.stringify({ ready: log.diorama?.state?.ready ?? false, error: log.diorama?.error?.slice(0, 300) ?? null, stats: log.diorama?.state?.stats, timing: log.diorama?.state?.timing, pageErrors: log.pageErrors.slice(0, 3) }));
await browser.close();
