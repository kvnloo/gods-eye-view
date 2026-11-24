/**
 * @module render/cesium/themes/tileStage
 * @description FORK-ONLY (exp/theme-engine-v0). Stage 0 of the theme engine:
 * the material pass that restyles every 3D tileset's own texture in its
 * CustomShader (Google Photorealistic 3D Tiles anywhere in the world, or any
 * other tileset the app shows). Data only: GLSL + annotated uniforms.
 *
 * Per fragment, in order (from the research snippet loop-v3/research-cesium/
 * snippets/tileLook.js, offline-verified against CesiumJS 1.138):
 *  1 flatten: re-sample the tile's base-colour texture at a mip bias (photo
 *    noise → flat patches, stable under camera motion); 8-tap texel ring
 *    fallback when the textures have no mip chain;
 *  2 facets: flat normals from screen derivatives (the tiles have no NORMAL),
 *    roof/ground vs wall by normal · local up;
 *  3 palette: classify vegetation (excess green), water (blue excess on flat
 *    surfaces), neutrals (roofs/streets/walls by class) and map each to the
 *    theme palette, swapping the photo luminance (Google's baked shadows) for
 *    a palette value, keeping `detail` of the photo's light/dark;
 *  4 light: soft banded wrap-Lambert from the scene's sun, from a lilac shadow
 *    colour to a warm key: shadows are coloured, never black.
 * Left of `u_wipe` (share of the viewport width) the tile shows as it was.
 *
 * Internal Cesium names (`u_baseColorTexture`, `TEXCOORD_BASE_COLOR`,
 * `HAS_BASE_COLOR_TEXTURE[_TRANSFORM]`, `computeTextureTransform`) sit behind
 * #ifdef: if Cesium renames them the flatten step turns off and the shader
 * still compiles.
 */

