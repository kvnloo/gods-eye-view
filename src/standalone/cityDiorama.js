import * as Cesium from 'cesium';
import {
  DIORAMA_DEFAULTS,
  buildDiorama,
  dioramaOptions,
  groundSampler,
  hexRgb,
  inPolygon,
  prng,
  roadWidth,
  shadowOf,
} from '../data/cityDioramaMesh.js';
import { plotFromId } from '../data/cityPlot.js';

// FORK-ONLY experiment (exp/city-look-diorama, city dream loop v3 arm 2):
// ?look=diorama. Inside a disc around the capture district the Google
// photoreal tiles are cut (ClippingPolygon, the same mechanism massing uses)
// and a low-poly "diorama" stands there instead: OSM footprints extruded into
// pitched-roof houses, faceted pines and broadleaf trees, a painted ground
// (grass noise, cobble/dirt streets, flower beds, soft painted shadows). One
// glTF built in the page (src/data/cityDioramaMesh.js) and drawn as one
// Cesium Model with a custom soft key + hemisphere ambient light. A depth-aware
// post stage blends the photoreal context outside the disc (haze, softening,
// palette pull) so the diorama reads as a miniature set in its city.
// Data: public/city-diorama/north-beach.osm.json (c) OpenStreetMap
// contributors, ODbL 1.0 (credited on screen); ground heights baked from
// Cesium World Terrain (public/city-diorama/north-beach.ground.json).

// dio=fx:r700 picks the wider fixture (OSM within 760 m, ground baked to 900 m)
const FIXTURES = {
  r520: ['/city-diorama/north-beach.osm.json', '/city-diorama/north-beach.ground.json'],
  r700: ['/city-diorama/north-beach-r700.osm.json', '/city-diorama/north-beach-r700.ground.json'],
};
const TEX = 2048;
const CUT_SIDES = 72;

const LIGHT_FS = /* glsl */ `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 p = fsInput.attributes.positionMC;
  bool isGround = fsInput.attributes.color_0.a < 0.75;
  if (!isGround && p.x > u_hole.x && p.x < u_hole.z && p.y > u_hole.y && p.y < u_hole.w) discard;
  vec3 n = normalize(fsInput.attributes.normalEC);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize((czm_view * vec4(u_keyWC, 0.0)).xyz);
  vec3 U = normalize((czm_view * vec4(u_upWC, 0.0)).xyz);
  float ndl = dot(n, L);
  // soft wrapped key, two-step toon edge kept gentle
  float key = smoothstep(-0.05, 0.6, ndl);
  float hemi = dot(n, U) * 0.5 + 0.5;
  vec3 amb = mix(u_groundAmb, u_skyAmb, hemi) * u_ambient;
  vec3 c = material.diffuse * (amb + u_keyColor * key * u_key);
  material.diffuse = c;
}
`;

const BLEND_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform vec3 centreEC;
uniform vec3 upEC;
uniform float r0;
uniform float r1;
uniform float fog;
uniform vec3 fogColor;
uniform vec2 texel;
uniform float debug;
uniform float tilt;
uniform float tiltY;
uniform float mist;
uniform float mistW;
uniform float cutR;

