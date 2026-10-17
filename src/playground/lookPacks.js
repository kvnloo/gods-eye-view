/**
 * Visual Universe seed: a curated, data-only palette over GEV's existing styles.
 * Each creative grade is one bounded color-only Cesium post-process pass.
 * It never changes sources, physical lighting, terrain, or scene evidence.
 */

export const GRADE_DEFAULTS = Object.freeze({
  exposure: 0,
  contrast: 1,
  saturation: 1,
  warmth: 0,
  tint: 0,
  vignette: 0,
  grain: 0,
});

export const GRADE_LIMITS = Object.freeze({
  exposure: [-0.35, 0.35],
  contrast: [0.75, 1.4],
  saturation: [0.55, 1.65],
  warmth: [-1, 1],
  tint: [-1, 1],
  vignette: [0, 1],
  grain: [0, 1],
});

const RAW_PACKS = [
  {
    id: 'original',
    title: 'Original Earth',
    family: 'Reality',
    description: 'Return to the ungraded globe.',
    style: 'normal',
    grade: null,
  },
  {
    id: 'cinematic-earth',
    title: 'Cinematic Earth',
    family: 'Realism',
    description: 'Clean detail, filmic contrast and restrained warmth. Not HDR reconstruction.',
    style: 'normal',
    grade: { exposure: 0.04, contrast: 1.13, saturation: 1.08, warmth: 0.12, vignette: 0.16 },
  },
  {
    id: 'storybook-wilds',
    title: 'Storybook Wilds',
    family: 'Fantasy',
    description: 'Warm, vivid cel-shaded exploration, inspired by painterly open-world adventures.',
    style: 'anime',
    grade: { exposure: 0.08, contrast: 1.06, saturation: 1.17, warmth: 0.48, vignette: 0.08 },
  },
  {
    id: 'frontier-film',
    title: 'Frontier Film',
    family: 'Cinema',
    description: 'Dusty golden-hour western color grade. It does not create new terrain or weather.',
    style: 'normal',
    grade: { exposure: 0.03, contrast: 1.17, saturation: 0.83, warmth: 0.7, vignette: 0.38, grain: 0.36 },
  },
  {
    id: 'witchwood',
    title: 'Witchwood',
    family: 'Fantasy',
    description: 'Cold, brooding dark-fantasy contrast and muted foliage.',
    style: 'normal',
    grade: { exposure: -0.12, contrast: 1.26, saturation: 0.68, warmth: -0.5, vignette: 0.64, grain: 0.12 },
  },
  {
    id: 'neon-nocturne',
    title: 'Neon Nocturne',
    family: 'Sci-fi',
    description: 'Electric color and magenta shadows. Works best with nighttime source imagery.',
    style: 'normal',
    grade: { exposure: -0.06, contrast: 1.31, saturation: 1.45, warmth: -0.32, tint: 0.58, vignette: 0.4 },
  },
  {
    id: 'space-opera',
    title: 'Space Opera',
    family: 'Sci-fi',
    description: 'A cool cyan holographic surveillance lens, not a spaceship or 3D asset generator.',
    style: 'surveillance',
    grade: { exposure: -0.04, contrast: 1.1, saturation: 0.65, warmth: -0.7, tint: -0.25, vignette: 0.32 },
  },
  {
    id: 'arcade-racer',
    title: 'Arcade Racer',
    family: 'Play',
    description: 'Punchy animation colors and playful outlines for sweeping globe flyovers.',
    style: 'anime',
    grade: { exposure: 0.09, contrast: 1.16, saturation: 1.58, warmth: 0.24 },
  },
  {
    id: 'polar-dream',
    title: 'Polar Dream',
    family: 'Atmosphere',
    description: 'An icy fantasy treatment over GEV’s existing snow visual effect.',
    style: 'snow',
    grade: { exposure: 0.04, contrast: 1.07, saturation: 0.74, warmth: -0.52, vignette: 0.14 },
  },
];

const VALID_STYLES = new Set([
  'normal', 'retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow',
]);

