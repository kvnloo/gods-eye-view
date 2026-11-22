#!/usr/bin/env node
// FORK-ONLY (exp/city-look-diorama): bake the diorama's ground height grid once.
//   node bake_diorama_ground.mjs --app <checkout> --url http://127.0.0.1:4190 --out public/city-diorama/north-beach.ground.json
// Opens the app at the capture site, waits for photoreal tiles, then runs
// bakeGround() (src/standalone/cityDiorama.js) in the page.
import { writeFile } from 'node:fs/promises';
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
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('playwright-core');
const { siteForPlot } = await import(pathToFileURL(path.join(APP, 'scripts/qa-massing-measure.mjs')).href);
const SITE = siteForPlot('plot-n105201-126637');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const url = new URL(args.url);
url.searchParams.set('welcome', '0');
url.hash = new URLSearchParams({ v: '2', ...Object.fromEntries(Object.entries(SITE).map(([k, v]) => [k, `${v}`])), roll: '0', style: 'normal' }).toString();
await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer && window.__godsEyeView.mapStackController?.getState?.().status === 'ready', null, { timeout: 180000, polling: 500 });
await page.waitForTimeout(15000);
const out = await page.evaluate(async () => {
  const fx = await (await fetch('/city-diorama/north-beach.osm.json')).json();
  const { bakeGround } = await import('/src/standalone/cityDiorama.js');
  return bakeGround(window.__godsEyeView.viewer, fx);
});
await writeFile(args.out, JSON.stringify(out));
console.log(JSON.stringify({ n: out.n, centre: out.centre, offset: out.offset, offsetSamples: out.offsetSamples, p: out.offsetP10P50P90, min: Math.min(...out.heights), max: Math.max(...out.heights) }));
await browser.close();