vec3 softened(vec2 uv, float k) {
  vec3 s = vec3(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
      s += texture(colorTexture, uv + vec2(float(i), float(j)) * texel * k).rgb;
  return s / 9.0;
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  float raw = texture(depthTexture, uv).r;
  float t = 1.0;
  float dist = -1.0;
  if (raw < 1.0) {
    // as Cesium's DepthOfField stage: depth -> eye space, compared in eye space
    float depth = czm_readDepth(depthTexture, uv);
    vec4 eye = czm_inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    eye /= eye.w;
    vec3 v = eye.xyz - centreEC;
    v -= dot(v, upEC) * upEC;
    dist = length(v);
    t = smoothstep(r0, r1, dist);
  }
  if (debug > 0.5) {
    out_FragColor = vec4(t, fract(max(dist, 0.0) / 100.0), raw >= 1.0 ? 1.0 : 0.0, 1.0);
    return;
  }
  // miniature lens: soften away from a horizontal focus band (all depths)
  float lens = tilt * smoothstep(0.12, 0.5, abs((1.0 - uv.y) - tiltY));
  if (lens > 0.001) src.rgb = mix(src.rgb, softened(uv, 1.0 + 3.0 * lens), clamp(lens * 1.4, 0.0, 1.0));
  // a mist bank hugging the cut: the sliced photoreal walls fade into haze
  float m = dist >= 0.0 ? mist * exp(-pow(max(dist - cutR + 8.0, 0.0) / max(mistW, 1.0), 2.0)) * step(cutR - 8.0, dist) : 0.0;
  if (t <= 0.001 && m <= 0.001) { out_FragColor = src; return; }
  vec3 b = softened(uv, 1.0 + 2.5 * t);
  float l = dot(b, vec3(0.299, 0.587, 0.114));
  vec3 g = mix(b, vec3(l), 0.35 * t);
  // pull the photo toward the diorama key: lift greens, warm built surfaces
  g *= vec3(1.02, 1.04, 0.98);
  g = mix(g, fogColor, fog * t);
  vec3 outc = mix(src.rgb, g, t);
  outc = mix(outc, fogColor, clamp(m, 0.0, 1.0));
  out_FragColor = vec4(outc, src.a);
}
`;

// ---------- glTF assembly
function pad4(n) { return (n + 3) & ~3; }

function glb({ ground, objects, png, protos }) {
  const views = [];
  const accessors = [];
  const chunks = [];
  let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const len = pad4(bytes.byteLength);
    const buf = new Uint8Array(len);
    buf.set(bytes);
    chunks.push(buf);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target && { target }) });
    offset += len;
    return views.length - 1;
  };
  const acc = (typed, type, comp, count, extra = {}) => {
    accessors.push({ bufferView: push(typed, extra.instance ? undefined : extra.index ? 34963 : 34962), componentType: comp, count, type, ...extra.acc });
    return accessors.length - 1;
  };
  const minmax = (p) => {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
    return { min: mn, max: mx };
  };
  const prims = [];
  // ground: indexed, smooth normals, uv, colour alpha 0.5 marks it
  {
    const { p, n, uv, c, idx } = ground;
    const P = acc(p, 'VEC3', 5126, p.length / 3, { acc: minmax(p) });
    const N = acc(n, 'VEC3', 5126, n.length / 3);
    const T = acc(uv, 'VEC2', 5126, uv.length / 2);
    const C = acc(c, 'VEC4', 5126, c.length / 4);
    const I = acc(idx, 'SCALAR', 5125, idx.length, { index: true });
    prims.push({ attributes: { POSITION: P, NORMAL: N, TEXCOORD_0: T, COLOR_0: C }, indices: I, material: 0 });
  }
  {
    const p = new Float32Array(objects.p);
    const P = acc(p, 'VEC3', 5126, p.length / 3, { acc: minmax(p) });
    const N = acc(new Float32Array(objects.n), 'VEC3', 5126, objects.n.length / 3);
    const C = acc(new Float32Array(objects.c), 'VEC4', 5126, objects.c.length / 4);
    prims.push({ attributes: { POSITION: P, NORMAL: N, COLOR_0: C }, material: 1 });
  }
  const meshes = [{ primitives: prims }];
  const nodes = [{ mesh: 0 }];
  for (const p of protos?.values?.() ?? []) {
    if (!p.instances.length) continue;
    const pp = new Float32Array(p.soup.p);
    const P = acc(pp, 'VEC3', 5126, pp.length / 3, { acc: minmax(pp) });
    const N = acc(new Float32Array(p.soup.n), 'VEC3', 5126, p.soup.n.length / 3);
    const C = acc(new Float32Array(p.soup.c), 'VEC4', 5126, p.soup.c.length / 4);
    meshes.push({ primitives: [{ attributes: { POSITION: P, NORMAL: N, COLOR_0: C }, material: 1 }] });
    const n = p.instances.length;
    const tr = new Float32Array(n * 3);
    const ro = new Float32Array(n * 4);
    const sc = new Float32Array(n * 3);
    p.instances.forEach(([x, y, z, k, a], i) => {
      tr.set([x, y, z], i * 3);
      ro.set([0, 0, Math.sin(a / 2), Math.cos(a / 2)], i * 4);
      sc.set([k, k, k], i * 3);
    });
    nodes.push({
      mesh: meshes.length - 1,
      extensions: {
        EXT_mesh_gpu_instancing: {
          attributes: {
            TRANSLATION: acc(tr, 'VEC3', 5126, n, { instance: true }),
            ROTATION: acc(ro, 'VEC4', 5126, n, { instance: true }),
            SCALE: acc(sc, 'VEC3', 5126, n, { instance: true }),
          },
        },
      },
    });
  }
  const imgView = push(png);
  const json = {
    asset: { version: '2.0', generator: 'gev city diorama (fork-only)' },
    ...(nodes.length > 1 && { extensionsUsed: ['EXT_mesh_gpu_instancing'], extensionsRequired: ['EXT_mesh_gpu_instancing'] }),
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: false },
      { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: imgView, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jlen = pad4(enc.byteLength);
  const total = 12 + 8 + jlen + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jlen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jlen);
  out.set(enc, 20);
  let at = 20 + jlen;
  dv.setUint32(at, offset, true);
  dv.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// ---------- ground mesh (heightfield disc)
function groundMesh(gz, R, step = 6) {
  const n = Math.ceil((2 * R) / step) + 1;
  const p = [];
  const uv = [];
  const c = [];
  const id = new Int32Array(n * n).fill(-1);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -R + i * step;
      const y = -R + j * step;
      if (Math.hypot(x, y) > R + step * 1.5) continue;
      id[j * n + i] = p.length / 3;
      p.push(x, y, gz(x, y));
      uv.push((x + R) / (2 * R), 1 - (y + R) / (2 * R));
      c.push(1, 1, 1, 0.5);
    }
  const idx = [];
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = id[j * n + i], b = id[j * n + i + 1], d = id[(j + 1) * n + i], e = id[(j + 1) * n + i + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      idx.push(a, b, e, a, e, d);
    }
  // smooth normals
  const nr = new Float32Array(p.length);
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, d] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, d]) { nr[q] += nx; nr[q + 1] += ny; nr[q + 2] += nz; }
  }
  for (let q = 0; q < nr.length; q += 3) {
    const L = Math.hypot(nr[q], nr[q + 1], nr[q + 2]) || 1;
    nr[q] /= L; nr[q + 1] /= L; nr[q + 2] /= L;
  }
  return { p: new Float32Array(p), n: nr, uv: new Float32Array(uv), c: new Float32Array(c), idx: new Uint32Array(idx) };
}

// ---------- painted ground texture
async function paintGround(fixture, built, o, R) {
  const cv = new OffscreenCanvas(TEX, TEX);
  const g = cv.getContext('2d');
  const s = TEX / (2 * R);
  const X = (x) => (x + R) * s;
  const Y = (y) => (R - y) * s;
  const r = prng(7);
  const path = (ps, close) => {
    g.beginPath();
    ps.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (close) g.closePath();
  };
  // base grass with painted noise
  g.fillStyle = '#6aa53d';
  g.fillRect(0, 0, TEX, TEX);
  const greens = ['#78b446', '#5d9937', '#86bf4e', '#9cc659', '#4f8c34', '#70ab40'];
  for (let i = 0; i < 9000; i++) {
    g.globalAlpha = 0.08 + r() * 0.12;
    g.fillStyle = greens[Math.floor(r() * greens.length)];
    const rr = (4 + r() * 22) * s;
    g.beginPath();
    g.ellipse(r() * TEX, r() * TEX, rr, rr * (0.5 + r() * 0.5), r() * 3.14, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // parks: lusher, with flower beds
  for (const a of fixture.areas ?? []) {
    if (a.k === 'water') {
      g.fillStyle = '#3fb7b0';
      path(a.p, true);
      g.fill();
      continue;
    }
    g.fillStyle = '#7dbd47';
    path(a.p, true);
    g.fill();
  }
  const flowers = ['#f4f1e4', '#f7f3ea', '#b49ad8', '#e7a1c0', '#f0d264', '#9d86d0'];
  for (const a of fixture.areas ?? []) {
    if (a.k === 'water') continue;
    const xs = a.p.map((p) => p[0]);
    const ys = a.p.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const n = Math.min(250, Math.round(((x1 - x0) * (y1 - y0)) / 120));
    for (let i = 0; i < n; i++) {
      const cx = x0 + r() * (x1 - x0);
      const cy = y0 + r() * (y1 - y0);
      if (!inPolygon([cx, cy], a.p)) continue;
      const col = flowers[Math.floor(r() * flowers.length)];
      g.fillStyle = col;
      for (let k = 0; k < 7; k++) {
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(X(cx + (r() - 0.5) * 5), Y(cy + (r() - 0.5) * 5), (0.25 + r() * 0.35) * s, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;
  // streets
  const cob = o.roads === 'dirt'
    ? { edge: '#a8834f', mid: '#cfab72', fleck: '#e2c48e' }
    : { edge: '#a39a86', mid: '#cfc4a8', fleck: '#e4dcc6' };
  const byWidth = [...(fixture.roads ?? [])].filter((rd) => roadWidth(rd.t)).sort((a, b) => roadWidth(b.t) - roadWidth(a.t));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const pass of ['edge', 'mid']) {
    for (const rd of byWidth) {
      const w = roadWidth(rd.t);
      const narrow = w < 3;
      g.strokeStyle = narrow ? (pass === 'edge' ? '#b48d58' : '#d8b67c') : cob[pass];
      g.lineWidth = (pass === 'edge' ? w * o.roadW + 1.2 : w * o.roadW) * s;
      path(rd.p, false);
      g.stroke();
    }
  }
  // cobble flecks along wide streets
  for (const seg of built.roads) {
    if (seg.w < 4) continue;
    const L = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
    const n = Math.round(L * seg.w * o.roadW * 0.12);
    g.fillStyle = cob.fleck;
    for (let i = 0; i < n; i++) {
      const t = r();
      const off = (r() - 0.5) * seg.w * o.roadW * 0.85;
      const dx = (seg.b[0] - seg.a[0]) / (L || 1);
      const dy = (seg.b[1] - seg.a[1]) / (L || 1);
      const x = seg.a[0] + (seg.b[0] - seg.a[0]) * t - dy * off;
      const y = seg.a[1] + (seg.b[1] - seg.a[1]) * t + dx * off;
      g.globalAlpha = 0.35;
      g.fillRect(X(x), Y(y), 0.5 * s, 0.4 * s);
    }
  }
  g.globalAlpha = 1;
  // earth under houses
  g.fillStyle = '#6e5d43';
  for (const h of built.houses) {
    path(h.corners, true);
    g.fill();
  }
  // soft painted shadows: drawn hard on their own layer, blurred once, multiplied in
  const sh = new OffscreenCanvas(TEX, TEX);
  const q = sh.getContext('2d');
  q.fillStyle = '#ffffff';
  q.fillRect(0, 0, TEX, TEX);
  const qpath = (ps) => {
    q.beginPath();
    ps.forEach(([x, y], i) => (i ? q.lineTo(X(x), Y(y)) : q.moveTo(X(x), Y(y))));
    q.closePath();
  };
  const tone = (a) => `rgb(${Math.round(255 - (255 - 52) * a)}, ${Math.round(255 - (255 - 72) * a)}, ${Math.round(255 - (255 - 92) * a)})`;
  q.fillStyle = tone(o.shade);
  for (const h of built.houses) {
    qpath(shadowOf(h.corners, h.height, o.sunAz, o.sunEl));
    q.fill();
  }
  const az = (o.sunAz * Math.PI) / 180;
  const k = 1 / Math.tan((Math.max(8, o.sunEl) * Math.PI) / 180);
  for (const t of built.trees) {
    const d = t.h * 0.6 * k;
    q.beginPath();
    q.ellipse(X(t.x - Math.sin(az) * d), Y(t.y - Math.cos(az) * d), t.r * s * 1.05, t.r * s * 0.85, -az, 0, Math.PI * 2);
    q.fill();
  }
  // contact darkening (cheap AO) right at house feet
  q.strokeStyle = tone(Math.min(1, o.shade * 1.6));
  q.lineWidth = 1.4 * s;
  for (const h of built.houses) {
    qpath(h.corners);
    q.stroke();
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.filter = `blur(${Math.max(1, 1.4 * s).toFixed(1)}px)`;
  g.drawImage(sh, 0, 0);
  g.restore();
  // edge feather toward the haze colour so the disc never ends hard
  const grad = g.createRadialGradient(TEX / 2, TEX / 2, TEX * 0.47, TEX / 2, TEX / 2, TEX * 0.5);
  grad.addColorStop(0, 'rgba(160, 190, 170, 0)');
  grad.addColorStop(1, 'rgba(160, 190, 170, 0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX, TEX);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function tilesets(scene) {
  const out = [];
  const p = scene.primitives;
  for (let i = 0; i < p.length; i++) {
    const x = p.get(i);
    if (x instanceof Cesium.Cesium3DTileset && x.show && !x.isDestroyed()) out.push(x);
  }
  return out;
}

/**
 * Bake ground heights (Cesium World Terrain, ellipsoid heights) on a grid
 * around the centre. Run once in the page; the result is the ground fixture.
 */
export async function bakeGround(_viewer, fixture, { spacing = 16, half = 640 } = {}) {
  const { lat, lon } = fixture.centre;
  const M = 111_320;
  const kx = M * Math.cos((lat * Math.PI) / 180);
  const n = Math.round((2 * half) / spacing) + 1;
  const carto = (x, y) => Cesium.Cartographic.fromDegrees(lon + x / kx, lat + y / M);
  const pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(carto(-half + i * spacing, -half + j * spacing));
  // The app's own ion token (the one Google photoreal already uses), never logged.
  const accessToken = String(import.meta.env?.CESIUM_ION_TOKEN ?? '').trim();
  if (!accessToken) throw new Error('world terrain: no ion token in this build');
  const resource = await Cesium.IonResource.fromAssetId(1, { accessToken });
  const terrain = await Cesium.CesiumTerrainProvider.fromUrl(resource, { ellipsoid: Cesium.Ellipsoid.WGS84 });
  await Cesium.sampleTerrainMostDetailed(terrain, pts);
  const heights = pts.map((c) => Math.round(c.height * 100) / 100);
  // Never sample the Google photoreal mesh here: its policy forbids objects
  // derived from it, so the diorama stands on Cesium World Terrain only.
  const offset = 0;
  const centre = (() => {
    const i = Math.floor(n / 2);
    return heights[i * n + i];
  })();
  return {
    schema: 'gev-city-diorama-ground@1',
    source: 'Cesium World Terrain (ion asset 1) via sampleTerrainMostDetailed (ellipsoid heights); nothing sampled from Google photoreal tiles',
    centreLatLon: fixture.centre,
    spacing, half, n, centre, offset,
    heights,
  };
}

export async function mountCityDiorama({ viewer, win = globalThis.window, search = globalThis.location?.search }) {
  const scene = viewer?.scene;
  if (!scene) return { remove() {} };
  const o = dioramaOptions(search);
  const state = { options: o, ready: false, error: null, stats: null, timing: {} };
  const t0 = performance.now();
  const [FIXTURE, GROUND] = FIXTURES[o.fx] ?? FIXTURES.r520;
  const [fixture, ground] = await Promise.all([
    fetch(FIXTURE).then((r) => r.json()),
    fetch(GROUND).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  state.fixture = FIXTURE;
  const gz = groundSampler(ground);
  const built = buildDiorama(fixture, ground, o);
  state.timing.buildMs = Math.round(performance.now() - t0);
  const Rg = o.radius + o.groundPad;
  const gm = groundMesh(gz, Rg);
  const png = await paintGround(fixture, built, o, Rg);
  state.timing.paintMs = Math.round(performance.now() - t0 - state.timing.buildMs);
  const bytes = glb({ ground: gm, objects: built.soup, png, protos: built.protos });
  const { lat, lon } = fixture.centre;
  const h0 = (ground?.centre ?? 0) + (ground?.offset ?? 0);
  const centreWC = Cesium.Cartesian3.fromDegrees(lon, lat, h0);
  const upWC = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(centreWC, new Cesium.Cartesian3());
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centreWC);
  const az = (o.sunAz * Math.PI) / 180;
  const el = (o.sunEl * Math.PI) / 180;
  const keyENU = new Cesium.Cartesian3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  const keyWC = Cesium.Matrix4.multiplyByPointAsVector(enu, keyENU, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(keyWC, keyWC);
  const lin = (hex) => {
    const [r, g, b] = hexRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return new Cesium.Cartesian3(r, g, b);
  };
  const shader = new Cesium.CustomShader({
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms: {
      u_keyWC: { type: Cesium.UniformType.VEC3, value: keyWC },
      u_upWC: { type: Cesium.UniformType.VEC3, value: upWC },
      u_keyColor: { type: Cesium.UniformType.VEC3, value: lin('#fff1d6') },
      u_skyAmb: { type: Cesium.UniformType.VEC3, value: lin('#d9ecff') },
      u_groundAmb: { type: Cesium.UniformType.VEC3, value: lin('#9d9478') },
      u_ambient: { type: Cesium.UniformType.FLOAT, value: o.ambient },
      u_key: { type: Cesium.UniformType.FLOAT, value: o.key },
      u_hole: { type: Cesium.UniformType.VEC4, value: new Cesium.Cartesian4(1e9, 1e9, -1e9, -1e9) },
    },
    fragmentShaderText: LIGHT_FS,
  });
  const model = await Cesium.Model.fromGltfAsync({
    gltf: bytes,
    modelMatrix: enu,
    upAxis: Cesium.Axis.Z,
    forwardAxis: Cesium.Axis.X,
    customShader: shader,
    shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    backFaceCulling: true,
    allowPicking: true,
  });
  scene.primitives.add(model);

  // the cut: a disc on every shown photoreal tileset, kept as tilesets come and go
  const disc = Array.from({ length: CUT_SIDES }, (_, i) => {
    const t = (i / CUT_SIDES) * Math.PI * 2;
    const x = Math.cos(t) * o.radius;
    const y = Math.sin(t) * o.radius;
    return Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), new Cesium.Cartesian3());
  });
  const cuts = new Map();
  const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
  function syncCut() {
    if (!Cesium.ClippingPolygonCollection.isSupported(scene)) return;
    for (const ts of tilesets(scene)) {
      if (cuts.has(ts)) continue;
      const created = !ts.clippingPolygons;
      if (created) ts.clippingPolygons = new Cesium.ClippingPolygonCollection();
      const polygon = ts.clippingPolygons.add(new Cesium.ClippingPolygon({ positions: disc }));
      cuts.set(ts, { polygon, created });
    }
    // holes: any other clipping polygon (massing cuts its plots) also hides the diorama's houses/trees there
    let hole = [1e9, 1e9, -1e9, -1e9];
    for (const [ts, { polygon }] of cuts) {
      if (ts.isDestroyed()) { cuts.delete(ts); continue; }
      const col = ts.clippingPolygons;
      for (let i = 0; i < (col?.length ?? 0); i++) {
        const pg = col.get(i);
        if (pg === polygon) continue;
        for (const pw of pg.positions) {
          const pl = Cesium.Matrix4.multiplyByPoint(inv, pw, new Cesium.Cartesian3());
          hole = [Math.min(hole[0], pl.x), Math.min(hole[1], pl.y), Math.max(hole[2], pl.x), Math.max(hole[3], pl.y)];
        }
      }
    }
    const u = shader.uniforms.u_hole.value;
    if (u.x !== hole[0] || u.y !== hole[1] || u.z !== hole[2] || u.w !== hole[3]) {
      shader.setUniform('u_hole', new Cesium.Cartesian4(...hole));
      state.hole = hole;
    }
  }
  // Play mode drapes its selection ghost on terrain / 3D tiles, never on a
  // model, so on the diorama the selected plot (or district) gets its own
  // cyan outline and soft fill, standing on the diorama's ground.
  const marks = new Cesium.CustomDataSource('gev-city-diorama-marks');
  viewer.dataSources.add(marks);
  const M = 111_320;
  const kx = M * Math.cos((lat * Math.PI) / 180);
  const local = ([lo, la]) => [(lo - lon) * kx, (la - lat) * M];
  const at = (x, y, up) => Cesium.Cartesian3.fromDegrees(lon + x / kx, lat + y / M, h0 + gz(x, y) + up);
  let markKey = '';
  function syncMark() {
    let snap = null;
    try {
      snap = win?.__gevCityPlay?.snapshot?.() ?? null;
    } catch {
      snap = null;
    }
    const ids = snap?.district?.length ? snap.district.map((d) => d?.id ?? d) : snap?.plot?.id ? [snap.plot.id] : [];
    const key = ids.join(',');
    if (key === markKey) return;
    markKey = key;
    marks.entities.removeAll();
    const plots = ids.map((id) => (typeof id === 'string' ? plotFromId(id) : null)).filter(Boolean);
    if (!plots.length) return scene.requestRender();
    const pts = plots.flatMap((pl) => pl.corners.map(local));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const ring = [];
    const edge = (ax, ay, bx, by) => {
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let i = 0; i < n; i++) ring.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    };
    edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
    const line = [...ring, ring[0]].map(([x, y]) => at(x, y, 0.9));
    marks.entities.add({
      polyline: {
        positions: line,
        width: 6,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString('#2ec8e8') }),
      },
    });
    marks.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ring.map(([x, y]) => at(x, y, 0.6))),
        perPositionHeight: true,
        material: Cesium.Color.fromCssColorString('#2ec8e8').withAlpha(0.16),
      },
    });
    state.mark = { plots: plots.length, box: [x0, y0, x1, y1].map((v) => Math.round(v)) };
    scene.requestRender();
  }
  let last = 0;
  const offPre = scene.preUpdate.addEventListener(() => {
    const now = performance.now();
    if (now - last < 500) return;
    last = now;
    syncCut();
    syncMark();
  });
  syncCut();

  const stage = new Cesium.PostProcessStage({
    name: 'gev_diorama_blend',
    fragmentShader: BLEND_FS,
    uniforms: {
      centreEC: () => Cesium.Matrix4.multiplyByPoint(scene.camera.viewMatrix, centreWC, new Cesium.Cartesian3()),
      upEC: () => Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, upWC, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
      r0: o.ringIn,
      r1: o.ringOut,
      fog: o.fog,
      fogColor: lin('#cfe3dc'),
      texel: () => new Cesium.Cartesian2(1 / scene.drawingBufferWidth, 1 / scene.drawingBufferHeight),
      debug: o.debug,
      tilt: o.tilt,
      tiltY: o.tiltY,
      mist: o.mist,
      mistW: o.mistW,
      cutR: o.radius,
    },
  });
  scene.postProcessStages.add(stage);
  const credit = new Cesium.Credit('District stylised from OpenStreetMap (© OpenStreetMap contributors, ODbL) · context: Google', true);
  viewer.creditDisplay?.addStaticCredit?.(credit);

  Object.assign(state, {
    ready: true,
    stats: { ...built.stats, groundTriangles: gm.idx.length / 3, glbBytes: bytes.byteLength, groundBaked: Boolean(ground?.heights) },
  });
  state.timing.totalMs = Math.round(performance.now() - t0);
  scene.requestRender();
  const api = {
    state,
    model,
    stage,
    remove() {
      offPre();
      for (const [ts, { polygon, created }] of cuts) {
        if (ts.isDestroyed()) continue;
        ts.clippingPolygons?.remove(polygon);
        if (created && ts.clippingPolygons?.length === 0) ts.clippingPolygons = undefined;
      }
      cuts.clear();
      viewer.dataSources.remove(marks, true);
      scene.primitives.remove(model);
      scene.postProcessStages.remove(stage);
      viewer.creditDisplay?.removeStaticCredit?.(credit);
      scene.requestRender();
    },
  };
  if (win) win.__gevDiorama = api;
  return api;
}

export { DIORAMA_DEFAULTS };
