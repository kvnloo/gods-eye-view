import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

/**
 * Headless gate for the opt-in GEV Scene preview. Start the GEV dev server first.
 * It never edits a real place or downloads municipal data.
 */
const origin = process.env.GEV_QA_APP_URL || 'http://localhost:4173';
const optOutUrl = new URL(origin);
optOutUrl.searchParams.delete('planningPreview');
const url = new URL(origin);
url.searchParams.set('planningPreview', 'fixture');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  // Normal startup must not expose the fixture-only Scene launcher.
  await page.goto(optOutUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.sceneDirector?._controls &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  assert.equal(
    await page.$('[data-community-planning-preview-open]'),
    null,
    'the fixture launcher must be absent without planningPreview=fixture',
  );
  assert.equal(await page.$('[data-planning-source-provenance]'), null);
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.sceneDirector?._controls &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  // A programmatic .click() on a collapsed panel gives a false browser PASS.
  if (
    await page.$eval('#scene-panel', (panel) =>
      panel.classList.contains('collapsed'),
    )
  )
    await page.click('[data-collapse-target="scene-panel"]');
  await page.waitForSelector('[data-community-planning-preview-open]', {
    visible: true,
    timeout: 45000,
  });
  await page.click('[data-community-planning-preview-open]');
  await page.waitForSelector('[data-community-planning-preview]');
  const checked = await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    const text = dialog.textContent;
    const provenance = [...dialog.querySelectorAll(
      '[data-planning-source-provenance]',
    )].map((node) => node.textContent);
    return {
      open: dialog.open,
      alternatives: dialog.querySelectorAll('[data-alternative-id]').length,
      markers: dialog.querySelectorAll('svg circle').length,
      synthetic: text.includes('SYNTHETIC FIXTURE'),
      hypothetical: (text.match(/HYPOTHETICAL · NOT APPROVED/g) || []).length,
      alice: text.includes('Recorded author: alice'),
      bob: text.includes('Recorded author: bob'),
      official: text.includes('Approval: not-requested'),
      provenance,
      recordSummary: dialog.querySelector('[data-planning-record-summary]')?.textContent,
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
    provenance: [
      'Baseline source: synthetic-source · revision: fixture-v1 · ' +
        'attribution: Generated example, not official parcel data · ' +
        'license: synthetic-test-data · ' +
        'URL: https://example.org/synthetic-fixture',
    ],
    recordSummary: 'Planning records: 0 stale/incompatible excluded; ' +
      '0 valid beyond this two-proposal preview. ' +
      'This snapshot cannot reconstruct overwritten edits or resolve conflicts.',
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
  // Native button activation, not a synthetic click: focus then press Enter.
  assert.equal(
    await page.evaluate(() => {
      const button = document.querySelector('[data-planning-focus-id="trees-first"]');
      button.focus();
      return document.activeElement === button;
    }),
    true,
  );
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['trees-first'],
  );
  assert.equal(
    await page.$eval('[data-planning-focus-id="trees-first"]', (el) =>
      el.getAttribute('aria-pressed')),
    'true',
  );
  assert.equal(
    await page.evaluate(() => {
      const dialog = document.querySelector('[data-community-planning-preview]');
      const button = [...dialog.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Co-op view',
      );
      button.focus();
      return document.activeElement === button;
    }),
    true,
  );
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );

  // A narrow mobile viewport must not clip the modal or change its authority.
  await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
  const mobile = await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    const rect = dialog.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      left: rect.left,
      right: rect.right,
      open: dialog.open,
      disclaimer: dialog.textContent.includes('HYPOTHETICAL · NOT APPROVED'),
    };
  });
  assert.equal(mobile.open, true);
  assert.equal(mobile.disclaimer, true);
  assert.ok(mobile.viewportWidth <= 400, 'mobile CSS viewport did not activate');
  assert.ok(mobile.left >= -1 && mobile.right <= mobile.viewportWidth + 1,
    'planning dialog clips outside the mobile CSS viewport');

  // Escape must fully dispose the modal; reopening must be fresh and singular.
  await page.keyboard.press('Escape');
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  assert.equal(
    await page.$$eval('[data-community-planning-preview-open]', (items) => items.length),
    1,
  );
  // Escape may close the accordion too; re-open using the installed control.
  if (
    await page.$eval('#scene-panel', (panel) =>
      panel.classList.contains('collapsed'),
    )
  )
    await page.click('[data-collapse-target="scene-panel"]');
  await page.waitForSelector('[data-community-planning-preview-open]', {
    visible: true,
  });
  await page.click('[data-community-planning-preview-open]');
  await page.waitForSelector('[data-community-planning-preview]');
  assert.equal(
    await page.$eval('[data-community-planning-preview]', (dialog) => dialog.open),
    true,
  );
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );
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
  assert.equal(await page.$('[data-planning-source-provenance]'), null);
  // Negative control: an unsupported/stale imported proposal is excluded
  // visibly, without leaking into the two valid synthetic alternatives.
  const excluded = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const key = 'draft-scenario:community-plan:synthetic-park:trees-first';
    const original = collaborationState.authored[key].fields.proposal;
    const staleRecord = {
      fields: {
        proposal: {
          ...original,
          value: {
            ...original.value,
            alternativeId: 'stale',
            baselineRevision: 'obsolete-r0',
          },
        },
      },
    };
    collaborationState.authored[
      'draft-scenario:community-plan:synthetic-park:stale'
    ] = staleRecord;
    collaborationState.authored[
      'draft-scenario:community-plan:other-project:unrelated'
    ] = staleRecord;
    const preview = openCommunityPlanningPreview({ project, collaborationState });
    try {
      return {
        summary: preview.element.querySelector(
          '[data-planning-record-summary]',
        ).textContent,
        visibleIds: [
          ...preview.element.querySelectorAll('[data-alternative-id]'),
        ].map((item) => item.dataset.alternativeId),
      };
    } finally {
      preview.dispose();
    }
  });
  assert.ok(excluded.summary.includes('1 stale/incompatible excluded'));
  assert.deepEqual(excluded.visibleIds, ['play-first', 'trees-first']);
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  console.log('Community planning preview: 2 hypothetical proposals, 5 markers, baseline provenance, keyboard, mobile viewport, Escape/reopen and close PASS');
} finally {
  await browser.close();
}
