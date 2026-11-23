// FORK-ONLY experiment (exp/city-look-diorama, city dream loop v3 arm 2):
// the pure geometry of the low-poly "diorama" district (?look=diorama).
// Input: an OSM footprint fixture in local east/north metres
// (public/city-diorama/*.osm.json, (c) OpenStreetMap contributors, ODbL) and a
// baked ground height grid. Output: flat-shaded triangle soup (positions,
// normals, linear colours) in local ENU metres, z relative to the centre's
// ground, plus the 2D shapes the ground painter needs (house rectangles, tree
// discs, shadow polygons). Deterministic: one seeded PRNG, no Math.random.
// No Cesium import, so it runs (and is tested) in node.

import { SHORE, appendBoulder } from './cityShoreRocks.js';

export const DIORAMA_DEFAULTS = Object.freeze({
  // Defaults = the loop's best (rounds 1-6, loop-v3/arm-diorama/REPORT.md); every knob stays a ?dio= override.
  radius: 720, // the photoreal tiles are cut inside this disc (r5: 430 -> 720)
  groundPad: 10, // the painted ground reaches this far past the cut
  ringIn: 670, // post blend ring (diorama -> photoreal) starts here...
  ringOut: 900, // ...and is fully photoreal-styled here
  hScale: 0.72, // OSM height -> wall height
  hMin: 3.4,
  hMax: 15,
  storey: 3.2, // building:levels -> metres
  pitch: 38, // gable pitch, degrees
  ridgeMax: 6.5,
  split: 12, // houses longer than this are split into units
  gap: 0.45, // inset of every house from its footprint rectangle
  eave: 0.45,
  chimney: 0.5, // share of houses with a chimney
  trees: 2.5, // tree density multiplier (r2: 1 -> 2.5)
  treeScale: 1.25,
  forestRing: 1, // 1: a belt of pines along the cut (r2)
  autumn: 0.06, // share of broadleaf crowns in autumn orange
  sunAz: 245, // the key light (and painted shadows), degrees from north
  sunEl: 40,
  roads: 'dirt', // cobble | dirt (r3)
  fog: 0.38,
  shade: 0.36, // painted shadow strength
  sat: 1, // palette saturation multiplier
  ambient: 0.62,
  key: 0.75,
  debug: 0, // 1: the blend stage paints its ring factor (red) and 100 m distance bands (green)
  pal: 'mix', // town | mix | norse (r3: town -> mix) (dark timber walls, turf and slate roofs: the Thveit kit)
  roadW: 0.65, // street width multiplier on the painted ground (r3)
  tilt: 0, // screen-space tilt-shift strength in the blend stage (0 = off)
  tiltY: 0.55, // focus band centre, fraction of the frame height from the top
  mist: 0.85, // strength of the mist bank on the photoreal just outside the cut (r4)
  mistW: 70, // its width, metres
  warm: 1, // (r7) 1: the photoreal context takes a warm palette pull instead of grey haze
  fx: 'r700', // r520 | r700 (wider OSM fixture; needed for radius > 500)
  lod: 1, // (r6) 1: lighter tree prototypes (2-tier pines, 1-2 crown blobs) for software renderers
  instanced: 1, // trees as EXT_mesh_gpu_instancing prototypes (0: merged into one mesh)
  street: 0.8, // (r2) probability of a street tree every 9 m along each side of wide streets
  // exp/city-loop-v3 seam trials (D1, after 4 blend trials): new mechanism classes
  // (b) map edge: a raised plinth with earth skirt walls and a cloud bank around it
  lift: 0, // metres the diorama rises at far zoom (0 = off)
  liftFrom: 900, // camera height over the district where the lift starts...
  liftTo: 1400, // ...and is full
  skirt: 0, // depth of the earth skirt wall around the disc, metres (0 = off)
  bank: 0, // cloud bank opacity at the disc edge (0 = off)
  bankW: 260, // cloud bank falloff width, metres
  bankFar: 0.55, // cloud bank opacity that stays over the far context
  bankIn: -25, // metres past the cut where the bank starts (> the skirt keeps the wall in view)
  // (c) a painterly palette match: the photoreal context takes the diorama's palette
  match: 0, // strength 0..1 (0 = off)
  matchCell: 16, // metres per roof-colour cell of the match
  // exp/city-loop-v5 look pass A (toward the locked in-camera target A); each piece is a knob, so it can be ablated
  rocks: 1, // mossy boulders along the shore (0 = off)
  foam: 1, // painted shore foam, foam rings at the boulders, sparse wave highlights on the water
  grass: 1, // olive meadow ground with grass strokes and wildflower flecks, a grassy shore verge
  waterTone: 1, // deeper teal water
  grade: 1, // warm late-afternoon key over a cooler ambient
  tex: 1, // surface texture in the light shader: roof tile rows, rock speckle, water ripples
});

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Knobs from `?dio=key:value,key:value` over the defaults. */
export function dioramaOptions(search = '') {
  const q = new URLSearchParams(search ?? '');
  const out = { ...DIORAMA_DEFAULTS };
  for (const part of (q.get('dio') ?? '').split(',')) {
    const [k, v] = part.split(':').map((s) => s?.trim());
    if (!k || !(k in DIORAMA_DEFAULTS) || v === undefined) continue;
    out[k] = typeof DIORAMA_DEFAULTS[k] === 'number' ? num(v, out[k]) : v;
  }
  return Object.freeze(out);
}

