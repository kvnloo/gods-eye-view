import { createSceneDialog } from './sceneSharing.js';
import { planningView } from '../data/communityPlanning.js';

const FEATURE_COLORS = Object.freeze({
  tree: '#65b58b',
  garden: '#93bb67',
  seating: '#cbb780',
  'play-area': '#dfa56b',
  shade: '#74afc7',
  'path-marker': '#b6c1d6',
});

function addText(parent, tag, value, className = '') {
  const node = parent.ownerDocument.createElement(tag);
  node.className = className;
  node.textContent = value;
  parent.appendChild(node);
  return node;
}

/** A schematic of authored marker positions, never a map or verified geometry. */
function drawSyntheticMarkers(host, alternative, bounds) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = host.ownerDocument.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 300 150');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '150');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Synthetic marker positions for ${alternative.title}; not surveyed`,
  );
  const backdrop = host.ownerDocument.createElementNS(ns, 'rect');
  for (const [key, value] of Object.entries({
    x: 1, y: 1, width: 298, height: 148, rx: 6,
    fill: '#0b2630', stroke: '#3d6372',
  })) backdrop.setAttribute(key, String(value));
  svg.appendChild(backdrop);
  for (const feature of alternative.features) {
    const dot = host.ownerDocument.createElementNS(ns, 'circle');
    const x = 16 + ((feature.point[0] - bounds[0]) / (bounds[2] - bounds[0])) * 268;
    const y = 134 - ((feature.point[1] - bounds[1]) / (bounds[3] - bounds[1])) * 118;
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '7');
    dot.setAttribute('fill', FEATURE_COLORS[feature.kind]);
    dot.setAttribute('stroke', '#f0f7f8');
    dot.setAttribute('stroke-width', '1.5');
    const title = host.ownerDocument.createElementNS(ns, 'title');
    title.textContent = `${feature.kind}: ${feature.id}`;
    dot.appendChild(title);
    svg.appendChild(dot);
  }
  host.appendChild(svg);
}

/**
 * Open an opt-in GEV Scene dialog for two authored hypothetical park branches.
 * No Cesium entities, persistence, dispatch, remote transport, or real map claim.
 */
