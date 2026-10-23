import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTernBridge, projectGevContext } from './browserBridge.js';
import WebSocket from 'ws';
import { createLocalRelay } from '../../tools/tern/relay.mjs';

function fixture() {
  const record = {
    id: 'aircraft:a',
    label: 'Aircraft A',
    layerId: 'flights',
    source: 'OpenSky',
    updatedAt: 1000,
    latitude: 40.12,
    longitude: -88.25,
    entity: { show: true },
  };
  const managerListeners = new Set();
  const cameraListeners = new Set();
  const dataManager = {
    enabled: true,
    getAll: () => [
      {
        id: 'flights',
        name: 'Flights',
        enabled: dataManager.enabled,
        stats: { count: 3, source: 'OpenSky', lastUpdate: 1000 },
      },
    ],
    isEnabled: () => dataManager.enabled,
    subscribeActivity: (listener) => {
      managerListeners.add(listener);
      return () => managerListeners.delete(listener);
    },
  };
  const camera = {
    positionCartographic: {
      latitude: 0.7,
      longitude: -1.5,
      height: 1200,
    },
    heading: 0,
    pitch: -0.7,
    moveEnd: {
      addEventListener: (fn) => {
        cameraListeners.add(fn);
        return () => cameraListeners.delete(fn);
      },
    },
  };
  const components = { scene: { viewer: { camera } }, data: { dataManager } };
  return { record, components, dataManager, managerListeners, cameraListeners };
}

test('snapshot reuses owning layer provenance and drops disabled or replaced selection', () => {
  const previous = globalThis.window;
  const { record, components, dataManager } = fixture();
  globalThis.window = {
    __gevContextStore: {
      entities: new Map([[record.id, record]]),
      selectedEntityId: record.id,
      selectedAt: 1000,
    },
  };
  try {
    const first = projectGevContext(components, 1500);
    assert.equal(first.selected.id, 'aircraft:a');
    assert.equal(first.layers[0].source, 'OpenSky');
    assert.equal(first.layers[0].feedState, 'nominal');
    assert.equal(first.layers[0].count, 3);
    assert.equal(first.camera.heightM, 1200);
    dataManager.enabled = false;
    const next = projectGevContext(components, 1600);
    assert.equal(next.selected, null);
    assert.equal(next.layers[0].feedState, 'off');
    assert.equal(window.__gevContextStore.selectedEntityId, record.id);
    assert.equal(window.__gevContextStore.selectedAt, 1000);
    dataManager.enabled = true;
    window.__gevContextStore.selectedEntityId = 'missing';
    assert.equal(projectGevContext(components).selected, null);
    assert.equal(window.__gevContextStore.selectedEntityId, 'missing');
  } finally {
    globalThis.window = previous;
  }
});

test('relay projection coalesces bursts and unsubscribes on disposal', async () => {
  const previous = globalThis.window;
  const page = new EventTarget();
  page.location = { hostname: 'localhost' };
  const { record, components, managerListeners, cameraListeners } = fixture();
  page.__gevContextStore = {
    entities: new Map([[record.id, record]]),
    selectedEntityId: record.id,
    selectedAt: 1000,
  };
  globalThis.window = page;
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
    static CLOSING = 2;
    close() {
      this.readyState = 3;
    }
  }
  const appListeners = new Set();
  const application = {
    subscribe(listener) {
      appListeners.add(listener);
      listener({ status: 'ready' });
      return () => appListeners.delete(listener);
    },
  };
  try {
    const dispose = connectTernBridge({
      application,
      components,
      port: 4391,
      token: 'a'.repeat(43),
      WebSocketCtor: FakeSocket,
    });
    assert.equal(sockets.length, 1);
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    assert.equal(socket.sent.length, 1);
    for (const fn of managerListeners) fn({ type: 'data-updated' });
    for (const fn of cameraListeners) fn();
    page.__gevContextStore.selectedEntityId = null;
    page.dispatchEvent(new Event('gev:entity-selection-cleared'));
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(socket.sent.length, 2);
    assert.equal(socket.sent.at(-1).selected, null);
    dispose();
    assert.equal(managerListeners.size, 0);
    assert.equal(cameraListeners.size, 0);
    assert.equal(appListeners.size, 0);
    assert.equal(socket.readyState, 3);
  } finally {
    globalThis.window = previous;
  }
});

test('invalid bridge config refuses non-loopback pages and weak tokens', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { hostname: 'public.example' } };
  try {
    assert.throws(
      () =>
        connectTernBridge({
          application: {},
          components: {},
          port: 4391,
          token: 'a'.repeat(43),
          WebSocketCtor: class {},
        }),
      /Invalid local/,
    );
  } finally {
    globalThis.window = previous;
  }
});


