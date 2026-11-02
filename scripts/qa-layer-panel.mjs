#!/usr/bin/env node
/** Browser proof of Layers panel replacement, subscription ownership and the panel rails. */
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
let failures = 0;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const check = (name, passed) => {
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) failures++;
};
try {
  await page.goto(
    `${process.env.QA_BASE_URL || 'http://localhost:4173'}/?welcome=0`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 60000,
  });
  const results = await page.evaluate(async () => {
    const manager = window.__godsEyeView.dataManager;
    const entry = document.querySelector(
      'script[type="module"][src*="/src/main.js"]',
    );
    const { application } = await import(entry.src);
    const { presentation } = application.getComponents().data;
    const container = presentation.panel._toggleContainer;
    const id = 'qa-panel-lifecycle';
    let listener = null;
    let enabled = 0;
    window.__gevQaRegisterLayer(manager, {
      id,
      name: '<b>Literal layer</b>',
      icon: '◌',
      source: 'Local fixture',
      updateInterval: -1,
      init() {},
      enable() {
        enabled++;
      },
      disable() {},
      update() {},
      destroy() {},
      getStats: () => ({ count: 1250, lastUpdate: Date.now(), stale: true }),
      getRowControls: () => ({ chips: [] }),
      setRowControlsListener: (callback) => {
        listener = callback;
      },
    });
    const result = [];
    try {
      presentation.mount(container);
      const row = () => container.querySelector(`[data-layer-id="${id}"]`);
      const first = row().querySelector('.data-toggle-btn');
      result.push([
        'descriptor text is literal content',
        row().querySelector('.data-name').textContent ===
          '<b>Literal layer</b>' && !row().querySelector('b'),
      ]);
      result.push([
        'row subscription is installed',
        typeof listener === 'function',
      ]);
      presentation.mount(container);
      first.click();
      await Promise.resolve();
      result.push([
        'a detached row cannot issue an enable action',
        enabled === 0 && !manager.isEnabled(id),
      ]);
      await manager.setEnabled(id, true);
      result.push([
        'count is presented from the supplied snapshot',
        row().querySelector('.data-count').textContent === '1.3K',
      ]);
      result.push([
        'feed state reflects the settled layer snapshot',
        row().querySelector('.data-toggle-btn').dataset.feedState === 'stale',
      ]);
      const ui = window.__godsEyeView.styleManager;
      const clearButton = document.getElementById('clear-selected-layers');
      clearButton.click();
      // The bar renders the busy state on Vue's next flush.
      await Promise.resolve();
      result.push([
        'native clear activation presents busy state',
        clearButton.getAttribute('aria-busy') === 'true' &&
          !!ui._contextControls._clearSelectedLayersPromise,
      ]);
      await ui._contextControls._clearSelectedLayersPromise;
      await Promise.resolve();
      result.push([
        'clear settles through the existing layer transaction',
        !manager.isEnabled(id) &&
          clearButton.getAttribute('aria-busy') === 'false',
      ]);
      await manager.setEnabled(id, true);
      const final = row().querySelector('.data-toggle-btn');
      presentation._panel.destroy();
      final.click();
      await Promise.resolve();
      result.push([
        'destroyed panel releases row subscriptions',
        listener === null,
      ]);
      result.push([
        'destroyed controls cannot change the layer',
        manager.isEnabled(id),
      ]);
    } finally {
      presentation._panel?.destroy();
      presentation._panel = null;
      await window.__gevQaUnregisterLayer(manager, id);
      presentation.mount(container);
    }
    result.push([
      'ordinary layer rows return after reassembly',
      container.querySelectorAll('.data-toggle-row').length > 10,
    ]);
    result.push([
      'Directions returns to the Utilities list after reassembly',
      Boolean(
        document.querySelector(
          '#utilities-toggles [data-layer-id="directions"]',
        ) && !container.querySelector('[data-layer-id="directions"]'),
      ),
    ]);
    return result;
  });
  for (const [name, passed] of results) check(name, passed);

  // Panel rails: keyboard and voice open exactly one desktop panel per side,
  // closing leaves nothing behind, and phone sheets keep their own rules.
  const STACKS = { left: '#left-panel-stack', right: '#right-context-rail' };
  const sides = () =>
    page.evaluate((stacks) => {
      const read = (selector) => {
        const stack = document.querySelector(selector);
        const panels = [...stack.querySelectorAll(':scope > [data-panel-id]')];
        const rail = stack.querySelector(':scope > .gev-panel-rail .ui-rail');
        return {
          open: panels
            .filter((panel) => !panel.hidden)
            .filter((panel) => !panel.classList.contains('collapsed'))
            .map((panel) => panel.id),
          accordion: panels
            .filter((panel) => panel.classList.contains('accordion-collapsed'))
            .map((panel) => panel.id),
          pressed: [
            ...(rail?.querySelectorAll('[aria-pressed="true"]') ?? []),
          ].map((item) => item.dataset.railItem),
          railShown: Boolean(rail?.getClientRects().length),
          railExpanded: Boolean(rail?.classList.contains('ui-rail--expanded')),
        };
      };
      return { left: read(stacks.left), right: read(stacks.right) };
    }, STACKS);
  // Disclosure settles the stacks over a frame or two.
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const voice = (panelId, open = true) =>
    page.evaluate(
      (args) => window.__gevVoiceCommands.runner('set_panel_open', args),
      { panelId, open },
    );
  const railKey = async (side, panelId, key) => {
    await page.focus(`${STACKS[side]} .ui-rail [data-rail-item="${panelId}"]`);
    await page.keyboard.press(key);
    await settle();
  };
  const oneOpen = (state, side, id) =>
    state[side].open.length === 1 &&
    state[side].open[0] === id &&
    state[side].pressed.length === 1 &&
    state[side].pressed[0] === id &&
    !state[side].railExpanded &&
    state[side].accordion.length === 0;
  const noneOpen = (state, side) =>
    state[side].open.length === 0 &&
    state[side].pressed.length === 0 &&
    state[side].railExpanded &&
    state[side].accordion.length === 0;

  await page.setViewport({ width: 1440, height: 900 });
  await page.waitForFunction(
    () => !document.body.classList.contains('mobile-shell'),
  );
  await page.evaluate(() => {
    const shell = window.__godsEyeView.styleManager;
    for (const panel of document.querySelectorAll(
      '#left-panel-stack > [data-panel-id], #right-context-rail > [data-panel-id]',
    ))
      shell.setPanelCollapsed(panel.id, true, { explicit: true });
  });
  await settle();
  let state = await sides();
  check(
    'desktop rails show labelled items while no side panel is open',
    state.left.railShown &&
      state.right.railShown &&
      noneOpen(state, 'left') &&
      noneOpen(state, 'right'),
  );

  await railKey('left', 'scene-panel', 'Enter');
  state = await sides();
  check(
    'Enter on a rail item opens its panel alone on that side',
    oneOpen(state, 'left', 'scene-panel') && noneOpen(state, 'right'),
  );
  await railKey('left', 'data-panel', 'Space');
  await railKey('right', 'pp-toggles', 'Enter');
  state = await sides();
  check(
    'Space on another item swaps the side’s panel; the other side opens its own',
    oneOpen(state, 'left', 'data-panel') &&
      oneOpen(state, 'right', 'pp-toggles'),
  );
  await railKey('right', 'global-context-panel', 'Enter');
  state = await sides();
  check(
    'keyboard leaves exactly one desktop panel per side',
    oneOpen(state, 'left', 'data-panel') &&
      oneOpen(state, 'right', 'global-context-panel'),
  );

  const opened = await voice('utilities');
  await voice('hud controls');
  await settle();
  state = await sides();
  check(
    'voice leaves exactly one desktop panel per side',
    opened?.ok === true &&
      oneOpen(state, 'left', 'utilities-panel') &&
      oneOpen(state, 'right', 'pp-toggles'),
  );

  await page.evaluate(() => {
    const panel = document.getElementById('utilities-panel');
    const focusable = panel.querySelector(
      'button:not([disabled]), input, [tabindex="0"]',
    );
    (focusable ?? panel).focus();
  });
  await page.keyboard.press('Escape');
  await settle();
  state = await sides();
  const focusedItem = await page.evaluate(
    () => document.activeElement?.dataset?.railItem ?? null,
  );
  check(
    'Escape closes the open panel, empties its rail and returns focus to its item',
    noneOpen(state, 'left') &&
      oneOpen(state, 'right', 'pp-toggles') &&
      focusedItem === 'utilities-panel',
  );
  await voice('hud controls', false);
  await settle();
  state = await sides();
  check(
    'closing by voice leaves no panel, pressed item or folded peer behind',
    noneOpen(state, 'left') && noneOpen(state, 'right'),
  );

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.waitForFunction(() =>
    document.body.classList.contains('mobile-shell'),
  );
  await settle();
  state = await sides();
  check(
    'phone layout hides the desktop rails',
    !state.left.railShown && !state.right.railShown,
  );
  await page.focus('#mobile-tab-bar [data-mobile-sheet="layers"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.body.getAttribute('data-mobile-sheet') === 'layers',
  );
  await voice('authoring');
  await settle();
  state = await sides();
  check(
    'a phone sheet keeps several rail panels open at once',
    state.left.open.includes('data-panel') &&
      state.left.open.includes('scene-panel') &&
      state.left.accordion.length === 0,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.body.hasAttribute('data-mobile-sheet'),
  );
  const sheetTab = await page.evaluate(
    () => document.activeElement?.dataset?.mobileSheet ?? null,
  );
  check(
    'Escape closes the phone sheet and returns to its tab',
    sheetTab === 'layers',
  );

  check('no uncaught browser errors', errors.length === 0);
} finally {
  await browser.close();
}
console.log(`RESULT: ${failures} failures`);
process.exitCode = failures ? 1 : 0;
