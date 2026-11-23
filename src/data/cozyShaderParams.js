// FORK-ONLY experiment (exp/city-look-shader): the ?look=cozy2 parameters,
// kept free of Cesium so they can be tested in node. Used by
// src/standalone/cozyShaderLook.js.

export const COZY2_DEFAULTS = Object.freeze({
  wipe: 0,
  dbg: 0, // 1 = show post distance (white = 5 km), 2 = tile class colours
  // --- tile shader ---
  ts: 1, // tile stylise strength (0 = off)
  flat: 0.7, // blend toward the smoothed texture colour
  flatR: 2.5, // texel-ring radius
  mipBias: 2.0, // mip bias of the smoothed sample
  delight: 0.45, // 0 = hue remap (photo luminance), 1 = de-lit class palette
  detail: 0.35, // photo luminance detail kept on the class palette
  hueSnap: 0.5,
  greenSat: 1.7,
  greenVal: 1.12,
  waterSat: 1.6,
  waterVal: 1.2,
  warmSat: 1.35,
  cream: 0.6,
  vegLo: 0.02,
  vegHi: 0.1,
  roofVariety: 0.55,
  cellM: 14,
  vpost: 0.2,
  vbands: 6,
  toon: 0.6,
  bands: 3,
  wrap: 0.55,
  // palette (sRGB 0..1), picked from the wintercats refs
  grass: [0.55, 0.78, 0.29],
  canopy: [0.2, 0.44, 0.3],
  water: [0.3, 0.8, 0.84],
  wall: [0.94, 0.89, 0.78],
  street: [0.7, 0.6, 0.5],
  roofA: [0.76, 0.4, 0.24],
  roofB: [0.38, 0.52, 0.55],
  roofC: [0.9, 0.84, 0.69],
  shadow: [0.42, 0.44, 0.62],
  key: [1.06, 1.0, 0.9],
  // --- post ---
  kuw: 1,
  kuwNear: 1.5,
  kuwFar: 3.5,
  kuwD0: 300,
  kuwD1: 2500,
  tiltCenter: 0.52,
  tiltBand: 0.16,
  tiltBlur: 4, // screen-band tilt radius (px)
  dofBlur: 0, // depth circle-of-confusion radius (px)
  focusRange: 0.35,
  bloom: 0.5,
  bloomThr: 0.78,
  bloomClamp: 0.08,
  haze: 0.5,
  hazeCol: [0.8, 0.92, 0.94],
  hazeStart: 700,
  hazeDensity: 0.00022,
  hazeSky: 0.6,
  sat: 1.05,
  contrast: 1.0,
  exposure: 1.0,
  vignette: 0,
});

/** Parse ?lk= (JSON object) into overrides; unknown keys are dropped. */
export function parseLookParams(raw) {
  if (!raw) return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (!(k in COZY2_DEFAULTS)) continue;
    const d = COZY2_DEFAULTS[k];
    if (Array.isArray(d) && Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) out[k] = v;
    else if (typeof d === 'number' && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}
