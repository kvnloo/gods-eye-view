#!/usr/bin/env node
// FORK-ONLY (exp/city-look-diorama): fast look probe, not a beat capture.
//   node probe_diorama.mjs --app . --url http://127.0.0.1:4191 --out dir --query 'look=diorama&dio=...' [--views site,district,near]
// Opens the app at the capture site, opens the City builder (which mounts the
// diorama), and shoots each named camera at 1600x1000. Writes probe.json with
// the diorama state, page errors and console errors.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
const SITE = siteForPlot('plot-n105201-126637');
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
const log = { console: [], pageErrors: [] };
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
if (/look=diorama/.test(args.query || ''))
  await page.waitForFunction(() => window.__gevDiorama?.state?.ready || window.__gevDioramaError, null, { timeout: 120000, polling: 500 }).catch(() => {});
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
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
await writeFile(path.join(OUT, 'probe.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify({ ready: log.diorama?.state?.ready ?? false, error: log.diorama?.error?.slice(0, 300) ?? null, stats: log.diorama?.state?.stats, timing: log.diorama?.state?.timing, pageErrors: log.pageErrors.slice(0, 3) }));
await browser.close();
