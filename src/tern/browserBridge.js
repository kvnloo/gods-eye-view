import {
  getContextStore,
  isContextRecordActive,
} from '../data/contextStore.js';
import { layerSnapshots } from '../data/layerSnapshot.js';

const SEND_INTERVAL_MS = 125;
const MAX_LAYERS = 80;
const MAX_TEXT = 160;
const MAX_SNAPSHOT_BYTES = 60_000;
const SNAPSHOT_ENCODER = new TextEncoder();
const RAD_TO_DEG = 180 / Math.PI;
const MAX_RECONNECT_ATTEMPTS = 6;
const PERMANENT_CLOSE_CODES = new Set([4001, 4002]);

function text(value, max = MAX_TEXT) {
  if (value == null) return null;
  return String(value)
    .toWellFormed()
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '');
}

function number(value, digits = 5) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

/**
 * Read the existing GEV owners without retaining Cesium entities, polling a
 * provider, or modifying layer/camera authority. One snapshot is one instant:
 * a late event cannot restore an earlier selected entity.
 */
export function projectGevContext({ scene, data }, now = Date.now()) {
  const viewer = scene?.viewer;
  const dataManager = data?.dataManager;
  if (!viewer?.camera || !dataManager?.getAll)
    throw new TypeError('GEV scene and layer manager are required');

  // Tern observes selection. The owning getter clears inactive records, so
  // never use it from this read-only projection (LOD/horizon can hide them).
  const store = getContextStore();
  const record = store.selectedEntityId
    ? store.entities.get(store.selectedEntityId)
    : null;
  const selected = isContextRecordActive(record, dataManager) ? record : null;
  const camera = viewer.camera;
  const position = camera.positionCartographic;
  const allLayers = dataManager.getAll();
  return {
    type: 'snapshot',
    capturedAt: now,
    camera: position
      ? {
          latitude: number(position.latitude * RAD_TO_DEG),
          longitude: number(position.longitude * RAD_TO_DEG),
          heightM: number(position.height, 0),
          heading: number(camera.heading * RAD_TO_DEG, 1),
          pitch: number(camera.pitch * RAD_TO_DEG, 1),
        }
      : null,
    selected: selected
      ? {
          id: text(selected.id),
          name: text(
            selected.label || selected.properties?.name || selected.id,
          ),
          layerId: text(selected.layerId),
          layerName: text(selected.layerName),
          source: text(selected.source),
          status: text(selected.properties?.status),
          latitude: number(selected.latitude),
          longitude: number(selected.longitude),
          updatedAt: Number.isFinite(selected.updatedAt)
            ? selected.updatedAt
            : null,
        }
      : null,
    layers: layerSnapshots(allLayers.slice(0, MAX_LAYERS), {
      now,
    }).map((layer) => ({
      id: text(layer.id),
      name: text(layer.name),
      enabled: layer.enabled,
      feedState: layer.feedState,
      count: layer.count,
      source: text(layer.source),
      lastUpdate: layer.lastUpdate,
      error: text(layer.error),
    })),
    omittedLayers: Math.max(0, allLayers.length - MAX_LAYERS),
  };
}

