/** Portable, local-first proposal data for #153. No multiplayer transport or ground truth. */
export const COMMUNITY_PLANNING_SCHEMA_VERSION = 1;
export const PLANNING_VIEW_MODES = Object.freeze(['co-op', 'game']);

const FEATURE_KINDS = new Set([
  'tree', 'garden', 'seating', 'play-area', 'shade', 'path-marker',
]);
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function identifier(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded lowercase id`);
  }
  return value;
}

function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be nonempty and at most ${max} characters`);
  }
  return value.trim();
}

/** Reject sparse and inherited-index lists before imported proposal rendering. */
function denseArray(value, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

/** Public baseline references must not carry URL-userinfo credentials. */
/** Keep credential-like references out of public planning source credits. */
function publicHttpsSourceUrl(value) {
  if (!/^https:\/\//i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const credentialQuery = [...parsed.searchParams.keys()].some((key) => {
      // URLSearchParams decodes percent-encoded key spellings first.
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        /token|secret|password|passwd|signature|credential/.test(normalized) ||
        /apikey|authorization|bearer/.test(normalized) ||
        /^(?:auth|key|sig|pwd|sessionid)$/.test(normalized)
      );
    });
    // A document anchor is a public citation; arbitrary hash payloads may
    // contain OAuth tokens or precise scene state and cannot be credited.
    const safeAnchor = !parsed.hash || /^#[a-z][a-z0-9-]{0,79}$/i.test(parsed.hash);
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !credentialQuery &&
      safeAnchor
    );
  } catch {
    return false;
  }
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function bounds(value) {
  if (!denseArray(value, 4) || value.length !== 4) {
    throw new TypeError('place bounds must be [west,south,east,north]');
  }
  const [west, south, east, north] = value;
  if (
    !value.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
    west < -180 || east > 180 || south < -90 || north > 90 ||
    west >= east || south >= north
  ) {
    throw new RangeError('invalid planning bounds');
  }
  return [...value];
}

/** A place footprint is explicitly authored, never derived from a user's location. */
export function createCommunityPlanningProject(input = {}) {
  const extent = bounds(input.place?.bounds);
  const sourceEntries = input.baseline?.sources ?? [];
  if (!denseArray(sourceEntries, 30)) {
    throw new TypeError('sources must be a dense bounded array');
  }
  const references = sourceEntries.map((source) => ({
    id: identifier(source?.id, 'source id'),
    revision: text(source?.revision, 'source revision', 120),
    url: text(source?.url, 'source URL', 2048),
    attribution: text(source?.attribution, 'source attribution'),
    license: text(source?.license, 'source license', 120),
  }));
  if (new Set(references.map((s) => s.id)).size !== references.length ||
      references.some((s) => !publicHttpsSourceUrl(s.url))) {
    throw new TypeError('sources must be unique, bounded HTTPS references');
  }
  return freeze({
    schemaVersion: COMMUNITY_PLANNING_SCHEMA_VERSION,
    kind: 'community-planning',
    id: identifier(input.id, 'project id'),
    title: text(input.title, 'project title'),
    place: { label: text(input.place?.label, 'place label'), bounds: extent },
    baseline: {
      revision: text(input.baseline?.revision, 'baseline revision', 120),
      state: 'reference-only',
      sources: references,
    },
    approval: 'not-requested',
    implementation: 'not-started',
  });
}

function featureInBounds(feature, project) {
  const kind = feature?.kind;
  const point = feature?.point;
  if (!FEATURE_KINDS.has(kind) || !denseArray(point, 2) || point.length !== 2 ||
      !point.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new TypeError('feature requires a supported kind and [longitude,latitude] point');
  }
  const [west, south, east, north] = project.place.bounds;
  if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) {
    throw new RangeError('feature must lie inside the explicitly authored project bounds');
  }
  return {
    id: identifier(feature.id, 'feature id'),
    kind,
    point: [...point],
    note: typeof feature.note === 'string' ? feature.note.slice(0, 500) : '',
  };
}

