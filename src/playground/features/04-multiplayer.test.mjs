import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRoom, parseRoomMessage, makeRoomInvite, ROOM_PROTOCOL, feature } from './04-multiplayer.js';

test('local room codes cannot contain path or script characters', () => {
  assert.equal(normalizeRoom(' Team-Earth '), 'team-earth');
  assert.equal(normalizeRoom('../other'), null);
  assert.equal(normalizeRoom('<script>'), null);
  assert.equal(normalizeRoom('ab'), null);
});
test('presence packets are scoped, fresh and view coordinates bounded', () => {
  const now = 100000;
  const base = { protocol: ROOM_PROTOCOL, room: 'earth', peer: 'peer-alpha', sentAt: now, kind: 'view' };
  assert.ok(parseRoomMessage({ ...base, view: { lat: 40, lon: -100, height: 50000 } }, 'earth', now));
  assert.equal(parseRoomMessage({ ...base, room: 'other', view: { lat: 40, lon: 2, height: 10000 } }, 'earth', now), null);
  assert.equal(parseRoomMessage({ ...base, view: { lat: 91, lon: 2, height: 10000 } }, 'earth', now), null);
  assert.equal(parseRoomMessage({ ...base, sentAt: 100 }, 'earth', now), null);
});
test('invite preserves existing scene share hash', () => {
  const next = new URL(makeRoomInvite('https://example.org/view?embed=0#map=foo', 'earth-lab'));
  assert.equal(next.searchParams.get('gevRoom'), 'earth-lab');
  assert.equal(next.hash, '#map=foo');
});

// Only intentionally coarsened public-view coordinates may cross a local-room boundary.
test('incoming views reject fine locations and discard unrecognized private fields', () => {
  const now = 100000;
  const base = {
    protocol: ROOM_PROTOCOL, room: 'earth-lab', peer: 'peer-alpha',
    sentAt: now, kind: 'view',
  };
  const coarse = { lat: 40.1, lon: -100.3, height: 50000 };
  const withExtras = {
    ...base,
    view: { ...coarse, preciseLatitude: 40.100001, address: 'not-for-sharing' },
  };
  assert.deepEqual(parseRoomMessage(withExtras, 'earth-lab', now), {
    ...base, view: coarse,
  });

  const rejected = [
    { ...coarse, lat: 40.100001 },
    { ...coarse, lon: -100.300001 },
    { ...coarse, height: 50123 },
    { ...coarse, lat: NaN },
    { ...coarse, height: 30001000 },
  ];
  for (const view of rejected) {
    assert.equal(
      parseRoomMessage({ ...base, view }, 'earth-lab', now),
      null,
      'unsupported precision or bounds must fail closed',
    );
  }
});

// Join/hello are presence-only. Never retain arbitrary fields from another tab.
test('presence packets strip private fields and precise views', () => {
  const now = 100000;
  for (const kind of ['join', 'hello']) {
    const raw = {
      protocol: ROOM_PROTOCOL,
      room: 'earth-lab',
      peer: 'peer-alpha',
      sentAt: now,
      kind,
      view: { lat: 40.123456, lon: -100.123456, height: 1234 },
      address: 'private-house',
      location: { preciseLatitude: 40.123456 },
    };
    const parsed = parseRoomMessage(raw, 'earth-lab', now);
    assert.notStrictEqual(parsed, raw);
    assert.deepEqual(parsed, {
      protocol: ROOM_PROTOCOL,
      room: 'earth-lab',
      peer: 'peer-alpha',
      sentAt: now,
      kind,
    });
  }
});

test('explicit leave sanitizes private data and rejects stale or cross-room packets', () => {
  const now = 100000;
  const raw = {
    protocol: ROOM_PROTOCOL,
    room: 'earth-lab',
    peer: 'peer-alpha',
    sentAt: now,
    kind: 'leave',
    address: 'private-house',
    view: { lat: 40.12345, lon: -88.12345, height: 1234 },
  };
  assert.deepEqual(parseRoomMessage(raw, 'earth-lab', now), {
    protocol: ROOM_PROTOCOL,
    room: 'earth-lab',
    peer: 'peer-alpha',
    sentAt: now,
    kind: 'leave',
  });
  for (const invalid of [
    { ...raw, room: 'another-room' },
    { ...raw, peer: '<script>' },
    { ...raw, sentAt: now - 60001 },
  ])
    assert.equal(parseRoomMessage(invalid, 'earth-lab', now), null);
});

test('explicit leave and owner teardown remove ghost same-origin tab presence', () => {
  const channels = new Map();
  class TestChannel {
    constructor(name) {
      this.name = name;
      this.closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      for (const peer of channels.get(this.name))
        if (peer !== this && !peer.closed)
          peer.onmessage?.({ data: structuredClone(data) });
    }
    close() {
      this.closed = true;
      channels.get(this.name).delete(this);
    }
  }
  const document = {
    createElement(tag) {
      return {
        tagName: tag,
        ownerDocument: document,
        children: [],
        textContent: '',
        disabled: false,
        listeners: new Map(),
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
        click() { this.listeners.get('click')?.(); },
      };
    },
  };
  const tab = () => {
    const root = document.createElement('section');
    const dispose = feature.mount({
      root,
      services: {
        window: { location: { search: '' }, BroadcastChannel: TestChannel },
      },
    });
    return {
      join: () => root.children[3].children[0].click(),
      leave: () => root.children[3].children[1].click(),
      peerCount: () => root.children[5].children.length,
      status: () => root.children[4].textContent,
      dispose,
    };
  };
  const observer = tab();
  const visitor = tab();
  observer.join();
  visitor.join();
  assert.equal(observer.peerCount(), 1);
  visitor.leave();
  assert.equal(observer.peerCount(), 0);
  assert.match(observer.status(), /^0 nearby tab\(s\)/);
  visitor.join();
  assert.equal(observer.peerCount(), 1);
  visitor.dispose();
  assert.equal(observer.peerCount(), 0);
  observer.dispose();
});
