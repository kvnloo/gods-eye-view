/** Links that open God's Eye View at a view. */

import { createHumanDecisionBrief } from './brief.js';
import { VIEW_PROPERTIES, createView, viewUrl } from '../../view/index.js';
import { defineTool, ToolError } from '../catalog.js';
import { GLOBE_PANEL_URI } from '../globePanel.js';
import { AREA_SCHEMA, resolveArea } from '../area.js';
import { cameraForArea, cameraLookingAt } from '../views.js';

/** Tool arguments that describe a view: an area to frame, or a camera. */
export const VIEW_ARGUMENTS = Object.freeze({
  view: Object.freeze({
    type: 'object',
    description:
      'A view another answer returned (its data.view), shown as it is; ' +
      'other arguments given with it change that part of it.',
  }),
  area: AREA_SCHEMA,
  ...VIEW_PROPERTIES,
});

// Altitude a view framed on a followed aircraft starts from.
const FOLLOW_ALTITUDE_M = 20_000;

/** Where a followed aircraft is now, or null when no feed reports it. */
async function followedAircraftPosition(follow, tools) {
  if (!['aircraft', 'military_aircraft'].includes(follow?.kind)) return null;
  if (!tools?.has('find_aircraft')) return null;
  try {
    const { data } = await tools.call('find_aircraft', { icao24: follow.id });
    const row = data?.rows?.find(
      (item) => Number.isFinite(item.lat) && Number.isFinite(item.lon),
    );
    return row ? { lat: row.lat, lon: row.lon } : null;
  } catch {
    return null;
  }
}

/**
 * The view described by tool arguments. An area frames the camera straight
 * down over it; camera fields given alongside it override the framing. A
 * view that only follows an aircraft is framed where the aircraft is now.
 */
export async function resolveViewArguments(args, { services, signal, tools }) {
  const base = args.view && typeof args.view === 'object' ? args.view : {};
  let camera = args.area
    ? { ...args.camera }
    : { ...base.camera, ...args.camera };
  let label = null;
  if (args.area) {
    const area = await resolveArea(args.area, { services, signal });
    label = area.label;
    const framed = cameraForArea(area);
    // A tilted view of an area looks at its center from behind, unless the
    // caller placed the camera itself.
    camera =
      camera.lat === undefined && camera.lon === undefined
        ? cameraLookingAt(framed, {
            altitudeM: camera.altitude_m ?? framed.altitude_m,
            headingDeg: camera.heading_deg ?? 0,
            pitchDeg: camera.pitch_deg ?? -90,
          })
        : { ...framed, ...camera };
  }
  const follow = args.follow ?? base.follow ?? null;
  if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) {
    const position = await followedAircraftPosition(follow, tools);
    if (!position)
      throw new ToolError(
        'invalid_arguments',
        follow
          ? `${follow.id} is not reported now; give an area or a camera with lat and lon too`
          : 'Give a view, an area, or a camera with lat and lon',
      );
    camera = { altitude_m: FOLLOW_ALTITUDE_M, ...camera, ...position };
    label = `${follow.kind === 'military_aircraft' ? 'military aircraft' : 'aircraft'} ${follow.id}`;
  }
  let view;
  try {
    view = createView({
      camera,
      layers: args.layers ?? base.layers,
      style: args.style ?? base.style ?? null,
      map: args.map ?? base.map ?? null,
      follow,
      annotations: args.annotations ?? base.annotations ?? [],
    });
  } catch (error) {
    // A view passed through can hold anything; report it as bad arguments.
    throw new ToolError('invalid_arguments', error.message);
  }
  return {
    view,
    label:
      label ?? `${view.camera.lat.toFixed(3)}, ${view.camera.lon.toFixed(3)}`,
  };
}

function appBase(services) {
  try {
    return new URL(services.app.baseUrl).href;
  } catch {
    throw new ToolError('unavailable', "The app's address is not configured");
  }
}

