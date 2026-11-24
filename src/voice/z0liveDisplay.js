import { GEV_ACTION_SCHEMAS } from './actionSchemas.js';

/**
 * Opt-in z0live display bridge.
 *
 * Opening the app with `?z0live=<broker URL>` registers this tab as the `gev`
 * display of a z0live desktop broker, so a z0live voice call (or one of its
 * agents) can drive the globe. Commands run through the same action runner the
 * typed chat, the omnibar and the voice session use; a result reports success
 * only when the action itself did. Without the parameter nothing here runs.
 *
 * The paired-device token comes from the URL fragment (`#z0live_token=...`,
 * removed from the address at once) or from local storage, and is sent only
 * as a bearer header to the broker. It is never logged.
 *
 * Protocol: docs/Z0LIVE-DISPLAY.md.
 */

export const Z0LIVE_DISPLAY = 'gev';
export const Z0LIVE_TOKEN_KEY = 'gev.z0live.token';
const TOKEN_FRAGMENT_KEY = 'z0live_token';
const HEARTBEAT_MS = 5000;
const CONTEXT_MS = 1000;
const COMMAND_MS = 11000;
const OUTPUT_LIMIT = 4000;
const RECONNECT_MS = [1000, 2000, 5000, 10000];

/**
 * The actions a z0live caller may run, each with one line for the live
 * model's tool description. Settings that only make sense at the screen
 * (voice timeout, the voice panel, Radio's spoken handoff) stay local.
 */
const ACTION_SUMMARIES = Object.freeze({
  fly_to_location:
    'Fly the camera to a place: {query:"Tokyo"} or {latitude,longitude}; optional rangeM',
  zoom_to_globe: 'Zoom out to the whole globe',
  adjust_camera_zoom: 'Zoom in or out: {direction:"in"|"out", amount?}',
  move_camera: 'Orbit, tilt, pan or rotate the camera: {motion, direction?}',
  frame_overhead: 'Look straight down at a target: {target, radiusKm?}',
  set_layer_visibility:
    'Turn a data layer on or off: {layerId:"flights", enabled:true}',
  set_visual_style: 'Change the visual style: {style}',
  set_map_stack: 'Switch the basemap stack: {stack}',
  set_context_mode: 'Set the context mode: {mode}',
  track_entity: 'Follow an aircraft, vessel or satellite: {query, layerId?}',
  stop_tracking: 'Stop following anything',
  select_nearest_aircraft:
    'Select the aircraft nearest a place: {locationQuery?, layerId?}',
  show_street_level: 'Show street-level imagery of a place: {query}',
  get_current_view_state: 'Read the current camera, style and active layers',
  get_entity_context: 'Describe what is in view or selected: {scope?}',
  analyst_query:
    'Count, rank or list live entities in a scope: {layers, scope?, filters?}',
  resolve_area: 'Find and outline a named area: {query, flyTo?}',
  annotate_map: 'Draw labelled markers or routes: {annotations, flyTo?}',
  clear_annotations: 'Remove drawn annotations',
  control_cctv: 'Show or hide CCTV cameras: {action, cameraQuery?}',
  control_scene: 'Play, pause or stop a scene: {action, sceneId?}',
  next_iss_pass: 'When the ISS next passes over a place',
  next_satellite_pass: 'When a satellite next passes over a place: {target}',
  set_hud: 'Show or hide the HUD: {visible}',
  set_situation_mode:
    'Turn the situation room (live events, source status, what matters now) on or off: {enabled}',
  show_card:
    'Show a card from a real GEV query: {kind:"aircraft"|"vessels"|"quakes"|"fires"|"satellite"|"camera"|"area"|"distance"|"news"|"cyclones", place?|latitude,longitude, radiusKm?, filter?, satellite?, to?}',
  brief:
    'Brief card: {place} composes one from GEV sources; or {title, body (markdown-lite), sources:[{name,url?,observedAt?}], unknowns?}',
  pin_card: 'Keep a card on screen: {id?, pinned?}',
  dismiss_card: 'Dismiss a card to its receipt: {id?} or {all:true}',
  focus_event:
    'Fly to a live event: {rank:1-3} from what matters now, or {id}; returns the next question to ask',
});

