/**
 * Small read-only GEV Field Lite presentation of a previously verified,
 * explicitly hypothetical relief packet. Does not contact any provider.
 * All supplied text is inserted with DOM textContent (no HTML interpretation).
 */
// The field view accepts packets from external offline consumers, not only
// packets produced by our own synthetic projection.
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validLabel = (value) => typeof value === 'string' && value.length > 0;
const validEvidenceRef = (value) =>
  typeof value === 'string' && /^synthetic:[a-zA-Z0-9_.:-]+$/.test(value);
const validNeed = (row) =>
  row && typeof row === 'object' && !Array.isArray(row) &&
  validLabel(row.zoneId) &&
  [row.needUnits, row.servedUnits, row.unmetUnits].every(validCount) &&
  row.servedUnits + row.unmetUnits === row.needUnits;
const validAssignment = (row) =>
  row && typeof row === 'object' && !Array.isArray(row) &&
  validLabel(row.vehicleId) && validLabel(row.zoneId) &&
  validCount(row.units) && row.units > 0 &&
  validEvidenceRef(row.evidenceRef);

export function reliefViewModel(packet) {
  if (packet?.kind !== 'gev-relief-replay-field-packet' ||
      packet.determination !== 'hypothetical' || packet.authority !== 'none' ||
      packet.schemaVersion !== 1 ||
      !['evaluated', 'limited'].includes(packet.status) ||
      packet.historicalBaselineCurrent !== false ||
      !Array.isArray(packet.stages) || packet.stages.length !== 2 ||
      packet.stages[0]?.phase !== 'baseline' ||
      packet.stages[1]?.phase !== 'revised' ||
      !Array.isArray(packet.fieldLite?.rows) || packet.fieldLite.rows.length !== 2 ||
      ![packet.fieldLite.rows[0], packet.fieldLite.rows[1]].every(
        (row) => Array.isArray(row?.evidenceRefs) &&
          row.evidenceRefs.every(validEvidenceRef)) ||
      !Array.isArray(packet.fieldLite?.notices) ||
      !Number.isSafeInteger(packet.delta?.knownOnlyServedUnits)) return null;
  const [before, after] = packet.stages;
  const validStage = (s) => s && typeof s.accessRevision === 'string' &&
    ['evaluated', 'limited'].includes(s.status) &&
    Number.isSafeInteger(s.unknownRoutes) && s.unknownRoutes >= 0 &&
    (s.status === 'limited' ? s.unknownRoutes > 0 : s.unknownRoutes === 0) &&
    s.knownOnlyExact && s.knownOnlyNearestFirst &&
    Number.isSafeInteger(s.knownOnlyExact.servedUnits) && s.knownOnlyExact.servedUnits >= 0 &&
    Number.isSafeInteger(s.knownOnlyNearestFirst.servedUnits) &&
    s.knownOnlyNearestFirst.servedUnits >= 0 &&
    Array.isArray(s.knownOnlyExact.unmetNeed) &&
    s.knownOnlyExact.unmetNeed.every(validNeed) &&
    Array.isArray(s.knownOnlyExact.assignments) &&
    s.knownOnlyExact.assignments.every(validAssignment);
  if (!validStage(before) || !validStage(after) ||
      before.accessRevision === after.accessRevision ||
      after.knownOnlyExact.servedUnits - before.knownOnlyExact.servedUnits !==
        packet.delta.knownOnlyServedUnits) return null;
  // Every presentation row must describe the stage it supplies evidence for.
  // Otherwise a valid receipt could render a closure reference as baseline proof.
  const matchesStage = (row, stage) =>
    row.phase === stage.phase &&
    row.accessRevision === stage.accessRevision &&
    row.exactKnownOnlyServedUnits === stage.knownOnlyExact.servedUnits &&
    row.nearestFirstKnownOnlyServedUnits ===
      stage.knownOnlyNearestFirst.servedUnits &&
    row.unknownRoutes === stage.unknownRoutes;
  const expectedStatus =
    before.status === 'limited' || after.status === 'limited'
      ? 'limited'
      : 'evaluated';
  if (
    !matchesStage(packet.fieldLite.rows[0], before) ||
    !matchesStage(packet.fieldLite.rows[1], after) ||
    packet.status !== expectedStatus
  ) return null;
  return {
    studyId: packet.source?.studyId || 'unknown',
    sourceRef: packet.source?.sourceRef || 'unknown',
    status: packet.status,
    stages: [before, after].map((stage, index) => ({
      label: index === 0 ? 'Before — superseded' : 'After — revised hypothesis',
      revision: stage.accessRevision,
      status: stage.status,
      served: stage.knownOnlyExact.servedUnits,
      nearestFirst: stage.knownOnlyNearestFirst.servedUnits,
      unknownRoutes: stage.unknownRoutes,
      unmet: stage.knownOnlyExact.unmetNeed.map(({ zoneId, needUnits, servedUnits, unmetUnits }) => ({
        zoneId, needUnits, servedUnits, unmetUnits,
      })),
      assignments: stage.knownOnlyExact.assignments.map(({ vehicleId, zoneId, units, evidenceRef }) => ({
        vehicleId, zoneId, units, evidenceRef,
      })),
      evidence: [...packet.fieldLite.rows[index].evidenceRefs],
    })),
    delta: packet.delta.knownOnlyServedUnits,
    notices: [...packet.fieldLite.notices],
  };
}

