// Count buildings/water/landcover features in the z14 OpenFreeMap tiles around a point (3x3).
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const [lat, lon] = [Number(process.argv[2]), Number(process.argv[3])];
const z = Number(process.argv[4] ?? 14), n = 2 ** z;
const x0 = Math.floor(((lon + 180) / 360) * n);
const r = (lat * Math.PI) / 180;
const y0 = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
for (let dy = -1; dy <= 1; dy++) {
  const row = [];
  for (let dx = -1; dx <= 1; dx++) {
    const url = tj.tiles[0].replace('{z}', z).replace('{x}', x0 + dx).replace('{y}', y0 + dy);
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const vt = new VectorTile(new PbfReader(buf));
    const b = vt.layers.building;
    let hasH = 0;
    if (b) for (let i = 0; i < b.length; i++) { hasH += b.feature(i).loadGeometry().length; }
    row.push(`${x0 + dx}/${y0 + dy}: b=${b?.length ?? 0} h=${hasH} w=${vt.layers.water?.length ?? 0} lc=${vt.layers.landcover?.length ?? 0} ${(buf.length / 1024).toFixed(0)}k`);
  }
  console.log(row.join(' | '));
}
