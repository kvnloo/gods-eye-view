import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Exercise compact Radio ownership through real controls, without DOM fixtures. */
export async function checkCompactRadioRestoration(browser, url, shotsDir) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const states = [];
  try {
    await page.setViewport({ width: 1440, height: 900 });
    const target = new URL(url);
    target.searchParams.set('welcome', '0');
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.__godsEyeView?.styleManager &&
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    await page.evaluate(() => {
      window.__radioOwnershipEvents = [];
      for (const type of ['click', 'keydown', 'change']) {
        document.addEventListener(
          type,
          (event) => {
            window.__radioOwnershipEvents.push({
              type,
              id: event.target.id,
              key: event.key,
              trusted: event.isTrusted,
            });
          },
          true,
        );
      }
    });
    const capture = async (name) => {
      const state = await page.evaluate(() => {
        const owner = document.getElementById('global-context-panel');
        const mini = document.getElementById('context-radio-mini');
        const rect = mini.getBoundingClientRect();
        return {
          ownerClasses: owner.className,
          ownerRect: owner.getBoundingClientRect().toJSON(),
          miniRect: rect.toJSON(),
          miniVisible: rect.width > 0 && rect.height > 0,
          disclosure: document
            .getElementById('context-radio-toggle-btn')
            .getAttribute('aria-expanded'),
          focus: document.activeElement.id,
        };
      });
      states.push({ name, ...state });
      await page.screenshot({
        path: path.join(shotsDir, `ownership-${name}.png`),
        fullPage: true,
      });
      return state;
    };
    await page.click('[data-collapse-target="pp-toggles"]');
    await page.select('#hud-layout-select', 'minimal');
    await page.click('[data-collapse-target="global-context-panel"]');
    // Display is the preferred panel when Cyber passively collapses Context.
    await page.click('[data-collapse-target="pp-toggles"]');
    await page.click('[data-collapse-target="pp-toggles"]');
    await page.select('#hud-layout-select', 'cyber');
    await page.waitForFunction(() =>
      document
        .getElementById('global-context-panel')
        .classList.contains('cyber-accordion-collapsed'),
    );
    await page.click('#context-radio-toggle-btn');
    const compact = await capture('compact');
    assert.equal(
      compact.miniVisible,
      true,
      'the real compact control must open first',
    );
    assert.equal(compact.disclosure, 'true');
    // Pointerdown outside Radio correctly dismisses it. Use the supported
    // keyboard path to change theme without that unrelated dismissal masking it.
    for (let step = 0; step < 100; step++) {
      if (
        await page.evaluate(
          () => document.activeElement.id === 'hud-layout-select',
        )
      )
        break;
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
    }
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      'hud-layout-select',
    );
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Tab');
    await page.waitForFunction(
      () =>
        !document
          .getElementById('global-context-panel')
          .classList.contains('collapsed'),
    );
    const restored = await capture('restored');
    assert.equal(
      restored.miniVisible,
      false,
      'restored Context must dismiss compact Radio',
    );
    assert.deepEqual(errors, []);
  } finally {
    fs.writeFileSync(
      path.join(shotsDir, 'ownership.json'),
      JSON.stringify(
        {
          states,
          errors,
          events: await page
            .evaluate(() => window.__radioOwnershipEvents || [])
            .catch(() => []),
        },
        null,
        2,
      ),
    );
    await context.close();
  }
}
