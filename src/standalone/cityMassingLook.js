import * as Cesium from 'cesium';
import { FACADE } from '../data/cityMassingFacade.js';

// The massing block drawn as a building, and the plate it stands on as
// paving: one Cesium fabric material on their own polygons. A polygon's
// texture coordinates carry no height, so
// the shader finds each fragment in metres east/north/up of the footprint's
// middle itself, relative to the eye (the camera and the origin both split
// high/low, so the metres hold at globe scale), and lays the facade out from
// the numbers of src/data/cityMassingFacade.js: storeys, bays, parapet.
export const FACADE_MATERIAL = 'GevCityMassingFacade';
// A face turned from the sun keeps this share of its colour (skylight).
const SHADE_SIDE = 0.5;

const rgb = (css) => {
  const { red, green, blue } = Cesium.Color.fromCssColorString(css);
  return `vec3(${[red, green, blue].map((v) => v.toFixed(4)).join(', ')})`;
};
const number = (value) => value.toFixed(4);
const { colors, shopfront, floor, fascia } = FACADE;

const SOURCE = `
float gevBox(float x, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, x) - smoothstep(hi - aa, hi + aa, x);
}
float gevRect(vec2 q, vec2 lo, vec2 hi, float aa) {
  return gevBox(q.x, lo.x, hi.x, aa) * gevBox(q.y, lo.y, hi.y, aa);
}
float gevHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
// A box painted on the roof deck as the eye sees it: the shade it throws, the
// side toward the eye and its top. lean and fall are how far a metre of
// height shifts along the deck for the eye and for the sun. No geometry: it
// adds nothing to the height or to the cast shadow.
vec3 gevPlant(vec3 color, vec2 q, vec2 lo, vec2 hi, float h, vec2 lean, vec2 fall, float aa, vec3 paint) {
  float shade = 0.0;
  float side = gevRect(q, lo, hi, aa);
  for (int i = 1; i <= 4; i++) {
    float t = h * float(i) / 4.0;
    shade = max(shade, gevRect(q - fall * t, lo, hi, aa));
    side = max(side, gevRect(q - lean * t, lo, hi, aa));
  }
  color *= 1.0 - 0.55 * shade;
  color = mix(color, paint * 0.62, side);
  return mix(color, paint, gevRect(q - lean * h, lo, hi, aa));
}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec3 toOrigin = (gevOriginHigh - czm_encodedCameraPositionMCHigh) +
    (gevOriginLow - czm_encodedCameraPositionMCLow);
  vec3 world = czm_inverseViewRotation * -materialInput.positionToEyeEC - toOrigin;
  vec3 p = vec3(dot(world, gevEast), dot(world, gevNorth), dot(world, gevUp));
  vec3 normal = czm_inverseViewRotation * materialInput.normalEC;
  vec3 n = vec3(dot(normal, gevEast), dot(normal, gevNorth), dot(normal, gevUp));
  vec3 toEye = normalize(materialInput.positionToEyeEC);
  vec3 eyeWorld = czm_inverseViewRotation * toEye;
  vec3 eye = vec3(dot(eyeWorld, gevEast), dot(eyeWorld, gevNorth), dot(eyeWorld, gevUp));
  vec3 sunWorld = czm_inverseViewRotation * czm_lightDirectionEC;
  vec3 sun = vec3(dot(sunWorld, gevEast), dot(sunWorld, gevNorth), dot(sunWorld, gevUp));
  float storeys = gevLevels.x;
  float storeyMeters = gevLevels.y;
  float top = gevLevels.z;
  float parapet = gevLevels.w;
  float sunward = dot(materialInput.normalEC, czm_lightDirectionEC);
  // Metres inside each wall: negative outside the footprint.
  vec4 inside = vec4(
    gevWall0.z - dot(p.xy, gevWall0.xy), gevWall1.z - dot(p.xy, gevWall1.xy),
    gevWall2.z - dot(p.xy, gevWall2.xy), gevWall3.z - dot(p.xy, gevWall3.xy));
  float within = min(min(inside.x, inside.y), min(inside.z, inside.w));
  vec3 color;
  float edge = 1000.0;
  float pane = 0.0;
  if (p.z < 0.2) {
    // The plate under the block: paving slabs, darker where the walls stand.
    vec2 joint = (0.5 - abs(fract(p.xy / 2.0) - 0.5)) * 2.0;
    color = ${rgb(colors.paving)} * (0.93 + 0.07 *
      smoothstep(0.0, 0.05 + fwidth(p.x) + fwidth(p.y), min(joint.x, joint.y)));
    color *= 1.0 - 0.45 * exp(min(within, 0.0) / 0.8);
  } else if (n.z > 0.5) {
    // The roof: a membrane in panels behind the parapet, which shades the
    // deck along the sides the sun comes over; coping around.
    float pixel = fwidth(within);
    vec2 seam = (0.5 - abs(fract(p.xy / 4.0) - 0.5)) * 4.0;
    color = ${rgb(colors.roof)} *
      (0.93 + 0.07 * smoothstep(0.0, 0.08 + pixel, min(seam.x, seam.y)));
    vec4 over = max(vec4(dot(gevWall0.xy, sun.xy), dot(gevWall1.xy, sun.xy),
      dot(gevWall2.xy, sun.xy), dot(gevWall3.xy, sun.xy)), 0.0) * parapet / max(sun.z, 0.05);
    vec4 lit = inside - 0.4 - over;
    float shaded = sun.z > 0.0
      ? 1.0 - smoothstep(-pixel, pixel, min(min(lit.x, lit.y), min(lit.z, lit.w)))
      : 0.0;
    color *= 1.0 - 0.5 * shaded;
    color *= 0.84 + 0.16 * smoothstep(0.4, 1.6, within);
    // Plant where the deck has room: a stair core and three units.
    float halfLength = gevWall0.w;
    float depth = inside.x + inside.z;
    if (halfLength > 9.0 && depth > 18.0) {
      vec2 along = vec2(-gevWall0.y, gevWall0.x);
      vec2 q = vec2(dot(p.xy, along) - gevMiddles.x, inside.x);
      vec2 lean = eye.z > 0.2 ? -eye.xy / eye.z : vec2(0.0);
      vec2 fall = sun.z > 0.05 ? -sun.xy / sun.z : vec2(0.0);
      lean = vec2(dot(lean, along), -dot(lean, gevWall0.xy));
      fall = vec2(dot(fall, along), -dot(fall, gevWall0.xy));
      color = gevPlant(color, q, vec2(6.0 - halfLength, 7.0), vec2(11.0 - halfLength, 11.5),
        2.6, lean, fall, pixel, ${rgb(colors.coping)} * 0.9);
      for (int unit = 0; unit < 3; unit++) {
        float x = 2.0 + 3.4 * float(unit);
        color = gevPlant(color, q, vec2(x, depth - 9.0), vec2(x + 2.2, depth - 6.8),
          1.3, lean, fall, pixel, vec3(0.74, 0.76, 0.78));
      }
    }
    color = mix(${rgb(colors.coping)}, color, smoothstep(0.4 - pixel, 0.4 + pixel, within));
    edge = within;
  } else {
    // The wall this fragment is on: the one its normal points along.
    vec4 wall = gevWall0;
    float middle = gevMiddles.x;
    float bays = gevBays.x;
    float id = 0.0;
    float best = dot(n.xy, wall.xy);
    float facing = dot(n.xy, gevWall1.xy);
    if (facing > best) { best = facing; wall = gevWall1; middle = gevMiddles.y; bays = gevBays.y; id = 1.0; }
    facing = dot(n.xy, gevWall2.xy);
    if (facing > best) { best = facing; wall = gevWall2; middle = gevMiddles.z; bays = gevBays.z; id = 2.0; }
    facing = dot(n.xy, gevWall3.xy);
    if (facing > best) { wall = gevWall3; middle = gevMiddles.w; bays = gevBays.w; id = 3.0; }
    float halfLength = wall.w;
    float bayMeters = 2.0 * halfLength / bays;
    float along = dot(p.xy, vec2(-wall.y, wall.x)) - middle;
    float bay = (along + halfLength) / bayMeters;
    float z = clamp(p.z, 0.0, top);
    float level = z / storeyMeters;
    float storey = min(floor(level), storeys - 1.0);
    float g = level - storey;
    float f = fract(bay);
    float aaBay = fwidth(bay);
    float aaLevel = fwidth(level);
    bool shop = storey < 0.5;
    // The door: the middle bay of the shopfront is glazed to the ground.
    bool door = shop && abs(floor(bay) - floor(bays / 2.0)) < 0.5;
    float sill = shop ? (door ? 0.02 : ${number(shopfront.sill)}) : ${number(floor.sill)};
    float head = shop ? ${number(shopfront.head)} : ${number(floor.head)};
    float share = shop ? ${number(shopfront.share)} : ${number(floor.share)};
    float lo = 0.5 - share / 2.0;
    float hi = 0.5 + share / 2.0;
    // A stone surround 16 cm wide, frames 7 cm wide: three lights to a
    // shopfront, two sashes to a window.
    vec2 trim = vec2(0.16 / bayMeters, 0.16 / storeyMeters);
    vec2 frame = vec2(0.07 / bayMeters, 0.07 / storeyMeters);
    float opening = gevBox(f, lo, hi, aaBay) * gevBox(g, sill, head, aaLevel);
    float lights = shop ? 3.0 : 2.0;
    float bar = frame.x * lights / share;
    pane = opening * gevBox(g, sill + frame.y, head - frame.y, aaLevel) *
      gevBox(fract((f - lo) / share * lights), bar, 1.0 - bar, aaBay * lights / share);
    // Stone in courses of panels, the piers a touch lighter than the bays.
    color = ${rgb(colors.body)} * (1.04 - 0.05 * gevBox(f, lo, hi, aaBay));
    color *= 1.0 + 0.05 * (gevHash(floor(vec2(bay * 4.0, level * 8.0))) - 0.5) *
      (1.0 - smoothstep(0.08, 0.3, max(aaBay * 4.0, aaLevel * 8.0)));
    if (shop) {
      // A plinth, and the sign band with the line of shade under it.
      color = mix(color * 0.95, ${rgb(colors.frame)}, 0.55 * gevBox(g, -1.0, 0.07, aaLevel));
      color = mix(color, ${rgb(colors.fascia)},
        gevBox(g, ${number(fascia.bottom)}, ${number(fascia.top)}, aaLevel));
      color *= 1.0 - 0.3 * gevBox(g, ${number(fascia.bottom)} - 0.04, ${number(fascia.bottom)}, aaLevel);
    } else {
      // A course at each floor line, a surround to each window and the
      // shade under its sill.
      color *= 1.0 - 0.14 * gevBox(g, -1.0, 0.045, aaLevel);
      color = mix(color, ${rgb(colors.coping)} * 0.97,
        gevBox(f, lo - trim.x, hi + trim.x, aaBay) * gevBox(g, sill - trim.y, head + trim.y, aaLevel));
      color *= 1.0 - 0.25 * gevBox(f, lo - trim.x, hi + trim.x, aaBay) *
        gevBox(g, sill - trim.y - 0.035, sill - trim.y, aaLevel);
    }
    color = mix(color, ${rgb(colors.frame)}, opening);
    // Each window its own: darker or lighter glass, some with a blind down;
    // the sky in it, more toward the head and at a glancing eye.
    float room = gevHash(vec2(floor(bay) + 31.0 * id, storey));
    vec3 glazing = ${rgb(colors.glass)} * (0.7 + 0.9 * room);
    float blind = shop ? 0.0 : step(0.58, room) *
      step(mix(head, sill, 0.25 + 0.45 * fract(room * 13.0)), g);
    glazing = mix(glazing, ${rgb(colors.blind)} * 0.82, blind);
    if (shop) glazing = mix(glazing, vec3(0.46, 0.5, 0.5), door ? 0.0 : 0.3);
    float fresnel = pow(1.0 - max(dot(materialInput.normalEC, toEye), 0.0), 3.0);
    glazing = mix(glazing, vec3(0.62, 0.74, 0.86), (1.0 - blind) *
      (0.12 + 0.55 * fresnel + 0.16 * smoothstep(sill, head, g)));
    // The glass sits back in the wall: the head throws a shade on it.
    glazing *= 1.0 - 0.4 * smoothstep(head - 0.2 * (head - sill), head, g);
    color = mix(color, glazing, pane);
    // The parapet: coping over a shadow line, above the top windows.
    color *= 1.0 - 0.2 * gevBox(z, top - parapet - 0.12, top - parapet, fwidth(z));
    color = mix(color, ${rgb(colors.coping)},
      smoothstep(top - parapet - fwidth(z), top - parapet + fwidth(z), z));
    // Finer than the pixels: settle to the wall's mean, no shimmer.
    vec3 mean = mix(${rgb(colors.body)}, ${rgb(colors.glass)} * 1.3, share * (head - sill));
    color = mix(color, mean, smoothstep(0.35, 0.9, max(aaBay, aaLevel)));
    edge = min(halfLength - abs(along), top - z);
  }
  // Lit by the scene sun. With the shadow map on, Cesium darkens the block's
  // faces turned from the sun itself (gevShade lifts them to skylight); with
  // it off, and on the plate, which casts nothing, the skylight is ours.
  float towards = smoothstep(0.0, 0.2, sunward);
  color *= mix(p.z < 0.2 ? ${number(SHADE_SIDE)} : gevShade, 0.82 + 0.18 * sunward, towards);
  float glint = pow(max(dot(reflect(-czm_lightDirectionEC, materialInput.normalEC), toEye), 0.0), 48.0);
  color += pane * towards * glint * 0.7;
  // A proposal, not a survey: a thin light along the roofline and corners.
  float line = 1.0 - smoothstep(0.0, max(0.16, 1.5 * fwidth(edge)), edge);
  material.diffuse = vec3(0.0);
  material.specular = 0.0;
  material.emission = color + ${rgb(colors.glow)} * 0.3 * line;
  material.alpha = 1.0;
  return material;
}
`;

