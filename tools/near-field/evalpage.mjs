// Open the app at a view, wait for near-field idle, then evaluate a JS expression file in the page.
// usage: node tools/near-field/evalpage.mjs <base> <exe> <query> <view> <expr.js> [shot.png]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [base, exe, query, view, exprFile, shot] = process.argv.slice(2);
const [lat, lon, alt, heading, pitch] = view.split(',').map(Number);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
await page.goto(`${base}/?${query}&welcome=0#v=2&lat=${lat}&lon=${lon}&alt=${alt}&heading=${heading}&pitch=${pitch}&map=photoreal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer && window.__gevNearField, null, { timeout: 120000 });
await page.waitForTimeout(4000);
for (let i = 0; i < 60; i++) { if (await page.evaluate(() => window.__gevNearField.idle())) break; await page.waitForTimeout(1000); }
await page.waitForTimeout(1500);
const out = await page.evaluate(fs.readFileSync(exprFile, 'utf8'));
console.log(JSON.stringify(out, null, 1));
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify(errs.filter((e) => !/403/.test(e)).slice(0, 20), null, 1));
await browser.close();
