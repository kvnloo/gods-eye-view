/**
 * Actual app composition proof for modal-local hazard feedback, using an inert enable.
 * Run against a local dev server in the restricted environment required by the
 * maintainer workflow: node scripts/qa-hazard-evidence-toast.mjs
 * GEV_QA_URL selects the server (default localhost:4173); PUPPETEER_EXECUTABLE_PATH
 * selects a provisioned browser. GEV_QA_ARTIFACT_DIR and GEV_QA_LABEL select output.
 * No live provider proof: external browser requests are blocked, and the outer
 * environment must also block external traffic from the local server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
const appUrl = process.env.GEV_QA_URL || 'http://localhost:4173';
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ],
});
let page;
const consoleErrors = [];
const httpErrors = [];
const failedRequests = [];
const artifactDir =
  process.env.GEV_QA_ARTIFACT_DIR || 'qa-shots/hazard-evidence-toast';
const label = process.env.GEV_QA_LABEL || 'toast';
fs.mkdirSync(artifactDir, { recursive: true });
try {
  page = await browser.newPage();
  page.on('pageerror', (error) =>
    consoleErrors.push({ type: 'pageerror', message: error.message }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ type: 'console', message: message.text() });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      httpErrors.push({
        origin: url.origin,
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    failedRequests.push({
      origin: url.origin,
      path: url.pathname,
      error: request.failure()?.errorText,
    });
  });
  await page.setViewport({ width: 1280, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin === new URL(appUrl).origin ||
      ['data:', 'blob:'].includes(url.protocol)
    )
      request.continue();
    else request.abort();
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 60000,
  });
  // Use the public first-launch Escape interaction; never hide its DOM or CSS.
  await page.waitForFunction(() => {
    const launcher = document.querySelector('#first-run-launcher');
    return (
      !launcher ||
      (launcher.dataset.initialized === 'true' &&
        launcher.classList.contains('visible'))
    );
  });
  if (await page.$('#first-run-launcher')) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#first-run-launcher', { hidden: true });
  }

  await page.evaluate(() => {
    const data = window.__godsEyeView.dataManager;
    window.__hazardProbe = {
      original: data.setEnabled,
      preference: localStorage.getItem('gev:hazard-evidence-preferences:v1'),
      calls: 0,
      actionAt: 0,
    };
    data.setEnabled = async function (id) {
      if (id !== 'recent-imagery')
        throw new Error(`Unexpected probe enable: ${id}`);
      window.__hazardProbe.calls++;
      window.__hazardProbe.actionAt = performance.now();
      return false;
    };
    window.dispatchEvent(
      new CustomEvent('gev:entity-selected', {
        detail: {
          layerId: 'local-firms',
          latitude: 38,
          longitude: -122,
          label: 'Authored fixture fire',
        },
      }),
    );
  });
  await page.click('.hazard-evidence-dialog [data-action="imagery"]');
  await page.waitForFunction(
    () =>
      window.__hazardProbe.calls === 1 &&
      !document.querySelector('.hazard-evidence-dialog [data-action="imagery"]')
        ?.disabled,
  );
  // Let the global callback toast settle; persistent dialog status has no transition.
  await page.waitForFunction(
    () => performance.now() - window.__hazardProbe.actionAt >= 350,
  );
  const visual = () => {
    const toast = document.querySelector(
      '.hazard-evidence-dialog [role="status"]',
    );
    if (!toast) {
      return {
        present: false,
        text: '',
        bounds: null,
        elapsedMs: performance.now() - window.__hazardProbe.actionAt,
      };
    }
    const style = getComputedStyle(toast);
    const rect = toast.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return {
      present: true,
      text: toast.textContent,
      opacity: Number(style.opacity),
      visibility: style.visibility,
      display: style.display,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: hit
        ? { tag: hit.tagName, id: hit.id, className: String(hit.className) }
        : null,
      elapsedMs: performance.now() - window.__hazardProbe.actionAt,
    };
  };
  const result = await page.evaluate(() => ({
    calls: window.__hazardProbe.calls,
    status: document.querySelector('.hazard-evidence-dialog [role="status"]')
      ?.textContent,
    toast: document.querySelector('#toast')?.textContent,
    visible: document.querySelector('#toast')?.classList.contains('visible'),
    retryEnabled: !document.querySelector(
      '.hazard-evidence-dialog [data-action="imagery"]',
    ).disabled,
    preferenceUnchanged:
      localStorage.getItem('gev:hazard-evidence-preferences:v1') ===
      window.__hazardProbe.preference,
  }));
  result.beforeCapture = await page.evaluate(visual);
  const bounds = result.beforeCapture.bounds;
  if (bounds) {
    await page.screenshot({
      path: path.join(artifactDir, `${label}-status.png`),
      captureBeyondViewport: false,
      clip: {
        x: Math.max(0, bounds.x - 8),
        y: Math.max(0, bounds.y - 8),
        width: Math.min(1280 - Math.max(0, bounds.x - 8), bounds.width + 16),
        height: Math.min(800 - Math.max(0, bounds.y - 8), bounds.height + 16),
      },
    });
  }
  result.afterToastCapture = await page.evaluate(visual);
  await page.screenshot({
    path: path.join(artifactDir, `${label}-open.png`),
    captureBeyondViewport: false,
  });
  result.afterFullCapture = await page.evaluate(visual);
  result.consoleErrors = consoleErrors;
  result.httpErrors = httpErrors;
  result.failedRequests = failedRequests;
  await page.click('.hazard-evidence-dialog [data-action="dismiss"]');
  result.dismissed = (await page.$('.hazard-evidence-dialog')) === null;
  fs.writeFileSync(
    path.join(artifactDir, `${label}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  assert.equal(result.calls, 1);
  assert.equal(result.retryEnabled, true);
  assert.equal(result.preferenceUnchanged, true);
  assert.equal(result.dismissed, true);
  assert.equal(result.toast, 'Recent Imagery could not be enabled');
  assert.equal(result.visible, true);
  assert.equal(result.status, 'Recent Imagery could not be enabled');
  assert.equal(
    result.beforeCapture.text,
    'Recent Imagery could not be enabled',
  );
  assert.ok(result.beforeCapture.opacity >= 0.95);
  assert.equal(result.beforeCapture.visibility, 'visible');
} finally {
  if (page)
    await page
      .evaluate(() => {
        if (window.__hazardProbe) {
          window.__godsEyeView.dataManager.setEnabled =
            window.__hazardProbe.original;
          delete window.__hazardProbe;
        }
      })
      .catch(() => {});
  await browser.close();
}
