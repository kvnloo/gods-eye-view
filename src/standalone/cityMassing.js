import { watch } from 'vue';
import { plotFromId } from '../data/cityPlot.js';
import { shadowReach, shadowTip, sunPosition } from '../data/citySun.js';
import {
  MASSING_ASSUMPTIONS,
  MAX_STOREYS,
  edgeProbes,
  edgeRing,
  groundBase,
  plotMassing,
  stepStoreys,
} from '../data/cityMassing.js';
import { FACADE, massingFacade } from '../data/cityMassingFacade.js';
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
import { fromDegrees, scaleToGeodeticSurface } from '../geo/ellipsoid.js';
import { distance, dot, scale, add, sub } from '../geo/vector.js';
import { heightsOf } from '../queries/heights.js';
import {
  canvasOf,
  findCamera,
  findDraw,
  findEffects,
  findFrame,
  findGlobe,
  findQuery,
  rendererOf,
} from '../render/rendererOf.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { worldClock } from '../time/worldClock.js';
import { createCityDrawGroup, cssAlpha } from './cityDrawGroup.js';

const OWNER = 'city-massing';
// The plate fills the plot from below the ground to just above it: the globe
// never z-fights its top, and a cut photoreal mesh never shows a void.
const PLATE_DEPTH = 0.5;
const PLATE_RISE = 0.1;
// The street is sampled this far outside each plot edge.
const PROBE_METERS = 6;
// Geometry builds as the set changes and the app renders on demand: frames
// keep coming until the block and plate are drawn as they now stand, never
// longer than this.
const BUILD_MAX_MS = 20000;
// Frames after a change before "drawn" can be trusted: the change reaches the
// renderer's primitives on the next frame, until then the old ones draw.
const BUILD_FRAMES = 2;
// Once the framed tiles load, a ground this much off stands the block anew.
const REGROUND_METERS = 0.5;
// How dark the block's shadow lies on the map while it shows (the renderer's
// own 0.3 is harsher than the shadows already in aerial imagery).
const SHADOW_DARKNESS = 0.4;
// The sun's shadow map spreads its texels over everything out to its
// maximum distance (Cesium: 5 km): seen from 800 m the block's shadow got
// texels metres wide and lay striped on the mesh. While a block shows, the
// map ends this many times the eye's distance to it, never nearer than this.
const SHADOW_BEYOND = 1.6;
const SHADOW_MIN_METERS = 300;
// Screen points this far outside the canvas no longer anchor the readout.
const PAD = 40;
const PLATE = '#8c8a84';
const ACCENT = '#2ec8e8';
// The shadow study on the ground, as thin lines over the shadow the block
// really casts, each where a shadow ends: a solid line for the shadow as it
// now falls, a dashed one for the shadow it is held against (was, or what a
// fit would leave), and the protected edge in amber, reaching past the sides.
const LINE = '#ffffff';
const EDGE = '#ffb454';
const EDGE_PAD_METERS = 6;
// On 3D tiles a ground line smears down every wall it meets, so there a
// study line runs level, this far above the block's base, and shows faintly
// where a building or rising ground stands in front of it.
const LEVEL_RISE = 0.5;
const BEHIND = 0.35;
// On 3D tiles the cut leaves the mesh open along the plot's edge. The mesh is
// sampled this far apart, this far outside the edge, and a blank wall closes
// the cut wherever a neighbour or higher ground stands there.
const SIDE_STEP_METERS = 4;
const SIDE_OUT_METERS = 1;
const SIDES = '#6f6c66';
const MAX_EDGE_METERS = 200;
// A sun-locked block's badge sits this far above the block.
const BADGE_RISE = 3;
// The facade look (src/data/cityMassingFacade.js), as the renderer draws it.
const LOOK = Object.freeze({
  shopfront: FACADE.shopfront,
  floor: FACADE.floor,
  fascia: FACADE.fascia,
  colors: FACADE.colors,
});

