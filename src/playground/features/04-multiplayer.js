/**
 * Privacy-first, opt-in same-origin collaboration prototype.
 * BroadcastChannel only talks to tabs on this browser origin.
 * A real internet room transport can be added behind this message contract.
 */
export const ROOM_PROTOCOL = 'gev.playground.local-room.v1';
const HEARTBEAT_MS = 15_000;
const PEER_EXPIRE_MS = 75_000;

export function normalizeRoom(raw) {
  const room = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9-]{3,24}$/.test(room) ? room : null;
}
export function parseRoomMessage(raw, room, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.protocol !== ROOM_PROTOCOL ||
      raw.room !== room || typeof raw.peer !== 'string' ||
      !/^[a-z0-9-]{4,32}$/.test(raw.peer) ||
      !['join', 'hello', 'leave', 'view'].includes(raw.kind) ||
      !Number.isFinite(raw.sentAt) || Math.abs(now - raw.sentAt) > 60000)
    return null;
  // Presence and departure packets must not retain private metadata or
  // fine-grained views, even when another same-origin tab sends extras.
  if (raw.kind !== 'view') {
    return {
      protocol: ROOM_PROTOCOL,
      room,
      peer: raw.peer,
      sentAt: raw.sentAt,
      kind: raw.kind,
    };
  }
  const { lat, lon, height } = raw.view || {};
  // The sender shares only 0.1-degree coordinates and 1 km elevation bands.
  // Reject finer incoming values; another local tab is not a trusted peer.
  if (
    ![lat, lon, height].every(Number.isFinite) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    height < 1000 ||
    height > 30000000 ||
    Math.round(lat * 10) / 10 !== lat ||
    Math.round(lon * 10) / 10 !== lon ||
    Math.round(height / 1000) * 1000 !== height
  )
    return null;
  // Unrecognized fields may contain private place data; never retain them.
  return {
    protocol: ROOM_PROTOCOL,
    room,
    peer: raw.peer,
    sentAt: raw.sentAt,
    kind: 'view',
    view: { lat, lon, height },
  };
}
/** Only validated, coarse finite coordinates may leave this tab on an explicit click. */
export function coarseRoomView(Cesium, cameraPosition) {
  try {
    if (!cameraPosition) return null;
    const position = Cesium.Cartographic.fromCartesian(cameraPosition);
    if (!position || ![
      position.latitude, position.longitude, position.height,
    ].every(Number.isFinite)) return null;
    const lat = Cesium.Math.toDegrees(position.latitude);
    const lon = Cesium.Math.toDegrees(position.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const height = Math.min(30000000, Math.max(1000, position.height));
    return {
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      height: Math.round(height / 1000) * 1000,
    };
  } catch {
    // A destroyed/invalid Cesium camera is not permission to send a view.
    return null;
  }
}

/**
 * Room-only invites must not silently copy a private scene hash, credentials
 * or unrelated query state. Scene sharing requires separate explicit opt-in.
 */
// GEV's share-link contract is a query-style camera/visual URL fragment. A
// room invitation must never forward unrelated fragment keys (e.g. OAuth
// tokens) just because the user opted to include the *scene*.
const ROOM_SCENE_HASH_KEYS = new Set([
  'v', 'lat', 'lon', 'alt', 'heading', 'pitch', 'roll', 'style',
  'bloom', 'bi', 'bv', 'sharpen', 'si', 'hud', 'hv',
  'dm', 'dd', 'da', 'kf', 'ko', 'cr', 'sc', 'scf', 'sce',
  'map', 'l', 'ui', 'sp', 'at',
]);
function roomSceneHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const latitude = params.get('lat');
  const longitude = params.get('lon');
  // A miscellaneous hash is not a camera scene. Reject incomplete,
  // nonfinite or out-of-range coordinates before copying any fragment state.
  if (latitude === null || longitude === null ||
      !latitude.trim() || !longitude.trim()) return '';
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) return '';
  const safe = new URLSearchParams();
  for (const [key, value] of params) {
    if (ROOM_SCENE_HASH_KEYS.has(key) && !safe.has(key))
      safe.set(key, value);
  }
  return '#' + safe.toString();
}

