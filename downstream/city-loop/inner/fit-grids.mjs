#!/usr/bin/env node
// FORK-ONLY (exp/city-loop-v5, fix1): fit a location-aware plot grid for a QA
// location and print its spec for src/data/cityGridSpecs.js.
//
//   node downstream/city-loop/inner/fit-grids.mjs northbeach presidio
//
// Bearing: the dominant street orientation within 150 m of the location's
// anchor plot (geo.mjs streetOrientation, the same estimator the gate checks
// yaw against). Lattice: 18 m cells (the r03 Dunphy Park size) over a square
// of +-HALF m around the anchor; the 1 m-step offset of the lattice is the one
// that leaves the most valid cells near the anchor. A cell is valid when the
// whole cell is on raster land with no shore crossing, it is clear of every
// OSM building by 1 m and of every drivable road centreline by 2 m, the local
// street bearing at its centre is within 3 deg of the grid's, and the USGS
// 3DEP relief under its footprint (corners + centre) is at most 0.8 m, so a
// block based mid-range is within 0.4 m of every sample (I1 allows 0.5 m).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { angDiff90, inside, polysOverlap, samplePoly, segCross } from './geo.mjs';
import { loadLocation } from './locations.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { CITY_LOCATIONS } = await import(join(root, 'src/data/cityLocations.js'));
const { plotFromId } = await import(join(root, 'src/data/cityPlot.js'));
const { makeGrid } = await import(join(root, 'src/data/cityGrid.js'));
const { plotMassing } = await import(join(root, 'src/data/cityMassing.js'));

const SIZE = 18;
const HALF = 160;
const CLAIM = 300;
const RELIEF = 0.8;
const ROAD_CLEAR = 2;
const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian', 'bridleway', 'corridor']);
const M = 111_320;
// district windows: 3-7 cells a side, at most 28 cells
const WINDOWS = [];
for (let h = 3; h <= 7; h++) for (let w = 3; w <= 7; w++) if (h * w <= 28 && h * w >= 16) WINDOWS.push([h, w]);

function grow(poly, d) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const L = Math.hypot(x - cx, y - cy) || 1;
    return [cx + ((x - cx) * (L + d * Math.SQRT2)) / L, cy + ((y - cy) * (L + d * Math.SQRT2)) / L];
  });
}

