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
  const original = 'https://example.org/view?embed=1&token=private#lat=40.1&lon=-88.1&map=photoreal&access_token=hash-private';
  const next = new URL(makeRoomInvite(original, 'earth-lab', { includeScene: true }));
  assert.deepEqual([...next.searchParams], [['gevRoom', 'earth-lab']]);
  assert.equal(next.hash, '#lat=40.1&lon=-88.1&map=photoreal');
  assert.equal(new URL(makeRoomInvite(original, 'earth-lab', { includeScene: 'true' })).hash, '');
});

test('explicit scene invites discard unrelated hash tokens and invalid camera state', () => {
  const source = 'https://example.org/view?token=query-secret';
  const fragment = '#lat=40.1&lon=-88.1&map=photoreal&style=nvg' +
    '&access_token=hash-secret&custom=canary&lat=41';
  const included = new URL(makeRoomInvite(source + fragment, 'earth-lab', {
    includeScene: true,
  }));
  assert.deepEqual([...included.searchParams], [['gevRoom', 'earth-lab']]);
  assert.equal(included.hash, '#lat=40.1&lon=-88.1&map=photoreal&style=nvg');
  assert.equal(included.href.includes('secret'), false);
  assert.equal(included.href.includes('canary'), false);
  assert.equal(
    new URL(makeRoomInvite(source + fragment, 'earth-lab')).hash,
    '',
    'room-only default never includes even recognized camera hash keys',
  );
  for (const hash of [
    '#access_token=hash-secret',
    '#map=photoreal',
    '#lat=40.1',
    '#lat=&lon=-88.1',
    '#lat=NaN&lon=-88.1',
    '#lat=91&lon=-88.1',
    '#lat=40.1&lon=-181',
  ]) {
    assert.equal(
      new URL(makeRoomInvite(source + hash, 'earth-lab', {
        includeScene: true,
      })).hash,
      '',
      'unsupported or incomplete camera hash must never be copied',
    );
  }
  assert.equal(
    new URL(makeRoomInvite(source + fragment, 'earth-lab', {
      includeScene: 'true',
    })).hash,
    '',
    'truthy-looking strings are not scene-sharing consent',
  );
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
          href: 'https://example.org/view?token=private#lat=40.1&lon=-88.1&map=photoreal&access_token=hash-private',
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
    assert.equal(new URL(copied[1]).hash, '#lat=40.1&lon=-88.1&map=photoreal');
    assert.deepEqual([...new URL(copied[1]).searchParams], [['gevRoom', 'earth-lab']]);
    assert.match(root.children[4].textContent, /may disclose map location/);
    assert.equal(includeScene.checked, false, 'scene consent must be one-shot');
    await copy.listeners.get('click')();
    assert.equal(new URL(copied[2]).hash, '',
      'copying again without fresh consent must not leak the scene');
    assert.match(root.children[4].textContent, /Room-only link copied/);
    // Two immediate Copy activations must consume only one scene opt-in,
    // even when clipboard completion occurs asynchronously.
    includeScene.checked = true;
    const first = copy.listeners.get('click')();
    const second = copy.listeners.get('click')();
    await Promise.all([first, second]);
    assert.equal(new URL(copied[3]).hash, '#lat=40.1&lon=-88.1&map=photoreal');
    assert.equal(new URL(copied[4]).hash, '',
      'a pending scene copy must not authorize a second scene disclosure');
    assert.equal(includeScene.checked, false);
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

test('denied BroadcastChannel remains disconnected and a later join can recover', () => {
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], listeners: new Map(),
        textContent: '',
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      };
    },
  };
  const root = document.createElement('section');
  let attempts = 0;
  const packets = [];
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: { search: '' },
        BroadcastChannel: class {
          constructor(name) {
            attempts += 1;
            if (attempts === 1) throw new Error('channel denied');
            this.name = name;
          }
          postMessage(packet) { packets.push(packet); }
          close() {}
        },
        setInterval(_callback, ms) {
          assert.equal(ms, 15000);
          return 1;
        },
        clearInterval(id) { assert.equal(id, 1); },
      },
    },
  });
  try {
    const actions = root.children[3];
    const join = actions.children[0];
    const leave = actions.children[1];
    const share = actions.children[2];
    const joinRoom = () => join.listeners.get('click')();

    assert.doesNotThrow(joinRoom);
    assert.equal(attempts, 1);
    assert.match(root.children[4].textContent, /Local room unavailable/);
    assert.equal(leave.disabled, true);
    assert.equal(share.disabled, true);
    assert.deepEqual(packets, []);

    assert.doesNotThrow(joinRoom);
    assert.equal(attempts, 2);
    assert.equal(leave.disabled, false);
    assert.equal(share.disabled, false);
    assert.equal(packets.length, 1);
    assert.equal(packets[0].kind, 'join');
    assert.equal(packets[0].room, 'earth-lab');
    assert.match(root.children[4].textContent, /Joined local tab room earth-lab/);
  } finally {
    dispose();
  }
});

