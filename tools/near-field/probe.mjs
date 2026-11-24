// Near-field QA driver (headless Chrome for Testing, ANGLE Metal).
// usage: node tools/near-field/probe.mjs <base> <exe> <outDir> <query> <views.json|name,...> [--shots] [--check] [--bench]
// Captures are styled GEV frames for judging (owner-approved); keep them private.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [base, exe, outDir, query, viewsArg, ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);
export const VIEWS = {
  saus: { lat: 37.8555, lon: -122.489, alt: 380, heading: 30, pitch: -30, time: '2026-06-21T22:00:00Z' },
  sausRef: { lat: 37.85568449681418, lon: -122.4885858447663, alt: 600, heading: 0, pitch: -45, time: '2026-06-21T15:00:00Z' },
  sf: { lat: 37.7895, lon: -122.4045, alt: 420, heading: 340, pitch: -28, time: '2026-06-21T22:00:00Z' },
  paris: { lat: 48.8545, lon: 2.2905, alt: 360, heading: 60, pitch: -25, time: '2026-06-21T15:00:00Z' },
  tokyo: { lat: 35.6835, lon: 139.6955, alt: 420, heading: 90, pitch: -25, time: '2026-06-21T03:00:00Z' },
};
const views = fs.existsSync(viewsArg) ? JSON.parse(fs.readFileSync(viewsArg, 'utf8')) : viewsArg.split(',').map((k) => ({ name: k, ...VIEWS[k] }));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || /nearField/.test(m.text())) errs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
const v0 = views[0];
await page.goto(`${base}/?${query}&welcome=0#v=2&lat=${v0.lat}&lon=${v0.lon}&alt=${v0.alt}&heading=${v0.heading}&pitch=${v0.pitch}&map=photoreal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer, null, { timeout: 120000 });
const nf = /nearField=1/.test(query);
if (nf) await page.waitForFunction(() => window.__gevNearField, null, { timeout: 60000 });
await page.waitForTimeout(5000);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
const log = [];
for (const v of views) {
  await page.evaluate((v) => {
    const viewer = window.__godsEyeView.viewer;
    const J = viewer.clock.currentTime.constructor;
    viewer.clock.shouldAnimate = false;
    if (v.time) viewer.clock.currentTime = J.fromIso8601(v.time);
    const e = viewer.scene.globe.ellipsoid;
    viewer.camera.setView({
      destination: e.cartographicToCartesian({ latitude: (v.lat * Math.PI) / 180, longitude: (v.lon * Math.PI) / 180, height: v.alt }),
      orientation: { heading: (v.heading * Math.PI) / 180, pitch: (v.pitch * Math.PI) / 180, roll: 0 },
    });
  }, v);
  const t0 = Date.now();
  await page.waitForTimeout(3000);
  let idle = false;
  for (let i = 0; i < 90; i++) {
    const s = await page.evaluate((nf) => {
      const ts = [];
      const p = window.__godsEyeView.viewer.scene.primitives;
      for (let k = 0; k < p.length; k++) { const x = p.get(k); if (x && 'tilesLoaded' in x && x.show) ts.push(x.tilesLoaded); }
      return { tiles: ts.every(Boolean), nf: nf ? window.__gevNearField.idle() : true };
    }, nf);
    if (s.tiles && s.nf) { idle = true; break; }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
  const row = { name: v.name, idle, settleMs: Date.now() - t0 };
  if (nf) {
    row.state = await page.evaluate(() => {
      const s = window.__gevNearField.state;
      return { radius: s.radius, fade: s.fade, eyeHeight: Math.round(s.eyeHeight), terrain: s.terrain, kit: s.kit, needed: s.needed.length, ready: s.ready, shown: s.shownCells, pending: s.pending, errors: s.errors.slice(-5), maskBuilds: s.maskBuilds, maskFootprints: s.maskFootprints, data: s.data };
    });
    row.cellStats = await page.evaluate(() => window.__gevNearField.cells().filter((c) => c.needed && c.stats).reduce((a, c) => { for (const k of ['buildings', 'trees', 'triangles', 'pier', 'hull', 'droppedOnWater', 'waterViolations']) a[k] = (a[k] ?? 0) + (c.stats[k] ?? 0); return a; }, {}));
    if (has('--check')) row.check = await page.evaluate(() => window.__gevNearField.check());
  }
  if (has('--bench')) {
    row.bench = await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const scene = viewer.scene;
      const gl = scene.context._gl;
      const run = (n) => { for (let i = 0; i < 5; i++) scene.render(); gl.finish(); const t = performance.now(); for (let i = 0; i < n; i++) { scene.render(); gl.finish(); } return (performance.now() - t) / n; };
      const out = {};
      const nf = window.__gevNearField;
      const med = () => [run(40), run(40), run(40)].sort((a, b) => a - b)[1];
      out.on = med();
      if (nf) { nf.setEnabled(false); for (let i = 0; i < 10; i++) scene.render(); out.off = med(); nf.setEnabled(true); for (let i = 0; i < 10; i++) scene.render(); out.onAgain = med(); }
      return out;
    });
    if (nf) await page.waitForTimeout(1500);
  }
  if (has('--shots')) {
    const file = `${outDir}/${v.name}.png`;
    await page.screenshot({ path: file });
    row.file = file;
  }
  log.push(row);
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ errors: errs.slice(0, 30) }));
fs.writeFileSync(`${outDir}/probe-${Date.now()}.json`, JSON.stringify({ query, log, errors: errs }, null, 1));
await browser.close();
