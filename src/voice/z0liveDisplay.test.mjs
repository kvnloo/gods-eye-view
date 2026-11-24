import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Z0LIVE_TOKEN_KEY,
  actionSucceeded,
  compactWorldContext,
  createZ0liveDisplayBridge,
  parseSseFrames,
  readZ0liveDisplayConfig,
  summarizeResult,
  z0liveDisplayTools,
} from './z0liveDisplay.js';
import { GEV_ACTION_SCHEMAS } from './actionSchemas.js';

const BROKER = 'http://broker.test:8791';
const TOKEN = 'unit-device-token';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

/** A fake broker: records requests and feeds SSE frames to the inbox stream. */
function fakeBroker({ registerStatus = 200 } = {}) {
  const requests = [];
  const encoder = new TextEncoder();
  let push;
  let close;
  const inboxOpened = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({
      path,
      method: init.method || 'GET',
      body,
      headers: init.headers,
    });
    if (path === '/v1/displays/gev/inbox') {
      const stream = new ReadableStream({
        start(controller) {
          push = (text) => controller.enqueue(encoder.encode(text));
          close = () => controller.close();
          init.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('aborted', 'AbortError'));
            } catch {}
          });
        },
      });
      inboxOpened.forEach((resolve) => resolve());
      return { ok: true, status: 200, body: stream };
    }
    const status = path.endsWith('/register') ? registerStatus : 200;
    return {
      ok: status < 300,
      status,
      json: async () => ({ ok: status < 300 }),
    };
  };
  return {
    fetch,
    requests,
    send: (command) =>
      push(
        `id: ${command.id}\nevent: command\ndata: ${JSON.stringify(command)}\n\n`,
      ),
    close: () => close?.(),
    opened: () =>
      new Promise((resolve) => (push ? resolve() : inboxOpened.push(resolve))),
    results: () => requests.filter((r) => r.path === '/v1/displays/gev/result'),
  };
}

function bridgeFor(broker, overrides = {}) {
  const timers = [];
  const bridge = createZ0liveDisplayBridge({
    broker: BROKER,
    token: TOKEN,
    fetch: broker.fetch,
    setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearInterval: () => {},
    logger: { warn: (message) => (overrides.warnings ?? []).push(message) },
    reconnectMs: [5],
    ...overrides,
  });
  return { bridge, timers };
}

test('config is opt-in, moves a fragment token into storage and out of the address', () => {
  const storage = memoryStorage();
  assert.equal(
    readZ0liveDisplayConfig({ location: { search: '', hash: '' }, storage }),
    null,
  );
  assert.equal(
    readZ0liveDisplayConfig({
      location: { search: '?z0live=javascript:alert(1)', hash: '' },
      storage,
    }),
    null,
  );
  const replaced = [];
  const config = readZ0liveDisplayConfig({
    location: {
      search: `?z0live=${encodeURIComponent(BROKER + '/')}`,
      hash: `#cam=1&z0live_token=${TOKEN}`,
      href: `http://localhost:4173/?z0live=x#cam=1&z0live_token=${TOKEN}`,
    },
    storage,
    history: { state: null, replaceState: (_s, _t, url) => replaced.push(url) },
  });
  assert.deepEqual(config, { broker: BROKER, token: TOKEN });
  assert.equal(storage.map.get(Z0LIVE_TOKEN_KEY), TOKEN);
  assert.equal(replaced.length, 1);
  assert.ok(!replaced[0].includes(TOKEN), 'token leaves the address');
  assert.ok(replaced[0].endsWith('#cam=1'), 'other fragment state stays');
  // A later load reads the stored token.
  assert.deepEqual(
    readZ0liveDisplayConfig({
      location: { search: `?z0live=${BROKER}`, hash: '' },
      storage,
    }),
    { broker: BROKER, token: TOKEN },
  );
});

