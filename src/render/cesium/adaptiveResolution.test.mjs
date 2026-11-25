import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FRAME_BUDGET_MS,
  createAdaptiveRatio,
  ratioLadder,
} from './adaptiveResolution.js';

function drive(display = 3, { warmupMs = 0 } = {}) {
  const changes = [];
  let t = 0;
  const ratio = createAdaptiveRatio({
    display: () => display,
    onChange: (r) => changes.push(r),
    warmupMs,
  });
  const run = (ms, frames) => {
    for (let i = 0; i < frames; i++) ratio.frame((t += ms));
  };
  const gap = (ms) => (t += ms);
  return { ratio, changes, run, gap };
}

test('the ladder starts at the display’s ratio and steps 3, 2, 1.5, 1 below it', () => {
  assert.deepEqual(ratioLadder(3), [3, 2, 1.5, 1]);
  assert.deepEqual(ratioLadder(2.625), [2.625, 2, 1.5, 1]);
  assert.deepEqual(ratioLadder(1), [1]);
  assert.deepEqual(ratioLadder(undefined), [1]);
});

test('starts at the display’s ratio and holds it while frames are on time', () => {
  const { ratio, changes, run } = drive();
  assert.equal(ratio.ratio(), 3);
  run(FRAME_BUDGET_MS, 600);
  assert.equal(ratio.ratio(), 3);
  assert.deepEqual(changes, []);
});

test('a 1 s median over budget steps down one ratio a window, to 1 at most', () => {
  const { ratio, changes, run } = drive();
  run(40, 30); // 1.2 s at 25 fps
  assert.equal(ratio.ratio(), 2);
  run(40, 30);
  run(40, 30);
  run(40, 30);
  assert.deepEqual(changes, [2, 1.5, 1]);
  assert.equal(ratio.ratio(), 1);
});

test('vsync jitter around the budget is not slow', () => {
  const { ratio, run } = drive();
  for (let i = 0; i < 200; i++) run(i % 2 ? 15.9 : 17.4, 1);
  assert.equal(ratio.ratio(), 3);
});

test('idle gaps (drawn on demand) are not frame times', () => {
  const { ratio, run, gap } = drive();
  for (let i = 0; i < 100; i++) {
    gap(500);
    run(FRAME_BUDGET_MS, 1);
  }
  assert.equal(ratio.ratio(), 3);
});

test('on-time frames step back up after the hold; a step that runs slow again waits longer', () => {
  const { ratio, changes, run } = drive();
  run(40, 30);
  assert.equal(ratio.ratio(), 2);
  run(FRAME_BUDGET_MS, 60 * 2); // 2 s: still holding
  assert.equal(ratio.ratio(), 2);
  run(FRAME_BUDGET_MS, 60 * 2); // past the 3 s hold
  assert.equal(ratio.ratio(), 3);
  run(40, 30); // 3 is slow again: back to 2, and 3 now waits 6 s
  assert.equal(ratio.ratio(), 2);
  run(FRAME_BUDGET_MS, 60 * 4);
  assert.equal(ratio.ratio(), 2, 'still backing off');
  run(FRAME_BUDGET_MS, 60 * 3);
  assert.equal(ratio.ratio(), 3);
  assert.deepEqual(changes, [2, 3, 2, 3]);
});

test('startup frames (the warm-up) decide nothing', () => {
  const { ratio, run } = drive(3, { warmupMs: 5000 });
  run(80, 60); // 4.8 s of startup hitches
  assert.equal(ratio.ratio(), 3);
  run(40, 40); // past the warm-up and still slow: now it steps
  assert.equal(ratio.ratio(), 2);
});

test('a parked view goes back up: an idle frame after the hold has room', () => {
  const { ratio, changes, run, gap } = drive();
  run(40, 30);
  run(40, 30);
  assert.equal(ratio.ratio(), 1.5, 'stepped down while busy');
  gap(1000);
  run(FRAME_BUDGET_MS, 1);
  assert.equal(ratio.ratio(), 1.5, 'inside the hold');
  for (let i = 0; i < 4; i++) {
    gap(3000);
    run(FRAME_BUDGET_MS, 1);
  }
  assert.equal(ratio.ratio(), 3);
  assert.deepEqual(changes, [2, 1.5, 2, 3]);
});

test('a window needs enough frames to decide', () => {
  const { ratio, run, gap } = drive();
  for (let i = 0; i < 10; i++) {
    run(40, 2);
    gap(200);
  }
  assert.equal(ratio.ratio(), 3);
});
