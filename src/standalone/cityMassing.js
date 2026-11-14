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
  GROWTH_ASSUMPTIONS,
  GROWTH_STAGES,
  editStage,
  growthPlan,
} from '../data/cityGrowth.js';
import {
  ASSUMED_EDGE_METERS,
  edgeDistance,
  inWinter,
  shadowBand,
  shadowFit,
  winterNoon,
} from '../data/cityShadowFit.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { worldClock } from '../time/worldClock.js';

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
// The shadow study on the ground: the shadow as it now falls is filled, the
// one it is held against (was, or what a fit would leave) is a dashed outline,
// and the protected edge is an amber line reaching past the shadow's sides.
const SHADE = Cesium.Color.fromCssColorString('#04080e').withAlpha(0.5);
const WAS = Cesium.Color.WHITE;
const EDGE = Cesium.Color.fromCssColorString('#ffb454');
const EDGE_PAD_METERS = 6;
// A district's blocks on the growth timeline: the cohort that grows stands
// like the single block, with the storeys a stage adds as glass on top; a
// sun-locked plot is edged in the protected edge's amber, and the plots the
// plan leaves alone are a quiet grey.
const QUIET = Cesium.Color.fromCssColorString('#a3acb4');
const GLASS = ACCENT.withAlpha(0.55);
// A lock badge sits this far above its block.
const BADGE_RISE = 3;
const MAX_EDGE_METERS = 200;

/**
 * Massing v0 on the globe, mounted only behind ?massing=1: once MASSING is
 * on, the selected play-mode plot gets a ground plate and an assumed block
 * standing on the sampled ground, casting its shadow from the scene sun. On 3D
 * tiles the plot is cut out of the mesh so the block never intersects the real
 * building. The readout (CityMassingReadout.vue) shows its numbers and steps
 * its storeys through the play store. PROTECT SIDEWALK adds the shadow study
 * (src/data/cityShadowFit.js): the block's shadow against an edge across the
 * street, drawn on the ground, and FIT TO SUN, which cuts the storeys until the
 * shadow clears it. With a district selected (play mode's shift-click),
 * GROWTH stands a block on every plot of it for the timeline stage shown
 * (src/data/cityGrowth.js): the cohort rises stage by stage and a plot that
 * was fitted to the sun keeps its storeys. Nothing is saved: every block is
 * computed from its plot whenever it shows, from the defaults after a reload.
 */
