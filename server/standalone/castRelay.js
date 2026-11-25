/**
 * Cast relay for the standalone server: a phone puts GEV on a TV and stays
 * its remote. Ported from Sound Atlas (kvnloo/fframestudio
 * web/src/music-atlas/cast.js), with one change: the Samsung launch runs here,
 * on the machine that shares the TV's LAN, so a phone needs no Local Network
 * Access permission and can cast from anywhere the app is reachable.
 *
 * Rooms live in memory. A TV view (`?tv=samsung|cast#room=<code>`) polls
 * `tv` once a second with its state and receives the newest view the phone
 * sent; the phone writes views with `send` and reads the TV with `peek`.
 *
 * Routes (POST, JSON):
 *   /api/cast/config   → { tvOrigin, samsung: { configured, name } }
 *   /api/cast/tv       { room, kind, name, status, frame? } → { cmd?, seq }
 *   /api/cast/send     { room, hash } → { seq }
 *   /api/cast/peek     { room } → { tv, age, frameAge }
 *   /api/cast/frame    { room } → { frame } (the TV's last self-capture)
 *   /api/cast/samsung  { } → { room, name } once the launched TV app reports
 */

import { networkInterfaces } from 'node:os';

export const ROOM_PATTERN = /^[a-z0-9]{6}$/;
const MAX_BODY = 600_000; // a TV self-capture is a small JPEG data URL
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The in-memory rooms. Exposed for tests.
 * @param {{ now?: () => number }} [options]
 */
export function createCastRooms({ now = Date.now } = {}) {
  const rooms = new Map();
  const room = (code) => {
    let entry = rooms.get(code);
    if (!entry) {
      entry = {
        seq: 0,
        cmd: null,
        cmdAt: 0,
        tv: null,
        tvAt: 0,
        frame: null,
        frameAt: 0,
      };
      rooms.set(code, entry);
    }
    entry.touched = now();
    return entry;
  };
  const prune = () => {
    const cutoff = now() - ROOM_TTL_MS;
    for (const [code, entry] of rooms)
      if (entry.touched < cutoff) rooms.delete(code);
  };
  return {
    /** The phone sends the view (a share hash) for the TV to show. */
    send(code, hash) {
      prune();
      const entry = room(code);
      entry.seq += 1;
      entry.cmd = { hash: String(hash).slice(0, 4000) };
      entry.cmdAt = now();
      return { seq: entry.seq };
    },
    /** A TV heartbeat; answers with the newest command after `after`. */
    tv(code, { after = 0, status = null, frame = null } = {}) {
      const entry = room(code);
      entry.tv = status && typeof status === 'object' ? status : {};
      entry.tvAt = now();
      if (typeof frame === 'string' && frame.startsWith('data:image/')) {
        entry.frame = frame;
        entry.frameAt = now();
      }
      if (entry.cmd && entry.seq > after)
        return { seq: entry.seq, cmd: entry.cmd, age: now() - entry.cmdAt };
      return { seq: entry.seq };
    },
    /** What the TV last reported and how long ago (ms). */
    peek(code) {
      const entry = rooms.get(code);
      if (!entry?.tvAt) return { tv: null, age: null, frameAge: null };
      return {
        tv: entry.tv,
        age: now() - entry.tvAt,
        frameAge: entry.frameAt ? now() - entry.frameAt : null,
      };
    },
    frame(code) {
      return rooms.get(code)?.frame ?? null;
    },
    /** The freshest TV of a kind (the Samsung app keeps its own room code). */
    freshestTv(kind, maxAgeMs = 4000) {
      let best = null;
      for (const [code, entry] of rooms) {
        if (entry.tv?.kind !== kind || !entry.tvAt) continue;
        const age = now() - entry.tvAt;
        if (age <= maxAgeMs && (!best || age < best.age))
          best = { room: code, tv: entry.tv, age };
      }
      return best;
    },
  };
}

/** The first private IPv4 address of this machine (the TV's LAN side). */
export function lanAddress(interfaces = networkInterfaces()) {
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))
        return item.address;
    }
  }
  return null;
}

/**
 * Where a TV loads GEV from: GEV_CAST_TV_ORIGIN, else this machine's LAN
 * address and port. A phone's own origin (a tailnet name, localhost) is
 * usually not reachable from a TV.
 */
