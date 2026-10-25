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
      editProvenance: [...dialog.querySelectorAll('.planning-edit-provenance')]
        .map((node) => node.textContent),
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
    editProvenance: [
      'Recorded edit: bob-play-v1 · logical counter: 1 (unverified, not approval)',
      'Recorded edit: alice-trees-v1 · logical counter: 1 (unverified, not approval)',
    ],
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
  // Use Puppeteer pointer interaction, not a hidden button's synthetic click.
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="game"]',
  );
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
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="co-op"]',
  );
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
  // Use Puppeteer pointer interaction, not a hidden button's synthetic click.
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="game"]',
  );
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

  // Set mobile/touch emulation before navigation. Changing isMobile or
  // hasTouch on the active desktop page can reload it and destroy the modal.
  const mobilePage = await browser.newPage();
  try {
    await mobilePage.setViewport({
      width: 375,
      height: 667,
      isMobile: true,
      hasTouch: true,
    });
    await mobilePage.goto(url.href, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await mobilePage.waitForFunction(
      () =>
        window.__godsEyeView?.sceneDirector?._controls &&
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 60000 },
    );
    if (
      await mobilePage.$eval('#scene-panel', (panel) =>
        panel.classList.contains('collapsed'),
      )
    )
      await mobilePage.tap('[data-collapse-target="scene-panel"]');
    await mobilePage.waitForSelector('[data-community-planning-preview-open]', {
      visible: true,
      timeout: 45000,
    });
    // Touch the actual opt-in launcher rather than clicking an invisible node.
    await mobilePage.tap('[data-community-planning-preview-open]');
    await mobilePage.waitForSelector('[data-community-planning-preview]', {
      visible: true,
    });
    const mobile = await mobilePage.evaluate(() => {
      const dialog = document.querySelector('[data-community-planning-preview]');
      const rect = dialog.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        left: rect.left,
        right: rect.right,
        open: dialog.open,
        disclaimer: dialog.textContent.includes('HYPOTHETICAL · NOT APPROVED'),
        alternatives: dialog.querySelectorAll('[data-alternative-id]').length,
      };
    });
    assert.equal(mobile.open, true);
    assert.equal(mobile.disclaimer, true);
    assert.equal(mobile.alternatives, 2);
    assert.ok(mobile.viewportWidth <= 400, 'mobile CSS viewport did not activate');
    assert.ok(
      mobile.left >= -1 && mobile.right <= mobile.viewportWidth + 1,
      'planning dialog clips outside the mobile CSS viewport',
    );
    // Real emulated touch must switch between one-card and two-card modes.
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-mode="game"]',
    );
    assert.deepEqual(
      await mobilePage.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
      ),
      ['play-first'],
    );
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-mode="co-op"]',
    );
    assert.deepEqual(
      await mobilePage.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
      ),
      ['play-first', 'trees-first'],
    );
    await mobilePage.keyboard.press('Escape');
    assert.equal(await mobilePage.$('[data-community-planning-preview]'), null);
  } finally {
    await mobilePage.close();
  }

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
  // Cancel must be an actual visible pointer target, not Element.click().
  await page.click(
    '[data-community-planning-preview] [data-planning-cancel]',
  );
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
  // Negative controls: a stale winner cannot count as a valid proposal.
  // One or zero valid alternatives must not expose a usable compare mode.
  const insufficient = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const inspect = (staleIds) => {
      const { project, collaborationState } =
        createSyntheticCommunityPlanningFixture();
      for (const id of staleIds) {
        const key = `draft-scenario:community-plan:synthetic-park:${id}`;
        const proposal = collaborationState.authored[key].fields.proposal;
        proposal.value = {
          ...proposal.value,
          baselineRevision: 'obsolete-r0',
        };
      }
      const preview = openCommunityPlanningPreview({ project, collaborationState });
      try {
        const root = preview.element;
        return {
          visibleIds: [...root.querySelectorAll('[data-alternative-id]')]
            .map((item) => item.dataset.alternativeId),
          gameDisabled: [...root.querySelectorAll('button')].find(
            (button) => button.textContent === 'Game view'
          ).disabled,
          notice: root.querySelector('[data-planning-comparison-unavailable]')
            ?.textContent,
          excluded: root.querySelector('[data-planning-record-summary]')
            .textContent.includes(`${staleIds.length} stale/incompatible excluded`),
        };
      } finally {
        preview.dispose();
      }
    };
    return {
      one: inspect(['play-first']),
      none: inspect(['play-first', 'trees-first']),
    };
  });
  assert.deepEqual(insufficient, {
    one: {
      visibleIds: ['trees-first'],
      gameDisabled: true,
      notice: 'Only one valid proposal is available; comparing requires two.',
      excluded: true,
    },
    none: {
      visibleIds: [],
      gameDisabled: true,
      notice: 'No valid proposals to compare; excluded records cannot be displayed as alternatives.',
      excluded: true,
    },
  });
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // A missing or malformed clock must never invent authorship or an edit ID.
  const missingClock = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const key = 'draft-scenario:community-plan:synthetic-park:play-first';
    delete collaborationState.authored[key].fields.proposal.clock;
    const preview = openCommunityPlanningPreview({ project, collaborationState });
    try {
      const card = preview.element.querySelector(
        '[data-alternative-id="play-first"]',
      );
      return {
        author: card.querySelector('.planning-author-credit').textContent,
        edit: card.querySelector('.planning-edit-provenance').textContent,
      };
    } finally {
      preview.dispose();
    }
  });
  assert.deepEqual(missingClock, {
    author: 'Recorded author: unknown',
    edit: 'Recorded edit: unknown (no valid recorded operation metadata)',
  });
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  console.log('Community planning preview: synthetic proposals, attribution, missing-clock fail-closed, keyboard, mobile, teardown PASS');
} finally {
  await browser.close();
}
