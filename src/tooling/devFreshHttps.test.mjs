import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(
  new URL('../../scripts/dev-fresh.sh', import.meta.url),
);

test('dev-fresh prints URLs matching optional HTTPS', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-dev-fresh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  // No real server starts, processes are killed, or credentials are consulted.
  const shims = {
    npm: 'echo launch-stub',
    pkill: 'exit 0',
    lsof: 'exit 1',
    security: 'exit 1',
    ipconfig: 'echo 192.0.2.10',
  };
  await Promise.all(
    Object.entries(shims).map(([name, body]) =>
      writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 }),
    ),
  );

  const run = (tls = {}) =>
    spawnSync('bash', [launcher], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
        HOME: root,
        GEV_PROJECT_ROOT: root,
        HOST: '0.0.0.0',
        PORT: '4713',
        OPENSKY_AUTH_MODE: 'anon',
        ...tls,
      },
    });

  const plain = run();
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /LAN URL: http:\/\/192\.0\.2\.10:4713\//);
  assert.match(
    plain.stdout,
    /URL \(this machine\): http:\/\/localhost:4713\//,
  );

  const secure = run({
    HTTPS_CERT_FILE: '/fixtures/cert.pem',
    HTTPS_KEY_FILE: '/fixtures/key.pem',
  });
  assert.equal(secure.status, 0, secure.stderr);
  assert.match(secure.stdout, /LAN URL: https:\/\/192\.0\.2\.10:4713\//);
  assert.match(
    secure.stdout,
    /URL \(this machine\): https:\/\/localhost:4713\//,
  );
  assert.doesNotMatch(secure.stdout, /LAN URL: http:\/\//);

  const incomplete = run({ HTTPS_CERT_FILE: '/fixtures/cert.pem' });
  assert.equal(incomplete.status, 1, incomplete.stderr);
  assert.match(
    incomplete.stderr,
    /Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE/,
  );
  assert.doesNotMatch(incomplete.stdout, /launch-stub/);
});
