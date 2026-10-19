/** Read-only wildfire evidence from GEV's existing public data sources. */

import { defineTool, ToolError } from '../catalog.js';
import { AREA_SCHEMA, resolveArea } from '../area.js';
import { suggestView } from '../views.js';

const SOURCES = Object.freeze([
  {
    key: 'detections',
    tool: 'get_active_fires',
    provider: 'NASA FIRMS',
    layer: 'local-firms',
    meaning: 'Satellite thermal detections, not confirmed incident boundaries',
  },
  {
    key: 'perimeters',
    tool: 'get_fire_perimeters',
    provider: 'NIFC WFIGS',
    layer: 'fire-perimeters',
    meaning: 'Mapped US incident perimeters, not a live fire front',
  },
  {
    key: 'cameras',
    tool: 'find_cctv_cameras',
    provider: 'GEV public camera catalog',
    layer: 'cctv',
    meaning: 'Candidate nearby cameras; no frames or smoke detections inspected',
  },
]);

const missing = (source, reason) => ({
  provider: source.provider,
  source_tool: source.tool,
  meaning: source.meaning,
  status: 'unavailable',
  reason,
  total: null,
  returned: 0,
  rows: [],
});

function evidenceSection(source, result) {
  const data = result?.data;
  if (!Array.isArray(data?.rows) || !Number.isInteger(data?.total))
    throw new ToolError('malformed', source.provider + ' returned malformed evidence');
  const issues = [];
  if (data.stale === true) issues.push('stale_cache');
  if (data.missing_sources?.length) issues.push('missing_satellite_sources');
  if (data.complete === false) issues.push('partial_camera_catalog');
  return {
    provider: source.provider,
    source_tool: source.tool,
    meaning: source.meaning,
    status: data.stale === true ? 'stale' : issues.length ? 'partial' : 'available',
    issues,
    total: data.total,
    returned: data.rows.length,
    truncated: data.truncated === true,
    // Original tool rows retain their source-specific timestamps and fields.
    rows: data.rows,
    ...(source.key === 'detections'
      ? {
          fetched_at: data.fetched_at ?? null,
          missing_sources: data.missing_sources ?? [],
        }
      : {}),
    ...(source.key === 'cameras'
      ? { catalog_trimmed: data.catalog_trimmed ?? [] }
      : {}),
  };
}

/**
 * Read a source through the catalog, preserving interceptors and unavailable
 * states. Never infer smoke, line-of-sight, containment or a safe route.
 */
async function readSource(source, area, limit, tools) {
  if (!tools.has(source.tool)) return missing(source, 'Source is not configured');
  try {
    const result = await tools.call(source.tool, { area, limit });
    return evidenceSection(source, result);
  } catch (error) {
    return missing(
      source,
      error instanceof ToolError ? error.message : 'Source unavailable right now',
    );
  }
}

/** Compose independent wildfire evidence without promoting proximity to proof. */
export const getWildfireIntelligence = defineTool({
  name: 'get_wildfire_intelligence',
  title: 'Open wildfire intelligence',
  description:
    'Compare NASA FIRMS fire detections, official US incident perimeters and ' +
    'cataloged public cameras in one area. Read-only evidence, not a smoke ' +
    'detector, verified fire location, or emergency safety assessment.',
  inputSchema: {
    type: 'object',
    properties: {
      area: AREA_SCHEMA,
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 25,
        description: 'Maximum rows per source (default 10).',
      },
    },
    required: ['area'],
    additionalProperties: false,
  },
  // Sources are optional: unavailable data must not hide other evidence.
  async run(args, { services, signal, tools }) {
    const area = await resolveArea(args.area, { services, signal });
    const sections = {};
    const rows = await Promise.all(
      SOURCES.map((source) => readSource(source, args.area, args.limit ?? 10, tools)),
    );
    signal?.throwIfAborted();
    for (let index = 0; index < SOURCES.length; index += 1)
      sections[SOURCES[index].key] = rows[index];

    const layers = SOURCES.filter(
      (source) => sections[source.key].status !== 'unavailable',
    ).map((source) => source.layer);
    const counts = SOURCES.map((source) => {
      const section = sections[source.key];
      return section.total === null
        ? source.key + ' unavailable'
        : section.total + ' ' + source.key + ' (' + section.status + ')';
    });
    return {
      summary:
        'Wildfire evidence in ' + area.label + ': ' + counts.join('; ') + '. ' +
        'These sources do not establish current fire behavior or camera visibility.',
      data: {
        area: area.label,
        view: suggestView(services, { area, layers }),
        sections,
        caveats: [
          'FIRMS hotspots are satellite thermal detections, not verified incidents.',
          'WFIGS covers US incident perimeters; mapped outlines are not live fire fronts.',
          'Cataloged cameras are potential viewpoints, not verified smoke observations.',
          'Absence of records is not evidence that an area is safe.',
        ],
        next_checks: [
          { tool: 'get_recent_imagery', purpose: 'Inspect dated imagery if available' },
          { tool: 'get_cctv_snapshot', purpose: 'Inspect a selected camera and its frame provenance' },
        ],
        action_authority: 'none',
      },
    };
  },
});
