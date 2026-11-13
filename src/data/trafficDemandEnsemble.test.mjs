import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enumerateFixedMarginDemand2x2,
  FIXED_MARGIN_REFERENCE_VERSION,
  MAX_REFERENCE_TABLES,
} from './trafficDemandEnsemble.js';

const make = (rowTotals = [3, 2], columnTotals = [2, 3], sourceRevision = 'synthetic-r1') =>
  enumerateFixedMarginDemand2x2({ rowTotals, columnTotals, sourceRevision });

test('exhaustive small 2x2 demand enumeration preserves both margins', () => {
  const out = make();
  assert.equal(out.status, 'complete');
  assert.equal(out.feasibleTableCount, 3);
  assert.deepEqual(out.scenarios.map((s) => s.table), [
    [[0, 3], [2, 0]],
    [[1, 2], [1, 1]],
    [[2, 1], [0, 2]],
  ]);
  for (const item of out.scenarios) {
    assert.deepEqual(item.table.map((row) => row[0] + row[1]), [3, 2]);
    assert.deepEqual([0, 1].map((j) => item.table[0][j] + item.table[1][j]), [2, 3]);
    assert.equal(item.modelVersion, FIXED_MARGIN_REFERENCE_VERSION);
    assert.equal(item.determination, 'hypothetical');
  }
});

test('zero demand is a single valid table, not missing data', () => {
  const out = make([0, 0], [0, 0]);
  assert.equal(out.feasibleTableCount, 1);
  assert.deepEqual(out.scenarios[0].table, [[0, 0], [0, 0]]);
});

test('mismatched total demand is infeasible and never silently normalized', () => {
  const result = make([1, 2], [1, 1]);
  assert.equal(result.status, 'infeasible');
  assert.equal(result.reason, 'unequal-total-demand');
  assert.deepEqual(result.scenarios, []);
});

test('invalid/absent, negative, fractional, string and overflow demand fail closed', () => {
  for (const bad of [undefined, null, [], [1], [1, 2, 3], [-1, 2], [1.5, 2], ['1', 2], [Infinity, 2], [100001, 0], [2**53, 0]]) {
    assert.throws(() => enumerateFixedMarginDemand2x2({rowTotals:bad, columnTotals:[1,2],sourceRevision:'source-r1'}), /two bounded/);
  }
});

test('unknown or malformed provenance fails before creating scenarios', () => {
  for (const revision of [undefined, '', ' contains spaces ', 'x/'.repeat(40), 3]) {
    assert.throws(() => enumerateFixedMarginDemand2x2({rowTotals:[1,1], columnTotals:[1,1], sourceRevision: revision}), /sourceRevision/);
  }
});

test('enumeration limit is an explicit unsupported state, with no partial scenarios', () => {
  const tooBig = make([MAX_REFERENCE_TABLES, MAX_REFERENCE_TABLES], [MAX_REFERENCE_TABLES, MAX_REFERENCE_TABLES]);
  assert.equal(tooBig.status, 'unsupported');
  assert.equal(tooBig.feasibleTableCount, MAX_REFERENCE_TABLES + 1);
  assert.deepEqual(tooBig.scenarios, []);
});

test('boundary at exactly max tables remains supported', () => {
  const out = make([MAX_REFERENCE_TABLES - 1, MAX_REFERENCE_TABLES - 1], [MAX_REFERENCE_TABLES - 1, MAX_REFERENCE_TABLES - 1]);
  assert.equal(out.status, 'complete');
  assert.equal(out.feasibleTableCount, MAX_REFERENCE_TABLES);
});

test('deterministic, immutable and source arguments untouched', () => {
  const rowTotals = [3, 2], columnTotals = [2, 3];
  const one = make(rowTotals, columnTotals), two = make(rowTotals, columnTotals);
  assert.deepEqual(one, two);
  assert.equal(Object.isFrozen(one.scenarios[0].table[0]), true);
  assert.throws(() => { one.scenarios[0].table[0][0] = 12; }, TypeError);
  assert.deepEqual(rowTotals, [3, 2]);
  assert.deepEqual(columnTotals, [2, 3]);
});

test('different feasible matrices and source revisions have distinct demand identities', () => {
  const one = make();
  assert.equal(new Set(one.scenarios.map((item) => item.demandRevision)).size, one.feasibleTableCount);
  const another = make([3, 2], [2, 3], 'synthetic-r2');
  assert.notEqual(one.scenarios[0].demandRevision, another.scenarios[0].demandRevision);
});

test('balanced nonzero margins can have a unique feasible table', () => {
  const out = make([0, 3], [3, 0]);
  assert.deepEqual(out.scenarios[0].table, [[0,0],[3,0]]);
  assert.equal(out.scenarios.length, 1);
});

test('enumeration labels scenario family hypothetical; no model effects, field truth, or winners', () => {
  const out = make();
  const serialized = JSON.stringify(out);
  for(const banned of ['safeRoute', 'approved', 'observed', 'winner', 'trafficImprovement', 'dispatch']) {
    assert.equal(serialized.includes(`"${banned}"`), false);
  }
});

test('independent exhaustive verifier agrees on all small equal-sum margins', () => {
  let checked = 0;
  for (let r0 = 0; r0 <= 5; r0++) {
    for (let r1 = 0; r1 <= 5; r1++) {
      for (let c0 = 0; c0 <= 5; c0++) {
        for (let c1 = 0; c1 <= 5; c1++) {
          if (r0 + r1 !== c0 + c1) continue;
          const expected = [];
          for (let a = 0; a <= 5; a++) {
            for (let b = 0; b <= 5; b++) {
              for (let c = 0; c <= 5; c++) {
                for (let d = 0; d <= 5; d++) {
                  if (a+b === r0 && c+d === r1 && a+c === c0 && b+d === c1) {
                    expected.push([[a,b],[c,d]]);
                  }
                }
              }
            }
          }
          const actual = make([r0, r1], [c0, c1]);
          assert.equal(actual.status, 'complete');
          assert.deepEqual(actual.scenarios.map((s) => s.table), expected, `${r0}:${r1}:${c0}:${c1}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 100);
});

