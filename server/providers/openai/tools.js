import { createActionTools } from '../../../src/voice/actionSchemas.js';
import { ACTION_DESCRIPTIONS } from './toolDescriptions.js';

/** Every voice tool, as the Realtime session describes them. */
export const GEV_REALTIME_TOOLS = createActionTools(ACTION_DESCRIPTIONS);

/**
 * The session's tools: the app actions, then additional function tools
 * whose names no action already uses.
 */
export function realtimeSessionTools(additional = []) {
  const names = new Set(GEV_REALTIME_TOOLS.map((tool) => tool.name));
  return [
    ...GEV_REALTIME_TOOLS,
    ...additional.filter((tool) => !names.has(tool.name)),
  ];
}

/** Tools that need an operator-configured Overpass (OVERPASS_UPSTREAMS). */
export const OVERPASS_ONLY_TOOLS = Object.freeze(['osm_query']);

/**
 * The situation room's actions (?situation=1). A session is offered them only
 * when its page is in situation mode, so every other session keeps its
 * prompt budget; z0live callers and agents reach them through the display
 * bridge either way.
 */
export const SITUATION_TOOLS = Object.freeze([
  'set_situation_mode',
  'show_card',
  'brief',
  'pin_card',
  'dismiss_card',
  'focus_event',
]);

/**
 * The tools one session is offered. Bulk OpenStreetMap place search runs
 * only on an operator's Overpass, so without one `osm_query` is left out
 * rather than offered and refused; the situation room's actions only to a
 * situation-mode page.
 * @param {Array<{name: string}>} tools
 * @param {{overpass?: boolean, situation?: boolean}} [options]
 */
export function offeredTools(
  tools,
  { overpass = false, situation = false } = {},
) {
  return tools.filter(
    (tool) =>
      (overpass || !OVERPASS_ONLY_TOOLS.includes(tool.name)) &&
      (situation || !SITUATION_TOOLS.includes(tool.name)),
  );
}

/**
 * The app actions one session is offered.
 * @param {{overpass?: boolean, situation?: boolean}} [options]
 */
export function realtimeTools({ overpass = false, situation = false } = {}) {
  return offeredTools(GEV_REALTIME_TOOLS, { overpass, situation });
}
