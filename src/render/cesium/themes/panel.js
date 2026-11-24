/**
 * @module render/cesium/themes/panel
 * @description FORK-ONLY (exp/theme-engine-v0), developer overlay behind
 * `?themePanel=1`, like ReShade's in-game overlay: preset picker, effect
 * list (enable, reorder), sliders built from the uniform annotations, the
 * before/after wipe, custom effect loading and preset export. Plain DOM, no
 * Cesium; it talks to the engine API only. Strings are English developer
 * text (not translated; the panel is never on in production).
 * It sits top-right below the HUD's top bar and leaves the bottom edge (the
 * map attribution) free.
 */
import { t } from '../../../i18n/index.js';

const CSS = `
.gev-theme-panel{position:fixed;top:64px;right:12px;z-index:2147483000;width:320px;max-height:calc(100vh - 140px);overflow:auto;
 background:rgba(8,12,16,.86);color:#d8eef3;font:12px/1.35 ui-monospace,Menlo,monospace;border:1px solid rgba(46,200,232,.45);
 border-radius:8px;padding:8px 10px;backdrop-filter:blur(6px)}
.gev-theme-panel h3{margin:4px 0 6px;font-size:11px;letter-spacing:.14em;color:#2ec8e8}
.gev-theme-panel select,.gev-theme-panel button,.gev-theme-panel textarea{font:inherit;background:#0e161c;color:#d8eef3;border:1px solid #2a3c46;border-radius:4px}
.gev-theme-panel button{padding:1px 6px;cursor:pointer}
.gev-theme-panel .fx{border-top:1px solid #1d2a32;padding:4px 0}
.gev-theme-panel .fx-head{display:flex;gap:4px;align-items:center}
.gev-theme-panel .fx-head label{flex:1}
.gev-theme-panel .fx-body{display:none;padding:2px 0 2px 18px}
.gev-theme-panel .fx.open .fx-body{display:block}
.gev-theme-panel .row{display:flex;gap:6px;align-items:center;margin:2px 0}
.gev-theme-panel .row span{flex:0 0 120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gev-theme-panel .row input[type=range]{flex:1}
.gev-theme-panel .err{color:#ff8a7a;white-space:pre-wrap}
.gev-theme-panel .note{color:#e8c46a}
.gev-theme-panel textarea{width:100%;height:90px}
`;

/** Marks English text for scripts/i18n.mjs; rendered through t(). */
const msg = (text) => text;

const toHex = (c) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const fromHex = (h) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * @param {object} engine The theme engine API.
 * @param {{presets: string[], loadPreset: (value: string) => Promise<void>,
 *   doc?: Document}} options
 */
