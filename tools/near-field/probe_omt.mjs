// Probe an OpenFreeMap z14 tile: layers, classes, property keys.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const [lat, lon] = [Number(process.argv[2] ?? 37.8555), Number(process.argv[3] ?? -122.489)];
const z = 14, n = 2 ** z;
const x = Math.floor(((lon + 180) / 360) * n);
const r = (lat * Math.PI) / 180;
const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
console.log('tilejson', tj.tiles[0], 'maxzoom', tj.maxzoom, 'attribution', tj.attribution);
const url = tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
console.log('bytes', buf.length);
const vt = new VectorTile(new PbfReader(buf));
for (const [name, layer] of Object.entries(vt.layers)) {
  const classes = {}; const keys = new Set(); const types = {};
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    Object.keys(f.properties).forEach((k) => keys.add(k));
    const c = f.properties.class ?? '-'; classes[c] = (classes[c] ?? 0) + 1;
    types[f.type] = (types[f.type] ?? 0) + 1;
  }
  console.log(name, layer.length, JSON.stringify(types), JSON.stringify(classes).slice(0, 300), [...keys].slice(0, 20).join(','));
}
const b = vt.layers.building;
if (b) { let h = 0; for (let i = 0; i < b.length; i++) if (b.feature(i).properties.render_height) h++; console.log('building with render_height', h, '/', b.length, 'sample', JSON.stringify(b.feature(0).properties)); }
