import { groundSampler, roadWidth, waterField } from '../cityDioramaMesh.js';
import { rasterize } from './cellData.js';
import { encodeRgbPng } from './png.js';
import { rgb } from './stylePack.js';
import { fromLocal } from './tiling.js';

// Paint priority, from broad land use to transport. Shore distance uses a
// padded raster so open water doesn't acquire a rim at every cell boundary.
const CLASSES = [
  'meadow', 'farmland', 'residential', 'commercial', 'park', 'wood', 'sand', 'rock', 'ice',
  'water', 'shallow', 'kerb', 'road', 'rail', 'paving', 'path',
];
const ID = Object.fromEntries(CLASSES.map((name, id) => [name, id]));
const widthOf = (type) => roadWidth(type) || ({ rail: 4, transit: 3.5, busway: 7, raceway: 7 })[type] || 2.4;

function stroke(ids, n, px, half, points, radius, id) {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius + half) / px));
    const x1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + radius + half) / px));
    const y0 = Math.max(0, Math.floor((half - Math.max(ay, by) - radius) / px));
    const y1 = Math.min(n - 1, Math.floor((half - Math.min(ay, by) + radius) / px));
    for (let row = y0; row <= y1; row++) {
      const y = half - (row + 0.5) * px - ay;
      for (let col = x0; col <= x1; col++) {
        const x = (col + 0.5) * px - half - ax;
        const t = Math.max(0, Math.min(1, (x * dx + y * dy) / l2));
        if ((x - t * dx) ** 2 + (y - t * dy) ** 2 <= radius ** 2) ids[row * n + col] = id;
      }
    }
  }
}

// Two chamfer passes approximate Euclidean distance in pixel units.
function distances(ids, n, isSource, limit) {
  const d = new Float32Array(ids.length);
  for (let i = 0; i < d.length; i++) d[i] = isSource(ids[i]) ? 0 : limit;
  for (const dir of [1, -1]) {
    const start = dir === 1 ? 0 : n - 1;
    for (let y = start; y >= 0 && y < n; y += dir) {
      for (let x = start; x >= 0 && x < n; x += dir) {
        const i = y * n + x;
        if (x !== start) d[i] = Math.min(d[i], d[i - dir] + 1);
        if (y === start) continue;
        const prev = i - dir * n;
        d[i] = Math.min(d[i], d[prev] + 1);
        if (x > 0) d[i] = Math.min(d[i], d[prev - 1] + Math.SQRT2);
        if (x < n - 1) d[i] = Math.min(d[i], d[prev + 1] + Math.SQRT2);
      }
    }
  }
  return d;
}

export function rasterGround(fixture, resolution) {
  const px = fixture.side / resolution;
  const pad = Math.ceil(18 / px);
  const n = resolution + pad * 2;
  const half = n * px / 2;
  const ids = new Uint8Array(n * n);
  const areas = fixture.areas ?? [];
  for (const name of CLASSES.slice(1, ID.water)) {
    const shapes = areas.filter((a) => (a.k === 'grass' ? 'meadow' : a.k) === name);
    rasterize(ids, n, px, half, shapes.map((a) => [a.p, ...(a.holes ?? [])]), ID[name]);
  }
  rasterize(ids, n, px, half, (fixture.waterPolygons ?? []).map((a) => a.rings), ID.water);
  const shore = distances(ids, n, (id) => id !== ID.water, 18 / px);
  rasterize(ids, n, px, half, (fixture.piers ?? []).map((ring) => [ring]), ID.paving);
  for (const line of fixture.pierLines ?? []) stroke(ids, n, px, half, line, 1.8, ID.paving);
  const roads = fixture.roads ?? [];
  for (const { t, p } of roads) {
    if (widthOf(t) >= 4.5 && t !== 'pedestrian') stroke(ids, n, px, half, p, widthOf(t) / 2 + 0.85, ID.kerb);
  }
  for (const { t, p } of roads) {
    const name = t === 'rail' || t === 'transit' ? 'rail' : t === 'pedestrian' ? 'paving' : widthOf(t) >= 4.5 ? 'road' : 'path';
    stroke(ids, n, px, half, p, widthOf(t) / 2, ID[name]);
  }
  for (const a of fixture.plazas ?? []) rasterize(ids, n, px, half, [a.rings], ID.paving);
  const buildings = new Uint8Array(n * n);
  rasterize(buildings, n, px, half, fixture.contacts ?? [], 1);
  const contact = distances(buildings, n, Boolean, 5 / px);
  return { ids, shore, contact, px, pad, n };
}

