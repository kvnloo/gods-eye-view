// FORK-ONLY (exp/city-loop-v5, fix1 inner loop): a Node port of
// critics/osm_geo.py, the geometry the physical-sanity gate checks with, over a
// gev-city-diorama fixture (OSM, ODbL 1.0). Same maths, same thresholds, so
// the harness and critics/sanity_gate.py agree (parity is tested in
// geo.test.mjs against the Python gate). Local east/north metres from the
// fixture centre: x = (lon - lon0) * kx, y = (lat - lat0) * M.
import { readFileSync } from 'node:fs';

export const M = 111_320;
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const mod = (a, n) => ((a % n) + n) % n;

export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

export function centroid(poly) {
  const a = area(poly);
  if (Math.abs(a) < 1e-9)
    return [
      poly.reduce((s, p) => s + p[0], 0) / poly.length,
      poly.reduce((s, p) => s + p[1], 0) / poly.length,
    ];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function inside([x, y], poly) {
  let c = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    if (y0 > y !== y1 > y && x < x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)) c = !c;
  }
  return c;
}

const orient = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function segCross(p1, p2, q1, q2) {
  return (
    orient(q1, q2, p1) > 0 !== orient(q1, q2, p2) > 0 &&
    orient(p1, p2, q1) > 0 !== orient(p1, p2, q2) > 0
  );
}

export function polysOverlap(a, b) {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
        return true;
  return (
    inside(centroid(a), b) || inside(centroid(b), a) || inside(a[0], b) || inside(b[0], a)
  );
}

export function inset(poly, d) {
  const [cx, cy] = centroid(poly);
  return poly.map(([x, y]) => {
    const L = Math.hypot(x - cx, y - cy) || 1;
    const k = Math.max(0, L - d * Math.SQRT2) / L;
    return [cx + (x - cx) * k, cy + (y - cy) * k];
  });
}

/** Outline points every `step` m plus an interior lattice every `step` m (as osm_geo.sample_poly). */
export function samplePoly(poly, step = 1) {
  const pts = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let t = 0; t < k; t++)
      pts.push([a[0] + ((b[0] - a[0]) * t) / k, a[1] + ((b[1] - a[1]) * t) / k]);
  }
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const [x0, x1, y1] = [Math.min(...xs), Math.max(...xs), Math.max(...ys)];
  for (let y = Math.min(...ys); y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) if (inside([x, y], poly)) pts.push([x, y]);
  return pts;
}

export const bearingMod90 = (a, b) => mod(deg(Math.atan2(b[0] - a[0], b[1] - a[1])), 90);

export function angDiff90(a, b) {
  const d = Math.abs(mod(a - b, 90));
  return Math.min(d, 90 - d);
}

export function polyYaw(poly) {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = rad(bearingMod90(a, b) * 4);
    sx += L * Math.cos(t);
    sy += L * Math.sin(t);
  }
  return mod(deg(Math.atan2(sy, sx)) / 4, 90);
}

const SKIP_ROADS = new Set([
  'footway', 'path', 'steps', 'cycleway', 'motorway', 'motorway_link', 'track', 'service',
]);

export class Fixture {
  /** `json` is a parsed fixture; `water` optionally a raster from another @2 build of the same centre. */
  constructor(json, { water = null, osmXml = null } = {}) {
    this.lat0 = json.centre.lat;
    this.lon0 = json.centre.lon;
    this.kx = M * Math.cos(rad(this.lat0));
    this.buildings = (json.buildings ?? [])
      .filter((b) => (b.p ?? []).length >= 3)
      .map((b) => {
        const xs = b.p.map((p) => p[0]);
        const ys = b.p.map((p) => p[1]);
        return Object.assign(b.p, {
          box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        });
      });
    this.roads = (json.roads ?? [])
      .filter((r) => (r.p ?? []).length >= 2)
      .map((r) => ({ t: r.t, p: r.p }));
    const w = json.water ?? water;
    this.water = null;
    if (w) {
      const grid = w.rle.map((row) => {
        const line = [];
        for (const [body, run] of row) for (let k = 0; k < run; k++) line.push(body);
        return line;
      });
      this.water = { cell: +w.cell, half: +w.half, n: +w.n, grid };
    }
    this.waterLines = osmXml ? waterLinesFromXml(osmXml, this) : [];
  }

