import * as Cesium from 'cesium';

// FORK-ONLY experiment (exp/city-game-hud, ?cityHud=drape): a concept is
// projected straight down onto the photoreal mesh of its plot, like a decal,
// instead of standing as a card or lying on a cut-out board. Nothing is cut,
// so there is no seam: the plot keeps the tiles' own relief, light and
// shadows, and the concept's colours take that shading. Upward faces take it
// fully, walls not at all; the edge feathers over a few metres and a thin
// cyan line marks the plot. One concept drapes at a time (the one shown on
// the selected plot, else the newest).
//
// The fragment's metres east/north/up of the plot centre come from eye-space
// positions against an eye-space centre the CPU updates every frame, so they
// hold at globe scale in float precision.
const FEATHER_METERS = 3;
const LINE_METERS = 0.7;
const STRENGTH = 0.9;

const FRAGMENT = /* glsl */ `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  if (u_drapeOn < 0.5) return;
  vec3 d = fsInput.attributes.positionEC - u_centerEC;
  vec2 p = vec2(dot(d, u_eastEC), dot(d, u_northEC));
  float up = dot(d, u_upEC);
  float edge = max(abs(p.x), abs(p.y));
  float inside = 1.0 - smoothstep(u_half - ${FEATHER_METERS.toFixed(1)}, u_half, edge);
  if (inside <= 0.0 && edge > u_half + 1.0) return;
  // Faces that look up take the projection; walls keep the photo.
  vec3 n = normalize(cross(dFdx(fsInput.attributes.positionEC), dFdy(fsInput.attributes.positionEC)));
  float upness = smoothstep(0.35, 0.8, abs(dot(n, u_upEC)));
  // Top-down projection in the capture view's frame: forward = image top.
  vec2 q = vec2(dot(p, u_right), dot(p, u_forward));
  vec2 st = q / (2.0 * u_half) + 0.5;
  vec3 concept = texture(u_concept, st).rgb;
  vec3 tile = material.diffuse;
  float lum = dot(tile, vec3(0.2126, 0.7152, 0.0722));
  float shade = clamp(lum / 0.42, 0.55, 1.15);
  float k = ${STRENGTH.toFixed(2)} * inside * upness * step(-6.0, up) * (1.0 - step(40.0, up));
  vec3 color = mix(tile, concept * shade, k);
  // The plot's edge, as a thin cyan line on the ground.
  float line = (1.0 - smoothstep(0.0, ${LINE_METERS.toFixed(2)}, abs(edge - u_half + 0.4))) * upness;
  color = mix(color, vec3(0.18, 0.78, 0.91), 0.65 * line);
  material.diffuse = color;
}
`;

/** One shader shared by every shown tileset; `set` / `clear` the drape. */
export function mountConceptDrape({ viewer }) {
  const scene = viewer?.scene;
  if (!scene || !Cesium.CustomShader) return null;
  let current = null; // { plot, image, heading }
  let shader = null;
  let texture = null;
  const owned = new Map(); // tileset -> customShader it had
  const centerWC = new Cesium.Cartesian3();
  const scratch = new Cesium.Cartesian4();

  function makeShader(image) {
    texture = new Cesium.TextureUniform({ url: image });
    return new Cesium.CustomShader({
      uniforms: {
        u_concept: { type: Cesium.UniformType.SAMPLER_2D, value: texture },
        u_centerEC: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3() },
        u_eastEC: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3() },
        u_northEC: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3() },
        u_upEC: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3() },
        u_right: { type: Cesium.UniformType.VEC2, value: new Cesium.Cartesian2(1, 0) },
        u_forward: { type: Cesium.UniformType.VEC2, value: new Cesium.Cartesian2(0, 1) },
        u_half: { type: Cesium.UniformType.FLOAT, value: 20 },
        u_drapeOn: { type: Cesium.UniformType.FLOAT, value: 0 },
      },
      fragmentShader: FRAGMENT,
    });
  }

  const tilesets = () =>
    Array.from({ length: scene.primitives.length }, (_, i) =>
      scene.primitives.get(i),
    ).filter((p) => p instanceof Cesium.Cesium3DTileset && p.show);

  function attach() {
    for (const tileset of tilesets()) {
      if (owned.has(tileset)) continue;
      owned.set(tileset, tileset.customShader);
      tileset.customShader = shader;
    }
  }
  function detach() {
    for (const [tileset, was] of owned)
      if (!tileset.isDestroyed?.()) tileset.customShader = was;
    owned.clear();
  }

  // Each frame: the plot centre and its east/north/up axes in eye space.
  const removePre = scene.preRender.addEventListener(() => {
    if (!current || !shader) return;
    const view = viewer.camera.viewMatrix;
    const c = Cesium.Matrix4.multiplyByPoint(view, centerWC, new Cesium.Cartesian3());
    shader.setUniform('u_centerEC', c);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centerWC);
    const axis = (i) => {
      Cesium.Matrix4.getColumn(enu, i, scratch);
      const v = new Cesium.Cartesian3(scratch.x, scratch.y, scratch.z);
      return Cesium.Matrix4.multiplyByPointAsVector(view, v, new Cesium.Cartesian3());
    };
    shader.setUniform('u_eastEC', axis(0));
    shader.setUniform('u_northEC', axis(1));
    shader.setUniform('u_upEC', axis(2));
  });

  return {
    /** Drape `image` over `plot` (base height in metres), the capture view's heading in degrees. */
    set({ plot, image, heading = 0, base = 0 }) {
      if (current?.plot.id === plot.id && current.image === image) return;
      detach();
      current = { plot, image, heading };
      shader = makeShader(image);
      Cesium.Cartesian3.fromDegrees(plot.center.lon, plot.center.lat, base, undefined, centerWC);
      const h = Cesium.Math.toRadians(heading);
      shader.setUniform('u_right', new Cesium.Cartesian2(Math.cos(h), -Math.sin(h)));
      shader.setUniform('u_forward', new Cesium.Cartesian2(Math.sin(h), Math.cos(h)));
      shader.setUniform('u_half', plot.sizeMeters / 2);
      shader.setUniform('u_drapeOn', 1);
      attach();
      scene.requestRender();
    },
    show(on) {
      if (!shader) return;
      shader.setUniform('u_drapeOn', on ? 1 : 0);
      if (on) attach();
      scene.requestRender();
    },
    clear(plotId = null) {
      if (!current || (plotId && current.plot.id !== plotId)) return;
      detach();
      current = null;
      shader = null;
      scene.requestRender();
    },
    get plotId() {
      return current?.plot.id ?? null;
    },
    destroy() {
      removePre();
      detach();
      current = null;
      shader = null;
    },
  };
}
