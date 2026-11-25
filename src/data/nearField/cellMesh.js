/**
 * @module data/nearField/cellMesh
 * @description FORK-ONLY (exp/near-field-v0). Geometry of one near-field
 * cell: buildings (gabled houses for small simple footprints, extruded
 * footprints with storey bands for the rest), pier and barge supports for
 * buildings on water, instanced trees, shore rocks and a flat water surface.
 *
 * Inputs: a cell fixture (cellData.js, OpenStreetMap via OpenMapTiles) and a
 * ground grid of Cesium World Terrain heights (ellipsoid metres, sampled by
 * the renderer, in memory only). Never Google content: no height, colour or
 * position here comes from the photoreal tiles.
 *
 * Output z values are absolute ellipsoid heights; x/y are east/north metres
 * around the cell centre. Deterministic per cell (seeded PRNG).
 */
import earcut from 'earcut';
import {
  GOLD,
  MIX,
  NORSE,
  PALETTE,
  Soup,
  broadleaf,
  buildingSupport,
  footprintWater,
  groundSampler,
  inPolygon,
  linear,
  orientedRect,
  pine,
  prism,
  prng,
  rockProto,
  roadWidth,
  waterField,
} from '../cityDioramaMesh.js';
import { treePrototype } from './canopy.js';
import { ringArea } from './cellData.js';

/** Theme asset kits. A preset's `nearField` block names one and may override any field. */
export const NEAR_FIELD_KITS = Object.freeze({
  // wintercats: Norse timber walls, turf and slate roofs, dark conifers, mossy shore rocks
  norse: Object.freeze({
    walls: NORSE.walls,
    // mossy turf, slate, terracotta and dark timber (judge r0: lime turf read as flat; terracotta helped)
    roofs: ['#6a7f3c', '#75864a', '#5d7234', '#4d5864', '#5d6875', '#b0563a', '#a14d35', '#7f8a4a', '#5a3d2e'],
    towerWalls: ['#cdbb98', '#b9a27c', '#8a6a4a', '#d8c7a4', '#6e5038', '#a48a68'],
    towerRoofs: ['#5d6875', '#4d5864', '#6f8f3a', '#5a4636'],
    window: '#2b2a2c',
    door: '#4a3020',
    pine: GOLD.pine,
    leaf: ['#5f7a34', '#6e8a3a', '#4f6a2e', '#7d8f42', '#586e30'],
    autumn: ['#b8743a', '#a8622e', '#c8903e'],
    autumnShare: 0.1,
    pineShare: 0.7,
    // the theme tile stage's water (deep #2a7a8e, shallows #44a4ac), so the hand-off has no colour step (judge r1)
    water: ['#2a7a8e', '#2d7f91', '#318594'],
    rocks: 1,
    density: 1.15,
    yard: 0.5,
    street: 0.45,
    sat: 0.92,
    gableMaxArea: 320,
  }),
  // enhanced-realism / default: neutral plaster, concrete and slate, natural greens
  realism: Object.freeze({
    walls: ['#d9d3c7', '#cfc6b6', '#bdb5a6', '#e2ddd2', '#a99f90', '#c4b49a', '#8f8678'],
    roofs: ['#5b5f66', '#6b6e73', '#7a5a48', '#8a4f3a', '#4d5157', '#9a6a52'],
    towerWalls: ['#b7bcc2', '#a6acb3', '#c9c4ba', '#8f969e', '#d4d0c8', '#9da3a8'],
    towerRoofs: ['#6a6d70', '#5a5d61', '#7a7c7e'],
    window: '#3c4650',
    door: '#3d3a36',
    pine: ['#2f4a33', '#38563a', '#2a4230'],
    leaf: ['#5a7a3a', '#4f6e34', '#66843f', '#587334'],
    autumn: ['#9a7a3a'],
    autumnShare: 0.03,
    pineShare: 0.25,
    water: ['#34505c', '#3a5a66', '#42646e'],
    rocks: 0,
    density: 0.9,
    yard: 0.35,
    street: 0.4,
    sat: 0.85,
    gableMaxArea: 220,
  }),
  // cozy: cream and timber walls, terracotta roofs (the diorama "mix" kit)
  mix: Object.freeze({
    walls: MIX.walls,
    roofs: MIX.roofs,
    towerWalls: ['#efe2c4', '#e6cfa6', '#d9c29a', '#c9b08a'],
    towerRoofs: ['#b8573a', '#5d6875', '#6e4a36'],
    window: '#3a3230',
    door: '#5a3a28',
    pine: PALETTE.pine,
    leaf: PALETTE.leaf,
    autumn: PALETTE.autumn,
    autumnShare: 0.06,
    pineShare: 0.3,
    water: ['#2f6f78', '#3a8088', '#4a9098'],
    rocks: 1,
    density: 1,
    yard: 0.45,
    street: 0.5,
    sat: 1,
    gableMaxArea: 300,
  }),
});

