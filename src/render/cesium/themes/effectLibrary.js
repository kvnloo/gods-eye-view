/**
 * @module render/cesium/themes/effectLibrary
 * @description FORK-ONLY (exp/theme-engine-v0). The theme engine's effect
 * library: ReShade-style screen-space effects for the Cesium globe, each one
 * GLSL plus declared uniforms with UI annotations (type/min/max/step/label,
 * like ReShade FX `ui_type`). Data only: no Cesium import. The engine
 * (`engine.js`) turns each enabled effect into one top-level
 * `PostProcessStage` (or a composite for multi-pass effects) on
 * `scene.postProcessStages`, so a disabled effect never breaks the chain.
 *
 * Shader conventions (Cesium supplies `colorTexture`, `depthTexture`,
 * `colorTextureDimensions`, `v_textureCoordinates`):
 * - every declared uniform reaches the shader under its own name, as a float
 *   (bool/int too) or a vec3 (vec3/color);
 * - `launchpadTexture` is the shared prepass (view normals in rgb, log
 *   distance in a), `sourceTexture` the frame before the theme ran,
 *   `pass_<name>` another pass of the same effect, `<texture key>` a preset
 *   texture (the LUT).
 *
 * Techniques are re-implemented from papers and public algorithm write-ups,
 * not copied from ReShade/qUINT/iMMERSE/RTGI sources (see THEME-ENGINE.md):
 * - AO: depth unsharp masking (Luft, Colditz, Deussen, SIGGRAPH 2006) and a
 *   normal-oriented obscurance (McGuire et al., "Scalable Ambient Obscurance",
 *   HPG 2012); applied as a capped tint, never a multiply to black.
 * - GI-lite: one-bounce near-field colour bleed (Ritschel et al.,
 *   "Approximating Dynamic Global Illumination in Image Space", I3D 2009).
 * - CAS: contrast-adaptive sharpening after AMD FidelityFX CAS (MIT licence),
 *   written from the published algorithm.
 * - Kuwahara paint: the 4-sector Kuwahara filter (Kuwahara et al. 1976), from
 *   this fork's cozyValleyLook.js.
 */