/** Emits only a mergeable draft-scenario operation for collaborationAuthority. */
export function createPlanningAlternativeOperation(project, input = {}) {
  if (project?.schemaVersion !== COMMUNITY_PLANNING_SCHEMA_VERSION ||
      project?.kind !== 'community-planning') {
    throw new TypeError('valid community planning project required');
  }
  const counter = input.counter;
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new TypeError('nonnegative safe integer logical counter required');
  }
  const alternativeId = identifier(input.alternativeId, 'alternative id');
  const featureEntries = input.features ?? [];
  if (!denseArray(featureEntries, 100)) {
    throw new TypeError('features must be a dense bounded array');
  }
  const features = featureEntries.map((f) => featureInBounds(f, project));
  if (new Set(features.map((f) => f.id)).size !== features.length) {
    throw new TypeError('features must have distinct ids and be bounded');
  }
  const assumptionEntries = input.assumptions ?? [];
  if (!denseArray(assumptionEntries, 30)) {
    throw new TypeError('assumptions must be a dense bounded array');
  }
  const assumptions = assumptionEntries.map((a) => text(a, 'assumption', 500));
  return freeze({
    id: identifier(input.operationId, 'operation id'),
    actorId: identifier(input.actorId, 'actor id'),
    kind: 'draft-scenario',
    targetId: `community-plan:${project.id}:${alternativeId}`,
    field: 'proposal',
    counter,
    value: {
      schemaVersion: COMMUNITY_PLANNING_SCHEMA_VERSION,
      projectId: project.id,
      alternativeId,
      title: text(input.title, 'alternative title'),
      baselineRevision: project.baseline.revision,
      state: 'hypothesis',
      features,
      assumptions,
      modeledImpact: 'not-evaluated',
      approval: 'not-requested',
    },
  });
}

/** Read the existing merge kernel's authored projection without promoting claims. */
export function listPlanningAlternatives(project, collaborationState) {
  const prefix = `draft-scenario:community-plan:${project.id}:`;
  return freeze(Object.entries(collaborationState?.authored ?? {})
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, entry]) => {
      const candidate = entry?.fields?.proposal?.value;
      const id = key.slice(prefix.length);
      if (!candidate || entry?.kind !== 'draft-scenario' ||
          entry?.targetId !== `community-plan:${project.id}:${id}` ||
          candidate.schemaVersion !== COMMUNITY_PLANNING_SCHEMA_VERSION ||
          candidate.projectId !== project.id ||
          candidate.alternativeId !== id ||
          candidate.baselineRevision !== project.baseline.revision ||
          candidate.state !== 'hypothesis' ||
          candidate.modeledImpact !== 'not-evaluated' ||
          candidate.approval !== 'not-requested' ||
          !Array.isArray(candidate.features) || !Array.isArray(candidate.assumptions)) {
        return null;
      }
      try {
        const validated = createPlanningAlternativeOperation(project, {
          operationId: 'view-validation', actorId: 'local', counter: 0,
          alternativeId: id, title: candidate.title, features: candidate.features,
          assumptions: candidate.assumptions,
        }).value;
        const provenance = entry?.fields?.proposal;
        const clock = provenance?.clock;
        const hasRecordedActor = (
          typeof clock?.actorId === 'string' &&
          ID_PATTERN.test(clock.actorId) &&
          typeof clock?.operationId === 'string' &&
          ID_PATTERN.test(clock.operationId) &&
          Number.isSafeInteger(clock.counter) &&
          clock.counter >= 0 &&
          provenance.operationId === clock.operationId
        );
        return {
          ...validated,
          authorship: hasRecordedActor
            ? { status: 'recorded', actorId: clock.actorId,
                operationId: clock.operationId, counter: clock.counter }
            : { status: 'unknown', actorId: null,
                operationId: null, counter: null },
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.alternativeId < b.alternativeId ? -1 : a.alternativeId > b.alternativeId ? 1 : 0,
    ));
}

/** Game/co-op is a local presentation choice; never synced as authority. */
export function planningView(project, collaborationState, mode = 'co-op') {
  if (!PLANNING_VIEW_MODES.includes(mode)) throw new TypeError('unsupported planning mode');
  return freeze({
    mode,
    projectId: project.id,
    baselineRevision: project.baseline.revision,
    baselineState: 'reference-only',
    alternatives: listPlanningAlternatives(project, collaborationState),
    effectPrediction: 'not-modeled',
    officialApproval: 'not-requested',
    // No game scoring or real-world authorization is manufactured here.
  });
}