const ZERO3 = new Cesium.Cartesian3();
const ZERO4 = new Cesium.Cartesian4();
// Constructing the material once registers its type for the entity pipeline:
// done when Cesium first asks the block for its material type (a browser frame).
let registered = false;
function register() {
  if (registered) return;
  registered = true;
  // The cached type is this instance: fromType copies its opacity from it.
  new Cesium.Material({
    translucent: false,
    fabric: {
      type: FACADE_MATERIAL,
      uniforms: {
        gevOriginHigh: ZERO3,
        gevOriginLow: ZERO3,
        gevEast: ZERO3,
        gevNorth: ZERO3,
        gevUp: ZERO3,
        gevWall0: ZERO4,
        gevWall1: ZERO4,
        gevWall2: ZERO4,
        gevWall3: ZERO4,
        gevMiddles: ZERO4,
        gevBays: ZERO4,
        gevLevels: ZERO4,
        gevShade: SHADE_SIDE,
      },
      source: SOURCE,
    },
  }).translucent = false;
}

/**
 * What the shader needs for a facade (`massingFacade`) standing at `base`
 * metres: where its origin is, the local east/north/up, its first four walls
 * (a plot footprint has four) and its levels. `shadowDarkness` is the shadow
 * map's darkness while it is on, else null.
 */
