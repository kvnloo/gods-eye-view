import * as Cesium from 'cesium';
import { COZY2_DEFAULTS, parseLookParams } from '../data/cozyShaderParams.js';

// FORK-ONLY experiment (exp/city-look-shader, city dream loop v3, shader arm):
// "Cozy 2" stylises the Google photoreal tiles THEMSELVES instead of only
// grading the finished frame (round 1's ?look=cozy).
//
//   1 tiles: a Cesium3DTileset.customShader (MODIFY_MATERIAL, UNLIT) on every
//            shown 3D tileset (only tiles: GEV's own massing / kit / ghosts
//            are not touched). Per fragment:
//            a flatten  re-sample the tile's own base-colour texture with a
//                       mip bias plus a texel ring, so photo noise becomes
//                       flat patches (texture space: no shimmer);
//            b classify flat normal from derivatives of positionEC (Google
//                       tiles carry no NORMAL, so fsInput normalEC is only a
//                       default), local up from positionWC: roof/ground vs
//                       wall; vegetation by excess green; water by blue excess;
//                       neutrals (roof, street, wall) by low chroma;
//            c palette  two blended paths: a hue remap that keeps the photo's
//                       luminance (vivid greens, teal water, warm terracotta,
//                       cream on greys) and a de-lit class palette from the
//                       wintercats refs (swaps the photo's luminance, which
//                       holds Google's baked shadows) with a little photo
//                       detail kept; `delight` mixes them;
//            d light    soft-banded wrap-Lambert from czm_lightDirectionEC,
//                       lilac shadow -> warm key (never black).
//   2 post:  depth-aware Kuwahara (radius grows with true eye distance), then
//            a finish stage: tilt-shift (screen band and/or depth circle of
//            confusion focused on the screen centre), threshold glow with a
//            hard clamp, distance haze, saturation / contrast / exposure.
//            No ambient occlusion (Cesium's HBAO blackened the photoreal frame
//            under SwiftShader in round 0) and no vignette by default.
//
// API names verified against CesiumJS 1.138 (@cesium/engine 22.3.0) and the
// loop-v3 research report: Cesium3DTileset.customShader, CustomShader,
// CustomShaderMode.MODIFY_MATERIAL, LightingModel.UNLIT, UniformType,
// setUniform (no rebuild), fsInput.attributes.positionEC/positionWC,
// czm_lightDirectionEC, czm_viewRotation; internal material names
// u_baseColorTexture / TEXCOORD_BASE_COLOR / HAS_BASE_COLOR_TEXTURE(_TRANSFORM)
// are #ifdef-guarded; post depth via czm_windowToEyeCoordinates(...)/w.
//
// Every parameter is a live uniform, so a search varies it without a rebuild:
//   ?look=cozy2                         defaults
//   ?look=cozy2&lk={"greenSat":1.8}     JSON overrides (URL-encoded)
//   window.__gevCozy2.set({...})        live, in the page
// `wipe` (0..1 of the width) shows the un-posted frame on the left (the tile
// shader is not wiped; set ts=0 for a full "before").

export { COZY2_DEFAULTS, parseLookParams };