  local(lon, lat) {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * M];
  }

  lonlat(x, y) {
    return [this.lon0 + x / this.kx, this.lat0 + y / M];
  }

  /** Water body id (0 = land), null outside the raster or without one. */
  waterAt(x, y) {
    const w = this.water;
    if (!w) return null;
    const i = Math.floor((x + w.half) / w.cell);
    const j = Math.floor((w.half - y) / w.cell);
    if (!(i >= 0 && i < w.n && j >= 0 && j < w.n)) return null;
    return w.grid[j][i];
  }

  waterHits(poly, tol = 0.5, step = 1) {
    const core = inset(poly, tol);
    const samples = samplePoly(core, step);
    const pts = samples.filter((p) => (this.waterAt(...p) || 0) > 0);
    const xs = core.map((p) => p[0]);
    const ys = core.map((p) => p[1]);
    const box = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
    const kinds = [];
    for (const [kind, line] of this.waterLines) {
      for (let k = 0; k < line.length - 1; k++) {
        const a = line[k];
        const b = line[k + 1];
        if (Math.max(a[0], b[0]) < box[0] || Math.min(a[0], b[0]) > box[2]) continue;
        if (Math.max(a[1], b[1]) < box[1] || Math.min(a[1], b[1]) > box[3]) continue;
        if (core.some((p, i) => segCross(p, core[(i + 1) % core.length], a, b)) || inside(a, core)) {
          kinds.push(kind);
          break;
        }
      }
    }
    return {
      waterPoints: pts.length,
      samples: samples.length,
      shoreCrossings: kinds.length,
      kinds: [...new Set(kinds)].sort(),
    };
  }

  /** Dominant street orientation (deg mod 90) within `radius` m, as osm_geo.street_orientation. */
  streetOrientation(x, y, radius = 150) {
    const hist = new Array(90).fill(0);
    let total = 0;
    for (const { t, p } of this.roads) {
      if (SKIP_ROADS.has(t)) continue;
      for (let k = 0; k < p.length - 1; k++) {
        const a = p[k];
        const b = p[k + 1];
        if (Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y) > radius) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) continue;
        hist[Math.trunc(bearingMod90(a, b)) % 90] += L;
        total += L;
      }
    }
    if (total <= 0) return [null, 0, 0];
    const sm = hist.map((_, i) => {
      let s = 0;
      for (let d = -3; d <= 3; d++) s += hist[mod(i + d, 90)];
      return s;
    });
    let peak = 0;
    for (let i = 1; i < 90; i++) if (sm[i] > sm[peak]) peak = i;
    let sx = 0;
    let sy = 0;
    let w = 0;
    for (let d = -6; d <= 6; d++) {
      const i = mod(peak + d, 90);
      const t = rad((i + 0.5) * 4);
      sx += hist[i] * Math.cos(t);
      sy += hist[i] * Math.sin(t);
      w += hist[i];
    }
    return [mod(deg(Math.atan2(sy, sx)) / 4, 90), w / total, total];
  }

  buildingsOverlapping(poly) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const out = [];
    this.buildings.forEach((b, k) => {
      if (b.box[2] < box[0] || b.box[0] > box[2] || b.box[3] < box[1] || b.box[1] > box[3]) return;
      if (polysOverlap(poly, b)) out.push(k);
    });
    return out;
  }
}

/** Vector shore/water outlines from a raw Overpass XML file (as osm_geo._load_osm), local metres. */
export function waterLinesFromXml(path, fx) {
  const xml = readFileSync(path, 'utf8');
  const nodes = new Map();
  for (const m of xml.matchAll(/<node\s[^>]*?id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g))
    nodes.set(m[1], fx.local(+m[3], +m[2]));
  const ways = new Map();
  for (const m of xml.matchAll(/<way\s[^>]*?id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => r[1]);
    const tags = Object.fromEntries(
      [...m[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)].map((t) => [t[1], t[2]]),
    );
    ways.set(m[1], { refs, tags });
  }
  const lines = [];
  const points = (refs) => refs.filter((r) => nodes.has(r)).map((r) => nodes.get(r));
  for (const { refs, tags } of ways.values()) {
    const water =
      ['coastline', 'water', 'wetland'].includes(tags.natural) ||
      ['reservoir', 'basin'].includes(tags.landuse) ||
      tags.waterway === 'riverbank';
    if (!water) continue;
    const ps = points(refs);
    if (ps.length >= 2) lines.push([tags.natural || tags.landuse || 'water', ps]);
  }
  for (const m of xml.matchAll(/<relation\s[^>]*>([\s\S]*?)<\/relation>/g)) {
    const tags = Object.fromEntries(
      [...m[1].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)].map((t) => [t[1], t[2]]),
    );
    if (tags.type !== 'multipolygon' || !['water', 'wetland'].includes(tags.natural)) continue;
    for (const r of m[1].matchAll(/<member type="way" ref="(\d+)"/g)) {
      const w = ways.get(r[1]);
      const ps = w ? points(w.refs) : [];
      if (ps.length >= 2) lines.push([tags.natural, ps]);
    }
  }
  return lines;
}
