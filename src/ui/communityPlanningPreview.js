import { onLocaleChange, t, tn } from '../i18n/index.js';
import {
  COMMUNITY_PLANNING_SCHEMA_VERSION,
  planningView,
} from '../data/communityPlanning.js';
import { useCommunityPlanningStore } from './stores/communityPlanning.js';
import { useSceneSharingStore } from './stores/sceneSharing.js';
import { applicationPinia } from './vueRuntime.js';

const PROPOSAL_ID = /^[a-z][a-z0-9-]{0,63}$/;
const LISTED = 8;
const FEATURE_COLORS = Object.freeze({
  tree: '#65b58b',
  garden: '#93bb67',
  seating: '#cbb780',
  'play-area': '#dfa56b',
  shade: '#74afc7',
  'path-marker': '#b6c1d6',
});

/** One observable mismatch; not conflict history or a root-cause audit. */
function excludedReason(id, record, project) {
  if (!PROPOSAL_ID.test(id)) return t('invalid proposal identifier');
  const candidate = record?.fields?.proposal?.value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    return t('missing or malformed proposal payload');
  if (candidate.projectId !== project.id)
    return t('proposal belongs to another project');
  if (candidate.alternativeId !== id)
    return t('proposal ID differs from its record key');
  if (candidate.baselineRevision !== project.baseline.revision)
    return t('baseline revision differs from reference');
  if (
    record.kind !== 'draft-scenario' ||
    record.targetId !== `community-plan:${project.id}:${id}`
  )
    return t('record ownership metadata differs');
  if (candidate.schemaVersion !== COMMUNITY_PLANNING_SCHEMA_VERSION)
    return t('unsupported proposal schema revision');
  if (candidate.state !== 'hypothesis')
    return t('proposal is not marked hypothetical');
  if (candidate.modeledImpact !== 'not-evaluated')
    return t('proposal claims an evaluated impact');
  if (candidate.approval !== 'not-requested')
    return t('proposal carries an unverified approval claim');
  return t('proposal failed another validation rule');
}

const authorText = (alternative) =>
  alternative.authorship?.status === 'recorded'
    ? t('{actor} (unverified identity)', {
        actor: alternative.authorship.actorId,
      })
    : t('unknown');

const proposalLabel = (alternative) =>
  t('{title} · proposal {id}', {
    title: alternative.title,
    id: alternative.alternativeId,
  });

/** Authored marker positions on a schematic, never a map or surveyed geometry. */
function markers(alternative, bounds) {
  return alternative.features.map((feature) => ({
    id: feature.id,
    x: 16 + ((feature.point[0] - bounds[0]) / (bounds[2] - bounds[0])) * 268,
    y: 134 - ((feature.point[1] - bounds[1]) / (bounds[3] - bounds[1])) * 118,
    color: FEATURE_COLORS[feature.kind],
    label: `${feature.kind}: ${feature.id}`,
  }));
}

/**
 * The comparison as a plain view object: two authored hypothetical park
 * branches, their provenance, and the records the projection excludes.
 * `mode` and `focusedId` are local presentation; neither changes proposal data.
 * @param {{project: object, collaborationState: object}} fixture
 * @param {{mode?: 'co-op'|'game', focusedId?: ?string}} [presentation]
 */