const TILE_FS = /* glsl */ `
vec3 lk_hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 lk_rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float lk_band(float h, float c, float w) {
  float d = abs(fract(h - c + 0.5) - 0.5);
  return 1.0 - smoothstep(w * 0.6, w, d);
}
float lk_hmix(float h, float target, float k) {
  float d = fract(target - h + 0.5) - 0.5;
  return fract(h + d * k);
}
float lk_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_lk_ts <= 0.0) return;
  vec3 photoLin = material.diffuse;
  vec3 orig = czm_linearToSrgb(photoLin);
  vec3 col = orig;                         // sRGB working colour
#ifdef HAS_BASE_COLOR_TEXTURE
  // a flatten: mip-biased centre + texel ring of the same texture (sRGB).
  vec2 st = TEXCOORD_BASE_COLOR;
#ifdef HAS_BASE_COLOR_TEXTURE_TRANSFORM
  st = (u_baseColorTextureTransform * vec3(st, 1.0)).xy;
#endif
  vec2 r = u_lk_flatR / vec2(textureSize(u_baseColorTexture, 0));
  vec3 soft = texture(u_baseColorTexture, st, u_lk_mipBias).rgb * 2.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0471976;
    soft += texture(u_baseColorTexture, st + vec2(cos(a), sin(a)) * r, u_lk_mipBias).rgb;
  }
  soft /= 8.0;
  col = mix(col, soft, u_lk_flat);
#endif
  // b classify.
  vec3 pEC = fsInput.attributes.positionEC;
  vec3 pWC = fsInput.attributes.positionWC;
  vec3 n = normalize(cross(dFdx(pEC), dFdy(pEC)));
  if (dot(n, -pEC) < 0.0) n = -n;
  vec3 upEC = normalize(czm_viewRotation * normalize(pWC));
  float up = dot(n, upEC);
  float flatW = smoothstep(0.72, 0.92, up);
  float wallW = 1.0 - smoothstep(0.3, 0.6, up);
  vec3 a = max(czm_srgbToLinear(col), vec3(1e-4));
  float sum = a.r + a.g + a.b;
  float exg = (2.0 * a.g - a.r - a.b) / sum;
  // Hue ratios in sRGB (linear exaggerates ratios in the darks, so shaded
  // asphalt read as water). Vegetation needs green over blue: Google's bay is
  // a dark teal whose excess green alone reads as vegetation. Water is teal
  // (blue over red with green close to blue) on flat surfaces; sky-lit shade
  // is bluer than green, so it counts as neutral (wall/street + toon light).
  vec3 sc = max(col, vec3(1e-4));
  float ssum = sc.r + sc.g + sc.b;
  float gb = (sc.g - sc.b) / ssum;
  float br = (sc.b - sc.r) / ssum;
  float veg = smoothstep(u_lk_vegLo, u_lk_vegHi, exg) * smoothstep(-0.01, 0.05, gb);
  float blue = smoothstep(0.09, 0.17, br) * (1.0 - smoothstep(0.035, 0.08, abs(gb + 0.01))) * flatW * (1.0 - veg);
  float l = lk_luma(a);
  float mx = max(a.r, max(a.g, a.b));
  float chroma = (mx - min(a.r, min(a.g, a.b))) / max(mx, 1e-4);
  float neutral = (1.0 - smoothstep(0.12, 0.3, chroma)) * (1.0 - veg) * (1.0 - blue);
  float shadeBlue = smoothstep(0.0, 0.06, br) * (1.0 - veg) * (1.0 - blue);
  neutral = max(neutral, shadeBlue);

  // c1 hue remap (keeps the photo's luminance), in sRGB HSV.
  vec3 hsv = lk_hsv(clamp(col, 0.0, 1.0));
  float h = hsv.x, s = hsv.y, v = hsv.z;
  float g = max(lk_band(h, 0.27, 0.14) * smoothstep(0.05, 0.18, s), veg);
  h = mix(h, lk_hmix(h, 0.25, u_lk_hueSnap), g);
  s = mix(s, min(1.0, s * u_lk_greenSat + 0.08), g);
  v = mix(v, min(1.0, v * u_lk_greenVal + 0.03), g);
  // Water by class only (a hue band also caught sky-lit shade); shade is
  // calmed toward neutral instead of saturated.
  float w = blue;
  s = mix(s, s * 0.55, shadeBlue * (1.0 - flatW * 0.3));
  h = mix(h, lk_hmix(h, 0.5, u_lk_hueSnap), w);
  s = mix(s, min(1.0, s * u_lk_waterSat + 0.06), w);
  v = mix(v, min(1.0, v * u_lk_waterVal + 0.05), w);
  float wr = lk_band(h, 0.06, 0.09) * smoothstep(0.08, 0.25, s);
  h = mix(h, lk_hmix(h, 0.055, u_lk_hueSnap * 0.6), wr);
  s = mix(s, min(1.0, s * u_lk_warmSat), wr);
  vec3 remap = lk_rgb(vec3(fract(h), s, v));
  float grey = 1.0 - smoothstep(0.06, 0.24, hsv.y);
  remap = mix(remap, mix(remap, u_lk_wall * (0.35 + 0.75 * v), 0.55), grey * u_lk_cream * smoothstep(0.2, 0.75, v));
  remap = czm_srgbToLinear(clamp(remap, 0.0, 1.0));

  // c2 de-lit class palette (linear).
  vec3 vegC = mix(czm_srgbToLinear(u_lk_canopy), czm_srgbToLinear(u_lk_grass), flatW);
  float hc = lk_hash(floor(pWC.xy / u_lk_cellM) + floor(pWC.z / u_lk_cellM));
  vec3 roof = hc < 0.34 ? czm_srgbToLinear(u_lk_roofA) : (hc < 0.67 ? czm_srgbToLinear(u_lk_roofB) : czm_srgbToLinear(u_lk_roofC));
  roof = mix(czm_srgbToLinear(u_lk_roofC), roof, u_lk_roofVariety);
  vec3 flatNeutral = mix(czm_srgbToLinear(u_lk_street), roof, smoothstep(0.12, 0.3, l));
  vec3 neutralC = mix(czm_srgbToLinear(u_lk_wall), flatNeutral, 1.0 - wallW);
  vec3 pal = a / max(l, 1e-3) * 0.42;
  pal = mix(pal, neutralC, neutral);
  pal = mix(pal, czm_srgbToLinear(u_lk_water), blue);
  pal = mix(pal, vegC, veg);
  float det = clamp(lk_luma(max(photoLin, vec3(1e-4))) / max(l, 1e-3), 0.6, 1.5);
  pal *= mix(1.0, det, u_lk_detail);

  vec3 c = mix(remap, pal, u_lk_delight);
  // soft value posterise (hue kept).
  if (u_lk_vpost > 0.0) {
    float lq = max(lk_luma(c), 1e-4);
    float q = floor(lq * u_lk_vbands + 0.5) / u_lk_vbands;
    c = mix(c, c * (max(q, 0.5 / u_lk_vbands) / lq), u_lk_vpost);
  }
  // d soft-banded wrap Lambert, coloured shadow.
  float ndl = dot(n, czm_lightDirectionEC);
  float wl = clamp((ndl + u_lk_wrap) / (1.0 + u_lk_wrap), 0.0, 1.0);
  float b = wl * u_lk_bands;
  float toon = (floor(b) + smoothstep(0.3, 0.7, fract(b))) / u_lk_bands;
  vec3 lightC = mix(czm_srgbToLinear(u_lk_shadow), u_lk_key, toon);
  c = mix(c, c * lightC, u_lk_toon);
  if (u_lk_dbg > 1.5) c = vec3(veg, blue, neutral) * 0.8 + vec3(0.0, 0.0, 0.0);
  material.diffuse = mix(photoLin, max(c, vec3(0.0)), u_lk_ts);
}
`;

