#!/usr/bin/env node
// FORK-ONLY (fix1 inner loop): fetch USGS 3DEP terrain (public domain) for the
// QA locations into $GEV_DEM_DIR (default ~/.cache/gev-dem), outside git.
// Usage: node downstream/city-loop/inner/fetch-dem.mjs [key ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDem } from './dem.mjs';
import { LOCATION_KEYS } from './locations.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { CITY_LOCATIONS } = await import(join(root, 'src/data/cityLocations.js'));
for (const key of process.argv.slice(2).length ? process.argv.slice(2) : LOCATION_KEYS) {
  const fixture = JSON.parse(readFileSync(join(root, 'public', CITY_LOCATIONS[key].fixture), 'utf8'));
  const got = await fetchDem(key, fixture.centre);
  console.log(key, got.cached ? 'cached' : 'fetched', got.tif);
}
