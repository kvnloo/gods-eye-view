import '../../testSupport/registerDom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createGevActionRunner } from '../../voice/gevActions.js';
import { PanelChrome } from '../panelChrome.js';
import { PanelNavigation } from '../panelNavigation.js';
import { followPanelState } from '../rail/panelState.js';
import { createUiRuntime } from '../vueRuntime.js';
import { usePanelChromeStore } from './panelChrome.js';
import { usePanelStore } from './panels.js';

test('the panel store reports each side’s open panel and keeps unchanged sides', () => {
  const store = usePanelStore(createPinia());
  const left = [
    { id: 'data-panel', open: false, available: true },
    { id: 'scene-panel', open: true, available: true },
  ];
  store.setSide('left', left);
  store.setSide('right', [
    { id: 'weather-panel', open: true, available: false },
  ]);
  assert.equal(store.openPanelId('left'), 'scene-panel');
  // An open panel that is not offered is not the side's open panel.
  assert.equal(store.openPanelId('right'), null);
  assert.equal(store.isOpen('scene-panel'), true);
  assert.equal(store.isOpen('data-panel'), false);
  const published = store.sides.left;
  store.setSide(
    'left',
    left.map((panel) => ({ ...panel })),
  );
  assert.equal(store.sides.left, published);
});

test('closing a side’s panel clears only that side', () => {
  const store = usePanelStore(createPinia());
  store.setSide('left', [
    { id: 'data-panel', open: true, available: true },
    { id: 'scene-panel', open: false, available: true },
  ]);
  store.setSide('right', [{ id: 'pp-toggles', open: true, available: true }]);
  const right = store.sides.right;
  store.setSide('left', [
    { id: 'data-panel', open: false, available: true },
    { id: 'scene-panel', open: false, available: true },
  ]);
  assert.equal(store.openPanelId('left'), null);
  assert.equal(store.isOpen('data-panel'), false);
  assert.equal(store.openPanelId('right'), 'pp-toggles');
  assert.equal(store.sides.right, right);
  // A side whose stack is gone publishes nothing open.
  store.setSide('right', []);
  assert.equal(store.openPanelId('right'), null);
  assert.equal(store.isOpen('pp-toggles'), false);
});

// The composed rails: PanelChrome owns disclosure, PanelNavigation publishes
// the stacks to this store and mounts the rails, and the voice runner opens
// panels through the same `setPanelCollapsed` the shell delegates.
const LEFT = ['data-panel', 'utilities-panel', 'scene-panel'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];

function panelMarkup(id, open) {
  const shown = id === 'data-panel' ? ' active' : '';
  return `<div id="${id}" data-panel-id="${id}" class="panel-collapsible${shown}${open ? '' : ' collapsed'}">
    <div class="panel-header"><span class="panel-title">${id}</span>
      <button class="panel-collapse-btn" data-collapse-target="${id}"></button></div>
    <div class="panel-body"><button class="inside">x</button></div>
  </div>`;
}

async function setup(t, { phone = false } = {}) {
  localStorage.clear();
  // The phone shell and the stack layouts both follow the 720px breakpoint.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  if (phone) globalThis.happyDOM.setViewport({ width: 390, height: 844 });
  document.body.className = phone ? 'mobile-shell' : '';
  document.body.innerHTML = `
    <div id="left-panel-stack">${LEFT.map((id) => panelMarkup(id, id === 'data-panel')).join('')}</div>
    <div id="right-context-rail">${RIGHT.map((id) => panelMarkup(id, false)).join('')}</div>`;
  const left = document.getElementById('left-panel-stack');
  const right = document.getElementById('right-context-rail');
  const ui = createUiRuntime();
  const store = usePanelChromeStore(ui.pinia);
  const stops = [...LEFT, ...RIGHT].map((id) =>
    followPanelState(store, id, document.getElementById(id)),
  );
  const chrome = new PanelChrome({
    elements: { _leftPanelStack: left, _rightPanelStack: right },
    operations: { _showToast() {}, _syncCctvPanelViewport() {} },
    readHud: () => ({ visible: false, getVariant: () => null }),
    readCockpit: () => null,
    readShareLinks: () => null,
    readInitialShare: () => null,
    readScrollRestoreOwner: () => null,
    readDisplayScrollTop: () => 0,
    store,
  });
  chrome._initPanelChrome();
  const navigation = new PanelNavigation({
    ui,
    stacks: { left, right },
    setPanelCollapsed: (...args) => chrome.setPanelCollapsed(...args),
  });
  navigation.init();
  const voice = createGevActionRunner({
    viewer: {
      clock: { onTick: { addEventListener: () => () => {} } },
      scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
      camera: { moveEnd: { addEventListener() {} } },
    },
    // The shell facade delegates panel disclosure to PanelChrome.
    styleManager: {
      setPanelCollapsed: (...args) => chrome.setPanelCollapsed(...args),
    },
    dataManager: {
      layers: new Map(),
      isEnabled: () => false,
      getAll: () => [],
    },
  });
  t.after(() => {
    navigation.destroy();
    chrome.destroy();
    for (const stop of stops) stop();
    ui.destroy();
    document.body.className = '';
    document.body.innerHTML = '';
    globalThis.happyDOM.setViewport(viewport);
  });
  // The rails render the store's first publication on Vue's next flush.
  await nextTick();
  return {
    left,
    right,
    chrome,
    navigation,
    panels: usePanelStore(ui.pinia),
    voice,
  };
}

