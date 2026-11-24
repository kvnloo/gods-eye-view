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
  vegGb: f(
    0.015,
    0,
    0.15,
    0.005,
    'Vegetation green-over-blue (teal water is not grass)',
  ),
  shadeVeg: f(0, 0, 1, 0.01, 'Shaded canopy (dark → trees)'),
  waterChroma: f(0, 0, 0.6, 0.01, 'Water minimum chroma'),
  darkFloor: f(0, 0, 0.3, 0.01, 'Dark shade floor (no cyan shadows)'),
  otherSat: f(1, 0, 1, 0.01, 'Unclassified colour saturation'),
  waterSeamKeep: f(
    0,
    0,
    1,
    0.01,
    'Water smoothness gate spares saturated water (no seam streaks)',
  ),
  waterGbMin: f(
    1,
    0,
    1,
    0.005,
    'Water: green may sit this far below blue (shade is bluer)',
  ),
  waterSmooth: f(
    0,
    0,
    1,
    0.01,
    'Water must be smooth (share of textured ring taps, 0 = off)',
  ),
  neutralChroma: f(
    1,
    0.5,
    3,
    0.05,
    'Neutral class reach (more roofs/walls in palette)',
  ),
  waterStrength: f(
    0,
    0,
    1,
    0.01,
    'Strength floor on water (class-scoped: keep palette water when strength < 1)',
  ),
  vegStrength: f(0, 0, 1, 0.01, 'Strength floor on vegetation'),
  vegFlatRg: f(
    0,
    0,
    1,
    0.01,
    'Flat vegetation needs red/green ≥ this (green-tinted shallows → water, 0 = off)',
  ),
  photoSat: f(1, 0, 1.2, 0.01, 'Photo share: saturation (strength < 1)'),
  photoWarm: f(0, 0, 1, 0.01, 'Photo share: warm tint (strength < 1)'),
  classTexels: f(
    0,
    0,
    24,
    0.5,
    'Classifier ring (texels; wider = fewer speckled class edges, 0 = flatten ring)',
  ),
  flattenRings: f(1, 1, 2, 1, 'Flatten rings (2 = smoother, 17 taps)'),
  shadeWarm: f(0, 0, 1, 0.01, 'Shade → warm neutral (de-light lift)'),
  vegChroma: f(1, 0.2, 1.5, 0.01, 'Vegetation photo-hue kept'),
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
  // ---- OSM class mask (loop v3): OpenStreetMap water / park / forest /
  // building / road classes per world position (osmMask.js), blended over the
  // per-pixel classifier; beyond the mask the classifier alone decides
  osm: f(0, 0, 1, 0.01, 'OSM class mask (OpenStreetMap classes)'),
  osmWaterTrust: f(0.85, 0, 1, 0.01, 'OSM: no water where OSM has land'),
  osmVeg: f(1, 0, 1, 0.01, 'OSM: parks and woods painted green'),
  osmDelight: f(0.85, 0, 1, 0.01, 'OSM: de-light on mapped surfaces (calmer)'),
  osmStrength: f(0, 0, 1, 0.01, 'OSM: strength floor on mapped surfaces'),
  osmRoof: f(1, 0, 1, 0.01, 'OSM: one roof colour per building'),
  osmEdge: f(0, 0, 1, 0.01, 'OSM: roof eave line along footprints (crisp)'),
  osmEdgeM: f(2.5, 0.5, 8, 0.1, 'OSM: eave line width (m)'),
  shallowM: f(30, 2, 120, 1, 'Shallows width (m from shore)'),
  foamM: f(3, 0, 20, 0.5, 'Shore foam width (m)'),
  foamAmt: f(0.35, 0, 1, 0.01, 'Shore foam'),
  mottle: f(0.06, 0, 0.3, 0.01, 'Soft mottle on grass and woods'),
  conifer: color(hex('#23402c'), 'Woods (conifer)'),
  foam: color(hex('#e6ece4'), 'Foam'),
  debugOsm: f(0, 0, 1, 1, 'OSM mask overlay (debug)'),
  debugClass: {
    type: 'bool',
    default: 0,
    label: msg('Classifier view (debug)'),
  },
  debugTexel: {
    type: 'bool',
    default: 0,
    label: msg('Texel density heatmap (debug)'),
  },
});

