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
test('room invite excludes private query, credentials and scene by default', () => {
  const next = new URL(makeRoomInvite(
    'https://user:password@example.org/view?embed=0&token=private#map=40.123456',
    'earth-lab',
  ));
  assert.equal(next.origin, 'https://example.org');
  assert.equal(next.pathname, '/view');
  assert.deepEqual([...next.searchParams], [['gevRoom', 'earth-lab']]);
  assert.equal(next.hash, '');
  assert.equal(next.username, '');
  assert.equal(next.password, '');
  assert.throws(() => makeRoomInvite('file:///tmp/gev', 'earth-lab'), TypeError);
});
test('scene URL fragment requires separate consent and excludes unrelated query', () => {
  const original = 'https://example.org/view?embed=1&token=private#map=40.123456';
  const next = new URL(makeRoomInvite(original, 'earth-lab', { includeScene: true }));
  assert.deepEqual([...next.searchParams], [['gevRoom', 'earth-lab']]);
  assert.equal(next.hash, '#map=40.123456');
  assert.equal(new URL(makeRoomInvite(original, 'earth-lab', { includeScene: 'true' })).hash, '');
});

test('copy room link keeps precise scene state out until explicitly checked', async () => {
  const copied = [];
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], listeners: new Map(),
        textContent: '', checked: false,
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      };
    },
  };
  const root = document.createElement('section');
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: {
          search: '',
          href: 'https://example.org/view?token=private#map=40.123456',
        },
        navigator: {
          clipboard: { async writeText(value) { copied.push(value); } },
        },
      },
    },
  });
  try {
    const actions = root.children[3];
    const copy = actions.children[3];
    const includeScene = actions.children[4].children[0];
    assert.equal(includeScene.type, 'checkbox');
    assert.equal(includeScene.checked, false);
    await copy.listeners.get('click')();
    assert.deepEqual([...new URL(copied[0]).searchParams], [['gevRoom', 'earth-lab']]);
    assert.equal(new URL(copied[0]).hash, '');
    assert.match(root.children[4].textContent, /Room-only link copied/);
    includeScene.checked = true;
    await copy.listeners.get('click')();
    assert.equal(new URL(copied[1]).hash, '#map=40.123456');
    assert.deepEqual([...new URL(copied[1]).searchParams], [['gevRoom', 'earth-lab']]);
    assert.match(root.children[4].textContent, /may disclose map location/);
  } finally {
    dispose();
  }
});

test('joined-room invite uses active channel despite edits to the room-code field', async () => {
  const copied = [];
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], listeners: new Map(),
        textContent: '', checked: false,
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      };
    },
  };
  const root = document.createElement('section');
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: {
          search: '',
          href: 'https://example.org/view?token=private#map=canary',
        },
        navigator: {
          clipboard: { async writeText(value) { copied.push(value); } },
        },
        BroadcastChannel: class {
          postMessage() {}
          close() {}
        },
        setInterval() { return 1; },
        clearInterval() {},
      },
    },
  });
  try {
    const input = root.children[2];
    const actions = root.children[3];
    const join = actions.children[0];
    const leave = actions.children[1];
    const copy = actions.children[3];
    join.listeners.get('click')();
    input.value = 'other-room';
    await copy.listeners.get('click')();
    assert.deepEqual([...new URL(copied.at(-1)).searchParams], [
      ['gevRoom', 'earth-lab'],
    ]);
    assert.equal(new URL(copied.at(-1)).hash, '');
    assert.equal(new URL(copied.at(-1)).searchParams.has('token'), false);
    // An invalid draft room code cannot suppress the joined-room invite.
    input.value = 'x';
    await copy.listeners.get('click')();
    assert.equal(new URL(copied.at(-1)).searchParams.get('gevRoom'), 'earth-lab');
    // Leaving restores the field as the invitation target.
    leave.listeners.get('click')();
    input.value = 'other-room';
    await copy.listeners.get('click')();
    assert.equal(new URL(copied.at(-1)).searchParams.get('gevRoom'), 'other-room');
    join.listeners.get('click')();
    input.value = 'third-room';
    await copy.listeners.get('click')();
    assert.equal(new URL(copied.at(-1)).searchParams.get('gevRoom'), 'other-room');
  } finally {
    dispose();
  }
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

