import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoomOperation,
  mergeRoomOperations,
  projectRoom,
  roomDigest,
  serializeRoom,
  parseRoom,
  validateRoomOperation,
} from './cityRoom.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const reference = {
  camera: { lat: 0, lon: 0, alt: 1000, heading: 0, pitch: -90, roll: 0 },
  bounds: [-1, -1, 1, 1],
  sources: [],
  capturedAt: '2026-11-12T12:00:00.000Z',
  image,
};
const ROOM = 'elm-street';
const ana = { actorId: 'p-ana0000001', name: 'Ana' };
const ben = { actorId: 'p-ben0000001', name: 'Ben' };
const cy = { actorId: 'p-cy00000001', name: 'Cy' };
const park = {
  title: 'Pocket park',
  description: 'Shade trees and seating.',
  parameters: { kind: 'park', trees: 20, widthMeters: 3, shadePercent: 60 },
};
const lane = {
  title: 'Protected bike lane',
  description: 'Raised separators and crossings.',
  parameters: {
    kind: 'bike-lane',
    trees: 8,
    widthMeters: 2.5,
    shadePercent: 30,
  },
};

// Each author appends to the log they currently know, like a replica would.
function add(log, who, type, payload) {
  const op = createRoomOperation(log, { ...who, room: ROOM }, type, payload);
  return mergeRoomOperations(log, [op]).ops;
}
function genesis() {
  return add([], ana, 'genesis', {
    project: { id: 'city-elm', title: 'Elm street' },
    reference,
  });
}
const altOf = (room, title) =>
  room.alternatives.find((a) =>
    a.versions.some((version) => version.title === title),
  );
const head = (alternative) =>
  alternative.versions.find((v) => v.id === alternative.heads[0]);
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

test('owner proposal carries author credit and stays hypothetical over a reference-only baseline', () => {
  const log = add(genesis(), ana, 'propose', park);
  const room = projectRoom(log);
  assert.equal(room.status, 'ready');
  assert.equal(room.owner.actorId, ana.actorId);
  assert.deepEqual(room.reference, reference);
  assert.equal(room.project.baseline.state, 'reference-only');
  assert.equal(room.alternatives.length, 1);
  const version = head(room.alternatives[0]);
  assert.equal(version.author.name, 'Ana');
  assert.equal(version.author.actorId, ana.actorId);
  assert.deepEqual(version.parameters, park.parameters);
  assert.equal(version.state, 'hypothesis');
  assert.equal(version.modeledImpact, 'not-evaluated');
  assert.equal(version.approval, 'not-requested');
  assert.deepEqual(room.rejected, []);
});

test('a viewer cannot write: the attempt is rejected, listed and never applied', () => {
  let log = genesis();
  log = add(log, ben, 'propose', lane);
  const room = projectRoom(log, { self: ben.actorId });
  assert.equal(room.alternatives.length, 0);
  assert.equal(room.rejected.length, 1);
  assert.equal(room.rejected[0].reason, 'viewer');
  assert.equal(room.rejected[0].author.name, 'Ben');
  assert.equal(room.self.role, 'viewer');
  assert.equal(room.self.canWrite, false);
});

test('a granted contributor proposes and comments with credit visible to every replica', () => {
  let log = add(genesis(), ana, 'propose', park);
  log = add(log, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ben, 'propose', lane);
  const parkVersion = head(altOf(projectRoom(log), 'Pocket park'));
  log = add(log, ben, 'comment', {
    versionId: parkVersion.id,
    body: 'Add a drinking fountain.',
  });
  const room = projectRoom(log, { self: ben.actorId });
  assert.equal(room.self.role, 'contributor');
  assert.equal(room.self.canWrite, true);
  assert.equal(head(altOf(room, 'Protected bike lane')).author.name, 'Ben');
  const comments = head(altOf(room, 'Pocket park')).comments;
  assert.deepEqual(
    comments.map((c) => [c.author.name, c.body]),
    [['Ben', 'Add a drinking fountain.']],
  );
  assert.deepEqual(
    room.members.map((m) => [m.name, m.role]),
    [
      ['Ana', 'owner'],
      ['Ben', 'contributor'],
    ],
  );
});

