#!/usr/bin/env node
/**
 * Run against a supported Node24/26 GEV dev or preview server:
 *   npm run build && npm run preview
 *   QA_BASE_URL=http://localhost:4173 node scripts/qa-field-lite.mjs
 * This tests the REAL Vite-served /field-lite/ entry, not inline DOM tests.
 * No real humanitarian data or external HTTP requests are required or allowed.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createSyntheticReliefDemoReplay } from '../src/fieldLite/demoFixture.js';

const base = new URL(process.env.QA_BASE_URL || 'http://127.0.0.1:4173');
const browser = await puppeteer.launch({ headless: true });
const temp = await mkdtemp(join(tmpdir(), 'gev-field-lite-'));
const errors = [];
const external = [];
try {
  const inputPath = join(temp, 'synthetic-replay.json');
  const badPath = join(temp, 'invalid-replay.json');
  const newestPath = join(temp, 'newest-replay.json');
  const emptyPath = join(temp, 'empty-replay.json');
  const oversizedPath = join(temp, 'oversized-replay.json');
  const sampleReplay = createSyntheticReliefDemoReplay();
  await writeFile(inputPath, JSON.stringify(sampleReplay), 'utf8');
  await writeFile(
    newestPath,
    JSON.stringify({
      ...sampleReplay,
      inputIdentities: {
        ...sampleReplay.inputIdentities,
        studyId: 'browser-newest',
      },
    }),
    'utf8',
  );
  await writeFile(emptyPath, '', 'utf8');
  await writeFile(badPath, '{bad json', 'utf8');
  await writeFile(oversizedPath, 'x'.repeat(65537), 'utf8');
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== base.origin) {
      external.push(request.url());
      request.abort('blockedbyclient');
    } else {
      request.continue();
    }
  });

  async function checkViewport(width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const documentUrl = new URL('field-lite/', base);
    const result = await page.goto(documentUrl.href, { waitUntil: 'networkidle0' });
    assert.equal(result.status(), 200);
    await page.waitForSelector('.field-card');
    const view = await page.evaluate(() => ({
      cards: document.querySelectorAll('.field-card').length,
      values: [...document.querySelectorAll('.field-number')].map((e) => e.textContent),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      warning: document.querySelector('.field-alert')?.textContent,
      delta: document.querySelector('.field-delta')?.textContent,
      hasCesium: !!document.querySelector('#cesiumContainer'),
    }));
    assert.equal(view.cards, 2);
    assert.deepEqual(view.values.map((v) => Number.parseInt(v, 10)), [4, 2]);
    assert.equal(view.overflow, false);
    assert.equal(view.hasCesium, false);
    assert.match(view.warning, /Synthetic training only/);
    assert.match(view.delta, /-2 known-only synthetic units/);
    await page.click('.field-details summary');
    assert.equal(await page.$eval('.field-details', (e) => e.open), true);
    return view;
  }

  const desktop = await checkViewport(1280, 900);
  // Real preview screenshots are audit evidence only; the page has synthetic data.
  await mkdir('qa-artifacts', { recursive: true });
  await page.screenshot({
    path: 'qa-artifacts/field-lite-desktop.png',
    fullPage: true,
  });
  const input = await page.$('#field-local-file');
  await input.uploadFile(inputPath);
  await page.waitForFunction(() =>
    document.querySelector('#field-feedback').textContent.includes('Local synthetic replay loaded'));
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);
  await input.uploadFile(badPath);
  await page.waitForFunction(() =>
    document.querySelector('#field-feedback').textContent.includes('rejected'));
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 0);
  await page.click('#field-demo');
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);
  // Exercise the real browser's async File.text path, not only a unit mock.
  // A slower, older receipt must never overwrite a later user action.
  await page.evaluate(() => {
    const readText = File.prototype.text;
    window.__deferFieldRead = false;
    window.__releaseFieldRead = null;
    window.__rejectFieldRead = null;
    File.prototype.text = function (...args) {
      if (!window.__deferFieldRead) return readText.apply(this, args);
      window.__deferFieldRead = false;
      const read = readText.apply(this, args);
      return new Promise((resolve, reject) => {
        window.__rejectFieldRead = () => reject(new Error('Synthetic File.text failure'));
        window.__releaseFieldRead = async () => {
          try {
            resolve(await read);
          } catch (error) {
            reject(error);
          }
        };
      });
    };
  });
  const completeDeferredRead = async () => {
    await page.evaluate(async () => {
      await window.__releaseFieldRead();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  await page.evaluate(() => {
    window.__deferFieldRead = true;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await page.click('#field-demo');
  await completeDeferredRead();
  assert.equal(
    await page.$eval('#field-feedback', (e) => e.textContent),
    'Restored fictional example.',
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);

  // An oversized newest selection must keep the old pending import revoked.
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await input.uploadFile(oversizedPath);
  await completeDeferredRead();
  assert.match(
    await page.$eval('#field-feedback', (e) => e.textContent),
    /at most 64 KiB/,
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 0);

  // The newest valid file wins even when the earlier read finishes afterward.
  await page.click('#field-demo');
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await input.uploadFile(newestPath);
  await page.waitForFunction(() =>
    document.querySelector('.field-status')?.textContent.includes('Study browser-newest'),
  );
  await completeDeferredRead();
  assert.match(
    await page.$eval('.field-status', (e) => e.textContent),
    /Study browser-newest/,
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);

  // A newer malformed JSON file cannot be replaced by stale valid input.
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await input.uploadFile(badPath);
  await page.waitForFunction(() =>
    document.querySelector('#field-feedback')?.textContent.includes('rejected'),
  );
  await completeDeferredRead();
  assert.match(
    await page.$eval('#field-feedback', (e) => e.textContent),
    /File rejected/,
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 0);

  // An empty newer file also revokes the pending valid read.
  await page.click('#field-demo');
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await input.uploadFile(emptyPath);
  await completeDeferredRead();
  assert.match(
    await page.$eval('#field-feedback', (e) => e.textContent),
    /nonempty JSON/,
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 0);

  // Two pending file reads must be ordered by selection, not completion.
  // Releasing the newest read first is the case a stale implementation loses.
  await page.click('#field-demo');
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await page.evaluate(() => {
    window.__releaseOlderFieldRead = window.__releaseFieldRead;
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(newestPath);
  await page.waitForFunction(() => typeof window.__releaseFieldRead === 'function');
  await completeDeferredRead();
  await page.evaluate(async () => {
    await window.__releaseOlderFieldRead();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.match(
    await page.$eval('.field-status', (e) => e.textContent),
    /Study browser-newest/,
  );

  // A rejected superseded read must not erase a newer restored example.
  await page.click('#field-demo');
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__rejectFieldRead === 'function');
  await page.click('#field-demo');
  await page.evaluate(async () => {
    window.__rejectFieldRead();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(
    await page.$eval('#field-feedback', (e) => e.textContent),
    'Restored fictional example.',
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);

  // Likewise, an old failed read cannot wipe a newer valid local receipt.
  await page.evaluate(() => {
    window.__deferFieldRead = true;
    window.__releaseFieldRead = null;
    window.__rejectFieldRead = null;
  });
  await input.uploadFile(inputPath);
  await page.waitForFunction(() => typeof window.__rejectFieldRead === 'function');
  await input.uploadFile(newestPath);
  await page.waitForFunction(() =>
    document.querySelector('.field-status')?.textContent.includes('Study browser-newest'),
  );
  await page.evaluate(async () => {
    window.__rejectFieldRead();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.match(
    await page.$eval('.field-status', (e) => e.textContent),
    /Study browser-newest/,
  );
  assert.equal(await page.$$eval('.field-card', (cards) => cards.length), 2);

  const mobile = await checkViewport(390, 844);
  await page.screenshot({
    path: 'qa-artifacts/field-lite-mobile.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ status: 'PASS', desktop, mobile, externalRequests: 0 }));
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
