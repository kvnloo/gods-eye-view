// Factory CI gates for nightly and staging. One driver for GitHub Actions
// (.github/workflows/factory-ci-sha.yml) and for disposable Boat VMs, so both
// report the same commit-status contexts: gev-ci/<gate> and gev-ci/full.
//
//   node scripts/factory-ci.mjs <gate>... [--out DIR] [--base-ref SHA]
//   node scripts/factory-ci.mjs unit --write-baseline        refresh the baseline
//   node scripts/factory-ci.mjs statuses DIR                 contexts as TSV
//
// Every gate writes DIR/<gate>.json ({gate, state, description, ...}) and
// DIR/<gate>.log. state is success, failure (the code under test failed) or
// error (the gate itself could not run). Docs: docs/factory-ci.md.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocationTestArgs,
  buildUnitTestPlan,
  discoverUnitTestFiles,
  isCalibratedAllocationRuntime,
  UNIT_TEST_NODE_FLAGS,
} from './run-unit-tests.mjs';
import { discoverPerfTestFiles, perfTestArgs } from './run-perf-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = path.join(ROOT, 'scripts/factory-ci/test-events.mjs');
export const BASELINE_PATH = 'ci/factory/unit-baseline.json';
export const PERF_BASELINE_PATH = 'ci/factory/perf-baseline.json';
export const PERF_SMOKE = Object.freeze({ runs: 5, failQuorum: 3 });
export const GATES = Object.freeze([
  'lint', 'typecheck', 'translations', 'unit', 'build', 'bundle-budget', 'globe-smoke', 'perf-smoke',
]);
const MINUTE = 60_000;

// ---------------------------------------------------------------- processes

/** Run one command, teeing output to the gate log. Never throws. */
function run(command, args, { log, env = {}, timeoutMs = 30 * MINUTE } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    log.write(`\n$ ${[command, ...args].join(' ')}\n`);
    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, signal: null, error: String(error), ms: 0 });
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        log.write(chunk);
        process.stdout.write(chunk);
      });
    }
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, error: String(error), ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, error: timedOut ? `timed out after ${timeoutMs} ms` : null, ms: Date.now() - started });
    });
  });
}

/** A gate made of commands: failure on a non-zero exit, error if one could not run. */
async function commandGate(log, steps) {
  for (const [label, command, args, options] of steps) {
    const result = await run(command, args, { log, ...options });
    if (result.error || result.signal) return { state: 'error', description: `${label}: ${result.error ?? result.signal}` };
    if (result.code !== 0) return { state: 'failure', description: `${label} exited ${result.code}` };
  }
  return { state: 'success', description: steps.map(([label]) => label).join(', ') + ' passed' };
}

const npm = (script, ...rest) => ['npm', ['run', '--silent', script, ...(rest.length ? ['--', ...rest] : [])]];

// ---------------------------------------------------------------- test events

/**
 * Turn reporter lines into one entry per test, named by its file and every
 * enclosing suite. node:test reports children before their parent, so each
 * finished node adopts the pending nodes one level deeper in the same file.
 */
