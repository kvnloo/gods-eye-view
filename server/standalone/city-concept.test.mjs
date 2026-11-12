import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cityConceptPlugin } from './city-concept.js';
import { createPlanningConceptGenerator } from '../../src/data/planningConceptGenerator.js';

// The real-Python bridge tests need the interpreter the endpoint pins; skip, never fake, elsewhere.
const BRIDGE_PYTHON = '/mnt/zer0models/comfyui/.venv/bin/python';
const bridgeSkip = existsSync(BRIDGE_PYTHON)
  ? false
  : `needs the pinned bridge interpreter ${BRIDGE_PYTHON}`;

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
const body = () =>
  JSON.stringify({
    prompt: 'AI concept, not a plan or an approval. Add trees.',
    image: PNG,
  });
const script = fileURLToPath(
  new URL('../../scripts/city-concept-server.py', import.meta.url),
);

function subprocesses() {
  const calls = [];
  const spawn = (...args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.input = '';
    child.stdin.on('data', (chunk) => {
      child.input += chunk;
    });
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    child.finish = (value = { provider: 'local', image: PNG }, code = 0) => {
      child.stdout.end(
        typeof value === 'string' ? value : JSON.stringify(value),
      );
      child.emit('close', code);
    };
    calls.push({ args, child });
    return child;
  };
  return { calls, spawn };
}

async function setup(t, options = {}) {
  const fake = subprocesses();
  const plugin = cityConceptPlugin({
    enabled: true,
    spawn: fake.spawn,
    ...options,
  });
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      req.resume();
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const host = `127.0.0.1:${server.address().port}`;
  const send = ({
    path = '/api/city-concept',
    method = 'POST',
    data = body(),
    headers = {},
  } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path,
          method,
          headers: {
            host,
            origin: `http://${host}`,
            'content-type': 'application/json',
            ...(headers['transfer-encoding']
              ? {}
              : { 'content-length': Buffer.byteLength(data) }),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, text }),
          );
        },
      );
      req.on('error', reject);
      req.end(data);
    });
  return {
    ...fake,
    plugin,
    middleware,
    server,
    send,
    host,
    port: server.address().port,
  };
}

async function untilSpawn(calls, count = 1) {
  for (let i = 0; i < 100 && calls.length < count; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, count);
  return calls[count - 1].child;
}

test('plugin is opt-in and dev-only, with no preview hook', () => {
  const disabled = cityConceptPlugin({
    enabled: false,
    spawn: () => assert.fail('no subprocess'),
  });
  let installed = false;
  disabled.configureServer({
    middlewares: {
      use() {
        installed = true;
      },
    },
  });
  assert.equal(installed, false);
  assert.equal(disabled.apply, 'serve');
  assert.equal(disabled.configurePreviewServer, undefined);
});

