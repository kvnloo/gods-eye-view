/**
 * @module render/cesium/themes/learnedTheme
 * @description FORK-ONLY (exp/theme-learned-v0, GEV-G). `?theme=wintercats-learned`:
 * the theme engine's own effect stack (a real-time shader, nothing per-pixel
 * is learned) with its knobs set by a small learned model per view.
 *
 * Model file `/themes/learned/wintercats-learned.json` (format
 * `gev-learned-theme/1`, written by the offline trainer gevg/export.py):
 *   base     the preset the knobs live in (techniques, uniforms, textures)
 *   spec     [{effect, key, channel|null, lo, hi, h}] one entry per knob
 *   point    knob vector the model is relative to (x = point + u·h, clamped)
 *   model    {type: 'static', u: [...]} or {type: 'knobformer', seeds: [...]}
 *
 * Features (the same ones the trainer used; no pixel is read back, so Google
 * tile imagery is never analysed): camera height above the globe, pitch, sun
 * elevation and sun azimuth relative to the heading, the OSM mask level, and
 * OSM class shares (water/grass/forest/road/building) of the mask window
 * (osmMask.classStats, OpenStreetMap geometry only). Knob values are eased
 * toward each new prediction so a camera move never pops.
 */

export const LEARNED_FORMAT = 'gev-learned-theme/1';
export const LEARNED_URL = '/themes/learned/wintercats-learned.json';
const CLS = ['water', 'grass', 'forest', 'road', 'building'];

/** Solar elevation / azimuth in degrees (NOAA-style; same formula as gevg/fit.py sun_elev_az). */
export function sunElevAz(latDeg, lonDeg, date) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const g = ((((357.528 + 0.9856003 * n) % 360) + 360) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmst * 15 + lonDeg) * rad - ra;
  const la = latDeg * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { el: el / rad, az: (((az / rad) % 360) + 360) % 360 };
}

/** Feature tokens [6][13] exactly as gevg/fit.py `tokens(feature_vec(...))`. */
export function featureTokens({ eyeHeight, pitch, heading, sunEl, sunAz, z, shares }) {
  const rel = (sunAz * Math.PI) / 180 - heading;
  const g = [Math.log(Math.max(eyeHeight, 1) / 700), pitch, (sunEl * Math.PI) / 180, Math.sin(rel), Math.cos(rel), (z || 0) / 16];
  const T = Array.from({ length: 6 }, () => new Array(13).fill(0));
  T[0][0] = 1;
  for (let i = 0; i < 6; i++) T[0][6 + i] = g[i];
  CLS.forEach((k, i) => {
    const c = Number(shares?.[k] ?? 0);
    T[i + 1][i + 1] = 1;
    T[i + 1][6] = c;
    T[i + 1][7] = Math.sqrt(Math.max(c, 0));
  });
  return T;
}

// ---- tiny tensor helpers (row-major arrays)
const linear = (x, W, b) => W.map((row, o) => row.reduce((s, w, i) => s + w * x[i], b ? b[o] : 0));
function layerNorm(x, w, b, eps = 1e-5) {
  const m = x.reduce((s, v) => s + v, 0) / x.length;
  const v = x.reduce((s, q) => s + (q - m) ** 2, 0) / x.length;
  const r = 1 / Math.sqrt(v + eps);
  return x.map((q, i) => (q - m) * r * w[i] + b[i]);
}

/** One PyTorch TransformerEncoderLayer (norm_first, ReLU, eval mode). */
function encoderLayer(X, p, heads) {
  const d = X[0].length;
  const hd = d / heads;
  const N = layerNorm.bind(null);
  const H1 = X.map((x) => N(x, p.norm1_w, p.norm1_b));
  const qkv = H1.map((h) => linear(h, p.in_proj_w, p.in_proj_b));
  const att = X.map(() => new Array(d).fill(0));
  for (let h = 0; h < heads; h++) {
    for (let i = 0; i < X.length; i++) {
      const q = qkv[i].slice(h * hd, (h + 1) * hd);
      const s = qkv.map((r) => r.slice(d + h * hd, d + (h + 1) * hd).reduce((a, k, j) => a + k * q[j], 0) / Math.sqrt(hd));
      const mx = Math.max(...s);
      const e = s.map((v) => Math.exp(v - mx));
      const z = e.reduce((a, v) => a + v, 0);
      for (let j = 0; j < X.length; j++) {
        const w = e[j] / z;
        for (let c = 0; c < hd; c++) att[i][h * hd + c] += w * qkv[j][2 * d + h * hd + c];
      }
    }
  }
  const X1 = X.map((x, i) => {
    const o = linear(att[i], p.out_proj_w, p.out_proj_b);
    return x.map((v, c) => v + o[c]);
  });
  return X1.map((x) => {
    const h = N(x, p.norm2_w, p.norm2_b);
    const f = linear(linear(h, p.lin1_w, p.lin1_b).map((v) => Math.max(v, 0)), p.lin2_w, p.lin2_b);
    return x.map((v, c) => v + f[c]);
  });
}

