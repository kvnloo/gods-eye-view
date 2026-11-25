// Write a synthetic stand-in 3D Tiles tileset (a flat checker plane, our own content) for testing the
// near-field hide-under-our-objects part and the dithered hand-off without Google tiles.
// usage: node tools/near-field/standin_tileset.mjs <outDir> <lat> <lon> <height> [sizeM]
import fs from 'node:fs';
import { writeGlb } from '../../src/data/nearField/glb.js';

const [outDir, lat, lon, h, size = 3200] = process.argv.slice(2);
const N = 80;
const S = Number(size);
const step = S / N;
const p = [];
const c = [];
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const x0 = -S / 2 + i * step, y0 = -S / 2 + j * step, x1 = x0 + step, y1 = y0 + step;
    const odd = (i + j) % 2;
    const col = odd ? [0.85, 0.2, 0.75, 1] : [0.95, 0.85, 0.1, 1]; // loud magenta/yellow: easy to spot
    for (const v of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      p.push(v[0], v[1], 0);
      c.push(...col);
    }
  }
const glb = writeGlb({ soup: { p, c } });
// ENU -> ECEF at (lat, lon, h)
const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
const la = (Number(lat) * Math.PI) / 180, lo = (Number(lon) * Math.PI) / 180;
const Nn = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
const X = (Nn + Number(h)) * Math.cos(la) * Math.cos(lo);
const Y = (Nn + Number(h)) * Math.cos(la) * Math.sin(lo);
const Z = (Nn * (1 - e2) + Number(h)) * Math.sin(la);
const east = [-Math.sin(lo), Math.cos(lo), 0];
const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
// 3D Tiles turns Y-up glb content into tile space as (x, y, z) -> (x, -z, y). Our soup is Z-up
// (x east, y north, z up), so in tile space it lands as (east, -up, north): map those columns back.
const transform = [...east, 0, ...up.map((v) => -v), 0, ...north, 0, X, Y, Z, 1];
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/plane.glb`, glb);
fs.writeFileSync(`${outDir}/tileset.json`, JSON.stringify({
  asset: { version: '1.1', generator: 'gev near-field stand-in (synthetic, no Google content)' },
  geometricError: 1000,
  root: {
    transform,
    boundingVolume: { box: [0, 0, 0, S / 2, 0, 0, 0, S / 2, 0, 0, 0, 50] },
    geometricError: 0,
    refine: 'REPLACE',
    content: { uri: 'plane.glb' },
  },
}, null, 1));
console.log('wrote', outDir);
