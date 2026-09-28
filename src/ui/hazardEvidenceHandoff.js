export const HAZARD_EVIDENCE_STORAGE_KEY = 'gev:hazard-evidence-preferences:v1';

export const HAZARD_EVIDENCE_ACTIONS = Object.freeze(['imagery', 'cameras']);

const SUPPORTED_HAZARD_LAYERS = new Set(['local-firms']);

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function emptyPreference() {
  return { imagery: 0, cameras: 0 };
}

export function readHazardEvidencePreference(storage) {
  const fallback = emptyPreference();
  try {
    const raw = resolveStorage(storage)?.getItem?.(HAZARD_EVIDENCE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      HAZARD_EVIDENCE_ACTIONS.map((action) => [
        action,
        Number.isFinite(Number(parsed?.[action]))
          ? Math.max(0, Math.floor(Number(parsed[action])))
          : 0,
      ]),
    );
  } catch {
    return fallback;
  }
}

export function rankHazardEvidenceActions(storage) {
  const scores = readHazardEvidencePreference(storage);
  return [...HAZARD_EVIDENCE_ACTIONS].sort(
    (left, right) =>
      scores[right] - scores[left] ||
      HAZARD_EVIDENCE_ACTIONS.indexOf(left) -
        HAZARD_EVIDENCE_ACTIONS.indexOf(right),
  );
}

export function recordHazardEvidenceChoice(action, storage) {
  if (!HAZARD_EVIDENCE_ACTIONS.includes(action)) return false;
  const store = resolveStorage(storage);
  if (typeof store?.setItem !== 'function') return false;
  const next = readHazardEvidencePreference(store);
  next[action] += 1;
  try {
    store.setItem(HAZARD_EVIDENCE_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

function validHazardRecord(record) {
  return (
    SUPPORTED_HAZARD_LAYERS.has(record?.layerId) &&
    Number.isFinite(Number(record?.latitude)) &&
    Number.isFinite(Number(record?.longitude))
  );
}

function button(documentRef, label, action) {
  const node = documentRef.createElement('button');
  node.type = 'button';
  node.className = 'scene-btn hazard-evidence-action';
  node.dataset.action = action;
  node.textContent = label;
  return node;
}

/**
 * Ask for an evidence handoff after a supported hazard selection.
 *
 * The first version deliberately learns only ranking: every explicit successful
 * choice increments its local score, and the next chooser puts the highest
 * score first. Nothing auto-runs without a fresh user action.
 */
export function createHazardEvidenceHandoff({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  dataManager,
  styleManager,
  recentImagery,
  storage,
  showToast = () => {},
} = {}) {
  if (!documentRef?.createElement || !windowRef?.addEventListener)
    return {
      destroy() {},
      openForRecord() {
        return false;
      },
    };

  let dialog = null;
  let currentRecord = null;

  const close = () => {
    if (!dialog) return;
    try {
      dialog.close?.();
    } catch {
      // already closed
    }
    dialog.remove?.();
    dialog = null;
    currentRecord = null;
  };

  const runImagery = async (record) => {
    const enabled = await dataManager?.setEnabled?.('recent-imagery', true, {
      origin: 'user',
    });
    if (enabled === false) {
      showToast('Recent Imagery could not be enabled');
      return false;
    }
    const accepted = recentImagery?.boxFromPinAt?.(
      Number(record.longitude),
      Number(record.latitude),
    );
    if (accepted === false || accepted == null) {
      showToast('Recent Imagery could not use this hazard location');
      return false;
    }
    styleManager?.setPanelCollapsed?.('recent-imagery-panel', false, {
      explicit: true,
    });
    return true;
  };

  const runCameras = async (record) => {
    const enabled = await dataManager?.setEnabled?.('cctv', true, {
      origin: 'user',
    });
    if (enabled === false) {
      showToast('CCTV could not be enabled');
      return false;
    }
    const cctv = dataManager?.layers?.get?.('cctv')?.module;
    const cameraId = cctv?.focusNearestToPoint?.(
      Number(record.latitude),
      Number(record.longitude),
      { focus: true },
    );
    if (!cameraId) {
      showToast('No public camera is available near this hazard');
      return false;
    }
    styleManager?.setPanelCollapsed?.('cctv-panel', false, {
      explicit: true,
    });
    return true;
  };

  const choose = async (action) => {
    const record = currentRecord;
    if (!record) return false;
    const ok =
      action === 'imagery'
        ? await runImagery(record)
        : action === 'cameras'
          ? await runCameras(record)
          : false;
    if (ok) recordHazardEvidenceChoice(action, storage);
    if (ok) close();
    return ok;
  };

  const openForRecord = (record) => {
    if (!validHazardRecord(record)) return false;
    close();
    currentRecord = record;

    dialog = documentRef.createElement('dialog');
    dialog.className = 'hazard-evidence-dialog';
    dialog.setAttribute('aria-labelledby', 'hazard-evidence-title');

    const title = documentRef.createElement('strong');
    title.id = 'hazard-evidence-title';
    title.textContent = 'VERIFY THIS HAZARD';

    const detail = documentRef.createElement('span');
    detail.className = 'hazard-evidence-detail';
    detail.textContent =
      'Choose the evidence view to open. Your explicit choices rank future options.';

    const actions = documentRef.createElement('div');
    actions.className = 'hazard-evidence-actions';

    for (const action of rankHazardEvidenceActions(storage)) {
      const preferred =
        readHazardEvidencePreference(storage)[action] > 0 &&
        rankHazardEvidenceActions(storage)[0] === action;
      if (action === 'imagery') {
        const node = button(
          documentRef,
          preferred ? 'RECENT IMAGERY · USUAL' : 'RECENT IMAGERY',
          action,
        );
        node.addEventListener('click', () => void choose(action));
        actions.appendChild(node);
      } else {
        const node = button(
          documentRef,
          preferred ? 'NEARBY CAMERAS · USUAL' : 'NEARBY CAMERAS',
          action,
        );
        node.addEventListener('click', () => void choose(action));
        actions.appendChild(node);
      }
    }

    const dismiss = button(documentRef, 'NOT NOW', 'dismiss');
    dismiss.addEventListener('click', close);
    actions.appendChild(dismiss);

    dialog.append(title, detail, actions);
    documentRef.body?.appendChild(dialog);
    dialog.addEventListener('cancel', close);
    dialog.showModal?.();
    return true;
  };

  const onSelection = (event) => openForRecord(event?.detail);
  windowRef.addEventListener('gev:entity-selected', onSelection);

  return {
    openForRecord,
    destroy() {
      windowRef.removeEventListener?.('gev:entity-selected', onSelection);
      close();
    },
  };
}