const DEPTH_GLSL = /* glsl */ `
bool lk_sky(vec2 uv) { return texture(depthTexture, uv).r >= 1.0; }
float lk_dist(vec2 uv) {
  float raw = texture(depthTexture, uv).r;
  if (raw >= 1.0) return 1.0e7;
  vec4 e = czm_windowToEyeCoordinates(uv * czm_viewport.zw + czm_viewport.xy, raw);
  return length(e.xyz / e.w);
}
`;

const PAINT_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float wipe;
uniform float kuw;
uniform float kuwNear;
uniform float kuwFar;
uniform float kuwD0;
uniform float kuwD1;
uniform vec2 texel;
${DEPTH_GLSL}
void sector(vec2 uv, vec2 dir, float rad, inout vec3 bestMean, inout float bestVar) {
  vec3 sum = vec3(0.0);
  vec3 sq = vec3(0.0);
  for (int j = 0; j <= 3; j++) {
    for (int i = 0; i <= 3; i++) {
      vec2 o = vec2(float(i), float(j)) / 3.0 * dir * rad;
      vec3 c = texture(colorTexture, uv + o * texel).rgb;
      sum += c;
      sq += c * c;
    }
  }
  vec3 mean = sum / 16.0;
  vec3 v = sq / 16.0 - mean * mean;
  float var = v.r + v.g + v.b;
  if (var < bestVar) { bestVar = var; bestMean = mean; }
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (uv.x < wipe || kuw <= 0.0) { out_FragColor = src; return; }
  float dist = lk_dist(uv);
  float rad = mix(kuwNear, kuwFar, smoothstep(kuwD0, kuwD1, min(dist, kuwD1 * 2.0)));
  vec3 best = src.rgb;
  float bestVar = 1e9;
  sector(uv, vec2(-1.0, -1.0), rad, best, bestVar);
  sector(uv, vec2(1.0, -1.0), rad, best, bestVar);
  sector(uv, vec2(-1.0, 1.0), rad, best, bestVar);
  sector(uv, vec2(1.0, 1.0), rad, best, bestVar);
  out_FragColor = vec4(mix(src.rgb, best, kuw), src.a);
}
`;

const FINISH_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float wipe;
uniform float dbg;
uniform vec2 texel;
uniform float tiltCenter;
uniform float tiltBand;
uniform float tiltBlur;
uniform float dofBlur;
uniform float focusRange;
uniform float bloom;
uniform float bloomThr;
uniform float bloomClamp;
uniform float haze;
uniform vec3 hazeCol;
uniform float hazeStart;
uniform float hazeDensity;
uniform float hazeSky;
uniform float sat;
uniform float contrast;
uniform float exposure;
uniform float vignette;
${DEPTH_GLSL}
vec3 blurAt(vec2 uv, float r) {
  vec3 acc = texture(colorTexture, uv).rgb;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    float rr = (i % 2 == 0) ? r : r * 0.5;
    acc += texture(colorTexture, uv + vec2(cos(a), sin(a)) * rr * texel).rgb;
  }
  return acc / 13.0;
}
vec3 glow(vec2 uv) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988 + 0.26;
    vec2 o = vec2(cos(a), sin(a));
    vec3 c1 = texture(colorTexture, uv + o * 5.0 * texel).rgb;
    vec3 c2 = texture(colorTexture, uv + o * 12.0 * texel).rgb;
    acc += max(c1 - bloomThr, 0.0) + 0.6 * max(c2 - bloomThr, 0.0);
  }
  return acc / 12.0;
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (uv.x < wipe) {
    out_FragColor = src;
    if (abs(uv.x - wipe) < texel.x * 1.5) out_FragColor = vec4(0.18, 0.78, 0.91, 1.0);
    return;
  }
  bool sky = lk_sky(uv);
  float dist = lk_dist(uv);
  if (dbg > 0.5 && dbg < 1.5) { out_FragColor = vec4(vec3(sky ? 1.0 : min(dist / 5000.0, 1.0)), 1.0); return; }
  // Tilt: screen band and depth circle of confusion (focus = screen centre).
  float band = smoothstep(tiltBand, tiltBand + 0.3, abs(uv.y - tiltCenter));
  float focus = lk_dist(vec2(0.5, 0.5));
  float coc = sky ? 1.0 : clamp(abs(dist - focus) / max(focus * focusRange, 1.0) - 1.0, 0.0, 1.0);
  float rad = tiltBlur * band + dofBlur * coc;
  vec3 c = rad > 0.05 ? mix(src.rgb, blurAt(uv, rad), clamp(max(band, coc), 0.0, 1.0)) : src.rgb;
  if (bloom > 0.0) c += min(glow(uv) * bloom * vec3(1.0, 0.95, 0.85), vec3(bloomClamp));
  float hz = sky ? hazeSky : 1.0 - exp(-max(dist - hazeStart, 0.0) * hazeDensity);
  c = mix(c, hazeCol, clamp(haze * hz, 0.0, 0.9));
  c *= exposure;
  c = (c - 0.5) * contrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  vec2 vv = uv - 0.5;
  c *= mix(1.0, 1.0 - smoothstep(0.35, 0.95, length(vv)), vignette);
  vec3 outc = clamp(c, 0.0, 1.0);
  if (wipe > 0.0 && abs(uv.x - wipe) < texel.x * 1.5) outc = vec3(0.18, 0.78, 0.91);
  out_FragColor = vec4(outc, src.a);
}
`;

