import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectTests,
  compareWithBaseline,
  GATES,
  perFileCounts,
  processProblem,
  statusesFor,
} from '../scripts/factory-ci.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = path.join(ROOT, 'scripts/factory-ci/test-events.mjs');

// A nested runner inherits NODE_TEST_CONTEXT and would report to this one instead.
const { NODE_TEST_CONTEXT, ...withoutTestContext } = process.env;

/** Run real node:test files through the factory reporter, as the unit gate does. */
function runFixture(files) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'factory-ci-fixture-')));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    const events = path.join(dir, 'events.ndjson');
    const result = spawnSync(process.execPath, [
      '--test', `--test-reporter=${REPORTER}`, `--test-reporter-destination=${events}`,
      ...Object.keys(files).map((name) => path.join(dir, name)),
    ], { cwd: ROOT, encoding: 'utf8', env: withoutTestContext });
    const prefix = path.relative(ROOT, dir).split(path.sep).join('/');
    const run = { code: result.status, signal: result.signal, error: null, ...collectTests(readFileSync(events, 'utf8').split('\n')) };
    return { run, prefix };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SUITE = `
import { describe, it, test } from 'node:test';
describe('outer', () => {
  it('same', () => {});
  it('breaks', () => { throw new Error('no'); });
  describe('inner', () => { it('same', () => {}); it.skip('later', () => {}); });
});
test('parent', async (t) => { await t.test('child', () => {}); });
it.todo('todo that fails', () => { throw new Error('todo'); });
`;

test('every test is named by its file and enclosing suites, with its own status', () => {
  const { run, prefix } = runFixture({ 'a.test.mjs': SUITE, 'b.test.mjs': "throw new Error('does not load');\n" });
  const status = Object.fromEntries([...run.tests].map(([id, t]) => [id.slice(prefix.length + 1), t.status]));
  assert.deepEqual(status, {
    'a.test.mjs > outer > same': 'pass',
    'a.test.mjs > outer > breaks': 'fail',
    'a.test.mjs > outer > inner > same': 'pass',
    'a.test.mjs > outer > inner > later': 'skip',
    'a.test.mjs > parent': 'pass',
    'a.test.mjs > parent > child': 'pass',
    'a.test.mjs > todo that fails': 'todo',
    'b.test.mjs > (file)': 'fail',
  });
  assert.equal(processProblem(run), null, 'a failing run that reported every test is trustworthy');
});

test('a run whose report cannot be trusted is an error, not a test failure', () => {
  const { run } = runFixture({ 'a.test.mjs': "import { it } from 'node:test';\nit('ok', () => {});\n" });
  assert.equal(processProblem(run), null);
  assert.match(processProblem({ ...run, signal: 'SIGKILL' }), /SIGKILL/);
  assert.match(processProblem({ ...run, summary: null }), /no summary/);
  assert.match(processProblem({ ...run, code: 1 }), /no failing test/);
  assert.match(processProblem({ ...run, tests: new Map() }), /reported 1 tests but emitted 0/);
});

test('a file that no longer defines tests counts as zero tests', () => {
  const { run, prefix } = runFixture({ 'a.test.mjs': "import { it } from 'node:test';\nit('ok', () => {});\n", 'empty.test.mjs': 'export {};\n' });
  assert.equal(processProblem(run), null);
  const counts = Object.fromEntries(Object.entries(perFileCounts(run.tests)).map(([file, n]) => [file.slice(prefix.length + 1), n]));
  assert.deepEqual(counts, { 'a.test.mjs': 1 });
});

test('only new failures, newly skipped tests and emptied files block', () => {
  const baseline = {
    failures: ['a > known'],
    skipped: ['a > parked'],
    testsPerFile: { a: 4, gone: 1, emptied: 2 },
  };
  const tests = new Map([
    ['a > known', { status: 'fail' }],
    ['a > fresh', { status: 'fail' }],
    ['a > parked', { status: 'skip' }],
    ['a > hidden', { status: 'skip' }],
    ['a > fine', { status: 'pass' }],
  ]);
  const diff = compareWithBaseline(baseline, tests, { a: 5 }, ['a', 'emptied']);
  assert.deepEqual(diff.newFailures, ['a > fresh']);
  assert.deepEqual(diff.stillFailing, ['a > known']);
  assert.deepEqual(diff.newlySkipped, ['a > hidden']);
  assert.deepEqual(diff.emptiedFiles, ['emptied']);
  assert.deepEqual(diff.missingFiles, ['gone']);
  assert.equal(diff.blocking, 3);

  const clean = compareWithBaseline(baseline, new Map([['a > known', { status: 'pass' }]]), { a: 1, emptied: 2 }, ['a', 'emptied']);
  assert.deepEqual(clean.fixed, ['a > known']);
  assert.equal(clean.blocking, 0);
});

test('gev-ci/full is green only when every gate recorded success', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'factory-ci-statuses-'));
  try {
    for (const gate of GATES) writeFileSync(path.join(dir, `${gate}.json`), JSON.stringify({ state: 'success', description: 'ok' }));
    assert.deepEqual(statusesFor(dir).at(-1), { context: 'gev-ci/full', state: 'success', description: `all ${GATES.length} gates passed` });
    rmSync(path.join(dir, 'globe-smoke.json'));
    writeFileSync(path.join(dir, 'unit.json'), JSON.stringify({ state: 'weird', description: 'x' }));
    const rows = Object.fromEntries(statusesFor(dir).map((r) => [r.context, r.state]));
    assert.equal(rows['gev-ci/globe-smoke'], 'error');
    assert.equal(rows['gev-ci/unit'], 'error');
    assert.equal(rows['gev-ci/full'], 'failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
