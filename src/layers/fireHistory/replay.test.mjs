import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIRE_REPLAY_ACTIVE_WINDOW_MS,
  FIRE_REPLAY_BASE_HOURS_PER_SECOND,
  advanceFireReplay,
  createFireReplayState,
  cycleFireReplaySpeed,
  fireDetectionPhase,
  fireReplayActive,
  fireReplayCounts,
  fireReplayEventRange,
  fireReplayLabel,
  formatFireReplayClock,
  pauseFireReplay,
  playFireReplay,
  resetFireReplay,
  seekFireReplay,
  setFireReplaySpeed,
} from './replay.js';

const EVENT = { startDate: '2018-11-08', endDate: '2018-11-09' };
const START = Date.UTC(2018, 10, 8);
const END = Date.UTC(2018, 10, 10);
const HOUR = 3_600_000;

test('inclusive event days become an exclusive replay range', () => {
  assert.deepEqual(fireReplayEventRange(EVENT), {
    startMs: START,
    endMs: END,
  });
  assert.deepEqual(
    fireReplayEventRange({ startMs: 10, endMs: 20 }),
    { startMs: 10, endMs: 20 },
  );
  const bad = fireReplayEventRange({ startDate: '2018-02-30', endDate: 'x' });
  assert.ok(Number.isNaN(bad.startMs));
  assert.ok(Number.isNaN(bad.endMs));
});

test('new clock parks at the event start and accepts only fixed speeds', () => {
  assert.deepEqual(createFireReplayState(EVENT, 2), {
    status: 'idle',
    cursorMs: START,
    speed: 2,
    startMs: START,
    endMs: END,
  });
  assert.equal(createFireReplayState(EVENT, 3).speed, 1);
  assert.equal(createFireReplayState({ startDate: 'x' }), null);
  assert.ok(Object.isFrozen(createFireReplayState(EVENT)));
});

test('advance uses event time only while playing and stops at the end', () => {
  const idle = createFireReplayState(EVENT);
  assert.equal(advanceFireReplay(idle, 1000), idle);
  const playing = playFireReplay(idle);
  assert.equal(
    advanceFireReplay(playing, 1000).cursorMs,
    START + FIRE_REPLAY_BASE_HOURS_PER_SECOND * HOUR,
  );
  assert.equal(
    advanceFireReplay(setFireReplaySpeed(playing, 4), 1000).cursorMs,
    START + 4 * FIRE_REPLAY_BASE_HOURS_PER_SECOND * HOUR,
  );
  const ended = advanceFireReplay(playing, 3_600_000);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.cursorMs, END);
  assert.equal(advanceFireReplay(playing, -50).cursorMs, START);
});

test('play/pause/reset and seek preserve deterministic transport semantics', () => {
  const idle = createFireReplayState(EVENT);
  const mid = {
    ...playFireReplay(idle),
    cursorMs: START + 5 * HOUR,
  };
  assert.equal(playFireReplay(pauseFireReplay(mid)).cursorMs, START + 5 * HOUR);
  assert.equal(
    playFireReplay({ ...mid, status: 'ended', cursorMs: END }).cursorMs,
    START,
  );
  assert.equal(pauseFireReplay(idle).status, 'idle');
  assert.equal(resetFireReplay(mid).cursorMs, START);

  const half = seekFireReplay(idle, 0.5);
  assert.equal(half.cursorMs, START + 24 * HOUR);
  assert.equal(half.status, 'paused');
  assert.equal(seekFireReplay(playFireReplay(idle), 2).status, 'playing');
  assert.equal(seekFireReplay(idle, -1).cursorMs, START);
  assert.equal(seekFireReplay(idle, Number.NaN).cursorMs, START);
});

test('speed selection is a fixed bounded vocabulary', () => {
  assert.equal(cycleFireReplaySpeed(0.5), 1);
  assert.equal(cycleFireReplaySpeed(4), 0.5);
  assert.equal(cycleFireReplaySpeed(99), 0.5);
  assert.equal(setFireReplaySpeed(createFireReplayState(EVENT), 7).speed, 1);
});

test('detection phase and counts preserve the 12 event-hour active window', () => {
  const fires = [
    { acqMs: START + 1 * HOUR },
    { acqMs: Number.NaN },
    { acqMs: START + 3 * HOUR },
    { acqMs: START + 20 * HOUR },
  ];
  const cursor = START + 14 * HOUR;

  assert.equal(fireDetectionPhase(fires[0], cursor), 'cooled');
  assert.equal(fireDetectionPhase(fires[1], cursor), 'pending');
  assert.equal(fireDetectionPhase(fires[2], cursor), 'active');
  assert.equal(fireDetectionPhase(fires[3], cursor), 'pending');
  assert.deepEqual(fireReplayCounts(fires, cursor), { shown: 2, active: 1 });
  assert.deepEqual(fireReplayCounts(fires, START - 1), {
    shown: 0,
    active: 0,
  });
  assert.equal(FIRE_REPLAY_ACTIVE_WINDOW_MS, 12 * HOUR);
});

test('presentation labels remain derived from replay state, not UI ownership', () => {
  const idle = createFireReplayState(EVENT);
  assert.equal(fireReplayActive(idle), false);
  assert.equal(fireReplayLabel(idle), '');

  const playing = advanceFireReplay(playFireReplay(idle), 1000);
  assert.equal(
    fireReplayLabel(playing),
    'REPLAY · 2018-11-08 06:00Z · 1×',
  );
  assert.equal(
    fireReplayLabel(pauseFireReplay(playing)),
    'PAUSED · 2018-11-08 06:00Z · 1×',
  );
  assert.equal(
    fireReplayLabel({ ...playing, status: 'ended', cursorMs: END }),
    'REPLAY END · 2018-11-10 00:00Z · 1×',
  );
  assert.equal(formatFireReplayClock(Number.NaN), '');
});
