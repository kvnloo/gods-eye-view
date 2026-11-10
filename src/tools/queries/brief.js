/** Composite queries that combine other tools' answers for one area. */

import { suggestView } from '../views.js';
import { feedProvenanceEnvelope } from '../../data/layerSnapshot.js';
import { defineTool, ToolError } from '../catalog.js';
import {
  AREA_SCHEMA,
  POINT_SCHEMA,
  areaCenter,
  resolveArea,
  resolvePoint,
} from '../area.js';

const SECTION_LIMIT = 5;
const AWARENESS_LIMIT = 10;
const AWARENESS_RADIUS_KM = 250;

/** Brief sections: the tool each one calls and the arguments it passes. */
const SECTIONS = [
  {
    key: 'weather',
    label: 'Weather',
    tool: 'get_weather',
    args: (area, center) => ({
      location: area.argument.place
        ? { place: area.argument.place }
        : { lat: center.lat, lon: center.lon },
    }),
  },
  {
    key: 'earthquakes',
    layer: 'earthquakes',
    label: 'Earthquakes',
    tool: 'get_earthquakes',
    args: (area) => ({ area: area.argument, limit: SECTION_LIMIT }),
  },
  {
    key: 'fires',
    layer: 'local-firms',
    label: 'Active fires',
    tool: 'get_active_fires',
    args: (area) => ({ area: area.argument, limit: SECTION_LIMIT }),
  },
  {
    key: 'aircraft',
    layer: 'flights',
    label: 'Aircraft',
    tool: 'aircraft_in_area',
    args: (area) => ({ area: area.argument, limit: SECTION_LIMIT }),
  },
  {
    key: 'vessels',
    layer: 'ais-live-vessels',
    label: 'Ships',
    tool: 'vessels_in_area',
    args: (area) => ({ area: area.argument, limit: SECTION_LIMIT }),
  },
  {
    key: 'cyclones',
    layer: 'weather-cyclones',
    label: 'Tropical cyclones',
    tool: 'get_cyclones',
    args: (area) => ({ area: area.argument }),
  },
];

/** Military contacts around a point, as the app's military awareness panel. */
const AWARENESS_SECTIONS = [
  {
    key: 'military_aircraft',
    tool: 'aircraft_in_area',
    args: (area) => ({
      area: area.argument,
      military: true,
      limit: AWARENESS_LIMIT,
    }),
  },
  {
    key: 'aircraft',
    tool: 'aircraft_in_area',
    args: (area) => ({ area: area.argument, limit: AWARENESS_LIMIT }),
  },
  {
    key: 'vessels',
    tool: 'vessels_in_area',
    args: (area) => ({ area: area.argument, limit: AWARENESS_LIMIT }),
  },
  {
    key: 'installations',
    tool: 'find_military_installations',
    args: (area) => ({ area: area.argument, limit: AWARENESS_LIMIT }),
  },
];

/** A section's feed state for the caption, from what its result reported. */
function sectionFeedState(section) {
  if (section.unavailable) return 'unavailable';
  const data = section.data || {};
  if (data.freshness === 'stale' || data.stale === true) return 'stale';
  // Answered, but some of the feeds or satellites behind it did not.
  if (data.missing_sources?.length || data.unavailable_feeds?.length)
    return 'degraded';
  return 'nominal';
}

/**
 * The resolved area, plus the argument sections receive. A named place is
 * passed by name, so sections resolve it to the same point and label as a
 * direct query does (place lookups are cached).
 */
function sectionArea(resolved, original) {
  return {
    ...resolved,
    argument: original?.place
      ? { place: original.place }
      : resolved.center
        ? {
            lat: resolved.center.lat,
            lon: resolved.center.lon,
            radius_km: resolved.center.radiusKm,
          }
        : {
            bbox: [
              resolved.west,
              resolved.south,
              resolved.east,
              resolved.north,
            ],
          },
  };
}

/**
 * Run every section whose tool the catalog offers, through the catalog so
 * replaced tools and interceptors apply. A failing section is reported as
 * unavailable instead of failing the whole answer.
 */
