// FORK-ONLY (fix1): the Node invariant checks agree with critics/sanity_gate.py
// on the same placements (v4-style global plots that fail, grid plots that pass).
//   node --test downstream/city-loop/inner/parity.check.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { placementFailures } from './invariants.mjs';
import { loadLocation } from './locations.mjs';
import { centroid } from './geo.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { CITY_LOCATIONS } = await import(join(root, 'src/data/cityLocations.js'));
const { plotFromId, snapPlot } = await import(join(root, 'src/data/cityPlot.js'));
const { cityGrid } = await import(join(root, 'src/data/cityGrid.js'));
const { plotMassing } = await import(join(root, 'src/data/cityMassing.js'));
const { plotGround } = await import(join(root, 'src/data/cityGround.js'));

for (const key of ['sausalito', 'presidio']) {
  test(`node invariants == sanity_gate.py at ${key}`, (t) => {
    const loc = loadLocation(root, key, CITY_LOCATIONS[key]);
    if (!loc.dem) return t.skip('no cached USGS DEM (run fetch-dem.mjs)');
    const anchor = plotFromId(CITY_LOCATIONS[key].plot);
    const plots = [
      ...cityGrid(key).plots().slice(0, 6),
      anchor,
      ...[[1, 0], [0, 1], [2, 2], [-1, 3]].map(([r, c]) =>
        snapPlot({ lat: anchor.center.lat + (r * 40) / 111_320, lon: anchor.center.lon + (c * 50) / 111_320 / 0.79 }),
      ),
    ];
    const placements = plots.map((plot) => {
      const footprint = plotMassing({ corners: plot.corners }).footprint;
      const base = plotGround(plot, loc.dem)?.base ?? null;
      const c = loc.fixture.lonlat(...centroid(footprint.map(([lon, lat]) => loc.fixture.local(lon, lat))));
      return { kind: 'massing', id: plot.id, footprint, base, terrain: [...footprint, c].map((p) => loc.dem(p) ?? null), plot };
    });
    const frame = {
      beat: 'district',
      hud: 'x',
      expectedPlace: 'x',
      placements: placements.map(({ plot, ...p }) => p),
    };
    const args = [join(root, 'downstream/city-loop/critics/sanity_gate.py'), join(root, 'public', CITY_LOCATIONS[key].fixture)];
    if (loc.shoreSource) args.push(loc.shoreSource);
    const py = spawnSync('python3', args, { input: JSON.stringify(frame), encoding: 'utf8' });
    const gate = JSON.parse(py.stdout);
    for (const p of placements) {
      const want = gate.failures.filter((f) => f.id === p.id).map((f) => f.check).sort();
      const got = placementFailures(p, loc.fixture, loc.dem)
        .map((f) => f.check)
        .filter((c) => c !== 'outside-plot')
        .sort();
      assert.deepEqual(got, want, p.id);
    }
    // and the sample really spans both verdicts
    assert.ok(gate.failures.length > 0);
    assert.ok(placements.some((p) => !gate.failures.some((f) => f.id === p.id)));
  });
}