export function facadeUniforms(facade, base, shadowDarkness = null) {
  const origin = Cesium.Cartesian3.fromDegrees(...facade.origin, base);
  const encoded = Cesium.EncodedCartesian3.fromCartesian(origin);
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const axis = (i) =>
    Cesium.Cartesian3.fromCartesian4(
      Cesium.Matrix4.getColumn(frame, i, new Cesium.Cartesian4()),
    );
  const walls = [0, 1, 2, 3].map((i) => facade.walls[i] ?? facade.walls.at(-1));
  const each = (read) => new Cesium.Cartesian4(...walls.map(read));
  return {
    gevOriginHigh: encoded.high,
    gevOriginLow: encoded.low,
    gevEast: axis(0),
    gevNorth: axis(1),
    gevUp: axis(2),
    ...Object.fromEntries(
      walls.map((wall, i) => [
        `gevWall${i}`,
        new Cesium.Cartesian4(
          ...wall.normal,
          wall.offsetMeters,
          wall.lengthMeters / 2,
        ),
      ]),
    ),
    gevMiddles: each((wall) => wall.middleMeters),
    gevBays: each((wall) => wall.bays),
    gevLevels: new Cesium.Cartesian4(
      facade.storeys,
      facade.storeyHeightMeters,
      facade.heightMeters,
      facade.parapet.topMeters - facade.parapet.bottomMeters,
    ),
    gevShade: shadowDarkness ? SHADE_SIDE / shadowDarkness : SHADE_SIDE,
  };
}

/**
 * The block polygon's material: `read()` gives the uniforms as they now stand,
 * so a storey step or new ground shows on the next frame without a rebuild.
 */
export function facadeMaterial(read) {
  const property = {
    type: FACADE_MATERIAL,
    isConstant: false,
    definitionChanged: new Cesium.Event(),
    getType() {
      register();
      return FACADE_MATERIAL;
    },
    getValue: (time, result = {}) => Object.assign(result, read()),
    equals: (other) => other === property,
  };
  return property;
}
