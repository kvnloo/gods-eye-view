import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLOT_METERS,
  snapPlot,
  neighborPlots,
  plotValue,
  plotPoint,
} from './cityPlot.js';

const SF = { lat: 37.8007, lon: -122.4103 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const meters = (degLat) => degLat * 111_320;

test('snapPlot returns one deterministic ~40 m grid cell around the picked point', () => {
  const plot = snapPlot(SF);
  assert.equal(PLOT_METERS, 40);
  assert.match(plot.id, /^plot-[ns]\d+-\d+$/);
  assert.equal(plot.sizeMeters, 40);
  const [[west, south], [east], [, north]] = [
    plot.corners[0],
    plot.corners[1],
    plot.corners[2],
  ];
  assert.ok(west <= SF.lon && SF.lon < east, 'cell contains the longitude');
  assert.ok(south <= SF.lat && SF.lat < north, 'cell contains the latitude');
  assert.ok(near(meters(north - south), 40, 1e-6), 'north-south edge is 40 m');
  const ew =
    (east - west) * 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
  assert.ok(near(ew, 40, 1e-6), 'east-west edge is 40 m at the cell centre');
  assert.ok(near(plot.center.lat, (south + north) / 2));
  assert.ok(near(plot.center.lon, (west + east) / 2));
  assert.equal(plot.areaSquareMeters, 1600);
  assert.equal(plot.corners.length, 4);
  assert.ok(Object.isFrozen(plot) && Object.isFrozen(plot.corners[0]));
});

test('every point inside one cell snaps to the identical plot', () => {
  const plot = snapPlot(SF);
  const [[west, south], , [east, north]] = plot.corners;
  for (const [fx, fy] of [
    [0.01, 0.01],
    [0.5, 0.5],
    [0.99, 0.02],
    [0.03, 0.97],
  ]) {
    const other = snapPlot({
      lat: south + (north - south) * fy,
      lon: west + (east - west) * fx,
    });
    assert.deepEqual(other, plot);
  }
  const outside = snapPlot({ lat: north + 1e-6, lon: SF.lon });
  assert.notEqual(outside.id, plot.id);
});

test('southern hemisphere and western cells keep valid lowercase ids', () => {
  const sydney = snapPlot({ lat: -33.8568, lon: 151.2153 });
  assert.match(sydney.id, /^plot-s\d+-\d+$/);
  const quito = snapPlot({ lat: -0.0001, lon: -78.5 });
  assert.match(quito.id, /^plot-s1-\d+$/);
  assert.match(snapPlot({ lat: 0, lon: 0 }).id, /^plot-n0-\d+$/);
});

test('snapPlot fails closed off-globe, near the poles and on the antimeridian edge', () => {
  for (const bad of [
    null,
    {},
    { lat: Number.NaN, lon: 0 },
    { lat: 0, lon: Infinity },
    { lat: 91, lon: 0 },
    { lat: 86, lon: 0 },
    { lat: 0, lon: 181 },
    { lat: 0, lon: 179.99999 },
  ])
    assert.equal(snapPlot(bad), null, JSON.stringify(bad));
});

test('neighborPlots returns the surrounding ring of cells for the faint game grid', () => {
  const plot = snapPlot(SF);
  const ring = neighborPlots(plot, 1);
  assert.equal(ring.length, 8);
  assert.equal(new Set(ring.map((p) => p.id)).size, 8);
  assert.ok(!ring.some((p) => p.id === plot.id));
  const wider = neighborPlots(plot, 2);
  assert.equal(wider.length, 24);
  assert.deepEqual(neighborPlots(plot, 0), []);
});

test('plotValue accepts only an exact snapped plot and rejects edited geometry', () => {
  const plot = snapPlot(SF);
  assert.deepEqual(plotValue(JSON.parse(JSON.stringify(plot))), plot);
  const moved = JSON.parse(JSON.stringify(plot));
  moved.corners[0][0] += 0.001;
  assert.throws(() => plotValue(moved), /plot/);
  assert.throws(() => plotValue({ ...plot, extra: 1 }), /keys/);
  assert.throws(() => plotValue({ ...plot, id: 'plot-n1-1' }), /plot/);
  assert.throws(() => plotValue(null), /object/);
});

test('plotPoint maps fractional positions inside the footprint for callouts', () => {
  const plot = snapPlot(SF);
  const [[west, south], , [east, north]] = plot.corners;
  const c = plotPoint(plot, 0.5, 0.5);
  assert.ok(near(c.lat, plot.center.lat) && near(c.lon, plot.center.lon));
  const p = plotPoint(plot, 0, 1);
  assert.ok(near(p.lon, west) && near(p.lat, north));
  const q = plotPoint(plot, 1, 0);
  assert.ok(near(q.lon, east) && near(q.lat, south));
});