test('revocation rejects every later write of an offline contributor, in any arrival order', () => {
  let shared = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  shared = add(shared, ben, 'propose', lane); // seen by Ana before revoking
  // Ben goes offline; Ana revokes; Ben (unaware) keeps editing.
  const anaLog = add(shared, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'revoked',
  });
  const laneVersion = head(altOf(projectRoom(shared), 'Protected bike lane'));
  let benLog = add(shared, ben, 'revise', {
    alternativeId: altOf(projectRoom(shared), 'Protected bike lane').id,
    parents: [laneVersion.id],
    ...lane,
    title: 'Lane after revocation',
  });
  benLog = add(benLog, ben, 'propose', { ...park, title: 'Late park' });
  assert.equal(
    projectRoom(benLog, { self: ben.actorId }).self.canWrite,
    true,
    'offline replica does not know about the revocation yet',
  );
  const late = benLog.filter((op) => !shared.some((s) => s.id === op.id));
  const digests = new Set();
  for (const order of permutations([...late, anaLog.at(-1)])) {
    const merged = mergeRoomOperations(shared, order).ops;
    const room = projectRoom(merged);
    digests.add(roomDigest(room));
    assert.deepEqual(
      room.rejected.map((r) => [r.author.name, r.reason]),
      [
        ['Ben', 'revoked'],
        ['Ben', 'revoked'],
      ],
    );
    assert.equal(
      head(altOf(room, 'Protected bike lane')).title,
      'Protected bike lane',
    );
    assert.equal(altOf(room, 'Late park'), undefined);
  }
  assert.equal(digests.size, 1);
  const merged = projectRoom(mergeRoomOperations(benLog, anaLog).ops, {
    self: ben.actorId,
  });
  assert.equal(merged.self.role, 'revoked');
  assert.equal(merged.self.canWrite, false);
});

test('concurrent edits from one revision become a visible conflict and are never merged', () => {
  let base = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  base = add(base, ana, 'propose', park);
  const alt = projectRoom(base).alternatives[0];
  const parent = alt.heads[0];
  const anaEdit = add(base, ana, 'revise', {
    alternativeId: alt.id,
    parents: [parent],
    ...park,
    title: 'Park with fountain',
  });
  const benEdit = add(base, ben, 'revise', {
    alternativeId: alt.id,
    parents: [parent],
    ...park,
    title: 'Park with play area',
    parameters: { ...park.parameters, trees: 35 },
  });
  const merged = mergeRoomOperations(anaEdit, benEdit).ops;
  const room = projectRoom(merged);
  const conflicted = room.alternatives[0];
  assert.equal(conflicted.conflict, true);
  assert.equal(conflicted.heads.length, 2);
  const heads = conflicted.versions.filter((v) =>
    conflicted.heads.includes(v.id),
  );
  assert.deepEqual(heads.map((v) => [v.author.name, v.title]).sort(), [
    ['Ana', 'Park with fountain'],
    ['Ben', 'Park with play area'],
  ]);
  assert.equal(heads.find((v) => v.author.name === 'Ben').parameters.trees, 35);
  assert.equal(heads.find((v) => v.author.name === 'Ana').parameters.trees, 20);
  // An explicit decision names every head as a parent and clears the conflict.
  const kept = heads.find((v) => v.author.name === 'Ben');
  const resolved = add(merged, ana, 'revise', {
    alternativeId: conflicted.id,
    parents: conflicted.heads,
    title: kept.title,
    description: kept.description,
    parameters: kept.parameters,
  });
  const after = projectRoom(resolved).alternatives[0];
  assert.equal(after.conflict, false);
  assert.equal(head(after).title, 'Park with play area');
  assert.equal(head(after).author.name, 'Ana');
  assert.deepEqual(
    [...head(after).parents].sort(),
    [...conflicted.heads].sort(),
  );
});

test('branching from a peer version credits the source author and revision', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ana, 'propose', park);
  const source = head(projectRoom(log).alternatives[0]);
  log = add(log, ben, 'propose', {
    ...park,
    title: 'Park and plaza',
    parameters: { ...park.parameters, kind: 'plaza' },
    branchedFrom: source.id,
  });
  const branch = altOf(projectRoom(log), 'Park and plaza');
  assert.equal(branch.createdBy.name, 'Ben');
  assert.equal(branch.branchedFrom.versionId, source.id);
  assert.equal(branch.branchedFrom.author.name, 'Ana');
  assert.equal(branch.branchedFrom.title, 'Pocket park');
  assert.equal(branch.branchedFrom.number, 1);
  assert.equal(projectRoom(log).alternatives.length, 2);
});