test('endpoint denies missing/foreign origins, foreign hosts, wrong ports, methods, paths and non-JSON bodies', async (t) => {
  const { send, calls, host } = await setup(t);
  for (const origin of [
    '',
    'null',
    'http://evil.example',
    `http://${host}.evil.example`,
    `http://${host}/path`,
    `http://user@${host}`,
    'https://127.0.0.1:1',
  ]) {
    assert.equal((await send({ headers: { origin } })).status, 403, origin);
  }
  for (const foreign of [
    'evil.example',
    'localhost.evil.example',
    '2130706433',
    '127.0.0.1.evil.example',
    'localhost@evil.example',
  ]) {
    assert.equal(
      (await send({ headers: { host: foreign, origin: `http://${foreign}` } }))
        .status,
      403,
    );
  }
  assert.equal(
    (
      await send({
        headers: { 'x-forwarded-host': host, origin: 'http://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal((await send({ method: 'GET' })).status, 405);
  assert.equal((await send({ path: '/api/city-concept/extra' })).status, 404);
  assert.equal(
    (await send({ path: '/api/city-concept?script=/tmp/evil.py' })).status,
    400,
  );
  assert.equal(
    (await send({ headers: { 'content-type': 'text/plain' } })).status,
    415,
  );
  assert.equal(calls.length, 0);
});

test('denied methods use valid HTTP framing without poisoning the next request', async (t) => {
  const { send, server, calls } = await setup(t);
  const parserErrors = [];
  server.on('clientError', (error, socket) => {
    parserErrors.push(error.code);
    socket.destroy();
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal((await send({ method: 'GET' })).status, 405);
    assert.equal(
      (await send({ headers: { origin: 'http://evil.example' } })).status,
      403,
    );
  }
  assert.deepEqual(parserErrors, []);
  assert.equal(calls.length, 0);
});

test('endpoint rejects a non-loopback remote address even with local headers', async (t) => {
  const { middleware } = await setup(t);
  const req = Readable.from([body()]);
  Object.assign(req, {
    url: '/api/city-concept',
    method: 'POST',
    headers: {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '192.168.1.2' },
  });
  const res = new EventEmitter();
  res.setHeader = () => {};
  const ended = new Promise((resolve) => {
    res.end = resolve;
  });
  middleware(req, res, () =>
    assert.fail('matched endpoint must not pass through'),
  );
  await ended;
  assert.equal(res.statusCode, 403);
});

test('request schema and 1 MiB body limits are enforced before spawn', async (t) => {
  const { send, calls } = await setup(t);
  for (const value of [
    'not-json',
    'null',
    '{}',
    JSON.stringify({ prompt: 'x', image: PNG, script: '/tmp/evil' }),
    JSON.stringify({ prompt: 'x', image: 'https://example.org/ref.png' }),
    JSON.stringify({ prompt: 'x', image: 'data:image/png;base64,PHN2Zy8+' }),
    JSON.stringify({ prompt: 'x'.repeat(33000), image: PNG }),
  ]) {
    assert.equal((await send({ data: value })).status, 400);
  }
  assert.equal((await send({ data: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal(
    (
      await send({
        data: 'x'.repeat(1024 * 1024 + 1),
        headers: { 'transfer-encoding': 'chunked' },
      })
    ).status,
    413,
  );
  assert.equal(calls.length, 0);
});

test('successful endpoint spawns only the fixed isolated Python command and emits an uncached bounded response', async (t) => {
  const { send, calls } = await setup(t);
  const pending = send();
  const child = await untilSpawn(calls);
  assert.deepEqual(JSON.parse(child.input), JSON.parse(body()));
  const [command, args, options] = calls[0].args;
  assert.equal(command, '/usr/bin/env');
  assert.deepEqual(args, [
    '-i',
    `HOME=${homedir()}`,
    'PATH=/usr/bin:/bin',
    '/mnt/zer0models/comfyui/.venv/bin/python',
    script,
  ]);
  assert.deepEqual(options.env, {});
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  child.finish();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.text), { provider: 'local', image: PNG });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(!result.headers['access-control-allow-origin']);
});

test('only one request runs at a time and failures release the slot without retries or leaked secrets', async (t) => {
  const { send, calls } = await setup(t);
  const first = send();
  const child = await untilSpawn(calls);
  assert.equal((await send()).status, 409);
  assert.equal(calls.length, 1);
  child.stderr.write('SECRET_TOKEN from upstream');
  child.finish('SECRET_TOKEN traceback', 1);
  const failed = await first;
  assert.equal(failed.status, 502);
  assert.ok(failed.text.length < 200);
  assert.ok(!failed.text.includes('SECRET'));
  const next = send();
  (await untilSpawn(calls, 2)).finish();
  assert.equal((await next).status, 200);
  assert.equal(calls.length, 2);
});

test('malformed, spoofed and oversized subprocess outputs are rejected', async (t) => {
  const { send, calls } = await setup(t);
  const invalid = [
    'not json',
    { provider: 'fixture', image: PNG },
    { provider: 'local', image: 'https://example.org/x' },
    { provider: 'local', image: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { provider: 'local', image: PNG, token: 'secret' },
    'x'.repeat(601025),
  ];
  for (const [index, value] of invalid.entries()) {
    const pending = send();
    (await untilSpawn(calls, index + 1)).finish(value);
    const result = await pending;
    assert.equal(result.status, 502);
    assert.ok(result.text.length < 200);
  }
});

test('disconnect during upload releases admission without spawning', async (t) => {
  const { host, port, calls, send } = await setup(t);
  const req = request({
    host: '127.0.0.1',
    port,
    path: '/api/city-concept',
    method: 'POST',
    headers: {
      host,
      origin: `http://${host}`,
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    },
  });
  req.on('error', () => {});
  req.write('{');
  for (let i = 0; i < 100; i++) {
    const result = await send({ data: '{}' });
    if (result.status === 409) break;
    assert.equal(result.status, 400);
    if (i === 99) assert.fail('upload was not admitted');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  req.destroy();
  for (let i = 0; i < 100; i++) {
    const result = await send({ data: '{}' });
    if (result.status === 400) break;
    assert.equal(result.status, 409);
    if (i === 99) assert.fail('aborted upload retained admission');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(calls.length, 0);
});

test('spawn errors are generic and do not poison admission', async (t) => {
  const { send } = await setup(t, {
    spawn: () => {
      throw new Error('SECRET spawn failure');
    },
  });
  for (let i = 0; i < 2; i++) {
    const result = await send();
    assert.equal(result.status, 502);
    assert.ok(!result.text.includes('SECRET'));
  }
});

test('adapter and local HTTP endpoint complete the explicit generation flow with a fake subprocess', async (t) => {
  const { host, calls } = await setup(t);
  const generator = createPlanningConceptGenerator({
    provider: 'local',
    now: () => '2026-11-10T12:00:00.000Z',
    fetch: (route, options) =>
      fetch(`http://${host}${route}`, {
        ...options,
        headers: { ...options.headers, Origin: `http://${host}` },
      }),
  });
  const sourceView = {
    camera: { height: 500 },
    bounds: [-88.2, 40, -88.1, 40.1],
    sources: ['Synthetic map'],
    capturedAt: '2026-11-10T12:00:00.000Z',
    image: PNG,
  };
  const pending = generator.generate({
    description: 'Add shade',
    parameters: { trees: 5 },
    sourceView,
  });
  const child = await untilSpawn(calls);
  assert.match(JSON.parse(child.input).prompt, /Add shade/);
  child.finish();
  const result = await pending;
  assert.equal(result.provider, 'chatgpt-subscription/comfyui-codex-image');
  assert.equal(result.label, 'AI concept, not a plan or an approval');
  assert.deepEqual(result.sourceView, sourceView);
});

test('client disconnect kills generation and holds admission until child exit', async (t) => {
  const { host, port, calls, send } = await setup(t);
  const req = request({
    host: '127.0.0.1',
    port,
    path: '/api/city-concept',
    method: 'POST',
    headers: {
      host,
      origin: `http://${host}`,
      'content-type': 'application/json',
    },
  });
  req.on('error', () => {});
  req.end(body());
  const child = await untilSpawn(calls);
  child.kill = () => {
    child.killed = true;
    return true;
  };
  req.destroy();
  for (let i = 0; i < 100 && !child.killed; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(child.killed, true);
  assert.equal((await send()).status, 409);
  child.emit('close', null, 'SIGKILL');
  const next = send();
  (await untilSpawn(calls, 2)).finish();
  assert.equal((await next).status, 200);
});

test('child process errors cannot release a still-running generation slot', async (t) => {
  const { calls, send } = await setup(t);
  const pending = send();
  const child = await untilSpawn(calls);
  child.pid = 12345;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.emit('error', new Error('SECRET failure while process is alive'));
  assert.equal(child.killed, true);
  assert.equal((await send()).status, 409);
  child.emit('close', 1);
  assert.equal((await pending).status, 502);
});

test(
  'Python CLI rejects invalid input and arbitrary arguments with generic errors before generation',
  { skip: bridgeSkip },
  () => {
    for (const [args, input] of [
      [[], 'not JSON'],
      [
        [],
        JSON.stringify({ prompt: 'x', image: 'https://example.org/ref.png' }),
      ],
      [
        [],
        JSON.stringify({
          prompt: 'x',
          image: 'data:image/png;base64,PHN2Zy8+',
        }),
      ],
      [[], 'x'.repeat(1024 * 1024 + 1)],
      [['--generator=/tmp/not-allowed.py'], '{}'],
    ]) {
      const result = spawnSync(
        '/usr/bin/env',
        [
          '-i',
          `HOME=${homedir()}`,
          'PATH=/usr/bin:/bin',
          '/mnt/zer0models/comfyui/.venv/bin/python',
          '-B',
          script,
          ...args,
        ],
        { input, encoding: 'utf8', env: {} },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Local concept generation failed\n');
    }
  },
);

test(
  'Python bridge converts JPEG references to PNG, calls installed generate once, and bounds its JPEG output without network',
  { skip: bridgeSkip },
  () => {
    const code = String.raw`
import base64, contextlib, importlib.util, io, json, pathlib, random, runpy, sys, types
from unittest.mock import patch
from PIL import Image
script = sys.argv[1]
ref = io.BytesIO()
Image.new('RGB', (32, 20), '#7799aa').save(ref, 'JPEG')
calls = []
def generate(prompt, images, **kwargs):
    calls.append((prompt, images, kwargs))
    assert base64.b64decode(images[0]).startswith(b'\x89PNG\r\n\x1a\n')
    assert Image.open(io.BytesIO(base64.b64decode(images[0]))).size == (32, 20)
    print('SECRET noisy generator output')
    image = Image.frombytes('RGB', (1536, 1024), random.Random(0).randbytes(1536 * 1024 * 3))
    raw = io.BytesIO()
    image.save(raw, 'JPEG', quality=85, optimize=True)
    assert len(base64.b64encode(raw.getvalue())) > 600000
    return image
module = types.SimpleNamespace(generate=generate)
class Loader:
    def exec_module(self, loaded):
        assert loaded is module
spec = types.SimpleNamespace(loader=Loader())
def locate(name, path):
    assert str(path) == '/mnt/zer0models/comfyui/custom_nodes/comfyui-codex-image/__init__.py'
    return spec
payload = {'prompt': 'A shade concept, not approval', 'image': 'data:image/jpeg;base64,' + base64.b64encode(ref.getvalue()).decode()}
out = io.StringIO()
with patch.object(sys, 'stdin', io.StringIO(json.dumps(payload))), patch.object(sys, 'argv', [script]), patch.object(importlib.util, 'spec_from_file_location', locate), patch.object(importlib.util, 'module_from_spec', lambda spec: module), contextlib.redirect_stdout(out):
    runpy.run_path(script, run_name='__main__')
result = json.loads(out.getvalue())
assert set(result) == {'provider', 'image'}
assert result['provider'] == 'local'
assert result['image'].startswith('data:image/jpeg;base64,')
assert len(result['image']) <= 600000
image = Image.open(io.BytesIO(base64.b64decode(result['image'].split(',')[1])))
assert image.format == 'JPEG'
assert image.width <= 1536 and image.height <= 1024
assert len(calls) == 1
assert calls[0][0] == payload['prompt']
assert calls[0][2] == {'size': '1536x1024'}
print('Python bridge passed without real generation')
`;
    const result = spawnSync(
      '/usr/bin/env',
      [
        '-i',
        `HOME=${homedir()}`,
        'PATH=/usr/bin:/bin',
        '/mnt/zer0models/comfyui/.venv/bin/python',
        '-B',
        '-c',
        code,
        script,
      ],
      { encoding: 'utf8', env: {} },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed without real generation/);
  },
);
