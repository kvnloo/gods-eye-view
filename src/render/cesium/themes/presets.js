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

/** Marks English text for scripts/i18n.mjs; the panel translates with t(). */
const msg = (text) => text;

export const PRESET_FORMAT = 'gev-theme-preset/1';
export const PERF_TIERS = Object.freeze({ low: 20, medium: 30, high: 45 });

/**
 * Render quality a preset asks for (council L1 §1: GEV renders at CSS pixels
 * and leaves the tiles' maximumScreenSpaceError at 16, so Google tiles look
 * blurrier than they are). `resolutionScale: 'dpr'` renders at the device
 * pixel ratio up to `maxDpr` (`phoneMaxDpr` on touch-first screens); the
 * error and MSAA apply on desktop only. Omitted: the app's own settings.
 */
export const DESKTOP_HIGH = Object.freeze({
  resolutionScale: 'dpr',
  maxDpr: 2,
  phoneMaxDpr: 1.5,
  maximumScreenSpaceError: 8,
  msaa: 4,
});

// Wintercats: colours and knobs from the theme dream loop v2 against the locked reference (loop-v2/round-v5/style-loop
// best-build.png) and the wintercats frames; numbers, not images. Loop v2 round 1 (defect pass + paint): abs 2.0 -> 3.0.
const WINTERCATS = {
  format: PRESET_FORMAT,
  name: 'wintercats',
  label: msg('Wintercats (cozy painterly city builder)'),
  perfTier: 'medium',
  techniques: [
    'tile',
    'paint',
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
      flatten: 0,
      flattenTexels: 5,
      detail: 0.1,
      delight: 0.85,
      bands: 3,
      wrap: 0.6,
      darkFloor: 0.15,
      otherSat: 0.2,
      shadeWarm: 1.0,
      flattenRings: 2,
      vegGb: 0.04,
      vegChroma: 1.0,
      grass: [0.361, 0.541, 0.235],
      canopy: [0.173, 0.29, 0.18],
      water: [0.235, 0.62, 0.639],
      waterDeep: [0.165, 0.435, 0.514],
      roofA: [0.612, 0.29, 0.196],
      roofB: [0.42, 0.455, 0.267],
      roofC: [0.702, 0.643, 0.557],
      roofD: [0.306, 0.227, 0.18],
      wall: [0.839, 0.776, 0.659],
      street: [0.659, 0.624, 0.549],
      shadow: [0.56, 0.53, 0.62],
      neutralChroma: 2.2,
      waterChroma: 0.25,
      roofVariety: 0.7,
      waterSmooth: 0.4,
      waterGbMin: 1,
      cellM: 22,
    },
    ao: {
      aoStrength: 0.3,
      aoMax: 0.4,
      aoTint: [0.55, 0.5, 0.55],
    },
    haze: {
      hazeStart: 3,
      hazeDensity: 0.03,
      hazeMax: 0.2,
      hazeColor: [0.84, 0.84, 0.8],
      skyTint: 0.25,
      skyColor: [0.7, 0.84, 0.9],
    },
    dof: {
      dofBlurPx: 6,
      focusRange: 0.45,
      tiltAmount: 0.35,
      tiltBand: 0.2,
      skyBlur: 0.4,
    },
    bloom: {
      bloomThreshold: 0.75,
      bloomIntensity: 0.6,
      bloomClamp: 0.1,
    },
    lut: {
      lutStrength: 0.25,
    },
    grade: {
      saturation: 0.92,
      vibrance: 0.0,
      temperature: 0.12,
      contrast: 1.14,
      lift: [0.01, 0.008, 0.015],
    },
    clarity: {
      clarity: -0.4,
      clarityRadiusPx: 8,
    },
    cas: {
      casSharpness: 0.0,
    },
    vignette: {
      vignette: 0.12,
      vignetteColor: [0.4, 0.36, 0.34],
    },
    paint: {
      paintRadius: 2,
    },
  },
  textures: { lutTexture: '/themes/luts/wintercats.png' },
  quality: DESKTOP_HIGH,
  hud: { scopeMask: 0.15 },
};

// "Enhanced realism", in the spirit of the BotW "Digital Dreams" ReShade
// presets: keep the photo, add depth cues (AO, GI-lite), a golden grade,
// gentle DOF, bloom and sharpening. No tile restyle.
const ENHANCED = {
  format: PRESET_FORMAT,
  name: 'enhanced-realism',
  label: msg('Enhanced realism (golden hour)'),
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
  quality: DESKTOP_HIGH,
};

// The old ?look=cozy chain re-expressed as a preset (paint + palette-ish grade).
const COZY = {
  format: PRESET_FORMAT,
  name: 'cozy',
  label: msg('Cozy valley (legacy ?look=cozy, screen-space only)'),
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
  label: msg('None (photoreal as served)'),
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
      quality: normalizeQuality(input.quality, problems),
      hud: normalizeHud(input.hud, problems),
    },
    problems,
  };
}

/** A preset's HUD block ({ scopeMask: 0..1 opacity }); null when it has none. */
function normalizeHud(h, problems) {
  if (h == null) return null;
  if (typeof h !== 'object') {
    problems.push('bad hud block');
    return null;
  }
  const out = {};
  if (h.scopeMask !== undefined) {
    if (Number.isFinite(h.scopeMask) && h.scopeMask >= 0 && h.scopeMask <= 1)
      out.scopeMask = h.scopeMask;
    else problems.push('bad hud.scopeMask');
  }
  return out;
}

/** A preset's quality block, checked; null when it has none. */
function normalizeQuality(q, problems) {
  if (q == null) return null;
  if (typeof q !== 'object') {
    problems.push('bad quality block');
    return null;
  }
  const num = (v, lo, hi) =>
    Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  return {
    resolutionScale:
      q.resolutionScale === 'dpr' ? 'dpr' : num(q.resolutionScale, 0.25, 4),
    maxDpr: num(q.maxDpr, 0.5, 4) ?? 2,
    phoneMaxDpr: num(q.phoneMaxDpr, 0.5, 4) ?? 1.5,
    maximumScreenSpaceError: num(q.maximumScreenSpaceError, 1, 64),
    msaa: num(q.msaa, 0, 8),
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
    quality: q.get('themeQuality') !== '0',
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
