import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityRoomSession } from './cityRoom.js';
import { openLocalRoom } from '../data/localRoom.js';
import {
  addCityAlternative,
  createCityDocument,
} from '../data/cityPlanningDocument.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const reference = {
  camera: { lat: 0, lon: 0, alt: 1000, heading: 0, pitch: -90, roll: 0 },
  bounds: [-1, -1, 1, 1],
  sources: [],
  capturedAt: '2026-11-12T12:00:00.000Z',
  image,
};
const park = {
  title: 'Pocket park',
  description: 'Shade trees and seating.',
  parameters: { kind: 'park', trees: 20, widthMeters: 3, shadePercent: 60 },
};
function localDocument() {
  return addCityAlternative(
    createCityDocument({ id: 'city-elm', title: 'Elm street', reference }),
    { id: 'world-1', ...park },
  );
}

/** In-memory BroadcastChannel with structured-clone delivery between tabs. */
function browser() {
  const channels = new Set();
  const sent = [];
  class Channel {
    constructor(name) {
      this.name = name;
      channels.add(this);
    }
    postMessage(data) {
      sent.push(structuredClone(data));
      for (const other of [...channels])
        if (other !== this && other.name === this.name)
          other.onmessage?.({ data: structuredClone(data) });
    }
    close() {
      channels.delete(this);
    }
  }
  const held = new Set();
  return { Channel, sent, held };
}
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}
const timers = {
  setInterval: () => 1,
  clearInterval() {},
  setTimeout: () => 1,
  clearTimeout() {},
};
let ids = 0;
function tab(env, storage = memoryStorage()) {
  let downloaded = null;
  const session = createCityRoomSession({
    storage,
    openRoom: (options) =>
      openLocalRoom({ ...options, BroadcastChannel: env.Channel, timers }),
    claimIdentity: async (actorId) => {
      if (env.held.has(actorId)) return null;
      env.held.add(actorId);
      return { release: () => env.held.delete(actorId) };
    },
    randomId: () => `p-tab${String(++ids).padStart(7, '0')}`,
    download: (text, name) => {
      downloaded = { text, name };
    },
    changed() {},
    timers,
  });
  return {
    session,
    storage,
    c: session.controls,
    get v() {
      return session.view({ canShare: true });
    },
    get downloaded() {
      return downloaded;
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function enter(t, name, room, document) {
  t.c.editDraft('name', name);
  t.c.editDraft('room', room);
  if (document) t.c.share(document);
  else t.c.join();
  await settle();
}
function propose(t, values) {
  t.c.newProposal();
  t.c.editField('title', values.title);
  t.c.editField('description', values.description);
  for (const [key, value] of Object.entries(values.parameters))
    t.c.editField(key, value);
  t.c.save();
}
const altByTitle = (view, title) =>
  view.alternatives.find((a) => a.versions.some((v) => v.title === title));

test('two tabs: join, roles, proposals, comments, branch, conflict, revoke, reconnect and export', async () => {
  const env = browser();
  const doc = localDocument();
  const before = structuredClone(doc);
  const ana = tab(env);
  const ben = tab(env);
  await enter(ana, 'Ana', 'elm-street', doc);
  assert.equal(ana.v.self.role, 'owner');
  assert.equal(ana.v.alternatives.length, 1, 'local proposal seeded');
  assert.deepEqual(doc, before, 'sharing never edits the local project');

  await enter(ben, 'Ben', 'elm-street');
  assert.equal(ben.v.ready, true, 'the joining tab received the room');
  assert.deepEqual(ben.v.reference, reference);
  assert.match(ben.v.alternatives[0].createdBy, /^Proposed by Ana · /);
  assert.equal(ben.v.self.role, 'viewer');
  assert.equal(ben.v.self.canWrite, false);
  propose(ben, { ...park, title: 'Viewer attempt' });
  assert.match(ben.v.error, /role cannot make this change/);
  assert.equal(ben.v.alternatives.length, 1, 'a viewer writes nothing');

  const benId = ben.v.self.actorId;
  const benRow = ana.v.members.find((m) => m.actorId === benId);
  assert.equal(benRow.presence, 'online');
  assert.deepEqual(benRow.roles, ['contributor', 'revoked']);
  ana.c.setRole(benId, 'contributor');
  assert.equal(ben.v.self.role, 'contributor');
  propose(ben, {
    title: 'Protected bike lane',
    description: 'Raised separators.',
    parameters: {
      kind: 'bike-lane',
      trees: 8,
      widthMeters: 2.5,
      shadePercent: 30,
    },
  });
  assert.match(
    altByTitle(ana.v, 'Protected bike lane').createdBy,
    /^Proposed by Ben · /,
  );
  const anaPark = ana.v.alternatives[0].heads[0];
  assert.equal(ben.c.comment(anaPark.id, 'Add a drinking fountain.'), true);
  assert.deepEqual(
    ana.v.alternatives[0].heads[0].comments.map((c) => c.body),
    ['Add a drinking fountain.'],
  );
  ben.c.inspect(ana.v.alternatives[0].id);
  assert.equal(
    ana.v.members.find((m) => m.actorId === benId).presence,
    'online · viewing Pocket park',
  );

  ben.c.branch(anaPark.id);
  ben.c.editField('title', 'Park and plaza');
  ben.c.editField('kind', 'plaza');
  ben.c.save();
  assert.match(
    altByTitle(ana.v, 'Park and plaza').branchedFrom,
    /^Branched from Ana · .*“Pocket park” revision 1$/,
  );

  // Conflict: Ben edits offline while Ana edits the same revision.
  ben.c.leave();
  ana.c.edit(anaPark.id);
  ana.c.editField('title', 'Park with fountain');
  ana.c.save();
  ben.c.edit(anaPark.id);
  ben.c.editField('title', 'Park with play area');
  ben.c.save();
  ben.c.reconnect();
  await settle();
  for (const view of [ana.v, ben.v]) {
    const parkAlt = view.alternatives[0];
    assert.equal(parkAlt.conflict, true);
    assert.match(parkAlt.conflictText, /Nothing was merged/);
    assert.deepEqual(parkAlt.heads.map((h) => h.title).sort(), [
      'Park with fountain',
      'Park with play area',
    ]);
  }
  assert.equal(ana.v.digest, ben.v.digest, 'replicas converge');
  const bens = ana.v.alternatives[0].heads.find(
    (h) => h.title === 'Park with play area',
  );
  assert.equal(bens.canKeep, true);
  ana.c.keep(ana.v.alternatives[0].id, bens.id);
  assert.equal(ben.v.alternatives[0].conflict, false);
  assert.match(
    ben.v.alternatives[0].heads[0].credit,
    /^Written by Ben · .*, kept by Ana · /,
  );

  // Revocation while Ben is offline rejects his later write everywhere.
  ben.c.leave();
  ana.c.setRole(benId, 'revoked');
  assert.equal(ben.v.self.canWrite, true, 'offline replica cannot know yet');
  propose(ben, { ...park, title: 'Late proposal' });
  ben.c.reconnect();
  await settle();
  for (const view of [ana.v, ben.v]) {
    assert.equal(altByTitle(view, 'Late proposal'), undefined);
    assert.match(
      view.rejected.at(-1).text,
      /^Rejected: Ben · .*“Late proposal” — contributor access was revoked$/,
    );
  }
  assert.equal(ben.v.self.role, 'revoked');
  assert.equal(ben.v.self.canWrite, false);
  assert.equal(ana.v.digest, ben.v.digest);

  // Reload: a new session from the same tab storage replays the identical room.
  const digest = ben.v.digest;
  ben.session.controls.destroy();
  const reloaded = tab(env, ben.storage);
  assert.equal(reloaded.v.saved, true);
  assert.equal(reloaded.v.digest, digest, 'replay before reconnect');
  reloaded.c.reconnect();
  await settle();
  assert.equal(reloaded.v.connected, true);
  assert.equal(reloaded.v.self.actorId, benId);
  assert.equal(reloaded.v.digest, digest);
  assert.equal(reloaded.v.digest, ana.v.digest);
  assert.deepEqual(
    reloaded.v.reference,
    reference,
    'observed reference untouched',
  );

  // Export, then import into a fresh tab: a read-only archive with credits intact.
  ana.c.exportRoom();
  assert.equal(ana.downloaded.name, 'elm-street-room.json');
  const visitor = tab(browser());
  await visitor.c.importRoom({
    size: ana.downloaded.text.length,
    text: async () => ana.downloaded.text,
  });
  assert.equal(visitor.v.archive, true);
  assert.equal(visitor.v.connected, false);
  assert.equal(visitor.v.self.canWrite, false);
  assert.equal(visitor.v.digest, ana.v.digest);
  assert.match(altByTitle(visitor.v, 'Park and plaza').createdBy, /Ben · /);

  // Nothing location-like ever crossed the channel outside the genesis reference.
  for (const sent of env.sent) {
    const { ops, ...envelope } = sent;
    assert.doesNotMatch(
      JSON.stringify(envelope),
      /"(lat|lon|camera|alt|bounds|position|view)"/,
    );
    for (const op of ops ?? [])
      if (op.type !== 'genesis')
        assert.doesNotMatch(JSON.stringify(op), /"(lat|lon|camera|bounds)"/);
  }
});

test('a duplicated tab never reuses a held identity', async () => {
  const env = browser();
  const ana = tab(env);
  await enter(ana, 'Ana', 'elm-street', localDocument());
  const copy = tab(env, memoryStorage({ ...ana.storage.data }));
  copy.c.reconnect();
  await settle();
  assert.notEqual(copy.v.self.actorId, ana.v.self.actorId);
  assert.match(copy.v.status, /joined as a new participant/);
  assert.equal(ana.v.connected, true);
  assert.equal(copy.v.self.role, 'viewer');
});

test('an invalid room file changes nothing; joining an absent room says so honestly', async () => {
  const env = browser();
  const lone = tab(env);
  let fire = null;
  const waiting = createCityRoomSession({
    storage: memoryStorage(),
    openRoom: (options) =>
      openLocalRoom({ ...options, BroadcastChannel: env.Channel, timers }),
    randomId: () => 'p-lonely00001',
    download() {},
    changed() {},
    timers: { ...timers, setTimeout: (fn) => ((fire = fn), 7) },
  });
  waiting.controls.editDraft('name', 'Dee');
  waiting.controls.editDraft('room', 'nobody-here');
  waiting.controls.join();
  await settle();
  assert.match(waiting.view().status, /Looking for this room/);
  fire();
  assert.match(waiting.view().status, /No room found/);
  await lone.c.importRoom({ size: 9, text: async () => '{"kind":' });
  assert.match(lone.v.error, /Invalid room file/);
  assert.equal(lone.v.active, false);
});
