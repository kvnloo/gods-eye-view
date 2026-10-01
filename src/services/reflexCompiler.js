/**
 * Deterministic kernel for compiling verified repeated GEV action sequences.
 *
 * This module owns no UI and no mutations. It only mines verified receipts,
 * prepares revision-bound plans, validates them immediately before commit, and
 * decides when an existing routine must be demoted.
 */

function stableActionSequence(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const actions = steps
    .map((step) => String(step?.action || '').trim())
    .filter(Boolean);
  return actions.length === steps.length ? actions.join('>') : null;
}

/**
 * Mine repeated verified semantic sequences.
 * Raw keystrokes/pointer events are intentionally not accepted.
 */
export function mineReflexCandidates(episodes = [], { minVerified = 3 } = {}) {
  const required = Math.max(2, Math.floor(Number(minVerified) || 3));
  const groups = new Map();

  for (const episode of Array.isArray(episodes) ? episodes : []) {
    if (
      episode?.outcome !== 'verified_success' ||
      episode?.undoWithinWindow ||
      episode?.userOverride
    )
      continue;
    if (!episode.sourceStateFingerprint || !episode.capabilityRevision)
      continue;
    const sequence = stableActionSequence(episode.steps);
    if (!sequence) continue;
    const current = groups.get(sequence) || {
      sequence,
      count: 0,
      receipts: [],
    };
    current.count += 1;
    current.receipts.push(episode);
    groups.set(sequence, current);
  }

  return [...groups.values()]
    .filter((group) => group.count >= required)
    .map((group) => ({
      sequence: group.sequence,
      verifiedCount: group.count,
      actions: group.sequence.split('>'),
      sourceReceiptIds: group.receipts
        .map((episode) => episode.receiptId)
        .filter(Boolean),
    }))
    .sort(
      (a, b) =>
        b.verifiedCount - a.verifiedCount ||
        a.sequence.localeCompare(b.sequence),
    );
}

/**
 * Prepare a reflex without executing anything.
 *
 * The result is bound to world/capability revisions and expires. Callers may
 * resolve/warm read-only dependencies before invoking this function, but this
 * object carries no mutation callback by design.
 */
export function prepareReflex({
  routineId,
  routineRevision,
  sourceStateFingerprint,
  capabilityRevision,
  steps,
  preparedAt = Date.now(),
  ttlMs = 5000,
} = {}) {
  if (!String(routineId || '').trim())
    throw new TypeError('routineId is required');
  if (!String(sourceStateFingerprint || '').trim())
    throw new TypeError('sourceStateFingerprint is required');
  if (!String(capabilityRevision || '').trim())
    throw new TypeError('capabilityRevision is required');
  const sequence = stableActionSequence(steps);
  if (!sequence) throw new TypeError('steps must contain semantic action ids');

  const started = Number(preparedAt);
  const ttl = Math.max(1, Number(ttlMs) || 5000);
  return Object.freeze({
    routineId: String(routineId),
    routineRevision: Math.max(1, Math.floor(Number(routineRevision) || 1)),
    sourceStateFingerprint: String(sourceStateFingerprint),
    capabilityRevision: String(capabilityRevision),
    preparedAt: started,
    expiresAt: started + ttl,
    sequence,
    steps: Object.freeze(
      steps.map((step) =>
        Object.freeze({
          action: String(step.action),
          ...(step.args && typeof step.args === 'object'
            ? { args: Object.freeze({ ...step.args }) }
            : {}),
        }),
      ),
    ),
  });
}

/**
 * Revalidate prepared work immediately before commit.
 *
 * No confidence score can override a failed revision/freshness/capability
 * check. An unavailable required input fails closed.
 */
export function validatePreparedReflex(
  prepared,
  {
    sourceStateFingerprint,
    capabilityRevision,
    now = Date.now(),
    requiredInputs = [],
  } = {},
) {
  if (!prepared || typeof prepared !== 'object')
    return { ok: false, reason: 'missing_preparation' };
  if (Number(now) >= Number(prepared.expiresAt))
    return { ok: false, reason: 'expired' };
  if (String(sourceStateFingerprint || '') !== prepared.sourceStateFingerprint)
    return { ok: false, reason: 'stale_state' };
  if (String(capabilityRevision || '') !== prepared.capabilityRevision)
    return { ok: false, reason: 'capability_drift' };

  for (const input of Array.isArray(requiredInputs) ? requiredInputs : []) {
    const freshness = String(input?.freshness || 'unknown');
    if (freshness === 'unavailable' || freshness === 'unknown') {
      return {
        ok: false,
        reason: 'input_unavailable',
        input: input?.id || null,
      };
    }
  }
  return { ok: true };
}

/**
 * Demote a routine when its contract drifted or operator feedback says the
 * shortcut is no longer trustworthy.
 */
export function reflexDemotionReason(
  {
    schemaChanged = false,
    capabilityChanged = false,
    verifierFailures = 0,
    undoCount = 0,
    overrideCount = 0,
    rejected = false,
  } = {},
  {
    maxVerifierFailures = 2,
    maxUndoOrOverride = 2,
  } = {},
) {
  if (schemaChanged) return 'schema_drift';
  if (capabilityChanged) return 'capability_drift';
  if (rejected) return 'user_rejected';
  if (
    Number(verifierFailures) >= Math.max(1, Number(maxVerifierFailures) || 2)
  )
    return 'verifier_failures';
  if (
    Number(undoCount) + Number(overrideCount) >=
    Math.max(1, Number(maxUndoOrOverride) || 2)
  )
    return 'operator_override';
  return null;
}
