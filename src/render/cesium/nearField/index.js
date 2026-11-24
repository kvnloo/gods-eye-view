/**
 * @module render/cesium/nearField
 * @description FORK-ONLY (exp/near-field-v0). The near-field detail bubble:
 * a camera-following disc of GEV-generated 3D (buildings, trees, water) from
 * OpenStreetMap data, overlaid on Google Photorealistic 3D Tiles wherever the
 * camera goes. Loaded only with `?nearField=1`.
 *
 *   ?nearField=1            turn the bubble on (off by default)
 *   &nearFieldKit=norse     force an asset kit (else the theme preset's nearField block)
 *   &nearFieldDebug=1       paint the hidden-tile mask instead of hiding
 *
 * Pipeline per z16 cell: World Terrain heights (Cesium ion, in memory only)
 * -> worker (OpenFreeMap z14 tile -> cell fixture -> meshes -> GLB) ->
 * Cesium Model with a dithered distance fade. Google tiles are hidden only
 * under our own objects (footprint columns, our water surface), through a
 * part on the theme engine's tile shader host. Nothing reads Google content:
 * no pickPosition / sampleHeight / tile pixels.
 *
 * `window.__gevNearField` is the QA API.
 */
import * as Cesium from 'cesium';
import { HOST_KEY, tileShaderHost } from '../themes/tileShaderHost.js';
import { loadPreset, normalizeNearField, presetRequest } from '../themes/presets.js';
import { MODEL_FS, TILE_GLSL } from './shaders.js';
import {
  BUBBLE,
  bubbleCentre,
  bubbleRadius,
  cellsInBubble,
  createLru,
  fromLocal,
  nearFieldRequest,
  tileCentre,
  tileKey,
  tileSizeM,
  toLocal,
} from '../../../data/nearField/tiling.js';
import { rasterize } from '../../../data/nearField/cellData.js';
import { hideOsmCredit, showOsmCredit } from '../../../data/dataCredits.js';
import { t } from '../../../i18n/index.js';

const GRID_N = 25; // terrain samples per cell side
const MAX_CELLS = 56; // LRU of generated cells (models stay in GPU memory while cached)
const MAX_INFLIGHT = 3;
const TREE_RADIUS = 0.72; // trees fade out at this share of the bubble radius (LOD)
const OWNER = 'near-field';

function ionToken() {
  try {
    return String(import.meta.env?.CESIUM_ION_TOKEN ?? '').trim();
  } catch {
    return '';
  }
}

