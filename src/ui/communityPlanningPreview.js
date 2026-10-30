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

/** Report one observable mismatch; this is not conflict history or a root-cause audit. */
function excludedProposalReason(id, record, project) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id))
    return 'invalid proposal identifier';
  const candidate = record?.fields?.proposal?.value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    return 'missing or malformed proposal payload';
  if (candidate.projectId !== project.id)
    return 'proposal belongs to another project';
  if (candidate.alternativeId !== id)
    return 'proposal ID differs from its record key';
  if (candidate.baselineRevision !== project.baseline.revision)
    return 'baseline revision differs from reference';
  if (
    record.kind !== 'draft-scenario' ||
    record.targetId !== `community-plan:${project.id}:${id}`
  ) return 'record ownership metadata differs';
  return 'proposal failed another validation rule';
}

/** Source claims never independently establish reuse or municipal rights. */
function unverifiedPlanningCitation(source) {
  return `Baseline citation (UNVERIFIED): ${source.id} · ` +
    `revision: ${source.revision} · ` +
    `claimed attribution: ${source.attribution} · ` +
    `claimed license (NOT rights-cleared): ${source.license} · ` +
    `source URL (not fetched): ${source.url}`;
}

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
    `Synthetic marker positions for ${alternative.title} · proposal ${alternative.alternativeId}; not surveyed`,
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
  // Keep credited but unbroken HTTPS source URLs readable on narrow screens.
  dialog.body.style.overflowWrap = 'anywhere';
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
      unverifiedPlanningCitation(source),
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
  // Sort before applying the eight-ID cap: arrival order is not authority.
  const excludedIds = Object.keys(collaborationState?.authored ?? {})
    .filter(
      (key) =>
        key.startsWith(recordPrefix) &&
        !projectedIds.has(key.slice(recordPrefix.length)),
    )
    .map((key) => key.slice(recordPrefix.length))
    .sort();
  const excludedRecords = excludedIds.length;
  const beyondPreview = view.alternatives.length - alternatives.length;
  const recordSummary = addText(
    dialog.body, 'p',
    `Planning records: ${excludedRecords} stale/incompatible excluded; ` +
      `${beyondPreview} valid beyond this two-proposal preview. ` +
      'This snapshot cannot reconstruct overwritten edits or resolve conflicts.',
    'planning-record-status',
  );
  recordSummary.dataset.planningRecordSummary = '';
  // A two-card preview must not silently hide other valid authored work.
  // List only bounded, read-only provenance; these are not compared or approved.
  if (beyondPreview) {
    const details = dialog.body.ownerDocument.createElement('details');
    details.dataset.planningAdditionalDetails = '';
    addText(
      details,
      'summary',
      `Inspect ${beyondPreview} additional valid hypothetical proposal${beyondPreview === 1 ? '' : 's'} not shown in comparison`,
    );
    const list = dialog.body.ownerDocument.createElement('ul');
    for (const alternative of view.alternatives.slice(2, 10)) {
      const author = alternative.authorship?.status === 'recorded'
        ? `${alternative.authorship.actorId} (unverified identity)`
        : 'unknown';
      const item = addText(
        list,
        'li',
        `${alternative.title} · proposal ${alternative.alternativeId} · ` +
          `Recorded author: ${author} · ` +
          `Source revision: ${alternative.baselineRevision} · ` +
          'HYPOTHETICAL · NOT APPROVED',
      );
      item.dataset.planningAdditionalRecord = '';
    }
    if (beyondPreview > 8)
      addText(list, 'li', `${beyondPreview - 8} more valid proposals not listed`);
    details.appendChild(list);
    dialog.body.appendChild(details);
  }
  // Report one observable mismatch without reviving stale records, leaking
  // malformed IDs, or inventing overwritten conflict history.
  if (excludedRecords) {
    const details = dialog.body.ownerDocument.createElement('details');
    details.dataset.planningExcludedDetails = '';
    addText(
      details,
      'summary',
      `Inspect ${excludedRecords} excluded proposal record${excludedRecords === 1 ? '' : 's'}`,
    );
    const list = dialog.body.ownerDocument.createElement('ul');
    for (const id of excludedIds.slice(0, 8)) {
      const label = /^[a-z][a-z0-9-]{0,63}$/.test(id)
        ? id
        : '(invalid proposal id)';
      const record = collaborationState?.authored?.[`${recordPrefix}${id}`];
      const reason = excludedProposalReason(id, record, project);
      const item = addText(
        list,
        'li',
        `Excluded ${label} · ${reason}; other validation failures may exist`,
      );
      item.dataset.planningExcludedRecord = '';
    }
    if (excludedRecords > 8)
      addText(list, 'li', `${excludedRecords - 8} more excluded records not listed`);
    details.appendChild(list);
    dialog.body.appendChild(details);
  }
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
    article.setAttribute(
      'aria-label',
      `${alternative.title} · proposal ${alternative.alternativeId}`,
    );
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
      `Inspect ${alternative.title} · proposal ${alternative.alternativeId}`,
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
      (event) => {
        mode = value;
        syncMode();
        // Reveal the selected Inspect control to keyboard users entering Game.
        // Pointer/touch and scripted activation must not unexpectedly move focus.
        if (value === 'game' && event?.isTrusted && event.detail === 0) {
          focusButtons.find(({ id }) => id === focusedId)?.button.focus({
            preventScroll: true,
          });
        }
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
    const focusedAlternative = alternatives.find(
      (alternative) => alternative.alternativeId === focusedId,
    );
    const focusedLabel = focusedAlternative
      ? `${focusedAlternative.title} · proposal ${focusedAlternative.alternativeId}`
      : 'unknown proposal';
    modeStatus.textContent = single
      ? `View: game · inspecting ${focusedLabel} (hypothetical) · neither mode grants authority`
      : 'View: co-op · neither mode grants authority';
  }
  syncMode();
  // The shared dialog opens before the comparison is populated, so its first
  // autofocus target is Cancel. Put keyboard/screen-reader entry at the
  // hypothetical heading instead, while keeping Tab on native controls.
  const heading = dialog.element.querySelector('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  return dialog;
}

