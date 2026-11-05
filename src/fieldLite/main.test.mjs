import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import { createSyntheticReliefDemoReplay } from './demoFixture.js';
import { initReliefFieldLite } from './main.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(browser = {}) {
  const ownerDocument = {
    createElement(tagName) {
      return {
        tagName,
        className: '',
        children: [],
        textContent: '',
        attributes: {},
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
  };
  const root = {
    ownerDocument,
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const input = new EventTarget();
  input.files = [];
  input.value = '';
  const demo = new EventTarget();
  const feedback = { textContent: '' };
  const offline = { textContent: '' };
  const nodes = {
    'field-results': root,
    'field-local-file': input,
    'field-demo': demo,
    'field-feedback': feedback,
    'field-offline-ready': offline,
  };
  const app = initReliefFieldLite({ getElementById: (id) => nodes[id] }, browser);
  const change = (file) => {
    input.files = [file];
    input.dispatchEvent(new Event('change'));
  };
  const restore = () => demo.dispatchEvent(new Event('click'));
  return { root, feedback, offline, app, change, restore };
}

const validReceipt = () => JSON.stringify(createSyntheticReliefDemoReplay());
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('restoring the demo invalidates an unfinished local file read', async () => {
  const f = fixture();
  try {
    const pending = deferred();
    f.change({ size: 20, text: () => pending.promise });
    f.restore();
    pending.resolve(validReceipt());
    await settle();
    assert.equal(f.feedback.textContent, 'Restored fictional example.');
    assert.equal(f.root.children.length, 4);
  } finally {
    f.app.destroy();
  }
});

test('a superseded valid receipt cannot replace the newest rejected selection', async () => {
  const f = fixture();
  try {
    const old = deferred();
    const latest = deferred();
    f.change({ size: 20, text: () => old.promise });
    f.change({ size: 20, text: () => latest.promise });
    latest.resolve('{invalid');
    await settle();
    old.resolve(validReceipt());
    await settle();
    assert.match(f.feedback.textContent, /File rejected: invalid JSON/);
    assert.equal(f.root.children[0].attributes.role, 'alert');
  } finally {
    f.app.destroy();
  }
});

test('destroy prevents an in-flight read from changing the detached view', async () => {
  const f = fixture();
  const pending = deferred();
  f.change({ size: 20, text: () => pending.promise });
  const before = f.feedback.textContent;
  f.app.destroy();
  pending.resolve(validReceipt());
  await settle();
  assert.equal(f.feedback.textContent, before);
  assert.equal(f.root.children.length, 4);
});

test('invalid size supersedes an unfinished valid import', async () => {
  const f = fixture();
  try {
    const pending = deferred();
    f.change({ size: 20, text: () => pending.promise });
    f.change({ size: 65537, text: () => Promise.resolve(validReceipt()) });
    pending.resolve(validReceipt());
    await settle();
    assert.match(f.feedback.textContent, /at most 64 KiB/);
    assert.equal(f.root.children[0].attributes.role, 'alert');
  } finally {
    f.app.destroy();
  }
});

test('offline shell priming is explicit and never fetches or stores a receipt', async () => {
  const registrations = [];
  const browser = {
    MessageChannel,
    setTimeout,
    clearTimeout,
    performance: { getEntriesByType(type) {
      assert.equal(type, 'resource');
      return [{ name: 'http://127.0.0.1:4173/assets/field-lite.js' }];
    } },
    navigator: { serviceWorker: {
      register: async (path, options) => {
        registrations.push({ path, options });
      },
      ready: Promise.resolve({ active: {
        postMessage(message, [port]) {
          assert.equal(message.type, 'gev-field-lite-prime');
          assert.deepEqual(message.urls, ['http://127.0.0.1:4173/assets/field-lite.js']);
          port.postMessage({ ok: true });
        },
      } }),
    } },
    fetch() { throw new Error('Field Lite may not fetch a live provider'); },
  };
  const f = fixture(browser);
  try {
    assert.equal(await f.app.offlineReady, true);
    assert.deepEqual(registrations, [
      { path: '/field-lite/offline-sw.js', options: { scope: '/field-lite/' } },
    ]);
    assert.match(f.offline.textContent, /Offline screen cached/);
    f.change({ size: 20, text: () => Promise.resolve(validReceipt()) });
    await settle();
    const before = JSON.stringify(f.root.children);
    // A connectivity change is never a request to revalidate an old receipt.
    browser.navigator.onLine = false;
    browser.navigator.onLine = true;
    assert.equal(JSON.stringify(f.root.children), before);
    assert.match(f.feedback.textContent, /Local synthetic replay loaded/);
  } finally {
    f.app.destroy();
  }
});

test('unavailable service worker does not block keyless local replay', async () => {
  const f = fixture();
  try {
    assert.equal(await f.app.offlineReady, false);
    assert.match(f.offline.textContent, /Offline reload unavailable/);
    f.change({ size: 20, text: () => Promise.resolve(validReceipt()) });
    await settle();
    assert.equal(f.root.children.length, 4);
    assert.match(f.feedback.textContent, /Local synthetic replay loaded/);
  } finally {
    f.app.destroy();
  }
});
