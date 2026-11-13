import * as Cesium from 'cesium';
import { watch } from 'vue';
import { plotFromId } from '../data/cityPlot.js';
import { observerSolarPosition } from '../data/satellitePass.js';
import {
  MASSING_ASSUMPTIONS,
  edgeProbes,
  groundBase,
  plotMassing,
} from '../data/cityMassing.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

const OWNER = 'city-massing';
// The plate fills the plot from below the ground to just above it: the globe
// never z-fights its top, and a cut photoreal mesh never shows a void.
const PLATE_DEPTH = 0.5;
const PLATE_RISE = 0.1;
// The street is sampled this far outside each plot edge.
const PROBE_METERS = 6;
// Entity geometry builds over several frames; the app renders on demand.
const BUILD_MS = 2500;
const RESAMPLE_MS = 500;
const RESAMPLE_TRIES = 20;
const BLOCK = Cesium.Color.fromCssColorString('#e8edf1');
const PLATE = Cesium.Color.fromCssColorString('#8d949b');
const ACCENT = Cesium.Color.fromCssColorString('#2ec8e8');

/**
 * Massing v0 on the globe, mounted only behind ?massing=1: the selected
 * play-mode plot gets a ground plate and an assumed block standing on the
 * sampled ground, casting its shadow from the scene sun. On 3D tiles the plot
 * is cut out of the mesh so the block never intersects the real building.
 * Nothing is saved: the block is computed from the plot whenever it shows.
 */