export function prng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- palette (sRGB hex; converted to linear for glTF vertex colours)
export const NORSE = Object.freeze({
  walls: ['#5b3c28', '#6e4a30', '#7d5636', '#4f3524', '#e6d3ad', '#8a6440', '#5f4330'],
  roofs: ['#6f8f3a', '#7d9a42', '#617f34', '#4d5864', '#5d6875', '#8a9a48', '#b0563a', '#6f8f3a'],
});
// between town and norse: cream and timber walls, fewer orange roofs, slate, brown and moss
export const MIX = Object.freeze({
  walls: ['#efe2c4', '#e9d4ac', '#f3ead8', '#6e4a30', '#8a5a3c', '#7d5636', '#e6cfa6', '#5b3c28'],
  roofs: ['#b8573a', '#c8683e', '#4d5864', '#5d6875', '#6e4a36', '#5a3d2e', '#6f8f3a', '#7d9a42', '#a14d35'],
});
export const PALETTE = Object.freeze({
  walls: ['#efe2c4', '#e9d4ac', '#f3ead8', '#dcc39a', '#8a5a3c', '#9c6b45', '#e6cfa6', '#7b4e33'],
  roofs: ['#c0603a', '#b04f36', '#d07448', '#5d6875', '#4d5864', '#6e4a36', '#7a8a3e', '#a85a3a', '#c8683e'],
  plinth: '#7d7466',
  timber: '#5e3d29',
  chimney: '#8c4c3a',
  pine: ['#2f5e3b', '#386b42', '#28513a', '#3f7447'],
  leaf: ['#5f9e3c', '#73ad45', '#4f8c38', '#86bb4c', '#679f3e'],
  autumn: ['#d9822b', '#c9662a', '#e09a35'],
  trunk: '#6e4a31',
  rock: '#9a9a90',
});

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
}
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function linear(hex, jitter = 0, r = Math.random, sat = 1) {
  let [R, G, B] = hexRgb(hex);
  if (sat !== 1) {
    const l = 0.299 * R + 0.587 * G + 0.114 * B;
    [R, G, B] = [R, G, B].map((c) => Math.min(1, Math.max(0, l + (c - l) * sat)));
  }
  const k = 1 + (r() - 0.5) * 2 * jitter;
  return [R, G, B].map((c) => toLinear(Math.min(1, Math.max(0, c * k))));
}

// ---------- ground height (baked grid, bilinear)
export function groundSampler(ground) {
  if (!ground?.heights?.length) return () => 0;
  const { n, spacing, half, heights } = ground;
  const off = ground.offset ?? 0;
  const h0 = ground.centre ?? 0;
  return (x, y) => {
    const fx = Math.min(n - 1.001, Math.max(0, (x + half) / spacing));
    const fy = Math.min(n - 1.001, Math.max(0, (y + half) / spacing));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const at = (a, b) => heights[b * n + a];
    const h =
      at(i, j) * (1 - tx) * (1 - ty) +
      at(i + 1, j) * tx * (1 - ty) +
      at(i, j + 1) * (1 - tx) * ty +
      at(i + 1, j + 1) * tx * ty;
    return h + off - h0;
  };
}

// ---------- 2D helpers
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Minimum-area rectangle: {c:[x,y], u:[ux,uy] (long axis), a (half long), b (half short)}. */
export function orientedRect(points) {
  const h = hull(points);
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i];
    const [x1, y1] = h[(i + 1) % h.length];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) continue;
    const ux = (x1 - x0) / L;
    const uy = (y1 - y0) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of h) {
      const s = x * ux + y * uy;
      const t = -x * uy + y * ux;
      a0 = Math.min(a0, s); a1 = Math.max(a1, s);
      b0 = Math.min(b0, t); b1 = Math.max(b1, t);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uy, a0, a1, b0, b1 };
  }
  const { ux, uy, a0, a1, b0, b1 } = best;
  const sm = (a0 + a1) / 2;
  const tm = (b0 + b1) / 2;
  let rect = { c: [sm * ux - tm * uy, sm * uy + tm * ux], u: [ux, uy], a: (a1 - a0) / 2, b: (b1 - b0) / 2 };
  if (rect.b > rect.a) rect = { c: rect.c, u: [-uy, ux], a: rect.b, b: rect.a };
  return rect;
}