async function runSections(all, area, { tools, signal }) {
  const center = areaCenter(area);
  const sections = all.filter(({ tool }) => tools.has(tool));
  const results = await Promise.allSettled(
    sections.map(({ tool, args: build }) =>
      tools.call(tool, build(area, center)),
    ),
  );
  signal?.throwIfAborted();
  const answers = {};
  const lines = [];
  sections.forEach(({ key }, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      answers[key] = { summary: result.value.summary, data: result.value.data };
      lines.push(result.value.summary);
    } else {
      const known = result.reason instanceof ToolError;
      answers[key] = {
        unavailable: true,
        reason: known ? result.reason.message : 'unavailable right now',
      };
    }
  });
  return { center, answers, lines };
}

async function buildBrief(args, { services, signal, tools }) {
  // Sections receive the resolved box so a place name is looked up once.
  const area = sectionArea(
    await resolveArea(args.area, { services, signal }),
    args.area,
  );
  const { center, answers, lines } = await runSections(SECTIONS, area, {
    tools,
    signal,
  });
  return { area, center, brief: answers, lines };
}

export const situationBrief = defineTool({
  name: 'situation_brief',
  title: 'Situation brief',
  description:
    'One overview of an area: current weather, recent earthquakes, active ' +
    'fires, aircraft overhead, ships and tropical cyclones, each summarized with ' +
    'its top items. Sections that are unavailable are marked as such.',
  inputSchema: {
    type: 'object',
    properties: { area: AREA_SCHEMA },
    required: ['area'],
    additionalProperties: false,
  },
  requires: ['weather'],
  async run(args, context) {
    const { area, brief, lines } = await buildBrief(args, context);
    return {
      summary: `Situation in ${area.label}: ${lines.join(' ')}`,
      data: {
        view: suggestView(context.services, {
          area,
          layers: SECTIONS.filter(({ key }) => brief[key])
            .map(({ layer }) => layer)
            .filter(Boolean),
        }),
        area: area.label,
        sections: brief,
      },
    };
  },
});

export const getHudCaption = defineTool({
  name: 'get_hud_caption',
  title: 'Heads-up display caption',
  description:
    "The short heads-up display caption God's Eye View would show for an " +
    'area, written by the app from the same overview situation_brief gives.',
  inputSchema: {
    type: 'object',
    properties: { area: AREA_SCHEMA },
    required: ['area'],
    additionalProperties: false,
  },
  requires: ['weather', 'summary'],
  async run(args, context) {
    const { area, center, brief, lines } = await buildBrief(args, context);
    // The app's caption context: place labels and each section as a layer
    // with the feed state its result reported, failures included.
    const layers = SECTIONS.filter(({ key }) => brief[key]).map(
      ({ key, label }) => ({
        id: key,
        name: label,
        enabled: true,
        feedState: sectionFeedState(brief[key]),
      }),
    );
    const response = await context.services.summary.summarize(
      {
        placeLabels: [area.label],
        location: area.label,
        center,
        observations: lines,
        enabledLayerLabels: layers.map((layer) => layer.name),
        enabledLayers: layers.map(({ id, name, feedState }) => ({
          id,
          name,
          feedState,
        })),
        feedProvenance: feedProvenanceEnvelope(layers),
      },
      { signal: context.signal },
    );
    const caption = response?.data?.summary;
    if (!response?.ok || typeof caption !== 'string' || !caption)
      throw new ToolError('unavailable', 'The caption service did not answer');
    return {
      summary: caption,
      data: { area: area.label, caption },
    };
  },
});

export const militaryAwareness = defineTool({
  name: 'military_awareness',
  title: 'Military awareness',
  description:
    'Military contacts around a location, as the military awareness panel ' +
    'shows them: military aircraft, other aircraft, ships and mapped ' +
    `military installations within ${AWARENESS_RADIUS_KM} km by default, ` +
    'each nearest first. Sections that are unavailable are marked as such.',
  inputSchema: {
    type: 'object',
    properties: {
      location: POINT_SCHEMA,
      radius_km: { type: 'number', minimum: 1, maximum: AWARENESS_RADIUS_KM },
    },
    required: ['location'],
    additionalProperties: false,
  },
  requires: ['military'],
  async run(args, { services, signal, tools }) {
    const point = await resolvePoint(args.location, { services, signal });
    const radiusKm = args.radius_km ?? AWARENESS_RADIUS_KM;
    const area = sectionArea(
      await resolveArea(
        { lat: point.lat, lon: point.lon, radius_km: radiusKm },
        { services, signal },
      ),
    );
    const { answers, lines } = await runSections(AWARENESS_SECTIONS, area, {
      tools,
      signal,
    });
    return {
      summary: `Military awareness within ${radiusKm} km of ${point.label}: ${lines.join(' ')}`,
      data: {
        view: suggestView(services, {
          area,
          layers: ['military', 'ais-live-vessels', 'military-installations'],
        }),
        location: point,
        radius_km: radiusKm,
        sections: answers,
      },
    };
  },
});

