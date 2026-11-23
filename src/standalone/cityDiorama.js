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
  waterField,
  levelWater,
} from '../data/cityDioramaMesh.js';
import { plotFromId } from '../data/cityPlot.js';
import { cityLocation } from '../data/cityLocations.js';

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
// Data: public/city-diorama/*.osm.json (c) OpenStreetMap contributors, ODbL
// 1.0 (credited on screen, linked to openstreetmap.org/copyright; see
// public/city-diorama/README.md). Ground heights: Cesium World Terrain,
// sampled from ion when the diorama mounts and kept in memory only. The ion
// terms do not allow storing sampled heights (Cesium ion ToS 2.2.2), so the
// repo ships none, and terrain and OSM data never share a file.

// dio=fx:r700 picks the wider fixture (OSM within 760 m); terrain is live for both
const FIXTURES = {
  r520: '/city-diorama/north-beach.osm.json',
  r700: '/city-diorama/north-beach-r700.osm.json',
};
const TEX = 2048;
const CUT_SIDES = 72;

const LIGHT_FS = /* glsl */ `
float lookHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lookNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lookHash(i), lookHash(i + vec2(1.0, 0.0)), u.x), mix(lookHash(i + vec2(0.0, 1.0)), lookHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 p = fsInput.attributes.positionMC;
  bool isGround = fsInput.attributes.color_0.a < 0.75;
  if (!isGround && p.x > u_hole.x && p.x < u_hole.z && p.y > u_hole.y && p.y < u_hole.w) discard;
  // exp/city-loop-v3: the concept drape's plot is cleared too (the drape lies on this ground)
  if (!isGround && p.x > u_hole2.x && p.x < u_hole2.z && p.y > u_hole2.y && p.y < u_hole2.w) discard;
  vec3 n = normalize(fsInput.attributes.normalEC);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize((czm_view * vec4(u_keyWC, 0.0)).xyz);
  vec3 U = normalize((czm_view * vec4(u_upWC, 0.0)).xyz);
  float ndl = dot(n, L);
  // soft wrapped key, two-step toon edge kept gentle
  float key = smoothstep(-0.05, 0.6, ndl);
  float hemi = dot(n, U) * 0.5 + 0.5;
  vec3 amb = mix(u_groundAmb, u_skyAmb, hemi) * u_ambient;
  // look pass A (u_tex): surface texture by vertex tag (colour alpha): 0.9 crowns, 0.85 roofs, 0.8 rocks; ground water
  if (u_tex > 0.5) {
    float tag = fsInput.attributes.color_0.a;
    vec3 d = material.diffuse;
    if (tag > 0.875 && tag < 0.95) {
      // leaf clumps: two octaves of noise, brighter where the key hits
      float nl = 0.65 * lookNoise(p.xy * 1.7 + p.z * 1.3) + 0.35 * lookNoise(p.yz * 3.9 + p.x * 2.1);
      material.diffuse = d * mix(0.74, 1.2, nl) * (1.0 + 0.18 * smoothstep(0.35, 0.9, ndl) * step(0.62, nl));
    } else if (tag > 0.825 && tag <= 0.875) {
      // roof tiles: rows along the slope, per-tile tone
      float row = fract(p.z * 1.5);
      float tile = lookHash(floor(vec2((p.x + p.y) * 1.1 + floor(p.z * 1.5) * 0.5, p.z * 1.5)));
      material.diffuse = d * (0.72 + 0.28 * smoothstep(0.0, 0.25, row)) * (0.9 + 0.2 * tile);
    } else if (tag > 0.775 && tag <= 0.825) {
      material.diffuse = d * (0.82 + 0.3 * lookNoise(p.xy * 4.0 + p.z * 3.0));
    } else if (isGround && d.g > d.r * 1.5 && d.b > d.r * 1.5) {
      // water: fine ripples, stretched along the bay
      float w = lookNoise(vec2(p.x * 0.35 + p.y * 0.15, p.y * 1.4 - p.x * 0.3));
      float w2 = lookNoise(vec2(p.x * 0.9, p.y * 2.6) + 7.0);
      material.diffuse = d * (0.9 + 0.16 * w + 0.12 * smoothstep(0.72, 0.95, w2));
    }
  }
  vec3 c = material.diffuse * (amb + u_keyColor * key * u_key);
  // look pass A grade: warm highs, slightly cooler deep shadows, a touch more contrast
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 graded = mix(c * vec3(0.96, 1.0, 1.06), c * vec3(1.06, 1.0, 0.96), smoothstep(0.02, 0.25, lum));
  material.diffuse = mix(c, graded, u_grade);
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
uniform float warm;
uniform vec3 mistColor;
uniform vec3 eastEC;
uniform vec3 northEC;
uniform float bank;
uniform float bankW;
uniform float bankFar;
uniform float match;
uniform float bankIn;
uniform float matchCell;

// exp/city-loop-v3 seam trials: value noise on the district's ground plane (metres)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}

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
  vec2 gp = vec2(0.0);
  if (raw < 1.0) {
    // as Cesium's DepthOfField stage: depth -> eye space, compared in eye space
    float depth = czm_readDepth(depthTexture, uv);
    vec4 eye = czm_inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    eye /= eye.w;
    vec3 v = eye.xyz - centreEC;
    v -= dot(v, upEC) * upEC;
    dist = length(v);
    gp = vec2(dot(v, eastEC), dot(v, northEC));
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
  if (t <= 0.001 && m <= 0.001 && (bank <= 0.001 || dist < 0.0)) { out_FragColor = src; return; }
  vec3 b = softened(uv, 1.0 + 2.5 * t);
  float l = dot(b, vec3(0.299, 0.587, 0.114));
  // warm = 0: grey haze (desaturate + fog). warm = 1: the context takes the
  // diorama's key instead: a little more chroma, warm highs, teal-green lows.
  vec3 g = mix(b, vec3(l), mix(0.35, -0.25, warm) * t);
  g *= mix(vec3(1.02, 1.04, 0.98), vec3(1.06, 1.03, 0.9), warm);
  g = mix(g, g * vec3(0.86, 1.0, 0.96) + vec3(0.0, 0.025, 0.02), warm * (1.0 - smoothstep(0.2, 0.6, l)));
  g = mix(g, fogColor, fog * t);
  vec3 outc = mix(src.rgb, g, t);
  // (c) painterly palette match: the context's surfaces take the diorama's
  // palette by class (vegetation, water, built), keeping the photo's light.
  if (match > 0.001 && t > 0.001) {
    float bl = dot(b, vec3(0.299, 0.587, 0.114));
    float pl = floor(bl * 5.0 + 0.5) / 5.0;
    float lum = mix(bl, pl, 0.5);
    float veg = smoothstep(0.0, 0.05, b.g - max(b.r, b.b));
    float wat = smoothstep(0.015, 0.07, b.b - b.r) * (1.0 - smoothstep(0.45, 0.7, bl)) * (1.0 - veg);
    float blt = max(0.0, 1.0 - veg - wat);
    vec3 vegC = mix(vec3(0.08, 0.26, 0.04), vec3(0.24, 0.52, 0.08), smoothstep(0.1, 0.6, lum));
    vec3 watC = vec3(0.05, 0.46, 0.43) * (0.7 + 0.6 * lum);
    float h = hash12(floor(gp / max(matchCell, 1.0)));
    // the diorama's 'mix' share: cream walls and pale streets, slate, terracotta, moss
    vec3 roof = h < 0.30 ? vec3(0.43, 0.10, 0.05) : h < 0.55 ? vec3(0.16, 0.20, 0.25) : h < 0.85 ? vec3(0.78, 0.68, 0.48) : vec3(0.21, 0.27, 0.06);
    // bright, flat surfaces (streets, plazas) take the diorama's dirt-cream ground
    roof = mix(roof, vec3(0.70, 0.55, 0.33), smoothstep(0.55, 0.8, bl));
    vec3 bltC = roof * (0.55 + 0.9 * lum);
    vec3 pal = veg * vegC + wat * watC + blt * bltC;
    outc = mix(outc, pal, clamp(match * t, 0.0, 1.0));
  }
  outc = mix(outc, mistColor, clamp(m, 0.0, 1.0));
  // (b) map edge: a cloud bank rings the raised district and hides where it ends
  if (bank > 0.001 && dist >= 0.0) {
    float edge = dist - cutR;
    float ring = smoothstep(bankIn, bankIn + 70.0, edge) * (bankFar + (1.0 - bankFar) * exp(-pow(max(edge - bankIn - 70.0, 0.0) / max(bankW, 1.0), 2.0)));
    float n = fbm(gp / 140.0);
    float n2 = fbm(gp / 55.0 + 3.7);
    // puffy: a soft threshold on the noise gives cloud tops with gaps, not an even haze
    float puff = smoothstep(0.28, 0.62, n + 0.3 * (n2 - 0.5));
    float dens = clamp(ring * mix(0.35, 1.0, puff) * 1.25, 0.0, 1.0);
    vec3 cloud = mix(vec3(0.74, 0.80, 0.88), vec3(1.0, 0.98, 0.94), smoothstep(0.35, 0.8, n2 * 0.6 + puff * 0.5));
    outc = mix(outc, cloud, clamp(dens * bank, 0.0, 1.0));
  }
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

// ---------- (exp/city-loop-v3, seam trial b) earth skirt wall around the disc
const SKIRT_BANDS = [
  // [depth from the top as a share of the wall, sRGB colour]
  [0.0, '#6aa53d'],
  [0.04, '#5d8f35'],
  [0.08, '#8a6440'],
  [0.45, '#6e4a30'],
  [1.0, '#3f2c1f'],
];
function addSkirt(soup, gz, R, depth, sides = 180) {
  const lin = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  let tris = 0;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const [x0, y0, x1, y1] = [Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R];
    const am = (a0 + a1) / 2;
    const nx = Math.cos(am);
    const ny = Math.sin(am);
    const top0 = gz(x0, y0) + 0.3;
    const top1 = gz(x1, y1) + 0.3;
    for (let b = 0; b + 1 < SKIRT_BANDS.length; b++) {
      const [s0, c0] = SKIRT_BANDS[b];
      const [s1, c1] = SKIRT_BANDS[b + 1];
      // a slightly ragged lower edge per band, so the wall reads as earth, not a pipe
      const j = (k) => (b ? 0.6 * Math.sin(k * 7.3 + b * 1.9) : 0);
      const qa = [x0, y0, top0 - depth * s0 + j(i)];
      const qb = [x1, y1, top1 - depth * s0 + j(i + 1)];
      const qc = [x1, y1, top1 - depth * s1 + j(i + 1)];
      const qd = [x0, y0, top0 - depth * s1 + j(i)];
      const ca = lin(c0);
      const cb = lin(c1);
      for (const [p, c] of [[qa, ca], [qb, ca], [qc, cb], [qa, ca], [qc, cb], [qd, cb]]) {
        soup.p.push(...p);
        soup.n.push(nx, ny, 0);
        soup.c.push(...c, 1);
      }
      tris += 2;
    }
  }
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
  // base grass with painted noise (look pass A: warmer olive meadow greens)
  const lush = o.grass > 0;
  g.fillStyle = lush ? '#7a9c3a' : '#6aa53d';
  g.fillRect(0, 0, TEX, TEX);
  const greens = lush
    ? ['#86a640', '#6a8c32', '#94b04a', '#a8b652', '#5c7e2e', '#7f9a38']
    : ['#78b446', '#5d9937', '#86bf4e', '#9cc659', '#4f8c34', '#70ab40'];
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
      g.fillStyle = o.waterTone > 0 ? '#44a4ac' : '#3fb7b0';
      path(a.p, true);
      g.fill();
      continue;
    }
    g.fillStyle = lush ? '#86a83e' : '#7dbd47';
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
  // look pass A: painterly grass strokes and wildflower flecks over all open ground
  if (lush) {
    const rg = prng(11); // own stream: the ground marks after this keep their places
    const blades = ['#5a7a2a', '#9fb84e', '#6f9032', '#b5c060', '#4e6e26'];
    for (let i = 0; i < 60000; i++) {
      const x = rg() * TEX;
      const y = rg() * TEX;
      const L = (0.6 + rg() * 1.4) * s;
      const a = -1.2 + rg() * 0.5;
      g.globalAlpha = 0.18 + rg() * 0.22;
      g.strokeStyle = blades[Math.floor(rg() * blades.length)];
      g.lineWidth = Math.max(1, 0.35 * s);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.stroke();
    }
    const wild = ['#f6f0dc', '#f2d35a', '#e9a3c4', '#b79ad9', '#f4a25a', '#ffffff'];
    for (let i = 0; i < 9000; i++) {
      const cx = rg() * TEX;
      const cy = rg() * TEX;
      g.fillStyle = wild[Math.floor(rg() * wild.length)];
      const nk = 2 + Math.floor(rg() * 5);
      for (let k = 0; k < nk; k++) {
        g.globalAlpha = 0.7 + rg() * 0.3;
        g.beginPath();
        g.arc(cx + (rg() - 0.5) * 4 * s, cy + (rg() - 0.5) * 4 * s, (0.22 + rg() * 0.25) * s, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  // exp/city-loc-green: water from the fixture raster (sea rebuilt from the coastline, lakes,
  // rivers): a pale shore halo, then soft-edged turquoise, then a deeper middle
  const wf = waterField(fixture);
  if (wf) {
    // cells at least `depth` cells from the shore (negative: grown onto the shore), as merged row runs
    const layer = (color, depth) => {
      const m = new OffscreenCanvas(TEX, TEX);
      const q = m.getContext('2d');
      q.fillStyle = color;
      const grow = Math.max(0, -depth) * wf.cell * s;
      for (let row = 0; row < wf.n; row++) {
        const yTop = wf.half - row * wf.cell;
        let start = -1;
        for (let col = 0; col <= wf.n; col++) {
          const k = row * wf.n + col;
          const on = col < wf.n && wf.ids[k] > 0 && wf.dist[k] >= Math.max(0, depth);
          if (on && start < 0) start = col;
          if (!on && start >= 0) {
            const x0 = -wf.half + start * wf.cell;
            q.fillRect(X(x0) - grow, Y(yTop) - grow, (col - start) * wf.cell * s + 2 * grow, wf.cell * s + 2 * grow);
            start = -1;
          }
        }
      }
      return m;
    };
    const deep = o.waterTone > 0;
    g.save();
    g.filter = `blur(${(3 * s).toFixed(1)}px)`;
    g.globalAlpha = 0.75;
    // look pass A: a grassy verge, not a pale halo, where land meets the water
    g.drawImage(layer(lush ? '#6f8e34' : '#d8e6b8', -1), 0, 0);
    g.globalAlpha = 1;
    g.filter = `blur(${(1.2 * s).toFixed(1)}px)`;
    g.drawImage(layer(deep ? '#48a8b2' : '#4cc3c0', 0), 0, 0);
    g.filter = `blur(${(10 * s).toFixed(1)}px)`;
    g.globalAlpha = deep ? 0.7 : 0.55;
    g.drawImage(layer(deep ? '#3590a2' : '#2f9fb0', 6), 0, 0);
    if (deep) {
      g.filter = `blur(${(18 * s).toFixed(1)}px)`;
      g.globalAlpha = 0.3;
      g.drawImage(layer('#2a7a8e', 16), 0, 0);
    }
    g.restore();
    if (o.foam > 0) {
      // soft white foam hugging the shore (water cells next to land), then sparse curled wave highlights
      const rf = prng(23);
      g.save();
      g.lineCap = 'round';
      for (let row = 1; row < wf.n - 1; row++)
        for (let col = 1; col < wf.n - 1; col++) {
          const k = row * wf.n + col;
          if (!wf.ids[k] || wf.dist[k] > 2) continue;
          const x = -wf.half + (col + rf()) * wf.cell;
          const y = wf.half - (row + rf()) * wf.cell;
          g.globalAlpha = wf.dist[k] === 1 ? 0.55 + rf() * 0.3 : 0.22 + rf() * 0.2;
          g.strokeStyle = '#eef7f2';
          g.lineWidth = Math.max(1, (0.35 + rf() * 0.45) * s);
          const a = rf() * Math.PI;
          const L = (1.2 + rf() * 2.2) * s;
          g.beginPath();
          g.arc(X(x), Y(y), L, a, a + 1.4 + rf());
          g.stroke();
        }
      for (let row = 0; row < wf.n; row++)
        for (let col = 0; col < wf.n; col++) {
          const k = row * wf.n + col;
          if (!wf.ids[k] || wf.dist[k] < 3 || rf() > 0.16) continue;
          const x = -wf.half + (col + rf()) * wf.cell;
          const y = wf.half - (row + rf()) * wf.cell;
          g.globalAlpha = 0.35 + rf() * 0.35;
          g.strokeStyle = rf() < 0.7 ? '#e6f4ef' : '#9fd6cf';
          g.lineWidth = Math.max(1, (0.3 + rf() * 0.3) * s);
          const L = (1.5 + rf() * 2.5) * s;
          const a = Math.PI * (1.05 + rf() * 0.3);
          g.beginPath();
          g.arc(X(x), Y(y), L, a, a + 0.9 + rf() * 0.6);
          g.stroke();
        }
      // foam rings where the boulders meet the water
      for (const b of built.rocks ?? []) {
        for (let q = 0; q < 2; q++) {
          g.globalAlpha = 0.5 + rf() * 0.35;
          g.strokeStyle = '#f2faf6';
          g.lineWidth = Math.max(1, (0.4 + rf() * 0.4) * s);
          const a = rf() * Math.PI * 2;
          g.beginPath();
          g.arc(X(b.x), Y(b.y), (b.r * (1.15 + 0.35 * q) + 0.3) * s, a, a + 2.2 + rf() * 2.5);
          g.stroke();
        }
      }
      g.restore();
    }
  }
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
 * Sample ground heights (Cesium World Terrain, ellipsoid heights) on a grid
 * around the centre, streamed from ion in the page. The result lives in memory
 * only: never write it to disk, a fixture or the repo (Cesium ion ToS 2.2.2).
 * `credits` are the terrain's ion attributions (Cesium, USGS, ...), which the
 * caller must show, since this provider is not attached to the globe.
 */
export async function sampleGround(_viewer, fixture, { spacing = 16, half = 640 } = {}) {
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
  // exp/city-loc-green: tiles that fail to load leave holes (NaN); resample those,
  // then fill any left from finite neighbours so the centre is never NaN
  let holes = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const bad = pts.filter((c) => !Number.isFinite(c.height));
    holes = bad.length;
    if (!bad.length) break;
    bad.forEach((c) => (c.height = 0));
    await Cesium.sampleTerrainMostDetailed(terrain, bad, true).catch(() => bad.forEach((c) => (c.height = NaN)));
  }
  let credits = [];
  try {
    credits = [...(resource.credits ?? [])];
  } catch {
    credits = [];
  }
  const heights = pts.map((c) => (Number.isFinite(c.height) ? Math.round(c.height * 100) / 100 : NaN));
  for (let pass = 0; pass < 2 * n && heights.some((h) => !Number.isFinite(h)); pass++)
    for (let k = 0; k < heights.length; k++) {
      if (Number.isFinite(heights[k])) continue;
      // west/east neighbours only within the same row; north/south anywhere in range
      const nb = [k - 1, k + 1, k - n, k + n].filter((q, m) => q >= 0 && q < heights.length && (m > 1 || Math.floor(q / n) === Math.floor(k / n)) && Number.isFinite(heights[q]));
      if (nb.length) heights[k] = nb.reduce((a, q) => a + heights[q], 0) / nb.length;
    }
  if (heights.some((h) => !Number.isFinite(h))) throw new Error('world terrain: no heights sampled');
  // Never sample the Google photoreal mesh here: its policy forbids objects
  // derived from it, so the diorama stands on Cesium World Terrain only.
  const offset = 0;
  const centre = (() => {
    const i = Math.floor(n / 2);
    return heights[i * n + i];
  })();
  const ground = {
    schema: 'gev-city-diorama-ground@1',
    source: 'Cesium World Terrain (ion asset 1) via sampleTerrainMostDetailed (ellipsoid heights), live, in memory only; nothing sampled from Google photoreal tiles',
    centreLatLon: fixture.centre,
    spacing, half, n, centre, offset,
    unsampledAfterRetries: holes,
    heights,
  };
  // not enumerable: the Credit objects stay out of any JSON view of the state
  Object.defineProperty(ground, 'credits', { value: credits, enumerable: false });
  return ground;
}

export async function mountCityDiorama({ viewer, win = globalThis.window, search = globalThis.location?.search }) {
  const scene = viewer?.scene;
  if (!scene) return { remove() {} };
  const o = dioramaOptions(search);
  const state = { options: o, ready: false, error: null, stats: null, timing: {} };
  const t0 = performance.now();
  // exp/city-loc-green: ?cityLoc=<key> picks the location's fixture (src/data/cityLocations.js);
  // exp/city-loop-v4: ?city=hero picks the hero location (Sausalito) unless cityLoc says otherwise
  const params = new URLSearchParams(search ?? '');
  const asked = params.has('cityLoc') || params.get('city') === 'hero';
  const loc = asked ? cityLocation(search) : null;
  if (asked && !loc) throw new Error(`unknown cityLoc: ${params.get('cityLoc')}`);
  const FIXTURE = loc ? loc.fixture : FIXTURES[o.fx] ?? FIXTURES.r520;
  const fixture = await fetch(FIXTURE).then((r) => r.json());
  state.fixture = FIXTURE;
  state.location = loc?.key ?? null;
  // Every location: Cesium World Terrain streamed from ion now, kept in memory only (never stored)
  const tb = performance.now();
  const ground = await sampleGround(viewer, fixture, { half: 900 });
  state.timing.terrainMs = Math.round(performance.now() - tb);
  state.ground = 'live:cesium-world-terrain';
  const water = waterField(fixture);
  if (water) state.water = levelWater(ground, water);
  const gz = groundSampler(ground);
  const built = buildDiorama(fixture, ground, o, state.water);
  state.timing.buildMs = Math.round(performance.now() - t0);
  const Rg = o.radius + o.groundPad;
  const gm = groundMesh(gz, Rg);
  const png = await paintGround(fixture, built, o, Rg);
  state.timing.paintMs = Math.round(performance.now() - t0 - state.timing.buildMs);
  if (o.skirt > 0) addSkirt(built.soup, gz, Rg + 2, o.skirt + o.lift);
  const bytes = glb({ ground: gm, objects: built.soup, png, protos: built.protos });
  const { lat, lon } = fixture.centre;
  const h0 = (ground?.centre ?? 0) + (ground?.offset ?? 0);
  const centreWC = Cesium.Cartesian3.fromDegrees(lon, lat, h0);
  const upWC = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(centreWC, new Cesium.Cartesian3());
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centreWC);
  const eastWC = Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(enu, Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const northWC = Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(enu, Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()), new Cesium.Cartesian3());
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
      // look pass A (o.grade): a warm late-afternoon key over cooler, lower ambient
      u_keyColor: { type: Cesium.UniformType.VEC3, value: lin(o.grade > 0 ? '#ffd9a6' : '#fff1d6') },
      u_skyAmb: { type: Cesium.UniformType.VEC3, value: lin(o.grade > 0 ? '#c4d8e8' : '#d9ecff') },
      u_groundAmb: { type: Cesium.UniformType.VEC3, value: lin(o.grade > 0 ? '#8a7a5c' : '#9d9478') },
      u_ambient: { type: Cesium.UniformType.FLOAT, value: o.grade > 0 ? o.ambient * 1.22 : o.ambient },
      u_key: { type: Cesium.UniformType.FLOAT, value: o.grade > 0 ? o.key * 1.25 : o.key },
      u_grade: { type: Cesium.UniformType.FLOAT, value: o.grade > 0 ? 1 : 0 },
      u_tex: { type: Cesium.UniformType.FLOAT, value: o.tex > 0 ? 1 : 0 },
      u_hole: { type: Cesium.UniformType.VEC4, value: new Cesium.Cartesian4(1e9, 1e9, -1e9, -1e9) },
      u_hole2: { type: Cesium.UniformType.VEC4, value: new Cesium.Cartesian4(1e9, 1e9, -1e9, -1e9) },
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
    const cyan = Cesium.Color.fromCssColorString('#2ec8e8');
    const line = [...ring, ring[0]].map(([x, y]) => at(x, y, 0.9));
    marks.entities.add({
      polyline: {
        positions: line,
        width: 9,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: cyan }),
        // where diorama houses stand in front, the outline still shows, fainter
        depthFailMaterial: new Cesium.ColorMaterialProperty(cyan.withAlpha(0.55)),
      },
    });
    marks.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ring.map(([x, y]) => at(x, y, 0.6))),
        perPositionHeight: true,
        material: cyan.withAlpha(0.22),
      },
    });
    state.mark = { plots: plots.length, box: [x0, y0, x1, y1].map((v) => Math.round(v)) };
    scene.requestRender();
  }
  let liftNow = -1;
  const liftM = new Cesium.Matrix4();
  function syncLift() {
    if (!(o.lift > 0)) return;
    const hc = (scene.camera.positionCartographic?.height ?? 0) - h0;
    const s = Math.min(1, Math.max(0, (hc - o.liftFrom) / Math.max(1, o.liftTo - o.liftFrom)));
    const lift = Math.round(o.lift * s * s * (3 - 2 * s) * 10) / 10;
    if (lift === liftNow) return;
    liftNow = lift;
    Cesium.Matrix4.multiply(enu, Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(0, 0, lift), liftM), liftM);
    model.modelMatrix = liftM;
    state.lift = lift;
    scene.requestRender();
  }
  const offLift = scene.preRender.addEventListener(syncLift);
  syncLift();
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
      fogColor: lin(o.warm > 0.5 ? '#e6e2c8' : '#cfe3dc'),
      texel: () => new Cesium.Cartesian2(1 / scene.drawingBufferWidth, 1 / scene.drawingBufferHeight),
      debug: o.debug,
      tilt: o.tilt,
      tiltY: o.tiltY,
      mist: o.mist,
      mistW: o.mistW,
      cutR: o.radius,
      warm: o.warm,
      mistColor: lin(o.warm > 0.5 ? '#dfe8c6' : '#cfe3dc'),
      eastEC: () => Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, eastWC, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
      northEC: () => Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(scene.camera.viewMatrix, northWC, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
      bank: o.bank,
      bankW: o.bankW,
      bankFar: o.bankFar,
      match: o.match,
      bankIn: o.bankIn,
      matchCell: o.matchCell,
    },
  });
  scene.postProcessStages.add(stage);
  const credit = new Cesium.Credit('District stylised from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (© OpenStreetMap contributors, ODbL) · context: Google', true);
  viewer.creditDisplay?.addStaticCredit?.(credit);
  // The sampled terrain's own attributions (Cesium ion logo, USGS and the other
  // sources ion lists): the provider is not on the globe, so CesiumJS would not
  // show them by itself. They stay in Cesium's default credit display.
  const terrainCredits = ground.credits?.length
    ? ground.credits
    : [new Cesium.Credit('Terrain: <a href="https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/" target="_blank" rel="noopener">Cesium World Terrain</a> (Cesium ion)', true)];
  for (const c of terrainCredits) viewer.creditDisplay?.addStaticCredit?.(c);
  state.terrainCredits = terrainCredits.map((c) => c.html);

  Object.assign(state, {
    ready: true,
    stats: { ...built.stats, groundTriangles: gm.idx.length / 3, glbBytes: bytes.byteLength, groundSource: state.ground },
  });
  state.timing.totalMs = Math.round(performance.now() - t0);
  scene.requestRender();
  const api = {
    state,
    model,
    stage,
    // exp/city-loop-v3: the concept drape (src/standalone/cityConceptDrape.js)
    // cannot classify onto the cut photoreal tiles inside the disc, so it lies
    // on this ground instead and the plot's houses and trees step aside.
    covers([lon2, lat2]) {
      const [x, y] = local([lon2, lat2]);
      return Math.hypot(x, y) < o.radius;
    },
    groundAt([lon2, lat2]) {
      const [x, y] = local([lon2, lat2]);
      return h0 + gz(x, y) + Math.max(0, state.lift ?? 0);
    },
    setDrapeHole(corners) {
      let b = [1e9, 1e9, -1e9, -1e9];
      if (corners?.length) {
        const pts = corners.map(local);
        b = [Math.min(...pts.map((q) => q[0])) - 1, Math.min(...pts.map((q) => q[1])) - 1, Math.max(...pts.map((q) => q[0])) + 1, Math.max(...pts.map((q) => q[1])) + 1];
      }
      shader.setUniform('u_hole2', new Cesium.Cartesian4(...b));
      state.drapeHole = corners?.length ? b.map((v) => Math.round(v)) : null;
      scene.requestRender();
    },
    remove() {
      offPre();
      offLift();
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
      for (const c of terrainCredits) viewer.creditDisplay?.removeStaticCredit?.(c);
      scene.requestRender();
    },
  };
  if (win) win.__gevDiorama = api;
  return api;
}

export { DIORAMA_DEFAULTS };