const KNOWN_ACTIONS = new Set(GEV_ACTION_SCHEMAS.map((schema) => schema.name));

/** The registered tool list: summarized actions this build actually has. */
export function z0liveDisplayTools(summaries = ACTION_SUMMARIES) {
  return Object.entries(summaries)
    .filter(([name]) => KNOWN_ACTIONS.has(name))
    .map(([name, description]) => ({ name, description }));
}

/**
 * Read the opt-in configuration from the address and storage. Returns null
 * when `?z0live=` is absent or not an http(s) URL. A token in the fragment
 * moves to storage and leaves the address.
 */
export function readZ0liveDisplayConfig({
  location = globalThis.location,
  storage = safeStorage(),
  history = globalThis.history,
} = {}) {
  if (!location) return null;
  const raw = new URLSearchParams(location.search || '').get('z0live');
  if (!raw) return null;
  let broker;
  try {
    broker = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(broker.protocol)) return null;
  const hash = new URLSearchParams(String(location.hash || '').slice(1));
  let token = hash.get(TOKEN_FRAGMENT_KEY) || '';
  if (token) {
    hash.delete(TOKEN_FRAGMENT_KEY);
    try {
      storage?.setItem(Z0LIVE_TOKEN_KEY, token);
    } catch {
      // A private window may refuse storage; the token still works this load.
    }
    try {
      const url = new URL(location.href);
      url.hash = hash.toString();
      history?.replaceState?.(history.state, '', url.href);
    } catch {
      // An address we cannot rewrite keeps the fragment; it is not sent anywhere.
    }
  }
  if (!token) {
    try {
      token = storage?.getItem(Z0LIVE_TOKEN_KEY) || '';
    } catch {
      token = '';
    }
  }
  return {
    broker: broker.href.replace(/\/+$/, ''),
    token,
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether an action runner result reports a completed action. */
export function actionSucceeded(result) {
  if (!result || typeof result !== 'object') return false;
  return (
    result.ok !== false &&
    !result.error &&
    !result.cancelled &&
    !result.refused &&
    !result.unavailable
  );
}

/** A bounded, JSON-safe summary of a runner result for the caller. */
export function summarizeResult(result, context = null) {
  const out = {};
  if (result && typeof result === 'object') {
    for (const key of [
      'say',
      'error',
      'refused',
      'cancelled',
      'unavailable',
      'applied',
      'location',
      'name',
      'summary',
      'count',
      // Situation room results: the card or event the caller can refer to.
      'card',
      'cards',
      'event',
      'next_question',
      'next_action',
      'enabled',
    ]) {
      if (result[key] !== undefined && result[key] !== null)
        out[key] = result[key];
    }
  } else if (result !== undefined) out.value = result;
  if (context?.camera) out.camera = context.camera;
  let text = JSON.stringify(out);
  if (text.length <= OUTPUT_LIMIT) return out;
  text = String(out.say || out.error || '').slice(0, 1000);
  return {
    say: text,
    truncated: true,
    ...(out.camera && { camera: out.camera }),
  };
}

/** The display context the broker shows callers: camera, style and layers. */
export function compactWorldContext(packet) {
  if (!packet || typeof packet !== 'object') return {};
  const round = (value, digits) =>
    Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
  const camera = packet.camera
    ? {
        latitude: round(packet.camera.latitude, 4),
        longitude: round(packet.camera.longitude, 4),
        heightM: round(packet.camera.heightM, 0),
      }
    : null;
  return {
    camera,
    style: packet.style ?? null,
    layers: (packet.layers || [])
      .filter((layer) => layer?.enabled)
      .slice(0, 40)
      .map((layer) => layer.id),
    tracked: (packet.tracked || []).slice(0, 5).map((entry) => ({
      kind: entry.kind,
      layerId: entry.layerId,
      ...(entry.id != null && { id: String(entry.id) }),
      ...(entry.callsign && { callsign: entry.callsign }),
      ...(entry.name && { name: entry.name }),
    })),
    cockpit: Boolean(packet.cockpit?.active),
  };
}

/** Parse SSE text frames; returns [events, remainder]. */
export function parseSseFrames(buffer) {
  const events = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    let event = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return [events, rest];
}

/**
 * Create the bridge. `run(name, args, {signal})` is the application's action
 * runner; `readContext()` returns compact display context.
 */
export function createZ0liveDisplayBridge({
  broker,
  token,
  run,
  readContext = () => ({}),
  tools = z0liveDisplayTools(),
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  setInterval: every = globalThis.setInterval.bind(globalThis),
  clearInterval: stopEvery = globalThis.clearInterval.bind(globalThis),
  setTimeout: later = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancelLater = globalThis.clearTimeout.bind(globalThis),
  now = () => Date.now(),
  logger = console,
  heartbeatMs = HEARTBEAT_MS,
  contextMs = CONTEXT_MS,
  commandMs = COMMAND_MS,
  reconnectMs = RECONNECT_MS,
}) {
  if (typeof run !== 'function') throw new TypeError('run is required');
  const base = `${String(broker).replace(/\/+$/, '')}/v1/displays`;
  const allowed = new Set(tools.map((tool) => tool.name));
  const lifetime = new AbortController();
  const timers = [];
  let registered = false;
  let registering = null;
  let streamAbort = null;
  let reconnectTimer = 0;
  let failures = 0;
  let lastContextKey = '';
  let lastContextAt = 0;
  let queue = Promise.resolve();
  const status = {
    registered: false,
    connected: false,
    commands: 0,
    lastError: null,
  };

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });
  const warn = (message) => {
    status.lastError = message;
    logger?.warn?.(`[z0live display] ${message}`);
  };

  async function post(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: lifetime.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, payload };
  }

  function context() {
    try {
      return readContext() || {};
    } catch {
      return {};
    }
  }

  function register() {
    if (registering) return registering;
    registering = (async () => {
      try {
        const current = context();
        const response = await post('/register', {
          display: Z0LIVE_DISPLAY,
          tools,
          context: current,
        });
        registered = response.ok;
        status.registered = registered;
        if (!response.ok) {
          warn(`register refused (HTTP ${response.status})`);
          return false;
        }
        lastContextKey = JSON.stringify(current);
        lastContextAt = now();
        return true;
      } catch (error) {
        if (!lifetime.signal.aborted)
          warn(`register failed (${error?.name || 'error'})`);
        registered = false;
        status.registered = false;
        return false;
      } finally {
        registering = null;
      }
    })();
    return registering;
  }

  async function heartbeat() {
    if (lifetime.signal.aborted) return;
    if (!registered) {
      if ((await register()) && !streamAbort) connect();
      return;
    }
    try {
      const response = await post(`/${Z0LIVE_DISPLAY}/heartbeat`, {});
      // A restarted broker forgets displays: register again.
      if (response.status === 404) {
        registered = false;
        status.registered = false;
        if (await register()) restartStream();
      }
    } catch (error) {
      if (!lifetime.signal.aborted)
        warn(`heartbeat failed (${error?.name || 'error'})`);
    }
  }

  async function pushContext() {
    if (!registered || lifetime.signal.aborted) return;
    if (now() - lastContextAt < contextMs) return;
    const current = context();
    const key = JSON.stringify(current);
    if (key === lastContextKey) return;
    lastContextKey = key;
    lastContextAt = now();
    try {
      await post(`/${Z0LIVE_DISPLAY}/context`, { context: current });
    } catch {
      // The next change or heartbeat tries again.
    }
  }

  async function execute(command) {
    status.commands += 1;
    const { id, action } = command;
    const args =
      command.args && typeof command.args === 'object' ? command.args : {};
    let ok = false;
    let output;
    if (!allowed.has(action)) {
      output = { error: `${action} is not available on this display` };
    } else {
      const controller = new AbortController();
      const timer = later(() => controller.abort(), commandMs);
      const signal = AbortSignal.any([lifetime.signal, controller.signal]);
      try {
        const result = await run(action, args, { signal });
        ok = actionSucceeded(result);
        output = summarizeResult(result, context());
      } catch (error) {
        output = {
          error: controller.signal.aborted
            ? 'The globe action timed out.'
            : error?.message || String(error),
        };
      } finally {
        cancelLater(timer);
      }
    }
    if (lifetime.signal.aborted) return;
    try {
      await post(`/${Z0LIVE_DISPLAY}/result`, { id, ok, output });
    } catch (error) {
      if (!lifetime.signal.aborted)
        warn(`result post failed (${error?.name || 'error'})`);
    }
    lastContextAt = 0; // report where the action left the camera
    void pushContext();
  }

  function enqueue(command) {
    // One action at a time, in arrival order: a fly-to lands before the next motion.
    queue = queue.then(() => execute(command)).catch(() => {});
    return queue;
  }

  async function readStream(response, controller) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const [events, rest] = parseSseFrames(buffer);
      buffer = rest;
      for (const event of events) {
        if (event.event !== 'command') continue;
        let command;
        try {
          command = JSON.parse(event.data);
        } catch {
          continue;
        }
        if (command && typeof command.id === 'string') enqueue(command);
      }
    }
  }

  async function connect() {
    if (lifetime.signal.aborted || streamAbort) return;
    const controller = new AbortController();
    streamAbort = controller;
    try {
      const response = await fetchImpl(`${base}/${Z0LIVE_DISPLAY}/inbox`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: AbortSignal.any([lifetime.signal, controller.signal]),
      });
      if (response.status === 404) {
        registered = false;
        status.registered = false;
      }
      if (!response.ok || !response.body)
        throw new Error(`inbox HTTP ${response.status}`);
      status.connected = true;
      failures = 0;
      await readStream(response, controller);
    } catch (error) {
      if (!lifetime.signal.aborted && !controller.signal.aborted)
        warn(`inbox closed (${error?.message || error?.name || 'error'})`);
    } finally {
      status.connected = false;
      if (streamAbort === controller) streamAbort = null;
      if (!lifetime.signal.aborted && !controller.signal.aborted) {
        const delay = reconnectMs[Math.min(failures, reconnectMs.length - 1)];
        failures += 1;
        reconnectTimer = later(async () => {
          reconnectTimer = 0;
          if (!registered && !(await register())) return scheduleRetry();
          void connect();
        }, delay);
      }
    }
  }

  function scheduleRetry() {
    if (lifetime.signal.aborted || reconnectTimer) return;
    const delay = reconnectMs[Math.min(failures, reconnectMs.length - 1)];
    failures += 1;
    reconnectTimer = later(async () => {
      reconnectTimer = 0;
      if (await register()) void connect();
      else scheduleRetry();
    }, delay);
  }

  function restartStream() {
    streamAbort?.abort();
    streamAbort = null;
    void connect();
  }

  async function start() {
    if (!token) {
      warn('no paired-device token; open with #z0live_token=… once');
      return false;
    }
    timers.push(every(() => void heartbeat(), heartbeatMs));
    timers.push(every(() => void pushContext(), contextMs));
    if (await register()) void connect();
    else scheduleRetry();
    return registered;
  }

  function stop() {
    lifetime.abort();
    for (const timer of timers) stopEvery(timer);
    timers.length = 0;
    if (reconnectTimer) cancelLater(reconnectTimer);
    reconnectTimer = 0;
    streamAbort?.abort();
    streamAbort = null;
  }

  return {
    start,
    stop,
    status,
    /** Settles after every command received so far has posted its result. */
    idle: () => queue,
  };
}
