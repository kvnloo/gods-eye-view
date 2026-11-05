import { createSyntheticReliefDemoPacket } from './demoFixture.js';
import { renderReliefFieldView } from './reliefView.js';
import { projectReliefOutageFieldPacket } from '../data/reliefReplayFieldPacket.js';


/**
 * Warm only the keyless Field Lite shell, never user receipts or live APIs.
 * Reopening the local JSON is an explicit action after an offline reload.
 */
async function prepareOfflineShell(browser, status, isMounted) {
  const serviceWorker = browser?.navigator?.serviceWorker;
  if (!serviceWorker || typeof serviceWorker.register !== 'function' ||
      !browser.MessageChannel ||
      typeof browser.performance?.getEntriesByType !== 'function') {
    status.textContent = 'Offline reload unavailable here. Local files still replay while this tab stays open.';
    return false;
  }
  status.textContent = 'Preparing offline screen. Local receipts are not stored.';
  try {
    await serviceWorker.register('/field-lite/offline-sw.js', { scope: '/field-lite/' });
    const registration = await serviceWorker.ready;
    if (!registration?.active) throw new Error('Field Lite offline worker unavailable');
    const urls = browser.performance.getEntriesByType('resource').map((entry) => entry.name);
    const channel = new browser.MessageChannel();
    let ready;
    try {
      ready = await new Promise((resolve) => {
        const timer = browser.setTimeout(() => resolve(false), 12000);
        channel.port1.onmessage = (event) => {
          browser.clearTimeout(timer);
          resolve(event.data?.ok === true);
        };
        registration.active.postMessage({ type: 'gev-field-lite-prime', urls }, [channel.port2]);
      });
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
    if (isMounted()) {
      status.textContent = ready
        ? 'Offline screen cached. Reopen your local JSON after a reload; reconnect does not verify historical evidence.'
        : 'Offline reload not confirmed. Keep the page open to replay local files.';
    }
    return ready;
  } catch {
    if (isMounted()) status.textContent = 'Offline reload not confirmed. Keep the page open to replay local files.';
    return false;
  }
}

/** Keyless, opt-in training view: only local synthetic files. */
export function initReliefFieldLite(documentRef = document, browser = globalThis) {
  const root = documentRef.getElementById('field-results');
  const fileInput = documentRef.getElementById('field-local-file');
  const demoButton = documentRef.getElementById('field-demo');
  const feedback = documentRef.getElementById('field-feedback');
  const offline = documentRef.getElementById('field-offline-ready');
  if (!root || !fileInput || !demoButton || !feedback || !offline) {
    throw new Error('Field Lite document missing required controls');
  }
  const controller = new AbortController();
  let generation = 0;
  let destroyed = false;
  const offlineReady = prepareOfflineShell(browser, offline, () => !destroyed);
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
      show(packet, 'Local synthetic replay loaded. Receipt was not sent to a server or queried against a live provider.');
    } catch {
      if (!isCurrent(ticket)) return;
      renderReliefFieldView(root, null);
      feedback.textContent = 'File rejected: invalid JSON or synthetic receipt.';
    }
  }, { signal: controller.signal });
  return {
    offlineReady,
    destroy: () => {
      destroyed = true;
      generation += 1;
      controller.abort();
    },
  };
}

if (typeof document !== 'undefined') initReliefFieldLite(document);
