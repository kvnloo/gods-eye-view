import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanetPlayground } from './index.js';

/** Deterministic DOM adapter; not a real browser or Cesium acceptance test. */
function syntheticDocument() {
  const nodes = [];
  const handlers = new Map();
  const doc = {
    activeElement: null,
    createElement(tag) {
      const listeners = new Map();
      const node = {
        tag,
        ownerDocument: doc,
        listeners,
        dataset: {},
        style: {},
        attributes: new Map(),
        children: [],
        isConnected: false,
        setAttribute(name, value) {
          this.attributes.set(name, String(value));
        },
        append(...children) {
          this.children.push(...children);
        },
        replaceChildren(...children) {
          this.children = children;
        },
        focus() {
          doc.activeElement = this;
        },
        remove() {
          this.isConnected = false;
        },
        addEventListener(type, callback) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) {
          listeners.get(type)?.delete(callback);
        },
        fire(type, init = {}) {
          const event = {
            defaultPrevented: false,
            key: init.key ?? type,
            altKey: Boolean(init.altKey),
            ctrlKey: Boolean(init.ctrlKey),
            metaKey: Boolean(init.metaKey),
            preventDefault() {
              this.defaultPrevented = true;
            },
          };
          for (const callback of [...(listeners.get(type) || [])])
            callback(event);
          return event;
        },
      };
      nodes.push(node);
      return node;
    },
    querySelector(selector) {
      if (selector !== '#planet-playground-launcher') return null;
      return (
        nodes.find(
          (node) => node.id === 'planet-playground-launcher' && node.isConnected,
        ) || null
      );
    },
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      handlers.get(type)?.delete(callback);
    },
  };
  doc.body = {
    append(...children) {
      for (const child of children) child.isConnected = true;
    },
  };
  return { doc, nodes, handlers };
}

test('shell revokes detached controls and cleans each feature only once', () => {
  const { doc, nodes, handlers } = syntheticDocument();
  const events = [];
  const features = ['expeditions', 'world-builder'].map((id) => ({
    id,
    title: id,
    mount() {
      events.push('mount:' + id);
      return () => events.push('dispose:' + id);
    },
  }));
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    features,
  );
  const launcher = nodes.find(
    (node) => node.id === 'planet-playground-launcher',
  );
  const close = nodes.find(
    (node) => node.attributes.get('aria-label') === 'Close Planet Playground',
  );
  const secondTab = nodes.find(
    (node) => node.dataset.mode === 'world-builder',
  );
  assert.ok(launcher && close && secondTab);
  assert.equal(launcher.listeners.get('click')?.size, 1);
  launcher.fire('click');
  assert.deepEqual(events, ['mount:expeditions']);
  secondTab.fire('click');
  assert.deepEqual(events, [
    'mount:expeditions',
    'dispose:expeditions',
    'mount:world-builder',
  ]);
  // Positive control: open, switch and close work before teardown.
  close.fire('click');
  assert.equal(events.at(-1), 'dispose:world-builder');
  launcher.fire('click');
  assert.equal(events.at(-1), 'mount:expeditions');
  dispose();
  assert.equal(events.at(-1), 'dispose:expeditions');
  const completed = [...events];
  // Negative controls: queued callbacks can retain detached native controls.
  launcher.fire('click');
  secondTab.fire('click');
  close.fire('click');
  assert.deepEqual(events, completed, 'stale controls cannot remount a mode');
  assert.equal(launcher.listeners.get('click')?.size, 0);
  assert.equal(secondTab.listeners.get('click')?.size, 0);
  assert.equal(close.listeners.get('click')?.size, 0);
  assert.equal(handlers.get('keydown')?.size, 0);
  assert.equal(launcher.isConnected, false);
  dispose();
  assert.deepEqual(events, completed, 'double disposal cannot rerun cleanup');
});

test('an unopened disposed shell cannot later join a local room', () => {
  const { doc, nodes } = syntheticDocument();
  let mounted = 0;
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    [
      {
        id: 'room',
        title: 'Local room',
        mount() {
          mounted++;
          return () => {};
        },
      },
    ],
  );
  const launcher = nodes.find(
    (node) => node.id === 'planet-playground-launcher',
  );
  dispose();
  launcher.fire('click');
  assert.equal(mounted, 0, 'disposed shell cannot join a local room');
});

