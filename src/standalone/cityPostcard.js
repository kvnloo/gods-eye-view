import { t } from '../i18n/index.js';
import '../ui/styles/city-postcard.css';
import {
  POSTCARD_LABEL,
  POSTCARD_ROUTE,
  clampWipe,
  postcardAnswer,
  postcardError,
  postcardFacts,
  postcardPrompt,
  postcardRequest,
} from '../data/cityPostcard.js';

// FORK-ONLY experiment (exp/city-postcard): the "Cozy postcard" reality mode
// behind ?postcard=1 (spec: downstream/city-loop/postcard/POSTCARD-MODE.md).
// One button captures the current view (the city builder's own capture, the
// same frame a concept uses), sends it through the local image bridge (#312)
// and shows the answer over the capture with a compare wipe. The answer is a
// look only: the chip says so, it is never stored as a record, and the live
// map underneath is not changed.

function el(doc, tag, attrs = {}, text = '') {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

// The error code of a failed capture (a constant, not a glyph name: src/materialSymbolsSubset.test.mjs).
const CAPTURE_FAILED = 'capture';

export function mountCityPostcard({
  capture,
  massing = () => globalThis.window?.__gevCityMassing?.snapshot?.() ?? null,
  fetch = globalThis.fetch,
  doc = globalThis.document,
  win = globalThis.window,
}) {
  if (!doc?.body) return { destroy() {} };
  const button = el(
    doc,
    'button',
    {
      type: 'button',
      class: 'gev-postcard-button',
      'data-city-postcard-open': '',
    },
    'Cozy postcard',
  );
  const root = el(doc, 'div', {
    class: 'gev-postcard',
    'data-city-postcard': '',
    hidden: '',
  });
  const figure = el(doc, 'figure', { class: 'gev-postcard__frame' });
  const before = el(doc, 'img', {
    class: 'gev-postcard__img',
    alt: 'Captured view',
    'data-city-postcard-capture': '',
  });
  const after = el(doc, 'img', {
    class: 'gev-postcard__img gev-postcard__img--ai',
    alt: 'AI look of the same view',
    'data-city-postcard-ai': '',
  });
  const chip = el(
    doc,
    'span',
    { class: 'gev-postcard__chip', 'data-city-postcard-chip': '' },
    POSTCARD_LABEL,
  );
  const status = el(doc, 'p', {
    class: 'gev-postcard__status',
    role: 'status',
    'data-city-postcard-status': '',
  });
  const wipe = el(doc, 'input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.001',
    value: '0.5',
    class: 'gev-postcard__wipe',
    'aria-label': 'Compare: capture on the left, AI look on the right',
    'data-city-postcard-wipe': '',
  });
  const close = el(
    doc,
    'button',
    {
      type: 'button',
      class: 'gev-postcard__close',
      'aria-label': 'Close postcard',
      'data-city-postcard-close': '',
    },
    '×',
  );
  figure.append(before, after, chip, close);
  root.append(figure, wipe, status);
  doc.body.append(button, root);

  let job = null;
  const setWipe = (value) => {
    const w = clampWipe(value);
    after.style.clipPath = `inset(0 0 0 ${(w * 100).toFixed(2)}%)`;
    root.style.setProperty('--gev-postcard-wipe', String(w));
  };
  const hide = () => {
    job?.abort();
    job = null;
    root.hidden = true;
    button.disabled = false;
  };
  const show = async () => {
    job?.abort();
    const controller = new AbortController();
    job = controller;
    button.disabled = true;
    root.hidden = false;
    after.hidden = true;
    after.removeAttribute('src');
    status.textContent = t('Capturing this view…');
    let shot;
    try {
      shot = await capture();
    } catch {
      if (job === controller) status.textContent = postcardError(CAPTURE_FAILED);
      button.disabled = false;
      return;
    }
    if (job !== controller) return;
    before.src = shot.image;
    let prompt;
    try {
      prompt = postcardPrompt(postcardFacts(massing()));
    } catch {
      prompt = postcardPrompt(null); // an inconsistent model is left out, never described
    }
    status.textContent = t('Painting the postcard (about a minute)…');
    try {
      const res = await fetch(POSTCARD_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        body: postcardRequest(prompt, shot.image),
        signal: controller.signal,
      });
      if (!res.ok)
        throw Object.assign(new Error('bridge'), { status: res.status });
      const image = postcardAnswer(await res.json());
      if (job !== controller) return;
      after.src = image;
      after.hidden = false;
      setWipe(wipe.value);
      status.textContent = t('{label}: a look of this view, not a plan, a measurement or an approval.', { label: POSTCARD_LABEL });
    } catch (error) {
      if (controller.signal.aborted || job !== controller) return;
      status.textContent = postcardError(error?.status);
    } finally {
      if (job === controller) button.disabled = false;
    }
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !root.hidden) hide();
  };
  const onWipe = () => setWipe(wipe.value);
  button.addEventListener('click', show);
  close.addEventListener('click', hide);
  wipe.addEventListener('input', onWipe);
  win?.addEventListener('keydown', onKey);
  setWipe(0.5);
  const probe = {
    open: show,
    close: hide,
    snapshot: () => ({
      open: !root.hidden,
      pending: Boolean(job) && after.hidden,
      wipe: clampWipe(wipe.value),
      status: status.textContent,
    }),
  };
  if (win) win.__gevCityPostcard = probe;
  return {
    destroy() {
      hide();
      button.removeEventListener('click', show);
      close.removeEventListener('click', hide);
      wipe.removeEventListener('input', onWipe);
      win?.removeEventListener('keydown', onKey);
      button.remove();
      root.remove();
      if (win?.__gevCityPostcard === probe) delete win.__gevCityPostcard;
    },
  };
}
