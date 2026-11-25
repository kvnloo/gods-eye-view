// FORK-ONLY (exp/city-loop-v5, fix1 inner loop): public-domain terrain for the
// headless placement harness.
//
// Source: USGS 3D Elevation Program (3DEP), The National Map 3DEPElevation
// ImageServer (best available resolution, 1 m lidar DEM in the Bay Area),
// public domain (https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map).
// Heights are NAVD88 metres. They are fetched by this script and cached
// OUTSIDE git (default ~/.cache/gev-dem, override GEV_DEM_DIR); nothing here
// is stored in the repo. The live app does not use this: it still samples
// Cesium World Terrain at run time, and the ion terms forbid storing those
// heights (loop-v3/licence/REPORT.md). The harness injects this sampler into
// the app's own ground function (plotGround in src/data/cityMassing.js).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const M = 111_320;
const SERVICE =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

export const DEM_DIR = process.env.GEV_DEM_DIR || join(homedir(), '.cache', 'gev-dem');

/** The bbox [west, south, east, north] `half` metres around a centre. */
export function demBox({ lat, lon }, half = 900) {
  const kx = M * Math.cos((lat * Math.PI) / 180);
  return [lon - half / kx, lat - half / M, lon + half / kx, lat + half / M];
}

/** A minimal reader for the ImageServer's uncompressed little-endian float32 TIFF. */
export function readTiffF32(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint16(0, true) !== 0x4949) throw new Error('DEM: not a little-endian TIFF');
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, true);
    const type = view.getUint16(at + 2, true);
    const n = view.getUint32(at + 4, true);
    const size = type === 3 ? 2 : 4;
    const read = (k) =>
      type === 3 ? view.getUint16(k, true) : view.getUint32(k, true);
    const values = [];
    const base = n * size > 4 ? view.getUint32(at + 8, true) : at + 8;
    for (let k = 0; k < n && k < 1e6; k++) values.push(read(base + k * size));
    tags[tag] = values;
  }
  const width = tags[256][0];
  const height = tags[257][0];
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('DEM: compressed TIFF');
  if ((tags[258]?.[0] ?? 0) !== 32 || (tags[339]?.[0] ?? 0) !== 3)
    throw new Error('DEM: expected float32 samples');
  const out = new Float32Array(width * height).fill(NaN);
  if (tags[273]) {
    // strips, row-major
    let k = 0;
    tags[273].forEach((offset, s) => {
      const bytes = tags[279][s];
      for (let b = 0; b < bytes && k < out.length; b += 4)
        out[k++] = view.getFloat32(offset + b, true);
    });
  } else if (tags[324]) {
    // tiles of tw x th, row-major across the image, padded at the edges
    const [tw, th] = [tags[322][0], tags[323][0]];
    const across = Math.ceil(width / tw);
    tags[324].forEach((offset, t) => {
      const [x0, y0] = [(t % across) * tw, Math.floor(t / across) * th];
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const [px, py] = [x0 + x, y0 + y];
          if (px < width && py < height)
            out[py * width + px] = view.getFloat32(offset + (y * tw + x) * 4, true);
        }
    });
  } else throw new Error('DEM: TIFF has neither strips nor tiles');
  return { width, height, data: out };
}

/** Download (once) and cache the DEM around `centre`; returns the cache paths. */
export async function fetchDem(key, centre, { half = 900, metres = 2 } = {}) {
  mkdirSync(DEM_DIR, { recursive: true });
  const tif = join(DEM_DIR, `${key}.tif`);
  const meta = join(DEM_DIR, `${key}.json`);
  if (existsSync(tif) && existsSync(meta)) return { tif, meta, cached: true };
  const box = demBox(centre, half);
  const size = Math.round((2 * half) / metres);
  const url =
    `${SERVICE}?bbox=${box.join(',')}&bboxSR=4326&imageSR=4326&size=${size},${size}` +
    '&format=tiff&pixelType=F32&noDataInterpretation=esriNoDataMatchAny' +
    '&interpolation=RSP_BilinearInterpolation&compression=None&f=image';
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`DEM: ${reply.status} from USGS 3DEP`);
  const buffer = Buffer.from(await reply.arrayBuffer());
  readTiffF32(buffer); // fail before caching anything unreadable
  writeFileSync(tif, buffer);
  writeFileSync(
    meta,
    JSON.stringify(
      {
        key,
        source: 'USGS 3DEP 3DEPElevation ImageServer (public domain), NAVD88 m',
        url,
        bbox: box,
        size,
        fetched: new Date().toISOString(),
      },
      null,
      1,
    ),
  );
  return { tif, meta, cached: false };
}

/** A bilinear sampler ([lon, lat]) -> metres from the cached DEM, or null when absent. */
export function loadDem(key) {
  const tif = join(DEM_DIR, `${key}.tif`);
  const metaPath = join(DEM_DIR, `${key}.json`);
  if (!existsSync(tif) || !existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const { width, height, data } = readTiffF32(readFileSync(tif));
  const [west, south, east, north] = meta.bbox;
  const sample = ([lon, lat]) => {
    // pixel centres: column i covers west + (i + 0.5) * dx
    const fx = ((lon - west) / (east - west)) * width - 0.5;
    const fy = ((north - lat) / (north - south)) * height - 0.5;
    if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return undefined;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const at = (a, b) => data[Math.min(b, height - 1) * width + Math.min(a, width - 1)];
    const v =
      at(i, j) * (1 - tx) * (1 - ty) +
      at(i + 1, j) * tx * (1 - ty) +
      at(i, j + 1) * (1 - tx) * ty +
      at(i + 1, j + 1) * tx * ty;
    return Number.isFinite(v) && v > -1000 ? v : undefined;
  };
  sample.meta = meta;
  return sample;
}