/** Validate a pack as data, never interpreted as executable shader source. */
export function isValidLookPack(pack) {
  if (!pack || typeof pack !== 'object' || typeof pack.id !== 'string' ||
      !/^[a-z0-9-]+$/.test(pack.id) ||
      !VALID_STYLES.has(pack.style) ||
      typeof pack.title !== 'string' || !pack.title ||
      typeof pack.family !== 'string' || !pack.family ||
      typeof pack.description !== 'string' || !pack.description ||
      (pack.grade === null && pack.id !== 'original') ||
      (pack.id === 'original' && (pack.grade !== null || pack.style !== 'normal')))
    return false;
  return pack.grade === null || (
    typeof pack.grade === 'object' && !Array.isArray(pack.grade) &&
    Object.entries(pack.grade).every(([key, value]) =>
      Object.hasOwn(GRADE_LIMITS, key) &&
      Number.isFinite(value) &&
      value >= GRADE_LIMITS[key][0] &&
      value <= GRADE_LIMITS[key][1])
  );
}

if (new Set(RAW_PACKS.map((pack) => pack.id)).size !== RAW_PACKS.length ||
    RAW_PACKS.some((pack) => !isValidLookPack(pack)))
  throw new Error('Invalid curated GEV look pack registry');

export const LOOK_PACKS = Object.freeze(RAW_PACKS.map((pack) =>
  Object.freeze({
    ...pack,
    grade: pack.grade && Object.freeze({ ...pack.grade }),
  }),
));

/** One static color sample, no camera/depth inference or continuous render loop. */
export const COLOR_GRADE_SHADER = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float exposure;
  uniform float contrast;
  uniform float saturation;
  uniform float warmth;
  uniform float tint;
  uniform float vignette;
  uniform float grain;
  in vec2 v_textureCoordinates;

  float filmNoise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec4 source = texture(colorTexture, uv);
    vec3 rgb = clamp(source.rgb * exp2(exposure), 0.0, 1.0);
    rgb = clamp((rgb - 0.5) * contrast + 0.5, 0.0, 1.0);
    float luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(vec3(luminance), rgb, saturation);
    rgb += warmth * vec3(0.075, 0.008, -0.075);
    rgb += tint * vec3(0.045, -0.036, 0.045);
    vec2 centered = uv * 2.0 - 1.0;
    rgb *= 1.0 - vignette * smoothstep(0.08, 1.6, dot(centered, centered)) * 0.42;
    rgb += (filmNoise(uv * colorTextureDimensions) - 0.5) * grain * 0.055;
    out_FragColor = vec4(clamp(rgb, 0.0, 1.0), source.a);
  }
`;

/**
 * Own a single optional grade stage for the whole Playground lifetime.
 * No persistent GPU work until the first creative grade is selected.
 */
export function createLookPackController({ viewer, Cesium, styleManager }) {
  let stage = null;
  let destroyed = false;
  let active = null;
  const stages = viewer.scene.postProcessStages;
  const render = () => viewer.scene.requestRender?.();

  return {
    get activeId() { return active; },
    apply(id) {
      if (destroyed) return false;
      const pack = LOOK_PACKS.find((entry) => entry.id === id);
      if (!pack || (pack.style !== 'normal' && !styleManager.stages?.[pack.style]))
        return false;
      // Construct before changing the user's chosen GEV style, so a
      // shader-creation failure cannot leave the selector in a false state.
      if (pack.grade && !stage) {
        stage = new Cesium.PostProcessStage({
          name: 'godsEyeView_creativeGrade',
          fragmentShader: COLOR_GRADE_SHADER,
          uniforms: { ...GRADE_DEFAULTS },
        });
        stage.enabled = false;
        stages.add(stage);
      }
      styleManager.setStyle(pack.style, {
        applyPreset: false,
        revealParameters: false,
        userInitiated: true,
      });
      if (stage) {
        Object.assign(stage.uniforms, GRADE_DEFAULTS, pack.grade || {});
        stage.enabled = Boolean(pack.grade);
      }
      active = pack.id;
      render();
      return true;
    },
    clearGrade() {
      if (destroyed) return;
      if (stage) stage.enabled = false;
      active = null;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (stage) stages.remove(stage);
      stage = null;
      active = null;
    },
  };
}