// The rail store follows the stacks through a MutationObserver.
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};
const openIds = (stack) =>
  [...stack.children]
    .filter(
      (panel) =>
        panel.matches('[data-panel-id]') &&
        !panel.hidden &&
        !panel.classList.contains('collapsed'),
    )
    .map((panel) => panel.id);
const pressed = (stack) =>
  [...stack.querySelectorAll('.ui-rail [aria-pressed="true"]')].map(
    (button) => button.dataset.railItem,
  );
const railItem = (stack, id) =>
  stack.querySelector(`.ui-rail [data-rail-item="${id}"]`);

/** One panel open on each side, agreed by the DOM, store and rail. */
async function assertSides(f, expected) {
  await settle();
  for (const side of ['left', 'right']) {
    const stack = f[side];
    const id = expected[side];
    assert.deepEqual(openIds(stack), id ? [id] : [], `${side} stack`);
    assert.equal(f.panels.openPanelId(side), id, `${side} store`);
    assert.deepEqual(pressed(stack), id ? [id] : [], `${side} rail`);
    assert.equal(
      stack.querySelector('.ui-rail').classList.contains('ui-rail--expanded'),
      !id,
      `${side} rail labels`,
    );
    // Opening closed the peers outright, as saved and shared state records
    // them, not only for the layout pass to hide (`accordion-collapsed`).
    for (const panel of stack.querySelectorAll(':scope > [data-panel-id]')) {
      const shown = f.chrome._chromeStore.panels[panel.id];
      assert.equal(shown?.auto ?? null, null, `${side} ${panel.id}`);
      const key = f.chrome._panelPosition._panelCollapseStorageKey(panel.id);
      if (panel.id !== id)
        assert.notEqual(localStorage.getItem(key), '0', `${side} ${panel.id}`);
    }
  }
}

test('rail selection opens exactly one desktop panel per side', async (t) => {
  const f = await setup(t);
  await assertSides(f, { left: 'data-panel', right: null });
  railItem(f.left, 'scene-panel').click();
  await assertSides(f, { left: 'scene-panel', right: null });
  railItem(f.right, 'pp-toggles').click();
  await assertSides(f, { left: 'scene-panel', right: 'pp-toggles' });
  railItem(f.right, 'global-context-panel').click();
  await assertSides(f, {
    left: 'scene-panel',
    right: 'global-context-panel',
  });
  railItem(f.left, 'utilities-panel').click();
  await assertSides(f, {
    left: 'utilities-panel',
    right: 'global-context-panel',
  });
});

test('voice opens exactly one desktop panel per side', async (t) => {
  const f = await setup(t);
  for (const [spoken, side, id] of [
    ['hud controls', 'right', 'pp-toggles'],
    ['cameras', 'right', 'cctv-panel'],
    ['authoring', 'left', 'scene-panel'],
    ['context', 'right', 'global-context-panel'],
    ['utilities', 'left', 'utilities-panel'],
    ['layers', 'left', 'data-panel'],
  ]) {
    const result = await f.voice('set_panel_open', {
      panelId: spoken,
      open: true,
    });
    assert.equal(result.ok, true, spoken);
    assert.equal(result.panelId, id, spoken);
    await settle();
    assert.deepEqual(openIds(f[side]), [id], spoken);
  }
  await assertSides(f, {
    left: 'data-panel',
    right: 'global-context-panel',
  });
});