test('throwing mode cleanup cannot strand tab changes, close or host teardown', (t) => {
  const { doc, nodes, handlers } = syntheticDocument();
  const events = [];
  const errors = [];
  t.mock.method(console, 'error', (...parts) => errors.push(parts));
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    [
      {
        id: 'world-builder',
        title: 'What-if',
        mount() {
          events.push('mount:what-if');
          return () => {
            events.push('dispose:what-if');
            throw new Error('synthetic feature cleanup failure');
          };
        },
      },
      {
        id: 'local-room',
        title: 'Local room',
        mount() {
          events.push('mount:room');
          return () => events.push('dispose:room');
        },
      },
    ],
  );
  const launcher = nodes.find((node) => node.id === 'planet-playground-launcher');
  const close = nodes.find(
    (node) => node.attributes.get('aria-label') === 'Close Planet Playground',
  );
  const roomTab = nodes.find((node) => node.dataset.mode === 'local-room');
  assert.ok(launcher && close && roomTab);
  launcher.fire('click');
  // Old code threw and left the active ID/disposer stuck on What-if.
  assert.doesNotThrow(() => roomTab.fire('click'));
  assert.deepEqual(events, ['mount:what-if', 'dispose:what-if', 'mount:room']);
  close.fire('click');
  launcher.fire('click');
  assert.equal(events.at(-1), 'mount:what-if', 'closing must reset selected mode');
  assert.doesNotThrow(() => close.fire('click'));
  assert.doesNotThrow(() => launcher.fire('click'));
  assert.equal(
    events.filter((event) => event === 'mount:what-if').length, 3,
    'reopening after a failed cleanup must remount, not reuse stale state',
  );
  assert.doesNotThrow(dispose);
  assert.equal(
    events.filter((event) => event === 'dispose:what-if').length, 3,
    'every distinct mount has exactly one cleanup attempt',
  );
  assert.equal(errors.length, 3);
  assert.ok(errors.every(([message, error]) =>
    message === 'Planet Playground mode cleanup failed:' &&
    error.message === 'synthetic feature cleanup failure'));
  const completed = [...events];
  launcher.fire('click');
  roomTab.fire('click');
  close.fire('click');
  dispose();
  assert.deepEqual(events, completed, 'detached controls and double dispose are inert');
  assert.equal(launcher.isConnected, false);
  assert.equal(handlers.get('keydown')?.size, 0);
});

test('transient mount failure allows retrying the same selected tab', (t) => {
  const { doc, nodes } = syntheticDocument();
  const errors = [];
  t.mock.method(console, 'error', (...parts) => errors.push(parts));
  let attempts = 0;
  let cleaned = 0;
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    [{
      id: 'world-builder',
      title: 'What-if',
      mount() {
        attempts++;
        if (attempts === 1) throw new Error('synthetic mount failure');
        return () => { cleaned++; };
      },
    }],
  );
  const launcher = nodes.find((node) => node.id === 'planet-playground-launcher');
  const tab = nodes.find((node) => node.dataset.mode === 'world-builder');
  launcher.fire('click');
  assert.equal(attempts, 1);
  tab.fire('click');
  assert.equal(attempts, 2, 'a failed mount must not lock out a retry');
  dispose();
  assert.equal(cleaned, 1);
  assert.equal(errors.length, 1);
});

test('closed Playground tabs cannot join rooms or mount hidden modes', () => {
  const { doc, nodes } = syntheticDocument();
  const events = [];
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    [
      {
        id: 'park',
        title: 'Park',
        mount() {
          events.push('park:mounted');
          return () => events.push('park:disposed');
        },
      },
      {
        id: 'local-room',
        title: 'Local room',
        mount() {
          events.push('room:joined');
          return () => events.push('room:left');
        },
      },
    ],
  );
  const launcher = nodes.find(
    (node) => node.id === 'planet-playground-launcher',
  );
  const close = nodes.find(
    (node) => node.attributes.get('aria-label') === 'Close Planet Playground',
  );
  const roomTab = nodes.find(
    (node) => node.dataset.mode === 'local-room',
  );
  const panel = nodes.find((node) => node.id === 'planet-playground');
  assert.ok(launcher && close && roomTab && panel);
  assert.equal(panel.hidden, true);

  roomTab.fire('click');
  assert.deepEqual(events, [], 'unopened hidden tab cannot join a room');
  launcher.fire('click');
  assert.deepEqual(events, ['park:mounted']);
  close.fire('click');
  assert.deepEqual(events, ['park:mounted', 'park:disposed']);

  roomTab.fire('click');
  assert.deepEqual(
    events,
    ['park:mounted', 'park:disposed'],
    'tab activation after close must not create hidden room effects',
  );
  launcher.fire('click');
  roomTab.fire('click');
  assert.deepEqual(events, [
    'park:mounted',
    'park:disposed',
    'park:mounted',
    'park:disposed',
    'room:joined',
  ], 'the same tab still works while the shell is visibly open');
  close.fire('click');
  assert.equal(events.at(-1), 'room:left');
  roomTab.fire('click');
  assert.equal(
    events.filter((event) => event === 'room:joined').length,
    1,
    'hidden tabs cannot remount a room after it is left',
  );
  dispose();
});