export function openCommunityPlanningPreview({ project, collaborationState }) {
  const view = planningView(project, collaborationState, 'co-op');
  let dialog;
  const close = () => dialog?.dispose();
  dialog = createSceneDialog('Community planning · hypothetical preview', close);
  // Stable browser hooks for genuine pointer/touch verification of the modal.
  dialog.footer.querySelector('button').dataset.planningCancel = '';
  dialog.element.dataset.communityPlanningPreview = '';
  dialog.element.style.width = 'min(900px,calc(100vw - 32px))';
  dialog.status.textContent =
    'SYNTHETIC FIXTURE · NO LAND RIGHTS, MUNICIPAL APPROVAL OR MODELED IMPACT';
  const intro = addText(dialog.body, 'p',
    `${project.place.label} · reference-only baseline ${view.baselineRevision}`);
  intro.style.color = '#aad3db';
  const localOnly = addText(
    dialog.body,
    'p',
    'LOCAL-ONLY DISPLAY · No shared room, live participants or synchronized edits.',
  );
  localOnly.dataset.planningLocalOnly = '';
  localOnly.style.color = '#aad3db';
  // Attribute authored baseline references without treating them as surveyed fact.
  const sources = project.baseline.sources;
  if (!sources.length) {
    const notice = addText(dialog.body, 'p',
      'Baseline source: absent · verification unavailable');
    notice.dataset.planningSourceProvenance = '';
  }
  for (const source of sources) {
    const provenance = addText(
      dialog.body, 'p',
      `Baseline source: ${source.id} · revision: ${source.revision} · ` +
        `attribution: ${source.attribution} · license: ${source.license} · ` +
        `URL: ${source.url}`,
    );
    provenance.dataset.planningSourceProvenance = '';
  }
  addText(dialog.body, 'p',
    'Compare user-authored possibilities, not verified construction or traffic forecasts.');
  const alternatives = view.alternatives.slice(0, 2);
  // The merge projection retains winners, not an editable conflict history.
  // Make incompatible authored records visible as exclusions, never proposals.
  const recordPrefix = `draft-scenario:community-plan:${project.id}:`;
  const projectedIds = new Set(
    view.alternatives.map((alternative) => alternative.alternativeId),
  );
  const excludedRecords = Object.keys(collaborationState?.authored ?? {}).filter(
    (key) =>
      key.startsWith(recordPrefix) &&
      !projectedIds.has(key.slice(recordPrefix.length)),
  ).length;
  const beyondPreview = view.alternatives.length - alternatives.length;
  const recordSummary = addText(
    dialog.body, 'p',
    `Planning records: ${excludedRecords} stale/incompatible excluded; ` +
      `${beyondPreview} valid beyond this two-proposal preview. ` +
      'This snapshot cannot reconstruct overwritten edits or resolve conflicts.',
    'planning-record-status',
  );
  recordSummary.dataset.planningRecordSummary = '';
  // An invalid-only snapshot cannot be presented as a comparison.
  if (alternatives.length < 2) {
    const message = alternatives.length === 0
      ? 'No valid proposals to compare; excluded records cannot be displayed as alternatives.'
      : 'Only one valid proposal is available; comparing requires two.';
    const unavailable = addText(
      dialog.body, 'p', message, 'planning-comparison-unavailable',
    );
    unavailable.dataset.planningComparisonUnavailable = '';
    unavailable.setAttribute('role', 'status');
  }
  const focusNavigation = dialog.body.ownerDocument.createElement('nav');
  focusNavigation.dataset.planningFocusNavigation = '';
  focusNavigation.setAttribute('aria-label', 'Inspect a hypothetical proposal');
  focusNavigation.hidden = true;
  dialog.body.appendChild(focusNavigation);
  const cards = dialog.body.ownerDocument.createElement('div');
  cards.dataset.planningAlternatives = '';
  Object.assign(cards.style, {
    display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'stretch',
  });
  dialog.body.appendChild(cards);
  const articles = [];
  for (const alternative of alternatives) {
    const article = dialog.body.ownerDocument.createElement('article');
    article.dataset.alternativeId = alternative.alternativeId;
    article.setAttribute('aria-label', alternative.title);
    Object.assign(article.style, {
      flex: '1 1 245px', minWidth: '0', padding: '12px',
      background: '#10242e', border: '1px solid #397080', borderRadius: '6px',
    });
    addText(article, 'h3', alternative.title);
    const label = addText(article, 'p', 'HYPOTHETICAL · NOT APPROVED');
    label.style.color = '#d5b67b';
    const credit = alternative.authorship?.status === 'recorded'
      ? `Recorded author: ${alternative.authorship.actorId} (unverified identity)`
      : 'Recorded author: unknown';
    addText(article, 'p', credit, 'planning-author-credit');
    // Recorded merge metadata is not authenticated identity or permission.
    const edit = alternative.authorship?.status === 'recorded'
      ? `Recorded edit: ${alternative.authorship.operationId} · logical counter: ` +
        `${alternative.authorship.counter} (unverified, not approval)`
      : 'Recorded edit: unknown (no valid recorded operation metadata)';
    addText(article, 'p', edit, 'planning-edit-provenance');
    addText(article, 'p', `Source revision: ${alternative.baselineRevision}`);
    drawSyntheticMarkers(article, alternative, project.place.bounds);
    const features = alternative.features.length
      ? alternative.features.map((f) => f.kind).join(', ')
      : 'none';
    addText(article, 'p', `Proposed markers: ${features}`);
    addText(article, 'p', `Modeled impact: ${alternative.modeledImpact}`);
    addText(article, 'p', `Approval: ${alternative.approval}`);
    for (const assumption of alternative.assumptions)
      addText(article, 'p', `Assumption: ${assumption}`);
    cards.appendChild(article);
    articles.push({ id: alternative.alternativeId, element: article });
  }
  const modeStatus = addText(
    dialog.body, 'p', 'View: co-op · neither mode grants authority',
  );
  modeStatus.dataset.planningModeStatus = '';
  modeStatus.setAttribute('role', 'status');
  modeStatus.setAttribute('aria-live', 'polite');
  modeStatus.setAttribute('aria-atomic', 'true');
  let mode = 'co-op';
  let focusedId = alternatives[0]?.alternativeId ?? null;
  const focusButtons = alternatives.map((alternative) => {
    const button = dialog.button(
      `Inspect ${alternative.title}`,
      () => {
        focusedId = alternative.alternativeId;
        syncMode();
      },
      focusNavigation,
    );
    button.dataset.planningFocusId = alternative.alternativeId;
    return { id: alternative.alternativeId, button };
  });
  const modeButtons = ['co-op', 'game'].map((value) => {
    const button = dialog.button(
      value === 'co-op' ? 'Co-op view' : 'Game view',
      () => {
        mode = value;
        syncMode();
      },
    );
    button.dataset.planningMode = value;
    return { value, button };
  });
  if (alternatives.length < 2) {
    const gameButton = modeButtons.find(({ value }) => value === 'game').button;
    gameButton.disabled = true;
    gameButton.title = 'At least two valid alternatives are required';
  }
  function syncMode() {
    const single = mode === 'game';
    focusNavigation.hidden = !single;
    for (const { id, element } of articles)
      element.hidden = single && id !== focusedId;
    for (const { id, button } of focusButtons)
      button.setAttribute('aria-pressed', String(single && id === focusedId));
    for (const { value, button } of modeButtons)
      button.setAttribute('aria-pressed', String(value === mode));
    // Presentation only. Choosing a card never updates proposal data or evidence.
    const focusedTitle =
      alternatives.find((alternative) => alternative.alternativeId === focusedId)
        ?.title ?? 'unknown proposal';
    modeStatus.textContent = single
      ? `View: game · inspecting ${focusedTitle} (hypothetical) · neither mode grants authority`
      : 'View: co-op · neither mode grants authority';
  }
  syncMode();
  return dialog;
}

/** Scene-panel entry; no launch or DOM mutation until explicitly opted in. */
export function mountCommunityPlanningPreview({
  project,
  collaborationState,
  panel = document.getElementById('scene-panel'),
}) {
  if (!panel) return () => {};
  const button = panel.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'scene-btn';
  button.dataset.communityPlanningPreviewOpen = '';
  button.textContent = 'COMPARE PARK PROPOSALS · FIXTURE';
  let dialog = null;
  const open = () => {
    if (dialog) return;
    dialog = openCommunityPlanningPreview({ project, collaborationState });
    const originalDispose = dialog.dispose;
    dialog.dispose = () => {
      originalDispose();
      dialog = null;
    };
  };
  button.addEventListener('click', open);
  (panel.querySelector('.scene-panel-inner') || panel).appendChild(button);
  return () => {
    button.removeEventListener('click', open);
    button.remove();
    dialog?.dispose();
  };
}
