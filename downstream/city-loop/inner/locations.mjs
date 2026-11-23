// FORK-ONLY (exp/city-loop-v5, fix1 inner loop): the QA locations the inner
// loop checks, with their OSM fixture (in git, ODbL), optional raw Overpass XML
// (vector shore lines; scratch, not in git) and USGS 3DEP terrain (cache, not
// in git; dem.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Fixture } from './geo.mjs';
import { DEM_DIR, loadDem } from './dem.mjs';

export const LOCATION_KEYS = Object.freeze(['sausalito', 'northbeach', 'presidio']);

/** What the HUD must call each location (I2). */
export const EXPECTED_PLACE = Object.freeze({
  sausalito: 'Sausalito',
  northbeach: 'San Francisco',
  presidio: 'San Francisco',
});

const OSM_XML_DIR =
  process.env.GEV_OSM_XML_DIR ||
  join(homedir(), '.hermes', 'profiles', 'tek', 'cache', 'scratch', 'loc', 'osm');

/**
 * Load one location against an app checkout at `root`: its fixture as a
 * geo.mjs Fixture (water raster from the fixture, or for a schema@1 fixture
 * from `$GEV_DEM_DIR/<key>-water.osm.json`, an @2 rebuild of the same centre
 * made by prepare.sh), and the DEM sampler (null when not cached).
 */
export function loadLocation(root, key, location) {
  const json = JSON.parse(readFileSync(join(root, 'public', location.fixture), 'utf8'));
  let water = null;
  const rebuilt = join(DEM_DIR, `${key}-water.osm.json`);
  if (!json.water && existsSync(rebuilt)) {
    const extra = JSON.parse(readFileSync(rebuilt, 'utf8'));
    const same =
      Math.abs(extra.centre.lat - json.centre.lat) < 1e-9 &&
      Math.abs(extra.centre.lon - json.centre.lon) < 1e-9;
    if (same) water = extra.water;
  }
  const xml = join(OSM_XML_DIR, `${key}.osm`);
  const fixture = new Fixture(json, {
    water,
    osmXml: existsSync(xml) && process.env.GEV_NO_OSM_XML !== '1' ? xml : null,
  });
  return {
    key,
    json,
    fixture,
    waterRaster: json.water ?? water,
    waterSource: json.water ? 'fixture' : water ? rebuilt : null,
    shoreSource: fixture.waterLines.length ? xml : null,
    dem: loadDem(key),
  };
}
