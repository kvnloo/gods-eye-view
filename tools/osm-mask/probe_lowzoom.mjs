// FORK-ONLY. Which OpenMapTiles layers/classes does OpenFreeMap serve at low zoom (globe-scale mask)?
// usage: node tools/osm-mask/probe_lowzoom.mjs <z> <x> <y>
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const [z, x, y] = process.argv.slice(2).map(Number);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const url = tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
const vt = new VectorTile(new PbfReader(buf));
const out = { bytes: buf.byteLength, minzoom: tj.minzoom, maxzoom: tj.maxzoom, layers: {} };
for (const [name, layer] of Object.entries(vt.layers)) {
  const classes = {};
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const c = `${f.properties.class ?? '-'}:${f.type}`;
    classes[c] = (classes[c] ?? 0) + 1;
  }
  out.layers[name] = classes;
}
console.log(JSON.stringify(out));