/** A Scene launcher may open and regain focus only while interactive. */
function isPlanningLauncherInteractive(button, panel, disposed) {
  if (
    disposed ||
    !button.isConnected ||
    button.disabled ||
    panel.classList.contains('collapsed') ||
    button.closest('[hidden], [inert], [aria-hidden="true"]') ||
    !button.getClientRects().length
  ) return false;
  // A retired owner document can lose its browsing context before disposal.
  return button.ownerDocument.defaultView?.getComputedStyle(button).visibility === 'visible';
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
  let disposed = false;
  const open = () => {
    // A retained click on a hidden, collapsed or detached Scene owner must
    // never open a hypothetical modal, even before owner cleanup runs.
    if (dialog || !isPlanningLauncherInteractive(button, panel, disposed)) return;
    dialog = openCommunityPlanningPreview({ project, collaborationState });
    const current = dialog;
    const originalDispose = current.dispose;
    let closed = false;
    current.dispose = () => {
      if (closed) return;
      closed = true;
      try {
        originalDispose();
      } catch (error) {
        // A failed native close must not strand the modal or lock the launcher.
        console.warn('Community planning preview cleanup failed', error);
      } finally {
        current.element.remove();
        if (dialog === current) dialog = null;
        // A host teardown must never put focus back on a detached launcher.
        if (isPlanningLauncherInteractive(button, panel, disposed))
          button.focus({ preventScroll: true });
      }
    };
  };
  button.addEventListener('click', open);
  (panel.querySelector('.scene-panel-inner') || panel).appendChild(button);
  return () => {
    if (disposed) return;
    disposed = true;
    button.removeEventListener('click', open);
    button.remove();
    dialog?.dispose();
  };
}