/**
 * Build a deterministic, reference-only handoff from one pinned historical
 * packet. This never queries providers or records an external decision.
 * Unknown fields are rejected rather than silently carrying raw media or
 * claims of operational authority into a shareable receipt.
 */
const BRIEF_SCHEMA = 'gev-human-readonly-brief/v1';
const HANDOFF_SOURCE_LIMIT = 25;
const HANDOFF_CLAIM_LIMIT = 50;
const SOURCE_RIGHTS = new Set([
  'redistributable',
  'reference-only',
  'restricted',
  'unknown',
]);
const CLAIM_LANES = new Set(['observed', 'modeled']);
const CLAIM_STATUSES = new Set([
  'reported',
  'stale',
  'unknown',
  'conflicted',
  'absent',
]);
const REFERENCE_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RAW_MEDIA = /(?:data:|blob:|base64|<\s*\/?\s*(?:img|video|audio)\b|!\[)/i;
const AUTHORITY_CLAIM =
  /\b(?:approved?|authori[sz]ed|cleared|clearance granted|safe to|dispatch(?:ed)?|deploy(?:ed)?|evacuat(?:e|ed|ion)|permission granted|officially|route (?:is )?open|open for travel|go-ahead)\b/i;

function exactFields(value, allowed, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(label + ' must be a plain object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(label + ' has unsupported field: ' + key);
    }
  }
  return value;
}

function handoffText(value, label, limit = 400) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > limit ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(value) ||
    RAW_MEDIA.test(value)
  ) {
    throw new TypeError(label + ' must be bounded, single-line reference text');
  }
  return value;
}

function handoffNarrative(value, label, limit = 400) {
  const text = handoffText(value, label, limit);
  if (AUTHORITY_CLAIM.test(text)) {
    throw new TypeError(
      'operational or approval assertions cannot be exported',
    );
  }
  return text;
}

function referenceId(value, label) {
  if (!REFERENCE_ID.test(handoffText(value, label, 64))) {
    throw new TypeError(label + ' must be an opaque reference ID');
  }
  return value;
}

function utcTimestamp(value, label) {
  if (
    typeof value !== 'string' ||
    !UTC_TIME.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(label + ' must be an explicit UTC timestamp');
  }
  const canonical = new Date(value).toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19)) {
    throw new TypeError(label + ' is not a calendar timestamp');
  }
  return canonical;
}

function optionalTimestamp(value, label) {
  return value == null ? null : utcTimestamp(value, label);
}

function referenceUrl(value, label) {
  const raw = handoffText(value, label, 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(label + ' must be an absolute source URL');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) =>
      /^(?:token|access_token|api_?key|password|session|signature|sig)$/i.test(
        key,
      ),
    )
  ) {
    throw new TypeError(
      label + ' must be a public, credential-free HTTP(S) URL',
    );
  }
  return url.href;
}

