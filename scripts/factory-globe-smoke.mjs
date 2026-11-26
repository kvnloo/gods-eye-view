// Render the real production build headless, with every external request
// blocked and no API keys, and prove the Cesium globe drew pixels.
//   node scripts/factory-globe-smoke.mjs [screenshot.png] [dist] [result.json]
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { preview } from 'vite';

// The globe must change this share of the central crop against the same frame
// with the globe hidden, and the crop must not be one flat colour.
export const THRESHOLDS = Object.freeze({ changedFraction: 0.2, channelDelta: 24, minLumaStdDev: 4 });

const output = resolve(process.argv[2] ?? 'factory-globe.png');
const server = await preview({
  build: { outDir: process.argv[3] ?? 'dist' },
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
});
let browser;
const pageErrors = [];
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1024, height: 768 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    return url.origin === origin || ['blob:', 'data:'].includes(url.protocol)
      ? request.continue()
      : request.abort();
  });
  const started = Date.now();
  const response = await page.goto(`${origin}/?welcome=0#lat=35&lon=-90&alt=22000000&heading=0&pitch=-90`);
  assert.equal(response?.status(), 200, 'production home page');
  await page.waitForFunction(() => {
    const scene = window.__godsEyeView?.viewer?.scene;
    const loader = document.getElementById('loading-screen');
    return scene?.globe?.show && scene.canvas.width > 512 && (!loader || loader.classList.contains('hidden'));
  }, { timeout: 90_000 });
  const readyMs = Date.now() - started;
  const render = async (show) => page.evaluate(async (visible) => {
    const scene = window.__godsEyeView.viewer.scene;
    scene.globe.show = visible;
    await new Promise((done) => {
      const unsubscribe = scene.postRender.addEventListener(() => {
        unsubscribe();
        done();
      });
      // If the render governor owns the loop, invalidate it too.
      window.__godsEyeView.requestRender?.('factory-globe-smoke');
      scene.requestRender();
    });
  }, show);
  // Compare a fixed central crop against a real negative control (globe hidden).
  // Chrome compositing includes the HUD, which also appears in the control.
  const clip = { x: 384, y: 256, width: 256, height: 256 };
  await render(true);
  const withGlobe = await page.screenshot({ clip });
  await page.screenshot({ path: output });
  await render(false);
  const withoutGlobe = await page.screenshot({ clip });
  const pixels = async (image) => sharp(Buffer.from(image)).removeAlpha().raw().toBuffer();
  const a = await pixels(withGlobe);
  const b = await pixels(withoutGlobe);
  assert.equal(a.length, b.length);
  let changed = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > THRESHOLDS.channelDelta) changed++;
    const luma = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    sum += luma;
    sumSquares += luma * luma;
  }
  const n = a.length / 3;
  const changedFraction = changed / n;
  const lumaStdDev = Math.sqrt(Math.max(0, sumSquares / n - (sum / n) ** 2));
  const report = { readyMs, changedPixels: changed, croppedPixels: n, changedFraction, lumaStdDev, pageErrors, thresholds: THRESHOLDS, screenshot: output };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[4]) await writeFile(process.argv[4], `${JSON.stringify(report, null, 2)}\n`);
  assert.ok(changedFraction >= THRESHOLDS.changedFraction, `globe changed ${changedFraction} of the central crop`);
  assert.ok(lumaStdDev >= THRESHOLDS.minLumaStdDev, `globe crop is flat (luma std dev ${lumaStdDev})`);
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
