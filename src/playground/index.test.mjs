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
        fire(type) {
          for (const callback of [...(listeners.get(type) || [])]) {
            callback({
              defaultPrevented: false,
              key: type,
              preventDefault() {},
            });
          }
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
