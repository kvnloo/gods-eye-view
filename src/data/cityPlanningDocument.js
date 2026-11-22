import {
  createCommunityPlanningProject,
  createPlanningAlternativeOperation,
} from './communityPlanning.js';
import {
  applyCollaborationOperations,
  createCollaborationState,
} from './collaborationAuthority.js';
import { plotValue } from './cityPlot.js';
import { CITY_LAND_USES, MAX_ZONED_PLOTS } from './cityLandUse.js';

export { CITY_LAND_USES };

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_LENGTH = 600_000;
const CONCEPT_LABEL = 'AI concept, not a plan or an approval';
const BASELINE_REVISION = 'city-reference-v1';
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const encoder = new TextEncoder();

function fail(message) {
  throw new TypeError(message);
}

function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('object required');
  }
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    fail(`expected exact keys: ${expected.join(', ')}`);
  }
}

// Check before stringify so getters, sparse arrays and toJSON cannot repair input.
function jsonData(value, ancestors = new Set(), depth = 0) {
  if (depth > 20) fail('document nesting exceeds limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value))
    fail('plain JSON data required');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    fail('plain JSON containers required');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (array && (value.length > 120 || ownKeys.length !== value.length + 1))
    fail('dense bounded arrays required');
  ancestors.add(value);
  for (const key of ownKeys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      fail('enumerable data properties required');
    }
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
      fail('dense array required');
    jsonData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function boundedJson(value) {
  jsonData(value);
  const json = JSON.stringify(value);
  if (encoder.encode(json).length > MAX_DOCUMENT_BYTES)
    fail('city document exceeds 4 MiB');
  return json;
}

function list(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail('array length exceeds schema limits');
}

function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(`invalid ${label}`);
  return value.trim();
}

function identifier(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value))
    fail('bounded lowercase id required');
  return value;
}

function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    fail('UTC ISO timestamp required');
  }
  const date = new Date(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized)
    fail('invalid ISO timestamp');
  return value;
}

function raster(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_LENGTH)
    fail('image exceeds 600k data URL limit');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match || match[2].length % 4 !== 0)
    fail('base64 PNG or JPEG data URL required');
  let bytes;
  try {
    bytes = atob(match[2]);
  } catch {
    fail('invalid base64 image');
  }
  if (btoa(bytes) !== match[2]) fail('noncanonical base64 image');
  const signature =
    match[1] === 'png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (!signature.every((byte, index) => bytes.charCodeAt(index) === byte))
    fail('image signature disagrees with MIME type');
  return value;
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
      (name) => Object.hasOwn(right, name) && same(left[name], right[name]),
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

function projectFor(id, title, reference) {
  return createCommunityPlanningProject({
    id,
    title,
    place: { label: title, bounds: reference.bounds },
    baseline: { revision: BASELINE_REVISION, sources: reference.sources },
  });
}

function referenceValue(value) {
  keys(value, ['camera', 'bounds', 'sources', 'capturedAt', 'image']);
  keys(value.camera, ['lat', 'lon', 'alt', 'heading', 'pitch', 'roll']);
  for (const coordinate of Object.values(value.camera)) {
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate))
      fail('finite camera coordinates required');
  }
  if (Math.abs(value.camera.lat) > 90 || Math.abs(value.camera.lon) > 180)
    fail('camera outside globe');
  list(value.sources, 0, 30);
  value.sources.forEach((source) =>
    keys(source, ['id', 'revision', 'url', 'attribution', 'license']),
  );
  const project = projectFor('reference', 'Reference', value);
  return {
    camera: { ...value.camera },
    bounds: [...project.place.bounds],
    sources: project.baseline.sources.map((source) => ({ ...source })),
    capturedAt: timestamp(value.capturedAt),
    image: raster(value.image),
  };
}

function parameterValue(value) {
  // `site` (a candidate site id, or null for unplaced) postdates v1 documents.
  const placed = Object.hasOwn(Object(value), 'site');
  keys(value, [
    'kind',
    'trees',
    'widthMeters',
    'shadePercent',
    ...(placed ? ['site'] : []),
  ]);
  if (placed && value.site !== null) identifier(value.site);
  if (!['park', 'bike-lane', 'plaza'].includes(value.kind))
    fail('unsupported alternative kind');
  if (!Number.isInteger(value.trees) || value.trees < 0 || value.trees > 200)
    fail('trees must be integer 0..200');
  if (
    typeof value.widthMeters !== 'number' ||
    !Number.isFinite(value.widthMeters) ||
    value.widthMeters < 0.5 ||
    value.widthMeters > 20
  )
    fail('widthMeters must be number 0.5..20');
  if (
    !Number.isInteger(value.shadePercent) ||
    value.shadePercent < 0 ||
    value.shadePercent > 100
  )
    fail('shadePercent must be integer 0..100');
  return {
    kind: value.kind,
    trees: value.trees,
    widthMeters: value.widthMeters,
    shadePercent: value.shadePercent,
    ...(placed ? { site: value.site } : {}),
  };
}

