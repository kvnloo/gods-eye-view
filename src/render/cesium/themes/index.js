/**
 * @module render/cesium/themes
 * @description FORK-ONLY (exp/theme-engine-v0). Entry of the theme engine
 * for the app: `createApplicationViewer` loads this module on demand when
 * the page asks for a theme, so the engine covers the whole app (every
 * location, zoom and mode; city builder on or off). Without `?preset=` /
 * `?theme=` nothing here runs.
 *
 *   ?preset=wintercats | enhanced-realism | cozy | none | <url of JSON>
 *   ?theme=<same>          alias
 *   &themeWipe=0.5         before/after wipe (left = as served)
 *   &themePanel=1          the developer overlay (panel.js)
 *   &themeBudget=0         no automatic frame-budget switch-offs
 *   &themeQuality=0        keep the app's resolution, MSAA and tile error
 *   &themeOsm=0            no OSM class mask (per-pixel classifier only)
 *   &themeOsmDebug=1       overlay the OSM class mask on the tiles as served
 *
 * `window.__gevTheme` is the engine API (QA and the panel use it).
 */
import * as Cesium from 'cesium';
import { tilePrimitiveFacts, webglContext } from '../internals.js';
import { createThemeEngine } from './engine.js';
import { createOsmMask } from './osmMask.js';
import { BUILT_IN_PRESETS, loadPreset, presetRequest } from './presets.js';

/** Install the theme the page asks for; resolves to the engine or null. */
export async function installThemeFromLocation(
  viewer,
  { win = globalThis.window } = {},
) {
  const request = presetRequest(win?.location?.search ?? '');
  if (!request || !viewer?.scene) return null;
  const engine = createThemeEngine(Cesium, viewer, {
    wipe: request.wipe,
    budget: request.budget,
    tilePrimitiveFacts,
    glOf: webglContext,
    quality: request.quality,
    // OSM class mask for the tile stage (loop v3); &themeOsm=0 turns it off
    osmMask:
      request.osm && typeof Worker !== 'undefined'
        ? ({ setUniform }) => createOsmMask(Cesium, viewer, { setUniform })
        : null,
  });
  const apply = async (value) => {
    try {
      const { preset, problems } = await loadPreset(value);
      engine.setPreset(preset);
      if (problems.length) console.warn('[theme] preset problems:', problems);
    } catch (error) {
      console.error('[theme] preset failed to load:', error);
    }
  };
  // GEV-G: ?theme=wintercats-learned = the wintercats stack with knobs set
  // per view by the learned model (learnedTheme.js); the model file is fetched
  let learned = null;
  if (request.value === 'wintercats-learned') {
    try {
      const { loadLearnedModel, createLearnedTheme } = await import('./learnedTheme.js');
      const model = await loadLearnedModel(request.learnedUrl || undefined);
      learned = createLearnedTheme(Cesium, viewer, engine, model);
    } catch (error) {
      console.error('[theme] learned theme failed, falling back to wintercats:', error);
      await apply('wintercats');
    }
  } else await apply(request.value);
  if (request.osmDebug) engine.set('tile', 'debugOsm', 1);
  if (win) {
    win.__gevTheme = Object.assign(engine, { loadPreset: apply });
    if (learned) win.__gevLearned = learned;
  }
  if (request.panel) {
    const { mountThemePanel } = await import('./panel.js');
    mountThemePanel(engine, {
      presets: Object.keys(BUILT_IN_PRESETS),
      loadPreset: apply,
    });
  }
  return engine;
}
