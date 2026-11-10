#!/usr/bin/env node
/**
 * Drive refresh recovery through the real manager, shell and Vue status banner.
 * Requires Vite dev's existing QA registration seam; no provider keys.
 * Run: node scripts/qa-attention-recovery.mjs --url http://localhost:4173
 * Always headless. Evidence: qa-artifacts/attention-recovery/.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './qa-chrome.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--url');
const url = new URL(at < 0 ? 'http://localhost:4173' : args[at + 1]);
url.searchParams.set('welcome', '0');
const out = 'qa-artifacts/attention-recovery';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromeExecutablePath(), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
const checks = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const focus = await page.createCDPSession();
  await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gevQaRegisterLayer && window.__godsEyeView?.styleManager, { timeout: 90000 });
  await page.evaluate(async () => {
    const manager = window.__godsEyeView.dataManager;
    for (const row of manager.getAll()) {
      if (row.enabled) await manager.setEnabled(row.id, false, { origin: 'qa' });
    }
    const state = { fail: false, acceptedAt: 1000 };
    window.__qaRecovery = state;
    window.__gevQaRegisterLayer(manager, {
      id: 'qa-refresh-recovery', name: 'Recovery QA', updateInterval: -1,
      init() {}, enable() {}, disable() {}, destroy() {},
      update() {
        if (state.fail) return false;
        state.acceptedAt++;
        return true;
      },
      getStats: () => ({ status: 'ready', count: 2, lastUpdate: state.acceptedAt }),
    });
    await manager.setEnabled('qa-refresh-recovery', true, { origin: 'qa' });
  });
  const refresh = (fail) => page.evaluate(async (fail) => {
    window.__qaRecovery.fail = fail;
    return window.__godsEyeView.dataManager.refreshLayer('qa-refresh-recovery');
  }, fail);
  const visibleRecovery = () => page.evaluate(() => {
    const chip = document.getElementById('global-loading-status');
    return !chip.hidden && chip.dataset.state === 'recovered';
  });
  check('initial healthy load is not recovery', !(await visibleRecovery()));
  check('manager reports a failed refresh', (await refresh(true)) === false);
  check('failure is rendered, not demoted', await page.$eval('#global-loading-status', (el) => !el.hidden && el.dataset.state === 'error'));
  check('manager accepts the recovery refresh', await refresh(false));
  await page.waitForFunction(() => {
    const chip = document.getElementById('global-loading-status');
    return !chip.hidden && chip.dataset.state === 'recovered';
  }, { timeout: 14000 });
  check('recovery names the accepted layer', await page.$eval('#global-loading-detail', (el) => el.textContent === 'Recovery QA' && getComputedStyle(el).display !== 'none'));
  check('recovery uses the existing polite atomic live region', await page.$eval('#global-loading-status', (el) => el.getAttribute('role') === 'status' && el.getAttribute('aria-live') === 'polite' && el.getAttribute('aria-atomic') === 'true'));
  const deadline = await page.evaluate(() => window.__godsEyeView.styleManager._feedback._globalStatusNotice.hideAt);
  await refresh(false);
  check('ordinary refresh does not restart recovery dwell', await page.evaluate((deadline) => window.__godsEyeView.styleManager._feedback._globalStatusNotice.hideAt === deadline, deadline));
  for (const [locale, label] of [['en', 'REFRESH RECOVERED'], ['es', 'ACTUALIZACIÓN RECUPERADA'], ['ru', 'ОБНОВЛЕНИЕ ВОССТАНОВЛЕНО']]) {
    await page.evaluate(async (locale) => {
      const { setLocale } = await import('/src/i18n/index.js');
      setLocale(locale);
    }, locale);
    await page.waitForFunction((label) => document.getElementById('global-loading-label').textContent === label, {}, label);
    await pause(700);
    await page.screenshot({ path: `${out}/${locale}.png` });
    check(`${locale} recovery is visible and localized`, await visibleRecovery());
  }
  await page.waitForFunction(() => document.getElementById('global-loading-status').hidden, { timeout: 7000 });
  await refresh(false);
  check('subsequent successful refresh stays silent', !(await visibleRecovery()));
  await refresh(true);
  await focus.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const cover = await browser.newPage();
  await cover.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await refresh(false);
  await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cover.close();
  await page.waitForFunction(() => !document.hidden);
  await pause(5500);
  check('hidden recovery is not replayed on return', !(await visibleRecovery()));
  await page.evaluate(async () => {
    const { dataManager } = window.__godsEyeView;
    await window.__gevQaUnregisterLayer(dataManager, 'qa-refresh-recovery');
    delete window.__qaRecovery;
  });
  await page.waitForFunction(() => !window.__godsEyeView.styleManager._feedback._refreshEpisodes.has('qa-refresh-recovery'));
  check('removed layer releases its recovery evidence', true);
  check('no browser page errors', errors.length === 0);
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log(`RESULT: ${checks.length} passed`);
} finally {
  await browser.close();
}
