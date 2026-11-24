/**
 * Deterministic hard gates for the situation room at 1920×1080, run on a
 * live page and its screenshot before anything is judged by taste:
 *
 * - legibility: visible text ≥ 18 px, uppercase labels ≥ 15 px;
 * - no clipped text (cut without an ellipsis) and no overlapping text;
 * - contrast ≥ 4.5:1 for text against the pixels actually behind it;
 * - every card shows a source and an observed/retrieved time;
 * - nothing synthetic shown as live;
 * - no console errors;
 * - the situation room's own per-frame work within budget.
 *
 * `collectGateData(page)` reads the page; `evaluateGates(data, png)` scores
 * it against the screenshot (PNG bytes). Used by scripts/qa-situation-room.mjs.
 */
import sharp from 'sharp';

export const GATE_LIMITS = Object.freeze({
  minTextPx: 18,
  minUpperPx: 15,
  minContrast: 4.5,
  overlapPx: 6,
  frameWorkMs: 4,
});

/** In-page collection; returns plain data. */
export async function collectGateData(page) {
  return page.evaluate(() => {
    const out = { texts: [], cards: [], synthetic: [], frameWorkMs: null };
    const vw = innerWidth;
    const vh = innerHeight;
    const hiddenByAria = (el) => Boolean(el.closest('[aria-hidden="true"]:not(.sit-pins)'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let index = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || hiddenByAria(el)) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      if (/Material Symbols|Material Icons/.test(style.fontFamily)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      const box = rects.reduce(
        (a, r) => ({
          left: Math.min(a.left, r.left),
          top: Math.min(a.top, r.top),
          right: Math.max(a.right, r.right),
          bottom: Math.max(a.bottom, r.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      );
      // A box that truncates its own text shows only what is inside it.
      if (/hidden|clip/.test(style.overflowX) || (style.webkitLineClamp && style.webkitLineClamp !== 'none')) {
        const own = el.getBoundingClientRect();
        box.right = Math.min(box.right, own.right);
        box.bottom = Math.min(box.bottom, own.bottom);
        box.left = Math.max(box.left, own.left);
        box.top = Math.max(box.top, own.top);
      }
      if (box.right <= box.left || box.bottom <= box.top) continue;
      if (box.right < 0 || box.bottom < 0 || box.left > vw || box.top > vh) continue;
      // Is it on top where it is drawn? (A pin label under a panel is not shown.)
      const cx = Math.min(vw - 1, Math.max(0, (box.left + box.right) / 2));
      const cy = Math.min(vh - 1, Math.max(0, (box.top + box.bottom) / 2));
      const top = document.elementFromPoint(cx, cy);
      const visible = Boolean(top && (top === el || el.contains(top) || top.contains(el)));
      // Opacity along the ancestors (glass panels are opaque enough; a fading card is not).
      let opacity = 1;
      for (let a = el; a && a !== document.body; a = a.parentElement)
        opacity *= Number(getComputedStyle(a).opacity);
      // Clipping: cut by an overflow box without an ellipsis.
      let clipped = false;
      let ellipsis = false;
      const lineClamp = style.webkitLineClamp && style.webkitLineClamp !== 'none';
      if (el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(style.overflowX)) {
        if (style.textOverflow === 'ellipsis') ellipsis = true;
        else clipped = true;
      }
      if (lineClamp && el.scrollHeight > el.clientHeight + 1) ellipsis = true;

      for (let a = el.parentElement, depth = 0; a && depth < 8; a = a.parentElement, depth += 1) {
        const s = getComputedStyle(a);
        if (!/hidden|clip/.test(s.overflow + s.overflowY + s.overflowX)) continue;
        const r = a.getBoundingClientRect();
        if (box.bottom > r.bottom + 2 || box.top < r.top - 2 || box.right > r.right + 2 || box.left < r.left - 2) {
          // Cut by a box that truncates on purpose (ellipsis, line clamp) is
          // that box's ellipsis; cut by any other box is clipped text.
          const truncates =
            (s.textOverflow === 'ellipsis' && /hidden|clip/.test(s.overflowX)) ||
            (s.webkitLineClamp && s.webkitLineClamp !== 'none');
          if (truncates) ellipsis = true;
          else clipped = true;
        }
      }
      const fs = parseFloat(style.fontSize);
      const upper =
        style.textTransform === 'uppercase' ||
        (/[A-Z]/.test(text) && text === text.toUpperCase());
      out.texts.push({
        i: index++,
        text: text.slice(0, 80),
        fs,
        upper,
        color: style.color,
        opacity,
        box: [box.left, box.top, box.right, box.bottom].map((v) => Math.round(v * 10) / 10),
        visible,
        clipped,
        ellipsis,
        inSituation: Boolean(el.closest('#situation-room')),
        pin: Boolean(el.closest('.sit-pin')),
        where: el.closest('[id]')?.id || el.className?.toString?.().slice(0, 40) || el.tagName,
      });
    }
    for (const card of document.querySelectorAll('#situation-room .sit-card')) {
      const meta = card.querySelector('.sit-card-meta')?.textContent ?? card.querySelector('.sit-compact-src')?.textContent ?? '';
      out.cards.push({
        id: card.dataset.cardId,
        compact: card.classList.contains('sit-card--compact'),
        dissolving: card.classList.contains('sit-card--dissolving'),
        hasSource: card.classList.contains('sit-card--compact')
          ? /\S+\s*·/.test(meta)
          : /SOURCE\s+\S/.test(meta),
        hasTime: /\d\d:\d\dZ/.test(meta),
        live: /LIVE/.test(card.querySelector('.sit-fresh')?.textContent ?? ''),
        text: card.textContent.replace(/\s+/g, ' ').slice(0, 200),
      });
    }
    const all = document.body.innerText;
    for (const word of ['synthetic', 'mock data', 'lorem', 'sample data', 'example data', 'placeholder'])
      if (all.toLowerCase().includes(word)) out.synthetic.push(word);
    const situation = window.__godsEyeView?.situation;
    if (situation?._projectPins) {
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) situation._projectPins(true);
      out.frameWorkMs = (performance.now() - t0) / 40;
    }
    return out;
  });
}

const parseColor = (text) => {
  const m = String(text).match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255, 1];
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
};
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrastRatio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Median of the pixels in a 2-px ring just outside a box: the background. */
function ringBackground(raw, width, height, box) {
  const [l, t, r, b] = box.map(Math.round);
  const samples = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 3;
    samples.push([raw[o], raw[o + 1], raw[o + 2]]);
  };
  for (let d = 1; d <= 2; d++) {
    for (let x = l - d; x <= r + d; x += 2) {
      push(x, t - d);
      push(x, b + d);
    }
    for (let y = t - d; y <= b + d; y += 2) {
      push(l - d, y);
      push(r + d, y);
    }
  }
  if (!samples.length) return [0, 0, 0];
  samples.sort((p, q) => luminance(p) - luminance(q));
  return samples[Math.floor(samples.length / 2)];
}

/** Score collected data against the screenshot. */
export async function evaluateGates(data, png, { consoleErrors = [] } = {}) {
  const { data: raw, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const failures = [];
  const warnings = [];
  const shown = data.texts.filter((t) => t.visible && t.opacity > 0.3);
  // Legibility.
  for (const t of shown) {
    const min = t.upper ? GATE_LIMITS.minUpperPx : GATE_LIMITS.minTextPx;
    if (t.fs + 0.01 < min) failures.push({ gate: 'legibility', text: t.text, fs: t.fs, where: t.where });
  }
  // Clipping.
  for (const t of shown) {
    if (t.clipped) failures.push({ gate: 'clipped', text: t.text, where: t.where });
    else if (t.ellipsis && t.inSituation) warnings.push({ gate: 'ellipsis', text: t.text, where: t.where });
  }
  // Overlap between different text elements.
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].box;
      const b = shown[j].box;
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (w > GATE_LIMITS.overlapPx && h > GATE_LIMITS.overlapPx)
        failures.push({ gate: 'overlap', a: shown[i].text, b: shown[j].text, where: `${shown[i].where} × ${shown[j].where}` });
    }
  // Contrast against the real pixels behind each text.
  let worst = Infinity;
  for (const t of shown) {
    const bg = ringBackground(raw, info.width, info.height, t.box);
    const [r, g, b, alpha] = parseColor(t.color);
    const a = alpha * Math.min(1, t.opacity);
    const ink = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    const ratio = contrastRatio(ink, bg);
    worst = Math.min(worst, ratio);
    if (ratio < GATE_LIMITS.minContrast)
      failures.push({ gate: 'contrast', text: t.text, ratio: Number(ratio.toFixed(2)), where: t.where });
  }
  // Cards: source and time on every card that is not leaving.
  for (const card of data.cards.filter((c) => !c.dissolving)) {
    if (!card.hasSource) failures.push({ gate: 'card-source', card: card.id, text: card.text });
    if (!card.hasTime) failures.push({ gate: 'card-time', card: card.id, text: card.text });
  }
  for (const word of data.synthetic) failures.push({ gate: 'synthetic', word });
  for (const error of consoleErrors) failures.push({ gate: 'console', error: String(error).slice(0, 200) });
  if (data.frameWorkMs !== null && data.frameWorkMs > GATE_LIMITS.frameWorkMs)
    failures.push({ gate: 'frame-budget', ms: Number(data.frameWorkMs.toFixed(2)) });
  const counts = {};
  for (const f of failures) counts[f.gate] = (counts[f.gate] ?? 0) + 1;
  return {
    pass: failures.length === 0,
    counts,
    texts: shown.length,
    minFont: Math.min(...shown.map((t) => t.fs)),
    worstContrast: Number(worst.toFixed(2)),
    frameWorkMs: data.frameWorkMs === null ? null : Number(data.frameWorkMs.toFixed(3)),
    failures: failures.slice(0, 60),
    warnings: warnings.slice(0, 30),
  };
}
