/**
 * @module render/cesium/themes/presets
 * @description FORK-ONLY (exp/theme-engine-v0). Theme presets: JSON like a
 * ReShade .ini. A preset is data only:
 *
 *   {
 *     "format": "gev-theme-preset/1",
 *     "name": "wintercats",
 *     "label": "Wintercats (cozy city builder)",
 *     "perfTier": "medium",            // low | medium | high (frame budget)
 *     "techniques": ["tile", "ao", "haze", ...],   // ordered, enabled
 *     "uniforms": { "<effect>": { "<uniform>": value } },
 *     "textures": { "lutTexture": "/themes/luts/wintercats.png" },
 *     "effects": [ <custom effect objects, see customEffects.js> ]
 *   }
 *
 * Effects not listed in `techniques` are off; uniforms not given take the
 * library defaults. `?preset=<name>` picks a built-in, `?preset=<url>` loads
 * a JSON file (same origin or CORS), `?theme=<name>` is an alias.
 */
import { EFFECT_IDS } from './effectLibrary.js';

export const PRESET_FORMAT = 'gev-theme-preset/1';
export const PERF_TIERS = Object.freeze({ low: 20, medium: 30, high: 45 });

// Colours from the locked wintercats reference (loop-v2/round-v5/style-loop
// best-build.png) and the wintercats frames; numbers, not images.
const WINTERCATS = {
  format: PRESET_FORMAT,
  name: 'wintercats',
  label: 'Wintercats (cozy painterly city builder)',
  perfTier: 'medium',
  techniques: [
    'tile',
    'ao',
    'haze',
    'dof',
    'bloom',
    'lut',
    'grade',
    'clarity',
    'cas',
    'vignette',
  ],
  uniforms: {
    tile: {
      strength: 1,
      // Google tiles carry no mip chain (probe on real tiles: 543/543
      // textures without mipmaps), so the mip bias does nothing there: use
      // the texel ring.
      flatten: 0,
      flattenTexels: 2.5,
      detail: 0.3,
      delight: 0.85,
      bands: 3,
      wrap: 0.6,
    },
    ao: { aoStrength: 0.5, aoMax: 0.4, aoTint: [0.5, 0.55, 0.85] },
    haze: {
      hazeStart: 3,
      hazeDensity: 0.04,
      hazeMax: 0.55,
      hazeColor: [0.7, 0.86, 0.9],
      skyTint: 0.25,
      skyColor: [0.62, 0.86, 0.92],
    },
    dof: {
      dofBlurPx: 6,
      focusRange: 0.45,
      tiltAmount: 0.35,
      tiltBand: 0.2,
      skyBlur: 0.4,
    },
    bloom: { bloomThreshold: 0.75, bloomIntensity: 0.6, bloomClamp: 0.1 },
    lut: { lutStrength: 0.7 },
    grade: {
      saturation: 0.96,
      vibrance: 0.1,
      temperature: 0.12,
      contrast: 1.04,
      lift: [0.02, 0.025, 0.05],
    },
    clarity: { clarity: -0.25, clarityRadiusPx: 8 },
    cas: { casSharpness: 0.25 },
    vignette: { vignette: 0.22, vignetteColor: [0.4, 0.38, 0.52] },
  },
  textures: { lutTexture: '/themes/luts/wintercats.png' },
};

// "Enhanced realism", in the spirit of the BotW "Digital Dreams" ReShade
// presets: keep the photo, add depth cues (AO, GI-lite), a golden grade,
// gentle DOF, bloom and sharpening. No tile restyle.
const ENHANCED = {
  format: PRESET_FORMAT,
  name: 'enhanced-realism',
  label: 'Enhanced realism (golden hour)',
  perfTier: 'high',
  techniques: [
    'ao',
    'gi',
    'haze',
    'dof',
    'godrays',
    'bloom',
    'grade',
    'clarity',
    'cas',
    'vignette',
    'grain',
  ],
  uniforms: {
    ao: { aoStrength: 0.6, aoMax: 0.5, aoTint: [0.62, 0.6, 0.72] },
    gi: { giStrength: 0.3 },
    haze: {
      hazeStart: 5,
      hazeDensity: 0.025,
      hazeMax: 0.45,
      hazeColor: [0.86, 0.84, 0.78],
    },
    dof: { dofBlurPx: 5, focusRange: 0.6, tiltAmount: 0, skyBlur: 0.2 },
    godrays: { raysIntensity: 0.5 },
    bloom: { bloomThreshold: 0.7, bloomIntensity: 0.8, bloomClamp: 0.14 },
    grade: {
      temperature: 0.3,
      contrast: 1.08,
      vibrance: 0.3,
      saturation: 1.02,
      lift: [0.01, 0.0, 0.03],
      gain: [1.04, 1.0, 0.94],
      shadows: 0.1,
      highlights: -0.1,
    },
    clarity: { clarity: 0.45 },
    cas: { casSharpness: 0.5 },
    vignette: { vignette: 0.25, vignetteColor: [0.3, 0.25, 0.22] },
    grain: { grain: 0.025 },
  },
  textures: {},
};