const PAINT_KEYS = ['wipe', 'kuw', 'kuwNear', 'kuwFar', 'kuwD0', 'kuwD1'];
const FINISH_KEYS = [
  'wipe', 'dbg', 'tiltCenter', 'tiltBand', 'tiltBlur', 'dofBlur', 'focusRange', 'bloom', 'bloomThr',
  'bloomClamp', 'haze', 'hazeCol', 'hazeStart', 'hazeDensity', 'hazeSky', 'sat', 'contrast', 'exposure',
  'vignette',
];
const POST_ONLY = new Set([...PAINT_KEYS, ...FINISH_KEYS].filter((k) => k !== 'dbg'));
const TILE_KEYS = Object.keys(COZY2_DEFAULTS).filter((k) => !POST_ONLY.has(k));

const vec3 = (a) => new Cesium.Cartesian3(a[0], a[1], a[2]);
const tileValue = (v) => (Array.isArray(v) ? vec3(v) : v);

function makeTileShader(opts) {
  const uniforms = {};
  for (const k of TILE_KEYS) {
    const v = opts[k];
    uniforms[`u_lk_${k}`] = {
      type: Array.isArray(v) ? Cesium.UniformType.VEC3 : Cesium.UniformType.FLOAT,
      value: tileValue(v),
    };
  }
  return new Cesium.CustomShader({
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms,
    fragmentShaderText: TILE_FS,
  });
}