export function paintGround(fixture, resolution, ground) {
  const { ids, shore, contact, px, pad, n } = rasterGround(fixture, resolution);
  const colors = CLASSES.map((name) => rgb(ground[name][0]).map((c) => c * 255));
  const rgbPixels = new Uint8Array(resolution * resolution * 3);
  const { lon, lat } = fixture.centre;
  const phaseX = lon * 397.14, phaseY = lat * 397.14;
  const east = Math.cos(lat * Math.PI / 180);
  for (let row = 0, out = 0; row < resolution; row++) {
    const y = phaseY - (row + 0.5 - resolution / 2) * px / 280;
    for (let col = 0; col < resolution; col++) {
      const x = phaseX + (col + 0.5 - resolution / 2) * px / (280 * east);
      const i = (row + pad) * n + col + pad;
      const id = ids[i];
      const color = colors[id];
      const shallow = id === ID.water ? Math.max(0, 1 - shore[i] * px / 16) : 0;
      const shade = 1 - 0.24 * Math.max(0, 1 - contact[i] * px / 5) ** 2;
      const drift = 0.24 * Math.sin(x + 0.8 * Math.sin(y)) + 0.18 * Math.cos(y * 2.7 + x * 1.6)
        + 0.08 * Math.sin(x * 23 + y * 19);
      const value = shade * (1 + ground[CLASSES[id]][1] * drift);
      for (let channel = 0; channel < 3; channel++) {
        rgbPixels[out++] = Math.min(255, Math.round(value * (color[channel] + shallow * (colors[ID.shallow][channel] - color[channel]))));
      }
    }
  }
  return rgbPixels;
}

// The fixture uses simple metre coordinates. Convert them to the cell's
// WGS84 tangent frame, including curvature, so neighbouring cells line up.
export function terrainFrame(origin) {
  const radians = Math.PI / 180;
  const a = 6378137, e2 = 0.00669437999014;
  const b = origin.lat * radians, sb = Math.sin(b), cb = Math.cos(b);
  const prime = a / Math.sqrt(1 - e2 * sb * sb);
  const centreX = prime * cb, centreZ = prime * (1 - e2) * sb;
  return (x, y, z) => {
    const { lat, lon } = fromLocal(x, y, origin);
    const t = lat * radians, l = (lon - origin.lon) * radians;
    const s = Math.sin(t), c = Math.cos(t);
    const radius = a / Math.sqrt(1 - e2 * s * s);
    const dx = (radius + z) * c * Math.cos(l) - centreX;
    const dz = (radius * (1 - e2) + z) * s - centreZ;
    return [(radius + z) * c * Math.sin(l), cb * dz - sb * dx, cb * dx + sb * dz];
  };
}

export async function buildWorldGround(fixture, ground, style, resolution) {
  const gz = groundSampler(ground);
  const frame = terrainFrame(fixture.centre);
  const water = waterField(fixture);
  const [west, south, east, north] = fixture.box;
  const steps = Math.ceil(fixture.side / 14);
  const p = [], uv = [], wetness = [], indices = [];
  const add = (x, y, drop = 0) => {
    p.push(...frame(x, y, gz(x, y) + 0.28 - drop));
    uv.push(0.5 + x / fixture.side, 0.5 - y / fixture.side);
    wetness.push(water?.at(x, y) ? 1 : 0, 0);
  };
  const stride = steps + 1;
  for (let row = 0; row <= steps; row++)
    for (let col = 0; col <= steps; col++)
      add(west + (east - west) * col / steps, south + (north - south) * row / steps);
  for (let row = 0; row < steps; row++)
    for (let col = 0; col < steps; col++) {
      const i = row * stride + col;
      indices.push(i, i + 1, i + stride, i + 1, i + stride + 1, i + stride);
    }
  const rim = [];
  for (let i = 0; i < steps; i++) rim.push(i);
  for (let i = 0; i < steps; i++) rim.push(i * stride + steps);
  for (let i = steps; i > 0; i--) rim.push(steps * stride + i);
  for (let i = steps; i > 0; i--) rim.push(i * stride);
  const base = p.length / 3;
  for (const i of rim) {
    p.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2] - 8);
    uv.push(uv[i * 2], uv[i * 2 + 1]);
    wetness.push(wetness[i * 2], 0);
  }
  rim.forEach((i, k) => {
    const next = (k + 1) % rim.length;
    indices.push(i, base + k, rim[next], rim[next], base + k, base + next);
  });
  return { p, uv, wetness, indices, png: await encodeRgbPng(resolution, resolution, paintGround(fixture, resolution, style)) };
}
