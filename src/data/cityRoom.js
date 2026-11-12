import {
  applyCollaborationOperation,
  createCollaborationState,
} from './collaborationAuthority.js';
import {
  createPlanningAlternativeOperation,
  listPlanningAlternatives,
} from './communityPlanning.js';
import {
  createCityDocument,
  validateCityEdit,
} from './cityPlanningDocument.js';
import { displayName, normalizeRoomCode } from './localRoom.js';

/**
 * A City builder room is a set of immutable typed operations. Everything a
 * participant sees is `projectRoom(ops)`, a pure function of that set, so two
 * replicas holding the same operations show the same room, and reconnecting or
 * replaying an export reproduces it exactly. Content enters through the
 * existing collaboration authority and planning kernels; this module adds the
 * room's membership rules, revision graph and visible conflicts.
 */
export const CITY_ROOM_SCHEMA_VERSION = 1;
export const CITY_ROOM_LIMITS = Object.freeze({
  alternatives: 6,
  versions: 20,
  comments: 200,
  ops: 2000,
});
export const CITY_ROOM_ROLES = Object.freeze([
  'contributor',
  'viewer',
  'revoked',
]);

const ACTOR = /^p-[a-z0-9]{6,16}$/;
const VERSION = /^p-[a-z0-9]{6,16}-[1-9][0-9]{0,5}$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const ENVELOPE = [
  'id',
  'room',
  'actorId',
  'authorName',
  'seq',
  'clock',
  'type',
];
const PAYLOAD = Object.freeze({
  genesis: ['project', 'reference'],
  role: [
    'member',
    'memberName',
    'role',
    'throughSeq',
    'baseRevision',
    'nextRevision',
  ],
  propose: ['title', 'description', 'parameters', 'branchedFrom'],
  revise: ['alternativeId', 'parents', 'title', 'description', 'parameters'],
  comment: ['versionId', 'body'],
});

function fail(message) {
  throw new TypeError(message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('object required');
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    fail(`expected exact keys: ${expected.join(', ')}`);
}

function count(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`invalid ${label}`);
  return value;
}

function versionId(value) {
  if (typeof value !== 'string' || !VERSION.test(value))
    fail('invalid version id');
  return value;
}

function name(value) {
  const result = displayName(value);
  if (!result) fail('display name must be 1 to 40 plain characters');
  return result;
}

function body(value) {
  if (typeof value !== 'string') fail('comment required');
  const text = value.trim();
  if (
    !text ||
    text.length > 500 ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)
  )
    fail('comment must be 1 to 500 characters');
  return text;
}

function same(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length &&
    names.every(
      (key) => Object.hasOwn(right, key) && same(left[key], right[key]),
    )
  );
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Lamport order with the collaboration kernel's locale-free tie rule. */
function foldOrder(left, right) {
  return (
    left.clock - right.clock ||
    compareCodeUnits(left.actorId, right.actorId) ||
    left.seq - right.seq
  );
}

