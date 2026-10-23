import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { run } from './cli.mjs';
import { normalizeSnapshot } from './projection.mjs';

function sample(id) {
  return normalizeSnapshot({
    type: 'snapshot',
    capturedAt: 1000,
    change: 'selection',
    selected: {
      id, name: id, layerId: 'vessels', source: 'AIS',
      status: 'stale (missed polls)', updatedAt: 1000,
    },
    layers: [
      { id: 'vessels', name: 'Vessels', enabled: true,
        feedState: 'partial', count: 2, source: 'AIS', lastUpdate: 1000 },
    ],
  }, 1500);
}

async function until(predicate) {
  for (let n = 0; n < 80; n += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('CLI lifecycle did not reach the expected state');
}

test('non-TTY CLI invalidates new owners, freezes pause, advances idle ages, and leaks no repeated secret', async () => {
  const stdin = new PassThrough();
  const token = 'z'.repeat(43);
  const privateLink = 'http://localhost:4173/?gevTernPort=4321&gevTernToken=' + token;
  let stdout = '';
  let stderr = '';
  let callbacks;
  let tick;
  let stoppedTimer = 0;
  let relayCloses = 0;
  let refreshes = 0;
  let now = 3000;
  const running = run([], {
    connectSession: async () => null,
    makeRelay: async (handlers) => {
      callbacks = handlers;
      return {
        browserUrl: privateLink,
        requestSnapshot: () => { refreshes += 1; return true; },
        close: async () => { relayCloses += 1; },
      };
    },
    stdin,
    stdout: { write: (part) => { stdout += part; } },
    stderr: { write: (part) => { stderr += part; } },
    now: () => now,
    startTicker: (fn) => { tick = fn; return { unref() {} }; },
    stopTicker: () => { stoppedTimer += 1; },
    observeSignals: false,
  });
  try {
    await until(() => callbacks && tick);
    callbacks.onStatus('connected');
    assert.match(stdout, /awaiting its first snapshot/);
    callbacks.onSnapshot(sample('FIRST'));
    assert.match(stdout, /FIRST/);
    assert.match(stdout, /PARTIAL/);
    stdin.write('p\n');
    await until(() => stdout.includes('Presentation paused'));
    const pausedOutput = stdout;
    callbacks.onSnapshot(sample('SHOULD_NOT_APPEAR'));
    now = 124000;
    tick();
    assert.equal(stdout, pausedOutput, 'paused timer cannot mutate visible state');
    stdin.write('r\n');
    await until(() => stdout.includes('Requested a new browser snapshot'));
    assert.ok(!stdout.includes('SHOULD_NOT_APPEAR'));
    callbacks.onStatus('connected');
    await until(() => stdout.includes('No current browser snapshot'));
    stdin.write('h\n');
    await until(() => stdout.includes('Keys: r refresh'));
    stdin.write('p\n');
    await until(() => stdout.includes('Presentation resumed'));
    assert.ok(refreshes >= 2);
    callbacks.onSnapshot(sample('SECOND'));
    await until(() => stdout.includes('SECOND'));
    tick();
    assert.match(stdout, /browser capture: 2m ago/i);
    assert.match(stdout, /relay received: 2m ago/i);
    assert.ok(!stdout.includes(token), 'public fallback URL must be credential-free');
    assert.ok(!/[\x1b\x9b]/.test(stdout), 'non-TTY must not emit terminal escapes');
    assert.equal(stderr.split(token).length - 1, 1, 'private link printed once');
  } finally {
    stdin.write('q\n');
    stdin.end();
    await running;
  }
  assert.equal(relayCloses, 1);
  assert.equal(stoppedTimer, 1);
});

test('native CLI closes the SDK session and inline surface without retaining a view', async () => {
  const events = [{ type: 'key', key: { name: 'h' } }, { type: 'key', key: { name: 'q' } }];
  const renders = [];
  const keeps = [];
  let sdkCloses = 0;
  let relayCloses = 0;
  const surface = {
    closed: false,
    render(view) { renders.push(view); },
    async close(options) { keeps.push(options.keep); this.closed = true; },
  };
  const session = {
    caps: { kinds: ['col', 'text'], features: [] },
    open() { return surface; },
    async close() { sdkCloses += 1; },
    async *[Symbol.asyncIterator]() { for (const event of events) yield event; },
  };
  await run([], {
    connectSession: async () => session,
    makeRelay: async () => ({
      browserUrl: 'http://localhost:4173/?gevTernPort=1&gevTernToken=' + 'a'.repeat(43),
      requestSnapshot: () => true,
      close: async () => { relayCloses += 1; },
    }),
    stdout: { write() { assert.fail('native session should not print plain text'); } },
    stderr: { write() {} },
    startTicker: () => ({ unref() {} }),
    stopTicker: () => {},
    observeSignals: false,
  });
  assert.ok(renders.length >= 2);
  assert.deepEqual(keeps, [false]);
  assert.equal(sdkCloses, 1);
  assert.equal(relayCloses, 1);
});
