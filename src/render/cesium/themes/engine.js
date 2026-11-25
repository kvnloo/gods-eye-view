/**
 * @module render/cesium/themes/engine
 * @description FORK-ONLY (exp/theme-engine-v0). The theme engine: a
 * ReShade-style effect stack for the whole globe.
 *
 * - Stage 0 (`tile`): a material part composed into the CustomShader of every
 *   3D tileset the scene shows (Google Photorealistic 3D Tiles anywhere, OSM
 *   buildings, any other), found each frame, so it follows tilesets the app
 *   adds, parks or swaps at any location, zoom or mode.
 * - Post stages: one top-level `PostProcessStage` (or composite) per effect
 *   on `scene.postProcessStages`, in preset order. A shared prepass
 *   (launchpad) runs only when an enabled effect or the wipe needs it.
 * - Presets switch at runtime: enabled flags and uniform values only
 *   (`setUniform` on tiles, live uniform functions on stages). Only a new
 *   order or a new custom effect rebuilds the post stages.
 * - Safety: every stage's update/execute is guarded; an effect that throws
 *   (a compile error in a custom effect) is switched off and reported, the
 *   globe keeps drawing. A frame budget switches off the most expensive
 *   effect when frames stay too slow.
 * - Attribution: the engine only touches the WebGL frame. The credit
 *   container and HUD are DOM above the canvas and are never drawn over.
 *
 * Cesium is passed in (`index.js` supplies it), so the module also runs in
 * the offline harness on the Cesium build.
 */
import { POST_EFFECTS, postEffect, defaultsOf } from './effectLibrary.js';
import { TILE_UNIFORMS, tileStagePart, tileUniformValue } from './tileStage.js';
import { tileShaderHost, HOST_KEY } from './tileShaderHost.js';
import { normalizePreset, PERF_TIERS } from './presets.js';
import { parseCustomEffect } from './customEffects.js';
import { createThemeSun } from './themeSun.js';

const LAUNCHPAD = 'launchpad';
const WIPE = 'wipe';

/**
 * @param {object} Cesium
 * @param {object} viewer A Cesium Viewer or CesiumWidget.
 * @param {{preset?: object, wipe?: number, budget?: boolean,
 *   onChange?: Function}} [options]
 */
