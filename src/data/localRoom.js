/**
 * Same-origin local rooms over BroadcastChannel.
 *
 * This is the Planet Playground local-room contract (fork #253,
 * src/playground/features/04-multiplayer.js, `gev.playground.local-room.v1`):
 * the same room-code rule, envelope, join/hello/leave presence, 15 s
 * heartbeat and 75 s expiry, and a strict parser that never retains unknown
 * fields. City rooms add one packet kind, `ops`, that carries typed
 * collaboration operations. BroadcastChannel reaches only tabs of this
 * browser profile on this device; there is no server and no internet room.
 */
export const LOCAL_ROOM_PROTOCOL = 'gev.city.local-room.v1';
export const HEARTBEAT_MS = 15_000;
export const PEER_EXPIRE_MS = 75_000;
const PEER = /^p-[a-z0-9]{6,16}$/;
const VIEWING = /^alt-p-[a-z0-9]{6,16}-[1-9][0-9]{0,5}$/;
const MAX_OPS_PER_PACKET = 2000;

export function normalizeRoomCode(raw) {
  const room = String(raw ?? '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9-]{3,24}$/.test(room) ? room : null;
}

export function displayName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name && name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(name)
    ? name
    : null;
}

/**
 * Presence says who is in the room and which proposal they inspect. It never
 * carries a camera, coordinates or any other location; such fields are dropped.
 */
export function parseLocalRoomPacket(raw, room, now = Date.now()) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    raw.protocol !== LOCAL_ROOM_PROTOCOL ||
    raw.room !== room ||
    typeof raw.peer !== 'string' ||
    !PEER.test(raw.peer) ||
    !['join', 'hello', 'leave', 'ops'].includes(raw.kind) ||
    !Number.isFinite(raw.sentAt) ||
    Math.abs(now - raw.sentAt) > 60_000
  )
    return null;
  const packet = {
    protocol: LOCAL_ROOM_PROTOCOL,
    room,
    peer: raw.peer,
    sentAt: raw.sentAt,
    kind: raw.kind,
  };
  if (raw.kind === 'leave') return packet;
  if (raw.kind === 'ops') {
    if (!Array.isArray(raw.ops) || raw.ops.length > MAX_OPS_PER_PACKET)
      return null;
    // Operations are validated one by one by the room kernel.
    return { ...packet, ops: raw.ops };
  }
  const name = displayName(raw.name);
  if (!name) return null;
  const viewing =
    typeof raw.viewing === 'string' && VIEWING.test(raw.viewing)
      ? raw.viewing
      : null;
  return { ...packet, name, viewing };
}

/**
 * Join one local room. `onPacket` receives validated packets from other tabs;
 * `onPeers` receives the live presence map whenever membership changes.
 */
export function openLocalRoom({
  BroadcastChannel: Channel = globalThis.BroadcastChannel,
  room,
  peer,
  presence,
  onPacket,
  onPeers,
  onClosed,
  timers = globalThis,
  now = () => Date.now(),
}) {
  if (!normalizeRoomCode(room) || room !== normalizeRoomCode(room))
    throw new TypeError('invalid room code');
  if (!PEER.test(peer)) throw new TypeError('invalid peer id');
  if (typeof Channel !== 'function')
    throw new Error('BroadcastChannel unavailable');
  const channel = new Channel(`gev-city-room:${room}`);
  const peers = new Map();
  let closed = false;
  let heartbeat = null;
  const publishPeers = () =>
    onPeers?.(new Map([...peers].map(([id, entry]) => [id, { ...entry }])));
  function send(kind, body = {}) {
    if (closed) return false;
    try {
      channel.postMessage({
        protocol: LOCAL_ROOM_PROTOCOL,
        room,
        peer,
        sentAt: now(),
        kind,
        ...body,
      });
      return true;
    } catch {
      return false;
    }
  }
  function close(reason = 'left', notify = true) {
    if (closed) return;
    if (notify) send('leave');
    closed = true;
    if (heartbeat !== null) timers.clearInterval(heartbeat);
    heartbeat = null;
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Local state still clears when closing fails.
    }
    peers.clear();
    publishPeers();
    onClosed?.(reason);
  }
  channel.onmessage = (event) => {
    if (closed) return;
    const packet = parseLocalRoomPacket(event.data, room, now());
    if (!packet) return;
    if (packet.peer === peer) {
      // Another tab holds this identity (for example a duplicated tab). The
      // tab that was here first answers the join; the newcomer, hearing its
      // own identity answer, yields so the incumbent keeps its authorship.
      if (packet.kind === 'join') send('hello', presence());
      else if (packet.kind === 'hello') close('duplicate-identity', false);
      return;
    }
    if (packet.kind === 'leave') {
      if (peers.delete(packet.peer)) publishPeers();
    } else if (packet.kind === 'join' || packet.kind === 'hello') {
      const prior = peers.get(packet.peer);
      peers.set(packet.peer, {
        name: packet.name,
        viewing: packet.viewing,
        seenAt: now(),
      });
      if (
        !prior ||
        prior.name !== packet.name ||
        prior.viewing !== packet.viewing
      )
        publishPeers();
    }
    // Answer a newcomer at once so it need not wait for a heartbeat.
    if (packet.kind === 'join' && !send('hello', presence())) {
      close('unavailable', false);
      return;
    }
    onPacket?.(packet);
  };
  heartbeat = timers.setInterval(() => {
    const at = now();
    let changed = false;
    for (const [id, entry] of peers) {
      if (at - entry.seenAt > PEER_EXPIRE_MS) {
        peers.delete(id);
        changed = true;
      }
    }
    if (changed) publishPeers();
    if (!send('hello', presence())) close('unavailable', false);
  }, HEARTBEAT_MS);
  if (!send('join', presence())) {
    close('unavailable', false);
    return null;
  }
  return {
    send,
    announce: () => send('hello', presence()),
    close,
    get closed() {
      return closed;
    },
  };
}
