import * as Cesium from 'cesium';
import { watch } from 'vue';
import { plotFromId } from '../data/cityPlot.js';
import { shadowReach, shadowTip, sunPosition } from '../data/citySun.js';
import {
  MASSING_ASSUMPTIONS,
  MAX_STOREYS,
  edgeProbes,
  groundBase,
  plotMassing,
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
// Entity geometry builds over several frames and the app renders on demand:
// frames keep coming until the block and plate are drawn as they now stand,
// never longer than this.
const BUILD_MAX_MS = 20000;
// Frames after a change before "drawn" can be trusted: the change reaches the
// entity's geometry batch on the next tick, until then the old one reads drawn.
const BUILD_FRAMES = 2;
// Once the framed tiles load, a ground this much off stands the block anew.
const REGROUND_METERS = 0.5;
// Screen points this far outside the canvas no longer anchor the readout.
const PAD = 40;
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
  // The shadow reach the readout shows, in whole metres.
  let lastReach = null;
  let disposed = false;
  // `{frames, timer, remove}` while frames are held for new geometry.
  let build = null;
  const sphere = new Cesium.BoundingSphere();

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

  // The ground for a plot from the centre and the street around it.
  function measure(plot) {
    return groundBase(
      sample([plot.center.lon, plot.center.lat]),
      edgeProbes(plot.corners, PROBE_METERS).map(sample),
    );
  }

  const shownTilesets = () =>
    Array.from({ length: scene.primitives.length }, (_, i) =>
      scene.primitives.get(i),
    ).filter((p) => p instanceof Cesium.Cesium3DTileset && p.show);

  const tilesReady = () =>
    shownTilesets().every((tileset) => tileset.tilesLoaded) &&
    (!scene.globe?.show || scene.globe.tilesLoaded);

  function sunAt(plot) {
    try {
      return sunPosition(
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
    for (const tileset of shownTilesets()) {
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

  // Whether the plate and block are drawn (their geometry has built).
  function drawn() {
    const display = viewer.dataSourceDisplay;
    if (typeof display?.getBoundingSphere !== 'function') return true;
    try {
      return [site?.plate, site?.block]
        .filter(Boolean)
        .every(
          (entity) =>
            display.getBoundingSphere(entity, false, sphere) ===
            Cesium.BoundingSphereState.DONE,
        );
    } catch {
      return false;
    }
  }

  // Keep frames coming until the changed geometry is drawn: the cast shadow
  // and the block show together, not on the next camera move.
  function rendered() {
    if (!build) {
      holdContinuousRender(OWNER);
      build = { frames: 0, timer: 0, remove: null };
      build.remove = scene.postRender.addEventListener(() => {
        if (++build.frames > BUILD_FRAMES && drawn()) built();
      });
    }
    build.frames = 0;
    clearTimeout(build.timer);
    build.timer = setTimeout(built, BUILD_MAX_MS);
    scene.requestRender();
  }

  function built() {
    if (!build) return;
    build.remove();
    clearTimeout(build.timer);
    build = null;
    releaseContinuousRender(OWNER);
  }

  function hide() {
    if (!site) return;
    removeFrame?.();
    removeFrame = null;
    lastAnchors = '';
    store.placeMassing(null);
    ds.entities.removeAll();
    uncut(site.cuts);
    viewer.shadows = site.shadowsBefore;
    if (scene.globe) scene.globe.shadows = site.globeShadows;
    if (scene.shadowMap) scene.shadowMap.softShadows = site.softShadows;
    site = null;
    rendered();
  }

  function show(plot) {
    if (site?.plot.id === plot.id) return;
    hide();
    const ground = measure(plot);
    const base = ground?.base ?? 0;
    const massing = plotMassing({ corners: plot.corners, storeys });
    const sun = sunAt(plot);
    const shadowsBefore = viewer.shadows;
    const globeShadows = scene.globe?.shadows;
    const softShadows = scene.shadowMap?.softShadows;
    // A cast shadow needs the sun above the horizon. The globe receives it,
    // with soft (filtered) edges so the band reads as a shadow on the ground.
    viewer.shadows = shadowsBefore || sun?.elevationDeg > 0;
    if (scene.globe) scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
    if (scene.shadowMap) scene.shadowMap.softShadows = true;
    site = {
      plot,
      base,
      sampled: ground !== null,
      massing,
      sun,
      shadowsBefore,
      globeShadows,
      softShadows,
      // The surface this block was cut into and stood on, checked each frame.
      tilesets: shownTilesets(),
      globe: Boolean(scene.globe?.show),
      ready: false,
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
  }

  // Tiles refine after a zoom or a flight: re-measure the ground once they have
  // loaded, as play mode re-grounds a restored concept (src/standalone/cityPlay.js).
  function reground() {
    const ground = measure(site.plot);
    if (!ground) return;
    if (site.sampled && Math.abs(ground.base - site.base) < REGROUND_METERS)
      return;
    site.base = ground.base;
    site.sampled = true;
    site.plate.polygon.height = ground.floor - PLATE_DEPTH;
    site.plate.polygon.extrudedHeight = ground.base + PLATE_RISE;
    if (site.block) {
      site.block.polygon.height = ground.base;
      site.block.polygon.extrudedHeight =
        ground.base + site.massing.heightMeters;
    }
    rendered();
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
    if (
      p.x < -PAD ||
      p.y < -PAD ||
      p.x > rect.width + PAD ||
      p.y > rect.height + PAD
    )
      return null;
    return { x: Math.round(p.x + rect.left), y: Math.round(p.y + rect.top) };
  }

  // Each frame: follow the surface (a map switch re-cuts and re-grounds, loaded
  // tiles re-ground), the scene sun, and the block and its shadow tip on
  // screen, so the readout never covers them.
  function frame() {
    if (!site?.block) return;
    const tilesets = shownTilesets();
    if (
      tilesets.length !== site.tilesets.length ||
      tilesets.some((t, i) => t !== site.tilesets[i]) ||
      Boolean(scene.globe?.show) !== site.globe
    ) {
      const plot = site.plot;
      queueMicrotask(() => {
        if (disposed || site?.plot !== plot) return;
        hide();
        show(plot);
      });
      return;
    }
    const ready = tilesReady();
    if (ready && !site.ready) reground();
    site.ready = ready;
    site.sun = sunAt(site.plot);
    // The sun moves with the scene clock: the readout follows its reach.
    const reach = shadowReach(site.massing.heightMeters, site.sun);
    if ((reach === null ? null : Math.round(reach)) !== lastReach)
      publish(site.plot);
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

  // Play mode's selected plot; Reimagine captures the plot as it is.
  function selected() {
    const view = store.view;
    return view?.active && !view.pending && view.tier !== 'district'
      ? plotFromId(view.plot?.id)
      : null;
  }

  function publish(plot) {
    if (!plot) return store.publishMassing(null);
    const standing = site?.plot.id === plot.id;
    const m = standing
      ? site.massing
      : plotMassing({ corners: plot.corners, storeys });
    const sun = standing ? site.sun : sunAt(plot);
    const reach = shadowReach(m.heightMeters, sun);
    lastReach = reach === null ? null : Math.round(reach);
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
      homes: m.homes,
      residentialShare: m.residentialShare,
      homeSquareMeters: m.homeSquareMeters,
      shadowReachMeters: reach,
      sunElevationDeg: sun?.elevationDeg ?? null,
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
        // The entities themselves, so a journey checks what is drawn.
        blockBase: site?.block?.polygon.height.getValue() ?? null,
        blockExtrudedHeight:
          site?.block?.polygon.extrudedHeight.getValue() ?? null,
        plateTop: site?.plate.polygon.extrudedHeight.getValue() ?? null,
        plateBottom: site?.plate.polygon.height.getValue() ?? null,
        shadowMap: viewer.shadows,
        blockShadows:
          site?.block?.polygon.shadows.getValue() === Cesium.ShadowMode.ENABLED,
        // The plate and block as they now stand are on screen.
        drawn: Boolean(site?.block) && !build && drawn(),
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
      built();
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