export function makeRoomInvite(currentUrl, room, { includeScene = false } = {}) {
  if (!normalizeRoom(room)) throw new TypeError('Invalid room');
  const link = new URL(currentUrl);
  if (link.protocol !== 'https:' && link.protocol !== 'http:')
    throw new TypeError('Room invite requires an HTTP(S) URL');
  const sceneHash = includeScene === true ? roomSceneHash(link.hash) : '';
  link.username = '';
  link.password = '';
  link.search = '';
  link.hash = sceneHash;
  link.searchParams.set('gevRoom', room);
  return link.href;
}

export const feature = {
  id: 'multiplayer',
  title: 'Multiplayer',
  mount({ root, services }) {
    const doc = root.ownerDocument;
    const win = services.window;
    const title = doc.createElement('h3');
    title.textContent = 'Shared Earth · local demo';
    const description = doc.createElement('p');
    description.textContent = 'Open two same-origin tabs. Presence-only heartbeats expire silent peers; camera views transmit only when you choose Send coarse view. Room links omit the current scene unless separately opted in. No internet rooms or verified identities.';
    const roomInput = doc.createElement('input');
    roomInput.type = 'text';
    roomInput.maxLength = 24;
    roomInput.placeholder = 'e.g. earth-lab';
    roomInput.setAttribute('aria-label', 'Room code');
    roomInput.value = normalizeRoom(new URLSearchParams(win.location.search).get('gevRoom')) || 'earth-lab';
    const actions = doc.createElement('div');
    actions.className = 'gev-playground-actions';
    function button(label) {
      const node = doc.createElement('button');
      node.type = 'button';
      node.textContent = label;
      actions.append(node);
      return node;
    }
    const join = button('Join local room');
    const leave = button('Leave');
    const share = button('Send coarse view');
    const invite = button('Copy room link');
    const includeScene = doc.createElement('input');
    includeScene.type = 'checkbox';
    includeScene.checked = false;
    const includeSceneLabel = doc.createElement('label');
    includeSceneLabel.textContent =
      'Include current scene in link (may disclose map location)';
    includeSceneLabel.append(includeScene);
    actions.append(includeSceneLabel);
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'gev-playground-status';
    const peersContainer = doc.createElement('div');
    let channel = null;
    let room = null;
    const peers = new Map();
    const renderedPeers = new Map();
    const lastSeen = new Map();
    const timerHost = typeof win.setInterval === 'function' &&
      typeof win.clearInterval === 'function' ? win : globalThis;
    let heartbeat = null;
    let inviteWriteTail = Promise.resolve();
    let latestInviteIntent = 0;
    let mounted = true;
    const peerId = 'peer-' + Math.random().toString(36).slice(2, 12);
    function notice(message) { status.textContent = message; }
    function leaveRoom(notifyPeers = true) {
      if (heartbeat !== null) {
        timerHost.clearInterval(heartbeat);
        heartbeat = null;
      }
      // Inform already-joined tabs before closing; teardown is a departure too.
      if (channel) {
        if (notifyPeers) send('leave');
        channel.onmessage = null;
        try {
          channel.close();
        } catch {
          // Local state must still clear if closing a channel fails.
        }
      }
      channel = null;
      room = null;
      peers.clear();
      renderedPeers.clear();
      lastSeen.clear();
      leave.disabled = true;
      share.disabled = true;
      peersContainer.replaceChildren();
    }
    function send(kind, view) {
      if (!channel) return false;
      try {
        channel.postMessage({
          protocol: ROOM_PROTOCOL,
          kind,
          room,
          peer: peerId,
          sentAt: Date.now(),
          ...(view ? { view } : {}),
        });
        return true;
      } catch {
        return false;
      }
    }
    function presentPeers() {
      // Rebuilding the whole peer list unmounts another peer's focused
      // Visit view button. Reconcile only rows whose membership/view changed.
      let needsMockFallback = false;
      for (const [id, entry] of renderedPeers) {
        if (peers.has(id)) continue;
        if (typeof entry.row.remove === 'function') entry.row.remove();
        else needsMockFallback = true;
        renderedPeers.delete(id);
      }
      for (const [id, view] of peers) {
        const prior = renderedPeers.get(id);
        if (prior && prior.view === view) continue;
        const previousVisit = prior?.row.querySelector?.('button');
        const restoreVisitFocus = Boolean(previousVisit && previousVisit === doc.activeElement);
        const row = doc.createElement('div');
        row.className = 'gev-playground-actions';
        const label = doc.createElement('span');
        label.textContent = 'Peer ' + id.slice(-6) + (view ? ' · shared a coarse view' : ' · connected');
        row.append(label);
        let follow = null;
        if (view) {
          follow = doc.createElement('button');
          follow.type = 'button';
          follow.textContent = 'Visit view';
          follow.addEventListener('click', () => {
            // A peer row may outlive its Scene camera during teardown.
            try {
              const viewer = services.viewer;
              if (
                !viewer ||
                viewer.isDestroyed?.() ||
                typeof viewer.camera?.flyTo !== 'function' ||
                typeof services.Cesium?.Cartesian3?.fromDegrees !== 'function'
              ) {
                notice('Scene camera unavailable; peer view not opened.');
                return;
              }
              viewer.camera.flyTo({
                destination: services.Cesium.Cartesian3.fromDegrees(
                  view.lon, view.lat, view.height,
                ),
                duration: 2,
              });
            } catch {
              notice('Scene camera unavailable; peer view not opened.');
            }
          });
          row.append(follow);
        }
        if (prior) {
          if (typeof prior.row.replaceWith === 'function') prior.row.replaceWith(row);
          else needsMockFallback = true;
        } else {
          peersContainer.append(row);
        }
        renderedPeers.set(id, { row, view });
        // Preserve focus on an updated peer view without stealing it from
        // another control or resurrecting a removed peer action.
        if (restoreVisitFocus && follow?.isConnected)
          follow.focus({ preventScroll: true });
      }
      // Minimal DOM fakes in the existing unit tests have replaceChildren
      // but no Element.remove/replaceWith. Real browsers take the keyed path.
      if (needsMockFallback)
        peersContainer.replaceChildren(...[...renderedPeers.values()].map(({ row }) => row));
    }
    function heartbeatAndPrune() {
      if (!channel) return;
      const now = Date.now();
      let changed = false;
      for (const [peer, receivedAt] of lastSeen) {
        if (now - receivedAt <= PEER_EXPIRE_MS) continue;
        lastSeen.delete(peer);
        peers.delete(peer);
        changed = true;
      }
      if (changed) {
        presentPeers();
        notice(peers.size + ' nearby tab(s) in local room ' + room + '.');
      }
      // Presence-only heartbeat: never publish a camera view automatically.
      if (!send('hello')) {
        leaveRoom();
        notice('Local room messaging unavailable; disconnected.');
      }
    }
    join.addEventListener('click', () => {
      const nextRoom = normalizeRoom(roomInput.value);
      if (!nextRoom) {
        notice('Use 3–24 lowercase letters, digits or hyphens.');
        return;
      }
      if (typeof win.BroadcastChannel !== 'function') {
        notice('BroadcastChannel is unavailable in this browser.');
        return;
      }
      leaveRoom();
      try {
        channel = new win.BroadcastChannel('gev-playground:' + nextRoom);
      } catch {
        // Some browsers expose BroadcastChannel but deny its construction.
        // Remain disconnected and allow a later retry, without a ghost room.
        notice('Local room unavailable in this browser.');
        return;
      }
      room = nextRoom;
      const joinedChannel = channel;
      joinedChannel.onmessage = (event) => {
        // Queued messages from an earlier room instance cannot resurrect peers.
        if (channel !== joinedChannel) return;
        const packet = parseRoomMessage(event.data, room);
        if (!packet || packet.peer === peerId) return;
        if (packet.kind === 'leave') {
          const wasPresent = peers.delete(packet.peer);
          lastSeen.delete(packet.peer);
          if (wasPresent) presentPeers();
          notice(peers.size + ' nearby tab(s) in local room ' + room + '.');
          return;
        }
        const wasPresent = peers.has(packet.peer);
        const previous = peers.get(packet.peer) || null;
        const nextView = packet.kind === 'view' ? packet.view : previous;
        // A liveness-only heartbeat must never replace a focused Visit view
        // button. Rebuild only when membership or the coarse view changes.
        const changed = !wasPresent || (packet.kind === 'view' && (
          previous?.lat !== nextView.lat ||
          previous?.lon !== nextView.lon ||
          previous?.height !== nextView.height
        ));
        peers.set(packet.peer, nextView);
        lastSeen.set(packet.peer, Date.now());
        if (changed) presentPeers();
        if (packet.kind === 'join' && !send('hello')) {
          leaveRoom();
          notice('Local room messaging unavailable; disconnected.');
          return;
        }
        notice(peers.size + ' nearby tab(s) in local room ' + room + '.');
      };
      if (!send('join')) {
        // No join packet was sent; do not emit a ghost departure.
        leaveRoom(false);
        notice('Local room messaging unavailable; disconnected.');
        return;
      }
      heartbeat = timerHost.setInterval(heartbeatAndPrune, HEARTBEAT_MS);
      leave.disabled = false;
      share.disabled = false;
      notice('Joined local tab room ' + room + '.');
    });
    leave.addEventListener('click', () => {
      leaveRoom();
      notice('Left room; no more messages will be exchanged.');
    });
    share.addEventListener('click', () => {
      if (!channel) return;
      // Scene teardown may retain a stale camera position. Never transmit it.
      let view = null;
      try {
        const viewer = services.viewer;
        if (viewer && !viewer.isDestroyed?.())
          view = coarseRoomView(services.Cesium, viewer.camera?.positionWC);
      } catch {
        // A destroyed viewer can throw from its camera or lifecycle getter.
      }
      if (!view) {
        notice('Camera view unavailable; nothing shared.');
        return;
      }
      if (!send('view', view)) {
        leaveRoom();
        notice('Local room messaging unavailable; view not shared.');
        return;
      }
      notice('Coarse camera view shared with local tabs (about 0.1° precision).');
    });
    invite.addEventListener('click', () => {
      // Invite the active channel, not an edited but unjoined room code.
      const candidate = room || normalizeRoom(roomInput.value);
      if (!candidate) return notice('Enter a valid room first.');
      // Each invitation needs fresh scene consent. Clear before awaiting
      // clipboard so rapid repeat copies cannot inherit a private map view.
      const shareScene = includeScene.checked === true;
      includeScene.checked = false;
      const link = makeRoomInvite(win.location.href, candidate, {
        includeScene: shareScene,
      });
      const includedScene = shareScene && Boolean(new URL(link).hash);
      const intent = ++latestInviteIntent;
      // Clipboard writes can settle out of order (e.g. a permission prompt).
      // Serialize them so an old scene link cannot overwrite a later room-only
      // choice, and never show success for a superseded or disposed intent.
      const copy = inviteWriteTail.then(async () => {
        // A discarded playground must not start a queued clipboard write.
        if (!mounted) return;
        try {
          await win.navigator.clipboard.writeText(link);
          if (mounted && intent === latestInviteIntent)
            notice(includedScene
              ? 'Room and scene link copied; the scene may disclose map location. Same-origin tabs only.'
              : shareScene
                ? 'Room-only link copied; no valid scene state to include. Same-origin tabs only.'
                : 'Room-only link copied without scene or map state. Same-origin tabs only.');
        } catch {
          if (mounted && intent === latestInviteIntent)
            notice('Clipboard unavailable; copy this room code: ' + candidate);
        }
      });
      inviteWriteTail = copy;
      return copy;
    });
    root.append(title, description, roomInput, actions, status, peersContainer);
    leaveRoom();
    notice('Disconnected. Joining is optional.');
    return () => {
      mounted = false;
      leaveRoom();
    };
  },
};
