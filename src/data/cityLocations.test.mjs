import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { CITY_LOCATIONS, HERO_CITY_LOCATION, cityLocation } from './cityLocations.js';
import { plotFromId } from './cityPlot.js';
import { DIORAMA_DEFAULTS, buildDiorama, levelWater, waterField } from './cityDioramaMesh.js';

const fixture = (url) => JSON.parse(readFileSync(new URL(`../../public${url}`, import.meta.url), 'utf8'));

test('cityLoc picks a location, defaults to North Beach, refuses unknown keys', () => {
  assert.equal(cityLocation('').key, 'northbeach');
  assert.equal(cityLocation('?cityLoc=presidio').plot, 'plot-n105200-126533');
  assert.equal(cityLocation('?cityLoc=nowhere'), null);
});

test('city=hero picks Sausalito (Dunphy Park) unless cityLoc says otherwise', () => {
  assert.equal(HERO_CITY_LOCATION, 'sausalito');
  assert.equal(cityLocation('?city=hero').key, 'sausalito');
  assert.equal(cityLocation('?city=hero').plot, 'plot-n105367-126364');
  assert.equal(cityLocation('?city=hero&cityLoc=presidio').key, 'presidio');
  assert.equal(cityLocation('?city=v3').key, 'northbeach');
});

test('licence: no stored terrain heights anywhere, OSM notices next to the fixtures', () => {
  const dir = new URL('../../public/city-diorama/', import.meta.url);
  const files = readdirSync(dir);
  assert.deepEqual(files.filter((f) => /ground|height|terrain/i.test(f)), [], 'Cesium World Terrain heights must not be stored (ion ToS 2.2.2)');
  for (const [key, loc] of Object.entries(CITY_LOCATIONS)) assert.ok(!('ground' in loc), `${key}: terrain is sampled live`);
  const readme = readFileSync(new URL('README.md', dir), 'utf8');
  for (const s of ['OpenStreetMap contributors', 'https://opendatacommons.org/licenses/odbl/1-0/', 'https://www.openstreetmap.org/copyright', 'MIT'])
    assert.ok(readme.includes(s), `README names ${s}`);
  const notices = readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.ok(notices.includes('public/city-diorama') && notices.includes('ODbL'), 'THIRD_PARTY_NOTICES lists the OSM fixtures');
});

test('every location fixture is ODbL-tagged and centred on its plot', () => {
  for (const [key, loc] of Object.entries(CITY_LOCATIONS)) {
    const fx = fixture(loc.fixture);
    assert.equal(fx.licence, 'ODbL-1.0', key);
    const { center } = plotFromId(loc.plot);
    assert.ok(Math.abs(fx.centre.lat - center.lat) < 1e-9 && Math.abs(fx.centre.lon - center.lon) < 1e-9, key);
    assert.ok(!('heights' in fx), `${key}: no terrain heights inside an OSM fixture`);
  }
});

test('water raster: decoded, each body levelled flat, no trees in water', () => {
  const fx = fixture(CITY_LOCATIONS.sausalito.fixture);
  const w = waterField(fx);
  assert.ok(w && w.ids.some((v) => v > 0));
  assert.equal(waterField(fx), w, 'decoded once');
  assert.equal(waterField({}), null);
  // a toy ground: a west-east slope that dips under the bay
  const n = 114;
  const spacing = 16;
  const half = 900;
  const heights = Array.from({ length: n * n }, (_, k) => 40 - (k % n) * 0.6);
  const ground = { n, spacing, half, heights, centre: 0, offset: 0 };
  const levels = levelWater(ground, w);
  assert.ok(Object.keys(levels).length > 0);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const id = w.at(-half + i * spacing, -half + j * spacing);
      if (id) assert.ok(Math.abs(heights[j * n + i] - levels[id]) < 0.01);
    }
  const built = buildDiorama(fx, ground, DIORAMA_DEFAULTS);
  assert.ok(built.houses.length > 200);
  assert.ok(built.trees.length > 500);
  for (const t of built.trees) assert.equal(w.at(t.x, t.y), 0, 'no tree stands in water');
});
