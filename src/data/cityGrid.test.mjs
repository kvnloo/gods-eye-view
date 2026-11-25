import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityGrid, gridAt, isGridPlot, makeGrid } from './cityGrid.js';
import { CITY_GRIDS } from './cityGridSpecs.js';
import {
  plotBlock,
  plotFromId,
  plotPoint,
  plotValue,
  snapCityPlot,
  snapPlot,
} from './cityPlot.js';
import { CITY_LOCATIONS, cityPlaceName } from './cityLocations.js';
import { districtGrounds, plotGround } from './cityGround.js';
import { plotMassing } from './cityMassing.js';

const M = 111_320;
const DUNPHY = { lat: 37.86112109234639, lon: -122.48788513443384 };

test('sausalito grid: r03 Dunphy Park lattice, ids and geometry unchanged', () => {
  // bc5acb3 plot-sausalito-0-0 (rounds/r03/work/grid.json)
  const p = plotFromId('plot-sausalito-0-0');
  assert.ok(Math.abs(p.center.lat - 37.86107436386413) < 1e-12);
  assert.ok(Math.abs(p.center.lon - -122.4885858447663) < 1e-12);
  assert.equal(p.sizeMeters, 18);
  assert.equal(cityGrid('sausalito').plots().length, 16);
});

test('every grid plot round-trips through its id, plotValue and its own snap', () => {
  for (const key of Object.keys(CITY_GRIDS))
    for (const plot of cityGrid(key).plots()) {
      assert.equal(plotFromId(plot.id), plot);
      assert.deepEqual(plotValue(JSON.parse(JSON.stringify(plot))), plot);
      assert.equal(snapCityPlot(plot.center), plot);
      assert.ok(isGridPlot(plot));
      const mid = plotPoint(plot, 0.5, 0.5);
      assert.ok(Math.abs(mid.lat - plot.center.lat) < 1e-12);
    }
});

test('grid cells are square to their bearing and the given size', () => {
  for (const key of Object.keys(CITY_GRIDS)) {
    const { spec } = cityGrid(key);
    const [plot] = cityGrid(key).plots();
    const k = M * Math.cos((plot.center.lat * Math.PI) / 180);
    const [a, b, , d] = plot.corners.map(([lon, lat]) => [lon * k, lat * M]);
    const bearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    // the u edge runs 90 deg clockwise of the street bearing
    assert.ok(
      Math.abs((((bearing - spec.bearingDeg - 90) % 360) + 360) % 360) < 0.01 ||
        Math.abs(
          ((((bearing - spec.bearingDeg - 90) % 360) + 360) % 360) - 360,
        ) < 0.01,
    );
    assert.ok(
      Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - spec.size) < 0.01,
    );
    assert.ok(
      Math.abs(Math.hypot(d[0] - a[0], d[1] - a[1]) - spec.size) < 0.01,
    );
  }
});

test('inside a claim a click names a valid cell or nothing; outside, the global grid', () => {
  const grid = cityGrid('sausalito');
  assert.equal(gridAt(DUNPHY), grid);
  // a point in the bay 150 m east of the park: claimed, no plot
  const bay = {
    lat: DUNPHY.lat,
    lon: DUNPHY.lon + 150 / (M * Math.cos((DUNPHY.lat * Math.PI) / 180)),
  };
  assert.equal(snapCityPlot(bay), null);
  // 2 km away: the global grid answers, as snapPlot does
  const far = { lat: DUNPHY.lat + 2000 / M, lon: DUNPHY.lon };
  assert.equal(gridAt(far), null);
  assert.equal(snapCityPlot(far).id, snapPlot(far).id);
});

test('a district between grid plots holds only the valid cells of its rectangle', () => {
  const nb = CITY_LOCATIONS.northbeach;
  const block = plotBlock(
    plotFromId(nb.gridPlot),
    plotFromId(nb.gridOppositePlot),
  );
  assert.ok(block.length >= 16);
  assert.ok(block.every(isGridPlot));
  const pr = CITY_LOCATIONS.presidio;
  const holes = plotBlock(
    plotFromId(pr.gridPlot),
    plotFromId(pr.gridOppositePlot),
  );
  assert.ok(holes.length >= 16 && holes.every(isGridPlot));
  // never across grids or onto the global grid
  assert.equal(
    plotBlock(plotFromId(nb.gridPlot), plotFromId(pr.gridPlot)),
    null,
  );
  assert.equal(
    plotBlock(plotFromId(nb.gridPlot), snapPlot({ lat: 37.7, lon: -122.4 })),
    null,
  );
});