export function collectTests(lines) {
  const pending = new Map(); // file -> Map(nesting -> nodes)
  const roots = [];
  const summaries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.event === 'summary') {
      summaries.push(event);
      continue;
    }
    if (event.event !== 'pass' && event.event !== 'fail') continue;
    const file = event.file ? path.relative(ROOT, event.file).split(path.sep).join('/') : '(no file)';
    const levels = pending.get(file) ?? new Map();
    pending.set(file, levels);
    // A file that fails outside any test is reported under its own path.
    const wholeFile = event.file && path.resolve(ROOT, event.name) === event.file;
    const node = {
      file,
      name: wholeFile ? '(file)' : event.name,
      wholeFile: Boolean(wholeFile),
      kind: event.kind,
      // A todo test may fail without failing the run, so todo/skip win.
      status: event.todo ? 'todo' : event.skip ? 'skip'
        : event.event === 'pass' ? 'pass'
        : event.failureType === 'cancelledByParent' ? 'cancelled' : 'fail',
      failureType: event.failureType,
      durationMs: event.durationMs,
      children: levels.get(event.nesting + 1) ?? [],
    };
    levels.delete(event.nesting + 1);
    if (event.nesting === 0) roots.push(node);
    else levels.set(event.nesting, [...(levels.get(event.nesting) ?? []), node]);
  }
  const orphaned = [...pending.values()].some((levels) => levels.size > 0);
  const tests = new Map();
  const visit = (node, prefix) => {
    const name = [...prefix, node.name];
    // A suite that failed only because a child failed adds nothing; a failing
    // hook or a file that failed to load is a failure of its own.
    const counts = node.kind === 'test' || (node.status === 'fail' && node.failureType !== 'subtestsFailed');
    if (counts) {
      let id = `${node.file} > ${name.join(' > ')}`;
      for (let n = 2; tests.has(id); n++) id = `${node.file} > ${name.join(' > ')} #${n}`;
      tests.set(id, { status: node.status, kind: node.kind, file: node.file, wholeFile: node.wholeFile, durationMs: node.durationMs });
    }
    for (const child of node.children) visit(child, name);
  };
  for (const root of roots) visit(root, []);
  return { tests, summary: summaries.find((s) => s.file === null) ?? null, orphaned };
}

/** Run node --test with the event reporter. Returns the process outcome and parsed tests. */
async function runNodeTests(args, { log, eventsFile, env, timeoutMs }) {
  const reporterArgs = [
    '--test-reporter=dot', '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER}`, `--test-reporter-destination=${eventsFile}`,
  ];
  const result = await run(process.execPath, [...UNIT_TEST_NODE_FLAGS, ...reporterArgs, ...args], { log, env, timeoutMs });
  const lines = existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n') : [];
  return { ...result, ...collectTests(lines) };
}

/** Why a test process's own report cannot be trusted, or null. */
export function processProblem({ code, signal, error, tests, summary, orphaned }) {
  if (error || signal) return error ?? `killed by ${signal}`;
  if (!summary) return 'the test runner produced no summary';
  if (orphaned) return 'some test results had no enclosing test';
  const counted = [...tests.values()].filter((t) => t.kind === 'test').length;
  if (counted !== summary.counts.tests) return `reported ${summary.counts.tests} tests but emitted ${counted}`;
  const failed = [...tests.values()].some((t) => t.status === 'fail' || t.status === 'cancelled');
  if (code !== 0 && !failed) return `exited ${code} with no failing test`;
  if (code === 0 && failed) return 'exited 0 despite failing tests';
  return null;
}

// ---------------------------------------------------------------- unit gate

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