// The old ?look=cozy chain re-expressed as a preset (paint + palette-ish grade).
const COZY = {
  format: PRESET_FORMAT,
  name: 'cozy',
  label: 'Cozy valley (legacy ?look=cozy, screen-space only)',
  perfTier: 'medium',
  techniques: ['paint', 'haze', 'dof', 'bloom', 'lut', 'grade', 'vignette'],
  uniforms: {
    paint: { paintRadius: 3 },
    dof: { tiltAmount: 0.6, dofBlurPx: 6 },
    lut: { lutStrength: 0.6 },
    grade: { saturation: 1.15, vibrance: 0.3, temperature: 0.1 },
    vignette: { vignette: 0.32 },
  },
  textures: { lutTexture: '/themes/luts/wintercats.png' },
};

const NONE = {
  format: PRESET_FORMAT,
  name: 'none',
  label: 'None (photoreal as served)',
  perfTier: 'high',
  techniques: [],
  uniforms: {},
  textures: {},
};

export const BUILT_IN_PRESETS = Object.freeze({
  wintercats: WINTERCATS,
  'enhanced-realism': ENHANCED,
  cozy: COZY,
  none: NONE,
});

/** A deep copy of a built-in preset, or null. */
export function builtInPreset(name) {
  const p = BUILT_IN_PRESETS[String(name ?? '').toLowerCase()];
  return p ? structuredClone(p) : null;
}

/**
 * Check a preset object; returns { preset, problems } with unknown effect
 * names and malformed values dropped (never thrown: a bad preset must not
 * break the globe).
 */
export function normalizePreset(input, { customIds = [] } = {}) {
  const problems = [];
  const carried = (input?.effects ?? []).map((e) =>
    typeof e === 'string' ? e.match(/"id"\s*:\s*"([^"]+)"/)?.[1] : e?.id,
  );
  const known = new Set([
    ...EFFECT_IDS,
    ...customIds,
    ...carried.filter(Boolean),
  ]);
  if (!input || typeof input !== 'object')
    return {
      preset: structuredClone(NONE),
      problems: ['preset is not an object'],
    };
  if (input.format && input.format !== PRESET_FORMAT)
    problems.push(`unknown format ${input.format}`);
  const techniques = [];
  for (const id of Array.isArray(input.techniques) ? input.techniques : []) {
    if (!known.has(id)) problems.push(`unknown effect ${id}`);
    else if (!techniques.includes(id)) techniques.push(id);
  }
  const uniforms = {};
  for (const [id, values] of Object.entries(input.uniforms ?? {})) {
    if (!known.has(id) || typeof values !== 'object' || !values) {
      problems.push(`uniforms for unknown effect ${id}`);
      continue;
    }
    uniforms[id] = {};
    for (const [k, v] of Object.entries(values)) {
      const ok =
        (typeof v === 'number' && Number.isFinite(v)) ||
        (Array.isArray(v) &&
          v.length === 3 &&
          v.every((x) => Number.isFinite(x)));
      if (ok) uniforms[id][k] = Array.isArray(v) ? [...v] : v;
      else problems.push(`bad value ${id}.${k}`);
    }
  }
  const textures = {};
  for (const [k, v] of Object.entries(input.textures ?? {}))
    if (typeof v === 'string' && /^(\/|https?:|data:image\/)/.test(v))
      textures[k] = v;
    else problems.push(`bad texture ${k}`);
  return {
    preset: {
      format: PRESET_FORMAT,
      name: String(input.name ?? 'custom'),
      label: String(input.label ?? input.name ?? 'Custom'),
      perfTier: PERF_TIERS[input.perfTier] ? input.perfTier : 'medium',
      techniques,
      uniforms,
      textures,
      effects: Array.isArray(input.effects) ? input.effects : [],
    },
    problems,
  };
}

/** The preset a page asks for: `?preset=` (or `?theme=`), else null. */
export function presetRequest(search = '') {
  const q = new URLSearchParams(search ?? '');
  const value = q.get('preset') ?? q.get('theme');
  if (!value) return null;
  return {
    value,
    wipe: Math.min(
      1,
      Math.max(0, Number(q.get('themeWipe') ?? q.get('lookWipe') ?? 0) || 0),
    ),
    panel: q.get('themePanel') === '1',
    budget: q.get('themeBudget') !== '0',
  };
}

/** Load a preset by built-in name or URL (JSON). */
export async function loadPreset(value, { fetchImpl = globalThis.fetch } = {}) {
  const built = builtInPreset(value);
  if (built) return normalizePreset(built);
  if (!/^(\/|https?:)/.test(value))
    return {
      ...normalizePreset(builtInPreset('none')),
      problems: [`unknown preset ${value}`],
    };
  const res = await fetchImpl(value);
  if (!res.ok) throw new Error(`preset ${value}: HTTP ${res.status}`);
  return normalizePreset(await res.json());
}
