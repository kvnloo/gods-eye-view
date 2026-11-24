/**
 * @module render/cesium/themes/osmMask
 * @description FORK-ONLY (exp/theme-engine-v0, loop v3). Streams the OSM
 * class mask around the camera for the theme tile stage: a 3072^2 atlas of
 * 12 x 12 web-mercator mask tiles (z16 near the ground, z15/z14 higher up;
 * off above ~24 km), rasterised from OpenStreetMap vector tiles in a worker
 * (data/osmMask/worker.js), plus the per-frame eye -> ENU matrix computed in
 * double precision on the CPU.
 *
 * Inputs are OSM geometry (OpenFreeMap, OpenMapTiles schema), the camera and
 * the app's globe terrain height for the eye height. No Google content is
 * read: no pick/sampleHeight on tilesets, no pixel readback.
 *
 * Uniforms (set through `setUniform(name, value)` on every themed tileset):
 *   u_th_osmMask        sampler2D atlas (RGBA, see data/osmMask/raster.js)
 *   u_th_osmEyeToLocal  mat4 eye -> ENU metres at the atlas anchor
 *   u_th_osmGeo         vec4 (kx, ky, t, t2): data/osmMask/maskMath.js maskGeo
 *   u_th_osmInfo        vec4 (fade, atlas texels, texels per tile, ready)
 */
import { ATLAS_N, TILE_PX, maskGeo, maskLevel, maskWindow, windowStale } from '../../../data/osmMask/maskMath.js';
import { createLru, tileKey } from '../../../data/nearField/tiling.js';

const MAX_INFLIGHT = 6;
const UPLOAD_MS = 350;

export function emptyMaskTexture(Cesium) {
  return new Cesium.TextureUniform({
    typedArray: new Uint8Array(4),
    width: 1,
    height: 1,
    minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
    magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
  });
}