test('replicas converge under every delivery order and duplicates; replay is identical', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ana, 'propose', park);
  log = add(log, ben, 'propose', lane);
  const parkId = altOf(projectRoom(log), 'Pocket park').versions[0].id;
  log = add(log, ben, 'comment', { versionId: parkId, body: 'Love it.' });
  log = add(log, ana, 'comment', { versionId: parkId, body: 'Thanks!' });
  const expected = roomDigest(projectRoom(log));
  const [first, ...rest] = log;
  for (const order of permutations(rest)) {
    const delivered = mergeRoomOperations(
      mergeRoomOperations([first], order).ops,
      [...order].reverse(),
    );
    assert.equal(delivered.added, 0, 'duplicate delivery adds nothing');
    assert.equal(roomDigest(projectRoom(delivered.ops)), expected);
  }
  const replayed = parseRoom(serializeRoom(log));
  assert.equal(roomDigest(projectRoom(replayed)), expected);
  assert.deepEqual(projectRoom(replayed).reference, reference);
});

test('ops after a missing earlier op from the same author wait instead of applying', () => {
  let log = add(genesis(), ana, 'propose', park);
  log = add(log, ana, 'propose', lane);
  const withoutSecond = log.filter((op) => op.seq !== 2);
  const waiting = projectRoom(withoutSecond);
  assert.equal(waiting.alternatives.length, 0);
  assert.deepEqual(
    waiting.pending.map((p) => p.id),
    [log.find((op) => op.seq === 3).id],
  );
  assert.equal(projectRoom(log).alternatives.length, 2);
});

test('unknown and rejected references fail closed', () => {
  let log = add(genesis(), ana, 'propose', park);
  const alt = projectRoom(log).alternatives[0];
  log = add(log, ana, 'revise', {
    alternativeId: alt.id,
    parents: ['p-zzz0000001-9'],
    ...park,
  });
  log = add(log, ana, 'comment', {
    versionId: 'p-zzz0000001-9',
    body: 'Where is this?',
  });
  // A viewer's rejected proposal cannot become the parent of anything.
  log = add(log, ben, 'propose', lane);
  const rejectedId = log.at(-1).id;
  log = add(log, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ana, 'revise', {
    alternativeId: `alt-${rejectedId}`,
    parents: [rejectedId],
    ...lane,
  });
  const room = projectRoom(log);
  assert.deepEqual(
    room.rejected.map((r) => r.reason),
    ['unknown-parent', 'unknown-version', 'viewer', 'parent-rejected'],
  );
  assert.equal(room.alternatives[0].versions.length, 1);
});

test('only the owner assigns roles and a stale role revision is rejected by the authority kernel', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ben, 'role', {
    member: cy.actorId,
    memberName: 'Cy',
    role: 'contributor',
  });
  const stale = validateRoomOperation({
    id: `${ana.actorId}-3`,
    room: ROOM,
    actorId: ana.actorId,
    authorName: 'Ana',
    seq: 3,
    clock: 4,
    type: 'role',
    member: ben.actorId,
    memberName: 'Ben',
    role: 'viewer',
    throughSeq: 1,
    baseRevision: 0,
    nextRevision: 1,
  });
  log = mergeRoomOperations(log, [stale]).ops;
  const room = projectRoom(log);
  assert.deepEqual(
    room.rejected.map((r) => [r.author.name, r.reason]),
    [
      ['Ben', 'not-owner'],
      ['Ana', 'base-revision-mismatch'],
    ],
  );
  assert.equal(room.members.find((m) => m.name === 'Ben').role, 'contributor');
  assert.equal(
    room.members.find((m) => m.actorId === cy.actorId),
    undefined,
  );
});

test('export and import keep every attribution; malformed or location-bearing rooms fail whole', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ana, 'propose', park);
  const source = projectRoom(log).alternatives[0].versions[0];
  log = add(log, ben, 'propose', { ...lane, branchedFrom: source.id });
  log = add(log, ben, 'comment', { versionId: source.id, body: 'Nice.' });
  const json = serializeRoom(log);
  const doc = JSON.parse(json);
  assert.equal(doc.kind, 'city-room');
  assert.equal(doc.schemaVersion, 1);
  const imported = projectRoom(parseRoom(json));
  assert.deepEqual(imported, projectRoom(log));
  assert.equal(imported.alternatives[1].branchedFrom.author.name, 'Ana');
  assert.equal(imported.alternatives[1].createdBy.name, 'Ben');
  const withLocation = structuredClone(doc);
  withLocation.ops[2].lat = 37.8;
  const otherRoom = structuredClone(doc);
  otherRoom.ops[1].room = 'other-room';
  const forgedId = structuredClone(doc);
  forgedId.ops[1].id = `${ben.actorId}-1`;
  const secondGenesis = structuredClone(doc);
  secondGenesis.ops.push({ ...doc.ops[0], id: `${ana.actorId}-9`, seq: 9 });
  for (const broken of [withLocation, otherRoom, forgedId, secondGenesis])
    assert.throws(() => parseRoom(JSON.stringify(broken)), TypeError);
  assert.throws(() => parseRoom('{"kind":'), SyntaxError);
});

