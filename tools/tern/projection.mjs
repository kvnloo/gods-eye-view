// Transport-only, allowlisted projection of the existing browser owners.
// Never turn untrusted socket data into TSP node props or executable actions.
const MAX_TEXT = 160;
const MAX_LAYERS = 80;
const FEED_STATES = new Set([
  'nominal',
  'loading',
  'degraded',
  'stale',
  'partial',
  'fallback',
  'unavailable',
  'off',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  // Replace preexisting unpaired surrogates, then avoid splitting a pair at
  // the UTF-16 length limit. No half-emoji reaches JSON or the TSP renderer.
  const cleaned = String(value)
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '');
  return cleaned || null;
}

function finite(value, min = -Infinity, max = Infinity) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** An immutable, bounded display payload. Reject unknown message shapes. */
export function normalizeSnapshot(message, receivedAt = Date.now()) {
  if (!record(message) || message.type !== 'snapshot' || !Array.isArray(message.layers))
    return null;

  const layers = [];
  const seen = new Set();
  for (const layer of message.layers.slice(0, MAX_LAYERS)) {
    if (!record(layer)) continue;
    const id = text(layer.id, 96);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const enabled = layer.enabled === true;
    const feedState = FEED_STATES.has(layer.feedState)
      ? layer.feedState
      : 'unavailable';
    layers.push(
      Object.freeze({
        id,
        name: text(layer.name) || id,
        enabled,
        feedState: enabled ? (feedState === 'off' ? 'unavailable' : feedState) : 'off',
        count: finite(layer.count, 0, 1e12),
        source: text(layer.source),
        lastUpdate: finite(layer.lastUpdate, 0),
        error: text(layer.error),
      }),
    );
  }

  const raw = record(message.selected) ? message.selected : null;
  const selectedId = raw && text(raw.id, 96);
  const selected = selectedId
    ? Object.freeze({
        id: selectedId,
        name: text(raw.name) || selectedId,
        layerId: text(raw.layerId, 96),
        layerName: text(raw.layerName),
        source: text(raw.source),
        status: text(raw.status),
        latitude: finite(raw.latitude, -90, 90),
        longitude: finite(raw.longitude, -180, 180),
        updatedAt: finite(raw.updatedAt, 0),
      })
    : null;

  const camera = record(message.camera)
    ? Object.freeze({
        latitude: finite(message.camera.latitude, -90, 90),
        longitude: finite(message.camera.longitude, -180, 180),
        heightM: finite(message.camera.heightM, -12000, 100_000_000),
        heading: finite(message.camera.heading, -360, 360),
        pitch: finite(message.camera.pitch, -360, 360),
      })
    : null;

  const change = text(message.change, 64) || 'update';
  const reportedOmissions = Number.isSafeInteger(message.omittedLayers) &&
    message.omittedLayers >= 0
    ? message.omittedLayers
    : 0;
  return Object.freeze({
    selected,
    camera,
    layers: Object.freeze(layers),
    omittedLayers: reportedOmissions + message.layers.length - layers.length,
    change,
    capturedAt: finite(message.capturedAt, 0),
    receivedAt,
  });
}

/** Clock-relative age; never confuse a context refresh with an observation time. */
export function ageLabel(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0)
    return 'age unknown';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  return Math.floor(seconds / 3600) + 'h ago';
}

/** Text fallback; no terminal escapes or claims that a feed is real-time. */
export function plainSummary(snapshot, {
  connected = false, link, paused = false, notice = '', now = Date.now(),
} = {}) {
  const lines = ["God's Eye View — local context",
    'Browser: ' + (connected ? 'connected' : 'disconnected') +
      (paused ? ' · presentation paused' : '')];
  if (notice) lines.push('Notice: ' + text(notice, 160));
  if (!snapshot) {
    lines.push('No current browser snapshot. Open the connected GEV link.');
  } else {
    const s = snapshot.selected;
    lines.push(
      s
        ? 'Selected: ' + s.name + ' [' + (s.layerName || s.layerId || 'unknown layer') + ']'
        : 'Selected: none',
    );
    if (s) {
      lines.push('Source: ' + (s.source || 'not reported'));
      lines.push('Observation status: ' + (s.status || 'not reported'));
      lines.push('Context refreshed: ' + ageLabel(s.updatedAt, now) +
        ' (not source observation age)');
    }
    if (snapshot.camera && snapshot.camera.latitude !== null && snapshot.camera.longitude !== null)
      lines.push('Camera: ' + snapshot.camera.latitude + ', ' + snapshot.camera.longitude +
        ' at ' + (snapshot.camera.heightM ?? 'unknown') + ' m');
    if (snapshot.omittedLayers > 0)
      lines.push(
        'Layer coverage: ' + snapshot.omittedLayers +
          ' layer rows omitted from this snapshot (relay size/80-row cap); ' +
          'view the full roster in the browser.',
      );
    const active = snapshot.layers.filter((layer) => layer.enabled);
    lines.push('Enabled layers in snapshot: ' + active.length);
    for (const layer of active.slice(0, 18)) {
      lines.push(
        '- ' + layer.name + ': ' + layer.feedState.toUpperCase() +
          ' · ' + (layer.source || 'source unreported') +
          ' · ' + (layer.count ?? '?') + ' loaded' +
          ' · feed last update ' + ageLabel(layer.lastUpdate, now),
      );
    }
    if (active.length > 18) lines.push('... ' + (active.length - 18) + ' more layers in the globe');
    lines.push('Browser capture: ' + ageLabel(snapshot.capturedAt, now) +
      ' · relay received: ' + ageLabel(snapshot.receivedAt, now));
  }
  lines.push('Counts describe loaded data, not complete or verified worldwide coverage.');
  if (link) lines.push('Globe: ' + link);
  return lines.join('\n');
}