test('keyboard disclosure opens exactly one desktop panel per side', async (t) => {
  const f = await setup(t);
  const chromeStore = f.chrome._chromeStore;
  // Enter or Space on a panel header's collapse button reaches the chrome
  // as that button's toggle.
  chromeStore.act('toggle', 'utilities-panel');
  await assertSides(f, { left: 'utilities-panel', right: null });
  chromeStore.act('toggle', 'cctv-panel');
  chromeStore.act('toggle', 'pp-toggles');
  await assertSides(f, { left: 'utilities-panel', right: 'pp-toggles' });
  // `f` hides Data Layers; showing it again offers it closed, and opening
  // it from the keyboard still leaves one panel on the side.
  document.getElementById('data-panel').classList.remove('active');
  await settle();
  assert.equal(railItem(f.left, 'data-panel'), null);
  document.getElementById('data-panel').classList.add('active');
  await settle();
  chromeStore.act('toggle', 'data-panel');
  await assertSides(f, { left: 'data-panel', right: 'pp-toggles' });
});

test('a feature revealing a side panel still leaves one open there', async (t) => {
  const f = await setup(t);
  f.chrome.setPanelCollapsed('pp-toggles', false, { explicit: true });
  // The `c` shortcut enables CCTV, whose presentation reveals its panel
  // without an explicit disclosure.
  f.chrome.setPanelCollapsed('cctv-panel', false);
  await assertSides(f, { left: 'data-panel', right: 'cctv-panel' });
});

test('closing a panel by rail, voice or Escape leaves its side empty and the other alone', async (t) => {
  const f = await setup(t);
  railItem(f.right, 'pp-toggles').click();
  await assertSides(f, { left: 'data-panel', right: 'pp-toggles' });

  // The open panel's own rail item closes it.
  railItem(f.left, 'data-panel').click();
  await assertSides(f, { left: null, right: 'pp-toggles' });
  assert.equal(f.chrome._panelLayout._leftStackPreferredPanelId, null);
  assert.equal(f.chrome._panelLayout._rightStackPreferredPanelId, 'pp-toggles');

  const closed = await f.voice('set_panel_open', {
    panelId: 'hud controls',
    open: false,
  });
  assert.equal(closed.ok, true);
  await assertSides(f, { left: null, right: null });
  assert.equal(f.chrome._panelLayout._rightStackPreferredPanelId, null);

  railItem(f.left, 'scene-panel').click();
  await assertSides(f, { left: 'scene-panel', right: null });
  const inside = document.querySelector('#scene-panel .inside');
  inside.focus();
  const escape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  inside.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  await assertSides(f, { left: null, right: null });
  assert.equal(f.chrome._panelLayout._leftStackPreferredPanelId, null);
  // Focus stays on something that can reopen the panel.
  assert.ok(
    [
      railItem(f.left, 'scene-panel'),
      document.querySelector('[data-collapse-target="scene-panel"]'),
    ].includes(document.activeElement),
  );
  // Nothing closed is left half-presented.
  for (const id of [...LEFT, ...RIGHT]) {
    const panel = document.getElementById(id);
    assert.equal(panel.classList.contains('accordion-collapsed'), false, id);
    assert.equal(f.chrome._chromeStore.panels[id]?.auto ?? null, null, id);
  }
});

test('phone sheets keep several rail panels open, by any route', async (t) => {
  const f = await setup(t, { phone: true });
  railItem(f.left, 'scene-panel').click();
  await f.voice('set_panel_open', { panelId: 'utilities', open: true });
  f.chrome._chromeStore.act('toggle', 'pp-toggles');
  await f.voice('set_panel_open', { panelId: 'cameras', open: true });
  await settle();
  assert.deepEqual(openIds(f.left), LEFT);
  assert.deepEqual(openIds(f.right), ['pp-toggles', 'cctv-panel']);
  // In a sheet, Escape closes the sheet (mobileShell.js), not a panel.
  document.body.setAttribute('data-mobile-sheet', 'layers');
  const inside = document.querySelector('#scene-panel .inside');
  inside.focus();
  const escape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  inside.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, false);
  await settle();
  assert.deepEqual(openIds(f.left), LEFT);
});