test('local room message failures release membership and never confirm a failed view', () => {
  const document = {
    createElement(tagName) {
      return {
        tagName,
        ownerDocument: document,
        children: [],
        listeners: new Map(),
        textContent: '',
        disabled: false,
        setAttribute() {},
        append(...nodes) {
          this.children.push(...nodes);
        },
        replaceChildren(...nodes) {
          this.children = nodes;
        },
        addEventListener(event, listener) {
          this.listeners.set(event, listener);
        },
      };
    },
  };
  const root = document.createElement('section');
  const outgoing = [];
  const channels = [];
  let failPost = null;
  let failClose = false;
  let activeTick = null;
  let timerId = 0;
  class Channel {
    constructor(name) {
      this.name = name;
      channels.push(this);
    }
    postMessage(message) {
      if (failPost === message.kind) {
        failPost = null;
        throw new Error('simulated BroadcastChannel postMessage denial');
      }
      outgoing.push(message);
    }
    close() {
      this.closed = true;
      if (failClose) {
        failClose = false;
        throw new Error('simulated BroadcastChannel close denial');
      }
    }
  }
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: { search: '' },
        BroadcastChannel: Channel,
        setInterval(callback, duration) {
          assert.equal(duration, 15000);
          activeTick = callback;
          return ++timerId;
        },
        clearInterval() {
          activeTick = null;
        },
      },
      viewer: { camera: { positionWC: {} } },
      Cesium: {
        Cartographic: {
          fromCartesian: () => ({ latitude: 0.5, longitude: -1, height: 3000 }),
        },
        Math: { toDegrees: (radians) => (radians * 180) / Math.PI },
      },
    },
  });
  const [join, leave, share] = root.children[3].children;
  const click = (button) => button.listeners.get('click')();
  const disconnected = () => {
    assert.equal(leave.disabled, true);
    assert.equal(share.disabled, true);
    assert.equal(activeTick, null);
    assert.equal(root.children[5].children.length, 0);
  };
  try {
    failPost = 'join';
    assert.doesNotThrow(() => click(join));
    disconnected();
    assert.equal(channels.at(-1).closed, true);
    assert.equal(outgoing.length, 0, 'denied join cannot send ghost presence');

    // A later explicit retry is allowed; a failed send is not membership.
    click(join);
    assert.equal(leave.disabled, false);
    assert.ok(activeTick);

    // Replies to a new participant also fail closed.
    failPost = 'hello';
    channels.at(-1).onmessage({
      data: {
        protocol: ROOM_PROTOCOL,
        room: 'earth-lab',
        peer: 'peer-other',
        sentAt: Date.now(),
        kind: 'join',
      },
    });
    disconnected();

    click(join);
    failPost = 'hello';
    assert.doesNotThrow(() => activeTick());
    disconnected();

    click(join);
    failPost = 'view';
    assert.doesNotThrow(() => click(share));
    disconnected();
    assert.equal(
      outgoing.some((packet) => packet.kind === 'view'),
      false,
      'a denied view send must not claim successful sharing',
    );
    assert.match(root.children[4].textContent, /view not shared/);

    click(join);
    failPost = 'leave';
    assert.doesNotThrow(() => click(leave));
    disconnected();

    click(join);
    failClose = true;
    assert.doesNotThrow(() => click(leave));
    disconnected();
  } finally {
    dispose();
  }
});