export function environment() {
  return {
    node: process.versions.node,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpus: os.availableParallelism(),
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    runner: process.env.GEV_CI_RUNNER ?? (process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'),
  };
}

/** Compare a run with the recorded baseline. Pure; the gate decision lives here. */
export function compareWithBaseline(baseline, tests, perFile, discovered) {
  const failures = new Set(baseline.failures);
  const skipped = new Set(baseline.skipped);
  const out = { newFailures: [], stillFailing: [], fixed: [], newlySkipped: [], emptiedFiles: [], missingFiles: [] };
  for (const [id, { status }] of tests) {
    if (status === 'fail' || status === 'cancelled') (failures.has(id) ? out.stillFailing : out.newFailures).push(id);
    else if ((status === 'skip' || status === 'todo') && !skipped.has(id)) out.newlySkipped.push(id);
  }
  for (const id of failures) if (tests.get(id)?.status === 'pass') out.fixed.push(id);
  const present = new Set(discovered);
  for (const [file, count] of Object.entries(baseline.testsPerFile)) {
    if (!present.has(file)) out.missingFiles.push(file);
    else if (count > 0 && !perFile[file]) out.emptiedFiles.push(file);
  }
  const blocking = out.newFailures.length + out.newlySkipped.length + out.emptiedFiles.length;
  return { ...out, blocking };
}

/** Real tests per file. A file with no tests is reported as one passing whole-file entry; it counts as zero. */
export function perFileCounts(tests) {
  const counts = {};
  for (const { file, kind, wholeFile } of tests.values()) if (kind === 'test' && !wholeFile) counts[file] = (counts[file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function unitGate({ log, out, writeBaseline }) {
  // Policy tests diff against origin/main; a shallow checkout is a setup error, not a test failure.
  try {
    git('rev-parse', '--verify', 'origin/main^{commit}');
    git('merge-base', 'HEAD', 'origin/main');
  } catch {
    return { state: 'error', description: 'origin/main history is missing; fetch full history first' };
  }
  if (!isCalibratedAllocationRuntime()) {
    return { state: 'error', description: `Node ${process.versions.node} has no calibrated allocation budgets` };
  }
  const discovered = discoverUnitTestFiles(ROOT);
  const plan = buildUnitTestPlan(discovered);
  // Every process runs even when an earlier one failed, so no suite is silently skipped.
  const processes = [
    ['parallel', ['--test', ...plan.parallel]],
    ...plan.serializedAllocations.map((file) => [file, allocationTestArgs(file)]),
  ];
  const tests = new Map();
  const runs = [];
  for (const [index, [label, args]] of processes.entries()) {
    const eventsFile = path.join(out, `unit-events-${index}.ndjson`);
    const result = await runNodeTests(args, { log, eventsFile, env: { GEV_REQUIRE_ALLOCATION_GATE: '1' }, timeoutMs: 40 * MINUTE });
    const problem = processProblem(result);
    runs.push({ label, exitCode: result.code, signal: result.signal, ms: result.ms, counts: result.summary?.counts ?? null, problem });
    for (const [id, test] of result.tests) tests.set(tests.has(id) ? `${id} (${label})` : id, test);
  }
  const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const { kind, status } of tests.values()) {
    if (kind !== 'test') continue;
    counts.tests++;
    counts[{ pass: 'passed', fail: 'failed', cancelled: 'cancelled', skip: 'skipped', todo: 'todo' }[status]]++;
  }
  const failing = [...tests].filter(([, t]) => t.status === 'fail' || t.status === 'cancelled').map(([id]) => id).sort();
  const skipped = [...tests].filter(([, t]) => t.status === 'skip' || t.status === 'todo').map(([id]) => id).sort();
  const perFile = perFileCounts(tests);
  const problems = runs.filter((r) => r.problem).map((r) => `${r.label}: ${r.problem}`);
  const record = { runs, counts, failing, skipped };
  if (problems.length) return { state: 'error', description: problems.join('; '), ...record };

  if (writeBaseline) {
    const baseline = {
      schema: 1,
      commit: git('rev-parse', 'HEAD'),
      tree: git('rev-parse', 'HEAD^{tree}'),
      dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
      packageLockSha256: createHash('sha256').update(readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex'),
      // The driver may be newer than the commit (a baseline is recorded before the gate lands).
      harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(REPORTER)).digest('hex'),
      environment: environment(),
      generatedAt: new Date().toISOString(),
      command: 'node scripts/factory-ci.mjs unit --write-baseline',
      counts,
      failures: failing,
      skipped,
      testsPerFile: perFile,
    };
    mkdirSync(path.dirname(path.join(ROOT, BASELINE_PATH)), { recursive: true });
    writeFileSync(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`);
    return { state: 'success', description: `baseline written: ${counts.tests} tests, ${failing.length} failing, ${skipped.length} skipped`, ...record };
  }

  const baselineFile = path.join(ROOT, BASELINE_PATH);
  if (!existsSync(baselineFile)) return { state: 'error', description: `${BASELINE_PATH} is missing`, ...record };
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const env = environment();
  if (baseline.environment.node !== env.node || baseline.environment.platform !== env.platform) {
    return { state: 'error', description: `baseline was recorded on Node ${baseline.environment.node}/${baseline.environment.platform}, this is ${env.node}/${env.platform}`, ...record };
  }
  const diff = compareWithBaseline(baseline, tests, perFile, discovered);
  const description = diff.blocking
    ? `${diff.newFailures.length} new failures, ${diff.newlySkipped.length} newly skipped, ${diff.emptiedFiles.length} emptied files vs ${baseline.commit.slice(0, 12)}`
    : `${counts.tests} tests; ${diff.stillFailing.length} baseline failures, 0 new; ${diff.fixed.length} fixed`;
  return { state: diff.blocking ? 'failure' : 'success', description, baselineCommit: baseline.commit, ...diff, ...record };
}

// ---------------------------------------------------------------- perf smoke

/**
 * The repository's wall-clock benchmarks (*.perf.test.mjs), run PERF_SMOKE.runs
 * times serially. A benchmark fails the gate when it misses its own budget in
 * failQuorum runs or more; every run's numbers are kept. Budgets themselves are
 * never changed here.
 */
async function perfSmokeGate({ log, out }) {
  const files = discoverPerfTestFiles(ROOT);
  if (!files.length) return { state: 'error', description: 'no *.perf.test.mjs benchmarks found' };
  const misses = new Map();
  const runs = [];
  for (let i = 0; i < PERF_SMOKE.runs; i++) {
    const eventsFile = path.join(out, `perf-events-${i}.ndjson`);
    const args = perfTestArgs(files).slice(UNIT_TEST_NODE_FLAGS.length);
    const result = await runNodeTests(args, { log, eventsFile, env: { GEV_PERF_BUDGETS: '1' }, timeoutMs: 10 * MINUTE });
    const problem = processProblem(result);
    if (problem) return { state: 'error', description: `run ${i + 1}: ${problem}`, runs };
    const tests = Object.fromEntries([...result.tests].map(([id, t]) => [id, { status: t.status, durationMs: t.durationMs }]));
    for (const [id, t] of Object.entries(tests)) {
      if (t.status === 'skip' || t.status === 'todo') return { state: 'failure', description: `${id} was skipped`, runs };
      if (t.status !== 'pass') misses.set(id, (misses.get(id) ?? 0) + 1);
    }
    runs.push({ run: i + 1, ms: result.ms, tests });
  }
  // Benchmarks already over budget at the baseline commit on this runner class
  // are listed in PERF_BASELINE_PATH with their measured miss rate. They are
  // reported every run but cannot block; any other benchmark over quorum blocks.
  const baselineFile = path.join(ROOT, PERF_BASELINE_PATH);
  if (!existsSync(baselineFile)) return { state: 'error', description: `${PERF_BASELINE_PATH} is missing`, runs };
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const env = environment();
  if (baseline.environment.node !== env.node || baseline.environment.platform !== env.platform) {
    return { state: 'error', description: `perf baseline is for Node ${baseline.environment.node}/${baseline.environment.platform}`, runs };
  }
  const short = (id) => id.split(' > ').pop().slice(0, 32);
  const overQuorum = [...misses].filter(([, n]) => n >= PERF_SMOKE.failQuorum).map(([id]) => id);
  const blocking = overQuorum.filter((id) => !(id in baseline.overBudget));
  const known = Object.keys(baseline.overBudget).map((id) => `${short(id)} ${misses.get(id) ?? 0}/${PERF_SMOKE.runs}`);
  return {
    state: blocking.length ? 'failure' : 'success',
    description: blocking.length
      ? `over budget in >=${PERF_SMOKE.failQuorum}/${PERF_SMOKE.runs} runs: ${blocking.map(short).join(', ')}`
      : `${Object.keys(runs[0].tests).length} benchmarks, none newly over budget${known.length ? `; known over at ${baseline.commit.slice(0, 8)}: ${known.join(', ')}` : ''}`,
    policy: PERF_SMOKE,
    baselineCommit: baseline.commit,
    blocking,
    misses: Object.fromEntries(misses),
    runs,
  };
}

// ---------------------------------------------------------------- gates

async function runGate(gate, { out, baseRef, writeBaseline }) {
  const log = createWriteStream(path.join(out, `${gate}.log`));
  const started = Date.now();
  let result;
  try {
    switch (gate) {
      case 'lint': {
        const steps = [
          ['format', ...npm('format:check')],
          ['boundaries', ...npm('check:boundaries')],
          ['library', ...npm('library:check', ...(baseRef ? ['--base-ref', baseRef] : []))],
        ];
        if (baseRef) steps.push(['layer tokens', ...npm('layer-token:check', '--base-ref', baseRef)]);
        result = await commandGate(log, steps);
        break;
      }
      case 'typecheck': {
        // Declarations only: the app is JavaScript bundled by Vite, so Bundler resolution.
        const files = git('ls-files', 'src/render/**/*.d.ts').split('\n').filter(Boolean);
        if (!files.length) { result = { state: 'error', description: 'no declaration files found' }; break; }
        result = await commandGate(log, [['tsc (renderer declarations)', path.join(ROOT, 'node_modules/.bin/tsc'),
          ['--noEmit', '--strict', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'es2022', ...files]]]);
        break;
      }
      case 'translations':
        result = await commandGate(log, [['i18n', ...npm('i18n')]]);
        break;
      case 'build':
        result = await commandGate(log, [['vite build', ...npm('build')]]);
        break;
      case 'bundle-budget':
        result = existsSync(path.join(ROOT, 'dist/index.html'))
          ? await commandGate(log, [['budget', process.execPath, ['scripts/factory-bundle-budget.mjs', 'dist', path.join(out, 'bundle.json')]]])
          : { state: 'error', description: 'dist/ is missing; run the build gate first' };
        break;
      case 'globe-smoke':
        result = existsSync(path.join(ROOT, 'dist/index.html'))
          ? await commandGate(log, [['globe', process.execPath, ['scripts/factory-globe-smoke.mjs', path.join(out, 'globe.png'), 'dist', path.join(out, 'globe.json')], { timeoutMs: 5 * MINUTE }]])
          : { state: 'error', description: 'dist/ is missing; run the build gate first' };
        break;
      case 'unit':
        result = await unitGate({ log, out, writeBaseline });
        break;
      case 'perf-smoke':
        result = await perfSmokeGate({ log, out });
        break;
      default:
        result = { state: 'error', description: `unknown gate ${gate}` };
    }
  } catch (error) {
    result = { state: 'error', description: String(error?.message ?? error).slice(0, 200), stack: String(error?.stack ?? '') };
  }
  await new Promise((resolve) => log.end(resolve));
  const record = { gate, ...result, description: result.description.slice(0, 140), durationMs: Date.now() - started };
  writeFileSync(path.join(out, `${gate}.json`), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[factory-ci] ${gate}: ${record.state} (${(record.durationMs / 1000).toFixed(1)}s) ${record.description}`);
  return record;
}

/** Commit statuses for a results directory: one per gate and gev-ci/full. Missing results are errors. */
export function statusesFor(dir) {
  const rows = GATES.map((gate) => {
    const file = path.join(dir, `${gate}.json`);
    if (!existsSync(file)) return { context: `gev-ci/${gate}`, state: 'error', description: 'no result recorded' };
    const { state, description } = JSON.parse(readFileSync(file, 'utf8'));
    return { context: `gev-ci/${gate}`, state: ['success', 'failure', 'error'].includes(state) ? state : 'error', description };
  });
  const red = rows.filter((r) => r.state !== 'success').map((r) => r.context.slice(7));
  rows.push({ context: 'gev-ci/full', state: red.length ? 'failure' : 'success', description: red.length ? `not green: ${red.join(', ')}` : `all ${GATES.length} gates passed` });
  return rows;
}

async function main(argv) {
  if (argv[0] === 'statuses') {
    for (const row of statusesFor(argv[1] ?? 'ci-results')) console.log([row.context, row.state, row.description.replace(/\s+/g, ' ')].join('\t'));
    return 0;
  }
  const option = (name) => {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    const [value] = argv.splice(i, 2).slice(1);
    return value;
  };
  const writeBaseline = argv.includes('--write-baseline');
  if (writeBaseline) argv.splice(argv.indexOf('--write-baseline'), 1);
  const out = path.resolve(option('--out') ?? 'ci-results');
  const baseRef = option('--base-ref');
  const gates = argv.length ? argv : GATES;
  if (writeBaseline && gates.join() !== 'unit') throw new Error('--write-baseline only applies to the unit gate');
  mkdirSync(out, { recursive: true });
  let ok = true;
  for (const gate of gates) ok = (await runGate(gate, { out, baseRef, writeBaseline })).state === 'success' && ok;
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