const f = (def, min, max, step, label) => ({
  type: 'float',
  default: def,
  min,
  max,
  step,
  label,
});
/** Marks English text for scripts/i18n.mjs; the panel translates with t(). */
const msg = (text) => text;
const color = (def, label) => ({ type: 'color', default: def, label });
const hex = (h) =>
  [1, 3, 5].map(
    (i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000,
  );

/**
 * Palette defaults: the diorama look pass A colours (exp/city-loop-v5
 * 5bb61099: cityDiorama.js paintGround, cityDioramaMesh.js look-a palette),
 * so the theme and the diorama island read as one world.
 */
export const TILE_UNIFORMS = Object.freeze({
  strength: f(1, 0, 1, 0.01, 'Strength'),
  flatten: f(2.5, 0, 6, 0.1, 'Texture flatten (mip bias)'),
  flattenTexels: f(0, 0, 8, 0.5, 'Flatten ring (texels, no-mip fallback)'),
  detail: f(0.35, 0, 1, 0.01, 'Photo detail kept'),
  delight: f(0.85, 0, 1, 0.01, 'De-light (remove baked shadows)'),
  bands: f(3, 1, 6, 1, 'Toon bands'),
  wrap: f(0.55, 0, 1, 0.01, 'Light wrap'),
  relight: f(1, 0, 1, 0.01, 'Relight amount'),
  vegLo: f(0.02, -0.1, 0.2, 0.005, 'Vegetation threshold'),
  vegHi: f(0.1, 0, 0.3, 0.005, 'Vegetation full'),
  roofVariety: f(0.6, 0, 1, 0.01, 'Roof colour variety'),
  cellM: f(14, 2, 60, 1, 'Roof colour cell (m)'),
  grass: color(hex('#7aa840'), 'Grass'),
  canopy: color(hex('#2f5e3b'), 'Canopy'),
  water: color(hex('#44a4ac'), 'Water shallows'),
  waterDeep: color(hex('#2a7a8e'), 'Water deep'),
  wall: color(hex('#efe2c4'), 'Walls'),
  street: color(hex('#cfc4a8'), 'Streets'),
  roofA: color(hex('#c25a38'), 'Roof terracotta'),
  roofB: color(hex('#5a6474'), 'Roof slate'),
  roofC: color(hex('#e6cfa6'), 'Roof cream'),
  roofD: color(hex('#6e4a36'), 'Roof timber'),
  shadow: color([0.42, 0.44, 0.62], 'Shadow tint'),
  key: color([1.06, 1.0, 0.9], 'Key light'),
  debugTexel: {
    type: 'bool',
    default: 0,
    label: msg('Texel density heatmap (debug)'),
  },
});

export const TILE_GLSL = /* glsl */ `
float th_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float th_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void th_material(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_th_strength <= 0.001) return;
  if (gl_FragCoord.x < u_th_wipe * czm_viewport.z + czm_viewport.x) return;
  vec3 photo = material.diffuse; // linear
  vec3 albedo = photo;
  #ifdef HAS_BASE_COLOR_TEXTURE
  if (u_th_flatten > 0.0 || u_th_flattenTexels > 0.0) {
    vec2 uv = TEXCOORD_BASE_COLOR;
    #ifdef HAS_BASE_COLOR_TEXTURE_TRANSFORM
    uv = computeTextureTransform(uv, u_baseColorTextureTransform);
    #endif
    albedo = czm_srgbToLinear(texture(u_baseColorTexture, uv, u_th_flatten).rgb);
    if (u_th_flattenTexels > 0.0) {
      vec2 t = u_th_flattenTexels / vec2(textureSize(u_baseColorTexture, 0));
      vec3 acc = albedo;
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.7853982;
        acc += czm_srgbToLinear(texture(u_baseColorTexture, uv + vec2(cos(ang), sin(ang)) * t, u_th_flatten).rgb);
      }
      albedo = acc / 9.0;
    }
  }
  #endif
  vec3 pEC = fsInput.attributes.positionEC;
  vec3 pWC = fsInput.attributes.positionWC;
  #ifdef HAS_BASE_COLOR_TEXTURE
  if (u_th_debugTexel > 0.5) {
    // Texel density from derivatives only (no texture content): screen
    // pixels per texel; log2 < 0 blue (texels minified, LOD/resolution can
    // still add detail), 0 green (1:1), > 0 red (magnified: source poverty).
    vec2 duv = TEXCOORD_BASE_COLOR;
    vec2 ts = vec2(textureSize(u_baseColorTexture, 0));
    float tpp = max(length(dFdx(duv) * ts), length(dFdy(duv) * ts));
    float mpp = max(length(dFdx(pEC)), length(dFdy(pEC)));
    float m = clamp(-log2(max(tpp, 1e-6)) / 3.0, -1.0, 1.0);
    vec3 heat = m < 0.0 ? mix(vec3(0.1, 0.8, 0.2), vec3(0.1, 0.3, 1.0), -m) : mix(vec3(0.1, 0.8, 0.2), vec3(1.0, 0.15, 0.1), m);
    // texels per metre bands every 10 texels/m (thin dark lines)
    float tpm = tpp / max(mpp, 1e-6);
    heat *= 0.75 + 0.25 * smoothstep(0.0, 0.15, abs(fract(tpm / 10.0) - 0.5));
    material.diffuse = czm_srgbToLinear(heat);
    return;
  }
  #endif
  vec3 n = normalize(cross(dFdx(pEC), dFdy(pEC)));
  if (dot(n, -pEC) < 0.0) n = -n;
  vec3 upEC = normalize(czm_viewRotation * normalize(pWC));
  float up = dot(n, upEC);
  float flatW = smoothstep(0.72, 0.92, up);
  float wallW = 1.0 - smoothstep(0.3, 0.6, up);

  vec3 a = max(albedo, vec3(1e-4));
  float sum = a.r + a.g + a.b;
  float exg = (2.0 * a.g - a.r - a.b) / sum;
  // green over blue tells grass and trees (g >> b) from teal water (g ~ b)
  float gb = (a.g - a.b) / sum;
  float veg = smoothstep(u_th_vegLo, u_th_vegHi, exg) * smoothstep(0.015, 0.06, gb);
  float blue = smoothstep(0.0, 0.06, (a.b - a.r) / sum) * (1.0 - smoothstep(0.03, 0.08, gb)) * flatW * (1.0 - veg);
  float l = th_luma(a);
  float mx = max(a.r, max(a.g, a.b));
  float chroma = (mx - min(a.r, min(a.g, a.b))) / max(mx, 1e-4);
  float neutral = (1.0 - smoothstep(0.12, 0.3, chroma)) * (1.0 - veg) * (1.0 - blue);

  vec3 vegC = mix(czm_srgbToLinear(u_th_canopy), czm_srgbToLinear(u_th_grass), flatW);
  vec3 waterC = mix(czm_srgbToLinear(u_th_waterDeep), czm_srgbToLinear(u_th_water), smoothstep(0.02, 0.12, l));
  float h = th_hash(floor(pWC.xy / u_th_cellM) + floor(pWC.z / u_th_cellM));
  vec3 roof = h < 0.3 ? czm_srgbToLinear(u_th_roofA) : (h < 0.55 ? czm_srgbToLinear(u_th_roofB) : (h < 0.8 ? czm_srgbToLinear(u_th_roofC) : czm_srgbToLinear(u_th_roofD)));
  roof = mix(czm_srgbToLinear(u_th_roofC), roof, u_th_roofVariety);
  vec3 flatNeutral = mix(czm_srgbToLinear(u_th_street), roof, smoothstep(0.12, 0.3, l));
  vec3 neutralC = mix(czm_srgbToLinear(u_th_wall), flatNeutral, 1.0 - wallW);

  vec3 other = a / max(l, 1e-3) * 0.42;
  vec3 pal = other;
  pal = mix(pal, neutralC, neutral);
  pal = mix(pal, waterC, blue);
  pal = mix(pal, vegC, veg);
  // de-light: palette value vs the photo's own (baked-shadow) luminance
  vec3 keepLight = pal * (th_luma(max(albedo, vec3(1e-4))) / max(th_luma(pal), 1e-3));
  pal = mix(keepLight, pal, u_th_delight);
  float detail = clamp(th_luma(max(photo, vec3(1e-4))) / max(l, 1e-3), 0.6, 1.5);
  pal *= mix(1.0, detail, u_th_detail);

  // Below the horizon the sun would light the world from underneath: blend
  // toward a high key from the sun's side, so night stays readable.
  vec3 L = czm_lightDirectionEC;
  float sunUp = dot(L, upEC);
  vec3 Lh = L - upEC * sunUp;
  vec3 Lfix = normalize(upEC * 0.8 + normalize(Lh + upEC * 1e-3) * 0.6);
  L = normalize(mix(Lfix, L, smoothstep(0.0, 0.25, sunUp)));
  float ndl = dot(n, L);
  float w = clamp((ndl + u_th_wrap) / (1.0 + u_th_wrap), 0.0, 1.0);
  float b = w * u_th_bands;
  float toon = (floor(b) + smoothstep(0.3, 0.7, fract(b))) / u_th_bands;
  vec3 lightC = mix(czm_srgbToLinear(u_th_shadow), u_th_key, toon);
  vec3 lit = pal * mix(vec3(1.0), lightC, u_th_relight);
  material.diffuse = mix(photo, lit, u_th_strength);
}
`;

/** The tile stage as a shader-host part (see tileShaderHost.js). */
export function tileStagePart(Cesium, values = {}) {
  const T = Cesium.UniformType;
  const uniforms = {
    u_th_wipe: { type: T.FLOAT, value: Number(values.wipe ?? 0) },
  };
  for (const [k, spec] of Object.entries(TILE_UNIFORMS)) {
    const v = values[k] ?? spec.default;
    uniforms[`u_th_${k}`] =
      spec.type === 'color'
        ? { type: T.VEC3, value: new Cesium.Cartesian3(v[0], v[1], v[2]) }
        : { type: T.FLOAT, value: Number(v) };
  }
  return {
    id: 'theme',
    order: 0,
    lightingModel: Cesium.LightingModel.UNLIT,
    uniforms,
    glsl: TILE_GLSL,
    body: 'th_material(fsInput, material);',
  };
}

/** A uniform value of the tile stage as Cesium wants it. */
export function tileUniformValue(Cesium, key, value) {
  const spec = TILE_UNIFORMS[key];
  if (spec?.type === 'color')
    return new Cesium.Cartesian3(value[0], value[1], value[2]);
  return Number(value);
}