/** Render the validated model into an existing caller-owned document root. */
export function renderReliefFieldView(root, packet) {
  if (!root || typeof root.replaceChildren !== 'function' || !root.ownerDocument) {
    throw new TypeError('a document-backed container is required');
  }
  const document = root.ownerDocument;
  const element = (tag, className = '', label = null) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (label !== null) item.textContent = String(label);
    return item;
  };
  const model = reliefViewModel(packet);
  if (!model) {
    const warning = element('p', 'field-alert',
      'No validated synthetic comparison is available. No operational decisions are authorized.');
    warning.setAttribute('role', 'alert');
    root.replaceChildren(warning);
    return false;
  }
  const summary = element('p', 'field-status',
    `${model.status === 'limited' ? 'LIMITED · unknown access present' : 'EVALUATED · synthetic only'} · Study ${model.studyId}`);
  const panels = element('div', 'field-panels');
  for (const stage of model.stages) {
    const panel = element('section', 'field-card');
    panel.setAttribute('aria-label', `${stage.label} ${stage.revision}`);
    panel.appendChild(element('p', 'field-revision', stage.revision));
    panel.appendChild(element('h2', '', stage.label));
    const primary = element('div', 'field-number', String(stage.served));
    primary.appendChild(element('span', '', ' known-only synthetic units'));
    panel.appendChild(primary);
    panel.appendChild(element('p', 'field-support',
      `Nearest-first: ${stage.nearestFirst} · Unknown routes: ${stage.unknownRoutes}`));
    const groups = [
      ['Need by aggregated zone', stage.unmet.map((z) =>
        `${z.zoneId}: requested ${z.needUnits}, served ${z.servedUnits}, unmet ${z.unmetUnits}`)],
      ['Candidate assignments, not dispatch', stage.assignments.map((a) =>
        `${a.vehicleId} → ${a.zoneId}: ${a.units} units · ${a.evidenceRef}`)],
      ['Synthetic evidence references', stage.evidence],
    ];
    for (const [heading, lines] of groups) {
      const details = element('details', 'field-details');
      details.appendChild(element('summary', '', heading));
      const list = element('ul');
      for (const line of lines.length ? lines : ['None in this synthetic receipt']) {
        list.appendChild(element('li', '', line));
      }
      details.appendChild(list);
      panel.appendChild(details);
    }
    panels.appendChild(panel);
  }
  const change = element('section', 'field-change');
  change.appendChild(element('h2', '', 'Change after access revision'));
  change.appendChild(element('p', 'field-delta',
    `${model.delta > 0 ? '+' : ''}${model.delta} known-only synthetic units`));
  change.appendChild(element('p', '', 'The baseline result is no longer current within this fictional replay.'));
  const footer = element('section', 'field-footnote');
  footer.appendChild(element('h2', '', 'Interpretation and source'));
  const noteList = element('ul');
  for (const notice of model.notices) noteList.appendChild(element('li', '', notice));
  footer.appendChild(noteList);
  footer.appendChild(element('p', 'field-source', `Source: ${model.sourceRef}`));
  root.replaceChildren(summary, panels, change, footer);
  return true;
}
