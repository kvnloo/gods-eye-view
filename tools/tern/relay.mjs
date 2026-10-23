import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { normalizeSnapshot } from './projection.mjs';

const MAX_MESSAGE_BYTES = 64 * 1024;
const REQUEST_SNAPSHOT = '{"type":"snapshot-request"}';
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The browser origin must be explicit; never accept wildcards or foreign hosts. */
export function localGlobeUrl(input = 'http://localhost:4173/') {
  const url = new URL(input);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new TypeError('GEV Tern only accepts a local http://localhost or 127.0.0.1 globe');
  if (url.searchParams.has('gevTernToken') || url.searchParams.has('gevTernPort'))
    throw new TypeError('Do not include bridge credentials in the globe URL');
  url.hash = '';
  return url;
}

/**
 * Authenticated, local-only WebSocket relay. GEV is always the state owner.
 * No mutation commands, arbitrary URL loads, or browser-controlled scripts.
 */
export async function createLocalRelay({
  appUrl = 'http://localhost:4173/',
  port = 0,
  token = randomBytes(32).toString('base64url'),
  onSnapshot = () => {},
  onStatus = () => {},
} = {}) {
  const app = localGlobeUrl(appUrl);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError('Invalid token');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Invalid relay port');

  const expectedToken = Buffer.from(token);
  const expectedOrigin = app.origin;
  const server = createServer((_request, response) => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });

  let active = null;
  let generation = 0;
  let stopped = false;

  server.on('upgrade', (request, socket, head) => {
    const target = new URL(request.url || '/', 'http://127.0.0.1');
    const presentedToken = Buffer.from(target.searchParams.get('token') || '');
    const allowed =
      !stopped &&
      request.method === 'GET' &&
      LOOPBACK_PEERS.has(request.socket.remoteAddress) &&
      request.headers.origin === expectedOrigin &&
      target.pathname === '/' &&
      target.searchParams.size === 1 &&
      target.searchParams.has('token') &&
      presentedToken.length === expectedToken.length &&
      timingSafeEqual(presentedToken, expectedToken);

    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (stopped) {
        ws.terminate();
        return;
      }

      // A newer authenticated tab wins. Its predecessor cannot publish again.
      const old = active;
      const mine = ++generation;
      active = ws;
      old?.terminate();
      onStatus('connected');
      ws.on('message', (bytes, binary) => {
        if (stopped || active !== ws || mine !== generation) return;
        if (binary || bytes.length > MAX_MESSAGE_BYTES) {
          ws.close(1003, 'Text snapshot required');
          return;
        }
        let decoded;
        try {
          decoded = JSON.parse(bytes.toString('utf8'));
        } catch {
          ws.close(1007, 'Invalid snapshot');
          return;
        }
        const snapshot = normalizeSnapshot(decoded);
        if (snapshot) onSnapshot(snapshot);
      });
      ws.on('close', () => {
        if (active !== ws || mine !== generation || stopped) return;
        active = null;
        onStatus('disconnected');
      });
      ws.on('error', () => {
        // Close owns the status transition. No secret-bearing URLs in logs.
      });
      ws.send(REQUEST_SNAPSHOT);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const localPort = server.address().port;
  const link = new URL(app.href);
  link.searchParams.set('gevTernPort', String(localPort));
  link.searchParams.set('gevTernToken', token);

  return Object.freeze({
    port: localPort,
    browserUrl: link.href,
    /** The shared password never appears in the bridge's observable status. */
    requestSnapshot() {
      if (!active || active.readyState !== active.OPEN || stopped) return false;
      active.send(REQUEST_SNAPSHOT);
      return true;
    },
    async close() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      active?.terminate();
      active = null;
      await Promise.all([
        new Promise((resolve) => wss.close(resolve)),
        new Promise((resolve) => server.close(resolve)),
      ]);
    },
  });
}