export function mountThemePanel(
  engine,
  { presets, loadPreset, doc = globalThis.document },
) {
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
  const root = doc.createElement('div');
  root.className = 'gev-theme-panel';
  root.setAttribute('data-gev-theme-panel', '');
  doc.body.append(root);
  const open = new Set();
  const el = (tag, props = {}, ...kids) => {
    const n = doc.createElement(tag);
    Object.assign(n, props);
    n.append(...kids);
    return n;
  };

  function slider(id, key, spec) {
    const value = engine.values(id)?.[key];
    const row = el(
      'div',
      { className: 'row' },
      el('span', { textContent: spec.label, title: key }),
    );
    if (spec.type === 'color' || Array.isArray(value)) {
      const max = Math.max(1, ...value);
      const input = el('input', {
        type: 'color',
        value: toHex(value.map((v) => v / max)),
      });
      input.oninput = () =>
        engine.set(
          id,
          key,
          fromHex(input.value).map((v) => v * max),
        );
      row.append(input);
    } else if (spec.type === 'bool') {
      const input = el('input', {
        type: 'checkbox',
        checked: Number(value) > 0.5,
      });
      input.onchange = () => engine.set(id, key, input.checked ? 1 : 0);
      row.append(input);
    } else {
      const out = el('code', { textContent: Number(value).toFixed(3) });
      const input = el('input', {
        type: 'range',
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value,
      });
      input.oninput = () => {
        engine.set(id, key, Number(input.value));
        out.textContent = Number(input.value).toFixed(3);
      };
      row.append(input, out);
    }
    return row;
  }

  function effectRow(id, label, uniforms, enabled, index) {
    const box = el('div', { className: `fx${open.has(id) ? ' open' : ''}` });
    const check = el('input', { type: 'checkbox', checked: enabled });
    check.onchange = () => engine.enable(id, check.checked);
    const name = el('label', {}, check, ` ${t(label)}`);
    const more = el('button', {
      textContent: open.has(id) ? '−' : '+',
      title: 'uniforms',
    });
    more.onclick = () => {
      open.has(id) ? open.delete(id) : open.add(id);
      render();
    };
    const up = el('button', {
      textContent: '↑',
      title: t('move up'),
      disabled: index <= 0,
    });
    up.onclick = () => engine.move(id, -1);
    const down = el('button', {
      textContent: '↓',
      title: t('move down'),
      disabled: index < 0,
    });
    down.onclick = () => engine.move(id, 1);
    box.append(el('div', { className: 'fx-head' }, name, up, down, more));
    const body = el('div', { className: 'fx-body' });
    for (const [k, spec] of Object.entries(uniforms ?? {}))
      if (!spec.hidden) body.append(slider(id, k, spec));
    box.append(body);
    return box;
  }

  function render() {
    root.replaceChildren();
    root.append(el('h3', { textContent: 'GEV THEME ENGINE' }));
    const pick = el('select');
    for (const p of presets)
      pick.append(
        el('option', {
          value: p,
          textContent: p,
          selected: p === engine.preset?.name,
        }),
      );
    pick.onchange = () => loadPreset(pick.value);
    const wipe = el('input', {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      value: engine.wipe,
    });
    wipe.oninput = () => engine.setWipe(Number(wipe.value));
    root.append(
      el(
        'div',
        { className: 'row' },
        el('span', { textContent: 'Preset' }),
        pick,
      ),
      el(
        'div',
        { className: 'row' },
        el('span', { textContent: 'Before | after wipe' }),
        wipe,
      ),
    );
    const order = engine.order;
    const enabled = new Set(engine.enabled);
    const all = [
      {
        id: 'tile',
        label: msg(
          'Stage 0: tile material (palette, de-light, flatten, relight)',
        ),
        uniforms: engine.tileUniforms,
      },
      ...engine.effects(),
    ];
    const listed = [
      ...order.map((id) => all.find((e) => e.id === id)).filter(Boolean),
      ...all.filter((e) => !order.includes(e.id)),
    ];
    for (const e of listed)
      root.append(
        effectRow(
          e.id,
          e.label,
          e.uniforms,
          enabled.has(e.id),
          order.indexOf(e.id),
        ),
      );
    for (const e of engine.errors.slice(-4))
      root.append(
        el('div', { className: 'err', textContent: `✕ ${e.id}: ${e.message}` }),
      );
    for (const n of engine.notices.slice(-3))
      root.append(
        el('div', { className: 'note', textContent: `! ${n.message}` }),
      );
    const text = el('textarea', {
      placeholder: '/*! gev-effect {"id":"my-fx", ...} */\nvoid main() { ... }',
    });
    const load = el('button', { textContent: 'Load custom effect' });
    load.onclick = () => {
      const r = engine.addEffect(text.value, { enable: true });
      if (!r.ok)
        root.append(
          el('div', { className: 'err', textContent: r.problems.join('\n') }),
        );
    };
    const file = el('input', { type: 'file', accept: '.glsl,.fx,.txt,.json' });
    file.onchange = async () => {
      const f = file.files?.[0];
      if (!f) return;
      const body = await f.text();
      if (f.name.endsWith('.json')) {
        try {
          engine.setPreset(JSON.parse(body));
        } catch (e) {
          root.append(el('div', { className: 'err', textContent: String(e) }));
        }
      } else engine.addEffect(body, { enable: true });
    };
    const exp = el('button', { textContent: 'Export preset JSON' });
    exp.onclick = () => {
      const blob = new Blob([JSON.stringify(engine.exportPreset(), null, 2)], {
        type: 'application/json',
      });
      const a = el('a', {
        href: URL.createObjectURL(blob),
        download: `${engine.preset?.name ?? 'preset'}-edit.json`,
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    root.append(
      el('h3', { textContent: 'CUSTOM' }),
      text,
      el('div', { className: 'row' }, load, exp),
      el(
        'div',
        { className: 'row' },
        el('span', { textContent: 'Effect / preset file' }),
        file,
      ),
    );
  }

  const off = engine.onChange(() => {
    if (
      !root.contains(doc.activeElement) ||
      doc.activeElement?.type === 'checkbox'
    )
      render();
  });
  render();
  return {
    root,
    destroy() {
      off();
      root.remove();
      style.remove();
    },
  };
}