function editValue(input) {
  keys(input, ['title', 'description', 'parameters']);
  return {
    title: text(input.title, 'alternative title'),
    description: text(input.description, 'description', 500),
    parameters: parameterValue(input.parameters),
  };
}

// A play-mode site: the snapped plot and the view captured for it. A null
// reference means the project baseline was captured for this plot.
function siteValue(value, baseline) {
  keys(value, ['plot', 'reference']);
  const plot = plotValue(value.plot);
  const reference =
    value.reference === null ? null : referenceValue(value.reference);
  const [west, south, east, north] = (reference ?? baseline).bounds;
  const { lat, lon } = plot.center;
  if (lon < west || lon > east || lat < south || lat > north)
    fail('plot must lie inside its captured view');
  return { plot, reference };
}

// Optional `zoning`: one proposed land use per snapped plot, never empty.
function zoningValue(value) {
  list(value, 1, MAX_ZONED_PLOTS);
  const ids = new Set();
  return value.map((entry) => {
    keys(entry, ['plot', 'use']);
    const plot = plotValue(entry.plot);
    if (!CITY_LAND_USES.includes(entry.use)) fail('unsupported land use');
    if (ids.has(plot.id)) fail('one land use per plot');
    ids.add(plot.id);
    return { plot, use: entry.use };
  });
}

function sourceOf(alternative, baseline) {
  return alternative.site?.reference ?? baseline;
}

function operationFor(project, alternativeId, index, revision, edit) {
  return createPlanningAlternativeOperation(project, {
    // Slots are stable because alternatives cannot be deleted or reordered.
    // Including the slot avoids truncation collisions between long alternative ids.
    operationId: `city-${project.id.slice(0, 40)}-a${index + 1}-v${revision}`,
    actorId: 'local-author',
    counter: revision,
    alternativeId,
    title: edit.title,
    features: [],
    assumptions: [edit.description, JSON.stringify(edit.parameters)],
  });
}

function versionFor(project, alternativeId, index, revision, edit) {
  return {
    revision,
    parentRevision: revision === 1 ? null : revision - 1,
    ...edit,
    operation: operationFor(project, alternativeId, index, revision, edit),
    concept: null,
  };
}

function conceptValue(value, reference, importing = false) {
  const fields = ['prompt', 'provider', 'generatedAt', 'sourceView', 'image'];
  if (importing || Object.hasOwn(value, 'label')) fields.push('label');
  keys(value, fields);
  if (Object.hasOwn(value, 'label') && value.label !== CONCEPT_LABEL)
    fail('concept label must remain non-authoritative');
  const sourceView = referenceValue(value.sourceView);
  if (!same(sourceView, reference))
    fail('concept provenance must match captured reference exactly');
  return {
    prompt: text(value.prompt, 'concept prompt', 4000),
    provider: text(value.provider, 'concept provider', 160),
    generatedAt: timestamp(value.generatedAt),
    sourceView,
    image: raster(value.image),
    label: CONCEPT_LABEL,
  };
}

function documentValue(value) {
  boundedJson(value);
  const zoned = Object.hasOwn(Object(value), 'zoning');
  keys(value, [
    'schemaVersion',
    'kind',
    'project',
    'reference',
    'alternatives',
    ...(zoned ? ['zoning'] : []),
  ]);
  if (value.schemaVersion !== 1 || value.kind !== 'city-builder')
    fail('unsupported city document schema');
  const reference = referenceValue(value.reference);
  const project = projectFor(
    value.project?.id,
    value.project?.title,
    reference,
  );
  if (!same(value.project, project))
    fail('project must be the exact reference-only kernel project');
  list(value.alternatives, 0, 6);
  const ids = new Set();
  const alternatives = value.alternatives.map((alternative, index) => {
    const isSited = Object.hasOwn(alternative ?? {}, 'site');
    keys(
      alternative,
      isSited ? ['id', 'site', 'versions'] : ['id', 'versions'],
    );
    const id = identifier(alternative.id);
    if (ids.has(id)) fail('duplicate alternative id');
    ids.add(id);
    const site = isSited ? siteValue(alternative.site, reference) : null;
    const source = site?.reference ?? reference;
    list(alternative.versions, 1, 20);
    const versions = alternative.versions.map((version, versionIndex) => {
      keys(version, [
        'revision',
        'parentRevision',
        'title',
        'description',
        'parameters',
        'operation',
        'concept',
      ]);
      const edit = editValue({
        title: version.title,
        description: version.description,
        parameters: version.parameters,
      });
      const expected = versionFor(project, id, index, versionIndex + 1, edit);
      if (version.concept !== null)
        expected.concept = conceptValue(version.concept, source, true);
      if (!same(version, expected))
        fail(
          'version or proposal differs from its constructor-produced history',
        );
      return expected;
    });
    return site ? { id, site, versions } : { id, versions };
  });
  const result = {
    schemaVersion: 1,
    kind: 'city-builder',
    project,
    reference,
    alternatives,
    ...(zoned ? { zoning: zoningValue(value.zoning) } : {}),
  };
  if (!same(value, result)) fail('noncanonical city document');
  return freeze(result);
}

