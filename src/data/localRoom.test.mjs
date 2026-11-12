import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_ROOM_PROTOCOL,
  PEER_EXPIRE_MS,
  normalizeRoomCode,
  openLocalRoom,
  parseLocalRoomPacket,
} from './localRoom.js';

const now = 1_000_000;
const packet = (extra) => ({
  protocol: LOCAL_ROOM_PROTOCOL,
  room: 'elm-street',
  peer: 'p-ben0000001',
  sentAt: now,
  kind: 'hello',
  name: 'Ben',
  viewing: null,
  ...extra,
});

/** Same-name channels deliver to every other instance, like BroadcastChannel. */
function hub() {
  const channels = new Set();
  const sent = [];
  class Channel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      channels.add(this);
    }
    postMessage(data) {
      const copy = structuredClone(data);
      sent.push(copy);
      for (const other of channels)
        if (other !== this && other.name === this.name)
          other.onmessage?.({ data: structuredClone(copy) });
    }
    close() {
      channels.delete(this);
    }
  }
  return { Channel, sent };
}
function manualTimers() {
  const intervals = new Map();
  let next = 1;
  return {
    setInterval(fn) {
      intervals.set(next, fn);
      return next++;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    tick() {
      for (const fn of [...intervals.values()]) fn();
    },
    get count() {
      return intervals.size;
    },
  };
}

test('room codes follow the playground local-room rule', () => {
  assert.equal(normalizeRoomCode(' Elm-Street '), 'elm-street');
  for (const bad of ['ab', 'a'.repeat(25), 'elm street', 'élan', null])
    assert.equal(normalizeRoomCode(bad), null);
});

test('presence keeps only a name and the inspected proposal; location fields never survive', () => {
  const parsed = parseLocalRoomPacket(
    packet({
      viewing: 'alt-p-ana0000001-2',
      lat: 37.8,
      lon: -122.4,
      camera: { lat: 37.8, lon: -122.4 },
      view: { lat: 37.8, lon: -122.4, height: 2000 },
      email: 'x@example.com',
    }),
    'elm-street',
    now,
  );
  assert.deepEqual(parsed, {
    protocol: LOCAL_ROOM_PROTOCOL,
    room: 'elm-street',
    peer: 'p-ben0000001',
    sentAt: now,
    kind: 'hello',
    name: 'Ben',
    viewing: 'alt-p-ana0000001-2',
  });
  assert.equal(
    parseLocalRoomPacket(packet({ viewing: '37.8,-122.4' }), 'elm-street', now)
      .viewing,
    null,
  );
});

test('foreign, stale, malformed and unnamed packets are dropped', () => {
  for (const bad of [
    packet({ protocol: 'gev.playground.local-room.v1' }),
    packet({ room: 'other-room' }),
    packet({ peer: 'peer-1' }),
    packet({ kind: 'view' }),
    packet({ sentAt: now - 61_000 }),
    packet({ name: '' }),
    packet({ name: 'x'.repeat(41) }),
    packet({ kind: 'ops', ops: 'not-a-list' }),
  ])
    assert.equal(parseLocalRoomPacket(bad, 'elm-street', now), null);
  assert.deepEqual(
    parseLocalRoomPacket(
      packet({ kind: 'leave', name: 'kept?' }),
      'elm-street',
      now,
    ),
    {
      protocol: LOCAL_ROOM_PROTOCOL,
      room: 'elm-street',
      peer: 'p-ben0000001',
      sentAt: now,
      kind: 'leave',
    },
  );
});

test('joining announces presence, peers answer at once, and silent peers expire', () => {
  const { Channel } = hub();
  let clock = now;
  const timers = manualTimers();
  const seen = { a: new Map(), b: new Map() };
  const open = (peer, name, key) =>
    openLocalRoom({
      BroadcastChannel: Channel,
      room: 'elm-street',
      peer,
      presence: () => ({ name, viewing: null }),
      onPeers: (peers) => {
        seen[key] = peers;
      },
      timers,
      now: () => clock,
    });
  const a = open('p-ana0000001', 'Ana', 'a');
  const b = open('p-ben0000001', 'Ben', 'b');
  assert.deepEqual([...seen.a.keys()], ['p-ben0000001']);
  assert.deepEqual([...seen.b.keys()], ['p-ana0000001']);
  assert.equal(seen.b.get('p-ana0000001').name, 'Ana');
  b.close();
  assert.equal(seen.a.size, 0, 'leave removes the peer');
  const c = open('p-cy00000001', 'Cy', 'b');
  assert.equal(seen.a.size, 1);
  c.close('left', false); // vanished without a leave packet
  clock += PEER_EXPIRE_MS + 1;
  timers.tick();
  assert.equal(seen.a.size, 0, 'heartbeat prunes silent peers');
  a.close();
  assert.equal(timers.count, 0);
});

test('a second tab holding the same identity yields to the first instead of splitting the room', () => {
  const { Channel } = hub();
  const timers = manualTimers();
  const reasons = { first: null, second: null };
  const open = (key) =>
    openLocalRoom({
      BroadcastChannel: Channel,
      room: 'elm-street',
      peer: 'p-ana0000001',
      presence: () => ({ name: 'Ana', viewing: null }),
      onClosed: (why) => {
        reasons[key] = why;
      },
      timers,
    });
  const first = open('first');
  const second = open('second');
  assert.equal(reasons.second, 'duplicate-identity');
  assert.equal(second.closed, true);
  assert.equal(first.closed, false, 'the incumbent keeps its identity');
  first.close();
});