export function polygonArea(ps) {
  let s = 0;
  for (let i = 0; i < ps.length; i++) {
    const [x0, y0] = ps[i];
    const [x1, y1] = ps[(i + 1) % ps.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

export function inPolygon([x, y], ps) {
  let inside = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [xi, yi] = ps[i];
    const [xj, yj] = ps[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

class Grid {
  constructor(cell = 24) { this.cell = cell; this.m = new Map(); }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  addBox(item, x0, y0, x1, y1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
        const k = `${i},${j}`;
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push(item);
      }
  }
  near(x, y) { return this.m.get(this.key(x, y)) ?? []; }
}

export const ROAD_WIDTH = {
  motorway: 14, trunk: 13, primary: 12, secondary: 11, tertiary: 10, residential: 8,
  unclassified: 7, living_street: 6, service: 4.5, pedestrian: 5, footway: 2.4, path: 2,
  steps: 2.2, cycleway: 2.4, track: 3,
};
export const roadWidth = (t) => ROAD_WIDTH[t] ?? 0;

// ---------- mesh builder (non-indexed, flat normals)
export class Soup {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    this.p.push(...a, ...b, ...c);
    // col[3], when given, is a vertex tag for the light shader (colour alpha; the ground is < 0.75)
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2], col[3] ?? 1); }
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  get triangles() { return this.p.length / 9; }
}

function prism(s, pts2, z0, z1, col, top = true) {
  // pts2 counter-clockwise
  const n = pts2.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts2[i];
    const [x1, y1] = pts2[(i + 1) % n];
    s.quad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], col);
  }
  if (top) for (let i = 1; i < n - 1; i++) s.tri([...pts2[0], z1], [...pts2[i], z1], [...pts2[i + 1], z1], col);
}

function ring(cx, cy, r, sides, rot = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const t = rot + (i / sides) * Math.PI * 2;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  });
}

function cone(s, cx, cy, z0, h, r, sides, col, rot) {
  const base = ring(cx, cy, r, sides, rot);
  const tip = [cx, cy, z0 + h];
  for (let i = 0; i < sides; i++) {
    const a = base[i];
    const b = base[(i + 1) % sides];
    s.tri([...a, z0], [...b, z0], tip, col);
  }
  for (let i = 1; i < sides - 1; i++) s.tri([...base[0], z0], [...base[i + 1], z0], [...base[i], z0], col);
}

const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const L = Math.hypot(...p); return p.map((c) => c / L); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();

function blob(s, cx, cy, cz, rx, rz, col, r) {
  const v = ICO.v.map(([x, y, z]) => {
    const k = 0.85 + r() * 0.3;
    return [cx + x * rx * k, cy + y * rx * k, cz + z * rz * k];
  });
  for (const [a, b, c] of ICO.f) s.tri(v[a], v[b], v[c], col);
}

