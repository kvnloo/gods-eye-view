import test from 'node:test';
import assert from 'node:assert/strict';
import { plotMassing } from './cityMassing.js';
import { snapPlot } from './cityPlot.js';
import { edgeDistance, inWinter, shadowBand } from './cityShadowFit.js';

// The massing journey's plot in San Francisco: a 32 m block on a 40 m cell.
const plot = snapPlot({ lat: 37.8006, lon: -122.4103 });
const { footprint } = plotMassing({ corners: plot.corners });
const METERS = 111_320;
const east = Math.cos((plot.center.lat * Math.PI) / 180) * METERS;
// Metres east and north of the plot centre.
const local = ([lon, lat]) => [
  (lon - plot.center.lon) * east,
  (lat - plot.center.lat) * METERS,
];
const at = (x, y) => [plot.center.lon + x / east, plot.center.lat + y / METERS];
const near = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-4,
    `${label}: ${actual} != ${expected}`,
  );

test('a noon shadow leaves the north face: the band is the block wide and as long as the reach', () => {
  // The sun due south: the shadow falls north.
  const band = shadowBand(footprint, { azimuthDeg: 180 }, 20).map(local);
  const want = [
    [16, 16],
    [-16, 16],
    [-16, 36],
    [16, 36],
  ];
  band.forEach(([x, y], i) => {
    near(x, want[i][0], `corner ${i} east`);
    near(y, want[i][1], `corner ${i} north`);
  });
});

test('a padded band is that much wider on each side and no longer', () => {
  const band = shadowBand(footprint, { azimuthDeg: 180 }, 20, 6).map(local);
  near(band[0][0], 22, 'near left');
  near(band[1][0], -22, 'near right');
  near(band[2][1], 36, 'far side');
});

test('a morning shadow leaves the west face', () => {
  // The sun due east: the shadow falls west.
  const band = shadowBand(footprint, { azimuthDeg: 90 }, 35).map(local);
  near(Math.max(...band.map(([x]) => x)), -16, 'starts at the west face');
  near(Math.min(...band.map(([x]) => x)), -51, 'ends 35 m beyond it');
  near(Math.max(...band.map(([, y]) => y)), 16, 'north side');
  near(Math.min(...band.map(([, y]) => y)), -16, 'south side');
});

test('the edge distance is metres beyond the face along the shadow, whatever the sideways offset', () => {
  const noon = { azimuthDeg: 180 };
  near(edgeDistance(footprint, noon, at(0, 36)), 20, 'straight across');
  near(edgeDistance(footprint, noon, at(12, 36)), 20, 'off to one side');
  near(edgeDistance(footprint, noon, at(0, 16)), 0, 'on the face');
  near(edgeDistance(footprint, noon, at(0, 0)), -16, 'behind the face');
  near(
    edgeDistance(footprint, { azimuthDeg: 90 }, at(-41, 5)),
    25,
    'a west shadow',
  );
});

test('winter is December to February north of the equator and June to August south of it', () => {
  const month = (m) => Date.UTC(2026, m - 1, 15);
  assert.deepEqual(
    [12, 1, 2, 3, 6, 11].map((m) => inWinter(37.8, month(m))),
    [true, true, true, false, false, false],
  );
  assert.deepEqual(
    [6, 7, 8, 9, 12, 5].map((m) => inWinter(-33.9, month(m))),
    [true, true, true, false, false, false],
  );
});