/** Validate one operation and return its canonical frozen form. */
export function validateRoomOperation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail('operation object required');
  const type = raw.type;
  if (!Object.hasOwn(PAYLOAD, type)) fail('unknown operation type');
  exactKeys(raw, [...ENVELOPE, ...PAYLOAD[type]]);
  const room = normalizeRoomCode(raw.room);
  if (!room || room !== raw.room) fail('invalid room code');
  if (typeof raw.actorId !== 'string' || !ACTOR.test(raw.actorId))
    fail('invalid actor id');
  const seq = count(raw.seq, 1, 100_000, 'sequence');
  const clock = count(raw.clock, seq, 1_000_000_000, 'clock');
  if (raw.id !== `${raw.actorId}-${seq}`)
    fail('operation id must be actor-seq');
  const op = {
    id: raw.id,
    room,
    actorId: raw.actorId,
    authorName: name(raw.authorName),
    seq,
    clock,
    type,
  };
  if (type === 'genesis') {
    if (seq !== 1) fail('genesis must be the first operation of its author');
    exactKeys(raw.project, ['id', 'title']);
    const doc = createCityDocument({
      id: raw.project.id,
      title: raw.project.title,
      reference: raw.reference,
    });
    if (
      !same(doc.reference, raw.reference) ||
      doc.project.title !== raw.project.title
    )
      fail('noncanonical genesis');
    op.project = { id: doc.project.id, title: doc.project.title };
    op.reference = doc.reference;
  } else if (type === 'role') {
    if (typeof raw.member !== 'string' || !ACTOR.test(raw.member))
      fail('invalid member');
    if (!CITY_ROOM_ROLES.includes(raw.role)) fail('invalid role');
    op.member = raw.member;
    op.memberName = name(raw.memberName);
    op.role = raw.role;
    op.throughSeq = count(raw.throughSeq, 0, 100_000, 'through sequence');
    op.baseRevision = count(raw.baseRevision, 0, 100_000, 'base revision');
    op.nextRevision = count(raw.nextRevision, 1, 100_001, 'next revision');
    if (op.nextRevision !== op.baseRevision + 1)
      fail('role revision must advance by one');
  } else if (type === 'comment') {
    op.versionId = versionId(raw.versionId);
    op.body = body(raw.body);
  } else {
    const edit = validateCityEdit({
      title: raw.title,
      description: raw.description,
      parameters: raw.parameters,
    });
    if (type === 'propose') {
      op.branchedFrom =
        raw.branchedFrom === null ? null : versionId(raw.branchedFrom);
    } else {
      if (
        typeof raw.alternativeId !== 'string' ||
        !raw.alternativeId.startsWith('alt-')
      )
        fail('invalid alternative id');
      versionId(raw.alternativeId.slice(4));
      if (
        !Array.isArray(raw.parents) ||
        raw.parents.length < 1 ||
        raw.parents.length > 6
      )
        fail('one to six parents required');
      const parents = raw.parents.map(versionId);
      if (new Set(parents).size !== parents.length) fail('duplicate parent');
      op.alternativeId = raw.alternativeId;
      op.parents = parents;
    }
    Object.assign(op, edit);
    if (
      !same(edit, {
        title: raw.title,
        description: raw.description,
        parameters: raw.parameters,
      })
    )
      fail('noncanonical proposal text');
  }
  return freeze(op);
}

/**
 * Union two operation sets. Duplicates are idempotent; malformed operations
 * are dropped and counted. Two different operations claiming one id keep the
 * canonical (smaller serialized) one, so every replica keeps the same.
 */
export function mergeRoomOperations(current = [], incoming = []) {
  const byId = new Map(current.map((op) => [op.id, op]));
  let added = 0;
  let invalid = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const existing = raw && typeof raw === 'object' ? byId.get(raw.id) : null;
    if (existing && same(existing, raw)) continue;
    let op;
    try {
      op = validateRoomOperation(raw);
    } catch {
      invalid++;
      continue;
    }
    if (existing) {
      if (JSON.stringify(op) < JSON.stringify(existing)) byId.set(op.id, op);
      continue;
    }
    if (byId.size >= CITY_ROOM_LIMITS.ops) {
      invalid++;
      continue;
    }
    byId.set(op.id, op);
    added++;
  }
  return {
    ops: Object.freeze([...byId.values()].sort(foldOrder)),
    added,
    invalid,
  };
}

function nextIndexes(ops, actorId) {
  let seq = 0;
  let clock = 0;
  for (const op of ops) {
    if (op.actorId === actorId) seq = Math.max(seq, op.seq);
    clock = Math.max(clock, op.clock);
  }
  return { seq: seq + 1, clock: clock + 1 };
}

/**
 * Author the next operation from what this replica currently knows.
 * Role operations derive their base revision and the member sequence the
 * owner has seen, which is what later revocation decisions are measured from.
 */
export function createRoomOperation(ops, author, type, payload = {}) {
  const { seq, clock } = nextIndexes(ops, author.actorId);
  const op = {
    id: `${author.actorId}-${seq}`,
    room: author.room,
    actorId: author.actorId,
    authorName: author.name,
    seq,
    clock,
    type,
  };
  if (type === 'role') {
    const projection = projectRoom(ops);
    const member = projection.members.find(
      (entry) => entry.actorId === payload.member,
    );
    // Only the member's unbroken run counts as seen; a later operation that
    // arrives after a gap was never available to this owner.
    const seqs = new Set(
      ops
        .filter((entry) => entry.actorId === payload.member)
        .map((entry) => entry.seq),
    );
    let throughSeq = 0;
    while (seqs.has(throughSeq + 1)) throughSeq++;
    const baseRevision = member?.roleRevision ?? 0;
    Object.assign(op, {
      member: payload.member,
      memberName: payload.memberName,
      role: payload.role,
      throughSeq,
      baseRevision,
      nextRevision: baseRevision + 1,
    });
  } else if (type === 'propose') {
    Object.assign(op, {
      title: payload.title,
      description: payload.description,
      parameters: payload.parameters,
      branchedFrom: payload.branchedFrom ?? null,
    });
  } else {
    for (const key of PAYLOAD[type] ?? []) op[key] = payload[key];
  }
  return validateRoomOperation(op);
}