export async function installNearField(viewer, { win = globalThis.window } = {}) {
  const request = nearFieldRequest(win?.location?.search ?? '');
  if (!request || !viewer?.scene) return null;
  const scene = viewer.scene;
  const camera = scene.camera;
  const ellipsoid = Cesium.Ellipsoid.WGS84;

  // ---- theme: the preset's nearField block picks the kit and light
  let look = normalizeNearField({ kit: 'realism' });
  const themeReq = presetRequest(win?.location?.search ?? '');
  if (themeReq) {
    try {
      const { preset } = await loadPreset(themeReq.value);
      look = preset.nearField ?? look;
    } catch {
      /* keep the neutral kit */
    }
  }
  if (request.kit) look = { ...look, kit: request.kit };

  // ---- terrain for ground heights: Cesium World Terrain (ion) or the globe's own provider
  let terrain = null;
  let terrainSource = 'ellipsoid';
  const token = ionToken();
  try {
    if (token) {
      const resource = await Cesium.IonResource.fromAssetId(1, { accessToken: token });
      terrain = await Cesium.CesiumTerrainProvider.fromUrl(resource);
      terrainSource = 'cesium-world-terrain';
    }
  } catch (error) {
    console.warn('[nearField] World Terrain unavailable', error);
  }
  // Without an ion token: the globe's own terrain (the app's keyless Re:Earth
  // quantized mesh), looked up per cell because the app swaps it in late.
  // Never the Google tileset.
  const terrainNow = () => {
    if (terrain) return terrain;
    const tp = scene.globe?.terrainProvider;
    if (tp && !(tp instanceof Cesium.EllipsoidTerrainProvider)) {
      terrainSource = 'globe-terrain';
      state.terrain = terrainSource;
      return tp;
    }
    return null;
  };

  /** sampleTerrainMostDetailed, re-asking points whose tile failed (throttled 429s leave NaN). */
  async function sampleRetrying(tp, pts) {
    await Cesium.sampleTerrainMostDetailed(tp, pts);
    for (let attempt = 0; attempt < 2; attempt++) {
      const bad = pts.filter((c) => !Number.isFinite(c.height));
      if (!bad.length) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      bad.forEach((c) => (c.height = 0));
      await Cesium.sampleTerrainMostDetailed(tp, bad, true).catch(() => bad.forEach((c) => (c.height = NaN)));
    }
    return pts;
  }

  /** World Terrain at each footprint vertex (local metres around `centre`); NaN where unavailable. */
  async function samplePoints(points, centre) {
    const tp = terrainNow();
    const out = new Float32Array(points.length / 2);
    if (!tp) return out; // ellipsoid
    const pts = [];
    for (let k = 0; k < points.length; k += 2) {
      const g = fromLocal(points[k], points[k + 1], centre);
      pts.push(Cesium.Cartographic.fromDegrees(g.lon, g.lat));
    }
    if (pts.length) await sampleRetrying(tp, pts);
    pts.forEach((c, k) => (out[k] = Number.isFinite(c.height) ? c.height : NaN));
    return out;
  }

  async function sampleGrid(cell) {
    const centre = tileCentre(cell);
    const side = tileSizeM(cell);
    const spacing = (side + 48) / (GRID_N - 1);
    const half = (spacing * (GRID_N - 1)) / 2;
    const heights = new Array(GRID_N * GRID_N).fill(0);
    const terrain = terrainNow();
    if (terrain) {
      const pts = [];
      for (let j = 0; j < GRID_N; j++)
        for (let i = 0; i < GRID_N; i++) {
          const g = fromLocal(-half + i * spacing, -half + j * spacing, centre);
          pts.push(Cesium.Cartographic.fromDegrees(g.lon, g.lat));
        }
      await sampleRetrying(terrain, pts);
      pts.forEach((c, k) => (heights[k] = Number.isFinite(c.height) ? Math.round(c.height * 100) / 100 : NaN));
      const finite = heights.filter(Number.isFinite);
      const fill = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
      for (let k = 0; k < heights.length; k++) if (!Number.isFinite(heights[k])) heights[k] = fill;
    }
    return { n: GRID_N, spacing, half, heights, centre: 0, offset: 0 };
  }

  // ---- worker
  const worker = new Worker(new URL('../../../data/nearField/worker.js', import.meta.url), { type: 'module' });
  let jobId = 0;
  const jobs = new Map();
  worker.onmessage = (e) => {
    const { id } = e.data ?? {};
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (e.data.ok) {
      state.data = e.data.data;
      job.resolve(e.data.out);
    } else job.reject(new Error(e.data.error));
  };
  const runJob = (job) =>
    new Promise((resolve, reject) => {
      const id = ++jobId;
      jobs.set(id, { resolve, reject });
      worker.postMessage({ id, job });
    });

  // ---- scene objects
  const collection = scene.primitives.add(new Cesium.PrimitiveCollection());
  collection.show = true;
  const state = {
    enabled: true,
    radius: 0,
    fade: 0,
    centre: null,
    eyeHeight: 0,
    terrain: terrainSource,
    kit: look.kit,
    needed: [],
    pending: new Set(),
    errors: [],
    data: null,
    lastUpdate: 0,
    maskBuilds: 0,
    jobsDone: 0,
  };
  const needed = new Set();
  const cells = createLru(MAX_CELLS, {
    pinned: (k) => needed.has(k),
    onEvict: (_k, e) => {
      for (const m of [e.main, e.trees]) if (m && !m.isDestroyed()) collection.remove(m);
    },
  });

  const lightUniforms = () => ({
    u_nfLight: { type: Cesium.UniformType.VEC2, value: new Cesium.Cartesian2(look.key, look.ambient) },
    u_nfShadow: { type: Cesium.UniformType.VEC3, value: Cesium.Cartesian3.fromArray(look.shadow) },
    u_nfWarm: { type: Cesium.UniformType.VEC3, value: Cesium.Cartesian3.fromArray(look.warm) },
  });
  function modelShader(isTree) {
    return new Cesium.CustomShader({
      mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
      lightingModel: Cesium.LightingModel.UNLIT,
      uniforms: {
        u_nfEyeToLocal: { type: Cesium.UniformType.MAT4, value: Cesium.Matrix4.IDENTITY.clone() },
        u_nfCentre: { type: Cesium.UniformType.VEC2, value: new Cesium.Cartesian2() },
        u_nfBubble: { type: Cesium.UniformType.VEC4, value: new Cesium.Cartesian4(0, BUBBLE.edge, TREE_RADIUS, 0) },
        u_nfIsTree: { type: Cesium.UniformType.FLOAT, value: isTree ? 1 : 0 },
        ...lightUniforms(),
      },
      fragmentShaderText: MODEL_FS,
    });
  }
  // two shared shaders: every cell model uses one of them (uniforms set once per frame)
  const shaders = { main: modelShader(false), trees: modelShader(true) };

  // ---- the tile part (hide Google under our objects)
  const MASK_N = 2048;
  const tilePart = {
    id: 'near-field-clip',
    order: -10,
    uniforms: {
      u_nfcEyeToLocal: { type: Cesium.UniformType.MAT4, value: Cesium.Matrix4.IDENTITY.clone() },
      u_nfcCentre: { type: Cesium.UniformType.VEC2, value: new Cesium.Cartesian2() },
      u_nfcBubble: { type: Cesium.UniformType.VEC4, value: new Cesium.Cartesian4(0, BUBBLE.edge, 0, 1) },
      u_nfcMask: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: new Cesium.TextureUniform({ typedArray: new Uint8Array(4), width: 1, height: 1 }),
      },
    },
    glsl: TILE_GLSL,
    body: 'nfClip(fsInput);',
  };
  const hosts = new Set();
  function attachTiles() {
    const p = scene.primitives;
    for (let i = 0; i < p.length; i++) {
      const ts = p.get(i);
      if (!(ts instanceof Cesium.Cesium3DTileset) || ts.isDestroyed()) continue;
      const host = ts[HOST_KEY] ?? tileShaderHost(Cesium, ts);
      if (!host.parts().includes(tilePart.id)) host.attach(tilePart);
      hosts.add(host);
    }
  }
  const setTileUniform = (name, value) => {
    tilePart.uniforms[name].value = value;
    for (const h of hosts) if (h.parts().includes(tilePart.id)) h.setUniform(name, value);
  };

  // mask frame: a local ENU square around `mask.centre`
  const mask = { centre: null, half: 0, pendingFrames: 0, next: null, cells: '' };
  const enuOf = (lat, lon) =>
    Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat, 0, ellipsoid));
  function buildMask(centre, half) {
    const n = MASK_N;
    const px = (2 * half) / n;
    const north = new Uint8Array(n * n);
    const rgba = new Uint8Array(n * n * 4);
    let fps = 0;
    for (const e of cells.values()) {
      if (e.status !== 'ready' || !needed.has(e.key) || e.appear < 1) continue;
      const [ox, oy] = toLocal(e.centre.lat, e.centre.lon, centre);
      const polys = e.footprints.map((f) => f.rings.map((r) => r.map(([x, y]) => [x + ox, y + oy])));
      rasterize(north, n, px, half, polys, 1);
      fps += polys.length;
      for (const [x0, y0, x1, y1, level] of e.water) {
        const code = Math.max(0, Math.min(65535, Math.round((level + 1000) * 10)));
        const i0 = Math.max(0, Math.floor((x0 + ox + half) / px)), i1 = Math.min(n - 1, Math.ceil((x1 + ox + half) / px) - 1);
        const j0 = Math.max(0, Math.floor((y0 + oy + half) / px)), j1 = Math.min(n - 1, Math.ceil((y1 + oy + half) / px) - 1);
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const k = (j * n + i) * 4; // row 0 = south (texture v = 0)
            rgba[k + 1] = 255;
            rgba[k + 2] = code >> 8;
            rgba[k + 3] = code & 255;
          }
      }
    }
    for (let row = 0; row < n; row++) {
      const j = n - 1 - row;
      for (let i = 0; i < n; i++) if (north[row * n + i]) rgba[(j * n + i) * 4] = 255;
    }
    state.maskBuilds++;
    state.maskFootprints = fps;
    return new Cesium.TextureUniform({
      typedArray: rgba,
      width: n,
      height: n,
      minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
      magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
    });
  }

  // ---- note + credits (shown while the bubble is on screen)
  const doc = win?.document;
  const note = doc?.createElement('div');
  if (note) {
    note.className = 'gev-near-field-note';
    note.textContent = t('Nearby buildings and trees are generated by GEV from OpenStreetMap data');
    Object.assign(note.style, {
      position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: 5,
      font: '11px/1.3 system-ui, sans-serif', color: '#f3efe6', background: 'rgba(20,24,28,.55)',
      padding: '3px 8px', borderRadius: '9px', pointerEvents: 'none', display: 'none',
    });
    doc.body.appendChild(note);
  }
  let creditShown = false;
  function showCredit(on) {
    if (on === creditShown) return;
    creditShown = on;
    if (note) note.style.display = on ? 'block' : 'none';
    try {
      if (on) showOsmCredit(viewer, OWNER, { openMapTiles: true });
      else hideOsmCredit(viewer, OWNER);
    } catch (error) {
      state.errors.push(`credit: ${error?.message ?? error}`);
    }
  }

  // ---- cell lifecycle
  let modelSeq = 0;
  async function load(c) {
    const entry = { key: c.key, cell: { z: c.z, x: c.x, y: c.y }, status: 'pending', appear: 0, centre: tileCentre(c) };
    cells.set(c.key, entry);
    state.pending.add(c.key);
    try {
      const prep = await runJob({ phase: 'prepare', cell: entry.cell });
      const [ground, vertexHeights] = await Promise.all([sampleGrid(entry.cell), samplePoints(prep.points, prep.centre)]);
      entry.ground = ground;
      entry.terrain = terrainNow() ? terrainSource : 'ellipsoid';
      const out = await runJob({ cell: entry.cell, ground, vertexHeights, kit: look.kit, kitOverrides: look.colours ?? {}, trees: look.trees ?? 1 });
      const modelMatrix = enuOf(entry.centre.lat, entry.centre.lon);
      // Cesium caches typed-array glTFs by basePath alone (ResourceCacheKey
      // "gltf:<basePath>"): without a unique one every cell gets the first model.
      const make = async (bytes, shader) =>
        bytes
          ? collection.add(
              await Cesium.Model.fromGltfAsync({
                gltf: bytes,
                basePath: `/near-field-cell/${c.key}/${shader === shaders.trees ? 'trees' : 'main'}/${++modelSeq}/`,
                modelMatrix,
                upAxis: Cesium.Axis.Z,
                forwardAxis: Cesium.Axis.X,
                customShader: shader,
                shadows: Cesium.ShadowMode.DISABLED,
                show: false,
              }),
            )
          : null;
      entry.main = await make(out.main, shaders.main);
      entry.trees = await make(out.trees, shaders.trees);
      if (cells.peek(c.key) !== entry) {
        // evicted while loading
        for (const m of [entry.main, entry.trees]) if (m) collection.remove(m);
        return;
      }
      Object.assign(entry, { status: 'ready', footprints: out.footprints, water: out.water, buildings: out.buildings, stats: out.stats, readyAt: performance.now() });
      state.jobsDone++;
    } catch (error) {
      entry.status = 'error';
      entry.error = String(error?.message ?? error);
      state.errors.push(`${c.key}: ${entry.error}`);
      if (state.errors.length > 50) state.errors.shift();
      setTimeout(() => cells.peek(c.key) === entry && cells.delete(c.key), 15000);
    } finally {
      state.pending.delete(c.key);
    }
  }

  function groundBelow(lat, lon) {
    for (const e of cells.values()) {
      if (!e.ground) continue;
      const [x, y] = toLocal(lat, lon, e.centre);
      const g = e.ground;
      if (Math.abs(x) > g.half || Math.abs(y) > g.half) continue;
      const i = Math.round((x + g.half) / g.spacing), j = Math.round((y + g.half) / g.spacing);
      return g.heights[Math.min(g.n - 1, Math.max(0, j)) * g.n + Math.min(g.n - 1, Math.max(0, i))];
    }
    return state.lastGround ?? 0;
  }

  function updateBubble(now) {
    state.camKey = camKey();
    state.lastUpdate = now;
    const carto = camera.positionCartographic;
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const g = groundBelow(lat, lon);
    state.lastGround = g;
    state.eyeHeight = carto.height - g;
    const { radius, fade } = state.enabled ? bubbleRadius(state.eyeHeight) : { radius: 0, fade: 0 };
    state.radius = radius;
    state.fade = fade;
    needed.clear();
    if (radius <= 0) {
      state.needed = [];
      state.centre = null;
      return;
    }
    const centre = bubbleCentre({ lat, lon, heading: camera.heading, pitch: camera.pitch, eyeHeight: state.eyeHeight }, radius);
    state.centre = centre;
    const list = cellsInBubble(centre, radius + BUBBLE.margin);
    state.needed = list.map((c) => c.key);
    for (const c of list) needed.add(c.key);
    for (const c of list) {
      if (state.pending.size >= MAX_INFLIGHT) break;
      if (!cells.has(c.key)) load(c);
    }
    // cells built on the bare ellipsoid before the app's terrain arrived are rebuilt
    if (terrainNow())
      for (const e of cells.values()) if (e.status === 'ready' && e.terrain === 'ellipsoid') cells.delete(e.key);
    // refresh recency of the cells in view
    for (const c of list) if (cells.has(c.key)) cells.get(c.key);
    cells.trim();
    // the mask follows the bubble in steps (rebuilt when the centre moved or cells changed)
    const ready = list.filter((c) => cells.peek(c.key)?.status === 'ready' && cells.peek(c.key).appear >= 1).map((c) => c.key).join(',');
    const half = Math.ceil((radius + BUBBLE.margin) / 50) * 50;
    const moved = !mask.centre || Math.hypot(...toLocal(centre.lat, centre.lon, mask.centre)) > radius * 0.15 || half > mask.half;
    if ((moved || ready !== mask.cells) && !mask.next) {
      const mc = { lat: centre.lat, lon: centre.lon };
      mask.next = { centre: mc, half, tex: buildMask(mc, half), cells: ready };
      setTileUniform('u_nfcMask', mask.next.tex);
      mask.pendingFrames = 2; // the texture lands on the next update; switch the frame after it
    }
    state.lastUpdate = now;
  }

  const scratch = new Cesium.Matrix4();
  const worldToMask = new Cesium.Matrix4();
  const eyeToMask = new Cesium.Matrix4();
  function perFrame() {
    if (!state.enabled && state.fade === 0 && !creditShown) return;
    const now = performance.now();
    if (now - state.lastUpdate > 200) {
      try {
        attachTiles();
        updateBubble(now);
      } catch (error) {
        state.errors.push(`update: ${error?.message ?? error}`);
      }
    }
    if (mask.next && --mask.pendingFrames <= 0) {
      Object.assign(mask, { centre: mask.next.centre, half: mask.next.half, cells: mask.next.cells });
      mask.next = null;
    }
    // shared uniforms
    const frame = mask.centre ?? state.centre;
    let shown = 0;
    if (frame) {
      Cesium.Matrix4.inverseTransformation(enuOf(frame.lat, frame.lon), worldToMask);
      Cesium.Matrix4.multiply(worldToMask, camera.inverseViewMatrix, eyeToMask);
      const c = state.centre ? toLocal(state.centre.lat, state.centre.lon, frame) : [0, 0];
      const centre2 = new Cesium.Cartesian2(c[0], c[1]);
      const bubble = new Cesium.Cartesian4(state.radius, BUBBLE.edge, TREE_RADIUS, state.fade);
      for (const s of [shaders.main, shaders.trees]) {
        s.setUniform('u_nfEyeToLocal', Cesium.Matrix4.clone(eyeToMask, scratch));
        s.setUniform('u_nfCentre', centre2);
        s.setUniform('u_nfBubble', bubble);
      }
      setTileUniform('u_nfcEyeToLocal', Cesium.Matrix4.clone(eyeToMask));
      setTileUniform('u_nfcCentre', centre2);
      setTileUniform('u_nfcBubble', new Cesium.Cartesian4(state.radius, BUBBLE.edge, request.debug ? 0 : state.fade, mask.half || 1));
      // visibility: models of needed cells; trees only inside the tree radius (LOD)
      const treeR = state.radius * TREE_RADIUS + BUBBLE.margin;
      const dist = new Map();
      if (state.centre) for (const k of state.needed) dist.set(k, 0);
      for (const e of cells.values()) {
        if (e.status !== 'ready') continue;
        const on = needed.has(e.key) && state.fade > 0;
        if (on && e.appear < 1) e.appear = Math.min(1, (now - e.readyAt) / 500);
        const d = state.centre ? Math.max(0, Math.hypot(...toLocal(e.centre.lat, e.centre.lon, state.centre)) - tileSizeM(e.cell) * 0.71) : Infinity;
        if (e.main) e.main.show = on;
        if (e.trees) e.trees.show = on && d < treeR;
        if (on) shown++;
      }
    }
    showCredit(shown > 0);
  }
  const removePre = scene.preRender.addEventListener(perFrame);
  // The app may run Cesium in request-render mode: keep frames coming while
  // the bubble is loading, fading in or swapping its mask.
  const camKey = () => {
    const p = camera.positionWC;
    return `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)},${camera.heading.toFixed(3)},${camera.pitch.toFixed(3)}`;
  };
  const kick = setInterval(() => {
    if (!api.idle() || mask.next || camKey() !== state.camKey) scene.requestRender?.();
  }, 250);


  // ---- QA API
  const api = {
    get state() {
      return {
        ...state,
        pending: [...state.pending],
        cached: cells.size,
        ready: [...cells.values()].filter((e) => e.status === 'ready').length,
        shownCells: [...cells.values()].filter((e) => e.main?.show).length,
        mask: { centre: mask.centre, half: mask.half },
        look,
      };
    },
    cells: () =>
      cells.values().map((e) => ({ key: e.key, status: e.status, needed: needed.has(e.key), shown: !!e.main?.show, appear: e.appear, stats: e.stats, error: e.error })),
    setEnabled(on) {
      state.enabled = !!on;
      state.lastUpdate = 0; // apply on the next frame
      scene.requestRender?.();
    },
    /** True when every needed cell is ready (or failed) and nothing is pending. */
    idle() {
      if (!state.radius) return true;
      return state.needed.every((k) => {
        const e = cells.peek(k);
        return e && e.status !== 'pending' && (e.status === 'error' || e.appear >= 1);
      }) && mask.cells === state.needed.filter((k) => cells.peek(k)?.status === 'ready').join(',');
    },
    /** QA: terrain heights at [lat, lon] points from the bubble's terrain source (never Google). */
    async sample(latLons) {
      const tp = terrainNow();
      const pts = latLons.map(([lat, lon]) => Cesium.Cartographic.fromDegrees(lon, lat));
      if (tp) await sampleRetrying(tp, pts);
      return pts.map((c) => (tp ? c.height : 0));
    },
    /** QA: the generated buildings of a cell (local metres around `centre`). */
    buildingsOf(key) {
      const e = cells.peek(key);
      return e?.buildings ? { centre: e.centre, buildings: e.buildings } : null;
    },
    /**
     * Physical checks of the generated buildings in view, against Cesium World
     * Terrain sampled independently at every footprint vertex (not the
     * worker's grid): floating walls, floor offset, water supports.
     */
    async check({ maxBuildings = 4000 } = {}) {
      const rows = [];
      for (const e of cells.values()) {
        if (e.status !== 'ready' || !needed.has(e.key)) continue;
        for (const b of e.buildings) rows.push({ e, b });
      }
      const pick = rows.slice(0, maxBuildings);
      const pts = [];
      const idx = [];
      for (const { e, b } of pick) {
        const start = pts.length;
        for (const [x, y] of b.p) {
          const g = fromLocal(x, y, e.centre);
          pts.push(Cesium.Cartographic.fromDegrees(g.lon, g.lat));
        }
        idx.push([start, pts.length]);
      }
      const tp = terrainNow();
      if (tp && pts.length) await sampleRetrying(tp, pts);
      else pts.forEach((p) => (p.height = 0));
      const out = { terrain: terrainSource, buildings: pick.length, land: 0, elevatedParts: 0, floating: 0, floorOff1m: 0, maxFloorOff: 0, slopeOver3m: 0, onWater: 0, onWaterUnsupported: 0, pier: 0, hull: 0, examples: [] };
      pick.forEach(({ e, b }, k) => {
        if (b.kind === 'pier') out.pier++;
        if (b.kind === 'hull') out.hull++;
        if (b.share >= 0.25) {
          out.onWater++;
          if (!b.support) out.onWaterUnsupported++;
        }
        if (b.kind !== 'land') return;
        // building:part pieces that OSM lifts (render_min_height > 0) float by design
        if (b.lift > 0) {
          out.elevatedParts++;
          return;
        }
        out.land++;
        const hs = pts.slice(idx[k][0], idx[k][1]).map((p) => p.height).filter(Number.isFinite);
        if (!hs.length) return;
        const lo = Math.min(...hs), hi = Math.max(...hs);
        const mean = hs.reduce((a, h) => a + h, 0) / hs.length;
        const floating = b.wallBottom - lo;
        const off = Math.abs(b.floor - mean);
        if (floating > 1) {
          out.floating++;
          if (out.examples.length < 8) out.examples.push({ cell: e.key, c: b.c, floating: +floating.toFixed(2) });
        }
        if (off > 1) out.floorOff1m++;
        out.maxFloorOff = Math.max(out.maxFloorOff, +off.toFixed(2));
        if (hi - lo > 3) out.slopeOver3m++;
      });
      return out;
    },
    remove() {
      removePre();
      clearInterval(kick);
      showCredit(false);
      note?.remove();
      for (const h of hosts) h.detach(tilePart.id);
      cells.clear();
      scene.primitives.remove(collection);
      worker.terminate();
    },
  };
  if (win) win.__gevNearField = api;
  return api;
}
