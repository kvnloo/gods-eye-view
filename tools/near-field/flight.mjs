// Flight-path check of the near-field bubble: Sausalito -> SF downtown -> Paris -> Tokyo.
// For each step: time to idle, needed vs ready cells, holes (needed but not ready at the
// deadline), stuck (pending past the deadline), stale (shown but not needed), plus a climb
// above the cut-off (bubble must switch off) and back down.
// usage: node tools/near-field/flight.mjs <base> <exe> <outDir> <query> [--shots]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [base, exe, outDir, query, ...flags] = process.argv.slice(2);
const shots = flags.includes('--shots');
fs.mkdirSync(outDir, { recursive: true });
const lerp = (a, b, t) => a + (b - a) * t;
const steps = [];
const leg = (name, from, to, n, alt = 400, pitch = -30) => {
  const heading = Math.atan2((to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180), to[0] - from[0]) * (180 / Math.PI);
  for (let i = 0; i <= n; i++) steps.push({ name: `${name}-${i}`, lat: lerp(from[0], to[0], i / n), lon: lerp(from[1], to[1], i / n), alt, heading, pitch });
};
leg('saus-sf', [37.8555, -122.489], [37.7895, -122.4045], 14);
steps.push({ name: 'sf-climb-2500', lat: 37.7895, lon: -122.4045, alt: 2500, heading: 340, pitch: -40 });
steps.push({ name: 'sf-down-300', lat: 37.7895, lon: -122.4045, alt: 300, heading: 340, pitch: -28 });
leg('paris', [48.8545, 2.2905], [48.8606, 2.3376], 6, 380, -25);
leg('tokyo', [35.6835, 139.6955], [35.6812, 139.7671], 6, 420, -25);
const deadlineMs = 45000;

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
const s0 = steps[0];
await page.goto(`${base}/?${query}&welcome=0#v=2&lat=${s0.lat}&lon=${s0.lon}&alt=${s0.alt}&heading=${s0.heading}&pitch=${s0.pitch}&map=photoreal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer && window.__gevNearField, null, { timeout: 120000 });
await page.waitForTimeout(4000);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
const rows = [];
for (const s of steps) {
  await page.evaluate((v) => {
    const viewer = window.__godsEyeView.viewer;
    const e = viewer.scene.globe.ellipsoid;
    viewer.camera.setView({
      destination: e.cartographicToCartesian({ latitude: (v.lat * Math.PI) / 180, longitude: (v.lon * Math.PI) / 180, height: v.alt }),
      orientation: { heading: (v.heading * Math.PI) / 180, pitch: (v.pitch * Math.PI) / 180, roll: 0 },
    });
  }, s);
  const t0 = Date.now();
  await page.waitForTimeout(600);
  let idle = false;
  while (Date.now() - t0 < deadlineMs) {
    if (await page.evaluate(() => window.__gevNearField.idle())) { idle = true; break; }
    await page.waitForTimeout(400);
  }
  const ms = Date.now() - t0;
  const st = await page.evaluate(() => {
    const nf = window.__gevNearField;
    const s = nf.state;
    const cells = nf.cells();
    const needed = new Set(s.needed);
    const byKey = new Map(cells.map((c) => [c.key, c]));
    const holes = s.needed.filter((k) => byKey.get(k)?.status !== 'ready');
    const errors = s.needed.filter((k) => byKey.get(k)?.status === 'error');
    // a model shown for a cell that is not needed would be a stuck tile
    const scene = window.__godsEyeView.viewer.scene;
    let shownModels = 0;
    for (let i = 0; i < scene.primitives.length; i++) {
      const c = scene.primitives.get(i);
      if (c && c.get && c.length && c.get(0)?.customShader?.uniforms?.u_nfIsTree) for (let k = 0; k < c.length; k++) if (c.get(k).show) shownModels++;
    }
    return { radius: Math.round(s.radius), fade: +s.fade.toFixed(2), eye: Math.round(s.eyeHeight), needed: s.needed.length, ready: s.ready, shownCells: s.shownCells, shownModels, cached: s.cached, pending: s.pending.length, holes: holes.length, errorCells: errors.length, staleShown: cells.filter((c) => c.shown && !needed.has(c.key)).length, lastErrors: s.errors.slice(-3) };
  });
  const row = { step: s.name, ms, idle, ...st };
  if (shots && (/-0$|-7$|-14$|-6$|climb|down/.test(s.name))) {
    row.file = `${outDir}/${s.name}.png`;
    await page.screenshot({ path: row.file });
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
const summary = {
  steps: rows.length,
  idleAll: rows.every((r) => r.idle),
  holes: rows.reduce((a, r) => a + r.holes, 0),
  stuckPending: rows.filter((r) => !r.idle && r.pending > 0).length,
  staleShown: rows.reduce((a, r) => a + Math.max(0, r.staleShown), 0),
  climbOff: rows.find((r) => r.step === 'sf-climb-2500'),
  medianMsToIdle: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  maxMsToIdle: Math.max(...rows.map((r) => r.ms)),
  pageErrors: errs.slice(0, 10),
};
console.log(JSON.stringify({ summary }));
fs.writeFileSync(`${outDir}/flight-${Date.now()}.json`, JSON.stringify({ query, rows, summary }, null, 1));
await browser.close();