/** Keep the largest ordered layer prefix that fits the local relay's byte budget. */
function boundedSnapshotPayload(snapshot) {
  const layers = snapshot.layers;
  let low = 0;
  let high = layers.length;
  let fitting = null;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const payload = JSON.stringify({
      ...snapshot,
      layers: layers.slice(0, keep),
      omittedLayers: snapshot.omittedLayers + layers.length - keep,
    });
    if (SNAPSHOT_ENCODER.encode(payload).byteLength <= MAX_SNAPSHOT_BYTES) {
      fitting = payload;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  // All non-layer fields are individually bounded; an empty roster fits.
  if (fitting === null)
    throw new RangeError('GEV Tern snapshot metadata exceeds relay budget');
  return fitting;
}

/**
 * Opt-in browser-to-local transport; all commands from the terminal are
 * read-only refresh requests. The application and its typed action owners are
 * deliberately not reachable through this socket.
 */
export function connectTernBridge({
  application,
  components,
  port,
  token,
  WebSocketCtor = globalThis.WebSocket,
}) {
  const portNumber = Number(port);
  if (
    !Number.isInteger(portNumber) ||
    portNumber < 1 ||
    portNumber > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(token || '') ||
    !['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    throw new TypeError('Invalid local Tern bridge configuration');
  }
  if (typeof WebSocketCtor !== 'function')
    throw new TypeError('WebSocket is required for the Tern bridge');

  const address =
    'ws://127.0.0.1:' + portNumber + '/?token=' + encodeURIComponent(token);
  const { viewer } = components.scene;
  const { dataManager } = components.data;
  const subscriptions = [];
  let socket = null;
  let disposed = false;
  let retry = null;
  let pending = null;
  let lastChange = 'initial';
  let failures = 0;

  function publish() {
    pending = null;
    if (disposed || socket?.readyState !== WebSocketCtor.OPEN) return;
    const value = projectGevContext(components);
    value.change = lastChange;
    // Selection and camera always publish; layer omissions travel explicitly.
    socket.send(boundedSnapshotPayload(value));
  }

  function schedule(change = 'layer') {
    lastChange = change;
    if (!disposed && pending === null)
      pending = setTimeout(publish, SEND_INTERVAL_MS);
  }

  function reconnect() {
    if (disposed) return;
    const ws = new WebSocketCtor(address);
    socket = ws;
    ws.onopen = () => {
      if (disposed || socket !== ws) return;
      failures = 0;
      lastChange = 'connected';
      publish();
    };
    ws.onmessage = (event) => {
      if (socket !== ws || disposed) return;
      if (event.data === '{"type":"snapshot-request"}') schedule('refresh');
    };
    ws.onerror = () => {
      // Close owns retry; never log the secret-bearing socket URL.
    };
    ws.onclose = (event) => {
      if (socket !== ws || disposed) return;
      socket = null;
      // A replacement tab or relay shutdown revokes this browser's ownership.
      // Do not reconnect into a newer owner or a later process on the same port.
      if (PERMANENT_CLOSE_CODES.has(event?.code)) {
        dispose();
        return;
      }
      failures += 1;
      if (failures >= MAX_RECONNECT_ATTEMPTS) {
        dispose();
        return;
      }
      retry = setTimeout(
        () => {
          retry = null;
          reconnect();
        },
        Math.min(8000, 250 * 2 ** Math.min(failures, 5)),
      );
    };
  }

  function onSelection() {
    schedule('selection');
  }
  function onCamera() {
    schedule('camera');
  }
  function onLayer(change) {
    schedule(
      typeof change?.type === 'string' ? text(change.type, 64) : 'layer',
    );
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(retry);
    clearTimeout(pending);
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    const closingSocket = socket;
    socket = null;
    if (closingSocket && closingSocket.readyState < WebSocketCtor.CLOSING)
      closingSocket.close();
  }

  subscriptions.push(dataManager.subscribeActivity(onLayer));
  subscriptions.push(viewer.camera.moveEnd.addEventListener(onCamera));
  for (const name of [
    'gev:entity-selected',
    'gev:entity-selection-cleared',
    'gev:awareness-subject-selected',
    'gev:awareness-subject-cleared',
  ]) {
    window.addEventListener(name, onSelection);
    subscriptions.push(() => window.removeEventListener(name, onSelection));
  }
  window.addEventListener('pagehide', dispose);
  subscriptions.push(() => window.removeEventListener('pagehide', dispose));
  subscriptions.push(
    application.subscribe(({ status }) => {
      if (['destroying', 'destroyed', 'failed'].includes(status)) dispose();
    }),
  );
  if (!disposed) reconnect();
  return dispose;
}