test('no later operation can rewrite the observed reference', () => {
  const log = genesis();
  assert.throws(
    () =>
      createRoomOperation(log, { ...ana, room: ROOM }, 'genesis', {
        project: { id: 'city-elm', title: 'Elm street' },
        reference: { ...reference, capturedAt: '2026-11-12T13:00:00.000Z' },
      }),
    TypeError,
  );
  assert.throws(() =>
    validateRoomOperation({
      id: `${ana.actorId}-2`,
      room: ROOM,
      actorId: ana.actorId,
      authorName: 'Ana',
      seq: 2,
      clock: 2,
      type: 'propose',
      ...park,
      branchedFrom: null,
      reference,
    }),
  );
  const forged = add(log, ben, 'genesis', {
    project: { id: 'city-other', title: 'Other' },
    reference: { ...reference, capturedAt: '2026-11-12T13:00:00.000Z' },
  });
  const room = projectRoom(forged);
  assert.deepEqual(room.reference, reference);
  assert.equal(room.rejected[0].reason, 'duplicate-genesis');
});

test('alternative and version limits reject deterministically', () => {
  let log = genesis();
  for (let i = 0; i < 7; i++)
    log = add(log, ana, 'propose', { ...park, title: `Park ${i + 1}` });
  const room = projectRoom(log);
  assert.equal(room.alternatives.length, 6);
  assert.deepEqual(
    room.rejected.map((r) => r.reason),
    ['limit'],
  );
});

test('a revocation only covers the contiguous operations the owner actually received', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  let benLog = add(log, ben, 'propose', lane); // ben-1
  benLog = add(benLog, ben, 'propose', park); // ben-2, delayed
  benLog = add(benLog, ben, 'propose', { ...park, title: 'Third' }); // ben-3
  const delayed = benLog.find((op) => op.id === `${ben.actorId}-2`);
  // Ana holds ben-1 and ben-3 but not ben-2 when she revokes.
  log = mergeRoomOperations(
    log,
    benLog.filter((op) => op !== delayed),
  ).ops;
  log = add(log, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'revoked',
  });
  assert.equal(
    log.find((op) => op.type === 'role' && op.role === 'revoked').throughSeq,
    1,
  );
  const room = projectRoom(mergeRoomOperations(log, [delayed]).ops);
  assert.deepEqual(
    room.rejected.map((r) => [r.id, r.reason]),
    [
      [`${ben.actorId}-2`, 'revoked'],
      [`${ben.actorId}-3`, 'revoked'],
    ],
  );
});

test('member writes wait, never flash as rejected, while an owner role change is missing', () => {
  let log = add(genesis(), ana, 'propose', park); // ana-2, will be delayed
  log = add(log, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  }); // ana-3
  log = add(log, ben, 'propose', lane);
  const delayed = log.find((op) => op.id === `${ana.actorId}-2`);
  const partial = projectRoom(log.filter((op) => op !== delayed));
  assert.deepEqual(partial.rejected, []);
  assert.deepEqual(
    partial.pending.map((p) => p.author.name),
    ['Ana', 'Ben'],
  );
  assert.ok(partial.pending.every((p) => p.reason.startsWith('waiting-for-')));
  // A member write that does not depend on the missing owner change still waits.
  const filler = add(log.slice(0, 1), cy, 'propose', park); // cy-1, a viewer write
  const widened = mergeRoomOperations(
    log.filter((op) => op !== delayed),
    filler.slice(1),
  ).ops;
  assert.ok(
    projectRoom(widened).pending.some(
      (p) => p.author.name === 'Cy' && p.reason === 'waiting-for-owner',
    ),
  );
  const full = projectRoom(log);
  assert.deepEqual(full.pending, []);
  assert.equal(full.alternatives.length, 2);
});

