import '../testSupport/registerDom.mjs';
import { createPinia } from 'pinia';
import { DisplayBindings } from './displayBindings.js';
import { PanelChrome } from './panelChrome.js';
import { followPanelState } from './rail/panelState.js';
import { useDisplayStore } from './stores/display.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import assert from 'node:assert/strict';
import test from 'node:test';
// Generated parameter rows render through Vue: styleParameters.test.mjs.
import { bindApplicationShortcuts } from './visualInput.js';

class Element {
  constructor(tagName = 'DIV', ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }
  addEventListener(type, listener, capture) {
    assert.notEqual(
      capture,
      true,
      'these controls must not preempt capture-phase surfaces',
    );
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])])
      listener(event);
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  append(...children) {
    this.children.push(...children);
  }
  appendChild(child) {
    this.children.push(child);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  matches() {
    return ['INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName);
  }
}

function shortcuts() {
  const documentRef = new Element();
  const searchInput = new Element();
  const calls = [];
  const names = [
    'setStyle',
    'dismissSearch',
    'toggleHud',
    'toggleOrbit',
    'toggleCleanView',
    'toggleLayers',
    'cycleDetection',
    'toggleCctv',
  ];
  const actions = Object.fromEntries(
    names.map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  const controller = bindApplicationShortcuts({
    documentRef,
    searchInput,
    actions,
  });
  const press = (key, target = new Element(), rest = {}) =>
    documentRef.emit('keydown', { key, target, ...rest });
  return { documentRef, searchInput, calls, controller, press };
}

test('number keys retain the six style mappings', () => {
  const f = shortcuts();
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', 'Space'])
    f.press(key);
  assert.deepEqual(
    f.calls,
    ['normal', 'retro', 'surveillance', 'thermal', 'anime', 'noir'].map(
      (style) => ['setStyle', style],
    ),
  );
});

test('letter shortcuts retain uppercase handling and existing actions', () => {
  const f = shortcuts();
  for (const key of ['H', 'o', 'V', 'f', 'D', 'c']) f.press(key);
  assert.deepEqual(
    f.calls,
    [
      'toggleHud',
      'toggleOrbit',
      'toggleCleanView',
      'toggleLayers',
      'cycleDetection',
      'toggleCctv',
    ].map((name) => [name]),
  );
});

for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) {
  test(`${tag} retains native editing, while Escape reaches search dismissal`, () => {
    const f = shortcuts();
    for (const key of ['1', 'h', 'o', 'v', 'f', 'd', 'c'])
      f.press(key, new Element(tag));
    assert.deepEqual(f.calls, []);
    f.press('Escape', new Element(tag));
    assert.deepEqual(f.calls, [['dismissSearch']]);
  });
}

test('the supplied search target retains editing even without form markup', () => {
  const f = shortcuts();
  f.press('1', f.searchInput);
  f.press('Escape', f.searchInput);
  assert.deepEqual(f.calls, [['dismissSearch']]);
});

test('browser shortcuts with Cmd, Ctrl or Alt never reach app shortcuts', () => {
  const f = shortcuts();
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey'])
    for (const key of ['1', 'h', 'o', 'v', 'f', 'd', 'c'])
      f.press(key, new Element(), { [modifier]: true });
  assert.deepEqual(f.calls, []);
  f.press('Escape', new Element(), { metaKey: true });
  assert.deepEqual(f.calls, [['dismissSearch']]);
});

test('a held key still repeats its shortcut', () => {
  const f = shortcuts();
  f.press('h', new Element(), { repeat: true });
  assert.deepEqual(f.calls, [['toggleHud']]);
});

test('F collapses Data Layers without hiding its rail entry', (t) => {
  document.body.innerHTML = [
    '<section id="data-panel" class="active panel-collapsible">',
    '<button class="panel-collapse-btn" data-collapse-target="data-panel"></button>',
    '</section>',
  ].join('');
  const panel = document.getElementById('data-panel');
  const chromeStore = usePanelChromeStore(createPinia());
  const chrome = new PanelChrome({
    elements: {},
    operations: {},
    readHud: () => ({ visible: false, getVariant: () => null }),
    readCockpit: () => null,
    readShareLinks: () => null,
    readInitialShare: () => null,
    readScrollRestoreOwner: () => null,
    readDisplayScrollTop: () => 0,
    store: chromeStore,
  });
  const stopFollowing = followPanelState(chromeStore, 'data-panel', panel);
  chrome._disclosurePanelIds = new Set(['data-panel']);

  const bindings = new DisplayBindings({
    viewer: null,
    services: {
      cycleDetectionMode() {},
      isScopeMaskEnabled: () => false,
    },
    elements: { _locationSearch: document.createElement('input') },
    operations: {
      _setScope() {},
      _togglePanel: (id) => chrome._togglePanel(id),
    },
    readState: () => ({}),
    claimDetection() {},
    displayStore: useDisplayStore(createPinia()),
  });
  bindings._initUI();
  t.after(() => {
    bindings.destroy();
    stopFollowing();
    chrome.destroy();
    document.body.replaceChildren();
  });

  const pressF = (modifiers = {}) =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true, ...modifiers }),
    );
  pressF();
  assert.equal(chromeStore.panels['data-panel'].collapsed, true);
  assert.equal(panel.classList.contains('collapsed'), true);
  assert.equal(
    panel.classList.contains('active'),
    true,
    'F must leave the Layers rail entry available',
  );

  // The existing panel button and F use the same disclosure owner.
  chromeStore.act('toggle', 'data-panel');
  assert.equal(chromeStore.panels['data-panel'].collapsed, false);
  assert.equal(panel.classList.contains('active'), true);

  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    pressF({ [modifier]: true });
    assert.equal(chromeStore.panels['data-panel'].collapsed, false);
  }

  pressF();
  assert.equal(chromeStore.panels['data-panel'].collapsed, true);
  assert.equal(panel.classList.contains('active'), true);
});

test('destroy synchronously removes shortcuts and a replacement binds once', () => {
  const f = shortcuts();
  f.controller.destroy();
  f.controller.destroy();
  f.press('h');
  assert.deepEqual(f.calls, []);
  assert.equal(f.documentRef.listeners.get('keydown').size, 0);
  const replacement = bindApplicationShortcuts({
    documentRef: f.documentRef,
    searchInput: f.searchInput,
    actions: { toggleHud: () => f.calls.push('new') },
  });
  f.press('h');
  assert.deepEqual(f.calls, ['new']);
  replacement.destroy();
});
