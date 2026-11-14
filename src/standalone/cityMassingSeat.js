import * as Cesium from 'cesium';

// SPIKE (exp/city-real-asset-spike, not product): seating the building on 3D
// tiles. A shadow map gives the block's shadow one flat darkness and an edge
// one texel wide, and nothing at all where the building meets the ground. Here
// the light on a point beside the block is worked out from the block's own
// numbers (footprint walls, height) and the scene sun, the same in the tiles'
// shader and in the plate's material:
//   sun  = the share of the sun that reaches it: 0 inside the block's shadow,
//          with an edge that widens with the distance from the block;
//   sky  = the share of the sky the block leaves it: half at the foot of a
//          wall, all of it far away. It is there with the shadow map off.
// The shadow is as long as the shadow map's: the ray from the point to the sun
// meets a prism `top` metres high on the footprint.
// p is in metres east/north/up of the footprint's middle at the block's base;
// each wall is (outward normal, offset, half length), as cityMassingLook has it.
// tone = (the edge's width at the wall in metres, metres more per metre out,
// what a shadow keeps of red and of blue: the tiles' own shade is cooler).
export const SEAT_TONE = new Cesium.Cartesian4(0.5, 0.07, 1, 1);
export const SEAT_GLSL = `
float gevSeatFoot(vec2 q, vec4 w0, vec4 w1, vec4 w2, vec4 w3) {
  return max(max(dot(q, w0.xy) - w0.z, dot(q, w1.xy) - w1.z),
    max(dot(q, w2.xy) - w2.z, dot(q, w3.xy) - w3.z));
}
vec2 gevSeat(vec3 p, vec3 sun, float top, vec4 tone, vec4 w0, vec4 w1, vec4 w2, vec4 w3) {
  float rise = top - p.z;
  float d = max(gevSeatFoot(p.xy, w0, w1, w2, w3), 0.0);
  if (rise <= 0.0 || d > 12.0 * top) return vec2(1.0);
  float sky = 0.5 + 0.5 * d / sqrt(d * d + rise * rise);
  if (sun.z < 0.02) return vec2(1.0, sky);
  // Up the ray to the sun the point slides over the ground by 'slide' a metre
  // of height: in shadow when it is inside the footprint somewhere between the
  // block's base and its top. The least of a convex function of the height.
  vec2 slide = sun.xy / sun.z;
  float low = max(-p.z, 0.0);
  vec2 q = p.xy + slide * low;
  vec2 o = slide * (rise - low);
  vec4 g = vec4(dot(q, w0.xy) - w0.z, dot(q, w1.xy) - w1.z,
    dot(q, w2.xy) - w2.z, dot(q, w3.xy) - w3.z);
  vec4 a = vec4(dot(o, w0.xy), dot(o, w1.xy), dot(o, w2.xy), dot(o, w3.xy));
  float lo = 0.0;
  float hi = 1.0;
  for (int i = 0; i < 14; i++) {
    float m1 = mix(lo, hi, 1.0 / 3.0);
    float m2 = mix(lo, hi, 2.0 / 3.0);
    vec4 v1 = g + m1 * a;
    vec4 v2 = g + m2 * a;
    if (max(max(v1.x, v1.y), max(v1.z, v1.w)) < max(max(v2.x, v2.y), max(v2.z, v2.w))) hi = m2;
    else lo = m1;
  }
  vec4 v = g + 0.5 * (lo + hi) * a;
  float outside = max(max(v.x, v.y), max(v.z, v.w));
  float soft = tone.x + tone.y * d;
  return vec2(smoothstep(-0.5 * soft, 0.5 * soft, outside), sky);
}
// What is left of a colour. how = (the sun's shadow shows, the sky's share of
// the light: a shadow keeps that much, the hidden sky shows).
vec3 gevSeatLight(vec2 seat, vec3 how, vec4 tone) {
  float sun = mix(1.0, seat.x, how.x);
  return ((1.0 - how.y) * sun + how.y * mix(1.0, seat.y, how.z)) *
    mix(vec3(tone.z, 1.0, tone.w), vec3(1.0), sun);
}
`;

