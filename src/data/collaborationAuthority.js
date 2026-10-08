export const COLLAB_MERGEABLE_KINDS = Object.freeze([
  'annotation',
  'comment',
  'presentation',
  'label',
  'draft-scenario',
]);

export const COLLAB_APPEND_ONLY_KINDS = Object.freeze(['evidence-claim']);

export const COLLAB_REVISION_OWNED_KINDS = Object.freeze([
  'claim-status',
  'sensitivity',
  'steward-authority',
  'external-commitment',
  'action-approval',
]);

export const PRESENTATION_FIELDS_REQUIRING_LOCAL_CONFIRMATION = Object.freeze([
  'layers',
  'layerState',
  'media',
  'mediaPlayback',
  'microphone',
  'micEnabled',
  'action',
  'actions',
]);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function cloneState(state) {
  return {
    seenOperationIds: [...(state?.seenOperationIds || [])],
    authored: Object.fromEntries(
      Object.entries(state?.authored || {}).map(([key, value]) => [
        key,
        {
          ...value,
          fields: Object.fromEntries(
            Object.entries(value?.fields || {}).map(([field, entry]) => [
              field,
              {
                ...entry,
                clock: entry?.clock ? { ...entry.clock } : entry?.clock,
              },
            ]),
          ),
        },
      ]),
    ),
    claims: (state?.claims || []).map((claim) => ({ ...claim })),
    authority: Object.fromEntries(
      Object.entries(state?.authority || {}).map(([key, value]) => [
        key,
        { ...value },
      ]),
    ),
    authorizationReceipts: { ...(state?.authorizationReceipts || {}) },
    audit: (state?.audit || []).map((entry) => ({ ...entry })),
  };
}

export function createCollaborationState() {
  return cloneState();
}

export function collaborationOperationCategory(kind) {
  if (COLLAB_MERGEABLE_KINDS.includes(kind)) return 'mergeable';
  if (COLLAB_APPEND_ONLY_KINDS.includes(kind)) return 'append-only';
  if (COLLAB_REVISION_OWNED_KINDS.includes(kind)) return 'revision-owned';
  return 'unknown';
}

function operationIdentity(operation) {
  const id = String(operation?.id || '').trim();
  const actorId = String(operation?.actorId || '').trim();
  return id && actorId ? { id, actorId } : null;
}

function targetId(operation) {
  const value = String(operation?.targetId || '').trim();
  return value || null;
}

function clockFor(operation, identity) {
  const counter = Number(operation?.counter);
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  return {
    counter,
    actorId: identity.actorId,
    operationId: identity.id,
  };
}

function compareClock(left, right) {
  if (!right) return 1;
  if (left.counter !== right.counter) return left.counter - right.counter;
  const actor = left.actorId.localeCompare(right.actorId);
  if (actor) return actor;
  return left.operationId.localeCompare(right.operationId);
}

function markSeen(next, id) {
  next.seenOperationIds = uniqueSorted([...next.seenOperationIds, id]);
}

