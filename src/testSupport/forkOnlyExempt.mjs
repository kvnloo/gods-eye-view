/**
 * FORK-ONLY: the one list of fork-only files the architecture guards set
 * aside. Nothing here is for upstream.
 *
 * The city builder (`src/standalone/city*.js`, `cozyValleyLook.js`,
 * `src/data/cityPlotPick.js`, `CityGameHud.vue`) came in with
 * `exp/theme-engine-v0`. It drives Cesium directly on purpose, as a
 * standalone experiment, and is not meant to be ported to the renderer
 * contract or proposed upstream. Rather than grow the upstream ratchets
 * (`cesiumAllowList.json`, `viewerAccessAllowList.json`, which only ever
 * shrink), each guard below drops these files from its offenders, and only
 * for the guards named per file.
 *
 * The list cannot rot:
 * - each guard fails when a file listed for it no longer offends there
 *   (`partitionForkOnly(...).unused`), so a port leaves the list;
 * - `src/forkOnlyExempt.test.mjs` checks every file exists, is sorted, has
 *   its reason, names known guards, is on neither upstream list, and is
 *   absent from `origin/main`.
 * Every other file is judged by each guard exactly as before.
 */

export const FORK_ONLY_REASON =
  'FORK-ONLY city builder (exp/theme-engine-v0), not for upstream';

/** The guards that read this list, by the id each passes in. */
export const FORK_ONLY_GUARDS = Object.freeze([
  // src/render/cesium/internals.test.mjs
  'cesiumInternals',
  // src/queries/heights.test.mjs
  'heightService',
  // src/data/inputOwnership.test.mjs
  'inputDispatcher',
  // src/render/noCesiumOutsideRender.test.mjs
  'noCesiumOutsideRender',
  // src/render/viewerAccess.test.mjs
  'viewerAccess',
]);

const entry = (...guards) => Object.freeze({ reason: FORK_ONLY_REASON, guards });

/** file (repository-relative, posix) → why, and which guards set it aside. */
export const FORK_ONLY_EXEMPT = Object.freeze({
  'src/data/cityPlotPick.js': entry('noCesiumOutsideRender', 'viewerAccess'),
  'src/standalone/cityConceptDrape.js': entry(
    'noCesiumOutsideRender',
    'viewerAccess',
  ),
  'src/standalone/cityDiorama.js': entry(
    'heightService',
    'noCesiumOutsideRender',
    'viewerAccess',
  ),
  'src/standalone/cityLookR1.js': entry('viewerAccess'),
  'src/standalone/cityMassing.js': entry(
    'cesiumInternals',
    'heightService',
    'noCesiumOutsideRender',
    'viewerAccess',
  ),
  'src/standalone/cityMassingLook.js': entry('noCesiumOutsideRender'),
  'src/standalone/cityMassingSeat.js': entry('noCesiumOutsideRender'),
  'src/standalone/cityPlanningServices.js': entry('viewerAccess'),
  'src/standalone/cityPlay.js': entry(
    'cesiumInternals',
    'heightService',
    'inputDispatcher',
    'noCesiumOutsideRender',
    'viewerAccess',
  ),
  'src/standalone/cozyValleyLook.js': entry(
    'noCesiumOutsideRender',
    'viewerAccess',
  ),
  'src/ui/views/panels/CityGameHud.vue': entry('viewerAccess'),
});

const posix = (file) => file.split('\\').join('/');

/** The files a guard sets aside. */
export function forkOnlyExempt(guard) {
  if (!FORK_ONLY_GUARDS.includes(guard))
    throw new Error(`Unknown fork-only guard: ${guard}`);
  return new Set(
    Object.entries(FORK_ONLY_EXEMPT)
      .filter(([, { guards }]) => guards.includes(guard))
      .map(([file]) => file),
  );
}

/**
 * Split a guard's raw offenders into those it still reports and the listed
 * files that no longer offend there. `fileOf` maps an offender (a path, or a
 * message starting with one) to its file.
 */
export function partitionForkOnly(
  guard,
  offenders,
  fileOf = (offender) => String(offender).split(' ')[0],
) {
  const exempt = forkOnlyExempt(guard);
  const seen = new Set();
  const kept = [];
  for (const offender of offenders) {
    const file = posix(fileOf(offender));
    if (exempt.has(file)) seen.add(file);
    else kept.push(offender);
  }
  const unused = [...exempt].filter((file) => !seen.has(file));
  return { offenders: kept, unused };
}

/** The message a guard gives when a listed file no longer offends there. */
export const staleForkOnlyMessage = (guard) =>
  `These files no longer offend the ${guard} guard; take ${guard} off their ` +
  'entry in src/testSupport/forkOnlyExempt.mjs (and the entry, if it has no guards left).';