const GROUND_MATERIAL = 'GevCityMassingGround';
const GROUND_SOURCE = `${SEAT_GLSL}
float gevGroundHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
float gevGroundWeather(vec2 x) {
  vec2 cell = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(gevGroundHash(cell), gevGroundHash(cell + vec2(1.0, 0.0)), f.x),
    mix(gevGroundHash(cell + vec2(0.0, 1.0)), gevGroundHash(cell + vec2(1.0, 1.0)), f.x), f.y);
}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec3 toOrigin = (gevOriginHigh - czm_encodedCameraPositionMCHigh) +
    (gevOriginLow - czm_encodedCameraPositionMCLow);
  vec3 world = czm_inverseViewRotation * -materialInput.positionToEyeEC - toOrigin;
  vec3 p = vec3(dot(world, gevEast), dot(world, gevNorth), dot(world, gevUp));
  vec3 sunWorld = czm_inverseViewRotation * czm_lightDirectionEC;
  vec3 sun = vec3(dot(sunWorld, gevEast), dot(sunWorld, gevNorth), dot(sunWorld, gevUp));
  vec3 color;
  if (abs(dot(czm_inverseViewRotation * materialInput.normalEC, gevUp)) > 0.5) {
    // The plate: the colour the street around the plot shows, in worn slabs.
    vec2 joint = (0.5 - abs(fract(p.xy / 2.5) - 0.5)) * 2.0;
    color = gevGround * (0.96 + 0.04 *
      smoothstep(0.0, 0.04 + fwidth(p.x) + fwidth(p.y), min(joint.x, joint.y)));
    color *= 0.9 + 0.2 * gevGroundWeather(p.xy / 4.0);
  } else {
    // A wall that closes the cut: the neighbours' colour, streaked down, grimy at the foot.
    color = gevSides * (0.86 + 0.28 * gevGroundWeather(vec2((p.x + p.y) * 0.9, p.z * 0.25)));
    color *= 0.82 + 0.18 * smoothstep(0.0, 3.0, p.z);
  }
  color *= gevSeatLight(gevSeat(p, sun, gevLevels.z, gevSeatTone, gevWall0, gevWall1, gevWall2, gevWall3),
    gevSeatOn, gevSeatTone);
  material.diffuse = vec3(0.0);
  material.specular = 0.0;
  material.emission = color;
  material.alpha = 1.0;
  return material;
}
`;
const ZERO3 = new Cesium.Cartesian3();
const ZERO4 = new Cesium.Cartesian4();
const GROUND_UNIFORMS = {
  gevOriginHigh: ZERO3,
  gevOriginLow: ZERO3,
  gevEast: ZERO3,
  gevNorth: ZERO3,
  gevUp: ZERO3,
  gevWall0: ZERO4,
  gevWall1: ZERO4,
  gevWall2: ZERO4,
  gevWall3: ZERO4,
  gevLevels: ZERO4,
  gevGround: ZERO3,
  gevSides: ZERO3,
  gevSeatOn: ZERO3,
  gevSeatTone: ZERO4,
};
let registered = false;

/**
 * The plate's and the closing walls' material while the building is seated:
 * `read()` gives the facade's uniforms plus gevGround, gevSides (colours,
 * Cartesian3 0..1), gevSeatOn (gevSeatLight's `how`) and gevSeatTone.
 */
export function groundMaterial(read) {
  const property = {
    type: GROUND_MATERIAL,
    isConstant: false,
    definitionChanged: new Cesium.Event(),
    getType() {
      if (!registered) {
        registered = true;
        new Cesium.Material({
          translucent: false,
          fabric: {
            type: GROUND_MATERIAL,
            uniforms: GROUND_UNIFORMS,
            source: GROUND_SOURCE,
          },
        }).translucent = false;
      }
      return GROUND_MATERIAL;
    },
    getValue(time, result = {}) {
      const all = read() ?? {};
      for (const name of Object.keys(GROUND_UNIFORMS))
        if (all[name]) result[name] = all[name];
      return result;
    },
    equals: (other) => other === property,
  };
  return property;
}

/**
 * The tiles' shader while the building is seated. `place(ground, originEC)`
 * gives it the ground material's uniforms and the origin in eye coordinates
 * (worked out in doubles each frame: a float cannot hold an Earth-centred
 * metre). The tiles' colour is linear there, the
 * light a share of what the screen shows: hence the power.
 */
export function seatShader() {
  const { VEC3, VEC4 } = Cesium.UniformType;
  const shader = new Cesium.CustomShader({
    uniforms: {
      u_originEC: { type: VEC3, value: new Cesium.Cartesian3() },
      u_east: { type: VEC3, value: new Cesium.Cartesian3() },
      u_north: { type: VEC3, value: new Cesium.Cartesian3() },
      u_up: { type: VEC3, value: new Cesium.Cartesian3() },
      u_wall0: { type: VEC4, value: new Cesium.Cartesian4() },
      u_wall1: { type: VEC4, value: new Cesium.Cartesian4() },
      u_wall2: { type: VEC4, value: new Cesium.Cartesian4() },
      u_wall3: { type: VEC4, value: new Cesium.Cartesian4() },
      u_levels: { type: VEC4, value: new Cesium.Cartesian4() },
      u_seatOn: { type: VEC3, value: new Cesium.Cartesian3() },
      u_seatTone: { type: VEC4, value: new Cesium.Cartesian4() },
    },
    fragmentShaderText: `${SEAT_GLSL}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 world = czm_inverseViewRotation * (fsInput.attributes.positionEC - u_originEC);
  vec3 p = vec3(dot(world, u_east), dot(world, u_north), dot(world, u_up));
  vec3 sunWorld = czm_inverseViewRotation * czm_lightDirectionEC;
  vec3 sun = vec3(dot(sunWorld, u_east), dot(sunWorld, u_north), dot(sunWorld, u_up));
  material.diffuse *= pow(gevSeatLight(
    gevSeat(p, sun, u_levels.z, u_seatTone, u_wall0, u_wall1, u_wall2, u_wall3), u_seatOn, u_seatTone), vec3(2.2));
}`,
  });
  return {
    shader,
    place(look, originEC) {
      shader.setUniform('u_originEC', originEC);
      shader.setUniform('u_east', look.gevEast);
      shader.setUniform('u_north', look.gevNorth);
      shader.setUniform('u_up', look.gevUp);
      for (let i = 0; i < 4; i++)
        shader.setUniform(`u_wall${i}`, look[`gevWall${i}`]);
      shader.setUniform('u_levels', look.gevLevels);
      shader.setUniform('u_seatOn', look.gevSeatOn);
      shader.setUniform('u_seatTone', look.gevSeatTone);
    },
  };
}

/** The per-channel median of [r, g, b] samples (0..255) as a Cartesian3 0..1, or null. */
export function medianColour(samples) {
  if (!samples.length) return null;
  const mid = (k) =>
    samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1] / 255;
  return new Cesium.Cartesian3(mid(0), mid(1), mid(2));
}
