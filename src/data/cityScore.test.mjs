import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CITY_GOALS,
  planScore,
  replayMoves,
  resourceChips,
} from './cityScore.js';

// Accepted dream-loop rounds exported by city-dream/export_score_golden.py:
// the moves each round made, the state they replay to and planspec's score.
const golden = JSON.parse(
  readFileSync(new URL('./__fixtures__/score-golden.json', import.meta.url)),
);

const near = (actual, expected, label) =>
  assert.ok(
    expected === null ? actual === null : Math.abs(actual - expected) < 1e-9,
    `${label}: ${actual} != ${expected}`,
  );

test('the goal table is the one the dream loop scored with', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CITY_GOALS)), golden.goals);
  assert.equal(CITY_GOALS.status, 'assumed');
  assert.ok(Object.isFrozen(CITY_GOALS.weights.homes));
});

for (const c of golden.cases) {
  test(`${c.name}: replay, score and resource bar match the golden`, () => {
    const state = replayMoves(c.moves);
    assert.deepEqual(state, c.state);
    const score = planScore(state);
    near(score.value, c.score, 'score');
    assert.equal(score.tag, 'PROJECTED');
    assert.deepEqual(score.missing, c.missing);
    assert.deepEqual(
      resourceChips(state).map((chip) => chip.metric),
      c.chips,
    );
  });
}

test('the transit move raises the shadow plan, and losing homes lowers it', () => {
  const byName = Object.fromEntries(golden.cases.map((c) => [c.name, c]));
  const shadow = planScore(replayMoves(byName['r038-shadow'].moves)).value;
  const transit = planScore(
    replayMoves(byName['r038-r041-transit'].moves),
  ).value;
  assert.ok(transit > shadow, `${transit} <= ${shadow}`);
  const fewer = planScore(
    replayMoves([...byName['r038-shadow'].moves, { homes: [18, 10] }]),
  ).value;
  assert.ok(fewer < shadow, `${fewer} >= ${shadow}`);
});

test('a stated baseline wins; the assumed one only fills a gap', () => {
  assert.deepEqual(replayMoves([{ homes: [300, 600] }]).homes, {
    base: 300,
    value: 600,
    status: 'SPEC-BASE',
  });
  assert.deepEqual(replayMoves([{ homes: [null, 20] }]).homes, {
    base: 12,
    value: 20,
    status: 'ASSUMED-BASE',
  });
});

test('an unknown required metric shows no score', () => {
  const goals = { ...CITY_GOALS, required: ['homes', 'canopy_pct'] };
  const score = planScore(replayMoves([{ homes: [12, 18] }]), goals);
  assert.equal(score.value, null);
  assert.deepEqual(score.missing, ['canopy_pct']);
});

test('the score stays in [-1, 1] and never falls when a goal improves', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const scored = Object.entries(CITY_GOALS.weights).filter(([, g]) => g.w > 0);
  for (let i = 0; i < 200; i += 1) {
    const state = {};
    for (const [k, g] of Object.entries(CITY_GOALS.weights))
      state[k] = { base: g.base, value: rand() * 3 * (g.base || 1) };
    const before = planScore(state).value;
    assert.ok(before >= -1 && before <= 1, `${before}`);
    const [k] = scored[Math.floor(rand() * scored.length)];
    state[k] = { ...state[k], value: state[k].value * 1.5 };
    assert.ok(planScore(state).value >= before - 1e-9, k);
  }
});

test('resource chips are read-only figures with units, never actions', () => {
  const chips = resourceChips(
    replayMoves(golden.cases.find((c) => c.name === 'r038-r041-transit').moves),
  );
  const headway = chips.find((chip) => chip.metric === 'headway_min');
  assert.deepEqual(headway, {
    metric: 'headway_min',
    base: 15,
    value: 10,
    unit: 'min',
    status: 'SPEC-BASE',
  });
  assert.ok(chips.length <= 4);
  assert.ok(!chips.some((chip) => chip.metric === 'park_shade'));
});

test('bad moves are rejected instead of scored', () => {
  assert.throws(() => replayMoves([{ homes: [12] }]), TypeError);
  assert.throws(() => replayMoves({ homes: [12, 18] }), TypeError);
});
