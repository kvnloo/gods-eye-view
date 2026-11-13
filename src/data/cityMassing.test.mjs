import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MASSING_ASSUMPTIONS,
  MAX_STOREYS,
  edgeProbes,
  groundBase,
  massingFlag,
  plotMassing,
  polygonAreaSquareMeters,
  stepStoreys,
} from './cityMassing.js';
import { snapPlot } from './cityPlot.js';
import { plotCode, zoneLegend } from '../ui/cityPlayModel.js';

const near = (actual, expected, label, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label}: ${actual} != ${expected}`,
  );

// The grid cell at (row, col), found the way a click finds it: by its centre.
function cell(row, col) {
  const lat = ((row + 0.5) * 40) / 111_320;
  const width = 40 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return snapPlot({ lat, lon: -180 + (col + 0.5) * width });
}
// Plot N5199-6638 on Washington Square, San Francisco: the play journey's site.
const plot = cell(105199, 126638);

test('plot N5199-6638 has the 1,600 m² plot area the zoning legend shows', () => {
  assert.equal(plotCode(plot), 'N5199-6638');
  const legend = zoneLegend([{ plot, use: 'housing' }]);
  assert.equal(legend.areaSquareMeters, 1600);
  const massing = plotMassing({ corners: plot.corners });
  near(massing.plotAreaSquareMeters, legend.areaSquareMeters, 'plot area');
  near(polygonAreaSquareMeters(plot.corners), 1600, 'polygon area');
});

test('the assumed block: footprint inset by the setback, floor area, FAR, height', () => {
  assert.deepEqual(MASSING_ASSUMPTIONS, {
    storeys: 6,
    storeyHeightMeters: 3.2,
    setbackMeters: 4,
  });
  const m = plotMassing({ corners: plot.corners });
  assert.equal(m.estimated, true);
  assert.equal(m.storeys, 6);
  near(m.heightMeters, 19.2, 'height');
  near(m.footprintAreaSquareMeters, 32 * 32, 'footprint 32 m x 32 m');
  near(m.floorAreaSquareMeters, 6 * 1024, 'floor area');
  near(m.far, 3.84, 'FAR');
  // The footprint corners sit 4 m inside the plot edges.
  const [[west, south], , [east, north]] = plot.corners;
  const metersLon = 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
  const xs = m.footprint.map(([lon]) => (lon - west) * metersLon);
  const ys = m.footprint.map(([, lat]) => (lat - south) * 111_320);
  near(Math.min(...xs), 4, 'west setback', 1e-3);
  near((east - west) * metersLon - Math.max(...xs), 4, 'east setback', 1e-3);
  near(Math.min(...ys), 4, 'south setback', 1e-3);
  near((north - south) * 111_320 - Math.max(...ys), 4, 'north setback', 1e-3);
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.footprint));
});

test('two more storeys recompute every number consistently', () => {
  const storeys = stepStoreys(MASSING_ASSUMPTIONS.storeys, 2);
  assert.equal(storeys, 8);
  const m = plotMassing({ corners: plot.corners, storeys });
  near(m.heightMeters, 25.6, 'height');
  near(m.floorAreaSquareMeters, 8 * 1024, 'floor area');
  near(m.far, 5.12, 'FAR');
  near(m.far, m.floorAreaSquareMeters / m.plotAreaSquareMeters, 'FAR ratio');
  near(
    m.floorAreaSquareMeters,
    m.footprintAreaSquareMeters * m.storeys,
    'floor area = footprint x storeys',
  );
});

test('the area holds for any polygon, not just grid cells', () => {
  // A right triangle 30 m east by 40 m north: 600 m².
  const lat = 37.8;
  const east = 30 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const north = 40 / 111_320;
  const triangle = [
    [-122.41, lat],
    [-122.41 + east, lat],
    [-122.41, lat + north],
  ];
  // Built at its south edge's latitude; the metric scales at the mean latitude.
  near(polygonAreaSquareMeters(triangle), 600, 'triangle', 0.01);
  assert.equal(
    polygonAreaSquareMeters([...triangle].reverse()),
    polygonAreaSquareMeters(triangle),
    'winding does not change the area',
  );
});

test('a setback that leaves no footprint has no block: missing, never zero', () => {
  const m = plotMassing({ corners: plot.corners, setbackMeters: 20 });
  near(m.plotAreaSquareMeters, 1600, 'plot area still known');
  for (const key of [
    'footprint',
    'footprintAreaSquareMeters',
    'floorAreaSquareMeters',
    'far',
    'heightMeters',
  ])
    assert.equal(m[key], null, key);
});

test('invalid inputs are refused', () => {
  const corners = plot.corners;
  for (const bad of [
    { corners: corners.slice(0, 2) },
    {
      corners: [
        [0, 0],
        [1, 0],
        [0, Number.NaN],
      ],
    },
    { corners, storeys: 0 },
    { corners, storeys: 2.5 },
    { corners, storeys: MAX_STOREYS + 1 },
    { corners, storeyHeightMeters: 0 },
    { corners, storeyHeightMeters: Number.POSITIVE_INFINITY },
    { corners, setbackMeters: -1 },
  ])
    assert.throws(() => plotMassing(bad), TypeError, JSON.stringify(bad));
});

test('the storeys stepper stays within 1 and the maximum', () => {
  assert.equal(stepStoreys(1, -1), 1);
  assert.equal(stepStoreys(MAX_STOREYS, 1), MAX_STOREYS);
  assert.equal(stepStoreys(6, -2), 4);
});

test('massing is on only behind the ?massing=1 URL flag', () => {
  assert.equal(massingFlag('?massing=1'), true);
  assert.equal(massingFlag('?welcome=0&massing=1'), true);
  for (const off of ['', '?massing=0', '?massing=true', '?massing', null])
    assert.equal(massingFlag(off), false, String(off));
});

test('edge probes stand just outside the middle of every plot edge', () => {
  const probes = edgeProbes(plot.corners, 6);
  assert.equal(probes.length, 4);
  const metersLon = 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
  const offsets = probes.map(([lon, lat]) => [
    Math.round((lon - plot.center.lon) * metersLon) || 0,
    Math.round((lat - plot.center.lat) * 111_320) || 0,
  ]);
  // South, east, north and west of a 40 m plot: 20 m to the edge + 6 m.
  assert.deepEqual(offsets, [
    [0, -26],
    [26, 0],
    [0, 26],
    [-26, 0],
  ]);
});

test('the block stands on the ground at the plot centre, the plate reaches the lowest street', () => {
  // A slope (Washington Square, keyless terrain): centre wins, plate goes down to the low edge.
  assert.deepEqual(groundBase(-8.26, [-9.24, -7.5, -7.9, -8.6]), {
    base: -8.26,
    floor: -9.24,
  });
  // A 14.4 m church roof at the centre, street around it (the photoreal spike).
  assert.deepEqual(groundBase(14.4, [-8.9, -8.7, undefined, -8.95]), {
    base: -8.95,
    floor: -8.95,
  });
  // The centre already cut out of the photoreal mesh: the street.
  assert.deepEqual(groundBase(undefined, [-8.9, -8.95]), {
    base: -8.95,
    floor: -8.95,
  });
  assert.deepEqual(groundBase(3, []), { base: 3, floor: 3 });
  assert.equal(groundBase(undefined, [Number.NaN]), null);
});