// ---------- houses
function house(s, rect, z0, wallH, o, r, sat) {
  const { c, u, a, b } = rect;
  const v = [-u[1], u[0]];
  const P = (sa, tb) => [c[0] + u[0] * sa + v[0] * tb, c[1] + u[1] * sa + v[1] * tb];
  const A = a - o.gap;
  const B = b - o.gap;
  if (A < 1.2 || B < 1.2) return null;
  const kit = o.pal === 'norse' ? NORSE : o.pal === 'mix' ? MIX : PALETTE;
  const wallHex = kit.walls[Math.floor(r() * kit.walls.length)];
  const roofHex = kit.roofs[Math.floor(r() * kit.roofs.length)];
  const wall = linear(wallHex, 0.05, r, sat);
  const roof = [...linear(roofHex, 0.07, r, sat), o.tex > 0 ? 0.85 : 1]; // 0.85: roof tiles in the light shader
  const plinth = linear(PALETTE.plinth, 0.05, r, sat);
  const corners = [P(-A, -B), P(A, -B), P(A, B), P(-A, B)];
  const zt = z0 + wallH;
  prism(s, corners, z0, z0 + 0.8, plinth, false);
  prism(s, corners, z0 + 0.8, zt, wall, false);
  // gable roof along the long axis; wide houses get a hip roof
  const e = o.eave;
  const rh = Math.min(o.ridgeMax, (B + e) * Math.tan((o.pitch * Math.PI) / 180));
  const hip = B > 7.5;
  const ridgeA = hip ? Math.max(0.5, A - B * 0.8) : A + e;
  const E = (sa, tb, z) => [...P(sa, tb), z];
  const r0 = E(-ridgeA, 0, zt + rh);
  const r1 = E(ridgeA, 0, zt + rh);
  const q = [E(-A - e, -B - e, zt - 0.15), E(A + e, -B - e, zt - 0.15), E(A + e, B + e, zt - 0.15), E(-A - e, B + e, zt - 0.15)];
  // the two long roof planes
  s.quad(q[0], q[1], r1, r0, roof);
  s.quad(q[2], q[3], r0, r1, roof);
  if (hip) {
    s.tri(q[1], q[2], r1, roof);
    s.tri(q[3], q[0], r0, roof);
  } else {
    // gable ends: wall coloured triangles above the walls, roof caps under the eaves
    const g0 = [E(-A, -B, zt), E(-A, B, zt), E(-A, 0, zt + rh - (e * rh) / (B + e))];
    const g1 = [E(A, B, zt), E(A, -B, zt), E(A, 0, zt + rh - (e * rh) / (B + e))];
    s.tri(g0[0], g0[2], g0[1], wall);
    s.tri(g1[0], g1[2], g1[1], wall);
    // roof undersides so the eave reads from below
    s.tri(q[0], r0, q[3], roof);
    s.tri(q[2], r1, q[1], roof);
  }
  if (r() < o.chimney) {
    const sa = (r() - 0.5) * A;
    const tb = (r() > 0.5 ? 1 : -1) * B * 0.35;
    const [x, y] = P(sa, tb);
    const k = 0.45;
    const zc = zt + rh * (1 - 0.35) + 1.4;
    prism(s, [[x - k, y - k], [x + k, y - k], [x + k, y + k], [x - k, y + k]], zt, zc, linear(PALETTE.chimney, 0.05, r, sat));
  }
  return { corners, top: zt + rh, wallTop: zt };
}

function wallHeight(b, o, r) {
  let h = b.h ?? (b.lv ? b.lv * o.storey : null);
  if (!h || h <= 0) h = 7 + r() * 5;
  const named = b.n && h > 20;
  const w = named ? Math.min(h * 0.8, 40) : Math.min(o.hMax, Math.max(o.hMin, h * o.hScale));
  return w;
}

// ---------- trees
function pine(s, x, y, z, k, r, sat, pick) {
  const h = (7 + r() * 5) * k;
  const rad = (2.2 + r() * 0.9) * k;
  const ci = pick?.col ?? Math.floor(r() * PALETTE.pine.length);
  const col = linear(PALETTE.pine[ci % PALETTE.pine.length], 0.08, r, sat);
  const trunk = linear(PALETTE.trunk, 0.05, r, sat);
  const rot = r() * 6.28;
  prism(s, ring(x, y, 0.28 * k, 5, rot), z - 0.3, z + h * 0.22, trunk, false);
  const tiers = pick?.lod ? 2 : 3;
  for (let i = 0; i < tiers; i++) {
    const z0 = z + h * (0.15 + i * (tiers === 2 ? 0.34 : 0.24));
    const rr = rad * (1 - i * (tiers === 2 ? 0.38 : 0.26));
    cone(s, x, y, z0, h * (tiers === 2 ? 0.6 - i * 0.12 : 0.5 - i * 0.08), rr, pick?.lod ? 6 : 7, col, rot + i);
  }
  return { r: rad, h };
}

function broadleaf(s, x, y, z, k, r, o, sat, pick) {
  const rad = (2.6 + r() * 1.6) * k;
  const h = (3.2 + r() * 1.5) * k;
  const autumn = pick ? pick.autumn : r() < o.autumn;
  const pal = autumn ? PALETTE.autumn : PALETTE.leaf;
  const col = linear(pal[(pick?.col ?? Math.floor(r() * pal.length)) % pal.length], 0.08, r, sat);
  const col2 = col.map((c) => c * 0.8);
  const trunk = linear(PALETTE.trunk, 0.05, r, sat);
  prism(s, ring(x, y, 0.3 * k, 5, r() * 6), z - 0.3, z + h, trunk, false);
  blob(s, x, y, z + h + rad * 0.6, rad, rad * 0.85, col, r);
  const n = pick?.lod ? Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const t = r() * 6.28;
    blob(s, x + Math.cos(t) * rad * 0.6, y + Math.sin(t) * rad * 0.6, z + h + rad * 0.35, rad * 0.62, rad * 0.55, i ? col : col2, r);
  }
  return { r: rad * 1.25, h: h + rad * 1.5 };
}

