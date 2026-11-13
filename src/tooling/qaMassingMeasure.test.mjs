import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidMeasurement,
  distinctFrames,
  groundReference,
  siteForPlot,
} from '../../scripts/qa-massing-measure.mjs';
import { plotFromId } from '../data/cityPlot.js';

const invalid = (pattern) => (error) =>
  error instanceof InvalidMeasurement && pattern.test(error.message);

test('two shadow captures from one frame, or byte-identical, are INVALID rather than a shadow result', () => {
  const on = { frame: 40, png: Buffer.from([1, 2, 3]) };
  assert.throws(
    () => distinctFrames(on, { frame: 40, png: Buffer.from([9]) }, 'shadow'),
    invalid(/shadow: no new frame was rendered/),
  );
  assert.throws(
    () => distinctFrames(on, { frame: 41, png: Buffer.from([1, 2, 3]) }, 's'),
    invalid(/s: the two captures are byte-identical/),
  );
  assert.doesNotThrow(() =>
    distinctFrames(on, { frame: 41, png: Buffer.from([1, 2, 4]) }, 'shadow'),
  );
  // A stray frame let the shadow map come back on before the "off" capture.
  const drawnOn = { ...on, shadows: true };
  assert.throws(
    () =>
      distinctFrames(
        drawnOn,
        { frame: 43, png: Buffer.from([7]), shadows: true },
        'shadow',
      ),
    invalid(/shadow: the frames were drawn with the shadow map on then on/),
  );
  assert.doesNotThrow(() =>
    distinctFrames(
      drawnOn,
      { frame: 43, png: Buffer.from([7]), shadows: false },
      'x',
    ),
  );
  assert.equal(new InvalidMeasurement('x').name, 'InvalidMeasurement');
});

test('QA_PLOT frames its plot: the camera 600 m south of the centre, looking north at 45 degrees', () => {
  const id = 'plot-n105201-126637';
  const { center } = plotFromId(id);
  const site = siteForPlot(id);
  assert.equal(site.lon, center.lon);
  assert.ok(Math.abs((center.lat - site.lat) * 111_320 - 600) < 1e-6);
  assert.deepEqual(
    { alt: site.alt, heading: site.heading, pitch: site.pitch },
    { alt: 600, heading: 0, pitch: -45 },
  );
  assert.throws(() => siteForPlot('lot-7'), /QA_PLOT must be a plot id/);
});

test('the reference ground is the plot centre, or the lowest street sample when a structure stands on the plot', () => {
  // Washington Square lawn (Esri globe): the centre is ground.
  assert.deepEqual(groundReference(-8.26, [-8.1, -8.5, -8.0, -8.4]), {
    ground: -8.26,
    from: 'centre',
  });
  // Saints Peter and Paul on Google tiles (E-spike: roof 14.39 m, street -8.90 m).
  assert.deepEqual(groundReference(14.39, [-8.9, -8.95, -8.7, -9.1]), {
    ground: -9.1,
    from: 'street',
  });
  // 2.5 m above the street mean is still ground (a slope); more is a structure.
  assert.equal(groundReference(2.5, [0, 0, 0, 0]).from, 'centre');
  assert.equal(groundReference(2.51, [0, 0, 0, 0]).from, 'street');
  // Nothing at the centre: the street; nothing at all: no reference.
  assert.deepEqual(groundReference(undefined, [NaN, -3, -2]), {
    ground: -3,
    from: 'street',
  });
  assert.deepEqual(groundReference(-1, []), { ground: -1, from: 'centre' });
  assert.equal(groundReference(undefined, [undefined]), null);
});