function recordAudit(next, operation, result) {
  next.audit.push({
    operationId: operation.id,
    kind: operation.kind,
    targetId: operation.targetId ?? null,
    accepted: result.accepted,
    changed: result.changed,
    reason: result.reason,
  });
  next.audit.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

function finish(next, operation, result) {
  markSeen(next, operation.id);
  if (result.category !== 'mergeable') recordAudit(next, operation, result);
  return { state: next, result: Object.freeze(result) };
}

function reject(next, operation, category, reason, extra = {}) {
  return finish(next, operation, {
    accepted: false,
    changed: false,
    category,
    reason,
    ...extra,
  });
}

function mergeAuthored(next, operation, identity) {
  const target = targetId(operation);
  const field = String(operation?.field || '').trim();
  const clock = clockFor(operation, identity);
  if (!target || !field || !clock) {
    return reject(next, operation, 'mergeable', 'invalid-merge-operation');
  }

  if (
    operation.kind === 'presentation' &&
    PRESENTATION_FIELDS_REQUIRING_LOCAL_CONFIRMATION.includes(field)
  ) {
    return reject(
      next,
      operation,
      'mergeable',
      'remote-side-effect-requires-local-confirmation',
    );
  }

  const key = `${operation.kind}:${target}`;
  const object = next.authored[key] || { kind: operation.kind, targetId: target, fields: {} };
  const current = object.fields[field];

  if (current && compareClock(clock, current.clock) <= 0) {
    return finish(next, operation, {
      accepted: true,
      changed: false,
      category: 'mergeable',
      reason: 'dominated-merge-operation',
    });
  }

  next.authored[key] = {
    ...object,
    fields: {
      ...object.fields,
      [field]: {
        value: operation.value,
        clock,
        operationId: identity.id,
      },
    },
  };

  return finish(next, operation, {
    accepted: true,
    changed: true,
    category: 'mergeable',
    reason: 'merged',
  });
}

function appendClaim(next, operation, identity) {
  const target = targetId(operation);
  const claimId = String(operation?.claimId || '').trim();
  const sourceRevision = String(operation?.sourceRevision || '').trim();
  if (!target || !claimId || !sourceRevision) {
    return reject(next, operation, 'append-only', 'invalid-evidence-claim');
  }

  next.claims.push({
    operationId: identity.id,
    actorId: identity.actorId,
    claimId,
    targetId: target,
    sourceRevision,
    interpretation: operation.interpretation ?? null,
    payload: operation.payload ?? null,
  });
  next.claims.sort((a, b) =>
    [a.targetId, a.claimId, a.operationId]
      .join('\u0000')
      .localeCompare([b.targetId, b.claimId, b.operationId].join('\u0000')),
  );

  return finish(next, operation, {
    accepted: true,
    changed: true,
    category: 'append-only',
    reason: 'claim-recorded',
  });
}

function applyRevisionOwned(next, operation, identity) {
  const target = targetId(operation);
  const baseRevision = Number(operation?.baseRevision);
  const nextRevision = Number(operation?.nextRevision);
  if (
    !target ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0 ||
    !Number.isSafeInteger(nextRevision) ||
    nextRevision !== baseRevision + 1
  ) {
    return reject(next, operation, 'revision-owned', 'invalid-revision-transition');
  }

  const receiptId =
    operation.kind === 'action-approval'
      ? String(operation?.receiptId || '').trim()
      : null;
  if (operation.kind === 'action-approval' && !receiptId) {
    return reject(next, operation, 'revision-owned', 'authorization-receipt-required');
  }
  if (receiptId && next.authorizationReceipts[receiptId]) {
    return finish(next, operation, {
      accepted: true,
      changed: false,
      category: 'revision-owned',
      reason: 'authorization-already-recorded',
      receiptId,
    });
  }

  const key = `${operation.kind}:${target}`;
  const currentRevision = next.authority[key]?.revision ?? 0;
  if (baseRevision !== currentRevision) {
    return reject(next, operation, 'revision-owned', 'base-revision-mismatch', {
      currentRevision,
      requestedBaseRevision: baseRevision,
    });
  }

  next.authority[key] = {
    kind: operation.kind,
    targetId: target,
    revision: nextRevision,
    operationId: identity.id,
    actorId: identity.actorId,
    value: operation.value ?? null,
    payload: operation.payload ?? null,
    receiptId,
  };
  if (receiptId) next.authorizationReceipts[receiptId] = identity.id;

  return finish(next, operation, {
    accepted: true,
    changed: true,
    category: 'revision-owned',
    reason: 'revision-advanced',
    revision: nextRevision,
    ...(receiptId ? { receiptId } : {}),
  });
}

/**
 * Apply one collaboration operation without granting authority through merge.
 *
 * Merge-friendly user-authored state converges by a deterministic logical clock.
 * Evidence claims are append-only. Authority-bearing transitions require an
 * exact semantic base revision, and action approvals additionally require a
 * stable receipt id so reconnect/replay cannot mint a second authorization.
 */
export function applyCollaborationOperation(state, operation = {}) {
  const next = cloneState(state);
  const identity = operationIdentity(operation);
  const kind = String(operation?.kind || '').trim();
  const category = collaborationOperationCategory(kind);

  if (!identity) {
    return {
      state: next,
      result: Object.freeze({
        accepted: false,
        changed: false,
        category,
        reason: 'operation-identity-required',
      }),
    };
  }

  if (next.seenOperationIds.includes(identity.id)) {
    return {
      state: next,
      result: Object.freeze({
        accepted: true,
        changed: false,
        category,
        reason: 'duplicate-operation',
      }),
    };
  }

  operation = { ...operation, id: identity.id, actorId: identity.actorId, kind };

  if (category === 'mergeable') return mergeAuthored(next, operation, identity);
  if (category === 'append-only') return appendClaim(next, operation, identity);
  if (category === 'revision-owned')
    return applyRevisionOwned(next, operation, identity);

  return reject(next, operation, 'unknown', 'unknown-operation-kind');
}

export function applyCollaborationOperations(state, operations = []) {
  let current = cloneState(state);
  const results = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    const applied = applyCollaborationOperation(current, operation);
    current = applied.state;
    results.push(applied.result);
  }
  return { state: current, results: Object.freeze(results) };
}