test('invalid camera snapshots never send views or claim success, then allow a valid retry', () => {
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], listeners: new Map(),
        textContent: '', disabled: false,
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(event, listener) { this.listeners.set(event, listener); },
      };
    },
  };
  const root = document.createElement('section');
  const sent = [];
  let camera = null;
  let destroyed = false;
  let teardownThrows = false;
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: { search: '' },
        BroadcastChannel: class {
          postMessage(packet) { sent.push(packet); }
          close() {}
        },
        setInterval() { return 1; },
        clearInterval() {},
      },
      viewer: {
        isDestroyed() {
          if (teardownThrows) throw new Error('Scene teardown in progress');
          return destroyed;
        },
        camera: { positionWC: {} },
      },
      Cesium: {
        Cartographic: {
          fromCartesian() {
            if (camera === 'throw') throw new Error('destroyed camera');
            return camera;
          },
        },
        Math: { toDegrees: (radians) => radians * 180 / Math.PI },
      },
    },
  });
  const [join, leave, share] = root.children[3].children;
  const click = (button) => button.listeners.get('click')();
  try {
    click(join);
    assert.equal(leave.disabled, false);
    for (const invalid of [
      null,
      { latitude: NaN, longitude: 1, height: 3000 },
      { latitude: 1, longitude: Infinity, height: 3000 },
      { latitude: 1, longitude: 1, height: NaN },
      { latitude: Math.PI, longitude: 1, height: 3000 },
      'throw',
    ]) {
      camera = invalid;
      assert.doesNotThrow(() => click(share));
      assert.equal(sent.filter((packet) => packet.kind === 'view').length, 0);
      assert.match(root.children[4].textContent, /nothing shared/);
      assert.equal(leave.disabled, false, 'camera failure must not disconnect peers');
    }
    camera = { latitude: 0.5, longitude: -1, height: 3333 };
    destroyed = true;
    assert.doesNotThrow(() => click(share));
    assert.equal(sent.filter((packet) => packet.kind === 'view').length, 0,
      'a destroyed Scene cannot share its stale camera position');
    assert.match(root.children[4].textContent, /nothing shared/);
    assert.equal(leave.disabled, false, 'teardown must not disconnect the room');
    destroyed = false;
    teardownThrows = true;
    assert.doesNotThrow(() => click(share));
    assert.equal(sent.filter((packet) => packet.kind === 'view').length, 0,
      'a throwing Scene lifecycle check cannot share a view');
    teardownThrows = false;
    click(share);
    const views = sent.filter((packet) => packet.kind === 'view');
    assert.equal(views.length, 1);
    assert.deepEqual(views[0].view, {
      lat: 28.6, lon: -57.3, height: 3000,
    });
    assert.match(root.children[4].textContent, /Coarse camera view shared/);
    assert.deepEqual(Object.keys(views[0].view).sort(), ['height', 'lat', 'lon']);
  } finally {
    dispose();
  }
});

