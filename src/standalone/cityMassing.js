import * as Cesium from 'cesium';
import { watch } from 'vue';
import { plotFromId } from '../data/cityPlot.js';
import { observerSolarPosition } from '../data/satellitePass.js';
import {
  MASSING_ASSUMPTIONS,
  MAX_STOREYS,
  edgeProbes,
  groundBase,
  plotMassing,
  shadowTip,
  stepStoreys,
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
 * Massing v0 on the globe, mounted only behind ?massing=1: once MASSING is
 * on, the selected play-mode plot gets a ground plate and an assumed block
 * standing on the sampled ground, casting its shadow from the scene sun. On 3D
 * tiles the plot is cut out of the mesh so the block never intersects the real
 * building. The readout (CityMassingReadout.vue) shows its numbers and steps
 * its storeys through the play store. Nothing is saved: the block is computed
 * from the plot whenever it shows, from the defaults after a reload.
 */
export function mountCityMassing({ viewer, store, win = globalThis.window }) {
  const scene = viewer?.scene;
  if (!scene || !store) return { destroy() {} };
  const ds = new Cesium.CustomDataSource('gev-city-massing');
  const added = viewer.dataSources.add(ds);
  let storeys = MASSING_ASSUMPTIONS.storeys;
  let on = false;
  let site = null;
  let removeFrame = null;
  let lastAnchors = '';
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
    removeFrame?.();
    removeFrame = null;
    lastAnchors = '';
    store.placeMassing(null);
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
    removeFrame = scene.postRender.addEventListener(frame);
    rendered();
    if (!site.sampled) resample(plot, 1);
  }

  // The stepper re-extrudes the standing block from the new storey count.
  function extrude() {
    site.massing = plotMassing({ corners: site.plot.corners, storeys });
    site.block.polygon.extrudedHeight = site.base + site.massing.heightMeters;
    rendered();
  }

  function project(lon, lat, height) {
    const world = Cesium.Cartesian3.fromDegrees(lon, lat, height);
    const camera = viewer.camera;
    const toPoint = Cesium.Cartesian3.subtract(
      world,
      camera.positionWC,
      new Cesium.Cartesian3(),
    );
    if (Cesium.Cartesian3.dot(toPoint, camera.directionWC) <= 0) return null;
    const p = scene.cartesianToCanvasCoordinates(world);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const rect = scene.canvas.getBoundingClientRect();
    return { x: Math.round(p.x + rect.left), y: Math.round(p.y + rect.top) };
  }

  // Each frame: the scene sun, and the block and its shadow tip on screen, so
  // the readout never covers them.
  function frame() {
    if (!site?.block) return;
    site.sun = sunAt(site.plot);
    const shadows = site.shadowsBefore || site.sun?.elevationDeg > 0;
    if (viewer.shadows !== shadows) viewer.shadows = shadows;
    const { base, massing } = site;
    const top = base + massing.heightMeters;
    const tip = shadowTip(massing.footprint, massing.heightMeters, site.sun);
    const points = [
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, base)),
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, top)),
      ...(tip ?? []).map(([lon, lat]) => project(lon, lat, base)),
    ].filter(Boolean);
    const key = JSON.stringify(points);
    if (key === lastAnchors) return;
    lastAnchors = key;
    store.placeMassing({ points });
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

  // Play mode's selected plot; Reimagine captures the plot as it is.
  function selected() {
    const view = store.view;
    return view?.active && !view.pending && view.tier !== 'district'
      ? plotFromId(view.plot?.id)
      : null;
  }

  function publish(plot) {
    if (!plot) return store.publishMassing(null);
    const m =
      site?.plot.id === plot.id
        ? site.massing
        : plotMassing({ corners: plot.corners, storeys });
    store.publishMassing({
      on,
      plotId: plot.id,
      storeys,
      maxStoreys: MAX_STOREYS,
      storeyHeightMeters: m.storeyHeightMeters,
      setbackMeters: m.setbackMeters,
      heightMeters: m.heightMeters,
      far: m.far,
      floorAreaSquareMeters: m.floorAreaSquareMeters,
    });
  }

  function sync() {
    if (disposed) return;
    const plot = selected();
    if (plot && on) show(plot);
    else hide();
    publish(plot);
  }
  const stop = watch(() => store.view, sync);

  const controls = {
    toggle() {
      on = !on;
      sync();
    },
    step(delta) {
      const next = stepStoreys(storeys, delta);
      if (next === storeys) return;
      storeys = next;
      if (site?.block) extrude();
      publish(selected());
    },
  };
  store.connectMassing(controls);

  const probe = Object.freeze({
    snapshot: () =>
      Object.freeze({
        on,
        shown: Boolean(site?.block),
        plotId: site?.plot.id ?? null,
        storeys,
        massing: site?.massing ?? null,
        base: site?.base ?? null,
        sampled: site?.sampled ?? false,
        blockTop: site ? site.base + site.massing.heightMeters : null,
        // The extruded entity itself, so a journey sees the block re-extrude.
        blockExtrudedHeight:
          site?.block?.polygon.extrudedHeight.getValue() ?? null,
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
      if (store.massingControls === controls) {
        store.connectMassing(null);
        store.publishMassing(null);
        store.placeMassing(null);
      }
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
    },
  };
}
