/**
 * Exact bounded *synthetic* bipartite matching reference for GEV Math372 #207.
 * It is not a live route planner, allocation policy, dispatcher or an
 * implementation of OpenAI math family #120's near-linear algorithm.
 * A complete, explicitly versioned eligibility matrix is required. Unknown
 * edges may improve a theoretical upper bound but are never selected.
 */
export const RELIEF_MATCHING_LIMITS = Object.freeze({ resources: 8, requests: 8, edges: 64 });
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const STATUSES = new Set(['supported', 'unsupported', 'unknown']);

function identity(value, what) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new TypeError(`${what} must be a bounded lowercase identifier`);
  }
  return value;
}

function sourceRef(value, what) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value ||
      value.length > 160) throw new TypeError(`${what} requires a bounded explicit revision`);
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function makeReceipt(context, fields) {
  return freeze({
    kind: 'synthetic-one-to-one-relief-matching-v1',
    determination: 'hypothetical',
    authority: 'none',
    accessClaim: 'not-evaluated',
    implementation: 'not-authorized',
    context,
    ...fields,
  });
}

function sortIds(input, name, max) {
  if (!Array.isArray(input) || input.length < 1) {
    throw new TypeError(`${name} must be a nonempty list`);
  }
  if (input.length > max) return null;
  const ids = input.map(x => identity(x?.id, `${name} id`));
  if (new Set(ids).size !== ids.length) throw new TypeError(`${name} ids must be unique`);
  return ids.sort();
}

function pairOrder(left, right) {
  const length = Math.min(left.length, right.length);
  for (let k = 0; k < length; k++) {
    const la = `${left[k].resourceId}/${left[k].requestId}`;
    const rb = `${right[k].resourceId}/${right[k].requestId}`;
    if (la < rb) return -1;
    if (la > rb) return 1;
  }
  return left.length - right.length;
}

/** Complete exact reference, bounded to 8 resources x 8 requests. */
function exactMatching(resources, requests, allowed) {
  let best = [];
  const used = new Set();
  const current = [];
  function visit(i) {
    // Upper bound: each remaining resource can contribute at most one match.
    if (current.length + resources.length - i < best.length) return;
    if (i === resources.length) {
      if (current.length > best.length ||
          (current.length === best.length && pairOrder(current, best) < 0)) {
        best = current.map(pair => ({ ...pair }));
      }
      return;
    }
    const resourceId = resources[i];
    for (const requestId of requests) {
      if (used.has(requestId) || !allowed.has(`${resourceId}\0${requestId}`)) continue;
      used.add(requestId);
      current.push({ resourceId, requestId });
      visit(i + 1);
      current.pop();
      used.delete(requestId);
    }
    visit(i + 1);
  }
  visit(0);
  return best;
}

/**
 * Evaluate an explicitly supplied 1-to-1 eligibility/access matrix. Edge
 * status describes only the supplied hypothetical fixture, not road truth.
 * Returns a best *supported-edge* assignment, plus the possible cardinality
 * upper bound if all currently unknown edges later prove usable.
 */
export function solveSyntheticReliefMatching(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.determination !== 'hypothetical' || input.datasetKind !== 'synthetic') {
    throw new TypeError('synthetic hypothetical fixture required');
  }
  const context = {
    studyId: identity(input.studyId, 'studyId'),
    sourceRef: sourceRef(input.sourceRef, 'sourceRef'),
    worldRevision: sourceRef(input.worldRevision, 'worldRevision'),
    resourceRevision: sourceRef(input.resourceRevision, 'resourceRevision'),
    requestRevision: sourceRef(input.requestRevision, 'requestRevision'),
    accessRevision: sourceRef(input.accessRevision, 'accessRevision'),
    policyRevision: sourceRef(input.policyRevision, 'policyRevision'),
  };
  const resources = sortIds(input.resources, 'resources', RELIEF_MATCHING_LIMITS.resources);
  const requests = sortIds(input.requests, 'requests', RELIEF_MATCHING_LIMITS.requests);
  if (!resources || !requests) {
    return makeReceipt(context, { status: 'unsupported', reason: 'reference-size-limit' });
  }
  const edges = input.edges;
  if (!Array.isArray(edges)) {
    return makeReceipt(context, { status: 'unknown', reason: 'missing-edge-matrix' });
  }
  if (edges.length > RELIEF_MATCHING_LIMITS.edges) {
    return makeReceipt(context, { status: 'unsupported', reason: 'reference-edge-limit' });
  }
  const knownResources = new Set(resources);
  const knownRequests = new Set(requests);
  const edgeMap = new Map();
  for (const edge of edges) {
    const resourceId = identity(edge?.resourceId, 'resourceId');
    const requestId = identity(edge?.requestId, 'requestId');
    const key = `${resourceId}\0${requestId}`;
    if (!knownResources.has(resourceId) || !knownRequests.has(requestId)) {
      throw new TypeError('edge endpoints must match supplied resources and requests');
    }
    if (edgeMap.has(key)) throw new TypeError('duplicate edge for a resource-request pair');
    if (!STATUSES.has(edge.status)) throw new TypeError('edge status must be supported, unsupported or unknown');
    edgeMap.set(key, {
      status: edge.status,
      evidenceRef: sourceRef(edge.evidenceRef, 'edge evidenceRef'),
    });
  }
  if (edgeMap.size !== resources.length * requests.length) {
    // An omitted edge is unassessed, not automatically a known impossible pair.
    return makeReceipt(context, {
      status: 'unknown', reason: 'incomplete-edge-matrix',
      suppliedEdges: edgeMap.size, expectedEdges: resources.length * requests.length,
    });
  }
  const supported = new Set();
  const possible = new Set();
  let unknownEdges = 0;
  let excludedEdges = 0;
  for (const [key, edge] of edgeMap) {
    if (edge.status === 'supported') { supported.add(key); possible.add(key); }
    else if (edge.status === 'unknown') { unknownEdges++; possible.add(key); }
    else excludedEdges++;
  }
  const matches = exactMatching(resources, requests, supported);
  const possibleMaximum = exactMatching(resources, requests, possible).length;
  return makeReceipt(context, {
    status: unknownEdges ? 'limited' : 'evaluated',
    solutionScope: 'maximum-only-among-explicitly-supported-synthetic-edges',
    matchedCount: matches.length,
    possibleMaximumIfUnknownUsable: possibleMaximum,
    unknownEdges,
    excludedEdges,
    matchedPairs: matches.map(pair => ({ ...pair, evidenceRef: edgeMap.get(`${pair.resourceId}\0${pair.requestId}`).evidenceRef })),
    unmatchedResources: resources.filter(id => !matches.some(pair => pair.resourceId === id)),
    unmatchedRequests: requests.filter(id => !matches.some(pair => pair.requestId === id)),
  });
}