test('unauthorized write commands are ignored and browser reconnects without new owners', async () => {
  const previous = globalThis.window;
  const page = new EventTarget();
  page.location = { hostname: '127.0.0.1' };
  page.__gevContextStore = {
    entities: new Map(),
    selectedEntityId: null,
    selectedAt: null,
  };
  globalThis.window = page;
  const { components, managerListeners, cameraListeners, dataManager } = fixture();
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    sent = [];
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }
  const application = {
    subscribe(listener) {
      listener({ status: 'ready' });
      return () => {};
    },
  };
  try {
    const dispose = connectTernBridge({
      application,
      components,
      port: 4210,
      token: 'a'.repeat(43),
      WebSocketCtor: FakeSocket,
    });
    const first = sockets[0];
    first.readyState = 1;
    first.onopen();
    assert.equal(first.sent.length, 1);
    first.onmessage({
      data: '{"type":"setEnabled","id":"flights","enabled":false}',
    });
    assert.equal(dataManager.enabled, true);
    assert.equal(first.sent.length, 1);
    first.readyState = 3;
    first.onclose();
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(sockets.length, 2);
    const next = sockets[1];
    next.readyState = 1;
    next.onopen();
    assert.equal(next.sent.length, 1);
    dispose();
    assert.equal(next.readyState, 3);
    assert.equal(managerListeners.size, 0);
    assert.equal(cameraListeners.size, 0);
  } finally {
    globalThis.window = previous;
  }
});


