import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { CLOSE_SUPERSEDED, CLOSE_STOPPED, createLocalRelay, localGlobeUrl } from './relay.mjs';
import { parseArgs } from './cli.mjs';

function wsUrl(relay) {
  const link = new URL(relay.browserUrl);
  return 'ws://127.0.0.1:' + relay.port + '/?token=' + link.searchParams.get('gevTernToken');
}

function connect(wsAddress, origin = 'http://localhost:4173') {
  return new WebSocket(wsAddress, { headers: { Origin: origin } });
}

function rejection(address, origin) {
  return new Promise((resolve) => {
    const ws = connect(address, origin);
    ws.on('unexpected-response', (_request, response) => {
      const status = response.statusCode;
      response.resume();
      resolve(status);
    });
    ws.on('error', () => resolve(403));
  });
}

test('local-only URL input and CLI argument parsing reject foreign hosts', () => {
  assert.equal(localGlobeUrl().hostname, 'localhost');
  assert.throws(() => localGlobeUrl('https://localhost:4173/'), /local http/);
  assert.throws(() => localGlobeUrl('http://example.org:4173/'), /local http/);
  assert.throws(() => localGlobeUrl('http://localhost:4173/?gevTernToken=secret'), /credentials/);
  assert.throws(() => parseArgs(['--port', '-1']), /port/);
  assert.throws(() => parseArgs(['--unknown']), /Unexpected/);
  assert.equal(parseArgs(['--port', '0']).port, 0);
});

test('relay authenticates loopback origin and secret and forwards read-only snapshots', async () => {
  const got = [];
  const states = [];
  const relay = await createLocalRelay({
    onSnapshot: (value) => got.push(value),
    onStatus: (state) => states.push(state),
  });
  const address = wsUrl(relay);
  let ws;
  try {
    assert.equal(await rejection(address, 'http://example.invalid'), 403);
    assert.equal(await rejection(address.replace(/token=[^&]+/, 'token=bad')), 403);
    assert.equal(relay.requestSnapshot(), false);
    ws = connect(address);
    const openingMessage = once(ws, 'message');
    await once(ws, 'open');
    const [request] = await openingMessage;
    assert.deepEqual(JSON.parse(request.toString()), { type: 'snapshot-request' });
    assert.equal(relay.requestSnapshot(), true);
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        capturedAt: 111,
        selected: { id: 'one', name: 'Selected', layerId: 'flights', source: 'ADS-B' },
        layers: [{ id: 'flights', enabled: true, feedState: 'nominal', count: 1 }],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(got[0].selected.id, 'one');
    assert.equal(got[0].layers[0].feedState, 'nominal');
    assert.ok(states.includes('connected'));
  } finally {
    ws?.terminate();
    await relay.close();
  }
});

test('new tab supersedes old connection; rejected data and stale socket do not publish', async () => {
  const got = [];
  const relay = await createLocalRelay({ onSnapshot: (value) => got.push(value) });
  let first;
  let second;
  try {
    first = connect(wsUrl(relay));
    await once(first, 'open');
    const firstClosed = once(first, 'close');
    second = connect(wsUrl(relay));
    await once(second, 'open');
    const [closeCode] = await firstClosed;
    assert.equal(closeCode, CLOSE_SUPERSEDED);
    second.send(JSON.stringify({ type: 'action', name: 'turn_on_flights', layers: [] }));
    second.send(JSON.stringify({ type: 'snapshot', selected: null, layers: [] }));
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(got.length, 1);
    assert.equal(got[0].selected, null);
    assert.equal(first.readyState, WebSocket.CLOSED);
  } finally {
    first?.terminate();
    second?.terminate();
    await relay.close();
  }
});

test('relay release closes its listener so the same port can be rebound', async () => {
  const first = await createLocalRelay();
  const port = first.port;
  await first.close();
  const next = await createLocalRelay({ port });
  assert.equal(next.port, port);
  await next.close();
});


test('oversized UTF-8 data is closed without being published', async () => {
  const snapshots = [];
  const relay = await createLocalRelay({ onSnapshot: (value) => snapshots.push(value) });
  const ws = connect(wsUrl(relay));
  try {
    await once(ws, 'open');
    const closed = once(ws, 'close');
    const payload = JSON.stringify({
      type: 'snapshot',
      layers: [],
      untrusted: '界'.repeat(30_000),
    });
    assert.ok(Buffer.byteLength(payload) > 64 * 1024);
    ws.send(payload);
    const [code] = await closed;
    assert.equal(code, 1009);
    assert.equal(snapshots.length, 0);
  } finally {
    ws.terminate();
    await relay.close();
  }
});


// Stop closes the active authenticated client with a non-retryable reason.
test('relay shutdown signals permanent stop and releases the port', async () => {
  const relay = await createLocalRelay();
  const browser = connect(wsUrl(relay));
  try {
    await once(browser, 'open');
    const closed = once(browser, 'close');
    await relay.close();
    const [code] = await closed;
    assert.equal(code, CLOSE_STOPPED);
    const replacement = await createLocalRelay({ port: relay.port });
    await replacement.close();
  } finally {
    browser.terminate();
    await relay.close();
  }
});