export function createOsmMask(Cesium, viewer, { setUniform, workerFactory } = {}) {
  const scene = viewer.scene;
  const camera = scene.camera;
  const N = ATLAS_N;
  const PX = N * TILE_PX;
  const atlas = new Uint8Array(PX * PX * 4);
  const cache = createLru(320); // tile key -> rgba (main-thread copy, for re-centring)
  const state = {
    enabled: true,
    win: null, // window shown by the shader
    next: null, // window being uploaded (switch after its texture lands)
    pendingFrames: 0,
    dirty: false,
    lastUpload: 0,
    uploads: 0,
    inflight: new Set(),
    loaded: 0,
    errors: [],
    stats: null,
    eyeHeight: 0,
    fade: 0,
  };
  // OSM attribution on Cesium's own credit line (on screen, after the
  // Google/Cesium credits) while the mask styles anything
  let creditShown = false;
  const osmCredit = new Cesium.Credit(
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://openmaptiles.org" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
    true,
  );
  function showCredit(on) {
    if (on === creditShown) return;
    creditShown = on;
    try {
      const display = viewer.creditDisplay ?? scene.frameState?.creditDisplay;
      if (on) display?.addStaticCredit(osmCredit);
      else display?.removeStaticCredit(osmCredit);
    } catch (error) {
      state.errors.push(`credit: ${error?.message ?? error}`);
    }
  }
  let worker = null;
  let jobId = 0;
  const jobs = new Map();
  function ensureWorker() {
    if (worker) return worker;
    worker = workerFactory
      ? workerFactory()
      : new Worker(new URL('../../../data/osmMask/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id } = e.data ?? {};
      const job = jobs.get(id);
      if (!job) return;
      jobs.delete(id);
      if (e.data.ok) {
        state.stats = e.data.stats;
        job.resolve(e.data.rgba);
      } else job.reject(new Error(e.data.error));
    };
    return worker;
  }
  const run = (tile) =>
    new Promise((resolve, reject) => {
      const id = ++jobId;
      jobs.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, tile: { z: tile.z, x: tile.x, y: tile.y } });
    });

  // the atlas being filled belongs to `state.next ?? state.win`
  const target = () => state.next ?? state.win;
  function blit(rgba, slot) {
    const [si, sj] = slot;
    for (let j = 0; j < TILE_PX; j++)
      atlas.set(rgba.subarray(j * TILE_PX * 4, (j + 1) * TILE_PX * 4), ((sj * TILE_PX + j) * PX + si * TILE_PX) * 4);
  }
  function startWindow(win) {
    atlas.fill(0);
    let have = 0;
    for (const t of win.tiles) {
      const rgba = cache.get(tileKey(t));
      if (rgba) {
        blit(rgba, t.slot);
        have++;
      }
    }
    state.next = win;
    state.loaded = have;
    state.dirty = true;
    state.lastUpload = 0;
  }
  function pump() {
    const win = target();
    if (!win) return;
    for (const t of win.tiles) {
      if (state.inflight.size >= MAX_INFLIGHT) break;
      const key = tileKey(t);
      if (cache.has(key) || state.inflight.has(key)) continue;
      state.inflight.add(key);
      run(t)
        .then((rgba) => {
          cache.set(key, rgba);
          const w = target();
          const mine = w?.tiles.find((s) => tileKey(s) === key);
          if (mine) {
            blit(rgba, mine.slot);
            state.loaded++;
            state.dirty = true;
          }
        })
        .catch((error) => {
          if (state.errors.length < 20) state.errors.push(String(error?.message ?? error));
        })
        .finally(() => {
          state.inflight.delete(key);
          scene.requestRender?.();
        });
    }
  }
  function upload(now) {
    const tex = new Cesium.TextureUniform({
      typedArray: atlas.slice(),
      width: PX,
      height: PX,
      minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
      magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
    });
    setUniform('u_th_osmMask', tex);
    state.dirty = false;
    state.lastUpload = now;
    state.uploads++;
    // the texture lands on the next frame's update: switch the frame after it
    if (state.next) state.pendingFrames = 2;
  }

  // ---------------------------------------------------------- per frame
  const enuScratch = new Cesium.Matrix4();
  const worldToLocal = new Cesium.Matrix4();
  const eyeToLocal = new Cesium.Matrix4();
  const carto = new Cesium.Cartographic();
  let shownKey = '';
  function eyeHeightNow() {
    const c = camera.positionCartographic;
    let g = 0;
    try {
      // the app's globe terrain (World Terrain / keyless terrain), never the tileset
      carto.longitude = c.longitude;
      carto.latitude = c.latitude;
      carto.height = 0;
      g = scene.globe?.getHeight?.(carto) ?? 0;
    } catch {
      g = 0;
    }
    return c.height - (Number.isFinite(g) ? g : 0);
  }
  function focus(eye) {
    // ground point ahead of the camera, so the window covers what is in view
    const c = camera.positionCartographic;
    const pitch = camera.pitch;
    const ahead = pitch < -0.05 ? Math.min(eye / Math.tan(-pitch), 3.5 * Math.max(eye, 200)) : 3.5 * Math.max(eye, 200);
    const d = Math.min(ahead * 0.6, 2500 * (eye > 1400 ? eye / 1400 : 1));
    const R = 6371000;
    const lat = Cesium.Math.toDegrees(c.latitude) + Cesium.Math.toDegrees((d * Math.cos(camera.heading)) / R);
    const lon =
      Cesium.Math.toDegrees(c.longitude) +
      Cesium.Math.toDegrees((d * Math.sin(camera.heading)) / (R * Math.max(0.05, Math.cos(c.latitude))));
    return { lat, lon };
  }

  function update(active) {
    const now = performance.now();
    if (!active || !state.enabled) {
      showCredit(false);
      if (state.fade !== 0) {
        state.fade = 0;
        setUniform('u_th_osmInfo', new Cesium.Cartesian4(0, PX, TILE_PX, state.win ? 1 : 0));
      }
      return;
    }
    const eye = eyeHeightNow();
    state.eyeHeight = eye;
    const { z, fade } = maskLevel(eye);
    state.fade = fade;
    if (z) {
      const f = focus(eye);
      const cur = target();
      if (windowStale(cur, f.lat, f.lon, z)) startWindow(maskWindow(f.lat, f.lon, z, N));
      pump();
    }
    if (state.dirty && (now - state.lastUpload > UPLOAD_MS || (state.loaded >= (target()?.tiles.length ?? 0) && !state.inflight.size)))
      upload(now);
    if (state.next && state.pendingFrames > 0 && --state.pendingFrames === 0) {
      state.win = state.next;
      state.next = null;
    }
    const win = state.win;
    showCredit(!!win && fade > 0 && state.loaded > 0);
    if (!win) return;
    if (shownKey !== win.key) {
      shownKey = win.key;
      const g = maskGeo(win.anchor.lat, win.z);
      setUniform('u_th_osmGeo', new Cesium.Cartesian4(g.kx, g.ky, g.t, g.t2));
    }
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(win.anchor.lon, win.anchor.lat, 0),
      Cesium.Ellipsoid.WGS84,
      enuScratch,
    );
    Cesium.Matrix4.inverseTransformation(enu, worldToLocal);
    Cesium.Matrix4.multiply(worldToLocal, camera.inverseViewMatrix, eyeToLocal);
    setUniform('u_th_osmEyeToLocal', Cesium.Matrix4.clone(eyeToLocal));
    setUniform('u_th_osmInfo', new Cesium.Cartesian4(z ? fade : 0, PX, TILE_PX, 1));
    if (state.inflight.size || state.dirty || state.next) scene.requestRender?.();
  }

  return {
    update,
    get state() {
      return {
        enabled: state.enabled,
        credit: creditShown,
        window: state.win && { key: state.win.key, z: state.win.z, anchor: state.win.anchor },
        pending: state.next?.key ?? null,
        loaded: state.loaded,
        tiles: target()?.tiles.length ?? 0,
        inflight: state.inflight.size,
        uploads: state.uploads,
        eyeHeight: state.eyeHeight,
        fade: state.fade,
        errors: [...state.errors],
        worker: state.stats,
      };
    },
    /** True when the window in view is fully loaded and uploaded. */
    idle() {
      return !!state.win && !state.next && !state.dirty && !state.inflight.size && state.loaded >= state.win.tiles.length;
    },
    setEnabled(on) {
      state.enabled = !!on;
      scene.requestRender?.();
    },
    active: () => !!state.win && state.fade > 0 && state.enabled,
    dispose() {
      showCredit(false);
      worker?.terminate();
      worker = null;
      jobs.clear();
    },
  };
}