export function mountCityMassing({
  viewer,
  store,
  win = globalThis.window,
  seek = (ms) => worldClock.seek(ms),
}) {
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
  // The shadow study: on or off, the storeys it started from, the protected
  // edge (assumed until the player sets it) and its entities as last drawn.
  let study = false;
  let wasStoreys = storeys;
  let edgeMeters = ASSUMED_EDGE_METERS;
  let edgeSet = false;
  let picking = false;
  let marks = [];
  let marksKey = '0';
  let studyPlot = null;
  // Growth: the storeys FIT TO SUN left on a plot (its lock), whether the
  // timeline is on, its stage, the cohort's storeys per stage as the player
  // edited them, and one stand per district plot while it shows.
  const fits = new Map();
  let growth = false;
  let stage = 0;
  let stageStoreys = GROWTH_ASSUMPTIONS.storeys;
  let districtKey = '';
  let stands = [];
  let lit = null;
  let removeGrowthFrame = null;
  let lastBadges = '';
  let lastGrowth = 'null';
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

  const sceneTime = () =>
    Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();

  function sunAt(plot) {
    try {
      return sunPosition(plot.center.lat, plot.center.lon, sceneTime());
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

  // The shadow map for our blocks: on while the sun is up, received by the
  // globe with soft (filtered) edges so a band reads as a shadow on the ground.
  function light(sun) {
    const before = {
      shadows: viewer.shadows,
      globe: scene.globe?.shadows,
      soft: scene.shadowMap?.softShadows,
    };
    viewer.shadows = before.shadows || sun?.elevationDeg > 0;
    if (scene.globe) scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
    if (scene.shadowMap) scene.shadowMap.softShadows = true;
    return before;
  }

  function unlight(before) {
    viewer.shadows = before.shadows;
    if (scene.globe) scene.globe.shadows = before.globe;
    if (scene.shadowMap) scene.shadowMap.softShadows = before.soft;
  }

  // Whether the plate and block are drawn (their geometry has built).
  function drawn() {
    const display = viewer.dataSourceDisplay;
    if (typeof display?.getBoundingSphere !== 'function') return true;
    try {
      return [
        site?.plate,
        site?.block,
        ...marks,
        ...stands.flatMap((s) => [s.plate, s.block, s.rise.show && s.rise]),
      ]
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

  // Metres along the shadow, read off the drawn entities: each line's length
  // and the edge's distance, all from the face the shadow leaves.
  function drawnMeters() {
    const span = (a, b) => Cesium.Cartesian3.distance(a, b);
    const middle = (a, b) =>
      Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3());
    const face = ds.entities
      .getById(`${OWNER}-shadow-now`)
      .polygon.hierarchy.getValue().positions;
    return Object.fromEntries(
      marks.map((entity) => {
        const at = entity.polyline?.positions.getValue();
        const corners = entity.polygon?.hierarchy.getValue().positions;
        return [
          entity.id.slice(`${OWNER}-shadow-`.length),
          corners
            ? span(corners[1], corners[2])
            : at.length === 2
              ? span(middle(face[0], face[1]), middle(at[0], at[1]))
              : span(at[0], at[1]),
        ];
      }),
    );
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
    marks = [];
    marksKey = '0';
    uncut(site.cuts);
    unlight(site.lit);
    site = null;
    rendered();
  }

  // A plot's ground plate and its assumed block, standing on the ground.
  function stand(plot, massing, ground, name = '') {
    const base = ground?.base ?? 0;
    return {
      plate: ds.entities.add({
        id: `${OWNER}-plate${name}`,
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
          id: `${OWNER}-block${name}`,
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
  }

  function show(plot) {
    if (site?.plot.id === plot.id) return;
    hide();
    const ground = measure(plot);
    const base = ground?.base ?? 0;
    const massing = plotMassing({ corners: plot.corners, storeys });
    const sun = sunAt(plot);
    site = {
      plot,
      base,
      sampled: ground !== null,
      massing,
      sun,
      // A cast shadow needs the sun above the horizon.
      lit: light(sun),
      // The surface this block was cut into and stood on, checked each frame.
      tilesets: shownTilesets(),
      globe: Boolean(scene.globe?.show),
      ready: false,
      cuts: cut(plot),
      ...stand(plot, massing, ground),
    };
    removeFrame = scene.postRender.addEventListener(frame);
    mark();
    rendered();
  }

  // The study of the standing block against the edge, or null while it is off.
  function plan() {
    return study && site
      ? shadowFit({
          storeys,
          wasStoreys,
          storeyHeightMeters: site.massing.storeyHeightMeters,
          sun: site.sun,
          edgeMeters,
        })
      : null;
  }

  // Draw the study on the ground when it changed: the protected edge, the
  // shadow as it now falls (filled) and the one it is held against (dashed).
  function mark() {
    const lines = site?.block ? (plan()?.lines ?? []) : [];
    const band = (meters) =>
      shadowBand(site.massing.footprint, site.sun, meters);
    // To 0.1 m: a live clock moves the sun a little every frame.
    const key = JSON.stringify(
      lines.length && [
        lines.map((line) => [line.kind, line.reachMeters.toFixed(1)]),
        band(edgeMeters)
          .flat()
          .map((degrees) => degrees.toFixed(6)),
      ],
    );
    if (key === marksKey) return;
    marksKey = key;
    marks.forEach((entity) => ds.entities.remove(entity));
    const add = (id, graphics) =>
      ds.entities.add({ id: `${OWNER}-shadow-${id}`, ...graphics });
    const ground = (corners) =>
      Cesium.Cartesian3.fromDegreesArray(corners.flat());
    const polyline = (positions, material, width = 4) => ({
      polyline: { positions, width, clampToGround: true, material },
    });
    marks = lines.map((line) => {
      const [nearLeft, nearRight, farRight, farLeft] = ground(
        band(line.reachMeters),
      );
      return line.kind === 'now'
        ? add('now', {
            polygon: {
              hierarchy: [nearLeft, nearRight, farRight, farLeft],
              material: SHADE,
            },
          })
        : add(
            line.kind,
            polyline(
              [nearLeft, farLeft, farRight, nearRight],
              new Cesium.PolylineDashMaterialProperty({
                color: line.kind === 'was' ? WAS : ACCENT,
                dashLength: 14,
              }),
            ),
          );
    });
    if (lines.length)
      marks.push(
        add(
          'edge',
          polyline(
            ground(
              shadowBand(
                site.massing.footprint,
                site.sun,
                edgeMeters,
                EDGE_PAD_METERS,
              ).slice(2),
            ),
            EDGE,
            6,
          ),
        ),
      );
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
    mark();
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
    mark();
    const shadows = site.lit.shadows || site.sun?.elevationDeg > 0;
    if (viewer.shadows !== shadows) viewer.shadows = shadows;
    const { base, massing } = site;
    const top = base + massing.heightMeters;
    const tip = shadowTip(massing.footprint, massing.heightMeters, site.sun);
    // The study's bands on screen: the readout keeps clear of them too, and
    // each tip label points at the far side of its line.
    const bands = (marks.length ? plan().lines : []).map((line) => [
      line.kind,
      shadowBand(massing.footprint, site.sun, line.reachMeters).map(
        ([lon, lat]) => project(lon, lat, base),
      ),
    ]);
    const points = [
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, base)),
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, top)),
      ...(tip ?? []).map(([lon, lat]) => project(lon, lat, base)),
      ...bands.flatMap(([, band]) => band),
    ].filter(Boolean);
    const tips = Object.fromEntries(
      bands.map(([kind, band]) => [kind, band.slice(2)]),
    );
    const key = JSON.stringify([points, tips]);
    if (key === lastAnchors) return;
    lastAnchors = key;
    store.placeMassing({ points, tips });
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
      // The shadow study: its toggle, the protected edge and, while it is on
      // and the block stands, the plan that the ground and the tips show.
      shadow: {
        on: study,
        picking,
        edgeMeters,
        edgeSet,
        winter: inWinter(plot.center.lat, sceneTime()),
        plan: standing ? plan() : null,
        // What the storeys the study started from held, once they changed.
        was: study && wasStoreys !== storeys ? wasMassing(plot) : null,
      },
    });
  }

  // The district play mode selected, as grid plots.
  function district() {
    const view = store.view;
    const ids = view?.active && !view.pending ? view.district : null;
    return ids?.length ? ids.map(plotFromId) : null;
  }

  function clearStands() {
    removeGrowthFrame();
    for (const { plate, block, rise, cuts } of stands) {
      for (const entity of [plate, block, rise]) ds.entities.remove(entity);
      uncut(cuts);
    }
    stands = [];
    unlight(lit);
    lastBadges = '';
    store.placeGrowth(null);
    rendered();
  }

  // Each frame of the timeline: tiles that loaded since re-ground the blocks,
  // and each sun-locked block's badge follows it on screen.
  function growthFrame() {
    const ready = tilesReady();
    if (ready && !stands.ready) {
      for (const s of stands) {
        const ground = measure(s.plot);
        if (!ground || Math.abs(ground.base - s.base) < REGROUND_METERS)
          continue;
        s.plate.polygon.height = ground.floor - PLATE_DEPTH;
        s.plate.polygon.extrudedHeight = ground.base + PLATE_RISE;
        s.block.polygon.height = s.base = ground.base;
        s.key = '';
      }
      stageDistrict(district());
    }
    stands.ready = ready;
    const locks = stands
      .filter((s) => s.locked)
      .map((s) => ({
        plotId: s.plot.id,
        at: project(s.plot.center.lon, s.plot.center.lat, s.top + BADGE_RISE),
      }))
      .filter((lock) => lock.at);
    const key = JSON.stringify(locks);
    if (key === lastBadges) return;
    lastBadges = key;
    store.placeGrowth({ locks });
  }

  // The district's plan and, with GROWTH on, its blocks standing as the stage
  // shown has them. Null without a district.
  function stageDistrict(plots) {
    if (!plots) return null;
    const plan = growthPlan({
      plots,
      anchorId: store.view.plot?.id,
      storeys: stageStoreys,
      locks: Object.fromEntries(
        plots
          .filter((plot) => fits.has(plot.id))
          .map((plot) => [plot.id, fits.get(plot.id)]),
      ),
    });
    if (!growth) return plan;
    const blocks = plan.stages[stage].blocks;
    if (!stands.length) {
      lit = light(sunAt(plots[0]));
      stands = plots.map((plot, i) => {
        const ground = measure(plot);
        const massing = plotMassing({
          corners: plot.corners,
          storeys: blocks[i].storeys,
        });
        return {
          plot,
          base: ground?.base ?? 0,
          cuts: cut(plot),
          ...stand(plot, massing, ground, `-${plot.id}`),
          // What a stage adds to the block that stands now.
          rise: ds.entities.add({
            id: `${OWNER}-rise-${plot.id}`,
            show: false,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(
                massing.footprint.flat(),
              ),
              material: GLASS,
              outline: true,
              outlineColor: ACCENT,
              closeBottom: false,
              shadows: Cesium.ShadowMode.CAST_ONLY,
            },
          }),
        };
      });
      // Each plate's edge is the district's outline: the plates cover the
      // one play mode drapes on the ground.
      for (const { plate } of stands) {
        plate.polygon.outline = true;
        plate.polygon.outlineColor = ACCENT;
      }
      removeGrowthFrame = scene.postRender.addEventListener(growthFrame);
    }
    blocks.forEach((block, i) => {
      const s = stands[i];
      const now = plan.stages[0].blocks[i];
      const role = block.locked ? 'locked' : block.cohort ? 'cohort' : 'quiet';
      const key = `${now.storeys}:${block.storeys}:${role}`;
      if (s.key === key) return;
      s.key = key;
      s.locked = block.locked;
      s.top = s.base + block.heightMeters;
      const stays = s.base + Math.min(block.heightMeters, now.heightMeters);
      s.block.polygon.extrudedHeight = stays;
      // From a district's distance the shadow map stripes a face that takes
      // shadow: the blocks cast theirs on the ground and take none.
      s.block.polygon.shadows = Cesium.ShadowMode.CAST_ONLY;
      s.block.polygon.material = role === 'quiet' ? QUIET : BLOCK;
      s.block.polygon.outlineColor = {
        locked: EDGE,
        cohort: ACCENT,
        quiet: PLATE,
      }[role];
      s.rise.show = s.top > stays;
      s.rise.polygon.height = stays;
      s.rise.polygon.extrudedHeight = s.top;
      lastBadges = '';
      rendered();
    });
    return plan;
  }

  function sync() {
    if (disposed) return;
    const plot = selected();
    // A study belongs to its plot: another plot starts from the assumption.
    if ((plot?.id ?? null) !== studyPlot) {
      studyPlot = plot?.id ?? null;
      wasStoreys = storeys;
      edgeMeters = ASSUMED_EDGE_METERS;
      edgeSet = false;
      picking = false;
    }
    const plots = district();
    // A timeline belongs to its district: another one starts from the plan.
    const key = plots ? plots.map((cell) => cell.id).join() : '';
    if (key !== districtKey) {
      districtKey = key;
      growth = false;
      stage = 0;
      stageStoreys = GROWTH_ASSUMPTIONS.storeys;
    }
    // The timeline's blocks stand in place of the one block, and each gives
    // the shadow map back before the other takes it.
    if (!growth && stands.length) clearStands();
    if (plot && on && !growth) show(plot);
    else hide();
    publish(plot);
    const plan = stageDistrict(plots);
    const next = plan && { on: growth, stage, plan, maxStoreys: MAX_STOREYS };
    // Play mode republishes on every hover: the timeline only when it changed.
    const told = JSON.stringify(
      next && [growth, stage, stageStoreys, key, plan.locked],
    );
    if (told === lastGrowth) return;
    lastGrowth = told;
    store.publishGrowth(next);
  }

  function wasMassing(plot) {
    const { homes, far } = plotMassing({
      corners: plot.corners,
      storeys: wasStoreys,
    });
    return { homes, far };
  }

  // A study control changed something: redraw the ground and the readout.
  function restudy() {
    if (site) mark();
    lastAnchors = '';
    publish(selected());
    scene.requestRender();
  }

  function setEdge(meters) {
    edgeMeters = Math.min(MAX_EDGE_METERS, Math.max(1, Math.round(meters)));
    edgeSet = true;
    restudy();
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
      // The player's own change releases the plot's sun lock.
      fits.delete(selected()?.id);
      if (site?.block) extrude();
      publish(selected());
    },
    // The shadow study starts from the storeys that stand when it turns on.
    study() {
      study = !study;
      wasStoreys = storeys;
      picking = false;
      restudy();
    },
    stepEdge(delta) {
      setEdge(edgeMeters + delta);
    },
    // SET ON MAP arms one ground click, which play mode hands over to click().
    pickEdge() {
      picking = !picking;
      restudy();
    },
    click(point) {
      if (!picking || !point || !site?.block || !(site.sun?.elevationDeg > 0))
        return false;
      const meters = edgeDistance(site.massing.footprint, site.sun, [
        point.lon,
        point.lat,
      ]);
      // A click on the block or behind the face the shadow leaves sets
      // nothing: the tool stays armed for the next one.
      if (meters < 1) return true;
      picking = false;
      setEdge(meters);
      return true;
    },
    // The scene clock goes to solar noon on the winter solstice at the plot.
    winterNoon() {
      const plot = selected();
      if (!plot) return;
      seek(winterNoon(plot.center.lat, plot.center.lon, sceneTime()));
      rendered();
    },
    // Cut the storeys to the most that still clear the edge.
    fit() {
      const next = plan();
      if (!next?.canFit || !site?.block) return;
      storeys = next.fit.storeys;
      // The plot is sun-locked: a growth timeline never raises it.
      fits.set(site.plot.id, storeys);
      extrude();
      restudy();
    },
    // GROWTH: the district's blocks on the timeline, in place of the one block.
    growth() {
      if (!district()) return;
      growth = !growth;
      sync();
    },
    stage(index) {
      if (!growth || !GROWTH_STAGES[index]) return;
      stage = index;
      sync();
    },
    // The player's edit: the cohort's storeys at the stage shown.
    stepStage(delta) {
      if (!growth) return;
      stageStoreys = editStage(stageStoreys, stage, delta);
      sync();
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
        // The shadow study: its plan, and the lines as the entities hold them.
        study: study && {
          wasStoreys,
          edgeMeters,
          edgeSet,
          picking,
          plan: plan(),
          drawn: marks.length > 0 && drawnMeters(),
        },
        // The sun locks, and the timeline's blocks as the entities hold them.
        locks: Object.fromEntries(fits),
        growth: stands.length > 0 && {
          stage,
          storeys: stageStoreys,
          drawn: !build && drawn(),
          blocks: stands.map((s) => ({
            plotId: s.plot.id,
            locked: s.locked,
            // The block that stands now and, on top, what the stage adds.
            heightMeters:
              (s.rise.show
                ? s.rise
                : s.block
              ).polygon.extrudedHeight.getValue() -
              s.block.polygon.height.getValue(),
            addedMeters: s.rise.show
              ? s.rise.polygon.extrudedHeight.getValue() -
                s.rise.polygon.height.getValue()
              : 0,
          })),
        },
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
      if (stands.length) clearStands();
      built();
      if (win?.__gevCityMassing === probe) delete win.__gevCityMassing;
      if (store.massingControls === controls) {
        store.connectMassing(null);
        store.publishMassing(null);
        store.placeMassing(null);
        store.publishGrowth(null);
      }
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
    },
  };
}