test('registered tools are real action names with one-line descriptions', () => {
  const names = new Set(GEV_ACTION_SCHEMAS.map((schema) => schema.name));
  const tools = z0liveDisplayTools();
  assert.ok(tools.length >= 10);
  for (const tool of tools) {
    assert.ok(names.has(tool.name), tool.name);
    assert.ok(tool.description && !tool.description.includes('\n'));
  }
  assert.ok(tools.some((tool) => tool.name === 'fly_to_location'));
  assert.ok(
    !tools.some((tool) => tool.name === 'set_voice_inactivity_timeout'),
  );
  assert.deepEqual(
    z0liveDisplayTools({ fly_to_location: 'x', not_real: 'y' }),
    [{ name: 'fly_to_location', description: 'x' }],
  );
});

test('success follows the runner result, never the dispatch', () => {
  assert.equal(actionSucceeded({ ok: true, say: 'Flying to Tokyo.' }), true);
  assert.equal(actionSucceeded({ ok: false, error: 'No place found' }), false);
  assert.equal(actionSucceeded({ ok: true, refused: 'stories-open' }), false);
  assert.equal(actionSucceeded({ cancelled: true }), false);
  assert.equal(actionSucceeded({ unavailable: true }), false);
  assert.equal(actionSucceeded(undefined), false);
  const long = summarizeResult(
    { say: 'x'.repeat(5000) },
    { camera: { latitude: 1 } },
  );
  assert.equal(long.truncated, true);
  assert.deepEqual(long.camera, { latitude: 1 });
});

test('SSE frames parse across chunk boundaries and skip comments', () => {
  const [events, rest] = parseSseFrames(
    ': hello\n\nid: a\nevent: command\ndata: {"id":"a"}\n\nevent: comm',
  );
  assert.deepEqual(events, [{ event: 'command', data: '{"id":"a"}' }]);
  assert.equal(rest, 'event: comm');
});

test('world context is compact: rounded camera, enabled layer ids, tracked ids', () => {
  const context = compactWorldContext({
    camera: { latitude: 35.689512, longitude: 139.69171, heightM: 15234.6 },
    style: 'normal',
    layers: [
      { id: 'flights', enabled: true },
      { id: 'ships', enabled: false },
    ],
    tracked: [
      { kind: 'aircraft', layerId: 'flights', id: 42, callsign: 'JAL1' },
    ],
    cockpit: { active: false },
  });
  assert.deepEqual(context, {
    camera: { latitude: 35.6895, longitude: 139.6917, heightM: 15235 },
    style: 'normal',
    layers: ['flights'],
    tracked: [
      { kind: 'aircraft', layerId: 'flights', id: '42', callsign: 'JAL1' },
    ],
    cockpit: false,
  });
});

