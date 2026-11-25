import * as Cesium from 'cesium';

// FORK-ONLY experiment (exp/city-loop-r1): the "Cozy Valley" reality look,
// wired in the app behind ?look=cozy (src/data/cityLookFlags.js). Round 0's
// harness filter (downstream/city-loop/filter/cozyValley.js) was a warm grade
// over the photo and read as sepia. This chain stylises instead:
//   1 paint:  a 4-sector Kuwahara filter (edge-preserving smoothing) flattens
//             photo texture into painted patches and keeps edges crisp;
//   2 look:   a hue-aware palette map toward the owner-chosen reference
//             (fresh yellow-greens, teal water, cream/terracotta built
//             surfaces, lilac-teal shadows), soft value posterise, a warm key on
//             the lights, a clamped bloom, far haze, tilt-shift and vignette.
// Only the globe's image is styled: the DOM HUD, attribution and labels sit
// above the canvas and are untouched. No ambient occlusion: Cesium's HBAO
// blackened the photoreal frame under SwiftShader in round 0.
// Both stages carry a compare wipe: left of `wipe` (0..1 of the width) shows
// the scene as rendered.

const PAINT = /* glsl */ `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float wipe;
uniform float radius;
uniform vec2 texel;

void sector(vec2 uv, vec2 dir, inout vec3 bestMean, inout float bestVar) {
  vec3 sum = vec3(0.0);
  vec3 sq = vec3(0.0);
  for (int j = 0; j <= 2; j++) {
    for (int i = 0; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j)) * dir * radius * 0.5;
      vec3 c = texture(colorTexture, uv + o * texel).rgb;
      sum += c;
      sq += c * c;
    }
  }
  vec3 mean = sum / 9.0;
  vec3 v = sq / 9.0 - mean * mean;
  float var = v.r + v.g + v.b;
  if (var < bestVar) {
    bestVar = var;
    bestMean = mean;
  }
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (uv.x < wipe) {
    out_FragColor = src;
    return;
  }
  vec3 best = src.rgb;
  float bestVar = 1e9;
  sector(uv, vec2(-1.0, -1.0), best, bestVar);
  sector(uv, vec2(1.0, -1.0), best, bestVar);
  sector(uv, vec2(-1.0, 1.0), best, bestVar);
  sector(uv, vec2(1.0, 1.0), best, bestVar);
  out_FragColor = vec4(best, src.a);
}
`;