export function createThemeEngine(Cesium, viewer, options = {}) {
  const scene = viewer.scene;
  // metadata reader for probe(): index.js passes internals.tilePrimitiveFacts
  const facts = options.tilePrimitiveFacts ?? (() => []);
  const effects = new Map(POST_EFFECTS.map((e) => [e.id, e]));
  const values = { tile: defaultsOf(TILE_UNIFORMS) };
  for (const e of POST_EFFECTS) values[e.id] = defaultsOf(e.uniforms);
  const state = {
    preset: null,
    order: [],
    enabled: new Set(),
    textures: {},
    wipe: Number(options.wipe ?? 0) || 0,
    errors: [],
    notices: [],
    failed: new Set(),
    budget: options.budget !== false,
  };
  const stages = new Map(); // id -> top-level stage
  const scratch = new Map(); // `${id}.${k}` -> Cartesian3
  const hosts = new Set();
  // runtime (non-preset) tile uniforms: the OSM class mask (osmMask.js)
  const runtime = {};
  function setRuntimeUniform(name, value) {
    runtime[name] = value;
    for (const ts of hosts) {
      if (ts.isDestroyed?.()) continue;
      ts[HOST_KEY]?.setUniform(name, value);
    }
  }
  const osmMask = options.osmMask
    ? options.osmMask({ setUniform: setRuntimeUniform })
    : null;
  const listeners = new Set();
  let disposed = false;
  // a preset's own sun (themeSun.js); absent in harnesses without Cesium lights
  const sun =
    Cesium.DirectionalLight && scene.shadowMap !== undefined && scene.globe
      ? createThemeSun(Cesium, viewer)
      : null;
  function applySun() {
    try {
      sun?.set(disposed ? null : (state.preset?.sun ?? null));
    } catch (error) {
      if (state.errors.length < 50)
        state.errors.push({ id: 'sun', message: String(error?.message ?? error) });
    }
  }

  const changed = () => {
    scene.requestRender?.();
    for (const l of listeners) l(api);
    options.onChange?.(api);
  };

  // ---------------------------------------------------------------- tiles
  function tilesets() {
    const out = [];
    const walk = (collection, depth) => {
      const n = collection?.length ?? 0;
      for (let i = 0; i < n; i++) {
        const p = collection.get(i);
        if (p instanceof Cesium.Cesium3DTileset) out.push(p);
        else if (depth < 2 && p instanceof Cesium.PrimitiveCollection)
          walk(p, depth + 1);
      }
    };
    walk(scene.primitives, 0);
    // the offline harness themes a glTF Model stand-in the same way
    for (const extra of options.tileTargets?.() ?? []) out.push(extra);
    return out;
  }
  function tileValues() {
    const on = state.enabled.has('tile') && !state.failed.has('tile');
    return {
      ...values.tile,
      strength: on ? values.tile.strength : 0,
      wipe: state.wipe,
    };
  }
  function attachTiles() {
    for (const ts of tilesets()) {
      if (ts.isDestroyed?.()) continue;
      const host = ts[HOST_KEY];
      if (host?.parts().includes('theme')) continue;
      try {
        tileShaderHost(Cesium, ts).attach(
          tileStagePart(Cesium, tileValues(), runtime),
        );
        hosts.add(ts);
      } catch (error) {
        fail('tile', error);
      }
    }
  }
  function pushTileUniforms() {
    const v = tileValues();
    for (const ts of hosts) {
      if (ts.isDestroyed?.()) {
        hosts.delete(ts);
        continue;
      }
      const host = ts[HOST_KEY];
      if (!host) continue;
      host.setUniform('u_th_wipe', v.wipe);
      for (const k of Object.keys(TILE_UNIFORMS))
        host.setUniform(`u_th_${k}`, tileUniformValue(Cesium, k, v[k]));
    }
  }

  // ----------------------------------------------------------- post stages
  function live(id, k) {
    return () => {
      const v = values[id]?.[k];
      if (Array.isArray(v)) {
        const key = `${id}.${k}`;
        let c = scratch.get(key);
        if (!c) scratch.set(key, (c = new Cesium.Cartesian3()));
        c.x = v[0];
        c.y = v[1];
        c.z = v[2];
        return c;
      }
      return Number(v);
    };
  }
  function uniformsFor(effect, passNames) {
    const u = {};
    for (const k of Object.keys(effect.uniforms ?? {}))
      u[k] = live(effect.id, k);
    if (effect.launchpad) u.launchpadTexture = 'gev_fx_launchpad';
    if (effect.id === WIPE) u.sourceTexture = 'gev_fx_src';
    for (const t of effect.textures ?? [])
      if (state.textures[t]) u[t] = state.textures[t];
    for (const [pass, name] of Object.entries(passNames ?? {}))
      u[`pass_${pass}`] = name;
    return u;
  }
  function guard(id, stage) {
    const proto = Object.getPrototypeOf(stage);
    for (const m of ['update', 'execute']) {
      const orig = proto[m];
      if (typeof orig !== 'function') continue;
      stage[m] = function guarded(...args) {
        try {
          return orig.apply(this, args);
        } catch (error) {
          fail(id, error);
          return undefined;
        }
      };
    }
    return stage;
  }
  function buildStage(effect) {
    const prefix = `gev_fx_${effect.id}`;
    if (!effect.passes) {
      return guard(
        effect.id,
        new Cesium.PostProcessStage({
          name: prefix,
          fragmentShader: effect.fragmentShader,
          uniforms: uniformsFor(effect),
          sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
        }),
      );
    }
    const passNames = {};
    for (const p of effect.passes)
      passNames[p.name] = p.stageName ?? `${prefix}_${p.name}`;
    const children = effect.passes.map((p) =>
      guard(
        effect.id,
        new Cesium.PostProcessStage({
          name: passNames[p.name],
          fragmentShader: p.fragmentShader,
          textureScale: p.textureScale ?? 1,
          uniforms: uniformsFor(effect, passNames),
          sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
        }),
      ),
    );
    return new Cesium.PostProcessStageComposite({
      // never a pass's own name (the launchpad pass is gev_fx_launchpad)
      name: `${prefix}_group`,
      stages: children,
      inputPreviousStageTexture: false,
    });
  }
  function removeStages() {
    for (const stage of stages.values())
      if (!stage.isDestroyed?.()) scene.postProcessStages.remove(stage);
    stages.clear();
  }
  /** Rebuild every post stage in `state.order` (launchpad first, wipe last). */
  function rebuild() {
    removeStages();
    const ids = [
      LAUNCHPAD,
      ...state.order.filter((id) => id !== 'tile' && effects.has(id)),
      WIPE,
    ];
    for (const id of ids) {
      const effect = effects.get(id);
      if (!effect) continue;
      try {
        const stage = buildStage(effect);
        stage.enabled = false;
        scene.postProcessStages.add(stage);
        stages.set(id, stage);
      } catch (error) {
        fail(id, error);
      }
    }
    applyEnabled();
  }
  function wanted(id) {
    if (state.failed.has(id)) return false;
    if (id === WIPE) return state.wipe > 0;
    if (id === LAUNCHPAD)
      return (
        state.wipe > 0 ||
        [...state.enabled].some(
          (e) => effects.get(e)?.launchpad && !state.failed.has(e),
        )
      );
    if (id === 'lut' && !state.textures.lutTexture) return false;
    return state.enabled.has(id);
  }
  function applyEnabled() {
    for (const [id, stage] of stages) stage.enabled = wanted(id);
    pushTileUniforms();
    changed();
  }

  // ---------------------------------------------------------------- safety
  function fail(id, error) {
    const message = String(error?.message ?? error).slice(0, 2000);
    if (state.failed.has(id)) return;
    state.failed.add(id);
    state.errors.push({ id, message, at: Date.now() });
    // Switched off after this frame: disabling a stage while the collection
    // executes leaves Cesium's final copy reading a texture that is gone.
    pendingOff.add(id);
    scene.requestRender?.();
    if (id === 'tile') pushTileUniforms();
    console.error(`[theme] effect ${id} switched off:`, message);
    changed();
  }
  let ewma = 0;
  let slow = 0;
  let last = 0;
  const pendingOff = new Set();
  function onPostRender() {
    if (pendingOff.size) {
      for (const id of pendingOff) {
        const stage = stages.get(id);
        if (stage && !stage.isDestroyed?.()) stage.enabled = false;
      }
      pendingOff.clear();
      scene.requestRender?.();
    }
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (!state.budget || dt <= 0 || dt > 250) return;
    ewma = ewma ? ewma * 0.92 + dt * 0.08 : dt;
    const minFps = PERF_TIERS[state.preset?.perfTier] ?? 30;
    const target = viewer.targetFrameRate ? 1000 / viewer.targetFrameRate : 0;
    const limit = Math.max(1000 / minFps, target * 1.5);
    slow = ewma > limit ? slow + 1 : 0;
    if (slow < 180) return;
    slow = 0;
    ewma = 0;
    const costly = [...state.enabled]
      .filter((id) => id !== 'tile' && stages.get(id)?.enabled)
      .sort(
        (a, b) => (effects.get(b)?.cost ?? 0) - (effects.get(a)?.cost ?? 0),
      )[0];
    if (!costly) return;
    state.enabled.delete(costly);
    state.notices.push({
      id: costly,
      message: `frame budget: ${costly} switched off (${Math.round(limit)} ms/frame)`,
      at: Date.now(),
    });
    applyEnabled();
  }

  // ------------------------------------------------------------- quality
  const qualityPrior = { saved: false, sse: new Map() };
  let quality = null;
  const phone = () =>
    globalThis.matchMedia?.('(pointer: coarse)').matches === true ||
    (globalThis.innerWidth ?? 1200) < 800;
  function wantedScale() {
    if (!quality || quality.resolutionScale === undefined) return null;
    const dpr = globalThis.devicePixelRatio || 1;
    const cap = phone() ? quality.phoneMaxDpr : quality.maxDpr;
    return quality.resolutionScale === 'dpr'
      ? Math.min(dpr, cap)
      : Math.min(quality.resolutionScale, cap);
  }
  function applyQuality(next) {
    if (options.quality === false) next = null;
    if (next && !qualityPrior.saved) {
      qualityPrior.saved = true;
      qualityPrior.scale = viewer.resolutionScale;
      qualityPrior.recommended = viewer.useBrowserRecommendedResolution;
      qualityPrior.msaa = scene.msaaSamples;
    }
    quality = next;
    if (!next && qualityPrior.saved) {
      viewer.resolutionScale = qualityPrior.scale;
      viewer.useBrowserRecommendedResolution = qualityPrior.recommended;
      if (scene.msaaSamples !== qualityPrior.msaa)
        scene.msaaSamples = qualityPrior.msaa;
      for (const [ts, sse] of qualityPrior.sse)
        if (!ts.isDestroyed?.()) ts.maximumScreenSpaceError = sse;
      qualityPrior.sse.clear();
      qualityPrior.saved = false;
      return;
    }
    if (!next) return;
    const scale = wantedScale();
    if (scale !== null) {
      // Cesium: with the browser-recommended resolution on, 1 is one pixel
      // per CSS pixel; the scale multiplies that.
      viewer.useBrowserRecommendedResolution = true;
      viewer.resolutionScale = scale;
    }
    if (
      !phone() &&
      Number.isFinite(next.msaa) &&
      scene.msaaSupported !== false
    ) {
      const samples = Math.max(1, next.msaa);
      if (scene.msaaSamples !== samples) scene.msaaSamples = samples;
    }
    applyTileQuality();
  }
  function applyTileQuality() {
    const sse = quality?.maximumScreenSpaceError;
    if (!Number.isFinite(sse) || phone()) return;
    for (const ts of tilesets()) {
      if (ts.isDestroyed?.() || !('maximumScreenSpaceError' in ts)) continue;
      if (!qualityPrior.sse.has(ts))
        qualityPrior.sse.set(ts, ts.maximumScreenSpaceError);
      if (ts.maximumScreenSpaceError !== sse) ts.maximumScreenSpaceError = sse;
    }
  }

  // ------------------------------------------------------------------ hud
  // A preset may dim GEV's scope mask (the dark circular frame over the
  // scene): `hud: { scopeMask: 0..1 }` is its opacity under the theme. The
  // judges read the full-strength frame as heavy dark edges on a painted
  // map. Inline !important wins over the app's own inline value and over
  // city-play.css; scopeMask.js rewrites its inline opacity, so it is
  // re-asserted on the quality tick and the app's value is put back after.
  let hudPrior = null;
  function applyHud() {
    const el = globalThis.document?.getElementById?.('scope-mask');
    if (!el) return;
    const want = state.preset?.hud?.scopeMask;
    if (Number.isFinite(want) && !disposed) {
      if (hudPrior === null)
        hudPrior = el.style.getPropertyPriority('opacity')
          ? ''
          : el.style.opacity;
      const v = String(want);
      if (
        el.style.opacity !== v ||
        el.style.getPropertyPriority('opacity') !== 'important'
      )
        el.style.setProperty('opacity', v, 'important');
    } else if (hudPrior !== null) {
      el.style.removeProperty('opacity');
      if (hudPrior) el.style.opacity = hudPrior;
      hudPrior = null;
    }
  }

  let qualityTick = 0;
  const removePreUpdate = scene.preUpdate.addEventListener(() => {
    if (disposed) return;
    if (state.enabled.has('tile')) attachTiles();
    if (osmMask) {
      const v = values.tile;
      try {
        osmMask.update(
          state.enabled.has('tile') && (v.osm > 0.001 || v.debugOsm > 0.5),
        );
      } catch (error) {
        if (state.errors.length < 50)
          state.errors.push({ id: 'osmMask', message: String(error?.message ?? error) });
      }
    }
    if (sun?.state.active) sun.update();
    if (++qualityTick % 30 === 0) applyHud();
    if (quality && qualityTick % 30 === 0) {
      applyTileQuality();
      // the app's pixelRatio setting (0 = scale 1) may land after us
      const scale = wantedScale();
      if (scale !== null && viewer.resolutionScale === 1 && scale !== 1)
        viewer.resolutionScale = scale;
    }
  });
  const removePostRender = scene.postRender.addEventListener(onPostRender);

  // -------------------------------------------------------------- presets
  function setPreset(input) {
    const { preset, problems } = normalizePreset(options.transformPreset?.(input) ?? input, {
      customIds: [...effects.keys()],
    });
    for (const raw of preset.effects ?? []) addEffect(raw, { rebuild: false });
    state.preset = preset;
    state.textures = { ...preset.textures };
    for (const id of Object.keys(values)) {
      const decl = id === 'tile' ? TILE_UNIFORMS : effects.get(id)?.uniforms;
      values[id] = { ...defaultsOf(decl), ...(preset.uniforms[id] ?? {}) };
    }
    state.failed.clear();
    const nextOrder = preset.techniques.filter(
      (id) => id === 'tile' || effects.has(id),
    );
    const sameOrder =
      JSON.stringify(nextOrder) === JSON.stringify(state.order) && stages.size;
    state.order = nextOrder;
    state.enabled = new Set(nextOrder);
    if (problems.length)
      state.notices.push({
        id: 'preset',
        message: problems.join('; '),
        at: Date.now(),
      });
    // Textures are bound when stages are built: a new texture set rebuilds.
    if (
      !sameOrder ||
      preset.textures.lutTexture !== stages.get('lut')?.uniforms?.lutTexture
    )
      rebuild();
    else applyEnabled();
    if (state.enabled.has('tile')) attachTiles();
    applyQuality(preset.quality ?? null);
    applyHud();
    applySun();
    return problems;
  }

  function addEffect(raw, { rebuild: doRebuild = true, enable = false } = {}) {
    const { effect, problems } =
      raw && raw.fragmentShader && raw.custom
        ? { effect: raw, problems: [] }
        : parseCustomEffect(raw);
    if (!effect) {
      state.errors.push({
        id: raw?.id ?? 'custom',
        message: problems.join('; '),
        at: Date.now(),
      });
      changed();
      return { ok: false, problems };
    }
    if (effect.source === undefined) effect.source = raw;
    effects.set(effect.id, effect);
    values[effect.id] = {
      ...defaultsOf(effect.uniforms),
      ...(values[effect.id] ?? {}),
    };
    state.failed.delete(effect.id);
    if (enable) {
      if (!state.order.includes(effect.id)) state.order.push(effect.id);
      state.enabled.add(effect.id);
    }
    if (doRebuild) rebuild();
    return { ok: true, problems: [], id: effect.id };
  }

  function exportPreset() {
    const custom = [...effects.values()].filter(
      (e) => e.custom && state.order.includes(e.id),
    );
    const uniforms = {};
    for (const id of state.order)
      uniforms[id] = structuredClone(values[id] ?? {});
    return {
      format: 'gev-theme-preset/1',
      name: `${state.preset?.name ?? 'custom'}-edit`,
      label: `${state.preset?.label ?? 'Custom'} *`,
      perfTier: state.preset?.perfTier ?? 'medium',
      techniques: state.order.filter((id) => state.enabled.has(id)),
      uniforms,
      textures: { ...state.textures },
      effects: custom.map(
        (e) =>
          e.source ?? {
            id: e.id,
            label: e.label,
            uniforms: e.uniforms,
            note: 'custom effect GLSL not embedded',
          },
      ),
    };
  }

  // ---------------------------------------------------------------- probe
  /** Metadata-only probe of the tilesets: no tile pixels are read. */
  function probe() {
    const out = [];
    for (const ts of tilesets()) {
      const info = {
        tilesLoaded: ts.tilesLoaded,
        hasThemePart: !!ts[HOST_KEY]?.parts().includes('theme'),
        parts: ts[HOST_KEY]?.parts() ?? [],
        textures: 0,
        withMipmap: 0,
        mipFilter: 0,
        compressed: 0,
        normals: 0,
        primitives: 0,
      };
      const seen = new Set();
      const visit = (tile) => {
        for (const fact of facts(tile)) {
          info.primitives++;
          if (fact.normals) info.normals++;
          const tex = fact.texture;
          if (!tex || seen.has(tex.key)) continue;
          seen.add(tex.key);
          info.textures++;
          if (tex.hasMipmap) info.withMipmap++;
          const mf = tex.minificationFilter;
          if (
            mf &&
            mf !== Cesium.TextureMinificationFilter.LINEAR &&
            mf !== Cesium.TextureMinificationFilter.NEAREST
          )
            info.mipFilter++;
          if (Cesium.PixelFormat.isCompressedFormat?.(tex.pixelFormat))
            info.compressed++;
          info.maxTexture = Math.max(
            info.maxTexture ?? 0,
            tex.width ?? 0,
            tex.height ?? 0,
          );
        }
      };
      try {
        if (ts.root)
          (function walk(t, d) {
            visit(t);
            if (d < 40) for (const c of t.children ?? []) walk(c, d + 1);
          })(ts.root, 0);
      } catch (error) {
        info.error = String(error);
      }
      out.push(info);
    }
    return out;
  }

  const api = {
    get preset() {
      return state.preset;
    },
    get order() {
      return [...state.order];
    },
    get enabled() {
      return [...state.enabled];
    },
    get wipe() {
      return state.wipe;
    },
    get errors() {
      return [...state.errors];
    },
    get notices() {
      return [...state.notices];
    },
    effects: () => [...effects.values()].filter((e) => !e.internal),
    tileUniforms: TILE_UNIFORMS,
    /** OSM class mask controller (null in the offline harness). */
    osmMask,
    values: (id) => values[id],
    setPreset,
    addEffect,
    exportPreset,
    probe,
    get quality() {
      return quality
        ? {
            ...quality,
            resolutionScale: viewer.resolutionScale,
            msaaSamples: scene.msaaSamples,
          }
        : null;
    },
    setQuality(on) {
      applyQuality(on ? (state.preset?.quality ?? null) : null);
      scene.requestRender?.();
    },
    /**
     * Mean ms per forced frame over `n` frames (CPU + GPU: each frame is
     * flushed with gl.finish; no pixels are read back).
     */
    benchmark(n = 60) {
      const gl = options.glOf?.(scene);
      for (let i = 0; i < 5; i++) scene.render();
      gl?.finish();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        scene.render();
        gl?.finish();
      }
      return (performance.now() - t0) / n;
    },
    /** Set one uniform (no rebuild). */
    set(id, key, value) {
      if (!values[id]) return;
      values[id][key] = Array.isArray(value) ? [...value] : Number(value);
      if (id === 'tile') pushTileUniforms();
      scene.requestRender?.();
    },
    enable(id, on = true) {
      if (on) {
        state.failed.delete(id);
        if (!state.order.includes(id)) {
          state.order.push(id);
          state.enabled.add(id);
          if (id !== 'tile') return rebuild();
        }
        state.enabled.add(id);
        if (id === 'tile') attachTiles();
      } else state.enabled.delete(id);
      applyEnabled();
    },
    move(id, delta) {
      const i = state.order.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= state.order.length) return;
      [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
      rebuild();
    },
    setWipe(x) {
      state.wipe = Math.min(1, Math.max(0, Number(x) || 0));
      applyEnabled();
    },
    setBudget(on) {
      state.budget = !!on;
    },
    /** The preset sun's state, or null (no sun support in this scene). */
    get sun() {
      return sun ? sun.state : null;
    },
    /** Fix the preset sun's time (ISO, ms, JulianDate); null = the scene clock. */
    setSunTime(time) {
      sun?.setTime(time);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removePreUpdate();
      removePostRender();
      osmMask?.dispose();
      removeStages();
      applyQuality(null);
      applyHud();
      sun?.dispose();
      for (const ts of hosts)
        if (!ts.isDestroyed?.()) ts[HOST_KEY]?.detach('theme');
      hosts.clear();
      scene.requestRender?.();
    },
  };
  if (options.preset) setPreset(options.preset);
  return api;
}
