import * as Cesium from 'cesium';
import { FACADE } from '../data/cityMassingFacade.js';

// The massing block drawn as a building: a Cesium fabric material on the
// block's own polygon. The polygon's texture coordinates carry no height, so
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
float gevHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec3 toOrigin = (gevOriginHigh - czm_encodedCameraPositionMCHigh) +
    (gevOriginLow - czm_encodedCameraPositionMCLow);
  vec3 world = czm_inverseViewRotation * -materialInput.positionToEyeEC - toOrigin;
  vec3 p = vec3(dot(world, gevEast), dot(world, gevNorth), dot(world, gevUp));
  vec3 normal = czm_inverseViewRotation * materialInput.normalEC;
  vec3 n = vec3(dot(normal, gevEast), dot(normal, gevNorth), dot(normal, gevUp));
  float storeys = gevLevels.x;
  float storeyMeters = gevLevels.y;
  float top = gevLevels.z;
  float parapet = gevLevels.w;
  vec3 toEye = normalize(materialInput.positionToEyeEC);
  float sunward = dot(materialInput.normalEC, czm_lightDirectionEC);
  vec3 color;
  float edge;
  float pane = 0.0;
  if (n.z > 0.5) {
    // The roof: a membrane in panels, darker under the parapet, coping around.
    edge = min(
      min(gevWall0.z - dot(p.xy, gevWall0.xy), gevWall1.z - dot(p.xy, gevWall1.xy)),
      min(gevWall2.z - dot(p.xy, gevWall2.xy), gevWall3.z - dot(p.xy, gevWall3.xy)));
    float pixel = fwidth(edge);
    vec2 seam = abs(fract(p.xy / 4.0) - 0.5) * 4.0;
    color = ${rgb(colors.roof)} *
      (0.93 + 0.07 * smoothstep(0.0, 0.08 + pixel, 2.0 - max(seam.x, seam.y)));
    color *= 0.76 + 0.24 * smoothstep(0.4, 1.8, edge);
    color = mix(${rgb(colors.coping)}, color, smoothstep(0.4 - pixel, 0.4 + pixel, edge));
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
    float along = dot(p.xy, vec2(-wall.y, wall.x)) - middle;
    float bay = (along + halfLength) * bays / (2.0 * halfLength);
    float z = clamp(p.z, 0.0, top);
    float level = z / storeyMeters;
    float storey = min(floor(level), storeys - 1.0);
    float g = level - storey;
    float f = fract(bay);
    float aaBay = fwidth(bay);
    float aaLevel = fwidth(level);
    bool shop = storey < 0.5;
    float sill = shop ? ${number(shopfront.sill)} : ${number(floor.sill)};
    float head = shop ? ${number(shopfront.head)} : ${number(floor.head)};
    float share = shop ? ${number(shopfront.share)} : ${number(floor.share)};
    // Frames 8 cm wide around the glass and down its middle.
    float frameBay = 0.08 * bays / (2.0 * halfLength);
    float frameLevel = 0.08 / storeyMeters;
    float glass = gevBox(f, 0.5 - share / 2.0, 0.5 + share / 2.0, aaBay) *
      gevBox(g, sill, head, aaLevel);
    pane = gevBox(f, 0.5 - share / 2.0 + frameBay, 0.5 + share / 2.0 - frameBay, aaBay) *
      gevBox(g, sill + frameLevel, head - frameLevel, aaLevel) *
      (1.0 - gevBox(f, 0.5 - frameBay / 2.0, 0.5 + frameBay / 2.0, aaBay));
    // Stone in courses of panels, the piers a touch lighter than the bays.
    color = ${rgb(colors.body)} *
      (1.04 - 0.05 * gevBox(f, 0.5 - share / 2.0, 0.5 + share / 2.0, aaBay));
    color *= 1.0 + 0.05 * (gevHash(floor(vec2(bay * 4.0, level * 8.0))) - 0.5) *
      (1.0 - smoothstep(0.08, 0.3, max(aaBay * 4.0, aaLevel * 8.0)));
    if (shop) {
      color = mix(color, ${rgb(colors.frame)}, 0.22);
      color = mix(color, ${rgb(colors.fascia)},
        gevBox(g, ${number(fascia.bottom)}, ${number(fascia.top)}, aaLevel));
    } else {
      // A course at each floor line.
      color *= 1.0 - 0.14 * gevBox(g, -1.0, 0.045, aaLevel);
    }
    color = mix(color, ${rgb(colors.frame)}, glass);
    // Each window its own: darker or lighter glass, some with a blind down.
    float room = gevHash(vec2(floor(bay) + 31.0 * id, storey));
    vec3 glazing = ${rgb(colors.glass)} * (0.7 + 0.9 * room);
    float blind = step(0.58, room) *
      step(mix(head, sill, 0.25 + 0.45 * fract(room * 13.0)), g);
    glazing = mix(glazing, ${rgb(colors.blind)} * 0.82, blind);
    float fresnel = pow(1.0 - max(dot(materialInput.normalEC, toEye), 0.0), 3.0);
    glazing = mix(glazing, vec3(0.62, 0.74, 0.86), (1.0 - blind) * (0.16 + 0.6 * fresnel));
    // The glass sits back in the wall: the head throws a shade on it.
    glazing *= 1.0 - 0.4 * smoothstep(head - 0.2 * (head - sill), head, g);
    color = mix(color, glazing, pane);
    // Where the wall meets the ground.
    color *= 0.84 + 0.16 * smoothstep(0.0, 0.9, z);
    // The parapet: coping over a shadow line, above the top windows.
    color *= 1.0 - 0.2 * gevBox(z, top - parapet - 0.12, top - parapet, fwidth(z));
    color = mix(color, ${rgb(colors.coping)},
      smoothstep(top - parapet - fwidth(z), top - parapet + fwidth(z), z));
    // Finer than the pixels: settle to the wall's mean, no shimmer.
    vec3 mean = mix(${rgb(colors.body)}, ${rgb(colors.glass)} * 1.3, share * (head - sill));
    color = mix(color, mean, smoothstep(0.35, 0.9, max(aaBay, aaLevel)));
    edge = min(halfLength - abs(along), top - z);
  }
  // Lit by the scene sun. With the shadow map on, Cesium darkens the faces
  // turned from the sun itself (gevShade lifts them to skylight); with it
  // off, gevShade is the skylight.
  float lit = smoothstep(0.0, 0.2, sunward);
  color *= mix(gevShade, 0.82 + 0.18 * sunward, lit);
  float glint = pow(max(dot(reflect(-czm_lightDirectionEC, materialInput.normalEC), toEye), 0.0), 48.0);
  color += pane * lit * glint * 0.7;
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
