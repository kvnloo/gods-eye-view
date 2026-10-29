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