const LOOK = /* glsl */ `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float wipe;
uniform vec2 texel;
uniform float strength;
uniform float greenSat;
uniform float waterSat;
uniform float warmSat;
uniform float cream;
uniform float shadowTint;
uniform float posterize;
uniform float bloom;
uniform float bloomClamp;
uniform float haze;
uniform float tiltCenter;
uniform float tiltBand;
uniform float tiltBlur;
uniform float vignette;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// Weight of hue h (0..1) inside a band centred on c with half width w.
float band(float h, float c, float w) {
  float d = abs(fract(h - c + 0.5) - 0.5);
  return 1.0 - smoothstep(w * 0.6, w, d);
}

vec3 palette(vec3 c) {
  vec3 hsv = rgb2hsv(c);
  float h = hsv.x;
  float s = hsv.y;
  float v = hsv.z;
  // Vegetation (yellow-green .. green): toward a fresh yellow-green, richer.
  float g = band(h, 0.27, 0.13) * smoothstep(0.04, 0.16, s);
  h = mix(h, mix(h, 0.25, 0.55), g);
  s = mix(s, min(1.0, s * greenSat + 0.08), g);
  v = mix(v, min(1.0, v * 1.12 + 0.03), g);
  // Water and sky (cyan .. blue): toward teal-cyan.
  float w = band(h, 0.55, 0.12) * smoothstep(0.05, 0.18, s);
  h = mix(h, mix(h, 0.51, 0.6), w);
  s = mix(s, min(1.0, s * waterSat + 0.06), w);
  // Warm hues (roofs, brick, plaster): richer terracotta / cream.
  float r = band(h, 0.06, 0.1);
  s = mix(s, min(1.0, s * warmSat), r);
  vec3 outc = hsv2rgb(vec3(fract(h), s, v));
  // Neutral greys (concrete, asphalt, pale walls) pick up a warm cream.
  float grey = 1.0 - smoothstep(0.05, 0.22, hsv.y);
  outc = mix(outc, outc * vec3(1.07, 1.0, 0.86) + vec3(0.02, 0.012, 0.0), grey * cream * smoothstep(0.25, 0.8, v));
  // Shadows lift toward a soft lilac-teal (never crushed to black).
  float dark = pow(1.0 - smoothstep(0.0, 0.45, v), 1.6);
  outc = mix(outc, vec3(0.24, 0.24, 0.36) + outc * 0.6, dark * shadowTint);
  return outc;
}

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
    vec3 c1 = texture(colorTexture, uv + o * 6.0 * texel).rgb;
    vec3 c2 = texture(colorTexture, uv + o * 14.0 * texel).rgb;
    acc += max(c1 - 0.72, 0.0) + 0.6 * max(c2 - 0.72, 0.0);
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
  // Tilt-shift: a sharp horizontal band, softer above and below.
  float d = abs(uv.y - tiltCenter);
  float t = smoothstep(tiltBand, tiltBand + 0.3, d);
  vec3 c = t > 0.001 ? mix(src.rgb, blurAt(uv, tiltBlur * t), t) : src.rgb;
  c = palette(c);
  // Soft posterise on value: painted bands, hue kept.
  if (posterize > 0.0) {
    float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    float q = floor(l * 7.0 + 0.5) / 7.0;
    c = mix(c, c * (q / l), posterize);
  }
  // Warm key on the lights, cooler in the shade.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(vec3(0.96, 0.99, 1.04), vec3(1.06, 1.01, 0.92), smoothstep(0.25, 0.75, l));
  // Bloom: bright neighbours bleed a warm glow, clamped so nothing blows out.
  c += min(glow(uv) * bloom * vec3(1.0, 0.92, 0.78), vec3(bloomClamp));
  // Far haze (top of the frame) toward a pale teal sky.
  c = mix(c, vec3(0.78, 0.9, 0.92), haze * smoothstep(0.62, 1.0, uv.y));
  // Vignette.
  vec2 vv = uv - 0.5;
  c *= mix(1.0, smoothstep(0.9, 0.3, length(vv)), vignette);
  vec3 outc = mix(src.rgb, clamp(c, 0.0, 1.0), strength);
  if (wipe > 0.0 && abs(uv.x - wipe) < texel.x * 1.5) outc = vec3(0.18, 0.78, 0.91);
  out_FragColor = vec4(outc, src.a);
}
`;

export const COZY_LOOK_DEFAULTS = Object.freeze({
  wipe: 0,
  radius: 3,
  strength: 1,
  greenSat: 1.6,
  waterSat: 1.35,
  warmSat: 1.3,
  cream: 0.8,
  shadowTint: 0.45,
  posterize: 0.3,
  bloom: 0.9,
  bloomClamp: 0.12,
  haze: 0.28,
  tiltCenter: 0.5,
  tiltBand: 0.14,
  tiltBlur: 6,
  vignette: 0.32,
});

/** Install the chain on a Cesium viewer; returns { set, remove, options }. */
export function installCozyValleyLook(viewer, options = {}) {
  const scene = viewer.scene;
  const opts = { ...COZY_LOOK_DEFAULTS, ...options };
  const texel = () =>
    new Cesium.Cartesian2(
      1 / Math.max(1, scene.drawingBufferWidth),
      1 / Math.max(1, scene.drawingBufferHeight),
    );
  const live = (k) => () => opts[k];
  const paint = new Cesium.PostProcessStage({
    name: 'gev_fork_cozy_paint',
    fragmentShader: PAINT,
    uniforms: { wipe: live('wipe'), radius: live('radius'), texel },
  });
  const lookUniforms = { texel };
  for (const k of Object.keys(COZY_LOOK_DEFAULTS))
    if (k !== 'radius') lookUniforms[k] = live(k);
  const look = new Cesium.PostProcessStage({
    name: 'gev_fork_cozy_look',
    fragmentShader: LOOK,
    uniforms: lookUniforms,
  });
  const chain = scene.postProcessStages.add(
    new Cesium.PostProcessStageComposite({
      name: 'gev_fork_cozy_valley',
      stages: [paint, look],
    }),
  );
  scene.requestRender?.();
  return {
    options: opts,
    report: { paint: 'kuwahara-4', look: 'palette+posterise+bloom+haze+tilt', ao: 'off' },
    set(next) {
      Object.assign(opts, next);
      scene.requestRender?.();
    },
    remove() {
      scene.postProcessStages.remove(chain);
      scene.requestRender?.();
    },
  };
}