export function kitOf(name, overrides = {}) {
  const base = NEAR_FIELD_KITS[name] ?? NEAR_FIELD_KITS.realism;
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (!(k in base)) continue;
    if (Array.isArray(base[k]) && Array.isArray(v) && v.every((c) => /^#[0-9a-f]{6}$/i.test(c))) out[k] = v;
    else if (typeof base[k] === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof base[k] === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
  }
  return Object.freeze(out);
}

/** Integer hash of a cell, for its PRNG seed. */
export function cellSeed({ z, x, y }) {
  let h = 2166136261 >>> 0;
  for (const v of [z, x, y]) {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const STOREY = 3.2;
const SKIRT = 2.5; // walls reach this far under the lowest footprint corner (hidden in the ground)

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

class Grid {
  constructor(cell = 24) {
    this.cell = cell;
    this.m = new Map();
  }
  add(item, x0, y0, x1, y1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
        const k = `${i},${j}`;
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push(item);
      }
  }
  near(x, y) {
    return this.m.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`) ?? [];
  }
}

/**
 * A wall quad from (x0,y0) to (x1,y1) between za and zb whose colour darkens
 * toward the ground (baked contact shade: soft, painterly, costs nothing).
 * `zShade` is the height where the shade is full (the visible floor).
 */
function shadedQuad(s, x0, y0, x1, y1, za, zb, col, zShade, depth = 0.28, span = 6) {
  const k = (z) => 1 - depth * Math.max(0, Math.min(1, 1 - (z - zShade) / span));
  const ca = col.map((c, i) => (i < 3 ? c * k(za) : c));
  const cb = col.map((c, i) => (i < 3 ? c * k(zb) : c));
  const A = [x0, y0, za], B = [x1, y1, za], C = [x1, y1, zb], D = [x0, y0, zb];
  for (const [p0, p1, p2, c0, c1, c2] of [[A, B, C, ca, ca, cb], [A, C, D, ca, cb, cb]]) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    s.p.push(...p0, ...p1, ...p2);
    for (const c of [c0, c1, c2]) {
      s.n.push(nx / L, ny / L, nz / L);
      s.c.push(c[0], c[1], c[2], c[3] ?? 1);
    }
  }
}

/** Windows (and one door) on a wall run, as dark panes standing 4 cm proud of the wall. */
function windows(s, x0, y0, x1, y1, zFloor, storeys, pane, frame, r, door = false) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 3) return;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const nx = uy, ny = -ux; // outward for counter-clockwise rings
  const off = 0.04;
  const n = Math.max(1, Math.floor((L - 1.2) / 2.6));
  const step = L / n;
  const doorAt = door ? Math.floor(r() * n) : -1;
  for (let f = 0; f < storeys; f++)
    for (let i = 0; i < n; i++) {
      const mid = step * (i + 0.5);
      const isDoor = f === 0 && i === doorAt;
      const w = isDoor ? 0.55 : 0.5;
      const za = zFloor + f * STOREY + (isDoor ? 0.02 : 0.95);
      const zb = zFloor + f * STOREY + (isDoor ? 2.1 : 2.2);
      const ax = x0 + ux * (mid - w) + nx * off, ay = y0 + uy * (mid - w) + ny * off;
      const bx = x0 + ux * (mid + w) + nx * off, by = y0 + uy * (mid + w) + ny * off;
      s.quad([ax, ay, za], [bx, by, za], [bx, by, zb], [ax, ay, zb], isDoor ? frame : pane);
    }
}

/** Flat-roofed extrusion of a footprint (with courtyards) and storey bands. */
function extrude(s, outer, holes, z0, zFloor, zTop, wall, roof, band, r, narrowBands = false) {
  const rings = [outer, ...holes];
  const storeys = Math.min(40, Math.floor((zTop - zFloor) / STOREY));
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 0.05) continue;
      const q = (za, zb, col) => shadedQuad(s, x0, y0, x1, y1, za, zb, col, zFloor);
      if (storeys >= 2 && L > 2.5) {
        // ground floor wall, then per storey: sill wall + window band
        q(z0, zFloor + STOREY * 0.9, wall);
        let z = zFloor + STOREY * 0.9;
        for (let k = 1; k < storeys; k++) {
          const zw = zFloor + k * STOREY + 0.9;
          const ze = Math.min(zTop - 0.4, zw + (narrowBands ? 0.85 : 1.5));
          if (zw > z) q(z, zw, wall);
          if (ze > zw) q(zw, ze, band);
          z = Math.max(z, ze);
        }
        if (zTop > z) q(z, zTop, wall);
      } else q(z0, zTop, wall);
    }
  }
  // roof: earcut over outer + holes, faces up
  const flat = [];
  const holeIdx = [];
  for (const ring of rings) {
    if (ring !== outer) holeIdx.push(flat.length / 2);
    for (const [x, y] of ring) flat.push(x, y);
  }
  const tri = earcut(flat, holeIdx.length ? holeIdx : null, 2);
  const P = (i) => [flat[i * 2], flat[i * 2 + 1], zTop];
  for (let i = 0; i < tri.length; i += 3) {
    const a = P(tri[i]), b = P(tri[i + 1]), c = P(tri[i + 2]);
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (up >= 0) s.tri(a, b, c, roof);
    else s.tri(a, c, b, roof);
  }
  // a low parapet ring on tall roofs (reads as a roof edge from above)
  if (zTop - zFloor > 9 && r() < 0.8) {
    for (let i = 0; i < outer.length; i++) {
      const [x0, y0] = outer[i];
      const [x1, y1] = outer[(i + 1) % outer.length];
      s.quad([x1, y1, zTop], [x0, y0, zTop], [x0, y0, zTop + 0.7], [x1, y1, zTop + 0.7], wall);
    }
  }
}

/** Gabled (or hipped) house on an oriented rectangle, with windows, a door and contact shade. */
function gable(s, rect, z0, zFloor, wallTop, wall, roof, r, pitch = 38, ridgeMax = 6.5, trim = null) {
  const { c, u, a, b } = rect;
  const v = [-u[1], u[0]];
  const P = (sa, tb) => [c[0] + u[0] * sa + v[0] * tb, c[1] + u[1] * sa + v[1] * tb];
  const A = a, B = b;
  if (A < 1.2 || B < 1.2) return null;
  const corners = [P(-A, -B), P(A, -B), P(A, B), P(-A, B)];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[(i + 1) % 4];
    shadedQuad(s, x0, y0, x1, y1, z0, wallTop, wall, zFloor);
  }
  if (trim) {
    const storeys = Math.max(1, Math.min(3, Math.floor((wallTop - zFloor + 0.4) / STOREY)));
    // long walls get windows; the first long wall gets the door
    windows(s, ...corners[0], ...corners[1], zFloor, storeys, trim.pane, trim.frame, r, true);
    windows(s, ...corners[2], ...corners[3], zFloor, storeys, trim.pane, trim.frame, r, false);
    if (A > 4) {
      windows(s, ...corners[1], ...corners[2], zFloor, 1, trim.pane, trim.frame, r, false);
      windows(s, ...corners[3], ...corners[0], zFloor, 1, trim.pane, trim.frame, r, false);
    }
  }
  const e = 0.45;
  const rh = Math.min(ridgeMax, (B + e) * Math.tan((pitch * Math.PI) / 180));
  const hip = B > 7.5;
  const ridgeA = hip ? Math.max(0.5, A - B * 0.8) : A + e;
  const E = (sa, tb, z) => [...P(sa, tb), z];
  const r0 = E(-ridgeA, 0, wallTop + rh);
  const r1 = E(ridgeA, 0, wallTop + rh);
  const q = [E(-A - e, -B - e, wallTop - 0.15), E(A + e, -B - e, wallTop - 0.15), E(A + e, B + e, wallTop - 0.15), E(-A - e, B + e, wallTop - 0.15)];
  s.quad(q[0], q[1], r1, r0, roof);
  s.quad(q[2], q[3], r0, r1, roof);
  if (hip) {
    s.tri(q[1], q[2], r1, roof);
    s.tri(q[3], q[0], r0, roof);
  } else {
    const g0 = [E(-A, -B, wallTop), E(-A, B, wallTop), E(-A, 0, wallTop + rh - (e * rh) / (B + e))];
    const g1 = [E(A, B, wallTop), E(A, -B, wallTop), E(A, 0, wallTop + rh - (e * rh) / (B + e))];
    s.tri(g0[0], g0[2], g0[1], wall);
    s.tri(g1[0], g1[2], g1[1], wall);
    s.tri(q[0], r0, q[3], roof);
    s.tri(q[2], r1, q[1], roof);
  }
  if (r() < 0.45) {
    const sa = (r() - 0.5) * A;
    const tb = (r() > 0.5 ? 1 : -1) * B * 0.35;
    const [x, y] = P(sa, tb);
    const k = 0.45;
    prism(s, [[x - k, y - k], [x + k, y - k], [x + k, y + k], [x - k, y + k]], wallTop, wallTop + rh * 0.65 + 1.4, linear(PALETTE.chimney, 0.05, r));
  }
  return { corners, top: wallTop + rh, floor: zFloor };
}

function pierNear(fixture, poly) {
  for (const p of fixture.piers ?? []) {
    if (poly.some((q) => inPolygon(q, p)) || p.some((q) => inPolygon(q, poly))) return true;
  }
  for (const line of fixture.pierLines ?? [])
    for (const [x, y] of poly)
      for (let i = 0; i + 1 < line.length; i++)
        if (segDist(x, y, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]) < 4) return true;
  return false;
}

/**
 * Water level per body: the median terrain height along its shoreline (water
 * cells next to land) plus a small lift, so our surface sits on the visible
 * waterline even where the terrain carries bathymetry under the water, and
 * covers a terrain-following globe in keyless mode. Bodies with no shoreline
 * in the cell use the 75th percentile of the terrain under them.
 */
export function shoreLevels(water, gz, lift = 0.4) {
  const { n, cell, half, ids, dist } = water;
  const shore = new Map();
  const all = new Map();
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const id = ids[k];
      if (!id) continue;
      const h = gz(-half + (i + 0.5) * cell, half - (j + 0.5) * cell);
      if (!all.has(id)) all.set(id, []);
      all.get(id).push(h);
      if (dist[k] === 1) {
        if (!shore.has(id)) shore.set(id, []);
        shore.get(id).push(h);
      }
    }
  const levels = {};
  for (const [id, hs] of all) {
    const s = shore.get(id);
    const pick = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
    levels[id] = Math.round(((s?.length >= 4 ? pick(s, 0.5) : pick(hs, 0.75)) + lift) * 100) / 100;
  }
  return levels;
}

/**
 * Build a cell. Returns { soup, trees (protos with instances), footprints,
 * water (mask rectangles with levels), buildings (per-building facts for the
 * physical checks), stats }.
 */
export function buildCell(fixture, ground, kit = NEAR_FIELD_KITS.realism, opts = {}) {
  const r = prng(cellSeed(fixture.cell));
  const rp = prng(cellSeed(fixture.cell) ^ 0x9e3779b9);
  const sat = kit.sat ?? 1;
  const gz = groundSampler(ground);
  const water = waterField(fixture);
  const levels = water ? shoreLevels(water, gz) : {};
  const [bx0, by0, bx1, by1] = fixture.box;
  const inBox = (x, y, pad = 0) => x >= bx0 + pad && x < bx1 - pad && y >= by0 + pad && y < by1 - pad;
  const s = new Soup();
  const occ = new Grid(24);
  const footprints = [];
  const facts = [];
  const counts = { buildings: 0, gabled: 0, extruded: 0, pier: 0, hull: 0, droppedOnWater: 0, tiny: 0, terrainOutliers: 0 };

  const waterLevelAt = (body) => {
    const L = levels[body.id];
    return L == null ? gz(...body.point) - 0.3 : L;
  };

  for (const b of fixture.buildings ?? []) {
    const outer = b.p;
    const area = b.area ?? Math.abs(ringArea(outer));
    const rect = orientedRect(outer);
    if (!rect) {
      counts.tiny++;
      continue;
    }
    const body = footprintWater(outer, water);
    const share = body ? body.area / Math.max(1, area) : 0;
    let kind = 'land';
    if (body && share >= 0.25) {
      if (pierNear(fixture, outer)) kind = 'pier';
      else if (area <= 450) kind = 'hull';
      else {
        counts.droppedOnWater++;
        continue;
      }
    }
    // exact World Terrain heights at the footprint vertices when the renderer sampled them;
    // a vertex far off the 20 m grid is a failed tile sample, not terrain: use the grid there
    const gridZ = outer.map(([x, y]) => gz(x, y));
    const cornersZ = b.hz?.length === outer.length
      ? b.hz.map((h, i) => (Number.isFinite(h) && Math.abs(h - gridZ[i]) < 15 ? h : (counts.terrainOutliers++, gridZ[i])))
      : gridZ;
    const zMin = Math.min(...cornersZ);
    const zMean = cornersZ.reduce((a, z) => a + z, 0) / cornersZ.length;
    let z0 = zMin - SKIRT;
    let floor = zMean;
    let plane = null;
    let support = null;
    if (kind !== 'land') {
      plane = waterLevelAt(body);
      floor = kind === 'hull' ? plane + 1.65 : Math.max(plane, gz(...body.point)) + 2.4;
      z0 = floor;
    }
    const height = Math.max(3, (b.h ?? 8) - (b.min ?? 0));
    const lift = b.min ?? 0;
    if (lift > 0 && kind === 'land') {
      z0 = floor + lift;
      floor = z0;
    }
    const zTop = floor + height;
    const fill = area / Math.max(1, 4 * rect.a * rect.b);
    const small = area <= kit.gableMaxArea && height <= 14 && fill > 0.72 && !b.holes?.length && lift === 0;
    const wall = linear(kit.walls[Math.floor(r() * kit.walls.length)], 0.05, r, sat);
    let top;
    if (small) {
      const roof = linear(kit.roofs[Math.floor(r() * kit.roofs.length)], 0.07, r, sat);
      const trim = { pane: linear(kit.window, 0.06, r, sat), frame: linear(kit.door ?? kit.window, 0.06, r, sat) };
      const g = gable(s, rect, z0, floor, Math.max(floor + 2.6, zTop - 2.2), wall, roof, r, 38, 6.5, trim);
      if (!g) {
        counts.tiny++;
        continue;
      }
      top = g.top;
      counts.gabled++;
    } else {
      const tw = linear(kit.towerWalls[Math.floor(r() * kit.towerWalls.length)], 0.05, r, sat);
      const roof = linear(kit.towerRoofs[Math.floor(r() * kit.towerRoofs.length)], 0.06, r, sat);
      const band = linear(kit.window, 0.08, r, sat);
      const towerHeight = opts.style ? 22 : 14;
      extrude(s, outer, b.holes ?? [], z0, floor, zTop, height > towerHeight ? tw : wall, roof, band, r, !!opts.style);
      top = zTop + (height > 9 ? 0.7 : 0);
      counts.extruded++;
    }
    if (kind !== 'land') {
      support = buildingSupport(s, rect, kind === 'hull' ? 'hull' : 'pier', plane, floor, water, body);
      counts[kind]++;
    }
    counts.buildings++;
    const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
    const item = { outer, holes: b.holes ?? [] };
    occ.add(item, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    footprints.push({ rings: [outer, ...(b.holes ?? [])], top });
    facts.push({ c: b.c, kind, share: Math.round(share * 100) / 100, wallBottom: z0, floor, top, lift, area: Math.round(area), p: outer, support: support?.kind ?? null });
  }

  // roads (for keeping trees off them, and street-tree rows)
  const roads = [];
  for (const rd of fixture.roads ?? []) {
    const w = roadWidth(rd.t);
    if (!w) continue;
    for (let i = 0; i + 1 < rd.p.length; i++) {
      const [ax, ay] = rd.p[i];
      const [bx, by] = rd.p[i + 1];
      const seg = { a: rd.p[i], b: rd.p[i + 1], w, t: rd.t };
      occ.add({ seg }, Math.min(ax, bx) - w, Math.min(ay, by) - w, Math.max(ax, bx) + w, Math.max(ay, by) + w);
      roads.push(seg);
    }
  }
  const onWater = (x, y, pad) => water && (water.at(x, y) || water.at(x + pad, y) || water.at(x - pad, y) || water.at(x, y + pad) || water.at(x, y - pad));
  const onPier = (x, y) => (fixture.piers ?? []).some((p) => inPolygon([x, y], p));
  const free = (x, y, pad) => {
    if (!inBox(x, y)) return false;
    if (onWater(x, y, pad) || onPier(x, y)) return false;
    for (const it of occ.near(x, y)) {
      if (it.seg) {
        if (segDist(x, y, it.seg.a[0], it.seg.a[1], it.seg.b[0], it.seg.b[1]) < it.seg.w / 2 + pad * 0.6) return false;
      } else {
        if (inPolygon([x, y], it.outer) && !it.holes.some((h) => inPolygon([x, y], h))) return false;
        const o = it.outer;
        for (let i = 0; i < o.length; i++) {
          const q = o[(i + 1) % o.length];
          if (segDist(x, y, o[i][0], o[i][1], q[0], q[1]) < pad) return false;
        }
      }
    }
    return true;
  };

  // instanced trees (one prototype per kind/shape/colour)
  const protos = new Map();
  const look = { kit: { pine: kit.pine, leaf: kit.leaf, autumn: kit.autumn }, canopy: true, layered: true, tex: false, lod: 1 };
  const proto = (key) => {
    if (!protos.has(key)) {
      const [kind, shape, col, autumn] = key.split(':');
      const ps = new Soup();
      const pr = prng(1000 + Number(shape) * 97 + Number(col) * 13 + (autumn === '1' ? 7 : 0) + (kind === 'pine' ? 3 : 0));
      const dims = kind === 'rock'
        ? rockProto(ps, pr, Number(col), sat, 1)
        : kind === 'pine'
          ? pine(ps, 0, 0, 0, 1, pr, sat, { col: Number(col), ...look })
          : broadleaf(ps, 0, 0, 0, 1, pr, { autumn: 0 }, sat, { col: Number(col), autumn: autumn === '1', ...look });
      protos.set(key, { soup: ps, ...dims, instances: [] });
    }
    return protos.get(key);
  };
  const species = opts.style?.trees.species;
  const shareTotal = species?.reduce((sum, item) => sum + item.share, 0);
  let treeCount = 0;
  const plant = (x, y, pineShare, scale = 1) => {
    if (species) {
      let choice = rp() * shareTotal;
      let index = 0;
      while (index < species.length - 1 && (choice -= species[index].share) >= 0) index++;
      const item = species[index];
      const variant = rp() < 0.5 ? 0 : 1;
      const key = `species:${index}:${variant}`;
      if (!protos.has(key)) protos.set(key, { soup: treePrototype(item, variant), instances: [] });
      const [min, max] = item.radius;
      const radius = scale * (min + rp() * (max - min));
      protos.get(key).instances.push([x, y, gz(x, y) - 0.35, radius, rp() * Math.PI * 2, Math.floor(rp() * 256)]);
      treeCount++;
      return;
    }
    const kind = rp() < pineShare ? 'pine' : 'leaf';
    const autumn = kind === 'leaf' && rp() < kit.autumnShare;
    const ncol = kind === 'pine' ? kit.pine.length : autumn ? kit.autumn.length : kit.leaf.length;
    const key = `${kind}:${Math.floor(rp() * 3)}:${Math.floor(rp() * ncol)}:${autumn ? 1 : 0}`;
    const k = scale * (0.85 + rp() * 0.45);
    // sunk a little: the grid is bilinear between 20 m samples
    proto(key).instances.push([x, y, gz(x, y) - 1.2, k, rp() * Math.PI * 2]);
    treeCount++;
  };
  const density = Math.max(0.05, kit.density ?? 1) * (opts.trees ?? 1);
  const scatter = (area, step, keep, pineShare, pad) => {
    const ring = area.p;
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.max(bx0, Math.min(...xs)), x1 = Math.min(bx1, Math.max(...xs));
    const y0 = Math.max(by0, Math.min(...ys)), y1 = Math.min(by1, Math.max(...ys));
    const st = step / Math.sqrt(density);
    // grid anchored to world-aligned cell metres so neighbouring cells don't double up
    for (let x = Math.ceil(x0 / st) * st; x < x1; x += st)
      for (let y = Math.ceil(y0 / st) * st; y < y1; y += st) {
        if (rp() > keep) continue;
        const px = x + (rp() - 0.5) * st * 0.9;
        const py = y + (rp() - 0.5) * st * 0.9;
        if (!inPolygon([px, py], ring) || (area.holes ?? []).some((h) => inPolygon([px, py], h))) continue;
        if (!free(px, py, pad)) continue;
        plant(px, py, pineShare);
      }
  };
  const styleDensity = opts.style?.trees.density;
  for (const a of fixture.areas ?? []) {
    if (styleDensity) {
      const keep = styleDensity[a.k] ?? 0;
      if (keep) scatter(a, a.k === 'wood' ? 10 : 13, keep, 0, 2);
      continue;
    }
    if (a.k === 'wood') scatter(a, 6.5, 0.8, Math.min(0.95, kit.pineShare + 0.15), 1.6);
    else if (a.k === 'park' || a.k === 'grass') scatter(a, 10, 0.4, kit.pineShare, 2.2);
    else if (a.k === 'residential') scatter(a, 12, 0.3 * kit.yard, kit.pineShare * 0.7, 2.4);
  }
  const street = styleDensity ? styleDensity.street * (opts.trees ?? 1) : kit.street;
  if (street > 0)
    for (const seg of roads) {
      if (seg.w < 7 || seg.w > 13) continue;
      const [ax, ay] = seg.a;
      const [bx, by] = seg.b;
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 6) continue;
      const nx = -(by - ay) / L, ny = (bx - ax) / L;
      const off = seg.w / 2 + 1.4;
      for (let d = 5; d < L - 4; d += 10)
        for (const side of [-1, 1]) {
          if (rp() > street) continue;
          const x = ax + ((bx - ax) * d) / L + nx * off * side;
          const y = ay + ((by - ay) * d) / L + ny * off * side;
          if (!free(x, y, 0.7)) continue;
          plant(x, y, kit.pineShare * 0.4, 0.85);
        }
    }

  // Water surface, its own translucent mesh (the renderer fades it smoothly, no dither):
  // - opacity ramps from 0 at any edge (real shore or a marina cut-out) to 1 at
  //   EDGE_CELLS cells in, per vertex, so it melts into the map's own shoreline;
  // - only the fully opaque interior hides the tile underneath (waterRects, the mask);
  // - the shown raster leaves marinas to the map's own docks and boats.
  const waterRects = [];
  const ws = new Soup();
  let rocks = 0;
  const shownWater = fixture.waterShown ? waterField({ water: fixture.waterShown }) : water;
  if (!opts.style && water && shownWater) {
    const { n, cell, half, ids, dist } = shownWater;
    const EDGE_CELLS = 4;
    const op = (i, j) => (i < 0 || j < 0 || i >= n || j >= n || !ids[j * n + i] ? 0 : Math.min(1, Math.max(0, (dist[j * n + i] - 1) / (EDGE_CELLS - 1))));
    // corner (i, j) = top-left corner of cell (i, j); opacity = mean of the 4 cells around it
    const cornerOp = (i, j) => (op(i - 1, j - 1) + op(i, j - 1) + op(i - 1, j) + op(i, j)) / 4;
    const colourOf = (i, j) => {
      const band = Math.min(2, Math.max(0, water.dist[j * n + i] - 1));
      return linear(kit.water[Math.max(0, kit.water.length - 1 - band)] ?? kit.water[0], 0, r, sat);
    };
    for (let j = 0; j < n; j++) {
      const y1 = half - j * cell, y0 = y1 - cell;
      if (y0 >= by1 + 0.6 || y1 <= by0 - 0.6) continue;
      let i = 0;
      while (i < n) {
        const k0 = j * n + i;
        const id = ids[k0];
        if (!id) {
          i++;
          continue;
        }
        const level = levels[id] ?? gz(-half + (i + 0.5) * cell, y0 + cell / 2);
        const interior = dist[k0] >= EDGE_CELLS + 1;
        if (!interior) {
          // one quad per edge cell, opacity per corner
          const xa = -half + i * cell, xb = xa + cell;
          // each translucent edge cell is drawn by the one cell square holding its centre
          if (inBox(xa + cell / 2, y0 + cell / 2)) {
            const c = colourOf(i, j);
            const v = (x, y, ci, cj) => [x, y, level, cornerOp(ci, cj)];
            const A = v(xa, y0, i, j + 1), B = v(xb, y0, i + 1, j + 1), C = v(xb, y1, i + 1, j), D = v(xa, y1, i, j);
            for (const [p0, p1, p2] of [[A, B, C], [A, C, D]]) {
              ws.p.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
              for (const q of [p0, p1, p2]) ws.c.push(c[0], c[1], c[2], q[3]);
              ws.n.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
            }
          }
          i++;
          continue;
        }
        // interior run: same body, same colour band, all interior
        const band = Math.min(2, Math.max(0, water.dist[k0] - 1));
        let k = i + 1;
        while (k < n && ids[j * n + k] === id && dist[j * n + k] >= EDGE_CELLS + 1 && Math.min(2, Math.max(0, water.dist[j * n + k] - 1)) === band) k++;
        // 0.6 m past the cell square: neighbouring cells overlap instead of leaving hairline gaps
        const xa = Math.max(bx0 - 0.6, -half + i * cell), xb = Math.min(bx1 + 0.6, -half + k * cell);
        const ya = Math.max(by0 - 0.6, y0), yb = Math.min(by1 + 0.6, y1);
        if (xb > xa && yb > ya) {
          const col = [...colourOf(i, j), 1];
          ws.quad([xa, ya, level], [xb, ya, level], [xb, yb, level], [xa, yb, level], col);
          // the mask: only the opaque interior hides the tile, and only inside the cell square
          const mx0 = Math.max(bx0, xa), mx1 = Math.min(bx1, xb), my0 = Math.max(by0, ya), my1 = Math.min(by1, yb);
          if (mx1 > mx0 && my1 > my0) waterRects.push([mx0, my0, mx1, my1, Math.round(level * 10) / 10]);
        }
        i = k;
      }
    }
    // mossy boulders along the shore (kit.rocks), own PRNG stream
    if (kit.rocks > 0) {
      const rr = prng(cellSeed(fixture.cell) ^ 4242);
      for (let j = 1; j < n - 1; j++)
        for (let i = 1; i < n - 1; i++) {
          const k = j * n + i;
          // a real shoreline (truth raster), not the edge of a marina cut-out
          if (!ids[k] || water.dist[k] !== 1 || rr() > 0.45 * kit.rocks) continue;
          const x = -half + (i + 0.5) * cell + (rr() - 0.5) * cell;
          const y = half - (j + 0.5) * cell + (rr() - 0.5) * cell;
          if (!inBox(x, y)) continue;
          let near = false;
          for (const it of occ.near(x, y)) if (!it.seg && inPolygon([x, y], it.outer)) near = true;
          if (near) continue;
          const big = rr();
          const rad = big > 0.85 ? 2.4 + rr() * 1.4 : big > 0.45 ? 1.5 + rr() * 0.8 : 0.8 + rr() * 0.5;
          const level = levels[ids[k]] ?? gz(x, y);
          proto(`rock:${Math.floor(rr() * 3)}:${Math.floor(rr() * GOLD.rock.length)}:0`).instances.push([x, y, level - rad * 0.25, rad, rr() * Math.PI * 2]);
          rocks++;
        }
    }
  }
  const instTris = [...protos.values()].reduce((a, p) => a + p.soup.triangles * p.instances.length, 0);
  return {
    soup: s,
    waterSoup: ws,
    protos,
    footprints,
    water: waterRects,
    buildings: facts,
    stats: {
      ...counts,
      trees: treeCount,
      rocks,
      waterRects: waterRects.length,
      triangles: s.triangles + ws.triangles + instTris,
      storedTriangles: s.triangles + [...protos.values()].reduce((a, p) => a + p.soup.triangles, 0),
    },
  };
}

/**
 * The OSM-geometry invariant of a built cell (osm_geo.py's "no building on
 * water unless pier or barge"): every generated building whose footprint is
 * at least `minShare` on the water raster must carry a pier or hull support.
 */
export function waterViolations(built, minShare = 0.25) {
  return built.buildings.filter((b) => b.share >= minShare && !b.support);
}
