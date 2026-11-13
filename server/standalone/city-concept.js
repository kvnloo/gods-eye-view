import { spawn as spawnProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROUTE = '/api/city-concept';
const SCRIPT = fileURLToPath(
  new URL('../../scripts/city-concept-server.py', import.meta.url),
);
const PYTHON = '/mnt/zer0models/comfyui/.venv/bin/python';
const BODY_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 600000;
const OUTPUT_LIMIT = IMAGE_LIMIT + 1024;
const FAILURE = { error: 'Local concept generation failed' };

function loopback(address = '') {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'));
}

function admitted(req) {
  if (!loopback(req.socket.remoteAddress)) return false;
  const host = req.headers.host;
  if (
    typeof host !== 'string' ||
    !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::[1-9]\d{0,4})?$/i.test(host)
  )
    return false;
  try {
    const expected = new URL(
      `${req.socket.encrypted ? 'https' : 'http'}://${host}`,
    ).origin;
    return (
      req.headers.origin === expected &&
      (!req.headers['sec-fetch-site'] ||
        req.headers['sec-fetch-site'] === 'same-origin')
    );
  } catch {
    return false;
  }
}

function respond(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function requestError(status) {
  const error = new Error('Invalid local concept request');
  error.status = status;
  return error;
}

function raster(value, limit) {
  if (typeof value !== 'string' || value.length > limit)
    throw requestError(400);
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match || match[2].length % 4 !== 0) throw requestError(400);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw requestError(400);
  const valid =
    match[1] === 'png'
      ? bytes.length >= 45 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')) &&
        bytes.toString('ascii', 12, 16) === 'IHDR' &&
        bytes
          .subarray(-12)
          .equals(Buffer.from('\x00\x00\x00\x00IEND\xaeB`\x82', 'latin1'))
      : bytes.length >= 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255 &&
        bytes.at(-2) === 255 &&
        bytes.at(-1) === 217;
  if (!valid) throw requestError(400);
  return value;
}

function readBody(req, signal) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const finish = (error) => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', fail);
      signal.removeEventListener('abort', abort);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks, length));
    };
    const data = (chunk) => {
      length += chunk.length;
      if (length > BODY_LIMIT) finish(requestError(413));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(requestError(400));
    const abort = () => finish(requestError(400));
    const timer = setTimeout(() => finish(requestError(408)), 15000);
    timer.unref();
    if (signal.aborted) {
      finish(requestError(400));
      return;
    }
    req.on('data', data);
    req.once('end', end);
    req.once('error', fail);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function parseRequest(bytes) {
  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    throw requestError(400);
  }
  if (
    !payload ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 2 ||
    typeof payload.prompt !== 'string' ||
    !payload.prompt.trim() ||
    Buffer.byteLength(payload.prompt) > 32768
  )
    throw requestError(400);
  return { prompt: payload.prompt, image: raster(payload.image, BODY_LIMIT) };
}

function parseOutput(bytes) {
  const payload = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (
    !payload ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 2 ||
    payload.provider !== 'local'
  )
    throw new Error('Invalid output');
  return { provider: 'local', image: raster(payload.image, IMAGE_LIMIT) };
}

function generate(payload, spawn, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const child = spawn(
      '/usr/bin/env',
      ['-i', `HOME=${homedir()}`, 'PATH=/usr/bin:/bin', PYTHON, SCRIPT],
      { env: {}, shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let length = 0;
    let failed = false;
    const chunks = [];
    const kill = () => {
      if (failed) return;
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, 660000);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
    };
    signal.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (chunk) => {
      if (failed) return;
      length += chunk.length;
      if (length > OUTPUT_LIMIT) kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', kill);
    child.stdout.on('error', kill);
    child.stderr.on('error', kill);
    child.once('error', () => {
      if (child.pid) kill();
      else {
        cleanup();
        reject(new Error('Subprocess failed'));
      }
    });
    child.once('close', (code) => {
      cleanup();
      if (failed || code !== 0) {
        reject(new Error('Subprocess failed'));
        return;
      }
      try {
        resolve(parseOutput(Buffer.concat(chunks, length)));
      } catch {
        reject(new Error('Invalid subprocess output'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function cityConceptPlugin({
  enabled = process.env.GEV_CITY_CONCEPT_LOCAL === '1',
  spawn = spawnProcess,
} = {}) {
  let busy = false;
  return {
    name: 'gev-city-concept-local',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((req, res, next) => {
        if (req.url !== ROUTE && !req.url?.startsWith(`${ROUTE}?`)) {
          next();
          return;
        }
        const deny = (status, payload) => {
          req.resume();
          respond(res, status, payload);
        };
        if (!admitted(req)) {
          deny(403, { error: 'Local request denied' });
          return;
        }
        if (req.url !== ROUTE) {
          deny(400, { error: 'Invalid local concept request' });
          return;
        }
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          deny(405, { error: 'POST required' });
          return;
        }
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            req.headers['content-type'] ?? '',
          )
        ) {
          deny(415, { error: 'JSON required' });
          return;
        }
        if (Number(req.headers['content-length']) > BODY_LIMIT) {
          deny(413, { error: 'Request too large' });
          return;
        }
        if (busy) {
          deny(409, { error: 'Local concept generator busy' });
          return;
        }
        busy = true;
        const controller = new AbortController();
        const abort = () => controller.abort();
        const close = () => {
          if (!res.writableEnded) abort();
        };
        req.once('aborted', abort);
        res.once('close', close);
        void (async () => {
          let payload;
          try {
            payload = parseRequest(await readBody(req, controller.signal));
          } catch (error) {
            respond(res, error.status ?? 400, {
              error: 'Invalid local concept request',
            });
            return;
          }
          try {
            respond(
              res,
              200,
              await generate(payload, spawn, controller.signal),
            );
          } catch {
            respond(res, 502, FAILURE);
          }
        })().finally(() => {
          busy = false;
          req.off('aborted', abort);
          res.off('close', close);
        });
      });
    },
  };
}