/** Start a project from one captured reference view; it has no alternatives yet. */
export function createCityDocument(input) {
  boundedJson(input);
  keys(input, ['id', 'title', 'reference']);
  const reference = referenceValue(input.reference);
  const project = projectFor(input.id, input.title, reference);
  return documentValue({
    schemaVersion: 1,
    kind: 'city-builder',
    project,
    reference,
    alternatives: [],
  });
}

/** Append a possible world (version 1). A project holds at most six. */
export function addCityAlternative(document, input) {
  const doc = documentValue(document);
  boundedJson(input);
  const isSited = Object.hasOwn(input ?? {}, 'site');
  keys(
    input,
    isSited
      ? ['id', 'title', 'description', 'parameters', 'site']
      : ['id', 'title', 'description', 'parameters'],
  );
  const id = identifier(input.id);
  const site = isSited ? siteValue(input.site, doc.reference) : null;
  if (
    doc.alternatives.length >= 6 ||
    doc.alternatives.some((alternative) => alternative.id === id)
  )
    fail('alternative limit or duplicate id');
  const edit = editValue({
    title: input.title,
    description: input.description,
    parameters: input.parameters,
  });
  const version = versionFor(doc.project, id, doc.alternatives.length, 1, edit);
  return documentValue({
    ...doc,
    alternatives: [
      ...doc.alternatives,
      site ? { id, site, versions: [version] } : { id, versions: [version] },
    ],
  });
}

function currentAlternative(doc, id, revision) {
  const index = doc.alternatives.findIndex(
    (alternative) => alternative.id === id,
  );
  if (index < 0) fail('unknown alternative');
  const alternative = doc.alternatives[index];
  if (
    !Number.isSafeInteger(revision) ||
    revision !== alternative.versions.length
  )
    fail('stale alternative revision');
  return { alternative, index };
}

/** Save the next version of an alternative; a stale parent revision fails. */
export function reviseCityAlternative(document, id, parentRevision, input) {
  const doc = documentValue(document);
  const { alternative, index } = currentAlternative(doc, id, parentRevision);
  if (alternative.versions.length >= 20) fail('version limit reached');
  boundedJson(input);
  const edit = editValue(input);
  const version = versionFor(doc.project, id, index, parentRevision + 1, edit);
  return documentValue({
    ...doc,
    alternatives: doc.alternatives.map((entry, i) =>
      i === index
        ? { ...entry, versions: [...entry.versions, version] }
        : entry,
    ),
  });
}

/** Attach one labelled AI concept to an alternative's latest version. */
export function attachCityConcept(document, id, revision, concept) {
  const doc = documentValue(document);
  const { alternative, index } = currentAlternative(doc, id, revision);
  if (alternative.versions.at(-1).concept !== null)
    fail('save a new version before attaching another concept');
  boundedJson(concept);
  const attached = conceptValue(concept, sourceOf(alternative, doc.reference));
  return documentValue({
    ...doc,
    alternatives: doc.alternatives.map((entry, i) =>
      i === index
        ? {
            ...entry,
            versions: entry.versions.map((version) =>
              version.revision === revision
                ? { ...version, concept: attached }
                : version,
            ),
          }
        : entry,
    ),
  });
}

/** Validate a whole saved or imported document; anything unexpected fails closed. */
export function parseCityDocument(json) {
  if (
    typeof json !== 'string' ||
    json.length > MAX_DOCUMENT_BYTES ||
    encoder.encode(json).length > MAX_DOCUMENT_BYTES
  )
    fail('city document JSON must be at most 4 MiB');
  return documentValue(JSON.parse(json));
}

/** The canonical JSON a project is saved and exported as. */
export function serializeCityDocument(document) {
  return JSON.stringify(documentValue(document));
}

/** Rebuild from proposals only. No persisted collaboration or authority state enters replay. */
export function replayCityDocument(document) {
  const doc = documentValue(document);
  const operations = doc.alternatives.flatMap((alternative) =>
    alternative.versions.map((version) => version.operation),
  );
  return freeze(
    applyCollaborationOperations(createCollaborationState(), operations),
  );
}

/** Set (or with `use: null` clear) one plot's proposed land use. */
export function setCityZoning(document, plot, use) {
  const doc = documentValue(document);
  const cell = plotValue(plot);
  if (use !== null && !CITY_LAND_USES.includes(use))
    fail('unsupported land use');
  const rest = (doc.zoning ?? []).filter((z) => z.plot.id !== cell.id);
  const zoning = use === null ? rest : [...rest, { plot: cell, use }];
  const base = Object.fromEntries(
    Object.entries(doc).filter(([key]) => key !== 'zoning'),
  );
  return documentValue(zoning.length ? { ...base, zoning } : base);
}

/** The project's proposed land uses, one per plot (empty when none). */
export function cityZoning(document) {
  return documentValue(document).zoning ?? [];
}

/** Each alternative's latest version with its id and version count. */
export function cityAlternatives(document) {
  const doc = documentValue(document);
  return freeze(
    doc.alternatives.map((alternative) => ({
      ...alternative.versions.at(-1),
      id: alternative.id,
      versionCount: alternative.versions.length,
      site: alternative.site ?? null,
    })),
  );
}