test('manual Playground tabs move focus without mounting room or What-if', () => {
  const { doc, nodes } = syntheticDocument();
  const events = [];
  const dispose = mountPlanetPlayground(
    { document: doc, window: { location: { search: '' } } },
    ['park', 'local-room', 'what-if'].map((id) => ({
      id, title: id,
      mount() {
        events.push('mount:' + id);
        return () => events.push('dispose:' + id);
      },
    })),
  );
  const launcher = nodes.find((node) => node.id === 'planet-playground-launcher');
  const tabs = nodes.filter((node) => node.attributes.get('role') === 'tab');
  const tablist = nodes.find((node) => node.attributes.get('role') === 'tablist');
  const panel = nodes.find((node) => node.id === 'planet-playground');
  const body = nodes.find((node) => node.attributes.get('role') === 'tabpanel');
  assert.ok(launcher && tablist && panel && body);
  assert.equal(tabs.length, 3);
  assert.ok(tabs.every((tab) => tab.attributes.get('aria-controls') === body.id));
  launcher.fire('click');
  assert.deepEqual(events, ['mount:park']);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1]);
  assert.equal(body.attributes.get('aria-labelledby'), tabs[0].id);
  tabs[0].focus();
  assert.equal(tabs[0].fire('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(doc.activeElement, tabs[1]);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, 0, -1]);
  assert.equal(tabs[1].attributes.get('aria-selected'), 'false');
  assert.deepEqual(events, ['mount:park'], 'focus alone cannot join a room');
  tabs[1].fire('keydown', { key: 'ArrowRight' });
  assert.equal(doc.activeElement, tabs[2]);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0]);
  tabs[2].fire('keydown', { key: 'ArrowRight' });
  assert.equal(doc.activeElement, tabs[0], 'right wraps');
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1]);
  tabs[0].fire('keydown', { key: 'ArrowLeft' });
  assert.equal(doc.activeElement, tabs[2], 'left wraps');
  tabs[2].fire('keydown', { key: 'Home' });
  assert.equal(doc.activeElement, tabs[0]);
  tabs[0].fire('keydown', { key: 'End' });
  assert.equal(doc.activeElement, tabs[2]);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0]);
  assert.equal(tabs[2].fire('keydown', { key: 'ArrowLeft', altKey: true }).defaultPrevented, false);
  assert.equal(doc.activeElement, tabs[2]);
  assert.equal(tabs[2].fire('keydown', { key: 'ArrowDown' }).defaultPrevented, false);
  assert.deepEqual(events, ['mount:park'], 'keys cannot mount What-if');
  tabs[0].fire('click'); // Already-active tab still reclaims the tab stop.
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1]);
  assert.deepEqual(events, ['mount:park'], 'repeat selection cannot remount');
  tabs[1].fire('click'); // Native Enter/Space on a button dispatches click.
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, 0, -1]);
  assert.deepEqual(events, ['mount:park', 'dispose:park', 'mount:local-room']);
  assert.equal(body.attributes.get('aria-labelledby'), tabs[1].id);
  launcher.fire('click');
  assert.equal(panel.hidden, true);
  const before = [...events];
  assert.equal(tabs[1].fire('keydown', { key: 'ArrowRight' }).defaultPrevented, false);
  tabs[2].fire('click');
  assert.deepEqual(events, before, 'closed controls inert');
  dispose();
  assert.equal(tabs[1].listeners.get('keydown')?.size, 0);
  tabs[2].fire('click');
  assert.deepEqual(events, before, 'disposed controls inert');
});