export function presentCommunityPlanningPreview(
  { project, collaborationState },
  { mode = 'co-op', focusedId = null } = {},
) {
  const view = planningView(project, collaborationState, 'co-op');
  const shown = view.alternatives.slice(0, 2);
  const focused =
    shown.find((item) => item.alternativeId === focusedId) ?? shown[0] ?? null;
  const game = mode === 'game' && shown.length >= 2;
  const projected = new Set(view.alternatives.map((a) => a.alternativeId));
  // The merge projection keeps winners, not conflict history: list authored
  // records it drops as exclusions, sorted so arrival order is not authority.
  const prefix = `draft-scenario:community-plan:${project.id}:`;
  const excludedIds = Object.keys(collaborationState?.authored ?? {})
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((id) => !projected.has(id))
    .sort();
  const beyond = view.alternatives.length - shown.length;
  const sources = project.baseline.sources;
  return {
    title: t('Community planning · hypothetical preview'),
    status: t(
      'SYNTHETIC FIXTURE · NO LAND RIGHTS, MUNICIPAL APPROVAL OR MODELED IMPACT',
    ),
    intro: t('{place} · reference-only baseline {revision}', {
      place: project.place.label,
      revision: view.baselineRevision,
    }),
    localOnly: t(
      'LOCAL-ONLY DISPLAY · No shared room, live participants or synchronized edits.',
    ),
    // Source claims never establish reuse or municipal rights by themselves.
    sources: sources.length
      ? sources.map((source) =>
          t(
            'Baseline citation (UNVERIFIED): {id} · revision: {revision} · claimed attribution: {attribution} · claimed license (NOT rights-cleared): {license} · source URL (not fetched): {url}',
            source,
          ),
        )
      : [t('Baseline source: absent · verification unavailable')],
    compareNote: t(
      'Compare user-authored possibilities, not verified construction or traffic forecasts.',
    ),
    recordSummary: t(
      'Planning records excluded as stale or incompatible: {excluded} · valid beyond this two-proposal preview: {beyond}. This snapshot cannot reconstruct overwritten edits or resolve conflicts.',
      { excluded: excludedIds.length, beyond },
    ),
    additional: beyond
      ? {
          summary: tn(
            beyond,
            'Inspect {count} additional valid hypothetical proposal not shown in comparison',
            'Inspect {count} additional valid hypothetical proposals not shown in comparison',
          ),
          items: view.alternatives.slice(2, 2 + LISTED).map((alternative) =>
            t(
              '{proposal} · Recorded author: {author} · Source revision: {revision} · HYPOTHETICAL · NOT APPROVED',
              {
                proposal: proposalLabel(alternative),
                author: authorText(alternative),
                revision: alternative.baselineRevision,
              },
            ),
          ),
          more:
            beyond > LISTED
              ? tn(
                  beyond - LISTED,
                  '{count} more valid proposal not listed',
                  '{count} more valid proposals not listed',
                )
              : null,
        }
      : null,
    excluded: excludedIds.length
      ? {
          summary: tn(
            excludedIds.length,
            'Inspect {count} excluded proposal record',
            'Inspect {count} excluded proposal records',
          ),
          // Fixed reasons only; malformed IDs and rejected payload text stay hidden.
          items: excludedIds.slice(0, LISTED).map((id) =>
            t('Excluded {id} · {reason}; other validation failures may exist', {
              id: PROPOSAL_ID.test(id) ? id : t('(invalid proposal id)'),
              reason: excludedReason(
                id,
                collaborationState.authored[`${prefix}${id}`],
                project,
              ),
            }),
          ),
          more:
            excludedIds.length > LISTED
              ? tn(
                  excludedIds.length - LISTED,
                  '{count} more excluded record not listed',
                  '{count} more excluded records not listed',
                )
              : null,
        }
      : null,
    // An invalid-only snapshot is never presented as a comparison.
    unavailable:
      shown.length === 0
        ? t(
            'No valid proposals to compare; excluded records cannot be displayed as alternatives.',
          )
        : shown.length === 1
          ? t('Only one valid proposal is available; comparing requires two.')
          : null,
    mode: game ? 'game' : 'co-op',
    gameDisabled: shown.length < 2,
    gameDisabledReason: t('At least two valid alternatives are required'),
    inspect: game
      ? shown.map((alternative) => ({
          id: alternative.alternativeId,
          label: t('Inspect {proposal}', {
            proposal: proposalLabel(alternative),
          }),
          pressed: alternative === focused,
        }))
      : [],
    cards: shown.map((alternative) => ({
      id: alternative.alternativeId,
      label: proposalLabel(alternative),
      hidden: game && alternative !== focused,
      title: alternative.title,
      author: t('Recorded author: {author}', {
        author: authorText(alternative),
      }),
      // Recorded merge metadata is not authenticated identity or permission.
      edit:
        alternative.authorship?.status === 'recorded'
          ? t(
              'Recorded edit: {operation} · logical counter: {counter} (unverified, not approval)',
              {
                operation: alternative.authorship.operationId,
                counter: alternative.authorship.counter,
              },
            )
          : t('Recorded edit: unknown (no valid recorded operation metadata)'),
      revision: t('Source revision: {revision}', {
        revision: alternative.baselineRevision,
      }),
      plotLabel: t('Synthetic marker positions for {proposal}; not surveyed', {
        proposal: proposalLabel(alternative),
      }),
      markers: markers(alternative, project.place.bounds),
      features: t('Proposed markers: {features}', {
        features: alternative.features.length
          ? alternative.features.map((feature) => feature.kind).join(', ')
          : t('none'),
      }),
      impact: t('Modeled impact: {value}', {
        value: alternative.modeledImpact,
      }),
      approval: t('Approval: {value}', { value: alternative.approval }),
      assumptions: alternative.assumptions.map((assumption) =>
        t('Assumption: {assumption}', { assumption }),
      ),
    })),
    modeStatus: game
      ? t(
          'View: game · inspecting {proposal} (hypothetical) · neither mode grants authority',
          { proposal: proposalLabel(focused) },
        )
      : t('View: co-op · neither mode grants authority'),
  };
}

/**
 * Offer the Scene panel launcher for one synthetic fixture and own at most one
 * open comparison. No Cesium entities, persistence, dispatch or transport.
 * @param {{project: object, collaborationState: object}} fixture
 * @param {object} [options]
 * @returns {() => void} Idempotent teardown.
 */
export function mountCommunityPlanningPreview(
  fixture,
  {
    pinia = applicationPinia(),
    store = useCommunityPlanningStore(pinia),
    sharing = useSceneSharingStore(pinia),
  } = {},
) {
  let state = null;
  let disposed = false;
  const present = () => {
    if (!disposed && store.controls === controls)
      store.publish(state && presentCommunityPlanningPreview(fixture, state));
  };
  const controls = {
    open() {
      // Never open beneath another Scene modal or after teardown.
      if (disposed || state || sharing.dialog) return;
      state = { mode: 'co-op', focusedId: null };
      present();
    },
    close() {
      if (!state) return;
      state = null;
      present();
    },
    setMode(mode) {
      if (!state || (mode !== 'co-op' && mode !== 'game')) return;
      state = { ...state, mode };
      present();
    },
    inspect(id) {
      if (!state) return;
      state = { ...state, focusedId: id };
      present();
    },
  };
  const stopLocale = onLocaleChange(() => {
    store.offerLauncher({ label: t('COMPARE PARK PROPOSALS · FIXTURE') });
    present();
  });
  store.connect(controls);
  store.offerLauncher({ label: t('COMPARE PARK PROPOSALS · FIXTURE') });
  return () => {
    if (disposed) return;
    stopLocale();
    if (store.controls === controls) {
      store.publish(null);
      store.offerLauncher(null);
      store.connect(null);
    }
    disposed = true;
    state = null;
  };
}