test('Visit view fails closed after Scene teardown and still allows explicit retry', () => {
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [],
        listeners: new Map(), textContent: '', disabled: false,
        setAttribute() {},
        append(...nodes) { this.children.push(...nodes); },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      };
    },
  };
  const root = document.createElement('section');
  const packets = [];
  const flights = [];
  let channel;
  const services = {
    window: {
      location: { search: '' },
      BroadcastChannel: class {
        constructor() { channel = this; }
        postMessage(packet) { packets.push(packet); }
        close() {}
      },
      setInterval() { return 1; },
      clearInterval() {},
    },
    viewer: {
      isDestroyed: () => false,
      camera: { flyTo(options) { flights.push(options); } },
    },
    Cesium: {
      Cartesian3: {
        fromDegrees(lon, lat, height) { return { lon, lat, height }; },
      },
    },
  };
  const dispose = feature.mount({ root, services });
  try {
    const [join, leave] = root.children[3].children;
    join.listeners.get('click')();
    channel.onmessage({
      data: {
        protocol: ROOM_PROTOCOL, room: 'earth-lab', peer: 'peer-guest',
        sentAt: Date.now(), kind: 'view',
        view: { lat: 40.1, lon: -88.2, height: 10000 },
      },
    });
    const visit = root.children[5].children[0].children[1];
    assert.equal(visit.textContent, 'Visit view');
    assert.deepEqual(flights, [], 'receiving a view must not navigate');
    visit.listeners.get('click')();
    assert.deepEqual(flights, [{
      destination: { lon: -88.2, lat: 40.1, height: 10000 },
      duration: 2,
    }]);
    const validViewer = services.viewer;
    for (const invalidViewer of [
      null,
      { camera: null },
      { isDestroyed: () => true, camera: {
        flyTo() { throw new Error('must not navigate'); },
      } },
      { camera: { flyTo() { throw new Error('destroyed camera'); } } },
    ]) {
      services.viewer = invalidViewer;
      assert.doesNotThrow(() => visit.listeners.get('click')());
      assert.equal(flights.length, 1, 'unavailable camera cannot navigate');
      assert.match(root.children[4].textContent, /Scene camera unavailable/);
      assert.equal(leave.disabled, false, 'failed navigation cannot leave room');
    }
    services.viewer = validViewer;
    services.Cesium.Cartesian3.fromDegrees = () => {
      throw new Error('destroyed Cesium scene');
    };
    assert.doesNotThrow(() => visit.listeners.get('click')());
    assert.equal(flights.length, 1);
    services.Cesium.Cartesian3.fromDegrees = (lon, lat, height) => ({
      lon, lat, height,
    });
    visit.listeners.get('click')();
    assert.equal(flights.length, 2, 'valid explicit retry still navigates');
    assert.equal(packets.some((packet) => packet.kind === 'view'), false,
      'visiting a peer cannot transmit the local camera view');
  } finally {
    dispose();
  }
});

test('repeated peer heartbeats retain focused Visit view until the view changes', () => {
  const setConnected = (node, connected) => {
    node.isConnected = connected;
    for (const child of node.children) setConnected(child, connected);
  };
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], listeners: new Map(),
        textContent: '', isConnected: false,
        setAttribute() {},
        append(...nodes) {
          this.children.push(...nodes);
          for (const node of nodes) setConnected(node, true);
        },
        replaceChildren(...nodes) {
          for (const node of this.children) setConnected(node, false);
          this.children = nodes;
          for (const node of nodes) setConnected(node, true);
        },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
      };
    },
  };
  const root = document.createElement('section');
  let channel;
  const flights = [];
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: { search: '' },
        BroadcastChannel: class {
          constructor() { channel = this; }
          postMessage() {}
          close() {}
        },
        setInterval() { return 1; },
        clearInterval() {},
      },
      viewer: { camera: { flyTo(options) { flights.push(options); } } },
      Cesium: { Cartesian3: {
        fromDegrees(lon, lat, height) { return { lon, lat, height }; },
      } },
    },
  });
  try {
    root.children[3].children[0].listeners.get('click')();
    const peerRows = root.children[5];
    const coarse = { lat: 40.1, lon: -88.2, height: 10000 };
    const receive = (kind, view) => channel.onmessage({ data: {
      protocol: ROOM_PROTOCOL, room: 'earth-lab', peer: 'peer-guest',
      sentAt: Date.now(), kind, ...(view ? { view } : {}),
    } });
    receive('view', coarse);
    const visit = peerRows.children[0].children[1];
    assert.equal(visit.textContent, 'Visit view');
    assert.equal(visit.isConnected, true);
    for (const kind of ['hello', 'join']) {
      receive(kind);
      assert.strictEqual(peerRows.children[0].children[1], visit,
        'liveness must not replace the keyboard-focusable control');
      assert.equal(visit.isConnected, true);
    }
    receive('view', { ...coarse });
    assert.strictEqual(peerRows.children[0].children[1], visit,
      'identical view replay must not replace the control');
    receive('view', { ...coarse, height: 11000 });
    const updated = peerRows.children[0].children[1];
    assert.notStrictEqual(updated, visit, 'changed coarse view updates action');
    assert.equal(visit.isConnected, false);
    updated.listeners.get('click')();
    assert.deepEqual(flights, [{
      destination: { lon: -88.2, lat: 40.1, height: 11000 },
      duration: 2,
    }]);
    receive('leave');
    assert.equal(peerRows.children.length, 0);
  } finally {
    dispose();
  }
});