// look pass A: a boulder prototype (unit radius); three of four colours get a moss cap.
// tag 0.8 = rock speckle in the light shader.
function rockProto(s, r, col, sat, tag) {
  const stone = linear(SHORE.rock[col % SHORE.rock.length], 0.06, r, sat);
  const moss = col % 4 !== 3 ? linear(SHORE.moss[col % SHORE.moss.length], 0.06, r, sat) : null;
  appendBoulder(s, ICO, 0, 0, 0, 1, [...stone, tag], moss && [...moss, tag], r);
  return { r: 1, h: 1 };
}

// ---------- water (fixture@2, exp/city-loc-green): a run-length raster of water bodies
const WATER_CACHE = new WeakMap();
/**
 * The fixture's water raster, decoded: `ids` (body id per cell, 0 = land, row 0 = north),
 * `dist` (cells to the nearest land cell, chamfer), `at(x, y)` -> body id. Null without water.
 */
export function waterField(fixture) {
  const w = fixture?.water;
  if (!w?.rle?.length) return null;
  if (WATER_CACHE.has(fixture)) return WATER_CACHE.get(fixture);
  const { n, cell, half } = w;
  const ids = new Uint8Array(n * n);
  w.rle.forEach((row, j) => {
    let i = 0;
    for (const [id, run] of row) {
      if (id) ids.fill(id, j * n + i, j * n + i + run);
      i += run;
    }
  });
  if (!ids.some((v) => v)) {
    WATER_CACHE.set(fixture, null);
    return null;
  }
  const BIG = 65535;
  const dist = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) dist[k] = ids[k] ? BIG : 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!dist[k]) continue;
      if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1);
      if (j > 0) dist[k] = Math.min(dist[k], dist[k - n] + 1);
    }
  for (let j = n - 1; j >= 0; j--)
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      if (!dist[k]) continue;
      if (i < n - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1);
      if (j < n - 1) dist[k] = Math.min(dist[k], dist[k + n] + 1);
    }
  const at = (x, y) => {
    const i = Math.floor((x + half) / cell);
    const j = Math.floor((half - y) / cell);
    return i >= 0 && j >= 0 && i < n && j < n ? ids[j * n + i] : 0;
  };
  const field = Object.freeze({ n, cell, half, ids, dist, at });
  WATER_CACHE.set(fixture, field);
  return field;
}

/**
 * Level each water body in a ground grid (in place): every grid point on water
 * takes its body's 75th-percentile height minus 0.3 m, so bays and lakes read
 * flat whatever bathymetry the terrain carries. Returns { bodyId: level }.
 */
export function levelWater(ground, water) {
  if (!ground?.heights?.length || !water) return {};
  const { n, spacing, half, heights } = ground;
  const by = new Map();
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const id = water.at(-half + i * spacing, -half + j * spacing);
      if (!id) continue;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(j * n + i);
    }
  const levels = {};
  for (const [id, ks] of by) {
    const hs = ks.map((k) => heights[k]).sort((a, b) => a - b);
    const level = hs[Math.min(hs.length - 1, Math.floor(hs.length * 0.75))] - 0.3;
    for (const k of ks) heights[k] = level;
    levels[id] = Math.round(level * 100) / 100;
  }
  return levels;
}

// Clip the footprint to each wet cell. Checking only the footprint vertices
// misses a water cell enclosed by the footprint or crossed by a long edge.
function clipEdge(polygon, axis, edge, sign) {
  const clipped = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = (a[axis] - edge) * sign, db = (b[axis] - edge) * sign;
    if (da >= 0) clipped.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return clipped;
}

function footprintWater(polygon, water) {
  if (!water) return null;
  const { n, half, cell, ids } = water;
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  const col = (x) => Math.floor((x + half) / cell);
  const row = (y) => Math.floor((half - y) / cell);
  const iMin = Math.max(0, col(Math.min(...xs)));
  const iMax = Math.min(n - 1, col(Math.max(...xs)));
  const bodies = new Map();
  for (let j = Math.max(0, row(Math.max(...ys))); j <= Math.min(n - 1, row(Math.min(...ys))); j++) {
    const y = half - j * cell;
    for (let i = iMin; i <= iMax; i++) {
      const id = ids[j * n + i];
      if (!id) continue;
      const x = i * cell - half;
      let overlap = clipEdge(polygon, 0, x, 1);
      overlap = clipEdge(overlap, 0, x + cell, -1);
      overlap = clipEdge(overlap, 1, y - cell, 1);
      overlap = clipEdge(overlap, 1, y, -1);
      const area = polygonArea(overlap);
      if (area <= 1e-8) continue;
      const body = bodies.get(id) ?? { id, area: 0, largestCell: 0 };
      if (area > body.largestCell) {
        const [sx, sy] = overlap.reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0]);
        body.point = [sx / overlap.length, sy / overlap.length];
        body.largestCell = area;
      }
      body.area += area;
      bodies.set(id, body);
    }
  }
  return [...bodies.values()].sort((a, b) => b.area - a.area)[0] ?? null;
}

