import { createSyntheticReliefDemoPacket } from './demoFixture.js';
import { renderReliefFieldView } from './reliefView.js';
import { projectReliefOutageFieldPacket } from '../data/reliefReplayFieldPacket.js';

/** Keyless, opt-in training view: only local synthetic files. */
export function initReliefFieldLite(documentRef = document) {
  const root = documentRef.getElementById('field-results');
  const fileInput = documentRef.getElementById('field-local-file');
  const demoButton = documentRef.getElementById('field-demo');
  const feedback = documentRef.getElementById('field-feedback');
  if (!root || !fileInput || !demoButton || !feedback) {
    throw new Error('Field Lite document missing required controls');
  }
  const controller = new AbortController();
  let generation = 0;
  let destroyed = false;
  const isCurrent = (ticket) => !destroyed && ticket === generation;
  const show = (packet, status) => {
    const rendered = renderReliefFieldView(root, packet);
    feedback.textContent = rendered ? status : 'File rejected: no valid synthetic replay available.';
  };
  show(createSyntheticReliefDemoPacket(), 'Built-in fictional example. No data was fetched.');
  demoButton.addEventListener('click', () => {
    generation += 1;
    fileInput.value = '';
    show(createSyntheticReliefDemoPacket(), 'Restored fictional example.');
  }, { signal: controller.signal });
  fileInput.addEventListener('change', async () => {
    const ticket = ++generation;
    const file = fileInput.files?.[0];
    if (!file) return;
    // A bounded local-only replay file. Not transmitted or persisted anywhere.
    if (file.size > 65536 || file.size === 0) {
      renderReliefFieldView(root, null);
      feedback.textContent = 'File rejected: must be a nonempty JSON file of at most 64 KiB.';
      return;
    }
    try {
      const contents = await file.text();
      if (!isCurrent(ticket)) return;
      const replay = JSON.parse(contents);
      const packet = projectReliefOutageFieldPacket(replay);
      show(packet, 'Local synthetic replay loaded. No network request was made.');
    } catch {
      if (!isCurrent(ticket)) return;
      renderReliefFieldView(root, null);
      feedback.textContent = 'File rejected: invalid JSON or synthetic receipt.';
    }
  }, { signal: controller.signal });
  return {
    destroy: () => {
      destroyed = true;
      generation += 1;
      controller.abort();
    },
  };
}

if (typeof document !== 'undefined') initReliefFieldLite(document);
