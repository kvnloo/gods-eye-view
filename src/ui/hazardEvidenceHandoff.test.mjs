import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HAZARD_EVIDENCE_STORAGE_KEY,
  createHazardEvidenceHandoff,
  rankHazardEvidenceActions,
  readHazardEvidencePreference,
  recordHazardEvidenceChoice,
} from './hazardEvidenceHandoff.js';

function memoryStorage(initial = null) {
  const data = new Map();
  if (initial != null)
    data.set(HAZARD_EVIDENCE_STORAGE_KEY, JSON.stringify(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.title = '';
    this.parentNode = null;
    this.open = false;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this,
    );
    this.parentNode = null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  click() {
    for (const listener of this.listeners.get('click') || [])
      listener({ target: this });
  }
}

function fakeDocument() {
  const body = new FakeNode('body');
  return {
    body,
    createElement: (tag) => new FakeNode(tag),
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, detail) {
      for (const listener of listeners.get(type) || []) listener({ detail });
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function findAction(root, action) {
  if (root?.dataset?.action === action) return root;
  for (const child of root?.children || []) {
    const found = findAction(child, action);
    if (found) return found;
  }
  return null;
}

test(
  'preference ranking is stable, bounded and records only explicit valid actions',
  () => {
    const storage = memoryStorage();
    assert.deepEqual(readHazardEvidencePreference(storage), {
      imagery: 0,
      cameras: 0,
    });
    assert.deepEqual(rankHazardEvidenceActions(storage), ['imagery', 'cameras']);
    assert.equal(recordHazardEvidenceChoice('nope', storage), false);
    assert.equal(recordHazardEvidenceChoice('cameras', storage), true);
    assert.equal(recordHazardEvidenceChoice('cameras', storage), true);
    assert.equal(recordHazardEvidenceChoice('imagery', storage), true);
    assert.deepEqual(readHazardEvidencePreference(storage), {
      imagery: 1,
      cameras: 2,
    });
    assert.deepEqual(rankHazardEvidenceActions(storage), ['cameras', 'imagery']);
  },
);

test(
  'blocked or malformed storage degrades to the stable default instead of breaking hazard selection',
  () => {
    const blocked = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    assert.deepEqual(readHazardEvidencePreference(blocked), {
      imagery: 0,
      cameras: 0,
    });
    assert.deepEqual(rankHazardEvidenceActions(blocked), ['imagery', 'cameras']);
    assert.equal(recordHazardEvidenceChoice('imagery', blocked), false);

    const malformed = memoryStorage();
    malformed.data.set(HAZARD_EVIDENCE_STORAGE_KEY, '{broken');
    assert.deepEqual(readHazardEvidencePreference(malformed), {
      imagery: 0,
      cameras: 0,
    });
  },
);

test(
  'FIRMS selection hands its own coordinates to Recent Imagery and remembers only the successful choice',
  async () => {
    const documentRef = fakeDocument();
    const windowRef = fakeWindow();
    const storage = memoryStorage();
    const calls = [];
    const handoff = createHazardEvidenceHandoff({
      documentRef,
      windowRef,
      storage,
      dataManager: {
        async setEnabled(id, enabled, options) {
          calls.push(['enable', id, enabled, options]);
          return true;
        },
      },
      styleManager: {
        setPanelCollapsed(id, collapsed, options) {
          calls.push(['panel', id, collapsed, options]);
        },
      },
      recentImagery: {
        boxFromPinAt(lon, lat) {
          calls.push(['box', lon, lat]);
          return true;
        },
      },
    });

    assert.equal(
      handoff.openForRecord({
        layerId: 'flights',
        latitude: 1,
        longitude: 2,
      }),
      false,
    );
    assert.equal(documentRef.body.children.length, 0);

    const record = {
      layerId: 'local-firms',
      latitude: 34.25,
      longitude: -118.5,
    };
    assert.equal(handoff.openForRecord(record), true);
    const dialog = documentRef.body.children[0];
    const imagery = findAction(dialog, 'imagery');
    const cameras = findAction(dialog, 'cameras');
    assert.ok(imagery);
    assert.ok(cameras);
    assert.equal(cameras.disabled, false);

    imagery.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, [
      ['enable', 'recent-imagery', true, { origin: 'user' }],
      ['box', -118.5, 34.25],
      ['panel', 'recent-imagery-panel', false, { explicit: true }],
    ]);
    assert.deepEqual(readHazardEvidencePreference(storage), {
      imagery: 1,
      cameras: 0,
    });
    assert.equal(documentRef.body.children.length, 0);

    assert.equal(handoff.openForRecord(record), true);
    const nextDialog = documentRef.body.children[0];
    assert.equal(
      findAction(nextDialog, 'imagery').textContent,
      'RECENT IMAGERY · USUAL',
    );

    handoff.destroy();
    assert.equal(windowRef.listenerCount('gev:entity-selected'), 0);
  },
);

test(
  'Nearby Cameras uses the hazard coordinate, not viewer position, and learns that explicit choice',
  async () => {
    const documentRef = fakeDocument();
    const windowRef = fakeWindow();
    const storage = memoryStorage();
    const calls = [];
    const cctv = {
      focusNearestToPoint(lat, lon, options) {
        calls.push(['nearest-camera', lat, lon, options]);
        return 'cam-near-hazard';
      },
    };
    const dataManager = {
      layers: new Map([['cctv', { module: cctv }]]),
      async setEnabled(id, enabled, options) {
        calls.push(['enable', id, enabled, options]);
        return true;
      },
    };
    const handoff = createHazardEvidenceHandoff({
      documentRef,
      windowRef,
      storage,
      dataManager,
      styleManager: {
        setPanelCollapsed(id, collapsed, options) {
          calls.push(['panel', id, collapsed, options]);
        },
      },
      recentImagery: {},
    });

    const record = {
      layerId: 'local-firms',
      latitude: 46.123,
      longitude: -121.456,
    };
    assert.equal(handoff.openForRecord(record), true);
    findAction(documentRef.body.children[0], 'cameras').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, [
      ['enable', 'cctv', true, { origin: 'user' }],
      ['nearest-camera', 46.123, -121.456, { focus: true }],
      ['panel', 'cctv-panel', false, { explicit: true }],
    ]);
    assert.deepEqual(readHazardEvidencePreference(storage), {
      imagery: 0,
      cameras: 1,
    });

    handoff.destroy();
  },
);

test(
  'the production selection event opens the chooser only for supported hazard records',
  () => {
    const documentRef = fakeDocument();
    const windowRef = fakeWindow();
    const handoff = createHazardEvidenceHandoff({
      documentRef,
      windowRef,
      storage: memoryStorage(),
      dataManager: {},
      styleManager: {},
      recentImagery: {},
    });

    windowRef.dispatch('gev:entity-selected', {
      layerId: 'local-firms',
      latitude: 10,
      longitude: 20,
    });
    assert.equal(documentRef.body.children.length, 1);

    handoff.destroy();
  },
);