export const showInGodsEyeView = defineTool({
  name: 'show_in_gods_eye_view',
  title: "Show in God's Eye View",
  description:
    "Shows a view in God's Eye View: in clients that display apps, the live " +
    "God's Eye View globe in the conversation; everywhere, a link that opens " +
    'it. Pass the view another answer returned, or describe one: an area ' +
    'framed from above or a camera position, with chosen data layers, visual ' +
    'style and map, optionally following an aircraft (or riding in its ' +
    'cockpit view) or a satellite, and with marks drawn on the map.',
  inputSchema: {
    type: 'object',
    properties: VIEW_ARGUMENTS,
    additionalProperties: false,
  },
  requires: ['app'],
  ui: { resourceUri: GLOBE_PANEL_URI },
  async run(args, { services, signal, tools }) {
    const base = appBase(services);
    const { view, label } = await resolveViewArguments(args, {
      services,
      signal,
      tools,
    });
    const url = viewUrl(base, view);
    return {
      summary: `Open ${label} in God's Eye View: ${url}`,
      data: { url, view },
    };
  },
});

/** Reference-only export: never invoke an app action or external workflow. */
function briefMarkdownText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\\x60*_{}\[\]()#+.!|])/g, '\\$1');
}

function briefMarkdownLink(label, url) {
  return (
    '[' +
    briefMarkdownText(label) +
    '](' +
    url.replace(/\(/g, '%28').replace(/\)/g, '%29') +
    ')'
  );
}

/**
 * Render a validated historical evidence packet as plain Markdown and JSON.
 * Inputs cannot carry arbitrary HTML, media, action endpoints or decisions;
 * links point only to the source owner and an external human review workflow.
 * @param {object} packet The frozen-input logical packet (no live tool calls).
 * @returns {{ receipt: object, json: string, markdown: string }}
 */
export function exportHumanDecisionBrief(packet) {
  const receipt = createHumanDecisionBrief(packet);
  const sources = new Map(receipt.sources.map((source) => [source.id, source]));
  const showTime = (value) => value ?? 'unknown';
  const showClaim = (claim) => {
    const refs = claim.sourceIds.length
      ? claim.sourceIds
          .map((id) => briefMarkdownLink(id, sources.get(id).url))
          .join(', ')
      : 'none (explicit evidence gap)';
    return (
      '- [' +
      briefMarkdownText(claim.status) +
      '] ' +
      briefMarkdownText(claim.statement) +
      ' — observation time: ' +
      showTime(claim.observedAt) +
      '; uncertainty: ' +
      briefMarkdownText(claim.uncertainty) +
      '; sources: ' +
      refs
    );
  };
  const section = (title, findings) => [
    '## ' + title,
    '',
    ...(findings.length ? findings.map(showClaim) : ['None recorded.']),
    '',
  ];
  const lines = [
    '# Read-only evidence handoff',
    '',
    'Draft reference for human review; not an official report or authorization.',
    '',
    'Question: ' + briefMarkdownText(receipt.question),
    'Packet: ' +
      briefMarkdownText(receipt.packet.id) +
      ' (revision ' +
      briefMarkdownText(receipt.packet.revision) +
      ')',
    'Packet captured: ' + receipt.packet.capturedAt,
    'Local author reference: ' + (receipt.packet.authorRef ?? 'not provided'),
    '',
    '## Sources, timestamps and rights',
    '',
    ...receipt.sources.map(
      (source) =>
        '- ' +
        briefMarkdownLink(source.id, source.url) +
        ' — revision ' +
        briefMarkdownText(source.revision) +
        '; observed ' +
        showTime(source.observedAt) +
        '; recorded ' +
        source.recordedAt +
        '; rights ' +
        briefMarkdownText(source.rights) +
        '; license ' +
        briefMarkdownText(source.license) +
        '; attribution ' +
        briefMarkdownText(source.attribution),
    ),
    '',
    ...section('Observed — source-reported, not verified', receipt.findings.observed),
    ...section('Modeled / hypothetical — not observations', receipt.findings.modeled),
    ...section('Unknowns / absences', receipt.findings.unknowns),
    ...section('Stale evidence', receipt.findings.stale),
    ...section('Conflicts', receipt.findings.conflicts),
    '## External decision / commitment',
    '',
    'Not recorded by GEV. Refer to ' +
      briefMarkdownLink(
        receipt.externalDecision.workflow.label,
        receipt.externalDecision.workflow.url,
      ) +
      ' for an authorized human decision.',
    '',
    '## Limits',
    '',
    ...receipt.limitations.map((limit) => '- ' + limit),
  ];
  return {
    receipt,
    json: JSON.stringify(receipt, null, 2) + '\n',
    markdown: lines.join('\n') + '\n',
  };
}
