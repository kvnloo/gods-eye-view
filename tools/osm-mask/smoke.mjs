// FORK-ONLY. Build OSM class mask tiles in node from live OpenFreeMap data and
// write a colour-coded PNG (OSM content only; no Google). Usage:
//   node tools/osm-mask/smoke.mjs <lat> <lon> <z> <n> <out.png>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createMaskGenerator } from '../../src/data/osmMask/maskJob.js';
import { TILE_PX, maskWindow } from '../../src/data/osmMask/maskMath.js';

const [lat, lon, z, n, out] = [
  Number(process.argv[2] ?? 37.8555),
  Number(process.argv[3] ?? -122.489),
  Number(process.argv[4] ?? 16),
  Number(process.argv[5] ?? 4),
  process.argv[6] ?? 'mask.png',
];
const gen = createMaskGenerator();
const win = maskWindow(lat, lon, z, n);
const W = n * TILE_PX;
const img = new Uint8Array(W * W * 3);
const t0 = performance.now();
let features = 0;
for (const t of win.tiles) {
  const { rgba, features: f } = await gen.maskTile(t);
  features += f;
  for (let j = 0; j < TILE_PX; j++)
    for (let i = 0; i < TILE_PX; i++) {
      const s = (j * TILE_PX + i) * 4;
      const o = ((t.slot[1] * TILE_PX + j) * W + t.slot[0] * TILE_PX + i) * 3;
      const [r, g, b] = [rgba[s], rgba[s + 1], rgba[s + 2]];
      let c = [225, 215, 195];
      if (r > 127) c = r > 160 ? [40, 80, 160] : [90, 170, 210];
      else if (r > 120) c = [200, 230, 240];
      if (g >= 192) c = [30, 90, 40];
      else if (g > 64) c = [120, 190, 80];
      if (b === 1) c = [120, 120, 120];
      else if (b >= 2) c = [150 + ((b * 37) % 100), 60 + ((b * 13) % 60), 50];
      img.set(c, o);
    }
}
console.log(JSON.stringify({ tiles: win.tiles.length, features, ms: Math.round(performance.now() - t0), stats: gen.stats }));
const crc = (buf) => {
  let c = ~0;
  for (const x of buf) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
};
const raw = Buffer.alloc((W * 3 + 1) * W);
for (let y = 0; y < W; y++) Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  out,
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
);
