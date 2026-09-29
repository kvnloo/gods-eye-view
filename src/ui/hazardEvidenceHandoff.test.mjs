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

test('preference ranking is stable, bounded and records only explicit valid actions', () => {
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
});

test('blocked or malformed storage degrades to the stable default instead of breaking hazard selection', () => {
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
});

test('invalid WGS84 hazard coordinates fail closed before opening the chooser', () => {
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

  for (const [latitude, longitude] of [
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [NaN, 0],
  ]) {
    assert.equal(
      handoff.openForRecord({
        layerId: 'local-firms',
        latitude,
        longitude,
      }),
      false,
    );
  }
  assert.equal(documentRef.body.children.length, 0);
  handoff.destroy();
});

test('FIRMS selection hands its own coordinates to Recent Imagery and remembers only the successful choice', async () => {
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
  assert.equal(windowRef.listenerCount('gev:entity-selection-cleared'), 0);
});

test('Nearby Cameras uses the hazard coordinate, not viewer position, and learns that explicit choice', async () => {
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
});

test('the production selection event opens the chooser for each supported hazard source only', () => {
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
    layerId: 'flights',
    latitude: 10,
    longitude: 20,
  });
  assert.equal(documentRef.body.children.length, 0);

  for (const layerId of [
    'local-firms',
    'fire-perimeters',
    'earthquakes',
    'weather-cyclones',
  ]) {
    windowRef.dispatch('gev:entity-selected', {
      layerId,
      latitude: 10,
      longitude: 20,
    });
    assert.equal(documentRef.body.children.length, 1);
  }

  handoff.destroy();
});

test('explicit weather-cyclones selection opens the chooser, keeps cyclone coordinates, and never auto-runs', async () => {
  const documentRef = fakeDocument();
  const windowRef = fakeWindow();
  const storage = memoryStorage();
  const calls = [];
  const cctv = {
    focusNearestToPoint(lat, lon, options) {
      calls.push(['nearest-camera', lat, lon, options]);
      return 'cam-near-cyclone';
    },
  };
  const handoff = createHazardEvidenceHandoff({
    documentRef,
    windowRef,
    storage,
    dataManager: {
      layers: new Map([['cctv', { module: cctv }]]),
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

  const record = {
    layerId: 'weather-cyclones',
    latitude: 18.4,
    longitude: -66.1,
    source: 'nhc',
  };

  windowRef.dispatch('gev:entity-selected', record);
  assert.equal(documentRef.body.children.length, 1);
  // Opening the chooser must not enable imagery/cameras by itself.
  assert.deepEqual(calls, []);
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 0,
    cameras: 0,
  });

  findAction(documentRef.body.children[0], 'imagery').click();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [
    ['enable', 'recent-imagery', true, { origin: 'user' }],
    ['box', -66.1, 18.4],
    ['panel', 'recent-imagery-panel', false, { explicit: true }],
  ]);
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 1,
    cameras: 0,
  });

  calls.length = 0;
  assert.equal(handoff.openForRecord(record), true);
  findAction(documentRef.body.children[0], 'cameras').click();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [
    ['enable', 'cctv', true, { origin: 'user' }],
    ['nearest-camera', 18.4, -66.1, { focus: true }],
    ['panel', 'cctv-panel', false, { explicit: true }],
  ]);

  handoff.destroy();
});

test('owning-layer selection clear dismisses the open chooser without auto-running evidence', () => {
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

  const record = {
    layerId: 'weather-cyclones',
    latitude: 18.4,
    longitude: -66.1,
  };
  assert.equal(handoff.openForRecord(record), true);
  assert.equal(documentRef.body.children.length, 1);

  // A clear for a different layer must leave this chooser alone.
  windowRef.dispatch('gev:entity-selection-cleared', {
    layerId: 'earthquakes',
    reason: 'deliberate',
  });
  assert.equal(documentRef.body.children.length, 1);

  // Owning-layer deliberate clear dismisses without enabling evidence.
  windowRef.dispatch('gev:entity-selection-cleared', {
    layerId: 'weather-cyclones',
    reason: 'deliberate',
  });
  assert.equal(documentRef.body.children.length, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 0,
    cameras: 0,
  });

  // Eviction clear also dismisses after a fresh open.
  assert.equal(handoff.openForRecord(record), true);
  assert.equal(documentRef.body.children.length, 1);
  windowRef.dispatch('gev:entity-selection-cleared', {
    layerId: 'weather-cyclones',
    reason: 'evicted',
  });
  assert.equal(documentRef.body.children.length, 0);
  assert.deepEqual(calls, []);

  handoff.destroy();
  assert.equal(windowRef.listenerCount('gev:entity-selected'), 0);
  assert.equal(windowRef.listenerCount('gev:entity-selection-cleared'), 0);
});