test('keeping a peer revision credits its writer and the decision separately', () => {
  let base = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  base = add(base, ana, 'propose', park);
  const alt = projectRoom(base).alternatives[0];
  const merged = mergeRoomOperations(
    add(base, ana, 'revise', {
      alternativeId: alt.id,
      parents: alt.heads,
      ...park,
      title: 'Ana edit',
    }),
    add(base, ben, 'revise', {
      alternativeId: alt.id,
      parents: alt.heads,
      ...park,
      title: 'Ben edit',
    }),
  ).ops;
  const conflicted = projectRoom(merged).alternatives[0];
  const bens = conflicted.versions.find((v) => v.title === 'Ben edit');
  const resolved = projectRoom(
    add(merged, ana, 'revise', {
      alternativeId: alt.id,
      parents: conflicted.heads,
      title: bens.title,
      description: bens.description,
      parameters: bens.parameters,
    }),
  ).alternatives[0];
  const decision = head(resolved);
  assert.equal(decision.author.name, 'Ana');
  assert.equal(decision.kept.versionId, bens.id);
  assert.equal(decision.kept.author.name, 'Ben');
});

test('a late revocation does not erase other contributors work built on the revoked revision', () => {
  let log = add(genesis(), ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'contributor',
  });
  log = add(log, ana, 'role', {
    member: cy.actorId,
    memberName: 'Cy',
    role: 'contributor',
  });
  log = add(log, ana, 'propose', park);
  const alt = projectRoom(log).alternatives[0];
  // Ben's revision reaches Cy but not Ana before Ana revokes Ben.
  const anaView = add(log, ana, 'role', {
    member: ben.actorId,
    memberName: 'Ben',
    role: 'revoked',
  });
  let cyView = add(log, ben, 'revise', {
    alternativeId: alt.id,
    parents: alt.heads,
    ...park,
    title: 'Ben revision',
  });
  const bensId = cyView.at(-1).id;
  cyView = add(cyView, cy, 'propose', {
    ...park,
    title: 'Cy branch',
    branchedFrom: bensId,
  });
  cyView = add(cyView, cy, 'revise', {
    alternativeId: alt.id,
    parents: [alt.heads[0], bensId],
    ...park,
    title: 'Cy merge',
  });
  const room = projectRoom(mergeRoomOperations(anaView, cyView).ops);
  assert.deepEqual(
    room.rejected.map((r) => [r.author.name, r.reason]),
    [['Ben', 'revoked']],
  );
  const branch = altOf(room, 'Cy branch');
  assert.equal(branch.branchedFrom.available, false);
  const parkAlt = altOf(room, 'Cy merge');
  assert.deepEqual(head(parkAlt).parents, [alt.heads[0]]);
  assert.equal(parkAlt.conflict, false);
});

test('a forged huge clock cannot freeze the room for honest writers', () => {
  let log = add(genesis(), ana, 'propose', park);
  const forged = validateRoomOperation({
    id: 'p-eve0000001-1',
    room: ROOM,
    actorId: 'p-eve0000001',
    authorName: 'Eve',
    seq: 1,
    clock: 999_999_999,
    type: 'comment',
    versionId: log.at(-1).id,
    body: 'freeze',
  });
  log = mergeRoomOperations(log, [forged]).ops;
  log = add(log, ana, 'propose', lane);
  const honest = log.find((op) => op.actorId === ana.actorId && op.seq === 3);
  assert.ok(honest.clock <= log.length, 'honest clocks stay bounded');
  const room = projectRoom(log);
  assert.equal(room.alternatives.length, 2);
  assert.ok(room.pending.some((p) => p.id === forged.id));
});

test('merge reports a canonical replacement and refuses operations from another room', () => {
  const log = add(genesis(), ana, 'propose', park);
  const other = createRoomOperation(
    log.slice(0, 1),
    { ...ana, room: ROOM },
    'propose',
    lane,
  );
  const [high, low] = [log[1], other].sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? 1 : -1,
  );
  const replaced = mergeRoomOperations([log[0], high], [low]);
  assert.equal(replaced.changed, 1, 'replacement counts as a change');
  assert.deepEqual(replaced.ops[1], low);
  const foreign = add([], { ...ana, actorId: 'p-zed0000001' }, 'genesis', {
    project: { id: 'city-elm', title: 'Elm street' },
    reference,
  }).map((op) => ({ ...op, room: 'other-room' }));
  const merged = mergeRoomOperations(log, foreign, { room: ROOM });
  assert.equal(merged.invalid, 1);
  assert.equal(merged.ops.length, log.length);
});