function author(op) {
  return { actorId: op.actorId, name: op.authorName };
}

/** Everything a participant sees, derived only from the operation set. */
export function projectRoom(ops = [], { self = null } = {}) {
  const sorted = [...ops].sort(foldOrder);
  const byId = new Map(sorted.map((op) => [op.id, op]));
  const room = sorted[0]?.room ?? null;
  // An author's operation applies only after all of their earlier ones.
  const byActor = new Map();
  for (const op of sorted) {
    if (!byActor.has(op.actorId)) byActor.set(op.actorId, []);
    byActor.get(op.actorId).push(op);
  }
  const live = new Set();
  const pending = [];
  for (const list of byActor.values()) {
    list.sort((a, b) => a.seq - b.seq);
    let expected = 1;
    let clock = 0;
    for (const op of list) {
      if (op.seq === expected && op.clock > clock) {
        live.add(op.id);
        expected++;
        clock = op.clock;
      } else {
        pending.push(op);
      }
    }
  }
  const order = sorted.filter((op) => live.has(op.id));
  const genesis = order.find((op) => op.type === 'genesis');
  const pendingOf = (list, reason) =>
    list
      .sort(foldOrder)
      .map((op) => ({ id: op.id, type: op.type, author: author(op), reason }));
  if (!genesis) {
    return freeze({
      status: 'waiting-for-genesis',
      room,
      owner: null,
      project: null,
      reference: null,
      members: [],
      alternatives: [],
      rejected: [],
      pending: pendingOf([...sorted], 'waiting-for-genesis'),
      self: self ? { actorId: self, role: 'viewer', canWrite: false } : null,
    });
  }
  const owner = genesis.actorId;
  const { project } = createCityDocument({
    id: genesis.project.id,
    title: genesis.project.title,
    reference: genesis.reference,
  });
  let state = createCollaborationState();
  const rejected = [];
  const rejectedIds = new Set();
  const position = new Map(order.map((op, index) => [op.id, index]));
  function reject(op, reason) {
    rejected.push({ op, reason });
    rejectedIds.add(op.id);
  }
  function apply(operation) {
    const applied = applyCollaborationOperation(state, operation);
    state = applied.state;
    return applied.result;
  }

  // Pass 1: the owner's role chain through the authority kernel.
  const assignments = new Map();
  for (const op of order) {
    if (op.type !== 'role') continue;
    if (op.actorId !== owner) {
      reject(op, 'not-owner');
      continue;
    }
    if (op.member === owner) {
      reject(op, 'invalid-member');
      continue;
    }
    const list = assignments.get(op.member) ?? [];
    if (list.length && op.throughSeq < list.at(-1).throughSeq) {
      reject(op, 'stale-member-sequence');
      continue;
    }
    const result = apply({
      id: op.id,
      actorId: op.actorId,
      kind: 'steward-authority',
      targetId: `city-room:${op.room}:member:${op.member}`,
      baseRevision: op.baseRevision,
      nextRevision: op.nextRevision,
      value: op.role,
      payload: { throughSeq: op.throughSeq, memberName: op.memberName },
    });
    if (!result.accepted) {
      reject(op, result.reason);
      continue;
    }
    list.push({
      role: op.role,
      throughSeq: op.throughSeq,
      revision: op.nextRevision,
      memberName: op.memberName,
    });
    assignments.set(op.member, list);
  }
  // While an owner operation is missing, any member verdict could still change.
  const ownerGap = pending.some((op) => op.actorId === owner);
  const waiting = [];
  const roleFor = (actorId, seq) => {
    if (actorId === owner) return 'owner';
    const list = assignments.get(actorId) ?? [];
    let role = 'viewer';
    for (const entry of list) if (entry.throughSeq < seq) role = entry.role;
    return role;
  };

  // Pass 2: proposals, revisions and comments in causal order.
  const versions = new Map();
  const alternatives = new Map();
  let comments = 0;
  const altVersion = (alternativeId) => alternativeId.slice(4);
  for (const op of order) {
    if (op === genesis || op.type === 'role') continue;
    if (op.type === 'genesis') {
      reject(op, 'duplicate-genesis');
      continue;
    }
    if (ownerGap && op.actorId !== owner) {
      waiting.push(op);
      continue;
    }
    const role = roleFor(op.actorId, op.seq);
    if (role !== 'owner' && role !== 'contributor') {
      reject(op, role === 'revoked' ? 'revoked' : 'viewer');
      continue;
    }
    if (op.type === 'comment') {
      if (rejectedIds.has(op.versionId)) reject(op, 'parent-rejected');
      else if (!versions.has(op.versionId)) reject(op, 'unknown-version');
      else if (comments >= CITY_ROOM_LIMITS.comments) reject(op, 'limit');
      else {
        const result = apply({
          id: op.id,
          actorId: op.actorId,
          kind: 'comment',
          targetId: `city-room:${op.room}:comment:${op.id}`,
          field: 'body',
          counter: op.clock,
          value: { versionId: op.versionId, body: op.body },
        });
        if (!result.accepted) reject(op, result.reason);
        else {
          comments++;
          versions.get(op.versionId).comments.push(op);
        }
      }
      continue;
    }
    let alternativeId;
    let parents = [];
    if (op.type === 'propose') {
      alternativeId = `alt-${op.id}`;
      // A source revoked later stays credited as unavailable; the branch survives.
      if (
        op.branchedFrom &&
        !rejectedIds.has(op.branchedFrom) &&
        !versions.has(op.branchedFrom)
      ) {
        reject(op, 'unknown-source');
        continue;
      }
      if (alternatives.size >= CITY_ROOM_LIMITS.alternatives) {
        reject(op, 'limit');
        continue;
      }
    } else {
      alternativeId = op.alternativeId;
      // Rejected parents drop out; the revision survives on its accepted ones.
      parents = op.parents.filter((parent) => !rejectedIds.has(parent));
      if (rejectedIds.has(altVersion(alternativeId)) || !parents.length) {
        reject(op, 'parent-rejected');
        continue;
      }
      if (
        !alternatives.has(alternativeId) ||
        parents.some(
          (parent) => versions.get(parent)?.alternativeId !== alternativeId,
        )
      ) {
        reject(op, 'unknown-parent');
        continue;
      }
      if (
        alternatives.get(alternativeId).versionIds.length >=
        CITY_ROOM_LIMITS.versions
      ) {
        reject(op, 'limit');
        continue;
      }
    }
    // One planning target per version: the merge clock never overwrites a
    // concurrent version, so a conflict stays visible instead of merged.
    const result = apply(
      createPlanningAlternativeOperation(project, {
        operationId: op.id,
        actorId: op.actorId,
        counter: op.clock,
        alternativeId: op.id,
        title: op.title,
        features: [],
        assumptions: [op.description, JSON.stringify(op.parameters)],
      }),
    );
    if (!result.accepted) {
      reject(op, result.reason);
      continue;
    }
    if (op.type === 'propose')
      alternatives.set(alternativeId, {
        op,
        versionIds: [],
      });
    alternatives.get(alternativeId).versionIds.push(op.id);
    versions.set(op.id, { op, alternativeId, parents, comments: [] });
  }

  // Read content back through the planning kernel's validated projection.
  const planned = new Map(
    listPlanningAlternatives(project, state).map((entry) => [
      entry.alternativeId,
      entry,
    ]),
  );
  const versionView = (id, number) => {
    const { op, parents, comments: notes } = versions.get(id);
    const entry = planned.get(id);
    // A decision that repeats one head verbatim credits that head's writer.
    const keptId =
      parents.length > 1
        ? parents.find((parent) => {
            const prior = versions.get(parent).op;
            return (
              prior.title === op.title &&
              prior.description === op.description &&
              same(prior.parameters, op.parameters)
            );
          })
        : null;
    return {
      id,
      number,
      parents: [...parents],
      author: author(op),
      kept: keptId
        ? { versionId: keptId, author: author(versions.get(keptId).op) }
        : null,
      title: entry.title,
      description: entry.assumptions[0],
      parameters: JSON.parse(entry.assumptions[1]),
      state: entry.state,
      modeledImpact: entry.modeledImpact,
      approval: entry.approval,
      comments: notes.map((note) => {
        const field =
          state.authored[`comment:city-room:${note.room}:comment:${note.id}`]
            .fields.body;
        return { id: note.id, author: author(note), body: field.value.body };
      }),
    };
  };
  const numbers = new Map();
  const alternativeViews = [...alternatives.entries()].map(([id, entry]) => {
    const list = entry.versionIds.map((versionIdValue, index) => {
      numbers.set(versionIdValue, { alternativeId: id, number: index + 1 });
      return versionView(versionIdValue, index + 1);
    });
    const named = new Set(list.flatMap((version) => version.parents));
    const heads = list
      .filter((version) => !named.has(version.id))
      .map((version) => version.id);
    const source = entry.op.branchedFrom;
    const sourceVersion = source ? versions.get(source) : null;
    return {
      id,
      createdBy: author(entry.op),
      branchedFrom: !source
        ? null
        : sourceVersion
          ? {
              versionId: source,
              available: true,
              alternativeId: sourceVersion.alternativeId,
              number: numbers.get(source).number,
              title: planned.get(source).title,
              author: author(sourceVersion.op),
            }
          : { versionId: source, available: false },
      versions: list,
      heads,
      conflict: heads.length > 1,
    };
  });

  // Owner first, then members by id; names are self-asserted, never verified.
  const names = new Map([[owner, genesis.authorName]]);
  for (const op of order)
    if (!names.has(op.actorId)) names.set(op.actorId, op.authorName);
  const memberIds = new Set([...names.keys(), ...assignments.keys()]);
  const members = [...memberIds]
    .sort((a, b) =>
      a === owner ? -1 : b === owner ? 1 : compareCodeUnits(a, b),
    )
    .map((actorId) => {
      const list = assignments.get(actorId) ?? [];
      return {
        actorId,
        name: names.get(actorId) ?? list.at(-1)?.memberName,
        role: actorId === owner ? 'owner' : (list.at(-1)?.role ?? 'viewer'),
        roleRevision: list.at(-1)?.revision ?? 0,
      };
    });
  const selfRole = self
    ? (members.find((member) => member.actorId === self)?.role ?? 'viewer')
    : null;
  return freeze({
    status: 'ready',
    room,
    owner: { actorId: owner, name: genesis.authorName },
    project,
    reference: genesis.reference,
    members,
    alternatives: alternativeViews,
    rejected: rejected
      .sort((a, b) => position.get(a.op.id) - position.get(b.op.id))
      .map(({ op, reason }) => ({
        id: op.id,
        type: op.type,
        author: author(op),
        reason,
        title: op.title ?? null,
      })),
    pending: [
      ...pendingOf(pending, 'waiting-for-earlier-operations'),
      ...pendingOf(waiting, 'waiting-for-owner'),
    ].sort((a, b) => foldOrder(byId.get(a.id), byId.get(b.id))),
    self: self
      ? {
          actorId: self,
          role: selfRole,
          canWrite: selfRole === 'owner' || selfRole === 'contributor',
        }
      : null,
  });
}

