// The cast relay: rooms, the TV heartbeat, and the Samsung launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCastRooms,
  handleCast,
  lanAddress,
  resolveTvOrigin,
} from './castRelay.js';

test('a TV receives each view the phone sends once, newest first', () => {
  let now = 1000;
  const rooms = createCastRooms({ now: () => now });
  assert.deepEqual(rooms.tv('abc234', { after: 0 }), { seq: 0 });
  rooms.send('abc234', 'v=2&lat=1');
  rooms.send('abc234', 'v=2&lat=2');
  now += 50;
  const reply = rooms.tv('abc234', { after: 0, status: { kind: 'samsung', name: 'QN85B' } });
  assert.equal(reply.seq, 2);
  assert.deepEqual(reply.cmd, { hash: 'v=2&lat=2' });
  assert.equal(reply.age, 50);
  assert.deepEqual(rooms.tv('abc234', { after: 2 }), { seq: 2 });
  const peek = rooms.peek('abc234');
  assert.equal(peek.age, 0);
  assert.equal(rooms.peek('zzzzzz').tv, null);
});

test('the TV capture is kept for the phone, and only image data URLs', () => {
  const rooms = createCastRooms();
  rooms.tv('abc234', { frame: 'javascript:alert(1)' });
  assert.equal(rooms.frame('abc234'), null);
  rooms.tv('abc234', { frame: 'data:image/jpeg;base64,AAAA' });
  assert.equal(rooms.frame('abc234'), 'data:image/jpeg;base64,AAAA');
});

test('routes reject bad rooms and unknown names', async () => {
  const rooms = createCastRooms();
  assert.equal((await handleCast('send', { room: '../x', hash: 'a' }, { rooms }))[0], 400);
  assert.equal((await handleCast('tv', { room: 'ABC' }, { rooms }))[0], 400);
  assert.equal((await handleCast('nope', {}, { rooms }))[0], 404);
  const [status, body] = await handleCast('send', { room: 'ABC234', hash: 'v=2' }, { rooms });
  assert.equal(status, 200, 'room codes are case-insensitive');
  assert.equal(body.seq, 1);
});

test('the TV origin is configured, else the LAN address and port', () => {
  assert.equal(resolveTvOrigin({ GEV_CAST_TV_ORIGIN: 'http://tv.lan:9/' }, { port: 1 }), 'http://tv.lan:9');
  assert.equal(resolveTvOrigin({}, { port: 8803, address: '192.168.1.8' }), 'http://192.168.1.8:8803');
  assert.equal(resolveTvOrigin({}, { port: 8803, address: null }), null);
  assert.equal(
    lanAddress({
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      utun: [{ family: 'IPv4', internal: false, address: '100.100.77.46' }],
      en0: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }],
    }),
    '192.168.1.8',
    'a tailnet address is not the LAN',
  );
});

test('Samsung: without a TV configured the route says so', async () => {
  const [status, body] = await handleCast('samsung', {}, { rooms: createCastRooms(), env: {} });
  assert.equal(status, 501);
  assert.match(body.error, /GEV_SAMSUNG_TV_IP/);
});

test('Samsung: launches the TV app over the LAN and answers with the room it reports in', async () => {
  const rooms = createCastRooms();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.method]);
    // The app opens the TV view, which reports in its own room.
    setTimeout(() => rooms.tv('tv2345', { status: { kind: 'samsung', name: 'Samsung QN85B' } }), 5);
    return { ok: true, status: 200 };
  };
  const [status, body] = await handleCast('samsung', {}, {
    rooms,
    env: { GEV_SAMSUNG_TV_IP: '192.168.1.28' },
    fetchImpl,
    waitMs: 500,
    pollMs: 10,
  });
  assert.deepEqual(calls, [['http://192.168.1.28:8001/api/v2/applications/GEVCastTV1.GodsEyeView', 'POST']]);
  assert.equal(status, 200);
  assert.deepEqual(body, { room: 'tv2345', name: 'Samsung QN85B' });
});

test('Samsung: a TV already showing GEV is reused without a relaunch', async () => {
  const rooms = createCastRooms();
  rooms.tv('tv2345', { status: { kind: 'samsung', name: 'Samsung QN85B' } });
  const fetchImpl = async () => assert.fail('no launch');
  const [status, body] = await handleCast('samsung', {}, {
    rooms,
    env: { GEV_SAMSUNG_TV_IP: '192.168.1.28' },
    fetchImpl,
  });
  assert.equal(status, 200);
  assert.equal(body.room, 'tv2345');
});

test('Samsung: a refused or silent launch is an error the menu shows', async () => {
  const env = { GEV_SAMSUNG_TV_IP: '192.168.1.28' };
  const refused = await handleCast('samsung', {}, {
    rooms: createCastRooms(),
    env,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(refused, [502, { error: 'The TV refused to open the app (HTTP 404)' }]);
  const silent = await handleCast('samsung', {}, {
    rooms: createCastRooms(),
    env,
    fetchImpl: async () => ({ ok: true, status: 200 }),
    waitMs: 30,
    pollMs: 5,
  });
  assert.equal(silent[0], 504);
});