function buildingSupport(s, rect, kind, plane, base, water, body) {
  const { c, u, a, b } = rect;
  const point = (x, y) => [c[0] + u[0] * x - u[1] * y, c[1] + u[1] * x + u[0] * y];
  const outline = (length, width) => [
    point(-length, -width), point(length, -width),
    point(length, width), point(-length, width),
  ];
  const rim = outline(a + 0.5, b + 0.5);
  const start = s.triangles;
  if (kind === 'hull') {
    const bottom = outline(a * 0.88, b * 0.76);
    const hullColor = linear('#394951');
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      s.quad([...bottom[i], plane - 0.45], [...bottom[j], plane - 0.45],
        [...rim[j], plane], [...rim[i], plane], hullColor);
    }
    // Keep the flared part below water so the freeboard presents a vertical face.
    prism(s, rim, plane, base - 0.18, hullColor, false);
    prism(s, rim, base - 0.18, base, linear('#786454'));
  } else {
    const deckBottom = base - 0.35;
    prism(s, rim, deckBottom, base, linear('#8b735a'));
    const postColor = linear('#514338');
    const post = ([x, y]) => prism(s, ring(x, y, 0.5, 6), plane - 0.6, deckBottom, postColor, false);
    let hasWetPost = false;
    const bays = Math.max(1, Math.ceil((a * 2 - 1.6) / 8));
    for (let i = 0; i <= bays; i++) {
      const x = Math.max(0, a - 0.8) * (2 * i / bays - 1);
      for (const side of [-1, 1]) {
        // Align the outside of the post with the deck edge.
        const position = point(x, side * b);
        post(position);
        hasWetPost ||= water.at(...position) === body.id;

      }
    }
    if (!hasWetPost) post(body.point);
  }
  return { kind, start, end: s.triangles };
}

/**
 * Build the diorama. Returns { soup, houses, trees, stats } where houses and
 * trees carry 2D shapes for the ground painter.
 */
