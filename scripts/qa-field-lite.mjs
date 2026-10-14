#!/usr/bin/env node
/**
 * Run against a supported Node24/26 GEV dev or preview server:
 *   npm run build && npm run preview
 *   QA_BASE_URL=http://localhost:4173 node scripts/qa-field-lite.mjs
 * This tests the REAL Vite-served /field-lite/ entry, not inline DOM tests.
 * No real humanitarian data or external HTTP requests are required or allowed.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  await writeFile(inputPath, JSON.stringify(createSyntheticReliefDemoReplay()), 'utf8');
  await writeFile(badPath, '{bad json', 'utf8');
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
  const mobile = await checkViewport(390, 844);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ status: 'PASS', desktop, mobile, externalRequests: 0 }));
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