test('stale evidence choice after dismiss or rebind neither ranks nor closes a successor chooser', async () => {
  const documentRef = fakeDocument();
  const windowRef = fakeWindow();
  const storage = memoryStorage();
  let resolveEnable;
  const enableGate = new Promise((resolve) => {
    resolveEnable = resolve;
  });
  const calls = [];
  const handoff = createHazardEvidenceHandoff({
    documentRef,
    windowRef,
    storage,
    dataManager: {
      async setEnabled(id, enabled, options) {
        calls.push(['enable', id, enabled, options]);
        await enableGate;
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

  const cyclone = {
    layerId: 'weather-cyclones',
    latitude: 18.4,
    longitude: -66.1,
  };
  const firms = {
    layerId: 'local-firms',
    latitude: 34.25,
    longitude: -118.5,
  };

  assert.equal(handoff.openForRecord(cyclone), true);
  findAction(documentRef.body.children[0], 'imagery').click();
  // Chooser dismissed (owning-layer clear) while imagery enable is still pending.
  windowRef.dispatch('gev:entity-selection-cleared', {
    layerId: 'weather-cyclones',
    reason: 'deliberate',
  });
  assert.equal(documentRef.body.children.length, 0);

  // A newer supported selection opens a successor chooser before the stale await settles.
  assert.equal(handoff.openForRecord(firms), true);
  assert.equal(documentRef.body.children.length, 1);
  const successor = documentRef.body.children[0];

  resolveEnable(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Stale completion must not rank and must not close the successor.
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 0,
    cameras: 0,
  });
  assert.equal(documentRef.body.children.length, 1);
  assert.equal(documentRef.body.children[0], successor);
  assert.ok(findAction(successor, 'imagery'));

  handoff.destroy();
});

test('concurrent evidence clicks while a choice is in flight neither double-enable nor double-rank', async () => {
  const documentRef = fakeDocument();
  const windowRef = fakeWindow();
  const storage = memoryStorage();
  let resolveEnable;
  const enableGate = new Promise((resolve) => {
    resolveEnable = resolve;
  });
  const calls = [];
  const cctv = {
    focusNearestToPoint(lat, lon, options) {
      calls.push(['nearest-camera', lat, lon, options]);
      return 'cam-near-cyclone';
    },
  };
  const handoff = createHazardEvidenceHandoff({
    documentRef,
    windowRef,
    storage,
    dataManager: {
      layers: new Map([['cctv', { module: cctv }]]),
      async setEnabled(id, enabled, options) {
        calls.push(['enable', id, enabled, options]);
        await enableGate;
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

  const record = {
    layerId: 'weather-cyclones',
    latitude: 18.4,
    longitude: -66.1,
  };
  assert.equal(handoff.openForRecord(record), true);
  const dialog = documentRef.body.children[0];
  const imagery = findAction(dialog, 'imagery');
  const cameras = findAction(dialog, 'cameras');
  const dismiss = findAction(dialog, 'dismiss');

  imagery.click();
  // Second evidence click while the first enable is still gated must be ignored.
  cameras.click();
  const busyDuringFlight =
    imagery.disabled === true && cameras.disabled === true;
  // NOT NOW stays usable so the operator can still dismiss mid-flight.
  assert.equal(dismiss.disabled, false);

  resolveEnable(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Only the first choice runs; preference ranks imagery once, never cameras.
  assert.deepEqual(calls, [
    ['enable', 'recent-imagery', true, { origin: 'user' }],
    ['box', -66.1, 18.4],
    ['panel', 'recent-imagery-panel', false, { explicit: true }],
  ]);
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 1,
    cameras: 0,
  });
  assert.equal(documentRef.body.children.length, 0);
  assert.equal(busyDuringFlight, true);

  handoff.destroy();
});

test('thrown evidence enable recovers busy actions so a retry can proceed', async () => {
  const documentRef = fakeDocument();
  const windowRef = fakeWindow();
  const storage = memoryStorage();
  const toasts = [];
  let resolveEnable;
  let failNextEnable = true;
  const enableGate = new Promise((resolve) => {
    resolveEnable = resolve;
  });
  const calls = [];
  const handoff = createHazardEvidenceHandoff({
    documentRef,
    windowRef,
    storage,
    showToast: (message) => toasts.push(message),
    dataManager: {
      async setEnabled(id, enabled, options) {
        calls.push(['enable', id, enabled, options]);
        if (failNextEnable) {
          await enableGate;
          throw new Error('enable exploded');
        }
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

  const record = {
    layerId: 'weather-cyclones',
    latitude: 18.4,
    longitude: -66.1,
  };
  assert.equal(handoff.openForRecord(record), true);
  const dialog = documentRef.body.children[0];
  const imagery = findAction(dialog, 'imagery');
  const cameras = findAction(dialog, 'cameras');
  const dismiss = findAction(dialog, 'dismiss');

  imagery.click();
  assert.equal(imagery.disabled, true);
  assert.equal(cameras.disabled, true);
  assert.equal(dismiss.disabled, false);

  resolveEnable(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Same open chooser must recover: evidence actions usable, no ranking, toast once.
  assert.equal(documentRef.body.children.length, 1);
  assert.equal(documentRef.body.children[0], dialog);
  assert.equal(imagery.disabled, false);
  assert.equal(cameras.disabled, false);
  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 0,
    cameras: 0,
  });
  assert.deepEqual(toasts, ['Evidence view could not be opened']);
  assert.deepEqual(calls, [
    ['enable', 'recent-imagery', true, { origin: 'user' }],
  ]);

  // Retry after recovery must complete a successful choice (latch cleared).
  failNextEnable = false;
  imagery.click();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(readHazardEvidencePreference(storage), {
    imagery: 1,
    cameras: 0,
  });
  assert.equal(documentRef.body.children.length, 0);
  assert.deepEqual(calls, [
    ['enable', 'recent-imagery', true, { origin: 'user' }],
    ['enable', 'recent-imagery', true, { origin: 'user' }],
    ['box', -66.1, 18.4],
    ['panel', 'recent-imagery-panel', false, { explicit: true }],
  ]);

  handoff.destroy();
});
