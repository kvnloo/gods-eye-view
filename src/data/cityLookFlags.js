// FORK-ONLY experiment (exp/city-loop-r1, city dream loop v2 round 1): the
// URL switches for the "Cozy Valley" look and the round-1 game-layer changes.
// Nothing changes without a switch, so every capture without them is the
// parent build.
//
//   ?look=cozy            the Cozy Valley post chain (src/standalone/cozyValleyLook.js)
//   ?look=cozy2[&lk=JSON] tile CustomShader + depth-aware post (src/standalone/cozyShaderLook.js)
//   ?cityR1=ghost,flat,kit,chip,tray | all
//     ghost  select: a footprint ghost draped on the ground, no cyan prism
//     flat   reimagine: the concept laid flat on its plot, no kind tint
//     kit    build: warm "diorama" palette and low-poly trees on the block's plot
//     chip   shadow: the massing readout and the study merge into one small chip
//     tray   growth: the card tray collapses while the timeline is open
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
  const look = q.get('look');
  const flags = { look: look === 'cozy' || look === 'cozy2' ? look : null };
  for (const f of CITY_R1_FEATURES) flags[f] = all || asked.has(f);
  return Object.freeze(flags);
}

let cached = null;
/** The switches of this page (read once). */
export function pageLookFlags() {
  cached ??= cityLookFlags(globalThis.location?.search ?? '');
  return cached;
}