export const TILE_GLSL = /* glsl */ `
float th_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float th_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float th_vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  i = mod(i, 289.0);
  return mix(mix(th_hash(i), th_hash(i + vec2(1.0, 0.0)), f.x), mix(th_hash(i + vec2(0.0, 1.0)), th_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void th_material(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_th_strength <= 0.001) return;
  if (gl_FragCoord.x < u_th_wipe * czm_viewport.z + czm_viewport.x) return;
  vec3 photo = material.diffuse; // linear
  vec3 albedo = photo;
  // local texture contrast from the flatten ring (0 = no ring): open water
  // is smooth, roofs and streets in shade (also blue-cast) are not
  float texC = 0.0;
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
      float wsum = 1.0;
      float ls[8];
      float lsum = th_luma(albedo);
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.7853982;
        vec3 s = czm_srgbToLinear(texture(u_baseColorTexture, uv + vec2(cos(ang), sin(ang)) * t, u_th_flatten).rgb);
        ls[i] = th_luma(s);
        lsum += ls[i];
        acc += s;
      }
      // share of ring taps more than 20% off the local mean: a texture seam
      // or a wake moves 2-3 of 8 taps, a roof or street most of them
      float lmean = max(lsum / 9.0, 0.01);
      float off = 0.0;
      for (int i = 0; i < 8; i++) off += step(0.2, abs(ls[i] - lmean) / lmean);
      texC = off / 8.0;
      wsum += 8.0;
      if (u_th_flattenRings > 1.5) {
        // inner ring, rotated half a step: 17 taps, smoother patches
        for (int i = 0; i < 8; i++) {
          float ang = float(i) * 0.7853982 + 0.3926991;
          acc += czm_srgbToLinear(texture(u_baseColorTexture, uv + vec2(cos(ang), sin(ang)) * t * 0.5, u_th_flatten).rgb);
        }
        wsum += 8.0;
      }
      albedo = acc / wsum;
    }
  }
  #endif
  // the classifier may look at a wider neighbourhood than the colour: class
  // edges then follow blobs, not single texels (no speckled class flips)
  vec3 classA = albedo;
  #ifdef HAS_BASE_COLOR_TEXTURE
  if (u_th_classTexels > 0.0) {
    vec2 cuv = TEXCOORD_BASE_COLOR;
    #ifdef HAS_BASE_COLOR_TEXTURE_TRANSFORM
    cuv = computeTextureTransform(cuv, u_baseColorTextureTransform);
    #endif
    vec2 ct = u_th_classTexels / vec2(textureSize(u_baseColorTexture, 0));
    vec3 cacc = albedo * 2.0;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853982 + 0.2;
      cacc += czm_srgbToLinear(texture(u_baseColorTexture, cuv + vec2(cos(ang), sin(ang)) * ct).rgb);
    }
    classA = cacc / 10.0;
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

  vec3 a = max(classA, vec3(1e-4));
  float sum = a.r + a.g + a.b;
  float exg = (2.0 * a.g - a.r - a.b) / sum;
  // green over blue tells grass and trees (g >> b) from teal water (g ~ b)
  float gb = (a.g - a.b) / sum;
  float l = th_luma(a);
  float mx = max(a.r, max(a.g, a.b));
  // darkFloor: shade in photos carries a blue cast; dividing by a dark max
  // makes it look saturated (then de-lighting paints it bright cyan)
  float chroma = (mx - min(a.r, min(a.g, a.b))) / max(mx, max(u_th_darkFloor, 1e-4));
  float veg = smoothstep(u_th_vegLo, u_th_vegHi, exg) * smoothstep(u_th_vegGb, u_th_vegGb + 0.045, gb);
  // dark, not-red pixels are mostly shaded tree canopy in photogrammetry
  // (bluish in shade): shadeVeg sends them to the canopy colour, not water
  float shade = u_th_shadeVeg * (1.0 - smoothstep(0.025, 0.08, l)) * step(a.r, a.g * 1.08);
  veg = max(veg, shade);
  // green-tinted shallows (algae, silt) pass the vegetation test on flat
  // ground; grass and lawns carry more red than they do: send them to water
  float algae = 0.0;
  if (u_th_vegFlatRg > 0.0) {
    algae = veg * flatW * (1.0 - smoothstep(u_th_vegFlatRg - 0.06, u_th_vegFlatRg, a.r / max(a.g, 1e-4)));
    veg -= algae;
  }
  float blue = smoothstep(0.0, 0.06, (a.b - a.r) / sum) * (1.0 - smoothstep(u_th_vegGb + 0.015, u_th_vegGb + 0.065, gb)) * flatW * (1.0 - veg);
  // open water is a saturated teal/blue; dull bluish surfaces are not
  blue *= smoothstep(u_th_waterChroma, u_th_waterChroma + 0.1, chroma);
  blue *= smoothstep(-u_th_waterGbMin - 0.02, -u_th_waterGbMin, gb);
  blue = max(blue, algae);
  // waterSeamKeep: the smoothness gate spares saturated candidates, so open
  // water keeps its class across texture seams and wakes (white streaks)
  if (u_th_waterSmooth > 0.0)
    blue *= 1.0 - smoothstep(u_th_waterSmooth, u_th_waterSmooth + 0.25, texC) *
      (1.0 - u_th_waterSeamKeep * smoothstep(u_th_waterChroma + 0.1, u_th_waterChroma + 0.3, chroma));
  float neutral = (1.0 - smoothstep(0.12 * u_th_neutralChroma, 0.3 * u_th_neutralChroma, chroma)) * (1.0 - veg) * (1.0 - blue);

  // ---- OSM class mask (loop v3). Local ENU metres at the atlas anchor from
  // a CPU double-precision eye matrix; ENU -> web-mercator tile units by a
  // second-order expansion (data/osmMask/maskMath.js localToTile). Manual
  // bilinear over 4 texelFetch taps: ids (B) must not be filtered.
  float oValid = 0.0, oShore = -64.0, oGrass = 0.0, oForest = 0.0, oBld = 0.0, oRoad = 0.0, oId = 0.0, oEdgeD = 0.0;
  vec2 pL = vec2(0.0);
  if ((u_th_osm > 0.001 || u_th_debugOsm > 0.5) && u_th_osmInfo.x > 0.001 && u_th_osmInfo.w > 0.5) {
    pL = (u_th_osmEyeToLocal * vec4(pEC, 1.0)).xy;
    float X = u_th_osmGeo.x * pL.x * (1.0 + u_th_osmGeo.z * pL.y);
    float Y = -u_th_osmGeo.y * (pL.y + 0.5 * u_th_osmGeo.z * pL.y * pL.y - 0.5 * u_th_osmGeo.w * pL.x * pL.x);
    float halfN = 0.5 * u_th_osmInfo.y / u_th_osmInfo.z;
    vec2 tc = (vec2(X, Y) + halfN) * u_th_osmInfo.z - 0.5;
    float apx = u_th_osmInfo.y;
    if (tc.x > 0.0 && tc.y > 0.0 && tc.x < apx - 1.5 && tc.y < apx - 1.5) {
      ivec2 i0 = ivec2(floor(tc));
      vec2 fw = fract(tc);
      vec4 t00 = texelFetch(u_th_osmMask, i0, 0);
      vec4 t10 = texelFetch(u_th_osmMask, i0 + ivec2(1, 0), 0);
      vec4 t01 = texelFetch(u_th_osmMask, i0 + ivec2(0, 1), 0);
      vec4 t11 = texelFetch(u_th_osmMask, i0 + ivec2(1, 1), 0);
      vec4 wq = vec4((1.0 - fw.x) * (1.0 - fw.y), fw.x * (1.0 - fw.y), (1.0 - fw.x) * fw.y, fw.x * fw.y);
      vec4 rr = vec4(t00.r, t10.r, t01.r, t11.r);
      vec4 gg = vec4(t00.g, t10.g, t01.g, t11.g) * 255.0;
      vec4 ib = vec4(t00.b, t10.b, t01.b, t11.b) * 255.0;
      vec4 aa = vec4(t00.a, t10.a, t01.a, t11.a) * 255.0;
      oShore = (dot(rr, wq) * 255.0 - 127.5) * 0.5;
      oGrass = dot(step(64.0, gg) * (1.0 - step(192.0, gg)), wq);
      oForest = dot(step(192.0, gg), wq);
      vec4 isR = step(0.5, ib) * (1.0 - step(1.5, ib));
      vec4 isB = step(1.5, ib);
      oRoad = dot(isR, wq);
      oBld = dot(isB, wq);
      // the id of the heaviest building tap (one colour per footprint)
      vec4 bw4 = isB * (wq + 1e-3);
      float m1 = max(max(bw4.x, bw4.y), max(bw4.z, bw4.w));
      oId = m1 == bw4.x ? ib.x : (m1 == bw4.y ? ib.y : (m1 == bw4.z ? ib.z : ib.w));
      // fade over the outer tile of the atlas and with the global fade
      float edgeT = min(min(X, Y) + halfN, halfN - max(X, Y));
      oValid = dot(step(0.5, aa), wq) * smoothstep(0.15, 1.2, edgeT) * u_th_osmInfo.x;
      // metres from the footprint edge inside buildings (A: 1 + 20 m)
      oEdgeD = dot(max(aa - 1.0, 0.0), wq) / 20.0;
    }
  }
  float osmW = oValid * u_th_osm;
  float oWater = smoothstep(-1.0, 1.0, oShore) * (1.0 - max(oRoad, oBld));
  float oB = oBld;
  float oR = oRoad * (1.0 - oB);
  float oVeg = clamp(oGrass + oForest, 0.0, 1.0) * (1.0 - oWater) * (1.0 - oB) * (1.0 - oR);
  // unmapped trees: the classifier's vegetation stays (yards, street trees),
  // except on OSM water and (mostly) on flat roofs
  float vegKeep = veg * (1.0 - oWater) * (1.0 - 0.75 * oB * flatW);
  // the classifier's water is not trusted where OSM has land
  blue = mix(blue, blue * (1.0 - u_th_osmWaterTrust) * (1.0 - oB), osmW);
  #ifdef HAS_BASE_COLOR_TEXTURE
  if (u_th_debugOsm > 0.5) {
    // overlay of the OSM mask over the tile as served (alignment check):
    // water blue (darker offshore), shore line white, grass light green,
    // woods dark green, buildings orange by id with dark outlines, roads grey
    vec3 dc = photo;
    float cov = 0.0;
    vec3 oc = vec3(0.0);
    if (oValid > 0.001) {
      oc = mix(vec3(0.35, 0.7, 1.0), vec3(0.05, 0.2, 0.75), smoothstep(0.0, 40.0, oShore));
      cov = oWater;
      vec3 g = mix(vec3(0.55, 0.95, 0.35), vec3(0.05, 0.45, 0.1), oForest / max(oGrass + oForest, 1e-3));
      oc = mix(oc, g, oVeg); cov = max(cov, oVeg);
      oc = mix(oc, vec3(0.55), oR); cov = max(cov, oR);
      float hb = fract(oId * 0.6180339);
      oc = mix(oc, mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.8, 0.2), hb), oB); cov = max(cov, oB);
      float line = 1.0 - smoothstep(0.0, 0.6, abs(oShore));
      float edge = smoothstep(0.05, 0.3, oBld) * (1.0 - smoothstep(0.7, 0.95, oBld));
      dc = mix(photo, oc, 0.55 * cov * oValid);
      dc = mix(dc, vec3(1.0), line * oValid);
      dc = mix(dc, vec3(0.08, 0.02, 0.0), edge * oValid);
    }
    material.diffuse = dc;
    return;
  }
  #endif

  vec3 vegC = mix(czm_srgbToLinear(u_th_canopy), czm_srgbToLinear(u_th_grass), flatW);
  // vegChroma < 1 pulls the vegetation palette toward its own luminance
  vegC = mix(vec3(th_luma(vegC)), vegC, min(u_th_vegChroma, 1.0));
  vec3 waterC = mix(czm_srgbToLinear(u_th_waterDeep), czm_srgbToLinear(u_th_water), smoothstep(0.02, 0.12, l));
  // cell hash on small numbers: ECEF metres (~6e6) fed straight into
  // sin() lose float32 precision, and every roof got the same colour
  vec3 cell = mod(floor(pWC / u_th_cellM), 289.0);
  float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 roof = h < 0.3 ? czm_srgbToLinear(u_th_roofA) : (h < 0.55 ? czm_srgbToLinear(u_th_roofB) : (h < 0.8 ? czm_srgbToLinear(u_th_roofC) : czm_srgbToLinear(u_th_roofD)));
  roof = mix(czm_srgbToLinear(u_th_roofC), roof, u_th_roofVariety);
  vec3 flatNeutral = mix(czm_srgbToLinear(u_th_street), roof, smoothstep(0.12, 0.3, l));
  vec3 neutralC = mix(czm_srgbToLinear(u_th_wall), flatNeutral, 1.0 - wallW);

  vec3 other = a / max(l, 1e-3) * 0.42;
  // unclassified surfaces: keep only some photo chroma, toward a warm grey
  vec3 warmGrey = vec3(0.45, 0.42, 0.38);
  other = mix(warmGrey, other, u_th_otherSat);
  other = mix(warmGrey, other, smoothstep(0.0, max(u_th_darkFloor, 1e-4), l));
  #ifdef HAS_BASE_COLOR_TEXTURE
  if (u_th_debugClass > 0.5) {
    // veg green, water blue, neutral (by surface: wall/flat) greys, rest red
    vec3 dc = mix(vec3(0.8, 0.15, 0.1), mix(vec3(0.75), vec3(0.45), wallW), neutral);
    dc = mix(dc, vec3(0.1, 0.3, 0.9), blue);
    dc = mix(dc, vec3(0.1, 0.7, 0.15), veg);
    material.diffuse = czm_srgbToLinear(dc);
    return;
  }
  #endif
  vec3 pal = other;
  pal = mix(pal, neutralC, neutral);
  pal = mix(pal, waterC, blue);
  pal = mix(pal, vegC, veg);
  // ---- OSM classes over the classifier palette
  float osmCover = 0.0;
  if (osmW > 0.001) {
    // roads: warm grey/earth (street trees keep their canopy)
    pal = mix(pal, czm_srgbToLinear(u_th_street), oR * osmW * (1.0 - vegKeep));
    // buildings: one roof colour per footprint id (not per screen cell), walls by normal
    float hb = fract(oId * 0.6180339 + 0.13);
    vec3 roofO = hb < 0.3 ? czm_srgbToLinear(u_th_roofA) : (hb < 0.55 ? czm_srgbToLinear(u_th_roofB) : (hb < 0.8 ? czm_srgbToLinear(u_th_roofC) : czm_srgbToLinear(u_th_roofD)));
    roofO = mix(czm_srgbToLinear(u_th_roofC), roofO, u_th_roofVariety);
    roofO *= 0.94 + 0.12 * fract(oId * 0.3819660 + 0.71);
    vec3 bldC = mix(czm_srgbToLinear(u_th_wall), roofO, 1.0 - wallW);
    pal = mix(pal, bldC, oB * osmW * u_th_osmRoof * (1.0 - 0.6 * vegKeep));
    // eave line: a darker rim just inside each OSM footprint, on roofs only
    // (crisp painted roof edges; world-anchored, so it does not shimmer)
    float rim = smoothstep(0.3, 0.6, oBld) * (1.0 - smoothstep(0.5 * u_th_osmEdgeM, u_th_osmEdgeM, oEdgeD));
    pal *= 1.0 - u_th_osmEdge * 0.45 * rim * osmW * (1.0 - wallW) * (1.0 - vegKeep);
    // parks / grass: moss green with a soft world-anchored mottle; woods: dark conifer
    float mt = th_vnoise(pL / 9.0) * 0.7 + th_vnoise(pL / 3.3) * 0.3 - 0.5;
    vec3 grassO = czm_srgbToLinear(u_th_grass) * (1.0 + 2.0 * u_th_mottle * mt);
    vec3 forestO = czm_srgbToLinear(u_th_conifer) * (1.0 + 3.0 * u_th_mottle * mt);
    vec3 vegO = mix(grassO, forestO, oForest / max(oGrass + oForest, 1e-3));
    vegO = mix(vegO, czm_srgbToLinear(u_th_wall), wallW * 0.5);
    pal = mix(pal, vegO, oVeg * osmW * u_th_osmVeg * (1.0 - 0.5 * vegKeep));
    // water: shallows -> deep by distance to the OSM shore, gentle foam at the shore
    vec3 waterO = mix(czm_srgbToLinear(u_th_water), czm_srgbToLinear(u_th_waterDeep), smoothstep(2.0, u_th_shallowM, oShore));
    float foamW = smoothstep(-0.5, 0.5, oShore) * (1.0 - smoothstep(0.0, max(u_th_foamM, 0.01), oShore));
    foamW *= 0.55 + 0.45 * th_vnoise(pL / 2.5);
    waterO = mix(waterO, czm_srgbToLinear(u_th_foam), foamW * u_th_foamAmt);
    pal = mix(pal, waterO, oWater * osmW * (1.0 - wallW * 0.7));
    osmCover = osmW * max(max(oWater, oB), max(oR, oVeg * u_th_osmVeg));
    blue = mix(blue, oWater, osmW);
    veg = mix(veg, max(vegKeep, oVeg * u_th_osmVeg), osmW);
  }
  // de-light: palette value vs the photo's own (baked-shadow) luminance;
  // surfaces OSM names are de-lit more (calmer, painted)
  vec3 keepLight = pal * (th_luma(max(albedo, vec3(1e-4))) / max(th_luma(pal), 1e-3));
  pal = mix(keepLight, pal, mix(u_th_delight, max(u_th_delight, u_th_osmDelight), osmCover));
  // shadeWarm: photo shade (dark, blue-cast) is lifted toward a warm neutral
  // of the palette instead of keeping its cyan cast
  float shadeW = u_th_shadeWarm * (1.0 - smoothstep(0.02, 0.12, l)) * smoothstep(-0.02, 0.06, (a.b - a.r) / sum) * (1.0 - veg) * (1.0 - blue);
  pal = mix(pal, vec3(th_luma(pal)) * vec3(1.06, 1.0, 0.92), shadeW);
  float detail = clamp(th_luma(max(photo, vec3(1e-4))) / max(l, 1e-3), 0.6, 1.5);
  pal *= mix(1.0, detail, u_th_detail * (1.0 - 0.5 * osmCover));

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
  // the photo share (strength < 1) is desaturated and warmed first, so the
  // photo's blue shade cast does not come back through the blend
  vec3 photoMix = mix(vec3(th_luma(photo)), photo, u_th_photoSat);
  photoMix *= mix(vec3(1.0), vec3(1.08, 1.0, 0.86), u_th_photoWarm);
  // class-scoped strength: water and vegetation may keep more palette than
  // the land blend (the photo-tint hybrid greys the bay otherwise)
  float s = u_th_strength;
  s = mix(s, max(s, u_th_waterStrength), blue);
  s = mix(s, max(s, u_th_vegStrength), veg);
  s = mix(s, max(s, u_th_osmStrength), osmCover);
  material.diffuse = mix(photoMix, lit, s);
}
`;

/** The tile stage as a shader-host part (see tileShaderHost.js). */
export function tileStagePart(Cesium, values = {}, runtime = {}) {
  const T = Cesium.UniformType;
  const uniforms = {
    u_th_wipe: { type: T.FLOAT, value: Number(values.wipe ?? 0) },
    // OSM class mask (osmMask.js); `runtime` carries the current values so
    // a tileset themed later starts with the live mask
    u_th_osmMask: {
      type: T.SAMPLER_2D,
      value:
        runtime.u_th_osmMask ??
        new Cesium.TextureUniform({
          typedArray: new Uint8Array(4),
          width: 1,
          height: 1,
          minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
          magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
        }),
    },
    u_th_osmEyeToLocal: {
      type: T.MAT4,
      value: runtime.u_th_osmEyeToLocal ?? Cesium.Matrix4.IDENTITY.clone(),
    },
    u_th_osmGeo: {
      type: T.VEC4,
      value: runtime.u_th_osmGeo ?? new Cesium.Cartesian4(0, 0, 0, 0),
    },
    u_th_osmInfo: {
      type: T.VEC4,
      value: runtime.u_th_osmInfo ?? new Cesium.Cartesian4(0, 1, 1, 0),
    },
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