test('registers, runs an inbox command through the runner and posts its real result', async (t) => {
  const broker = fakeBroker();
  const calls = [];
  let camera = { latitude: 0, longitude: 0 };
  const { bridge, timers } = bridgeFor(broker, {
    run: async (name, args, options) => {
      calls.push({ name, args, aborted: options.signal.aborted });
      if (args.query === 'Atlantis')
        return { ok: false, error: 'No place found' };
      camera = { latitude: 35.68, longitude: 139.76 };
      return { ok: true, say: 'Flying to Tokyo.' };
    },
    readContext: () => ({ camera }),
  });
  t.after(() => bridge.stop());
  assert.equal(await bridge.start(), true);
  const register = broker.requests[0];
  assert.equal(register.path, '/v1/displays/register');
  assert.equal(register.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(register.body.display, 'gev');
  assert.ok(
    register.body.tools.some((tool) => tool.name === 'fly_to_location'),
  );
  assert.deepEqual(register.body.context, {
    camera: { latitude: 0, longitude: 0 },
  });
  assert.deepEqual(
    timers.map((timer) => timer.ms),
    [5000, 1000],
    'heartbeat every 5 s, context checks every second',
  );
  await broker.opened();
  broker.send({
    id: 'c1',
    action: 'fly_to_location',
    args: { query: 'Tokyo' },
  });
  broker.send({
    id: 'c2',
    action: 'fly_to_location',
    args: { query: 'Atlantis' },
  });
  broker.send({
    id: 'c3',
    action: 'set_voice_inactivity_timeout',
    args: { minutes: 1 },
  });
  await waitFor(() => broker.results().length === 3);
  await bridge.idle();
  assert.deepEqual(
    calls.map((c) => c.args.query),
    ['Tokyo', 'Atlantis'],
  );
  const [r1, r2, r3] = broker.results().map((r) => r.body);
  assert.equal(r1.id, 'c1');
  assert.equal(r1.ok, true);
  assert.equal(r1.output.say, 'Flying to Tokyo.');
  assert.deepEqual(r1.output.camera, { latitude: 35.68, longitude: 139.76 });
  assert.deepEqual(
    [r2.id, r2.ok, r2.output.error],
    ['c2', false, 'No place found'],
  );
  assert.deepEqual(
    [r3.id, r3.ok],
    ['c3', false],
    'unlisted actions are refused',
  );
  const json = JSON.stringify(broker.requests.map((r) => r.body));
  assert.ok(!json.includes(TOKEN), 'token never travels in a body');
});

test('a runner that throws or overruns reports failure, not success', async (t) => {
  const broker = fakeBroker();
  const pending = [];
  const { bridge } = bridgeFor(broker, {
    commandMs: 20,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    run: async (name, args, { signal }) => {
      if (args.mode === 'throw') throw new Error('Viewer not ready');
      return new Promise((_resolve, reject) => {
        pending.push(signal);
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
  });
  t.after(() => bridge.stop());
  await bridge.start();
  await broker.opened();
  broker.send({ id: 'a', action: 'zoom_to_globe', args: { mode: 'throw' } });
  broker.send({ id: 'b', action: 'zoom_to_globe', args: {} });
  await waitFor(() => broker.results().length === 2);
  const [a, b] = broker.results().map((r) => r.body);
  assert.deepEqual([a.ok, a.output.error], [false, 'Viewer not ready']);
  assert.deepEqual(
    [b.ok, b.output.error],
    [false, 'The globe action timed out.'],
  );
  assert.equal(pending[0].aborted, true);
});

test('heartbeat re-registers after a broker restart; refusal and missing token stay quiet', async (t) => {
  const broker = fakeBroker();
  const original = broker.fetch;
  let forget = false;
  broker.fetch = async (url, init) => {
    if (forget && new URL(url).pathname.endsWith('/heartbeat')) {
      forget = false;
      broker.requests.push({ path: '/v1/displays/gev/heartbeat', body: {} });
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return original(url, init);
  };
  const { bridge, timers } = bridgeFor(broker, {
    run: async () => ({ ok: true }),
  });
  t.after(() => bridge.stop());
  await bridge.start();
  forget = true;
  await timers[0].fn();
  await waitFor(
    () =>
      broker.requests.filter((r) => r.path === '/v1/displays/register')
        .length === 2,
  );

  const refused = fakeBroker({ registerStatus: 401 });
  const warnings = [];
  const { bridge: denied } = bridgeFor(refused, {
    run: async () => ({ ok: true }),
    warnings,
    setTimeout: () => 0,
  });
  t.after(() => denied.stop());
  assert.equal(await denied.start(), false);
  assert.ok(warnings.some((w) => w.includes('HTTP 401')));
  assert.ok(!warnings.join(' ').includes(TOKEN));

  const none = fakeBroker();
  const { bridge: tokenless } = bridgeFor(none, {
    token: '',
    run: async () => ({}),
  });
  assert.equal(await tokenless.start(), false);
  assert.equal(none.requests.length, 0, 'no token: no request at all');
});

async function waitFor(predicate, ms = 2000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