const COMMON = /* glsl */ `
float fx_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float fx_hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

// Depth helpers; czm_windowToEyeCoordinates handles log depth (LOG_DEPTH is
// defined for stages when the scene uses it). The result is homogeneous.
const DEPTH = /* glsl */ `
uniform sampler2D depthTexture;
vec3 fx_eye(vec2 uv) {
  float raw = texture(depthTexture, uv).r;
  vec4 e = czm_windowToEyeCoordinates(uv * czm_viewport.zw + czm_viewport.xy, raw);
  return e.xyz / e.w;
}
bool fx_sky(vec2 uv) { return texture(depthTexture, uv).r >= 1.0; }
float fx_dist(vec2 uv) { return fx_sky(uv) ? 1.0e8 : length(fx_eye(uv)); }
`;

const LAUNCHPAD_READ = /* glsl */ `
uniform sampler2D launchpadTexture;
vec3 fx_normal(vec2 uv) { return normalize(texture(launchpadTexture, uv).xyz * 2.0 - 1.0); }
`;

const HEAD = /* glsl */ `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
in vec2 v_textureCoordinates;
${COMMON}
`;

/** UI annotation helpers. */
const f = (def, min, max, step, label, extra = {}) => ({
  type: 'float',
  default: def,
  min,
  max,
  step,
  label,
  ...extra,
});
const color = (def, label) => ({ type: 'color', default: def, label });
const toggle = (def, label, extra = {}) => ({
  type: 'bool',
  default: def,
  label,
  ...extra,
});

// ---------------------------------------------------------------- launchpad
const LAUNCHPAD_FS = /* glsl */ `${HEAD}${DEPTH}
void main() {
  vec2 uv = v_textureCoordinates;
  if (fx_sky(uv)) { out_FragColor = vec4(0.5, 0.5, 1.0, 1.0); return; }
  vec2 px = 1.0 / colorTextureDimensions;
  vec3 p = fx_eye(uv);
  vec3 l = fx_eye(uv - vec2(px.x, 0.0));
  vec3 r = fx_eye(uv + vec2(px.x, 0.0));
  vec3 d = fx_eye(uv - vec2(0.0, px.y));
  vec3 u = fx_eye(uv + vec2(0.0, px.y));
  // the smaller difference on each axis: no smearing across silhouettes
  vec3 dx = length(p - l) < length(r - p) ? p - l : r - p;
  vec3 dy = length(p - d) < length(u - p) ? p - d : u - p;
  vec3 n = normalize(cross(dx, dy));
  if (dot(n, -p) < 0.0) n = -n;
  out_FragColor = vec4(n * 0.5 + 0.5, clamp(log2(1.0 + length(p)) / 25.0, 0.0, 1.0));
}`;

const PASS_FS = /* glsl */ `${HEAD}
void main() { out_FragColor = texture(colorTexture, v_textureCoordinates); }`;

// ----------------------------------------------------------------------- AO
const AO_GEN_FS = /* glsl */ `${HEAD}${DEPTH}${LAUNCHPAD_READ}
uniform float aoRadiusPx;
uniform float aoBias;
uniform float aoMode;
void main() {
  vec2 uv = v_textureCoordinates;
  if (fx_sky(uv)) { out_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / colorTextureDimensions;
  vec3 p = fx_eye(uv);
  float d = length(p);
  vec3 n = fx_normal(uv);
  float rot = fx_hash(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  float wsum = 0.0;
  float obs = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = rot + float(i) * 0.7853982;
    vec2 dir = vec2(cos(a), sin(a));
    for (int j = 1; j <= 2; j++) {
      vec2 suv = uv + dir * px * aoRadiusPx * float(j) * 0.5;
      if (fx_sky(suv)) continue;
      vec3 q = fx_eye(suv);
      float dn = length(q);
      // ignore unrelated depth (a far wall behind a near roof)
      float w = 1.0 - smoothstep(0.05, 0.25, abs(dn - d) / d);
      sum += dn * w;
      wsum += w;
      vec3 v = q - p;
      float vv = dot(v, v) + 1e-4;
      obs += w * max(dot(v, n) - aoBias * 0.01 * d, 0.0) / (vv / (d * 0.02) + d * 0.02);
    }
  }
  float ao;
  if (aoMode < 0.5) {
    // Luft 2006: a pixel farther than its neighbourhood mean sits in a crease.
    float mean = wsum > 0.0 ? sum / wsum : d;
    float delta = (d - mean) / d;
    ao = 1.0 - smoothstep(aoBias * 0.01, aoBias * 0.01 + 0.03, delta);
  } else {
    // McGuire 2012 style normal-oriented obscurance.
    ao = 1.0 - clamp(obs / 16.0 * 4.0, 0.0, 1.0);
  }
  out_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const AO_APPLY_FS = /* glsl */ `${HEAD}${DEPTH}
uniform sampler2D pass_gen;
uniform float aoStrength;
uniform float aoMax;
uniform vec3 aoTint;
uniform float aoDebug;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (fx_sky(uv)) { out_FragColor = src; return; }
  vec2 px = 1.0 / colorTextureDimensions;
  float d = length(fx_eye(uv));
  float acc = 0.0;
  float w = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 s = uv + vec2(float(i), float(j)) * px * 2.0;
      float k = 1.0 - smoothstep(0.02, 0.1, abs(fx_dist(s) - d) / d);
      acc += texture(pass_gen, s).r * k;
      w += k;
    }
  float ao = w > 0.0 ? acc / w : 1.0;
  if (aoDebug > 0.5) { out_FragColor = vec4(vec3(ao), 1.0); return; }
  float occl = min((1.0 - ao) * aoStrength, aoMax);
  out_FragColor = vec4(mix(src.rgb, src.rgb * aoTint, occl), src.a);
}`;

// ------------------------------------------------------------------- GI-lite
const GI_FS = /* glsl */ `${HEAD}${DEPTH}${LAUNCHPAD_READ}
uniform float giStrength;
uniform float giRadiusPx;
uniform float giSaturation;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (fx_sky(uv)) { out_FragColor = src; return; }
  vec2 px = 1.0 / colorTextureDimensions;
  vec3 p = fx_eye(uv);
  float d = length(p);
  vec3 n = fx_normal(uv);
  float rot = fx_hash(gl_FragCoord.xy + 3.1) * 6.2831853;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = rot + float(i) * 0.7853982;
    vec2 s = uv + vec2(cos(a), sin(a)) * px * giRadiusPx * (0.4 + 0.6 * fract(float(i) * 0.618));
    if (fx_sky(s)) continue;
    vec3 q = fx_eye(s) - p;
    float len = length(q) + 1e-3;
    vec3 dq = q / len;
    float facing = max(dot(n, dq), 0.0) * max(dot(fx_normal(s), -dq), 0.0);
    float fall = 1.0 - smoothstep(0.03 * d, 0.12 * d, len);
    vec3 c = texture(colorTexture, s).rgb;
    acc += mix(vec3(fx_luma(c)), c, giSaturation) * facing * fall;
  }
  vec3 bounce = acc / 8.0;
  out_FragColor = vec4(src.rgb + src.rgb * bounce * giStrength, src.a);
}`;

// --------------------------------------------------------------------- haze
// Distances are in units of the eye height, so one setting works from the
// street to the whole globe.
const HAZE_FS = /* glsl */ `${HEAD}${DEPTH}
uniform float hazeStart;
uniform float hazeDensity;
uniform float hazeMax;
uniform vec3 hazeColor;
uniform float skyTint;
uniform vec3 skyColor;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec3 c = src.rgb;
  if (fx_sky(uv)) {
    c = mix(c, skyColor, skyTint);
  } else {
    float rel = length(fx_eye(uv)) / max(czm_eyeHeight, 30.0);
    float h = min(1.0 - exp(-max(rel - hazeStart, 0.0) * hazeDensity), hazeMax);
    c = mix(c, hazeColor, h);
  }
  out_FragColor = vec4(c, src.a);
}`;

// ---------------------------------------------------------------------- DOF
const DOF_FS = /* glsl */ `${HEAD}${DEPTH}
uniform float dofBlurPx;
uniform float focusRange;
uniform float tiltAmount;
uniform float tiltCenter;
uniform float tiltBand;
uniform float skyBlur;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 px = 1.0 / colorTextureDimensions;
  float focus = fx_dist(vec2(0.5));
  bool sky = fx_sky(uv);
  float dist = sky ? 1.0e8 : length(fx_eye(uv));
  float coc = focus > 9.0e7 ? 0.0 : clamp(abs(dist - focus) / max(focus * focusRange, 1.0) - 1.0, 0.0, 1.0);
  if (sky) coc = skyBlur;
  coc = max(coc, tiltAmount * smoothstep(tiltBand, tiltBand + 0.35, abs(uv.y - tiltCenter)));
  if (coc < 0.01 || dofBlurPx <= 0.0) { out_FragColor = src; return; }
  vec3 acc = src.rgb;
  float w = 1.0;
  // golden-angle disc; nearer samples may bleed, farther sharp ones may not
  for (int i = 1; i < 16; i++) {
    float r = sqrt(float(i) / 16.0) * dofBlurPx * coc;
    float a = float(i) * 2.39996323;
    vec2 s = uv + vec2(cos(a), sin(a)) * r * px;
    float sd = fx_dist(s);
    float k = sd < dist ? 1.0 : clamp(coc * 2.0, 0.0, 1.0);
    acc += texture(colorTexture, s).rgb * k;
    w += k;
  }
  out_FragColor = vec4(acc / w, src.a);
}`;

// -------------------------------------------------------------------- bloom
const BLOOM_FS = /* glsl */ `${HEAD}
uniform float bloomThreshold;
uniform float bloomIntensity;
uniform float bloomClamp;
uniform float bloomRadiusPx;
uniform vec3 bloomTint;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 px = 1.0 / colorTextureDimensions;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988 + 0.26;
    vec2 o = vec2(cos(a), sin(a)) * px;
    acc += max(texture(colorTexture, uv + o * bloomRadiusPx * 0.45).rgb - bloomThreshold, 0.0);
    acc += 0.6 * max(texture(colorTexture, uv + o * bloomRadiusPx).rgb - bloomThreshold, 0.0);
  }
  vec3 glow = min(acc / 12.0 * bloomIntensity * bloomTint, vec3(bloomClamp));
  out_FragColor = vec4(src.rgb + glow, src.a);
}`;

// ---------------------------------------------------------------------- LUT
// A 2D strip LUT: width N*N, height N, pixel (b*N + r, g); trilinear.
const LUT_FS = /* glsl */ `${HEAD}
uniform sampler2D lutTexture;
uniform float lutStrength;
uniform float lutSize;
uniform float lutFlipY;
vec3 lutAt(float slice, vec2 rg, float N) {
  float x = (slice * N + rg.x * (N - 1.0) + 0.5) / (N * N);
  float y = (rg.y * (N - 1.0) + 0.5) / N;
  if (lutFlipY > 0.5) y = 1.0 - y;
  return texture(lutTexture, vec2(x, y)).rgb;
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec3 c = clamp(src.rgb, 0.0, 1.0);
  float N = max(lutSize, 2.0);
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, N - 1.0);
  vec3 g = mix(lutAt(b0, c.rg, N), lutAt(b1, c.rg, N), b - b0);
  out_FragColor = vec4(mix(src.rgb, g, lutStrength), src.a);
}`;

// -------------------------------------------------------------------- grade
const GRADE_FS = /* glsl */ `${HEAD}
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform float vibrance;
uniform float temperature;
uniform float tint;
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform float shadows;
uniform float highlights;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec3 c = src.rgb * exp2(exposure);
  // white balance: warm/cool and green/magenta
  c *= vec3(1.0 + 0.1 * temperature, 1.0 + 0.05 * tint, 1.0 - 0.1 * temperature);
  // lift / gamma / gain (ASC CDL-like)
  c = gain * (c + lift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / max(gamma, vec3(0.05)));
  // curves: shadows / highlights then contrast about mid grey
  float l = fx_luma(c);
  c += shadows * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  c += highlights * 0.25 * smoothstep(0.5, 1.0, l);
  c = (c - 0.5) * contrast + 0.5;
  // vibrance (protects already saturated colours) and saturation
  l = fx_luma(c);
  float s = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + vibrance * (1.0 - s));
  c = mix(vec3(fx_luma(c)), c, saturation);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

// ------------------------------------------------------------------ clarity
const CLARITY_FS = /* glsl */ `${HEAD}${DEPTH}
uniform float clarity;
uniform float clarityRadiusPx;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 px = 1.0 / colorTextureDimensions;
  float d = fx_dist(uv);
  float l = fx_luma(src.rgb);
  float acc = l;
  float w = 1.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 s = uv + vec2(cos(a), sin(a)) * px * clarityRadiusPx;
    float k = 1.0 - smoothstep(0.03, 0.15, abs(fx_dist(s) - d) / d);
    acc += fx_luma(texture(colorTexture, s).rgb) * k;
    w += k;
  }
  float detail = clamp(l - acc / w, -0.15, 0.15);
  // midtone-weighted, like a Lightroom clarity slider
  float mid = 1.0 - abs(l * 2.0 - 1.0);
  vec3 c = src.rgb * (1.0 + clarity * detail * mid / max(l, 0.05));
  out_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

// ---------------------------------------------------------------------- CAS
const CAS_FS = /* glsl */ `${HEAD}
uniform float casSharpness;
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / colorTextureDimensions;
  vec4 src = texture(colorTexture, uv);
  vec3 e = src.rgb;
  vec3 b = texture(colorTexture, uv + vec2(0.0, -px.y)).rgb;
  vec3 d = texture(colorTexture, uv + vec2(-px.x, 0.0)).rgb;
  vec3 fR = texture(colorTexture, uv + vec2(px.x, 0.0)).rgb;
  vec3 h = texture(colorTexture, uv + vec2(0.0, px.y)).rgb;
  vec3 mn = min(e, min(min(b, d), min(fR, h)));
  vec3 mx = max(e, max(max(b, d), max(fR, h)));
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 w = -amp * mix(1.0 / 8.0, 1.0 / 5.0, casSharpness);
  vec3 c = (e + w * (b + d + fR + h)) / (1.0 + 4.0 * w);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

// ----------------------------------------------------------------- vignette
const VIGNETTE_FS = /* glsl */ `${HEAD}
uniform float vignette;
uniform float vignetteRadius;
uniform vec3 vignetteColor;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 v = (uv - 0.5) * vec2(colorTextureDimensions.x / colorTextureDimensions.y, 1.0);
  float k = smoothstep(vignetteRadius, vignetteRadius + 0.6, length(v)) * vignette;
  out_FragColor = vec4(mix(src.rgb, src.rgb * vignetteColor, k), src.a);
}`;

// --------------------------------------------------------------------- grain
const GRAIN_FS = /* glsl */ `${HEAD}
uniform float grain;
uniform float grainSize;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 cell = floor(gl_FragCoord.xy / max(grainSize, 1.0));
  float n = fx_hash(cell + fract(czm_frameNumber * 0.618) * 97.0) - 0.5;
  float l = fx_luma(src.rgb);
  float k = grain * (1.0 - abs(l * 2.0 - 1.0) * 0.6);
  out_FragColor = vec4(clamp(src.rgb + n * k, 0.0, 1.0), src.a);
}`;

// ------------------------------------------------------------------ godrays
// Screen-space light shafts toward the sun's projected position (Mitchell,
// "Volumetric Light Scattering as a Post-Process", GPU Gems 3 ch. 13): only
// sky pixels brighter than the threshold scatter.
const GODRAYS_FS = /* glsl */ `${HEAD}${DEPTH}
uniform float raysIntensity;
uniform float raysDecay;
uniform float raysThreshold;
uniform vec3 raysColor;
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec4 clip = czm_projection * vec4(czm_sunDirectionEC, 0.0);
  if (clip.w <= 0.0 || raysIntensity <= 0.0) { out_FragColor = src; return; }
  vec2 sun = clip.xy / clip.w * 0.5 + 0.5;
  vec2 stp = (sun - uv) / 24.0;
  vec2 s = uv;
  float fall = 1.0;
  float acc = 0.0;
  for (int i = 0; i < 24; i++) {
    s += stp;
    if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) break;
    float lit = fx_sky(s) ? max(fx_luma(texture(colorTexture, s).rgb) - raysThreshold, 0.0) : 0.0;
    acc += lit * fall;
    fall *= raysDecay;
  }
  float edge = 1.0 - smoothstep(0.6, 1.3, length(sun - 0.5));
  out_FragColor = vec4(src.rgb + raysColor * acc / 24.0 * raysIntensity * edge, src.a);
}`;

// -------------------------------------------------------------------- paint
const PAINT_FS = /* glsl */ `${HEAD}
uniform float paintRadius;
void sector(vec2 uv, vec2 dir, vec2 px, inout vec3 bestMean, inout float bestVar) {
  vec3 sum = vec3(0.0);
  vec3 sq = vec3(0.0);
  for (int j = 0; j <= 2; j++)
    for (int i = 0; i <= 2; i++) {
      vec3 c = texture(colorTexture, uv + vec2(float(i), float(j)) * dir * paintRadius * 0.5 * px).rgb;
      sum += c;
      sq += c * c;
    }
  vec3 mean = sum / 9.0;
  vec3 v = sq / 9.0 - mean * mean;
  float var = v.r + v.g + v.b;
  if (var < bestVar) { bestVar = var; bestMean = mean; }
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec2 px = 1.0 / colorTextureDimensions;
  vec3 best = src.rgb;
  float bestVar = 1e9;
  sector(uv, vec2(-1.0, -1.0), px, best, bestVar);
  sector(uv, vec2(1.0, -1.0), px, best, bestVar);
  sector(uv, vec2(-1.0, 1.0), px, best, bestVar);
  sector(uv, vec2(1.0, 1.0), px, best, bestVar);
  out_FragColor = vec4(best, src.a);
}`;

// --------------------------------------------------------------------- wipe
const WIPE_FS = /* glsl */ `${HEAD}
uniform sampler2D sourceTexture;
uniform float wipe;
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / colorTextureDimensions;
  vec4 src = texture(colorTexture, uv);
  if (uv.x < wipe) src = texture(sourceTexture, uv);
  if (wipe > 0.0 && abs(uv.x - wipe) < px.x * 1.5) src = vec4(0.18, 0.78, 0.91, 1.0);
  out_FragColor = src;
}`;

/**
 * Post effects in their default order. `cost` is a rough relative GPU cost
 * (full-res texture taps / 10) used by the frame budget to drop the most
 * expensive effect first. `internal` effects are managed by the engine.
 */
export const POST_EFFECTS = Object.freeze([
  {
    id: 'launchpad',
    label: 'Launchpad (depth → normals prepass)',
    internal: true,
    cost: 0.5,
    passes: [
      {
        name: 'launchpad',
        fragmentShader: LAUNCHPAD_FS,
        stageName: 'gev_fx_launchpad',
      },
      { name: 'src', fragmentShader: PASS_FS, stageName: 'gev_fx_src' },
    ],
    uniforms: {},
  },
  {
    id: 'paint',
    label: 'Kuwahara paint',
    cost: 3.6,
    fragmentShader: PAINT_FS,
    uniforms: { paintRadius: f(3, 1, 8, 0.5, 'Brush radius (px)') },
  },
  {
    id: 'ao',
    label: 'Ambient occlusion (tinted, capped)',
    cost: 2.5,
    launchpad: true,
    passes: [
      { name: 'gen', fragmentShader: AO_GEN_FS, textureScale: 0.5 },
      { name: 'apply', fragmentShader: AO_APPLY_FS },
    ],
    uniforms: {
      aoMode: f(0, 0, 1, 1, 'Mode (0 unsharp depth, 1 obscurance)'),
      aoRadiusPx: f(14, 2, 48, 1, 'Radius (px)'),
      aoBias: f(0.2, 0, 2, 0.05, 'Bias'),
      aoStrength: f(0.55, 0, 1, 0.01, 'Strength'),
      aoMax: f(0.45, 0, 1, 0.01, 'Ceiling'),
      aoTint: color([0.55, 0.58, 0.82], 'Shadow tint'),
      aoDebug: toggle(0, 'Show AO only'),
    },
  },
  {
    id: 'gi',
    label: 'GI-lite (one-bounce colour bleed)',
    cost: 2.4,
    launchpad: true,
    fragmentShader: GI_FS,
    uniforms: {
      giStrength: f(0.35, 0, 2, 0.01, 'Bounce strength'),
      giRadiusPx: f(24, 4, 64, 1, 'Radius (px)'),
      giSaturation: f(1.2, 0, 2, 0.05, 'Bounce saturation'),
    },
  },
  {
    id: 'haze',
    label: 'Depth haze / fog',
    cost: 0.2,
    fragmentShader: HAZE_FS,
    uniforms: {
      hazeStart: f(4, 0, 50, 0.5, 'Start (× eye height)'),
      hazeDensity: f(0.03, 0, 0.3, 0.005, 'Density'),
      hazeMax: f(0.6, 0, 1, 0.01, 'Maximum'),
      hazeColor: color([0.78, 0.9, 0.92], 'Haze colour'),
      skyTint: f(0, 0, 1, 0.01, 'Sky tint'),
      skyColor: color([0.72, 0.88, 0.95], 'Sky colour'),
    },
  },
  {
    id: 'dof',
    label: 'Depth of field / tilt-shift',
    cost: 1.8,
    fragmentShader: DOF_FS,
    uniforms: {
      dofBlurPx: f(7, 0, 24, 0.5, 'Max blur (px)'),
      focusRange: f(0.35, 0.02, 2, 0.01, 'In-focus range (× focus distance)'),
      tiltAmount: f(0, 0, 1, 0.01, 'Tilt-shift band'),
      tiltCenter: f(0.5, 0, 1, 0.01, 'Tilt centre'),
      tiltBand: f(0.18, 0, 0.5, 0.01, 'Tilt sharp band'),
      skyBlur: f(0.5, 0, 1, 0.01, 'Sky blur'),
    },
  },
  {
    id: 'godrays',
    label: 'God rays (sun shafts)',
    cost: 2.4,
    fragmentShader: GODRAYS_FS,
    uniforms: {
      raysIntensity: f(0.6, 0, 3, 0.05, 'Intensity'),
      raysDecay: f(0.95, 0.8, 1, 0.005, 'Decay'),
      raysThreshold: f(0.6, 0, 1, 0.01, 'Sky threshold'),
      raysColor: color([1.0, 0.9, 0.7], 'Colour'),
    },
  },
  {
    id: 'bloom',
    label: 'Bloom (clamped)',
    cost: 2.4,
    fragmentShader: BLOOM_FS,
    uniforms: {
      bloomThreshold: f(0.72, 0, 1, 0.01, 'Threshold'),
      bloomIntensity: f(0.9, 0, 4, 0.05, 'Intensity'),
      bloomClamp: f(0.12, 0, 1, 0.01, 'Clamp'),
      bloomRadiusPx: f(14, 2, 48, 1, 'Radius (px)'),
      bloomTint: color([1.0, 0.92, 0.78], 'Tint'),
    },
  },
  {
    id: 'lut',
    label: 'LUT (3D colour lookup)',
    cost: 0.2,
    fragmentShader: LUT_FS,
    textures: ['lutTexture'],
    uniforms: {
      lutStrength: f(1, 0, 1, 0.01, 'Strength'),
      lutSize: f(33, 2, 65, 1, 'LUT size', { hidden: true }),
      lutFlipY: toggle(1, 'Flip LUT rows', { hidden: true }),
    },
  },
  {
    id: 'grade',
    label: 'Grade (lift/gamma/gain, WB, curves)',
    cost: 0.1,
    fragmentShader: GRADE_FS,
    uniforms: {
      exposure: f(0, -2, 2, 0.01, 'Exposure (EV)'),
      contrast: f(1, 0.5, 1.5, 0.01, 'Contrast'),
      saturation: f(1, 0, 2, 0.01, 'Saturation'),
      vibrance: f(0, -1, 1, 0.01, 'Vibrance'),
      temperature: f(0, -1, 1, 0.01, 'Temperature'),
      tint: f(0, -1, 1, 0.01, 'Tint'),
      lift: color([0, 0, 0], 'Lift'),
      gamma: color([1, 1, 1], 'Gamma'),
      gain: color([1, 1, 1], 'Gain'),
      shadows: f(0, -1, 1, 0.01, 'Shadows'),
      highlights: f(0, -1, 1, 0.01, 'Highlights'),
    },
  },
  {
    id: 'clarity',
    label: 'Local contrast / clarity',
    cost: 1.6,
    fragmentShader: CLARITY_FS,
    uniforms: {
      clarity: f(0.4, -1, 2, 0.01, 'Clarity'),
      clarityRadiusPx: f(10, 2, 40, 1, 'Radius (px)'),
    },
  },
  {
    id: 'cas',
    label: 'Contrast-adaptive sharpen',
    cost: 0.5,
    fragmentShader: CAS_FS,
    uniforms: { casSharpness: f(0.4, 0, 1, 0.01, 'Sharpness') },
  },
  {
    id: 'vignette',
    label: 'Vignette',
    cost: 0.1,
    fragmentShader: VIGNETTE_FS,
    uniforms: {
      vignette: f(0.3, 0, 1, 0.01, 'Amount'),
      vignetteRadius: f(0.45, 0, 1, 0.01, 'Radius'),
      vignetteColor: color([0.35, 0.33, 0.45], 'Colour'),
    },
  },
  {
    id: 'grain',
    label: 'Film grain',
    cost: 0.1,
    fragmentShader: GRAIN_FS,
    uniforms: {
      grain: f(0.04, 0, 0.3, 0.005, 'Amount'),
      grainSize: f(1.5, 1, 4, 0.5, 'Size (px)'),
    },
  },
  {
    id: 'wipe',
    label: 'Before/after wipe',
    internal: true,
    cost: 0.1,
    fragmentShader: WIPE_FS,
    uniforms: { wipe: f(0, 0, 1, 0.01, 'Wipe') },
  },
]);

/** The effect ids a preset may name, in library order (stage 0 first). */
export const EFFECT_IDS = Object.freeze([
  'tile',
  ...POST_EFFECTS.filter((e) => !e.internal).map((e) => e.id),
]);

/** Library effect by id (post effects only). */
export function postEffect(id) {
  return POST_EFFECTS.find((e) => e.id === id) ?? null;
}

/** The default uniform values of an effect's declared uniforms. */
export function defaultsOf(uniforms) {
  const out = {};
  for (const [k, spec] of Object.entries(uniforms ?? {}))
    out[k] = Array.isArray(spec.default) ? [...spec.default] : spec.default;
  return out;
}

export const SHADER_PARTS = Object.freeze({
  HEAD,
  DEPTH,
  LAUNCHPAD_READ,
  COMMON,
});