test('overlapping invite copies cannot restore an older scene link', async () => {
  let clipboard = '';
  const writes = [];
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
          href: 'https://example.org/view?token=private#lat=40.1&lon=-88.1&map=photoreal&access_token=scene-canary',
        },
        navigator: {
          clipboard: {
            writeText(value) {
              return new Promise((resolve, reject) => {
                writes.push({
                  value,
                  succeed() { clipboard = value; resolve(); },
                  fail() { reject(new Error('synthetic clipboard denial')); },
                });
              });
            },
          },
        },
      },
    },
  });
  try {
    const copy = root.children[3].children[3];
    const includeScene = root.children[3].children[4].children[0];
    const copyLink = () => copy.listeners.get('click')();
    includeScene.checked = true;
    const first = copyLink();
    const second = copyLink();
    await Promise.resolve();
    assert.equal(writes.length, 1, 'newer room-only copy must wait for old clipboard settlement');
    assert.equal(new URL(writes[0].value).hash, '#lat=40.1&lon=-88.1&map=photoreal');
    writes[0].succeed();
    await first;
    await Promise.resolve();
    assert.equal(writes.length, 2);
    assert.equal(new URL(writes[1].value).hash, '', 'second copy did not inherit scene consent');
    writes[1].succeed();
    await second;
    assert.equal(clipboard, writes[1].value, 'latest click must determine final clipboard value');
    assert.match(root.children[4].textContent, /^Room-only link copied/);
    assert.equal(includeScene.checked, false);

    // A denied earlier permission/write must not strand a later room-only copy.
    includeScene.checked = true;
    const failed = copyLink();
    const recovery = copyLink();
    await Promise.resolve();
    assert.equal(writes.length, 3);
    writes[2].fail();
    await failed;
    await Promise.resolve();
    assert.equal(writes.length, 4);
    assert.equal(new URL(writes[3].value).hash, '');
    writes[3].succeed();
    await recovery;
    assert.equal(clipboard, writes[3].value);
    assert.match(root.children[4].textContent, /^Room-only link copied/);

    // Disposing the feature cannot start remaining queued copies or update
    // a detached status after an already-in-flight clipboard call settles.
    includeScene.checked = true;
    const inFlight = copyLink();
    const abandoned = copyLink();
    await Promise.resolve();
    assert.equal(writes.length, 5);
    const lastNotice = root.children[4].textContent;
    dispose();
    writes[4].succeed();
    await inFlight;
    await abandoned;
    assert.equal(writes.length, 5, 'queued copy should be abandoned on teardown');
    assert.equal(root.children[4].textContent, lastNotice);
  } finally {
    dispose();
  }
});