// Real WebSocket clients exercise browser reconnect handlers and relay close codes.
// Unlike raw sockets, these clients would ping-pong forever on terminate().
test('two connectTernBridge clients transfer ownership once and permanently stop on relay close', async () => {
  const previous = globalThis.window;
  const page = new EventTarget();
  page.location = { hostname: 'localhost' };
  const { record, components, managerListeners, cameraListeners } = fixture();
  page.__gevContextStore = {
    entities: new Map([[record.id, record]]),
    selectedEntityId: record.id,
    selectedAt: 1000,
  };
  globalThis.window = page;
  const relaySnapshots = [];
  const closes = [];
  let attempts = 0;
  const relay = await createLocalRelay({ onSnapshot: (s) => relaySnapshots.push(s) });
  const token = new URL(relay.browserUrl).searchParams.get('gevTernToken');
  class BrowserSocket extends WebSocket {
    static OPEN = WebSocket.OPEN;
    static CLOSING = WebSocket.CLOSING;
    constructor(url) {
      super(url, { headers: { Origin: 'http://localhost:4173' } });
      attempts += 1;
      this.on('close', (code) => closes.push(code));
    }
  }
  const application = { subscribe: () => () => {} };
  let disposeFirst;
  let disposeSecond;
  async function until(predicate) {
    for (let i = 0; i < 60; i += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('socket state did not settle');
  }
  try {
    disposeFirst = connectTernBridge({
      application, components, port: relay.port, token, WebSocketCtor: BrowserSocket,
    });
    await until(() => relaySnapshots.length === 1);
    disposeSecond = connectTernBridge({
      application, components, port: relay.port, token, WebSocketCtor: BrowserSocket,
    });
    await until(() => closes.includes(4001) && relaySnapshots.length === 2);
    assert.equal(managerListeners.size, 1, 'superseded tab unsubscribed');
    assert.equal(cameraListeners.size, 1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(attempts, 2, 'superseded browser never reconnects');
    await relay.close();
    await until(() => closes.includes(4002));
    assert.equal(managerListeners.size, 0, 'stop also unsubscribes current browser');
    assert.equal(cameraListeners.size, 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(attempts, 2, 'stop cannot reconnect to a reused local port');
  } finally {
    disposeFirst?.();
    disposeSecond?.();
    await relay.close();
    globalThis.window = previous;
  }
});

test('hidden or disabled selection never mutates the original context store', () => {
  const previous = globalThis.window;
  const page = new EventTarget();
  const { record, components, dataManager } = fixture();
  const selectedEvents = [];
  page.addEventListener('gev:entity-selection-cleared', (e) => selectedEvents.push(e));
  page.__gevContextStore = {
    entities: new Map([[record.id, record]]),
    selectedEntityId: record.id,
    selectedAt: 42,
  };
  globalThis.window = page;
  try {
    record.properties = { status: 'stale (missed polls)' };
    assert.equal(projectGevContext(components).selected.status, 'stale (missed polls)');
    record.entity.show = false;
    assert.equal(projectGevContext(components).selected, null);
    record.entity.show = true;
    dataManager.enabled = false;
    assert.equal(projectGevContext(components).selected, null);
    assert.equal(page.__gevContextStore.selectedEntityId, record.id);
    assert.equal(page.__gevContextStore.selectedAt, 42);
    assert.equal(selectedEvents.length, 0);
  } finally {
    globalThis.window = previous;
  }
});

test('transient browser retries stop after a bounded number of failures', () => {
  const previousPage = globalThis.window;
  const previousTimer = globalThis.setTimeout;
  const previousClear = globalThis.clearTimeout;
  const page = new EventTarget();
  page.location = { hostname: 'localhost' };
  page.__gevContextStore = { entities: new Map(), selectedEntityId: null, selectedAt: null };
  globalThis.window = page;
  const { components, managerListeners, cameraListeners } = fixture();
  const queued = new Map();
  let timerId = 0;
  globalThis.setTimeout = (fn) => { queued.set(++timerId, fn); return timerId; };
  globalThis.clearTimeout = (id) => queued.delete(id);
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; }
  }
  const application = { subscribe: () => () => {} };
  let dispose;
  try {
    dispose = connectTernBridge({
      application, components, port: 4913,
      token: 'b'.repeat(43), WebSocketCtor: FakeSocket,
    });
    for (let i = 0; i < 6; i += 1) {
      const socket = sockets.at(-1);
      socket.readyState = 3;
      socket.onclose({ code: 1006 });
      if (i < 5) {
        assert.equal(queued.size, 1);
        const [id, next] = queued.entries().next().value;
        queued.delete(id);
        next();
      }
    }
    assert.equal(sockets.length, 6);
    assert.equal(queued.size, 0);
    assert.equal(managerListeners.size, 0);
    assert.equal(cameraListeners.size, 0);
  } finally {
    dispose?.();
    globalThis.window = previousPage;
    globalThis.setTimeout = previousTimer;
    globalThis.clearTimeout = previousClear;
  }
});

test('80 maximal Unicode layer rows publish bounded snapshots across replacement and clearing', async () => {
  const previous = globalThis.window;
  const page = new EventTarget();
  page.location = { hostname: 'localhost' };
  const { record, components, dataManager, managerListeners, cameraListeners } = fixture();
  const maximal = '🚀'.repeat(80); // 160 UTF-16 units, 320 UTF-8 bytes.
  const layers = Array.from({ length: 80 }, (_, i) => ({
    id: 'layer-' + String(i).padStart(2, '0') + 'x'.repeat(152),
    name: maximal,
    enabled: true,
    stats: {
      count: i,
      source: i === 0 ? 'a'.repeat(159) + '🚀' : maximal,
      lastUpdate: 1000,
      error: maximal,
    },
  }));
  dataManager.getAll = () => layers;
  record.label = maximal;
  record.source = maximal;
  record.properties = { status: maximal };
  const replacement = {
    ...record,
    id: 'aircraft:replacement',
    label: 'Replacement 🚀',
  };
  page.__gevContextStore = {
    entities: new Map([[record.id, record], [replacement.id, replacement]]),
    selectedEntityId: record.id,
    selectedAt: 1000,
  };
  globalThis.window = page;

  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const application = { subscribe: () => () => {} };
  let dispose;
  function verifyPayload(raw) {
    assert.ok(new TextEncoder().encode(raw).length <= 60_000, 'within relay budget');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.type, 'snapshot');
    assert.ok(parsed.omittedLayers > 0, 'does not claim a complete layer roster');
    assert.equal(parsed.layers.length + parsed.omittedLayers, layers.length);
    for (const layer of parsed.layers) {
      for (const key of ['id', 'name', 'source', 'error'])
        if (layer[key] !== null)
          assert.equal(layer[key], layer[key].toWellFormed(), key);
    }
    if (parsed.selected)
      for (const key of ['id', 'name', 'source', 'status'])
        if (parsed.selected[key] !== null)
          assert.equal(parsed.selected[key], parsed.selected[key].toWellFormed(), key);
    return parsed;
  }

  try {
    dispose = connectTernBridge({
      application, components, port: 4222,
      token: 'a'.repeat(43), WebSocketCtor: FakeSocket,
    });
    const socket = sockets[0];
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    assert.equal(socket.sent.length, 1);
    const first = verifyPayload(socket.sent[0]);
    assert.equal(first.selected.id, record.id);
    assert.equal(first.layers[0].source, 'a'.repeat(159));

    page.__gevContextStore.selectedEntityId = replacement.id;
    page.dispatchEvent(new Event('gev:entity-selected'));
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(socket.sent.length, 2, 'replacement must not be dropped');
    const second = verifyPayload(socket.sent[1]);
    assert.equal(second.selected.id, replacement.id);
    assert.equal(second.change, 'selection');

    page.__gevContextStore.selectedEntityId = null;
    page.dispatchEvent(new Event('gev:entity-selection-cleared'));
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(socket.sent.length, 3, 'clear must not be dropped');
    const third = verifyPayload(socket.sent[2]);
    assert.equal(third.selected, null);
    assert.equal(third.change, 'selection');
    assert.equal(page.__gevContextStore.selectedEntityId, null);
  } finally {
    dispose?.();
    assert.equal(managerListeners.size, 0);
    assert.equal(cameraListeners.size, 0);
    globalThis.window = previous;
  }
});
