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
export function makeRoomInvite(currentUrl, room) {
  if (!normalizeRoom(room)) throw new TypeError('Invalid room');
  const link = new URL(currentUrl);
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
    description.textContent = 'Open two same-origin tabs to exchange coarse camera views. Explicit join and send; no location broadcast in the background. Internet rooms are not available yet.';
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
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'gev-playground-status';
    const peersContainer = doc.createElement('div');
    let channel = null;
    let room = null;
    const peers = new Map();
    const lastSeen = new Map();
    const timerHost = typeof win.setInterval === 'function' &&
      typeof win.clearInterval === 'function' ? win : globalThis;
    let heartbeat = null;
    const peerId = 'peer-' + Math.random().toString(36).slice(2, 12);
    function notice(message) { status.textContent = message; }
    function leaveRoom() {
      if (heartbeat !== null) {
        timerHost.clearInterval(heartbeat);
        heartbeat = null;
      }
      // Inform already-joined tabs before closing; teardown is a departure too.
      if (channel) {
        send('leave');
        channel.onmessage = null;
      }
      channel?.close();
      channel = null;
      room = null;
      peers.clear();
      lastSeen.clear();
      leave.disabled = true;
      share.disabled = true;
      peersContainer.replaceChildren();
    }
    function send(kind, view) {
      if (!channel) return;
      channel.postMessage({
        protocol: ROOM_PROTOCOL,
        kind,
        room,
        peer: peerId,
        sentAt: Date.now(),
        ...(view ? { view } : {}),
      });
    }
    function presentPeers() {
      peersContainer.replaceChildren();
      for (const [id, view] of peers) {
        const row = doc.createElement('div');
        row.className = 'gev-playground-actions';
        const label = doc.createElement('span');
        label.textContent = 'Peer ' + id.slice(-6) + (view ? ' · shared a coarse view' : ' · connected');
        row.append(label);
        if (view) {
          const follow = doc.createElement('button');
          follow.type = 'button';
          follow.textContent = 'Visit view';
          follow.addEventListener('click', () => {
            services.viewer.camera.flyTo({
              destination: services.Cesium.Cartesian3.fromDegrees(
                view.lon, view.lat, view.height,
              ),
              duration: 2,
            });
          });
          row.append(follow);
        }
        peersContainer.append(row);
      }
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
      send('hello');
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
      room = nextRoom;
      channel = new win.BroadcastChannel('gev-playground:' + room);
      const joinedChannel = channel;
      joinedChannel.onmessage = (event) => {
        // Queued messages from an earlier room instance cannot resurrect peers.
        if (channel !== joinedChannel) return;
        const packet = parseRoomMessage(event.data, room);
        if (!packet || packet.peer === peerId) return;
        if (packet.kind === 'leave') {
          peers.delete(packet.peer);
          lastSeen.delete(packet.peer);
          presentPeers();
          notice(peers.size + ' nearby tab(s) in local room ' + room + '.');
          return;
        }
        const previous = peers.get(packet.peer) || null;
        peers.set(packet.peer, packet.kind === 'view' ? packet.view : previous);
        lastSeen.set(packet.peer, Date.now());
        presentPeers();
        if (packet.kind === 'join') send('hello');
        notice(peers.size + ' nearby tab(s) in local room ' + room + '.');
      };
      send('join');
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
      const c = services.Cesium.Cartographic.fromCartesian(
        services.viewer.camera.positionWC,
      );
      if (!c) return;
      const rawHeight = Math.min(30000000, Math.max(1000, c.height));
      const view = {
        lat: Math.round(services.Cesium.Math.toDegrees(c.latitude) * 10) / 10,
        lon: Math.round(services.Cesium.Math.toDegrees(c.longitude) * 10) / 10,
        height: Math.round(rawHeight / 1000) * 1000,
      };
      send('view', view);
      notice('Coarse camera view shared with local tabs (about 0.1° precision).');
    });
    invite.addEventListener('click', async () => {
      const candidate = normalizeRoom(roomInput.value);
      if (!candidate) return notice('Enter a valid room first.');
      const link = makeRoomInvite(win.location.href, candidate);
      try {
        await win.navigator.clipboard.writeText(link);
        notice('Room link copied. Shared presence works only in same-origin tabs.');
      } catch {
        notice('Clipboard unavailable; copy this room code: ' + candidate);
      }
    });
    root.append(title, description, roomInput, actions, status, peersContainer);
    leaveRoom();
    notice('Disconnected. Joining is optional.');
    return leaveRoom;
  },
};