export function resolveTvOrigin(
  env = process.env,
  { port, address = lanAddress() } = {},
) {
  const configured = String(env.GEV_CAST_TV_ORIGIN ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (!address || !port) return null;
  return `http://${address}:${port}`;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch the GEV app on a Samsung TV through its LAN REST API
 * (`POST http://<tv>:8001/api/v2/applications/<appId>`); the app opens the
 * TV view and reports in its room.
 */
export async function launchSamsungApp({ ip, appId, fetchImpl = fetch }) {
  const url = `http://${ip}:8001/api/v2/applications/${encodeURIComponent(appId)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(6000),
  });
  return { ok: response.ok, status: response.status };
}

/**
 * Handle one cast request. Split from the plugin so tests need no server.
 * @param {object} context
 */
export async function handleCast(
  route,
  body,
  {
    rooms,
    env = process.env,
    port,
    fetchImpl = fetch,
    waitMs = 25000,
    pollMs = 1000,
  },
) {
  const code = String(body?.room ?? '').toLowerCase();
  switch (route) {
    case 'config':
      return [
        200,
        {
          tvOrigin: resolveTvOrigin(env, { port }),
          samsung: {
            configured: Boolean(env.GEV_SAMSUNG_TV_IP),
            name: env.GEV_SAMSUNG_TV_NAME || 'Samsung TV',
          },
        },
      ];
    case 'tv':
      if (!ROOM_PATTERN.test(code)) return [400, { error: 'Bad room' }];
      return [
        200,
        rooms.tv(code, {
          after: Number(body.after) || 0,
          status: {
            ...(body.status ?? {}),
            kind: String(body.kind ?? 'tv').slice(0, 16),
          },
          frame: body.frame,
        }),
      ];
    case 'send':
      if (!ROOM_PATTERN.test(code)) return [400, { error: 'Bad room' }];
      if (typeof body.hash !== 'string')
        return [400, { error: 'Missing hash' }];
      return [200, rooms.send(code, body.hash)];
    case 'peek':
      if (!ROOM_PATTERN.test(code)) return [400, { error: 'Bad room' }];
      return [200, rooms.peek(code)];
    case 'frame':
      if (!ROOM_PATTERN.test(code)) return [400, { error: 'Bad room' }];
      return [200, { frame: rooms.frame(code) }];
    case 'samsung': {
      const ip = env.GEV_SAMSUNG_TV_IP;
      const appId = env.GEV_SAMSUNG_TV_APP || 'GEVCastTV1.GodsEyeView';
      if (!ip)
        return [501, { error: 'No Samsung TV configured (GEV_SAMSUNG_TV_IP)' }];
      let fresh = rooms.freshestTv('samsung', 4000);
      if (!fresh) {
        let launched;
        try {
          launched = await launchSamsungApp({ ip, appId, fetchImpl });
        } catch (error) {
          return [
            502,
            { error: `The TV did not answer at ${ip} (${error.name})` },
          ];
        }
        if (!launched.ok)
          return [
            502,
            {
              error: `The TV refused to open the app (HTTP ${launched.status})`,
            },
          ];
        for (const end = Date.now() + waitMs; !fresh && Date.now() < end;) {
          await sleep(pollMs);
          fresh = rooms.freshestTv('samsung', 4000);
        }
      }
      if (!fresh)
        return [504, { error: 'The TV app opened but GEV did not report in' }];
      return [
        200,
        {
          room: fresh.room,
          name: fresh.tv.name || env.GEV_SAMSUNG_TV_NAME || 'Samsung TV',
        },
      ];
    }
    default:
      return [404, { error: 'Unknown cast route' }];
  }
}

/** Vite plugin: the cast relay on the dev and preview servers. */
export function castRelayPlugin({ env = process.env } = {}) {
  const rooms = createCastRooms();
  const install = (server) => {
    server.middlewares.use('/api/cast', async (req, res) => {
      if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' });
      const route = (req.url ?? '').replace(/^\/+/, '').split(/[/?]/)[0];
      try {
        const body = await readJson(req);
        const port =
          server.config?.server?.port ?? server.config?.preview?.port;
        const [status, payload] = await handleCast(route, body, {
          rooms,
          env,
          port,
        });
        reply(res, status, payload);
      } catch (error) {
        reply(res, error.status ?? 500, { error: error.message });
      }
    });
  };
  return {
    name: 'gev-cast-relay',
    configureServer: install,
    configurePreviewServer: install,
  };
}