test('explicit leave, active heartbeats, crashes and stale callbacks stay local', () => {
  const previousNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  const channels = new Map();
  const outgoing = [];
  class TestChannel {
    constructor(name) {
      this.name = name;
      this.closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      if (this.closed) return;
      outgoing.push(structuredClone(data));
      for (const peer of channels.get(this.name)) {
        if (peer !== this && !peer.closed)
          peer.onmessage?.({ data: structuredClone(data) });
      }
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
    let timer = null;
    const win = {
      location: { search: '' },
      BroadcastChannel: class extends TestChannel {
        constructor(name) {
          super(name);
          win.currentChannel = this;
        }
      },
      setInterval(callback, ms) {
        assert.equal(ms, 15000);
        assert.equal(timer, null, 'only one active room heartbeat');
        timer = callback;
        return 1;
      },
      clearInterval(id) {
        assert.equal(id, 1);
        timer = null;
      },
    };
    const dispose = feature.mount({ root, services: { window: win } });
    return {
      join: () => root.children[3].children[0].click(),
      leave: () => root.children[3].children[1].click(),
      peerCount: () => root.children[5].children.length,
      status: () => root.children[4].textContent,
      pulse() {
        assert.ok(timer, 'joined tab must have a heartbeat');
        timer();
      },
      abruptClose() {
        // Simulates a terminated tab: BroadcastChannel disappears without Leave.
        win.currentChannel.close();
        timer = null;
      },
      messageHandler: () => win.currentChannel.onmessage,
      heartbeatActive: () => Boolean(timer),
      dispose,
    };
  };
  let observer, visitor, crashing;
  try {
    observer = tab();
    visitor = tab();
    observer.join();
    visitor.join();
    assert.equal(observer.peerCount(), 1);
    assert.equal(observer.heartbeatActive(), true);
    assert.equal(visitor.heartbeatActive(), true);
    visitor.leave();
    assert.equal(observer.peerCount(), 0);
    assert.match(observer.status(), /^0 nearby tab\(s\)/);
    assert.equal(visitor.heartbeatActive(), false);
    visitor.join();
    assert.equal(observer.peerCount(), 1);
    visitor.dispose();
    assert.equal(observer.peerCount(), 0);

    crashing = tab();
    crashing.join();
    assert.equal(observer.peerCount(), 1);
    // Joined peers refresh presence without ever automatically sending view.
    now += 15000;
    observer.pulse();
    crashing.pulse();
    now += 60000;
    observer.pulse();
    crashing.pulse();
    assert.equal(observer.peerCount(), 1);
    assert.ok(outgoing.some((message) => message.kind === 'hello'));
    assert.equal(outgoing.some((message) => message.kind === 'view'), false);

    crashing.abruptClose();
    assert.equal(observer.peerCount(), 1, 'a crash does not emit Leave');
    now += 76000;
    observer.pulse();
    assert.equal(observer.peerCount(), 0, 'silent peer must expire from view');
    assert.match(observer.status(), /^0 nearby tab\(s\)/);

    // A queued callback from the previous channel must not resurrect a peer
    // when a new channel happens to reuse the same room name.
    const staleHandler = observer.messageHandler();
    observer.leave();
    observer.join();
    staleHandler({ data: {
      protocol: ROOM_PROTOCOL, room: 'earth-lab',
      peer: 'peer-stale', sentAt: now, kind: 'join',
    } });
    assert.equal(observer.peerCount(), 0);
    observer.dispose();
    assert.equal(observer.heartbeatActive(), false);
  } finally {
    observer?.dispose();
    visitor?.dispose();
    crashing?.dispose();
    Date.now = previousNow;
  }
});