function sortById(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function handoffSource(input) {
  const row = exactFields(
    input,
    [
      'id',
      'revision',
      'url',
      'rights',
      'license',
      'attribution',
      'observedAt',
      'recordedAt',
    ],
    'source',
  );
  if (!SOURCE_RIGHTS.has(row.rights)) {
    throw new TypeError('source.rights must explicitly describe reuse rights');
  }
  return {
    id: referenceId(row.id, 'source.id'),
    revision: referenceId(row.revision, 'source.revision'),
    url: referenceUrl(row.url, 'source.url'),
    rights: row.rights,
    license: handoffNarrative(row.license, 'source.license', 120),
    attribution: handoffNarrative(row.attribution, 'source.attribution', 200),
    observedAt: optionalTimestamp(row.observedAt, 'source.observedAt'),
    recordedAt: utcTimestamp(row.recordedAt, 'source.recordedAt'),
  };
}

function handoffClaim(input, knownSources) {
  const row = exactFields(
    input,
    [
      'id',
      'lane',
      'status',
      'statement',
      'uncertainty',
      'observedAt',
      'sourceIds',
    ],
    'claim',
  );
  if (!CLAIM_LANES.has(row.lane) || !CLAIM_STATUSES.has(row.status)) {
    throw new TypeError('claim lane/status is unsupported');
  }
  if (
    !Array.isArray(row.sourceIds) ||
    row.sourceIds.length > HANDOFF_SOURCE_LIMIT
  ) {
    throw new TypeError('claim.sourceIds must be a bounded array');
  }
  const sourceIds = row.sourceIds.map((id) =>
    referenceId(id, 'claim.sourceIds'),
  );
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !knownSources.has(id)) ||
    (sourceIds.length === 0 && row.status !== 'unknown') ||
    (row.status === 'conflicted' && sourceIds.length < 2)
  ) {
    throw new TypeError('claim requires distinct, linked evidence sources');
  }
  const statement = handoffNarrative(row.statement, 'claim.statement');
  const uncertainty = handoffNarrative(row.uncertainty, 'claim.uncertainty');
  return {
    id: referenceId(row.id, 'claim.id'),
    lane: row.lane,
    status: row.status,
    statement,
    uncertainty,
    observedAt: optionalTimestamp(row.observedAt, 'claim.observedAt'),
    sourceIds: sourceIds.sort(),
  };
}

/**
 * @param {object} packet Pinned, historical evidence packet with explicit
 *   version, revision, source metadata, scoped findings and external workflow.
 * @returns {object} JSON-safe receipt; not a decision, live status or action.
 */
export function createHumanDecisionBrief(packet) {
  const input = exactFields(
    packet,
    [
      'schemaVersion',
      'id',
      'revision',
      'capturedAt',
      'question',
      'authorRef',
      'sources',
      'claims',
      'handoff',
    ],
    'packet',
  );
  if (input.schemaVersion !== 1) {
    throw new TypeError('packet schemaVersion 1 is required');
  }
  if (
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    input.sources.length > HANDOFF_SOURCE_LIMIT ||
    !Array.isArray(input.claims) ||
    input.claims.length > HANDOFF_CLAIM_LIMIT
  ) {
    throw new TypeError('packet sources/claims must be bounded arrays');
  }
  const sources = input.sources.map(handoffSource).sort(sortById);
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length) {
    throw new TypeError('duplicate source IDs');
  }
  const claims = input.claims
    .map((claim) => handoffClaim(claim, sourceIds))
    .sort(sortById);
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    throw new TypeError('duplicate claim IDs');
  }
  const handoff = exactFields(input.handoff, ['label', 'url'], 'handoff');
  const externalLabel = handoffText(handoff.label, 'handoff.label', 160);
  if (AUTHORITY_CLAIM.test(externalLabel)) {
    throw new TypeError(
      'handoff must name a review destination, not an approval',
    );
  }
  return {
    schema: BRIEF_SCHEMA,
    packet: {
      id: referenceId(input.id, 'packet.id'),
      revision: referenceId(input.revision, 'packet.revision'),
      capturedAt: utcTimestamp(input.capturedAt, 'packet.capturedAt'),
      authorRef:
        input.authorRef === undefined
          ? null
          : referenceId(input.authorRef, 'packet.authorRef'),
    },
    question: handoffNarrative(input.question, 'packet.question', 500),
    sources,
    findings: {
      observed: claims.filter((claim) => claim.lane === 'observed'),
      modeled: claims.filter((claim) => claim.lane === 'modeled'),
      unknowns: claims.filter((claim) =>
        ['unknown', 'absent'].includes(claim.status),
      ),
      stale: claims.filter((claim) => claim.status === 'stale'),
      conflicts: claims.filter((claim) => claim.status === 'conflicted'),
    },
    externalDecision: {
      status: 'not-recorded-by-gev',
      workflow: {
        label: externalLabel,
        url: referenceUrl(handoff.url, 'handoff.url'),
      },
    },
    limitations: [
      'Historical, pinned evidence only; no present conditions are inferred.',
      'Source-reported observations are not independently verified by GEV.',
      'No route clearance, approval, dispatch or allocation is recorded.',
      'Media is never embedded; source links are reference-only.',
    ],
  };
}