function fit(key) {
  const location = CITY_LOCATIONS[key];
  const loc = loadLocation(root, key, location);
  const { fixture, dem } = loc;
  const anchor = plotFromId(location.plot).center;
  const [ax, ay] = fixture.local(anchor.lon, anchor.lat);
  const [bearing] = fixture.streetOrientation(ax, ay);
  const roads = fixture.roads.filter((r) => !FOOT.has(r.t));
  const kx = M * Math.cos((anchor.lat * Math.PI) / 180);
  const t = (bearing * Math.PI) / 180;
  const [sin, cos] = [Math.sin(t), Math.cos(t)];
  const streetAt = new Map();
  const reasons = {};
  const why = (r) => ((reasons[r] = (reasons[r] ?? 0) + 1), false);
  function valid(grid, row, col) {
    const s = SIZE;
    const corners = [
      grid.toLonLat(col * s, row * s),
      grid.toLonLat((col + 1) * s, row * s),
      grid.toLonLat((col + 1) * s, (row + 1) * s),
      grid.toLonLat(col * s, (row + 1) * s),
    ];
    const poly = corners.map(([lon, lat]) => fixture.local(lon, lat));
    if (samplePoly(poly, 1).some((p) => fixture.waterAt(...p) !== 0)) return why('water');
    if (fixture.waterHits(poly, 0).shoreCrossings) return why('shore');
    const clear = grow(poly, 1);
    if (fixture.buildingsOverlapping(clear).length) return why('building');
    const wide = grow(poly, ROAD_CLEAR);
    const xs = wide.map((p) => p[0]);
    const ys = wide.map((p) => p[1]);
    for (const { p } of roads)
      for (let k = 0; k < p.length - 1; k++) {
        const [a, b] = [p[k], p[k + 1]];
        if (Math.max(a[0], b[0]) < Math.min(...xs) || Math.min(a[0], b[0]) > Math.max(...xs)) continue;
        if (Math.max(a[1], b[1]) < Math.min(...ys) || Math.min(a[1], b[1]) > Math.max(...ys)) continue;
        if (inside(a, wide) || wide.some((q, i) => segCross(q, wide[(i + 1) % 4], a, b))) return why('road');
      }
    const { footprint } = plotMassing({ corners });
    const c = [
      footprint.reduce((s2, p) => s2 + p[0], 0) / 4,
      footprint.reduce((s2, p) => s2 + p[1], 0) / 4,
    ];
    const h = [...footprint, c].map(dem);
    if (!h.every(Number.isFinite) || Math.max(...h) - Math.min(...h) > RELIEF) return why('relief');
    const [cx, cy] = fixture.local(...c);
    const q = `${Math.round(cx / 5)},${Math.round(cy / 5)}`;
    if (!streetAt.has(q)) streetAt.set(q, fixture.streetOrientation(cx, cy)[0]);
    const street = streetAt.get(q);
    return street !== null && angDiff90(street, bearing) <= 3 ? true : why('yaw');
  }
  // an origin such that the anchor sits HALF m in from the lattice corner, shifted by (ox, oy)
  const originFor = (ox, oy) => {
    const u = -HALF + ox;
    const v = -HALF + oy;
    return [anchor.lon + (u * cos + v * sin) / kx, anchor.lat + (-u * sin + v * cos) / M];
  };
  const n = Math.floor((2 * HALF) / SIZE);
  let best = null;
  for (let ox = 0; ox < SIZE; ox += 2)
    for (let oy = 0; oy < SIZE; oy += 2) {
      const spec = {
        key,
        origin: originFor(ox, oy),
        bearingDeg: bearing,
        size: SIZE,
        rows: n,
        cols: n,
        cells: Array.from({ length: n }, () => '1'.repeat(n)),
        claim: { lon: anchor.lon, lat: anchor.lat, meters: CLAIM },
      };
      const grid = makeGrid(spec);
      const mask = Array.from({ length: n }, (_, r) =>
        Array.from({ length: n }, (_, c) => (valid(grid, r, c) ? 1 : 0)),
      );
      // score: the most valid cells in any 5 x 5 window (a district), then the total
      let near = 0;
      for (let r = 0; r + 5 <= n; r++)
        for (let c = 0; c + 5 <= n; c++) {
          let k = 0;
          for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) k += mask[r + i][c + j];
          near = Math.max(near, k);
        }
      near = near * 1000 + mask.flat().reduce((a, b) => a + b, 0);
      if (!best || near > best.near) best = { near, spec };
    }
  // the full mask for the chosen offset
  const grid = makeGrid(best.spec);
  for (const k of Object.keys(reasons)) delete reasons[k];
  const cells = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (valid(grid, r, c) ? '1' : '0')).join(''),
  );
  // the hero district: the window (see WINDOWS) holding the most
  // valid cells (16+ for the capture), nearest the anchor among equals; its
  // first and last valid cells are the plot and the shift-click plot.
  let hero = null;
  for (const [h, w] of WINDOWS)
    for (let r = 0; r + h <= n; r++)
      for (let c = 0; c + w <= n; c++) {
        const inWin = [];
        for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (cells[r + i][c + j] === '1') inWin.push([r + i, c + j]);
        if (inWin.length < 16) continue;
        const [lon, lat] = grid.toLonLat((c + w / 2) * SIZE, (r + h / 2) * SIZE);
        const d = Math.hypot((lon - anchor.lon) * kx, (lat - anchor.lat) * M);
        const score = inWin.length / (h * w);
        if (!hero || score > hero.score + 1e-9 || (Math.abs(score - hero.score) < 1e-9 && d < hero.d))
          hero = { r, c, h, w, d, score, count: inWin.length };
      }
  if (hero) {
    // the rectangle's corner cells must be valid (they are what the player clicks)
    const corner = (r, c) => cells[r][c] === '1';
    const pairs = [
      [[hero.r, hero.c], [hero.r + hero.h - 1, hero.c + hero.w - 1]],
      [[hero.r, hero.c + hero.w - 1], [hero.r + hero.h - 1, hero.c]],
    ].filter(([a, b]) => corner(...a) && corner(...b));
    hero.pair = pairs[0] ?? null;
  }
  const count = cells.join('').split('1').length - 1;
  return {
    spec: { ...best.spec, bearingDeg: +bearing.toFixed(2), cells },
    hero: hero?.pair && {
      gridPlot: `plot-${key}-${hero.pair[0][0]}-${hero.pair[0][1]}`,
      gridOppositePlot: `plot-${key}-${hero.pair[1][0]}-${hero.pair[1][1]}`,
      plots: hero.count,
      window: `${hero.h}x${hero.w}`,
      metres: +hero.d.toFixed(1),
    },
    valid: count,
    rejected: reasons,
  };
}

for (const key of process.argv.slice(2)) {
  const t0 = Date.now();
  const out = fit(key);
  console.log(JSON.stringify({ ...out, seconds: (Date.now() - t0) / 1000 }));
}
