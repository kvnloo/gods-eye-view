import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

/**
 * Headless gate for the opt-in GEV Scene preview. Start the GEV dev server first.
 * It never edits a real place or downloads municipal data.
 */
const origin = process.env.GEV_QA_APP_URL || 'http://localhost:4173';
const url = new URL(origin);
url.searchParams.set('planningPreview', 'fixture');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-community-planning-preview-open]', {
    timeout: 45000,
  });
  await page.evaluate(() =>
    document.querySelector('[data-community-planning-preview-open]').click(),
  );
  await page.waitForSelector('[data-community-planning-preview]');
  const checked = await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    const text = dialog.textContent;
    return {
      open: dialog.open,
      alternatives: dialog.querySelectorAll('[data-alternative-id]').length,
      markers: dialog.querySelectorAll('svg circle').length,
      synthetic: text.includes('SYNTHETIC FIXTURE'),
      hypothetical: (text.match(/HYPOTHETICAL · NOT APPROVED/g) || []).length,
      alice: text.includes('Recorded author: alice'),
      bob: text.includes('Recorded author: bob'),
      official: text.includes('Approval: not-requested'),
    };
  });
  assert.deepEqual(checked, {
    open: true,
    alternatives: 2,
    markers: 5,
    synthetic: true,
    hypothetical: 2,
    alice: true,
    bob: true,
    official: true,
  });
  const initiallyVisible = await page.$$eval(
    '[data-community-planning-preview] [data-alternative-id]',
    (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
  );
  assert.deepEqual(initiallyVisible, ['play-first', 'trees-first']);
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent === 'Game view'
    ).click();
  });
  const focused = await page.$$eval(
    '[data-community-planning-preview] [data-alternative-id]',
    (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
  );
  assert.deepEqual(focused, ['play-first']);
  assert.equal(
    await page.$eval('[data-planning-focus-navigation]', (el) => el.hidden),
    false,
  );
  await page.click('[data-planning-focus-id="trees-first"]');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['trees-first'],
  );
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent === 'Co-op view'
    ).click();
  });
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );
  assert.equal(
    await page.$eval('[data-planning-focus-navigation]', (el) => el.hidden),
    true,
  );
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent === 'Game view'
    ).click();
  });
  const mode = await page.$eval(
    '[data-planning-mode-status]', (el) => el.textContent,
  );
  assert.equal(mode, 'View: game · neither mode grants authority');
  if (process.env.GEV_QA_SCREENSHOT)
    await page.screenshot({ path: process.env.GEV_QA_SCREENSHOT });
  await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    [...dialog.querySelectorAll('button')].find((button) =>
      button.textContent === 'Cancel'
    ).click();
  });
  assert.equal(
    await page.$('[data-community-planning-preview]'),
    null,
  );
  console.log('Community planning preview: 2 hypothetical proposals, 5 markers, 2 credits, mode and close PASS');
} finally {
  await browser.close();
}