/** KnobFormer forward for one seed: tokens [6][13] -> u [K] (step units). */
export function knobFormer(seed, T, trust) {
  let X = T.map((t) => linear(t, seed.inp_w, seed.inp_b));
  for (const layer of seed.layers) X = encoderLayer(X, layer, seed.heads);
  return linear(X[0], seed.out_w, seed.out_b).map((v) => Math.tanh(v) * trust);
}

/** Knob vector for given tokens (mean over seeds), clamped to the library ranges. */
export function predictKnobs(model, T) {
  const K = model.spec.length;
  let u;
  if (model.model.type === 'static') u = model.model.u;
  else {
    const outs = model.model.seeds.map((s) => knobFormer(s, T, model.model.trust));
    u = Array.from({ length: K }, (_, k) => outs.reduce((a, o) => a + o[k], 0) / outs.length);
  }
  return model.spec.map((s, k) => Math.min(s.hi, Math.max(s.lo, model.point[k] + u[k] * s.h)));
}

/** Write a knob vector into a preset's uniforms (a copy). */
export function knobsToPreset(base, spec, x) {
  const p = structuredClone(base);
  spec.forEach((s, k) => {
    const u = (p.uniforms[s.effect] ??= {});
    if (s.channel === null || s.channel === undefined) u[s.key] = x[k];
    else {
      const v = Array.isArray(u[s.key]) ? [...u[s.key]] : [0, 0, 0];
      v[s.channel] = x[k];
      u[s.key] = v;
    }
  });
  return p;
}

/**
 * Drive `engine` from the model. Returns a controller with the last features
 * and knob vector (QA reads `window.__gevLearned`).
 */
export function createLearnedTheme(Cesium, viewer, engine, model, { everyMs = 500, ease = 0.35 } = {}) {
  const scene = viewer.scene;
  const state = { features: null, x: null, target: null, updates: 0, model: model.name ?? 'wintercats-learned' };
  engine.setPreset(knobsToPreset(model.base, model.spec, model.point));
  let last = 0;
  function features() {
    const o = engine.osmMask?.classStats?.() ?? null;
    const c = scene.camera;
    const ll = c.positionCartographic;
    const lat = Cesium.Math.toDegrees(ll.latitude);
    const lon = Cesium.Math.toDegrees(ll.longitude);
    const date = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    const sun = sunElevAz(lat, lon, date);
    return {
      eyeHeight: o?.eyeHeight ?? ll.height,
      pitch: c.pitch,
      heading: c.heading,
      sunEl: sun.el,
      sunAz: sun.az,
      z: o?.z ?? 0,
      shares: o ?? {},
    };
  }
  function tick() {
    const now = performance.now();
    if (now - last < everyMs) return;
    last = now;
    try {
      const f = features();
      const target = model.model.type === 'static' ? predictKnobs(model, null) : predictKnobs(model, featureTokens(f));
      state.features = f;
      state.target = target;
      state.x = state.x ? state.x.map((v, k) => v + (target[k] - v) * ease) : target;
      model.spec.forEach((s, k) => {
        if (s.channel === null || s.channel === undefined) engine.set(s.effect, s.key, state.x[k]);
        else {
          const cur = engine.values(s.effect)?.[s.key];
          const v = Array.isArray(cur) ? [...cur] : [0, 0, 0];
          v[s.channel] = state.x[k];
          engine.set(s.effect, s.key, v);
        }
      });
      state.updates++;
      if (state.updates < 30 || state.x.some((v, k) => Math.abs(v - target[k]) > 1e-3)) scene.requestRender?.();
    } catch (error) {
      state.error = String(error?.message ?? error);
    }
  }
  const remove = scene.postRender.addEventListener(tick);
  return {
    get state() {
      return { ...state };
    },
    /** Set the knobs for the current view now (no easing); QA and offline checks. */
    snap() {
      last = 0;
      state.x = null;
      tick();
      return state.x;
    },
    dispose() {
      remove();
    },
    ease: () => ease,
  };
}

/** Fetch and check the model file. */
export async function loadLearnedModel(url = LEARNED_URL, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`learned theme ${url}: HTTP ${res.status}`);
  const m = await res.json();
  if (m.format !== LEARNED_FORMAT) throw new Error(`learned theme: unknown format ${m.format}`);
  if (!Array.isArray(m.spec) || m.spec.length !== m.point?.length) throw new Error('learned theme: spec/point mismatch');
  return m;
}
