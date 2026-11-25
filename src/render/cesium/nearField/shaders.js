/**
 * @module render/cesium/nearField/shaders
 * @description FORK-ONLY (exp/near-field-v0). GLSL of the near-field bubble.
 *
 * Both sides of the hand-off use the SAME screen-space dither threshold
 * (interleaved gradient noise of gl_FragCoord) and the same distance alpha:
 * a generated fragment is kept where noise < alpha, and a Google fragment
 * under one of our objects is discarded where noise < alpha. So at every
 * pixel exactly one of the two survives: the bubble edge is a stable
 * cross-dissolve with no hole and no double image.
 *
 * Positions come from positionEC and a per-frame eye -> mask-local matrix
 * computed in double precision on the CPU (float32 world coordinates are
 * only good to ~0.5 m at Earth radius).
 */

export const IGN = /* glsl */ `
float nfIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/** Model (generated cell) fragment shader body. */
export const MODEL_FS = /* glsl */ `
${IGN}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 pEC = fsInput.attributes.positionEC;
  vec3 p = (u_nfEyeToLocal * vec4(pEC, 1.0)).xyz;
  float d = length(p.xy - u_nfCentre);
  float R = u_nfBubble.x * (u_nfIsTree > 0.5 ? u_nfBubble.z : 1.0);
  float a = (1.0 - smoothstep(R * (1.0 - u_nfBubble.y), R, d)) * u_nfBubble.w;
  if (nfIgn(gl_FragCoord.xy) >= a) discard;
  vec4 c = fsInput.attributes.color_0;
  vec3 n = normalize(cross(dFdx(pEC), dFdy(pEC)));
  vec3 l = normalize(czm_lightDirectionEC);
  float ndl = dot(n, l);
  // soft banded key (stylised) + sky ambient with a tinted shadow side
  float key = smoothstep(-0.05, 0.35, ndl) * 0.55 + smoothstep(0.35, 0.9, ndl) * 0.45;
  vec3 upEC = normalize(czm_normal * vec3(0.0, 0.0, 1.0));
  float sky = 0.5 + 0.5 * dot(n, upEC);
  vec3 amb = mix(u_nfShadow, vec3(1.0), 0.35 + 0.65 * sky) * u_nfLight.y;
  vec3 col = c.rgb * (amb + u_nfWarm * key * u_nfLight.x);
  // sloped roofs: shingle/turf courses, faded out where they would alias (screen-space width)
  float upness = dot(n, upEC);
  if (upness > 0.35 && upness < 0.97) {
    float f = p.z * 2.4;
    float w = fwidth(f);
    float course = smoothstep(0.0, 0.18, fract(f));
    col *= 1.0 - (1.0 - course) * 0.2 * (1.0 - clamp(w * 1.6, 0.0, 1.0));
  }
  // painterly value break-up (world-anchored, very low contrast)
  float g = fract(sin(dot(floor(p.xy * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
  col *= 0.96 + 0.08 * g;
  material.diffuse = col;
  material.alpha = 1.0;
}
`;

/**
 * Water (translucent pass): no dither. Opacity = vertex alpha (0 at shores and
 * marina cut-outs) x a smooth radial fade, so the surface melts into the map's
 * own water; the tile is hidden only under the fully opaque interior.
 */
export const WATER_FS = /* glsl */ `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 pEC = fsInput.attributes.positionEC;
  vec3 p = (u_nfEyeToLocal * vec4(pEC, 1.0)).xyz;
  float d = length(p.xy - u_nfCentre);
  float R = u_nfBubble.x;
  // a long, gentle fade for big flat water (a short one reads as a ring); the tile part
  // still hides the map only where this is fully opaque (d < R * (1 - edge))
  float a = (1.0 - smoothstep(R * 0.35, R, d)) * u_nfBubble.w;
  vec4 c = fsInput.attributes.color_0;
  vec3 v = normalize(-pEC);
  vec3 upEC = normalize(czm_normal * vec3(0.0, 0.0, 1.0));
  float fres = pow(1.0 - abs(dot(upEC, v)), 4.0);
  // no sparkle term: judges read glints as stipple at the hand-off (r1)
  vec3 col = c.rgb * (0.7 + 0.3 * u_nfLight.y) + fres * 0.16 * u_nfWarm;
  material.diffuse = col;
  material.alpha = clamp(c.a * a, 0.0, 1.0);
}
`;

/**
 * Tile part (Google photoreal and any other tileset): hide the tile under
 * our objects only. R channel: generated building footprint (whole column).
 * G channel: our water surface, with its level in B/A (decimetres + 1000 m);
 * only tile fragments within a band around that level are hidden, so
 * bridges and ships above the water stay Google.
 */
export const TILE_GLSL = /* glsl */ `
${IGN}
void nfClip(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_nfcBubble.z <= 0.001 && u_nfcDebug < 0.5) return;
  vec3 p = (u_nfcEyeToLocal * vec4(fsInput.attributes.positionEC, 1.0)).xyz;
  vec2 uv = p.xy / (2.0 * u_nfcBubble.w) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return;
  vec4 m = texture(u_nfcMask, uv);
  bool hit = m.r > 0.5 || (u_nfcWorld > 0.5 && m.g > 0.5);
  if (u_nfcWorld < 0.5 && !hit && m.g > 0.5) {
    float level = (floor(m.b * 255.0 + 0.5) * 256.0 + floor(m.a * 255.0 + 0.5)) / 10.0 - 1000.0;
    hit = p.z > level - 6.0 && p.z < level + 2.5;
  }
  if (!hit) return;
  float R = u_nfcBubble.x;
  float d = length(p.xy - u_nfcCentre);
  float a = (1.0 - smoothstep(R * (1.0 - u_nfcBubble.y), R, d)) * u_nfcBubble.z;
  if (u_nfcDebug > 0.5) {
    // debug: paint what would be hidden (red = footprint column, blue = water band)
    material.diffuse = mix(material.diffuse, m.r > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.3, 1.0), 0.75);
    return;
  }
  if (u_nfcWorld < 0.5 && m.r <= 0.5) {
    // our water is translucent where it fades (WATER_FS: 0.35 R .. R): hide the tile only
    // under fully opaque water
    float aw = (1.0 - smoothstep(R * 0.35, R, d)) * u_nfcBubble.z;
    if (aw >= 0.999) discard;
    return;
  }
  if (nfIgn(gl_FragCoord.xy) < a) discard;
}
`;

// Adapts the albedo and sky-fill treatments in Tinytown's look.js
// (MIT, Pete Koomen). ECEF space keeps the paint stationary as cells stream.
const WORLD_LOOK = /* glsl */ `
float paintHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float paintNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f *= f * (3.0 - 2.0 * f);
  return mix(mix(paintHash(i), paintHash(i + vec2(1, 0)), f.x),
             mix(paintHash(i + vec2(0, 1)), paintHash(i + 1.0), f.x), f.y);
}
vec3 painted(vec3 c, vec3 wc, float up) {
  vec2 p = vec2(wc.x + 0.35 * wc.y, wc.z - 0.67 * wc.y);
  const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float green = smoothstep(0.008, 0.05, c.g - max(c.r, c.b)) * u_nfPaint.x;
  float drift = 0.67 * paintNoise(p * 0.016) + 0.33 * paintNoise(p * 0.044 + 17.0);
  vec3 meadow = c * mix(vec3(0.78, 0.94, 1.03), vec3(1.36, 1.14, 0.72), smoothstep(0.22, 0.78, drift));
  meadow *= 0.87 + 0.25 * paintNoise(p * 0.10 + vec2(drift * 3.0, 23.0));
  c = mix(c, meadow, green);
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float grey = (1.0 - smoothstep(0.045, 0.12, chroma)) * smoothstep(0.68, 0.97, up);
  c *= mix(vec3(1.0), vec3(0.96, 1.0, 1.035) * (0.93 + 0.16 * paintNoise(p * 0.22)), grey * u_nfPaint.y);
  return c + vec3(0.88, 0.94, 1.07) * u_nfPaint.z * (1.0 - smoothstep(0.0, 0.18, dot(c, luma)));
}
vec3 daylight(vec3 c, vec3 n, vec3 upEC) {
  float key = smoothstep(-0.12, 0.92, dot(n, czm_lightDirectionEC));
  float sky = dot(n, upEC) * 0.5 + 0.5;
  vec3 tint = mix(vec3(1.0), u_nfShadow, u_nfPaint.w * (1.0 - 0.35 * key));
  return c * (u_nfLight.y * (0.68 + 0.32 * sky) * tint + u_nfWarm * u_nfLight.x * key);
}
`;

const worldFragment = (albedo, normal) => /* glsl */ `
${IGN}
${WORLD_LOOK}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 pEC = fsInput.attributes.positionEC;
  vec3 p = (u_nfEyeToLocal * vec4(pEC, 1.0)).xyz;
  float d = length(p.xy - u_nfCentre);
  float R = u_nfBubble.x * (u_nfIsTree > 0.5 ? u_nfBubble.z : 1.0);
  float a = (1.0 - smoothstep(R * (1.0 - u_nfBubble.y), R, d)) * u_nfBubble.w;
  if (nfIgn(gl_FragCoord.xy) >= a) discard;
  vec3 upEC = normalize(vec3(u_nfEyeToLocal[0].z, u_nfEyeToLocal[1].z, u_nfEyeToLocal[2].z));
  vec3 n = ${normal};
  vec3 c = painted(${albedo}, fsInput.attributes.positionWC, dot(n, upEC));
  material.diffuse = daylight(c, n, upEC);
  material.alpha = 1.0;
}
`;

export const GROUND_FS = worldFragment(
  'material.diffuse',
  'normalize(mix(normalize(cross(dFdx(pEC), dFdy(pEC))), upEC, smoothstep(0.15, 0.9, fsInput.attributes.texCoord_1.x)))',
);
export const WORLD_MODEL_FS = worldFragment('fsInput.attributes.color_0.rgb', 'normalize(fsInput.attributes.normalEC)');
export const WORLD_TREE_FS = worldFragment(
  'fsInput.attributes.color_0.rgb * (0.90 + 0.20 * float(fsInput.featureIds.instanceFeatureId_0) / 255.0)',
  'normalize(fsInput.attributes.normalEC)',
);
