// FORK-ONLY experiment (exp/city-loop-r1, city dream loop v2 round 1): the
// URL switches for the "Cozy Valley" look and the round-1 game-layer changes.
// Nothing changes without a switch, so every capture without them is the
// parent build.
//
//   ?look=cozy            the Cozy Valley post chain (src/standalone/cozyValleyLook.js)
//   ?look=diorama         the low-poly OSM district (src/standalone/cityDiorama.js)
//   ?preset=|?theme=      whole-globe theme engine (exp/theme-engine-v0); turns both looks off
//   ?city=v3              preset: look=diorama + cityHud=game + cityR1=kit (exp/city-loop-v3/v4)
//   ?city=hero            preset: city=v3 at the hero location, cityLoc=sausalito (exp/city-loop-v4)
//   ?cityR1=ghost,flat,kit,chip,tray | all
//     ghost  select: a footprint ghost draped on the ground, no cyan prism
//     flat   reimagine: the concept laid flat on its plot, no kind tint
//     kit    build: warm "diorama" palette and low-poly trees on the block's plot
//     chip   shadow: the massing readout and the study merge into one small chip
//     tray   growth: the card tray collapses while the timeline is open
// exp/city-loop-v4: the integrated presets, and the round-1 features they turn
// on. kit gives the build/shadow block the warm diorama palette (without it the
// block stood grey among the diorama's houses). An explicit ?cityR1= wins.
export const CITY_PRESETS = Object.freeze(['v3', 'hero']);
export const CITY_PRESET_R1 = Object.freeze(['kit']);
export const CITY_R1_FEATURES = Object.freeze([
  'ghost',
  'flat',
  'kit',
  'chip',
  'tray',
]);

/** The switches in a location search string, as plain booleans. */
export function cityLookFlags(search = '') {
  const q = new URLSearchParams(search ?? '');
  const asked = new Set(
    (q.get('cityR1') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const all = asked.has('all');
  // exp/city-loop-v3/v4: ?city=v3|hero is the integrated preset (look=diorama +
  // cityHud=game, src/data/cityGameHud.js, + cityR1=kit); an explicit ?look=
  // or ?cityR1= still wins.
  const preset = CITY_PRESETS.includes(q.get('city'));
  let look = q.get('look') ?? (preset ? 'diorama' : null);
  // exp/theme-engine-v0: a whole-globe theme (?preset= / ?theme=,
  // src/render/cesium/themes/) replaces the island looks: no diorama, and
  // ?look=cozy is the theme engine's 'cozy' preset instead of its own chain.
  if (q.has('preset') || q.has('theme')) look = null;
  const flags = { look: look === 'cozy' || look === 'diorama' ? look : null };
  const presetR1 = preset && !q.has('cityR1');
  for (const f of CITY_R1_FEATURES)
    flags[f] = all || asked.has(f) || (presetR1 && CITY_PRESET_R1.includes(f));
  return Object.freeze(flags);
}

let cached = null;
/** The switches of this page (read once). */
export function pageLookFlags() {
  cached ??= cityLookFlags(globalThis.location?.search ?? '');
  return cached;
}
