/**
 * FORK-ONLY: keeps `src/testSupport/forkOnlyExempt.mjs` honest. Each guard
 * that reads the list also fails when a file listed for it stops offending
 * there; this checks the list itself.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FORK_ONLY_EXEMPT,
  FORK_ONLY_GUARDS,
  FORK_ONLY_REASON,
  forkOnlyExempt,
  partitionForkOnly,
} from './testSupport/forkOnlyExempt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = Object.keys(FORK_ONLY_EXEMPT);
const readJson = (rel) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

test('the fork-only list is sorted, and every entry exists and says why', () => {
  assert.deepEqual(files, [...files].sort());
  assert.deepEqual(FORK_ONLY_GUARDS, [...FORK_ONLY_GUARDS].sort());
  for (const [file, { reason, guards }] of Object.entries(FORK_ONLY_EXEMPT)) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} does not exist`);
    assert.equal(reason, FORK_ONLY_REASON, file);
    assert.ok(guards.length > 0, `${file} names no guard`);
    assert.deepEqual(guards, [...new Set(guards)].sort(), file);
    for (const guard of guards)
      assert.ok(FORK_ONLY_GUARDS.includes(guard), `${file}: ${guard}`);
  }
});

test('every guard on the list is read by its test', () => {
  // A guard id no test reads would set nothing aside and check nothing.
  const readers = {
    cesiumInternals: 'src/render/cesium/internals.test.mjs',
    heightService: 'src/queries/heights.test.mjs',
    inputDispatcher: 'src/data/inputOwnership.test.mjs',
    noCesiumOutsideRender: 'src/render/noCesiumOutsideRender.test.mjs',
    viewerAccess: 'src/render/viewerAccess.test.mjs',
  };
  assert.deepEqual(Object.keys(readers).sort(), [...FORK_ONLY_GUARDS]);
  for (const [guard, reader] of Object.entries(readers)) {
    const source = readFileSync(path.join(ROOT, reader), 'utf8');
    assert.match(source, new RegExp(`partitionForkOnly\\(\\s*'${guard}'`), reader);
    assert.match(source, /\.unused/, `${reader} must fail on stale entries`);
  }
});

test('no fork-only file is on an upstream ratchet', () => {
  const cesiumList = new Set(readJson('src/render/cesiumAllowList.json'));
  const viewerBaseline = readJson('src/render/viewerAccessAllowList.json');
  for (const file of files) {
    assert.ok(!cesiumList.has(file), `${file} is on cesiumAllowList.json`);
    assert.ok(!(file in viewerBaseline), `${file} is in viewerAccessAllowList.json`);
  }
});

test('every fork-only file is absent from origin/main', (t) => {
  const git = (...args) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    t.skip('origin/main is not available');
    return;
  }
  const upstream = git('ls-tree', '-r', '--name-only', base, '--', ...files)
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(upstream, [], 'upstream files cannot be fork-only');
});

test('partitionForkOnly sets aside only listed files, and names unused entries', () => {
  const [guard] = FORK_ONLY_GUARDS;
  const exempt = [...forkOnlyExempt(guard)];
  assert.ok(exempt.length > 0);
  const result = partitionForkOnly(guard, [
    `${exempt[0]} ._x`,
    'src/other.js ._x',
  ]);
  assert.deepEqual(result.offenders, ['src/other.js ._x']);
  assert.deepEqual(result.unused, exempt.slice(1));
  assert.throws(() => forkOnlyExempt('nope'), /Unknown fork-only guard/);
});
