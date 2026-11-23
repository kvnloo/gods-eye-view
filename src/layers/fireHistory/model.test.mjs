import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptFireHistoryRecords,
  buildFireHistoryTimeline,
  fireHistoryDetectionPixelSize,
  fireHistoryEventCenter,
  fireHistoryEventProgress,
  fireHistoryEventRange,
  fireHistoryProgressRgb,
  selectFireHistoryEvent,
} from './model.js';

const EVENT = {
  id: 'camp-fire-2018',
  name: 'Camp Fire',
  startDate: '2018-11-08',
  endDate: '2018-11-09',
  bbox: [-121.75, 39.65, -121.3, 39.95],
};

test('event range treats public endDate as an inclusive UTC day', () => {
  assert.deepEqual(fireHistoryEventRange(EVENT), {
    startMs: Date.UTC(2018, 10, 8),
    endMs: Date.UTC(2018, 10, 10),
  });
  assert.deepEqual(fireHistoryEventRange({ startMs: 10, endMs: 20 }), {
    startMs: 10,
    endMs: 20,
  });
});

test('event progress spans the event and clamps outside it', () => {
  assert.equal(fireHistoryEventProgress(Date.UTC(2018, 10, 8), EVENT), 0);
  assert.equal(fireHistoryEventProgress(Date.UTC(2018, 10, 9), EVENT), 0.5);
  assert.equal(fireHistoryEventProgress(Date.UTC(2018, 10, 10), EVENT), 1);
  assert.equal(fireHistoryEventProgress(Date.UTC(2018, 10, 20), EVENT), 1);
  assert.equal(fireHistoryEventProgress(Number.NaN, EVENT), 0);
});

test('progress ramp and pixel sizing stay renderer-neutral and bounded', () => {
  assert.deepEqual(fireHistoryProgressRgb(0), [255, 228, 92]);
  assert.deepEqual(fireHistoryProgressRgb(0.35), [255, 138, 31]);
  assert.deepEqual(fireHistoryProgressRgb(1), [107, 20, 20]);
  assert.deepEqual(fireHistoryProgressRgb(99), [107, 20, 20]);
  assert.equal(fireHistoryDetectionPixelSize(null, 'VIIRS'), 4);
  assert.equal(fireHistoryDetectionPixelSize(0, 'MODIS'), 6);
  assert.ok(
    fireHistoryDetectionPixelSize(150, 'VIIRS') >
      fireHistoryDetectionPixelSize(5, 'VIIRS'),
  );
  assert.ok(fireHistoryDetectionPixelSize(1e9, 'VIIRS') <= 9);
});

test('raw FIRMS rows are normalized, timeless rows dropped, sorted, and stamped with progress', () => {
  const fires = adaptFireHistoryRecords(
    [
      {
        lat: 39.8,
        lon: -121.5,
        frp: 12,
        confidence: 'n',
        acqDate: '2018-11-09',
        acqTime: '1200',
        instrument: 'VIIRS',
      },
      {
        lat: 39.81,
        lon: -121.51,
        frp: 3,
        confidence: 'h',
        acqDate: '2018-11-08',
        acqTime: '45',
        instrument: 'MODIS',
      },
      {
        lat: 39.82,
        lon: -121.52,
        frp: 3,
        acqDate: 'bad',
        acqTime: '0',
      },
      {
        lat: 'x',
        lon: -121.52,
        frp: 3,
        acqDate: '2018-11-08',
        acqTime: '0',
      },
    ],
    EVENT,
  );

  assert.equal(fires.length, 2);
  assert.deepEqual(
    fires.map((fire) => fire.index),
    [0, 1],
  );
  assert.equal(fires[0].sensor, 'MODIS');
  assert.equal(fires[0].acqMs, Date.UTC(2018, 10, 8, 0, 45));
  assert.equal(fires[1].progress, 0.75);
  assert.ok(fires.every(Object.isFrozen));
});

test('daily timeline includes quiet UTC days and ignores out-of-range/malformed detections', () => {
  const timeline = buildFireHistoryTimeline(
    [
      { acqMs: Date.UTC(2018, 10, 8, 3), frp: 10 },
      { acqMs: Date.UTC(2018, 10, 8, 14), frp: 40 },
      { acqMs: Number.NaN, frp: 999 },
      { acqMs: Date.UTC(2018, 10, 9, 1), frp: null },
      { acqMs: Date.UTC(2018, 10, 12, 1), frp: 99 },
    ],
    EVENT,
  );

  assert.deepEqual(timeline, [
    { date: '2018-11-08', count: 2, maxFrp: 40 },
    { date: '2018-11-09', count: 1, maxFrp: 0 },
  ]);
  assert.ok(timeline.every(Object.isFrozen));
  assert.deepEqual(buildFireHistoryTimeline([], { startDate: 'x' }), []);
});

test('event selection and bbox center remain pure deterministic helpers', () => {
  const events = [{ id: 'a' }, { id: 'b' }];
  assert.equal(selectFireHistoryEvent(events, 'b'), events[1]);
  assert.equal(selectFireHistoryEvent(events, 'missing'), events[0]);
  assert.equal(selectFireHistoryEvent([], 'a'), null);
  assert.deepEqual(fireHistoryEventCenter([-122, 39, -120, 41]), {
    lon: -121,
    lat: 40,
  });
  assert.equal(fireHistoryEventCenter(null), null);
});