export function mountCityMassing({ viewer, store, win = globalThis.window }) {
  const scene = viewer?.scene;
  if (!scene || !store) return { destroy() {} };
  const ds = new Cesium.CustomDataSource('gev-city-massing');
  const added = viewer.dataSources.add(ds);
  let storeys = MASSING_ASSUMPTIONS.storeys;
  let site = null;
  let disposed = false;
  let release = null;
  let retry = null;

  const playEntities = () =>
    viewer.dataSources.getByName('gev-city-play')[0]?.entities.values ?? [];

  // What the map shows at a point: never our own or play mode's entities.
  function sample([lon, lat]) {
    try {
      const at = Cesium.Cartographic.fromDegrees(lon, lat);
      const height = scene.sampleHeightSupported
        ? scene.sampleHeight(at, [...ds.entities.values, ...playEntities()])
        : undefined;
      if (Number.isFinite(height)) return height;
      return scene.globe?.show ? scene.globe.getHeight(at) : undefined;
    } catch {
      return undefined;
    }
  }

  function sunAt(plot) {
    try {
      return observerSolarPosition(
        plot.center.lat,
        plot.center.lon,
        Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime(),
      );
    } catch {
      return null;
    }
  }

  // Cut the plot out of every shown 3D tileset (Google photoreal) so the block
  // never intersects the real building; the cut joins any existing clipping.
  function cut(plot) {
    if (!Cesium.ClippingPolygonCollection.isSupported(scene)) return [];
    const positions = Cesium.Cartesian3.fromDegreesArray(plot.corners.flat());
    const cuts = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const tileset = scene.primitives.get(i);
      if (!(tileset instanceof Cesium.Cesium3DTileset) || !tileset.show)
        continue;
      const created = !tileset.clippingPolygons;
      if (created)
        tileset.clippingPolygons = new Cesium.ClippingPolygonCollection();
      const polygon = tileset.clippingPolygons.add(
        new Cesium.ClippingPolygon({ positions }),
      );
      cuts.push({ tileset, polygon, created, shadows: tileset.shadows });
      // Photoreal light is baked in: the mesh takes the block's shadow only.
      tileset.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
    }
    return cuts;
  }

  function uncut(cuts) {
    for (const { tileset, polygon, created, shadows } of cuts) {
      if (tileset.isDestroyed()) continue;
      tileset.clippingPolygons?.remove(polygon);
      if (created && tileset.clippingPolygons?.length === 0)
        tileset.clippingPolygons = undefined;
      tileset.shadows = shadows;
    }
  }

  // Keep frames coming while new geometry builds.
  function rendered() {
    holdContinuousRender(OWNER);
    clearTimeout(release);
    release = setTimeout(() => releaseContinuousRender(OWNER), BUILD_MS);
    scene.requestRender();
  }

  function hide() {
    clearTimeout(retry);
    if (!site) return;
    ds.entities.removeAll();
    uncut(site.cuts);
    viewer.shadows = site.shadowsBefore;
    site = null;
    rendered();
  }

  function show(plot) {
    if (site?.plot.id === plot.id) return;
    hide();
    const ground = groundBase(
      sample([plot.center.lon, plot.center.lat]),
      edgeProbes(plot.corners, PROBE_METERS).map(sample),
    );
    const base = ground?.base ?? 0;
    const massing = plotMassing({ corners: plot.corners, storeys });
    const sun = sunAt(plot);
    const shadowsBefore = viewer.shadows;
    // A cast shadow needs the sun above the horizon.
    viewer.shadows = shadowsBefore || sun?.elevationDeg > 0;
    site = {
      plot,
      base,
      sampled: ground !== null,
      massing,
      sun,
      shadowsBefore,
      cuts: cut(plot),
      plate: ds.entities.add({
        id: `${OWNER}-plate`,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(plot.corners.flat()),
          height: (ground?.floor ?? base) - PLATE_DEPTH,
          extrudedHeight: base + PLATE_RISE,
          material: PLATE,
          shadows: Cesium.ShadowMode.RECEIVE_ONLY,
        },
      }),
      block:
        massing.footprint &&
        ds.entities.add({
          id: `${OWNER}-block`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(
              massing.footprint.flat(),
            ),
            height: base,
            extrudedHeight: base + massing.heightMeters,
            material: BLOCK,
            outline: true,
            outlineColor: ACCENT,
            shadows: Cesium.ShadowMode.ENABLED,
          },
        }),
    };
    rendered();
    if (!site.sampled) resample(plot, 1);
  }

  // Tiles still loading: sample again shortly, then stand the block anew.
  function resample(plot, tries) {
    retry = setTimeout(() => {
      if (disposed || site?.plot.id !== plot.id || site.sampled) return;
      const found = groundBase(
        sample([plot.center.lon, plot.center.lat]),
        edgeProbes(plot.corners, PROBE_METERS).map(sample),
      );
      if (found !== null) {
        hide();
        show(plot);
      } else if (tries < RESAMPLE_TRIES) resample(plot, tries + 1);
    }, RESAMPLE_MS);
  }

  // Follow play mode's selected plot; Reimagine captures the plot as it is.
  function sync() {
    if (disposed) return;
    const view = store.view;
    const plot =
      view?.active && !view.pending && view.tier !== 'district'
        ? plotFromId(view.plot?.id)
        : null;
    if (plot) show(plot);
    else hide();
  }
  const stop = watch(() => store.view, sync);

  const probe = Object.freeze({
    snapshot: () =>
      Object.freeze({
        shown: Boolean(site?.block),
        plotId: site?.plot.id ?? null,
        storeys,
        massing: site?.massing ?? null,
        base: site?.base ?? null,
        sampled: site?.sampled ?? false,
        blockTop: site ? site.base + site.massing.heightMeters : null,
        plateTop: site ? site.base + PLATE_RISE : null,
        shadowMap: viewer.shadows,
        blockShadows:
          site?.block?.polygon.shadows.getValue() === Cesium.ShadowMode.ENABLED,
        sun: site?.sun ?? null,
        cuts: site?.cuts.length ?? 0,
      }),
  });
  if (win) win.__gevCityMassing = probe;
  sync();

  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      hide();
      clearTimeout(release);
      releaseContinuousRender(OWNER);
      if (win?.__gevCityMassing === probe) delete win.__gevCityMassing;
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
    },
  };
}
