import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCollaborationOperation,
  applyCollaborationOperations,
  createCollaborationState,
} from './collaborationAuthority.js';

const annotation = (id, actorId, value) => ({
  id,
  actorId,
  kind: 'annotation',
  targetId: 'note-1',
  field: 'text',
  counter: 7,
  value,
});

test('concurrent authored edits converge regardless of arrival order', () => {
  const a = annotation('op-a', 'alice', 'north bridge');
  const b = annotation('op-b', 'bob', 'south bridge');

  const left = applyCollaborationOperations(createCollaborationState(), [a, b]);
  const right = applyCollaborationOperations(createCollaborationState(), [b, a]);

  assert.deepEqual(left.state, right.state);
  assert.equal(
    left.state.authored['annotation:note-1'].fields.text.value,
    'south bridge',
  );
});

test('conflicting evidence interpretations are both retained as claims', () => {
  const first = {
    id: 'claim-op-1',
    actorId: 'analyst-a',
    kind: 'evidence-claim',
    targetId: 'bridge-7',
    claimId: 'claim-open',
    sourceRevision: 'camera:r17',
    interpretation: 'open',
  };
  const second = {
    id: 'claim-op-2',
    actorId: 'analyst-b',
    kind: 'evidence-claim',
    targetId: 'bridge-7',
    claimId: 'claim-blocked',
    sourceRevision: 'camera:r17',
    interpretation: 'blocked',
  };

  const { state } = applyCollaborationOperations(createCollaborationState(), [
    first,
    second,
  ]);

  assert.equal(state.claims.length, 2);
  assert.deepEqual(
    state.claims.map((claim) => claim.interpretation).sort(),
    ['blocked', 'open'],
  );
});

test('offline authority transition against a superseded base is rejected explicitly', () => {
  const first = {
    id: 'status-1',
    actorId: 'validator-a',
    kind: 'claim-status',
    targetId: 'claim-42',
    baseRevision: 0,
    nextRevision: 1,
    value: 'reviewed',
  };
  const stale = {
    id: 'status-stale',
    actorId: 'validator-b',
    kind: 'claim-status',
    targetId: 'claim-42',
    baseRevision: 0,
    nextRevision: 1,
    value: 'accepted',
  };

  const accepted = applyCollaborationOperation(createCollaborationState(), first);
  const rejected = applyCollaborationOperation(accepted.state, stale);

  assert.equal(rejected.result.accepted, false);
  assert.equal(rejected.result.reason, 'base-revision-mismatch');
  assert.equal(rejected.result.currentRevision, 1);
  assert.equal(
    rejected.state.authority['claim-status:claim-42'].value,
    'reviewed',
  );
});

test('reconnect and replay cannot duplicate an authorization receipt', () => {
  const approval = {
    id: 'approval-op-1',
    actorId: 'coordinator',
    kind: 'action-approval',
    targetId: 'delivery-3',
    baseRevision: 0,
    nextRevision: 1,
    receiptId: 'approval:delivery-3:r1',
    value: 'approved',
  };

  const once = applyCollaborationOperation(createCollaborationState(), approval);
  const exactReplay = applyCollaborationOperation(once.state, approval);
  assert.equal(exactReplay.result.reason, 'duplicate-operation');

  const replayWithNewTransportId = applyCollaborationOperation(exactReplay.state, {
    ...approval,
    id: 'approval-op-replayed',
    baseRevision: 1,
    nextRevision: 2,
  });

  assert.equal(replayWithNewTransportId.result.accepted, true);
  assert.equal(replayWithNewTransportId.result.changed, false);
  assert.equal(
    replayWithNewTransportId.result.reason,
    'authorization-already-recorded',
  );
  assert.equal(
    replayWithNewTransportId.state.authority['action-approval:delivery-3']
      .revision,
    1,
  );
});

test('remote camera/follow state may merge but side effects require local confirmation', () => {
  let state = createCollaborationState();

  const camera = applyCollaborationOperation(state, {
    id: 'present-camera',
    actorId: 'peer',
    kind: 'presentation',
    targetId: 'room',
    field: 'camera',
    counter: 1,
    value: { lat: 27.9, lon: 85.1 },
  });
  state = camera.state;
  assert.equal(camera.result.accepted, true);

  const follow = applyCollaborationOperation(state, {
    id: 'present-follow',
    actorId: 'peer',
    kind: 'presentation',
    targetId: 'room',
    field: 'follow',
    counter: 2,
    value: 'bridge-7',
  });
  state = follow.state;
  assert.equal(follow.result.accepted, true);

  for (const field of ['layers', 'media', 'micEnabled', 'action']) {
    const blocked = applyCollaborationOperation(state, {
      id: `blocked-${field}`,
      actorId: 'peer',
      kind: 'presentation',
      targetId: 'room',
      field,
      counter: 3,
      value: true,
    });
    assert.equal(blocked.result.accepted, false);
    assert.equal(
      blocked.result.reason,
      'remote-side-effect-requires-local-confirmation',
    );
    state = blocked.state;
  }
});

test('superseded evidence status keeps an append-only audit trail', () => {
  const { state } = applyCollaborationOperations(createCollaborationState(), [
    {
      id: 'status-1',
      actorId: 'validator',
      kind: 'claim-status',
      targetId: 'claim-9',
      baseRevision: 0,
      nextRevision: 1,
      value: 'reviewed',
    },
    {
      id: 'status-2',
      actorId: 'validator',
      kind: 'claim-status',
      targetId: 'claim-9',
      baseRevision: 1,
      nextRevision: 2,
      value: 'superseded',
    },
  ]);

  assert.equal(state.authority['claim-status:claim-9'].revision, 2);
  assert.deepEqual(
    state.audit
      .filter((entry) => entry.targetId === 'claim-9')
      .map((entry) => entry.operationId),
    ['status-1', 'status-2'],
  );
});

test('single-user mode requires no collaboration service or transport', () => {
  const state = createCollaborationState();
  assert.deepEqual(state, {
    seenOperationIds: [],
    authored: {},
    claims: [],
    authority: {},
    authorizationReceipts: {},
    audit: [],
  });
});