/** A short deterministic fingerprint of what every participant sees. */
export function roomDigest(projection) {
  const { self: _self, ...shared } = projection;
  const text = JSON.stringify(shared);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export function serializeRoom(ops) {
  const merged = mergeRoomOperations([], ops);
  if (merged.invalid || !merged.ops.length)
    fail('valid room operations required');
  const room = merged.ops[0].room;
  if (merged.ops.some((op) => op.room !== room)) fail('mixed rooms');
  const json = JSON.stringify({
    schemaVersion: CITY_ROOM_SCHEMA_VERSION,
    kind: 'city-room',
    room,
    ops: merged.ops,
  });
  if (encoder.encode(json).length > MAX_JSON_BYTES)
    fail('room export exceeds 4 MiB');
  return json;
}

/** Whole-document validation: one bad operation rejects the entire file. */
export function parseRoom(json) {
  if (
    typeof json !== 'string' ||
    json.length > MAX_JSON_BYTES ||
    encoder.encode(json).length > MAX_JSON_BYTES
  )
    fail('room JSON must be at most 4 MiB');
  const doc = JSON.parse(json);
  exactKeys(doc, ['schemaVersion', 'kind', 'room', 'ops']);
  if (
    doc.schemaVersion !== CITY_ROOM_SCHEMA_VERSION ||
    doc.kind !== 'city-room'
  )
    fail('unsupported room schema');
  const room = normalizeRoomCode(doc.room);
  if (!room || room !== doc.room) fail('invalid room code');
  if (
    !Array.isArray(doc.ops) ||
    !doc.ops.length ||
    doc.ops.length > CITY_ROOM_LIMITS.ops
  )
    fail('room operations out of bounds');
  const ids = new Set();
  const ops = doc.ops.map((raw) => {
    const op = validateRoomOperation(raw);
    if (op.room !== room) fail('operation belongs to another room');
    if (ids.has(op.id)) fail('duplicate operation id');
    ids.add(op.id);
    return op;
  });
  return mergeRoomOperations([], ops).ops;
}