export function buildDiorama(fixture, ground, o = DIORAMA_DEFAULTS, waterLevels = {}) {
  const r = prng(20261122);
  const gz = groundSampler(ground);
  const R = o.radius + o.groundPad;
  const s = new Soup();
  const occ = new Grid(24); // house rectangles and roads, for tree placement
  const houses = [];
  const sat = o.sat;
  const water = waterField(fixture);

  for (const b of fixture.buildings ?? []) {
    const rect = orientedRect(b.p);
    if (!rect) continue;
    if (Math.hypot(...rect.c) > R - 2) continue;
    if (polygonArea(b.p) < 6) continue;
    const body = footprintWater(b.p, water);
    const kind = b.k === 'barge' || b.k === 'houseboat' ? 'hull' : 'pier';
    let plane, supportBase, support;
    if (body) {
      const level = waterLevels[body.id];
      plane = level == null
        ? gz(...body.point)
        : level + (ground?.offset ?? 0) - (ground?.centre ?? 0);
      supportBase = kind === 'hull'
        ? plane + 1.65
        // Bilinear terrain near shore can sit above the leveled water.
        : Math.max(plane, gz(...body.point)) + 2.4;
    }
    const wallH = wallHeight(b, o, r);
    // split long buildings into house units (rhythm of separate roofs)
    const units = Math.max(1, Math.round((rect.a * 2) / o.split));
    for (let k = 0; k < units; k++) {
      const len = (rect.a * 2) / units;
      const off = -rect.a + len * (k + 0.5);
      const unit = {
        c: [rect.c[0] + rect.u[0] * off, rect.c[1] + rect.u[1] * off],
        u: rect.u,
        a: len / 2,
        b: rect.b,
      };
      // a deep narrow unit turns its ridge across
      if (unit.b > unit.a) Object.assign(unit, { u: [-rect.u[1], rect.u[0]], a: rect.b, b: len / 2 });
      const zs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
        gz(unit.c[0] + unit.u[0] * unit.a * i - unit.u[1] * unit.b * j, unit.c[1] + unit.u[1] * unit.a * i + unit.u[0] * unit.b * j),
      );
      const z0 = supportBase ?? Math.min(...zs) - 0.6;
      const zTop = supportBase ?? Math.max(...zs);
      const hJit = units > 1 ? (r() - 0.5) * 2.4 : 0;
      const h = house(s, unit, z0, zTop - z0 + wallH + hJit, o, r, sat);
      if (!h) continue;
      const xs = h.corners.map((p) => p[0]);
      const ys = h.corners.map((p) => p[1]);
      if (body) support ??= buildingSupport(s, rect, kind, plane, supportBase, water, body);
      const item = { kind: 'house', corners: h.corners, height: h.top - zTop, support };
      occ.addBox(item, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      houses.push(item);
    }
  }

  const roads = [];
  for (const rd of fixture.roads ?? []) {
    const w = roadWidth(rd.t) * o.roadW;
    if (!w) continue;
    for (let i = 0; i + 1 < rd.p.length; i++) {
      const seg = { kind: 'road', a: rd.p[i], b: rd.p[i + 1], w };
      const [ax, ay] = seg.a;
      const [bx, by] = seg.b;
      occ.addBox(seg, Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w);
      roads.push(seg);
    }
  }

  const green = (fixture.areas ?? []).filter((a) => a.k !== 'water' && a.k !== 'wetland');
  const free = (x, y, pad) => {
    if (Math.hypot(x, y) > R - 3) return false;
    if (water && (water.at(x, y) || water.at(x + pad, y) || water.at(x - pad, y) || water.at(x, y + pad) || water.at(x, y - pad))) return false;
    for (const it of occ.near(x, y)) {
      if (it.kind === 'house') {
        if (inPolygon([x, y], it.corners)) return false;
        // keep crowns off walls
        for (let i = 0; i < 4; i++) if (segDist([x, y], it.corners[i], it.corners[(i + 1) % 4]) < pad) return false;
      } else if (segDist([x, y], it.a, it.b) < it.w / 2 + pad * 0.6) return false;
    }
    return true;
  };
  const trees = [];
  // o.instanced: every tree is an instance of one of a few prototypes
  // (EXT_mesh_gpu_instancing), so the model carries each shape once.
  const protos = new Map();
  const proto = (key) => {
    if (!protos.has(key)) {
      const [kind, shape, col, autumn] = key.split(':');
      const ps = new Soup();
      const pr = prng(1000 + Number(shape) * 97 + Number(col) * 13 + (autumn === '1' ? 7 : 0) + (kind === 'pine' ? 3 : 0));
      const dims = kind === 'rock'
        ? rockProto(ps, pr, Number(col), sat, o.tex > 0 ? 0.8 : 1)
        : kind === 'pine'
          ? pine(ps, 0, 0, 0, 1, pr, sat, { col: Number(col), lod: o.lod })
          : broadleaf(ps, 0, 0, 0, 1, pr, o, sat, { col: Number(col), autumn: autumn === '1', lod: o.lod });
      protos.set(key, { soup: ps, ...dims, instances: [] });
    }
    return protos.get(key);
  };
  const plant = (x, y, kind) => {
    const z = gz(x, y);
    const k = o.treeScale * (0.8 + r() * 0.45);
    if (o.instanced) {
      const autumn = kind !== 'pine' && r() < o.autumn;
      const ncol = kind === 'pine' ? PALETTE.pine.length : autumn ? PALETTE.autumn.length : PALETTE.leaf.length;
      const key = `${kind}:${Math.floor(r() * 3)}:${Math.floor(r() * ncol)}:${autumn ? 1 : 0}`;
      const p = proto(key);
      p.instances.push([x, y, z, k, r() * Math.PI * 2]);
      trees.push({ x, y, r: p.r * k, h: p.h * k });
      return;
    }
    const t = kind === 'pine' ? pine(s, x, y, z, k, r, sat) : broadleaf(s, x, y, z, k, r, o, sat);
    trees.push({ x, y, r: t.r, h: t.h });
  };
  const inGreen = (x, y) => green.some((g) => inPolygon([x, y], g.p));
  // 1 mapped street trees
  for (const [x, y] of fixture.trees ?? []) if (free(x, y, 0.5)) plant(x, y, r() < 0.3 ? 'pine' : 'leaf');
  // 2 parks and yards on a jittered grid
  const step = 7.5 / Math.sqrt(Math.max(0.05, o.trees));
  for (let x = -R; x <= R; x += step)
    for (let y = -R; y <= R; y += step) {
      const px = x + (r() - 0.5) * step * 0.9;
      const py = y + (r() - 0.5) * step * 0.9;
      const g = inGreen(px, py);
      const keep = g ? 0.5 : 0.45;
      if (r() > keep) continue;
      if (!free(px, py, g ? 2.0 : 1.6)) continue;
      plant(px, py, r() < (g ? 0.4 : 0.3) ? 'pine' : 'leaf');
    }
  // 3 optional street-tree rows along wide streets
  if (o.street > 0)
    for (const seg of roads) {
      if (seg.w < 5) continue;
      const [ax, ay] = seg.a;
      const [bx, by] = seg.b;
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 4) continue;
      const nx = -(by - ay) / L;
      const ny = (bx - ax) / L;
      const off = seg.w / 2 + 1.3;
      for (let d = 4; d < L - 3; d += 9)
        for (const side of [-1, 1]) {
          if (r() > o.street) continue;
          const x = ax + ((bx - ax) * d) / L + nx * off * side;
          const y = ay + ((by - ay) * d) / L + ny * off * side;
          if (!free(x, y, 0.6)) continue;
          plant(x, y, r() < 0.2 ? 'pine' : 'leaf');
        }
    }
  // 4 optional forest belt along the cut (hides the cut seam)
  if (o.forestRing > 0) {
    const n = Math.round(2 * Math.PI * o.radius / 5 * o.forestRing);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + r() * 0.02;
      const rr = o.radius - 4 - r() * 26;
      const x = Math.cos(t) * rr;
      const y = Math.sin(t) * rr;
      if (!free(x, y, 1.2)) continue;
      plant(x, y, r() < 0.75 ? 'pine' : 'leaf');
    }
  }
  // 5 look pass A: mossy boulders along every shore edge of the water raster, mostly on the water side.
  // Own PRNG, so the houses and trees above keep exactly their placements; none on a house or a road.
  let rocks = 0;
  const shore = []; // boulder discs, for the ground painter's foam rings
  if (o.rocks > 0 && water && o.instanced) {
    const rr = prng(4242);
    const { n, cell, half, ids, dist } = water;
    const nearBuilt = (x, y, pad) => {
      for (const it of occ.near(x, y)) {
        if (it.kind === 'house') {
          if (inPolygon([x, y], it.corners)) return true;
          for (let i = 0; i < 4; i++) if (segDist([x, y], it.corners[i], it.corners[(i + 1) % 4]) < pad) return true;
        } else if (segDist([x, y], it.a, it.b) < it.w / 2 + pad) return true;
      }
      return false;
    };
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if (!ids[k] || dist[k] !== 1) continue;
        const cx = -half + (i + 0.5) * cell;
        const cy = half - (j + 0.5) * cell;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (ids[k + dj * n + di]) continue; // that neighbour is water too
          const ex = cx + di * cell * 0.5;
          const ey = cy - dj * cell * 0.5;
          const m = rr() < 0.55 * o.rocks ? 2 : 1;
          for (let q = 0; q < m; q++) {
            const along = (rr() - 0.5) * cell;
            const off = (rr() - 0.3) * cell * 0.5;
            const x = ex + dj * along - di * off;
            const y = ey + di * along + dj * off;
            if (Math.hypot(x, y) > R - 4) continue;
            const big = rr();
            const rad = big > 0.8 ? 2.8 + rr() * 1.6 : big > 0.4 ? 1.7 + rr() * 0.9 : 0.9 + rr() * 0.6;
            if (nearBuilt(x, y, rad + 0.4)) continue;
            const key = `rock:${Math.floor(rr() * 3)}:${Math.floor(rr() * SHORE.rock.length)}:0`;
            proto(key).instances.push([x, y, gz(x, y) - rad * 0.12, rad, rr() * Math.PI * 2]);
            shore.push({ x, y, r: rad });
            rocks++;
          }
        }
      }
  }
  const instTris = [...protos.values()].reduce((a, p) => a + p.soup.triangles * p.instances.length, 0);
  return {
    soup: s,
    protos,
    houses,
    trees,
    roads,
    rocks: shore,
    stats: {
      houses: houses.length,
      trees: trees.length,
      rocks,
      triangles: s.triangles + instTris,
      storedTriangles: s.triangles + [...protos.values()].reduce((a, p) => a + p.soup.triangles, 0),
      prototypes: protos.size,
      roadSegments: roads.length,
    },
  };
}

/** Painted-shadow polygon of a house for a sun (az from north, el). */
export function shadowOf(corners, height, sunAz, sunEl) {
  const az = (sunAz * Math.PI) / 180;
  const len = height / Math.tan((Math.max(8, sunEl) * Math.PI) / 180);
  // shadows fall away from the sun
  const dx = -Math.sin(az) * len;
  const dy = -Math.cos(az) * len;
  return hull([...corners, ...corners.map(([x, y]) => [x + dx, y + dy])]);
}