/** A facade (`massingFacade`) standing at `base`, as the draw port fills a shape with it. */
function facadeFill(facade, base) {
  return {
    facade: {
      origin: { lon: facade.origin[0], lat: facade.origin[1], height: base },
      storeys: facade.storeys,
      storeyHeightM: facade.storeyHeightMeters,
      heightM: facade.heightMeters,
      parapetM: facade.parapet.topMeters - facade.parapet.bottomMeters,
      walls: facade.walls.map((wall) => ({
        normal: [...wall.normal],
        offsetM: wall.offsetMeters,
        lengthM: wall.lengthMeters,
        middleM: wall.middleMeters,
        bays: wall.bays,
      })),
      look: LOOK,
    },
  };
}

/** An extruded polygon from `bottom` up to `top`, metres above the ellipsoid. */
const prism = (id, cornerList, bottom, top, fill, shadows) => ({
  id,
  geometry: {
    kind: 'polygon',
    rings: [cornerList.map(([lon, lat]) => ({ lon, lat, height: bottom }))],
  },
  extrudeHeight: top,
  height: 'absolute',
  fill,
  shadows,
});
/** A drawn prism's bottom and top, as the renderer was handed them. */
const bottomOf = (item) => item.geometry.rings[0][0].height;

/**
 * Massing v0 on the globe, mounted only behind ?massing=1: once MASSING is
 * on, the selected play-mode plot gets a ground plate and an assumed block
 * standing on the sampled ground, drawn as a building from its own storeys
 * (src/data/cityMassingFacade.js) and casting its shadow from the scene sun.
 * On 3D tiles the plot is cut out of the mesh so the block never intersects
 * the real building. The readout (CityMassingReadout.vue) shows its numbers and steps
 * its storeys through the play store. PROTECT SIDEWALK adds the shadow study
 * (src/data/cityShadowFit.js): the block's shadow against an edge across the
 * street, drawn on the ground, and FIT TO SUN, which cuts the storeys until the
 * shadow clears it. With a district selected (play mode's shift-click),
 * GROWTH stands the same plate and block on every plot of it, as tall as the
 * timeline stage shown has them (src/data/cityGrowth.js): the cohort rises
 * stage by stage and a plot that was fitted to the sun keeps its storeys.
 * Nothing is saved: every block is computed from its plot whenever it shows,
 * from the defaults after a reload.
 */
