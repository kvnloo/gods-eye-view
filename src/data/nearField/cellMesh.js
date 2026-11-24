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
import { ringArea } from './cellData.js';

/** Theme asset kits. A preset's `nearField` block names one and may override any field. */
export const NEAR_FIELD_KITS = Object.freeze({
  // wintercats: Norse timber walls, turf and slate roofs, dark conifers, mossy shore rocks
  norse: Object.freeze({
    walls: NORSE.walls,
    roofs: NORSE.roofs,
    towerWalls: ['#cdbb98', '#b9a27c', '#8a6a4a', '#d8c7a4', '#6e5038', '#a48a68'],
    towerRoofs: ['#5d6875', '#4d5864', '#6f8f3a', '#5a4636'],
    window: '#3a2e26',
    pine: GOLD.pine,
    leaf: ['#5f7a34', '#6e8a3a', '#4f6a2e', '#7d8f42', '#586e30'],
    autumn: ['#b8743a', '#a8622e', '#c8903e'],
    autumnShare: 0.1,
    pineShare: 0.7,
    water: ['#2c5a64', '#326a72', '#3a7a80'],
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
    window: '#47525c',
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
    window: '#4a3a30',
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
const WATER_TAG = 0.5; // colour alpha marks water for the shader

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

/** Flat-roofed extrusion of a footprint (with courtyards) and storey bands. */
function extrude(s, outer, holes, z0, zFloor, zTop, wall, roof, band, r) {
  const rings = [outer, ...holes];
  const storeys = Math.min(40, Math.floor((zTop - zFloor) / STOREY));
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 0.05) continue;
      const q = (za, zb, col) => s.quad([x0, y0, za], [x1, y1, za], [x1, y1, zb], [x0, y0, zb], col);
      if (storeys >= 2 && L > 2.5) {
        // ground floor wall, then per storey: sill wall + window band
        q(z0, zFloor + STOREY * 0.9, wall);
        let z = zFloor + STOREY * 0.9;
        for (let k = 1; k < storeys; k++) {
          const zw = zFloor + k * STOREY + 0.9;
          const ze = Math.min(zTop - 0.4, zw + 1.5);
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

/** Gabled (or hipped) house on an oriented rectangle. */
function gable(s, rect, z0, zFloor, wallTop, wall, roof, r, pitch = 38, ridgeMax = 6.5) {
  const { c, u, a, b } = rect;
  const v = [-u[1], u[0]];
  const P = (sa, tb) => [c[0] + u[0] * sa + v[0] * tb, c[1] + u[1] * sa + v[1] * tb];
  const A = a, B = b;
  if (A < 1.2 || B < 1.2) return null;
  const corners = [P(-A, -B), P(A, -B), P(A, B), P(-A, B)];
  prism(s, corners, z0, wallTop, wall, false);
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
      const g = gable(s, rect, z0, floor, Math.max(floor + 2.6, zTop - 2.2), wall, roof, r);
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
      extrude(s, outer, b.holes ?? [], z0, floor, zTop, height > 14 ? tw : wall, roof, band, r);
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
  let treeCount = 0;
  const plant = (x, y, pineShare, scale = 1) => {
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
  for (const a of fixture.areas ?? []) {
    if (a.k === 'wood') scatter(a, 6.5, 0.8, Math.min(0.95, kit.pineShare + 0.15), 1.6);
    else if (a.k === 'park' || a.k === 'grass') scatter(a, 10, 0.4, kit.pineShare, 2.2);
    else if (a.k === 'residential') scatter(a, 12, 0.3 * kit.yard, kit.pineShare * 0.7, 2.4);
  }
  if (kit.street > 0)
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
          if (rp() > kit.street) continue;
          const x = ax + ((bx - ax) * d) / L + nx * off * side;
          const y = ay + ((by - ay) * d) / L + ny * off * side;
          if (!free(x, y, 0.7)) continue;
          plant(x, y, kit.pineShare * 0.4, 0.85);
        }
    }

  // water surface: run-length quads at each body's level, inside the cell square
  const waterRects = [];
  let rocks = 0;
  if (water) {
    const { n, cell, half, ids, dist } = water;
    for (let j = 0; j < n; j++) {
      const y1 = half - j * cell, y0 = y1 - cell;
      if (y0 >= by1 || y1 <= by0) continue;
      let i = 0;
      while (i < n) {
        const id = ids[j * n + i];
        const band = Math.min(2, dist[j * n + i] - 1);
        let k = i + 1;
        while (k < n && ids[j * n + k] === id && Math.min(2, dist[j * n + k] - 1) === band) k++;
        if (id) {
          // 0.6 m past the cell square: neighbouring cells overlap instead of leaving hairline gaps
          const xa = Math.max(bx0 - 0.6, -half + i * cell), xb = Math.min(bx1 + 0.6, -half + k * cell);
          const ya = Math.max(by0 - 0.6, y0), yb = Math.min(by1 + 0.6, y1);
          if (xb > xa && yb > ya) {
            const level = levels[id] ?? gz((xa + xb) / 2, (ya + yb) / 2) - 0.3;
            const col = [...linear(kit.water[Math.max(0, kit.water.length - 1 - band)] ?? kit.water[0], 0, r, sat), WATER_TAG];
            s.quad([xa, ya, level], [xb, ya, level], [xb, yb, level], [xa, yb, level], col);
            waterRects.push([xa, ya, xb, yb, Math.round(level * 10) / 10]);
          }
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
          if (!ids[k] || dist[k] !== 1 || rr() > 0.45 * kit.rocks) continue;
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
    protos,
    footprints,
    water: waterRects,
    buildings: facts,
    stats: {
      ...counts,
      trees: treeCount,
      rocks,
      waterRects: waterRects.length,
      triangles: s.triangles + instTris,
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