function shownTilesets(scene) {
  const out = [];
  const walk = (coll) => {
    for (let i = 0; i < coll.length; i++) {
      const p = coll.get(i);
      if (p instanceof Cesium.Cesium3DTileset) out.push(p);
      else if (p && typeof p.get === 'function' && Number.isFinite(p.length)) walk(p);
    }
  };
  walk(scene.primitives);
  return out;
}

/** Install the cozy2 look; returns { set, remove, options, report }. */
export function installCozyShaderLook(viewer, options = {}) {
  const scene = viewer.scene;
  const opts = { ...COZY2_DEFAULTS, ...options };
  const report = { tiles: 0, tileShader: 'pending', paint: 'kuwahara-depth', finish: 'tilt+dof+glow+haze', ao: 'off' };
  const shader = makeTileShader(opts);
  const owned = new Map(); // tileset -> prior customShader
  const attach = () => {
    for (const ts of shownTilesets(scene)) {
      if (owned.has(ts) || ts.isDestroyed?.()) continue;
      owned.set(ts, ts.customShader);
      ts.customShader = shader;
    }
    report.tiles = owned.size;
    report.tileShader = owned.size ? 'on' : 'no-tileset';
  };
  attach();
  const timer = setInterval(attach, 1000);

  const texel = () =>
    new Cesium.Cartesian2(1 / Math.max(1, scene.drawingBufferWidth), 1 / Math.max(1, scene.drawingBufferHeight));
  const live = (k) => () => (Array.isArray(opts[k]) ? vec3(opts[k]) : opts[k]);
  const paintU = { texel };
  for (const k of PAINT_KEYS) paintU[k] = live(k);
  const finishU = { texel };
  for (const k of FINISH_KEYS) finishU[k] = live(k);
  const chain = scene.postProcessStages.add(
    new Cesium.PostProcessStageComposite({
      name: 'gev_fork_cozy2',
      stages: [
        new Cesium.PostProcessStage({ name: 'gev_fork_cozy2_paint', fragmentShader: PAINT_FS, uniforms: paintU }),
        new Cesium.PostProcessStage({ name: 'gev_fork_cozy2_finish', fragmentShader: FINISH_FS, uniforms: finishU }),
      ],
    }),
  );
  scene.requestRender?.();
  return {
    options: opts,
    report,
    set(next = {}) {
      for (const [k, v] of Object.entries(next)) {
        if (!(k in COZY2_DEFAULTS)) continue;
        opts[k] = v;
        if (TILE_KEYS.includes(k)) shader.setUniform(`u_lk_${k}`, tileValue(v));
      }
      scene.requestRender?.();
      return { ...opts };
    },
    remove() {
      clearInterval(timer);
      for (const [ts, prior] of owned) if (!ts.isDestroyed?.()) ts.customShader = prior;
      owned.clear();
      scene.postProcessStages.remove(chain);
      scene.requestRender?.();
    },
  };
}