export function mountCityMassing({
  host,
  store,
  win = globalThis.window,
  seek = (ms) => worldClock.seek(ms),
}) {
  const draw = findDraw(host);
  const camera = findCamera(host);
  const query = findQuery(host);
  const frameport = findFrame(host);
  const effects = findEffects(host);
  const capabilities = rendererOf(host)?.capabilities;
  // The block is a facade that casts the sun's shadow, or nothing is drawn.
  const can = (capability) => capabilities?.has(capability) === true;
  if (
    !draw ||
    !camera ||
    !query ||
    !frameport ||
    !store ||
    !can('facadeFill') ||
    !can('shapeShadows')
  )
    return { destroy() {} };
  const globe = findGlobe(host);
  const heights = heightsOf(host);
  const shapes = createCityDrawGroup(draw, 'shapes', OWNER);
  const lines = createCityDrawGroup(draw, 'lines', `${OWNER}-marks`);
  const growthShapes = createCityDrawGroup(draw, 'shapes', `${OWNER}-growth`);
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
  // Frames drawn since the last change; drawn once past BUILD_FRAMES.
  let framesSinceChange = Infinity;
  // The shadow study: on or off, the storeys it started from, the protected
  // edge (assumed until the player sets it) and its lines as last drawn.
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
  let removeGrowthFrame = null;
  let lastBadges = '';
  let lastGrowth = 'null';

  const globeShown = () => globe?.isGlobeVisible?.() === true;
  // What heights answer against now: a map switch changes it.
  const surfaceNow = () => globe?.surfaceVersion?.() ?? globeShown();

  // What the map shows at a point: the drawn surface, which sees through
  // every draw set (our own and play mode's), else the loaded terrain.
  function sample([lon, lat]) {
    const at = { lon, lat };
    const height = heights.now(at);
    if (height !== null) return height;
    return globeShown()
      ? (heights.now(at, { against: 'terrain' }) ?? undefined)
      : undefined;
  }

  // The ground for a plot from the centre and the street around it.
  function measure(plot) {
    return groundBase(
      sample([plot.center.lon, plot.center.lat]),
      edgeProbes(plot.corners, PROBE_METERS).map(sample),
    );
  }

  const tilesReady = () =>
    !globe || (globe.isSettled('tiles') && globe.isSettled('terrain'));

  const sceneTime = () => frameport.time();

  function sunAt(plot) {
    try {
      return sunPosition(plot.center.lat, plot.center.lon, sceneTime());
    } catch {
      return null;
    }
  }

  // Cut the plot out of the shown photoreal tiles so the block never
  // intersects the real building; the cut joins any existing clipping.
  function cut(plot) {
    const release = globe?.cutPhotoreal?.(
      plot.corners.map(([lon, lat]) => ({ lon, lat })),
    );
    return release ? [release] : [];
  }

  function uncut(cuts) {
    for (const release of cuts) release();
  }

  // The walls that close the cut, from the plate's `top` up to the mesh just
  // outside the plot's edge, or null where nothing stands above the plate. A
  // neighbour is wide and a tree or a pole is not: a height counts only when
  // the samples on both sides reach it too.
  function close(plot, top, cuts) {
    if (!cuts.length) return null;
    const ring = edgeRing(plot.corners, SIDE_STEP_METERS, SIDE_OUT_METERS);
    const n = ring.length;
    const beside = (list, pick) =>
      list.map((height, i) =>
        pick(list[(i + n - 1) % n], height, list[(i + 1) % n]),
      );
    const tops = beside(
      beside(
        ring.map(({ out }) => Math.max(top, sample(out) ?? top)),
        Math.min,
      ),
      Math.max,
    );
    if (tops.every((height) => height - top < 0.2)) return null;
    return {
      id: `${OWNER}-sides`,
      geometry: {
        kind: 'wall',
        positions: [...ring, ring[0]].map(({ on: [lon, lat] }) => ({
          lon,
          lat,
          height: 0,
        })),
        minimumHeights: Array(n + 1).fill(top),
        maximumHeights: [...tops, tops[0]].map((height) =>
          Math.max(height, top + 0.05),
        ),
      },
      height: 'absolute',
      fill: SIDES,
      lit: true,
      shadows: 'receive',
    };
  }

  // The plate, the block and the walls closing the cut, as they now stand.
  function drawSite() {
    shapes.put(
      site ? [site.plate, site.block, site.sides].filter(Boolean) : [],
    );
  }

  // Whether the plate and block are drawn: the frames after the last change
  // have been drawn.
  const drawn = () => framesSinceChange > BUILD_FRAMES;

  // Keep frames coming until the changed geometry is drawn: the cast shadow
  // and the block show together, not on the next camera move.
  function rendered() {
    framesSinceChange = 0;
    if (!build) {
      holdContinuousRender(OWNER);
      build = { timer: 0, remove: null };
      build.remove = frameport.on('postRender', () => {
        framesSinceChange += 1;
        if (drawn()) built();
      });
    }
    clearTimeout(build.timer);
    build.timer = setTimeout(built, BUILD_MAX_MS);
    frameport.requestRender(OWNER);
  }

  // Metres along the shadow, read off the drawn lines: how far each line
  // lies from the face the shadow leaves.
  function drawnMeters() {
    // A line's middle on the ellipsoid, whatever height it runs at.
    const middle = (line) => {
      const [a, b] = [line[0], line.at(-1)].map((at) =>
        scaleToGeodeticSurface(at),
      );
      return scale(add(a, b), 0.5);
    };
    const face = middle(
      shadowBand(site.massing.footprint, site.sun, 0)
        .slice(0, 2)
        .map(([lon, lat]) => fromDegrees(lon, lat)),
    );
    return Object.fromEntries(
      marks.map((item) => [
        item.id.slice(`${OWNER}-shadow-`.length),
        distance(face, middle(item.positions)),
      ]),
    );
  }

  function built() {
    if (!build) return;
    build.remove();
    clearTimeout(build.timer);
    build = null;
    framesSinceChange = Math.max(framesSinceChange, BUILD_FRAMES + 1);
    releaseContinuousRender(OWNER);
  }

  function hide() {
    if (!site) return;
    removeFrame?.();
    removeFrame = null;
    lastAnchors = '';
    store.placeMassing(null);
    marks = [];
    marksKey = '0';
    uncut(site.cuts);
    // The scene's own shadow settings come back.
    effects?.sunShadows?.(null);
    site = null;
    drawSite();
    lines.put([]);
    rendered();
  }

  // A district plot's ground plate and its assumed block, standing on the
  // ground (named by its plot), for the growth timeline. Each block wears the
  // facade look the one block does, re-dressed as its storeys or ground move.
  function standBlock(plot, massing, ground, name = '') {
    const base = ground?.base ?? 0;
    const stand = {
      floor: ground?.floor ?? base,
      restyle(next, at) {
        const facade = next.footprint ? massingFacade(next) : null;
        stand.fill = facade ? facadeFill(facade, at) : PLATE;
      },
      items() {
        return [
          prism(
            `${OWNER}-plate${name}`,
            plot.corners,
            stand.floor - PLATE_DEPTH,
            stand.base + PLATE_RISE,
            stand.fill,
            'receive',
          ),
          stand.hasBlock &&
            prism(
              `${OWNER}-block${name}`,
              massing.footprint,
              stand.base,
              stand.top,
              stand.fill,
              'cast',
            ),
        ].filter(Boolean);
      },
    };
    stand.hasBlock = Boolean(massing.footprint);
    stand.restyle(massing, base);
    return stand;
  }

  function drawStands() {
    growthShapes.put(stands.flatMap((s) => s.items()));
  }

  // The shadow settings while a block shows: cast while the sun is up, soft
  // and no darker than a shadow in the imagery, so the band reads as a
  // shadow on the ground; the map ends near the eye's distance to the block.
  function shadowSettings(reachM) {
    return {
      cast: site.sun?.elevationDeg > 0,
      darkness: SHADOW_DARKNESS,
      softEdges: true,
      ...(reachM === undefined ? {} : { maxDistanceM: reachM }),
    };
  }

  function show(plot) {
    if (site?.plot.id === plot.id) return;
    hide();
    const ground = measure(plot);
    const base = ground?.base ?? 0;
    const massing = plotMassing({ corners: plot.corners, storeys });
    const sun = sunAt(plot);
    const cuts = cut(plot);
    site = {
      plot,
      base,
      floor: ground?.floor ?? base,
      sampled: ground !== null,
      massing,
      sun,
      // The surface this block was cut into and stood on, checked each frame.
      surface: surfaceNow(),
      ready: false,
      cuts,
      sides: close(plot, base + PLATE_RISE, cuts),
    };
    // A cast shadow needs the sun above the horizon. The globe receives it.
    effects?.sunShadows?.(shadowSettings());
    dress();
    removeFrame = frameport.on('postRender', frame);
    mark();
    rendered();
  }

  // The building the block is drawn as, as the block now stands: its
  // storeys and its ground. The plate is paving around the block (the same
  // facade knows the ground).
  function dress() {
    site.facade = massingFacade(site.massing);
    const fill = site.facade ? facadeFill(site.facade, site.base) : PLATE;
    site.plate = prism(
      `${OWNER}-plate`,
      site.plot.corners,
      site.floor - PLATE_DEPTH,
      site.base + PLATE_RISE,
      fill,
      'receive',
    );
    // The block casts and receives nothing: its own facade shades it, and a
    // shadow map speckles a lit roof it falls back on.
    site.block =
      site.massing.footprint &&
      prism(
        `${OWNER}-block`,
        site.massing.footprint,
        site.base,
        site.base + site.massing.heightMeters,
        fill,
        'cast',
      );
    drawSite();
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

  // Draw the study on the ground when it changed: the protected edge, where
  // the shadow now ends (solid) and where the one it is held against does
  // (dashed).
  function mark() {
    const studied = site?.block ? (plan()?.lines ?? []) : [];
    const band = (meters) =>
      shadowBand(site.massing.footprint, site.sun, meters);
    // To 0.1 m: a live clock moves the sun a little every frame.
    const key = JSON.stringify(
      studied.length && [
        studied.map((line) => [line.kind, line.reachMeters.toFixed(1)]),
        band(edgeMeters)
          .flat()
          .map((degrees) => degrees.toFixed(6)),
      ],
    );
    if (key === marksKey) return;
    marksKey = key;
    // One line across where a shadow ends: on the ground, or level on tiles.
    const level = site.cuts.length > 0;
    const stroke = (color, dashed) =>
      dashed ? { kind: 'dash', color, length: 14 } : { kind: 'solid', color };
    const line = (id, ends, color, dashed, widthPx = 3) => ({
      id: `${OWNER}-shadow-${id}`,
      widthPx,
      ...(level
        ? {
            positions: ends.map(([lon, lat]) =>
              fromDegrees(lon, lat, site.base + LEVEL_RISE),
            ),
            mode: 'geodesic',
            style: stroke(color, dashed),
            depthFail: stroke(cssAlpha(color, BEHIND), dashed),
          }
        : {
            positions: ends.map(([lon, lat]) => fromDegrees(lon, lat)),
            mode: 'draped',
            clampTo: 'both',
            style: stroke(color, dashed),
          }),
    });
    marks = studied.map(({ kind, reachMeters }) =>
      line(
        kind,
        band(reachMeters).slice(2),
        kind === 'was' || kind === 'now' ? LINE : ACCENT,
        kind !== 'now',
      ),
    );
    if (studied.length)
      marks.push(
        line(
          'edge',
          shadowBand(
            site.massing.footprint,
            site.sun,
            edgeMeters,
            EDGE_PAD_METERS,
          ).slice(2),
          EDGE,
          false,
          4,
        ),
      );
    lines.put(marks);
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
    site.floor = ground.floor;
    site.sampled = true;
    marksKey = '0';
    site.sides = close(site.plot, ground.base + PLATE_RISE, site.cuts);
    dress();
    rendered();
  }

  // The stepper re-extrudes the standing block from the new storey count.
  function extrude() {
    site.massing = plotMassing({ corners: site.plot.corners, storeys });
    dress();
    mark();
    rendered();
  }

  function project(lon, lat, height, eye, rect) {
    const world = fromDegrees(lon, lat, height);
    if (dot(sub(world, eye.position), eye.direction) <= 0) return null;
    const p = query.project(world);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
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
    if (surfaceNow() !== site.surface) {
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
    const eye = camera.pose();
    effects?.sunShadows?.(
      shadowSettings(
        Math.max(
          SHADOW_MIN_METERS,
          SHADOW_BEYOND *
            distance(
              eye.position,
              fromDegrees(
                site.plot.center.lon,
                site.plot.center.lat,
                site.base,
              ),
            ),
        ),
      ),
    );
    const rect = canvasOf(host)?.getBoundingClientRect();
    if (!rect) return;
    const { base, massing } = site;
    const top = base + massing.heightMeters;
    const tip = shadowTip(massing.footprint, massing.heightMeters, site.sun);
    // The study's bands on screen: the readout keeps clear of them too, and
    // each tip label points at the far side of its line.
    const bands = (marks.length ? plan().lines : []).map((line) => [
      line.kind,
      shadowBand(massing.footprint, site.sun, line.reachMeters).map(
        ([lon, lat]) => project(lon, lat, base, eye, rect),
      ),
    ]);
    const points = [
      ...massing.footprint.map(([lon, lat]) =>
        project(lon, lat, base, eye, rect),
      ),
      ...massing.footprint.map(([lon, lat]) =>
        project(lon, lat, top, eye, rect),
      ),
      ...(tip ?? []).map(([lon, lat]) => project(lon, lat, base, eye, rect)),
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
    removeGrowthFrame?.();
    removeGrowthFrame = null;
    for (const { cuts } of stands) uncut(cuts);
    stands = [];
    drawStands();
    lastBadges = '';
    store.placeGrowth(null);
    rendered();
  }

  // Each frame of the timeline: tiles that loaded since re-ground the blocks,
  // and each sun-locked block's badge follows it on screen.
  function growthFrame() {
    const ready = tilesReady();
    if (ready && !stands.ready) {
      let moved = false;
      for (const s of stands) {
        const ground = measure(s.plot);
        if (!ground || Math.abs(ground.base - s.base) < REGROUND_METERS)
          continue;
        s.floor = ground.floor;
        s.top += ground.base - s.base;
        s.base = ground.base;
        s.restyle(
          plotMassing({ corners: s.plot.corners, storeys: s.storeys }),
          s.base,
        );
        moved = true;
      }
      if (moved) {
        drawStands();
        rendered();
      }
    }
    stands.ready = ready;
    const eye = camera.pose();
    const rect = canvasOf(host)?.getBoundingClientRect();
    if (!rect) return;
    const locks = stands
      .filter((s) => s.locked)
      .map((s) => ({
        plotId: s.plot.id,
        at: project(
          s.plot.center.lon,
          s.plot.center.lat,
          s.top + BADGE_RISE,
          eye,
          rect,
        ),
      }))
      .filter((lock) => lock.at);
    const key = JSON.stringify(locks);
    if (key === lastBadges) return;
    lastBadges = key;
    store.placeGrowth({ locks });
  }

  // The district's plan and, with GROWTH on, a block on every plot of it as
  // tall as the stage shown has it. Null without a district.
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
      stands = plots.map((plot, i) => {
        const ground = measure(plot);
        const massing = plotMassing({
          corners: plot.corners,
          storeys: blocks[i].storeys,
        });
        const stand = standBlock(plot, massing, ground, `-${plot.id}`);
        return Object.assign(stand, {
          plot,
          base: ground?.base ?? 0,
          top: (ground?.base ?? 0) + massing.heightMeters,
          storeys: blocks[i].storeys,
          cuts: cut(plot),
        });
      });
      removeGrowthFrame = frameport.on('postRender', growthFrame);
      drawStands();
      rendered();
    }
    let restyled = false;
    blocks.forEach((block, i) => {
      const s = stands[i];
      s.locked = block.locked;
      if (s.storeys === block.storeys) return;
      s.storeys = block.storeys;
      s.top = s.base + block.heightMeters;
      s.restyle(
        plotMassing({ corners: s.plot.corners, storeys: block.storeys }),
        s.base,
      );
      lastBadges = '';
      restyled = true;
    });
    if (restyled) {
      drawStands();
      rendered();
    }
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
    // The timeline's blocks stand in place of the one block.
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
    frameport.requestRender(OWNER);
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
        // The shapes as the renderer was handed them, so a journey checks
        // what is drawn, not this owner's numbers.
        blockBase: site?.block ? bottomOf(site.block) : null,
        blockExtrudedHeight: site?.block?.extrudeHeight ?? null,
        plateTop: site?.plate.extrudeHeight ?? null,
        plateBottom: site?.plate ? bottomOf(site.plate) : null,
        shadowMap: Boolean(
          effects?.diagnostics().passes.includes('sunShadows'),
        ),
        blockShadows: site?.block?.shadows === 'cast',
        // The plate and block as they now stand are on screen.
        drawn: Boolean(site?.block) && !build && drawn(),
        sun: site?.sun ?? null,
        cuts: site?.cuts.length ?? 0,
        // The ids in each of massing's draw sets, as the renderer holds them.
        ids: {
          shapes: shapes.items().map((item) => item.id),
          lines: lines.items().map((item) => item.id),
          growth: growthShapes.items().map((item) => item.id),
        },
        // The building the block is drawn as, and the fill it is drawn with.
        facade: site?.facade ?? null,
        blockFill: site?.block?.fill?.facade ? 'facade' : null,
        // The shadow study: its plan, and the lines as they are drawn.
        study: study && {
          wasStoreys,
          edgeMeters,
          edgeSet,
          picking,
          plan: plan(),
          drawn: marks.length > 0 && drawnMeters(),
        },
        // The sun locks, and the timeline's blocks as they are drawn.
        locks: Object.fromEntries(fits),
        growth: stands.length > 0 && {
          stage,
          storeys: stageStoreys,
          drawn: !build && drawn(),
          blocks: growthShapes
            .items()
            .filter((item) => item.shadows === 'cast')
            .map((item) => ({
              plotId: item.id.slice(`${OWNER}-block-`.length),
              locked: stands.find(
                (s) => `${OWNER}-block-${s.plot.id}` === item.id,
              )?.locked,
              heightMeters: item.extrudeHeight - bottomOf(item),
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
      shapes.dispose();
      lines.dispose();
      growthShapes.dispose();
    },
  };
}