test('every QA location names its hero plots in its own grid', () => {
  for (const key of ['sausalito', 'northbeach', 'presidio']) {
    const loc = CITY_LOCATIONS[key];
    assert.ok(plotFromId(loc.gridPlot)?.id.startsWith(`plot-${key}-`), key);
    assert.ok(
      plotFromId(loc.gridOppositePlot)?.id.startsWith(`plot-${key}-`),
      key,
    );
  }
});

test('plotGround: a grid plot stands mid-range on the ground under its footprint', () => {
  const plot = plotFromId('plot-sausalito-1-1');
  // ground rising 5 cm per metre north, a 30 m roof at the plot centre ignored by design (none on grid plots)
  const sample = ([, lat]) => 2 + (lat - plot.center.lat) * M * 0.05;
  const ground = plotGround(plot, sample);
  const { footprint } = plotMassing({ corners: plot.corners });
  const under = footprint.map(sample);
  for (const h of under)
    assert.ok(
      Math.abs(ground.base - h) <=
        (Math.max(...under) - Math.min(...under)) / 2 + 1e-9,
    );
  assert.ok(ground.floor <= Math.min(...plot.corners.map(sample)) + 1e-9);
  assert.equal(
    plotGround(plot, () => undefined),
    null,
  );
});

test('plotGround: a global plot keeps the street-probe rule (its centre may be a roof)', () => {
  const plot = snapPlot({ lat: 37.7, lon: -122.4 });
  const roof = ([lon, lat]) =>
    lon === plot.center.lon && lat === plot.center.lat ? 30 : 5;
  assert.equal(plotGround(plot, roof).base, 5);
});

test('districtGrounds: grid plots skip the fitted plane; tiny districts do not throw', () => {
  const nb = CITY_LOCATIONS.northbeach;
  const plots = plotBlock(
    plotFromId(nb.gridPlot),
    plotFromId(nb.gridOppositePlot),
  );
  const sample = () => 24;
  const { grounds, fitted } = districtGrounds(plots, sample, { fit: true });
  assert.equal(fitted, null);
  assert.ok(grounds.every((g) => g.base === 24));
  const two = [
    snapPlot({ lat: 37.7, lon: -122.4 }),
    snapPlot({ lat: 37.7, lon: -122.3995 }),
  ];
  assert.equal(districtGrounds(two, sample, { fit: true }).grounds.length, 2);
});

test('cityPlaceName: the location the point is in, never the biggest city nearby', () => {
  assert.equal(cityPlaceName(DUNPHY), 'Sausalito');
  assert.equal(
    cityPlaceName(plotFromId('plot-sausalito-3-3').center),
    'Sausalito',
  );
  assert.equal(
    cityPlaceName(plotFromId(CITY_LOCATIONS.northbeach.gridPlot).center),
    'San Francisco',
  );
  assert.equal(
    cityPlaceName(plotFromId(CITY_LOCATIONS.presidio.gridPlot).center),
    'San Francisco',
  );
  // elsewhere: the city found at the point, else unknown
  assert.equal(cityPlaceName({ lat: 30, lon: -140 }), null);
  assert.equal(
    cityPlaceName({ lat: 40.7, lon: -74 }, { nearest: { name: 'New York' } }),
    'New York',
  );
  assert.equal(cityPlaceName({ lat: Number.NaN, lon: 0 }), null);
});

test('makeGrid: a spec with no valid cells has no plots', () => {
  const g = makeGrid({
    ...CITY_GRIDS.sausalito,
    key: 'none',
    cells: ['0000', '0000', '0000', '0000'],
  });
  assert.deepEqual(g.plots(), []);
  assert.equal(g.snap(DUNPHY), null);
});