test('unrelated local-room peer changes do not detach a focused Visit view', () => {
  const document = {
    activeElement: null,
    createElement(tag) {
      const node = {
        tagName: tag, ownerDocument: document, parentNode: null,
        children: [], listeners: new Map(), isConnected: false,
        textContent: '', disabled: false,
        setAttribute() {},
        append(...items) {
          for (const item of items) {
            item.parentNode = this;
            this.children.push(item);
            setConnected(item, this.isConnected);
          }
        },
        replaceChildren(...items) {
          for (const old of this.children) {
            old.parentNode = null;
            setConnected(old, false);
          }
          this.children = [...items];
          for (const item of items) {
            item.parentNode = this;
            setConnected(item, this.isConnected);
          }
        },
        replaceWith(next) {
          const parent = this.parentNode;
          assert.ok(parent, 'only mounted peer rows can be replaced');
          const position = parent.children.indexOf(this);
          assert.ok(position >= 0);
          parent.children[position] = next;
          this.parentNode = null;
          next.parentNode = parent;
          setConnected(this, false);
          setConnected(next, parent.isConnected);
        },
        remove() {
          if (!this.parentNode) return;
          const parent = this.parentNode;
          parent.children.splice(parent.children.indexOf(this), 1);
          this.parentNode = null;
          setConnected(this, false);
        },
        addEventListener(name, listener) { this.listeners.set(name, listener); },
        querySelector(selector) {
          return selector === 'button'
            ? this.children.find((item) => item.tagName === 'button') || null
            : null;
        },
        focus() { document.activeElement = this; },
      };
      return node;
    },
  };
  function setConnected(node, connected) {
    node.isConnected = connected;
    if (!connected && document.activeElement === node)
      document.activeElement = null;
    for (const child of node.children) setConnected(child, connected);
  }
  const root = document.createElement('section');
  root.isConnected = true;
  const flights = [];
  let channel;
  const dispose = feature.mount({
    root,
    services: {
      window: {
        location: { search: '' },
        BroadcastChannel: class {
          constructor() { channel = this; }
          postMessage() {}
          close() {}
        },
        setInterval() { return 1; },
        clearInterval() {},
      },
      viewer: { camera: { flyTo(options) { flights.push(options); } } },
      Cesium: {
        Cartesian3: {
          fromDegrees(lon, lat, height) { return { lon, lat, height }; },
        },
      },
    },
  });
  try {
    root.children[3].children[0].listeners.get('click')();
    const rows = root.children[5];
    const receive = (peer, kind, view) => channel.onmessage({
      data: {
        protocol: ROOM_PROTOCOL, room: 'earth-lab', peer,
        sentAt: Date.now(), kind, ...(view ? { view } : {}),
      },
    });
    const first = { lat: 40.1, lon: -88.2, height: 10000 };
    receive('peer-alpha', 'view', first);
    const visit = rows.children[0].children[1];
    visit.focus();
    assert.strictEqual(document.activeElement, visit);
    for (const [kind, view] of [
      ['join', undefined],
      ['view', { lat: 40.2, lon: -87.2, height: 9000 }],
      ['view', { lat: 40.3, lon: -87.2, height: 9000 }],
      ['leave', undefined],
    ]) {
      receive('peer-bravo', kind, view);
      assert.strictEqual(rows.children[0].children[1], visit,
        'unrelated peer changes must keep the original Visit control');
      assert.strictEqual(document.activeElement, visit,
        'unrelated peer changes must preserve keyboard focus');
      assert.equal(visit.isConnected, true);
    }
    assert.equal(rows.children.length, 1);
    receive('peer-alpha', 'hello');
    assert.strictEqual(rows.children[0].children[1], visit);
    visit.listeners.get('click')();
    assert.deepEqual(flights, [{
      destination: { lon: -88.2, lat: 40.1, height: 10000 },
      duration: 2,
    }]);
    receive('peer-alpha', 'view', { ...first, height: 11000 });
    assert.equal(visit.isConnected, false,
      'changing this peer view must replace its own action');
    const updated = rows.children[0].children[1];
    assert.notStrictEqual(updated, visit);
    assert.strictEqual(document.activeElement, updated,
      'a new view from the focused peer must transfer focus to its new Visit button');
    updated.listeners.get('click')();
    assert.deepEqual(flights[1], {
      destination: { lon: -88.2, lat: 40.1, height: 11000 },
      duration: 2,
    });
    // A later peer update must not steal focus from another UI control.
    const join = root.children[3].children[0];
    join.focus();
    receive('peer-alpha', 'view', { ...first, height: 12000 });
    assert.strictEqual(document.activeElement, join,
      'background peer view update must not steal unrelated keyboard focus');
    assert.equal(rows.children[0].children[1].isConnected, true);
    receive('peer-alpha', 'leave');
    assert.strictEqual(document.activeElement, join,
      'peer leave must not steal keyboard focus from other controls');
  } finally {
    dispose();
  }
});
