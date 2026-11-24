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
  if (c.a < 0.6) {
    // water: sky tint toward grazing angles, gentle ripple glints
    float fres = pow(1.0 - abs(dot(n, normalize(-pEC))), 3.0);
    float rip = sin(p.x * 0.9 + czm_frameNumber * 0.02) * sin(p.y * 1.1 - czm_frameNumber * 0.017);
    col = c.rgb * (0.75 + 0.25 * u_nfLight.y) + fres * 0.18 * u_nfWarm + max(rip - 0.85, 0.0) * 0.35;
  }
  material.diffuse = col;
  material.alpha = 1.0;
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
void nfClip(FragmentInput fsInput) {
  if (u_nfcBubble.z <= 0.001) return;
  vec3 p = (u_nfcEyeToLocal * vec4(fsInput.attributes.positionEC, 1.0)).xyz;
  vec2 uv = p.xy / (2.0 * u_nfcBubble.w) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return;
  vec4 m = texture(u_nfcMask, uv);
  bool hit = m.r > 0.5;
  if (!hit && m.g > 0.5) {
    float level = (floor(m.b * 255.0 + 0.5) * 256.0 + floor(m.a * 255.0 + 0.5)) / 10.0 - 1000.0;
    hit = p.z > level - 6.0 && p.z < level + 2.5;
  }
  if (!hit) return;
  float R = u_nfcBubble.x;
  float d = length(p.xy - u_nfcCentre);
  float a = (1.0 - smoothstep(R * (1.0 - u_nfcBubble.y), R, d)) * u_nfcBubble.z;
  if (nfIgn(gl_FragCoord.xy) < a) discard;
}
`;
