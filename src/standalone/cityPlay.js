import * as Cesium from 'cesium';
import { msg, t } from '../i18n/index.js';
import { claimPointer, releasePointer } from '../data/inputOwnership.js';
import { neighborPlots, plotPoint, snapPlot } from '../data/cityPlot.js';
import { observerSolarPosition } from '../data/satellitePass.js';
import { CITY_LAND_USES } from '../data/cityLandUse.js';
import { presentCityWalkAccess } from '../ui/cityWalkAccess.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import {
  KIND_ICONS,
  carouselCards,
  createPlayState,
  detailCallouts,
  districtPins,
  groundShadow,
  nextKind,
  playReducer,
  plotAlternatives,
  plotCode,
  resourceStats,
  resumeAlternative,
  wheelActions,
  zoneLegend,
  zoomTier,
} from '../ui/cityPlayModel.js';

const OWNER = 'city-play';
const BODY_CLASS = 'gev-city-play';
const BOX_HEIGHT = 26;
// The concept card stands on its plot: 48 m wide, 32 m tall, base on the ground.
const HOLO_WIDTH = 48;
const HOLO_HEIGHT = 32;
const GROUND_LIFT = 0.3;
const SCAN_MS = 1400;
const BEACON_HEIGHT = 160;
// Narrow screens lead the framing so the plot sits above the bottom carousel.
const NARROW_LEAD = { oblique: 120, detail: 50 };
const ACCENT = Cesium.Color.fromCssColorString('#2ec8e8');
const KIND_COLORS = {
  park: Cesium.Color.fromCssColorString('#5ee08a'),
  plaza: Cesium.Color.fromCssColorString('#ffc25c'),
  'bike-lane': ACCENT,
};
// Proposed land-use tints reuse GEV's existing palette.
const ZONE_COLORS = {
  housing: Cesium.Color.fromCssColorString('#ffc25c'),
  'mixed-use': Cesium.Color.fromCssColorString('#ff5c6e'),
  civic: ACCENT,
  'open-space': Cesium.Color.fromCssColorString('#5ee08a'),
};
const CLASSIFY = Cesium.ClassificationType.BOTH;
const FRAMES = {
  oblique: { pitch: -34, range: 290 },
  detail: { pitch: -30, range: 225 },
};

function ring(plot, height) {
  const points = [...plot.corners, plot.corners[0]].flat();
  return height === undefined
    ? Cesium.Cartesian3.fromDegreesArray(points)
    : Cesium.Cartesian3.fromDegreesArrayHeights(
        [...plot.corners, plot.corners[0]].flatMap(([lon, lat]) => [
          lon,
          lat,
          height,
        ]),
      );
}

/**
 * Own City builder play mode on the globe: plot picking, the in-world
 * footprint and concept holograms, camera framing, and screen anchors for the
 * overlay. The builder still owns the document; this module only calls its
 * explicit reimagine/reroll/open controls.
 */
export function mountCityPlay({
  viewer,
  builder,
  store,
  doc = globalThis.document,
  win = globalThis.window,
  now = () => performance.now(),
}) {
  const scene = viewer?.scene;
  if (!scene || !doc) return { receive() {}, destroy() {} };
  let state = createPlayState();
  let data = {
    alternatives: null,
    zoning: [],
    pending: false,
    pendingId: null,
  };
  let walkCache = { list: undefined, map: {} };
  let lease = null;
  let handler = null;
  let saved = null;
  let removeRender = null;
  let framing = false;
  let notice = null;
  let disposed = false;
  let lastAnchors = '';
  let hoverQueued = null;
  let range = Number.NaN;
  let resumed = false;
  const heights = new Map();
  const picked = new Set();
  const appeared = new Map();
  const ds = new Cesium.CustomDataSource('gev-city-play');
  const added = viewer.dataSources.add(ds);
  const holos = new Map();
  const tints = new Map();
  const zoneTints = new Map();
  const select = [];
  const hover = [];
  const grid = [];

  function baseHeight(plot, pickedHeight) {
    // The first pick on a plot fixes its ground; later picks may hit our own holo.
    if (Number.isFinite(pickedHeight) && !heights.has(plot.id)) {
      heights.set(plot.id, pickedHeight);
      picked.add(plot.id);
    }
    if (heights.has(plot.id)) return heights.get(plot.id);
    let h = 0;
    try {
      const surface = Cesium.Cartographic.toCartesian(
        Cesium.Cartographic.fromDegrees(plot.center.lon, plot.center.lat),
      );
      // Our own holo stands across the plot centre; never clamp onto it.
      const clamped = scene.clampToHeightSupported
        ? scene.clampToHeight(surface, ds.entities.values)
        : null;
      const sampled = clamped
        ? Cesium.Cartographic.fromCartesian(clamped).height
        : scene.globe?.getHeight?.(
            Cesium.Cartographic.fromDegrees(plot.center.lon, plot.center.lat),
          );
      if (Number.isFinite(sampled)) h = sampled;
    } catch {
      /* tiles not ready: the ellipsoid stands in */
    }
    heights.set(plot.id, h);
    return h;
  }

  function clearList(list) {
    for (const entity of list.splice(0)) ds.entities.remove(entity);
  }

  function drawHover() {
    clearList(hover);
    const plot = state.hover;
    if (!plot || plot.id === state.plot?.id) return;
    hover.push(
      ds.entities.add({
        polygon: {
          hierarchy: ring(plot).slice(0, 4),
          material: ACCENT.withAlpha(0.12),
          classificationType: CLASSIFY,
        },
      }),
      ds.entities.add({
        polyline: {
          positions: ring(plot),
          width: 2,
          material: ACCENT.withAlpha(0.7),
          clampToGround: true,
          classificationType: CLASSIFY,
        },
      }),
    );
  }

  function drawSelection() {
    clearList(select);
    clearList(grid);
    const plot = state.plot;
    if (!plot) return;
    const base = baseHeight(plot);
    // Choosing shows the prism and neighbour grid; once a concept stands on the
    // plot only its outline and projector edges remain, so the concept leads.
    const choosing = state.wheel || !shownByPlot().has(plot.id);
    for (const cell of choosing ? neighborPlots(plot, 1) : []) {
      grid.push(
        ds.entities.add({
          polyline: {
            positions: ring(cell),
            width: 2,
            material: ACCENT.withAlpha(0.36),
            clampToGround: true,
            classificationType: CLASSIFY,
          },
        }),
      );
    }
    select.push(
      ds.entities.add({
        id: `${OWNER}-footprint`,
        polygon: {
          hierarchy: ring(plot).slice(0, 4),
          material: ACCENT.withAlpha(choosing ? 0.28 : 0.14),
          classificationType: CLASSIFY,
        },
      }),
      ds.entities.add({
        polyline: {
          positions: ring(plot),
          width: 9,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.3,
            color: ACCENT,
          }),
          clampToGround: true,
          classificationType: CLASSIFY,
        },
      }),
    );
    if (choosing)
      select.push(
        ds.entities.add({
          wall: {
            positions: ring(plot, base),
            minimumHeights: Array(5).fill(base),
            maximumHeights: Array(5).fill(base + BOX_HEIGHT),
            material: ACCENT.withAlpha(0.22),
          },
        }),
        ds.entities.add({
          polyline: {
            positions: ring(plot, base + BOX_HEIGHT),
            width: 6,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.25,
              color: ACCENT,
            }),
          },
        }),
      );
    if (choosing)
      select.push(
        ...plot.corners.map(([lon, lat]) =>
          ds.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                lon,
                lat,
                base,
                lon,
                lat,
                base + BOX_HEIGHT,
              ]),
              width: 4,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.3,
                color: ACCENT,
              }),
            },
          }),
        ),
      );
  }

  // The world shown on each plot: focused card, else kept world, else latest concept.
  function shownByPlot() {
    const shown = new Map();
    const list = data.alternatives ?? [];
    const byPlot = new Map();
    for (const a of list) {
      if (!a.site || !a.concept) continue;
      byPlot.set(a.site.plot.id, [...(byPlot.get(a.site.plot.id) ?? []), a]);
    }
    for (const [plotId, options] of byPlot) {
      const focused =
        state.plot?.id === plotId &&
        options.find((a) => a.id === state.focusId);
      const kept = options.find((a) => a.id === state.built[plotId]);
      shown.set(plotId, focused || kept || options.at(-1));
    }
    return shown;
  }

  function holoGeometry(a) {
    const plot = a.site.plot;
    const base = baseHeight(plot);
    const heading = Cesium.Math.toRadians(
      (a.site.reference ?? a.concept.sourceView).camera.heading,
    );
    // Stand the card across the capture camera's view so it faces that view.
    const half = HOLO_WIDTH / 2;
    const east = Math.cos(heading) * half;
    const north = -Math.sin(heading) * half;
    const metersLat = 111_320;
    const metersLon = metersLat * Math.cos((plot.center.lat * Math.PI) / 180);
    const a0 = [
      plot.center.lon - east / metersLon,
      plot.center.lat - north / metersLat,
    ];
    const a1 = [
      plot.center.lon + east / metersLon,
      plot.center.lat + north / metersLat,
    ];
    const lift = base + GROUND_LIFT;
    // The card faces back toward the capture camera.
    const face = (Cesium.Math.toDegrees(heading) + 540) % 360;
    return { base, lift, top: lift + HOLO_HEIGHT, a0, a1, face };
  }

  // The sun of the scene clock, the same time Cesium lights the globe with.
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

  function removeHolo(plotId) {
    const holo = holos.get(plotId);
    if (!holo) return;
    for (const shadow of holo._cityShadows) ds.entities.remove(shadow);
    ds.entities.remove(holo);
    holos.delete(plotId);
  }

  function drawConcepts() {
    const shown = state.active ? shownByPlot() : new Map();
    const tier = state.tier;
    for (const [plotId, entity] of holos) {
      const a = shown.get(plotId);
      if (!a || entity._cityKey !== `${a.id}:${a.revision}`) removeHolo(plotId);
    }
    for (const [plotId, entity] of tints) {
      if (
        !shown.has(plotId) ||
        entity._cityKind !== shown.get(plotId).parameters.kind
      ) {
        ds.entities.remove(entity);
        ds.entities.remove(entity._cityBeacon);
        tints.delete(plotId);
      }
    }
    for (const [plotId, a] of shown) {
      const key = `${a.id}:${a.revision}`;
      if (!tints.has(plotId)) {
        const tint = ds.entities.add({
          polygon: {
            hierarchy: ring(a.site.plot).slice(0, 4),
            material: KIND_COLORS[a.parameters.kind].withAlpha(0.34),
            classificationType: CLASSIFY,
          },
        });
        tint._cityKind = a.parameters.kind;
        // A tall kind-coloured beacon makes a 40 m plot readable from the district view.
        const base = baseHeight(a.site.plot);
        tint._cityBeacon = ds.entities.add({
          wall: {
            positions: ring(a.site.plot, base),
            minimumHeights: Array(5).fill(base),
            maximumHeights: Array(5).fill(base + BEACON_HEIGHT),
            material: KIND_COLORS[a.parameters.kind].withAlpha(0.42),
          },
        });
        tints.set(plotId, tint);
      }
      // A proposed land use takes the plot's ground tint; the beacon stays.
      tints.get(plotId).show = !useOf(plotId);
      tints.get(plotId)._cityBeacon.show = tier === 'district';
      if (!holos.has(plotId)) {
        const g = holoGeometry(a);
        if (!appeared.has(key)) appeared.set(key, now());
        const start = appeared.get(key);
        const lift = g.lift;
        const heights = () => {
          const k = Math.min(1, (now() - start) / SCAN_MS);
          const h = lift + (g.top - lift) * (1 - (1 - k) ** 3);
          return [h, h];
        };
        const animating = now() - start < SCAN_MS;
        const sun = sunAt(a.site.plot);
        const ground = groundShadow({
          a0: g.a0,
          a1: g.a1,
          heightMeters: HOLO_HEIGHT,
          faceAzimuthDeg: g.face,
          sun,
          lat: a.site.plot.center.lat,
        });
        // Contact band and cast shadow drape on tiles and terrain.
        const shadows = [
          [ground.contact, 0.62],
          [ground.cast, 0.4],
        ]
          .filter(([corners]) => corners)
          .map(([corners, alpha]) =>
            ds.entities.add({
              polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(corners.flat()),
                material: Cesium.Color.BLACK.withAlpha(alpha),
                classificationType: CLASSIFY,
              },
            }),
          );
        const holo = ds.entities.add({
          id: `${OWNER}-concept-${a.id}`,
          wall: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
              ...g.a0,
              lift,
              ...g.a1,
              lift,
            ]),
            minimumHeights: [lift, lift],
            maximumHeights: animating
              ? new Cesium.CallbackProperty(heights, false)
              : [g.top, g.top],
            material: new Cesium.ImageMaterialProperty({
              image: a.concept.image,
              transparent: true,
              // Cesium lights walls from the eye; shade the face by the sun instead.
              color: new Cesium.Color(
                ground.shade,
                ground.shade,
                ground.shade,
                0.94,
              ),
            }),
            outline: true,
            outlineColor: ACCENT,
          },
        });
        holo._cityKey = key;
        holo._cityPlot = a.site.plot;
        holo._cityAlternative = a.id;
        holo._cityShadows = shadows;
        holo._cityGround = {
          sun,
          baseGapMeters: g.lift - g.base,
          shadowMeters: ground.lengthMeters,
          shade: ground.shade,
          contact: Boolean(ground.contact),
          cast: Boolean(ground.cast),
        };
        holos.set(plotId, holo);
        if (animating) {
          holdContinuousRender(OWNER);
          setTimeout(() => {
            if (holos.get(plotId) === holo)
              holo.wall.maximumHeights = [g.top, g.top];
            if (![...appeared.values()].some((s) => now() - s < SCAN_MS))
              releaseContinuousRender(OWNER);
            scene.requestRender();
          }, SCAN_MS + 50);
        }
      }
      const holo = holos.get(plotId);
      holo.show = tier !== 'district';
      for (const shadow of holo._cityShadows) shadow.show = holo.show;
    }
  }

  const zoning = () => data.zoning ?? [];
  const useOf = (plotId) =>
    zoning().find((z) => z.plot.id === plotId)?.use ?? null;

  // Each zoned plot drapes its proposed land-use tint and edge on the map.
  function drawZones() {
    const wanted = new Map(
      (state.active ? zoning() : []).map((z) => [z.plot.id, z]),
    );
    for (const [plotId, tint] of zoneTints) {
      if (wanted.get(plotId)?.use === tint._cityUse) continue;
      ds.entities.remove(tint._cityEdge);
      ds.entities.remove(tint);
      zoneTints.delete(plotId);
    }
    for (const [plotId, z] of wanted) {
      if (zoneTints.has(plotId)) continue;
      const color = ZONE_COLORS[z.use];
      const tint = ds.entities.add({
        polygon: {
          hierarchy: ring(z.plot).slice(0, 4),
          material: color.withAlpha(0.42),
          classificationType: CLASSIFY,
        },
      });
      tint._cityUse = z.use;
      tint._cityEdge = ds.entities.add({
        polyline: {
          positions: ring(z.plot),
          width: 3,
          material: color.withAlpha(0.9),
          clampToGround: true,
          classificationType: CLASSIFY,
        },
      });
      zoneTints.set(plotId, tint);
    }
  }

  // The existing walk-access estimate (#206) per alternative, never recomputed here.
  function walkByAlternative() {
    const list = data.alternatives ?? [];
    if (walkCache.list !== list)
      walkCache = {
        list,
        map: Object.fromEntries(
          presentCityWalkAccess(list)
            .rows.filter((r) => r.id !== 'baseline' && r.state === 'evaluated')
            .map((r) => [r.id, r.mean]),
        ),
      };
    return walkCache.map;
  }

  function pinsNow() {
    return districtPins(data.alternatives ?? [], state.built, {
      zoning: zoning(),
      walk: walkByAlternative(),
    });
  }

  function render() {
    ds.show = state.active;
    drawHover();
    drawSelection();
    drawConcepts();
    drawZones();
    scene.requestRender();
  }

  function selectedAlternative() {
    const plot = state.plot;
    if (!plot) return null;
    const shown = shownByPlot().get(plot.id);
    const list = plotAlternatives(data.alternatives ?? [], plot.id);
    return (
      list.find((a) => a.id === state.focusId) ?? shown ?? list.at(-1) ?? null
    );
  }

  function present() {
    if (disposed) return;
    const plot = state.plot;
    const alternatives = data.alternatives ?? [];
    const focused = selectedAlternative();
    store.publish({
      active: state.active,
      tier: state.tier,
      wheelOpen: state.wheel,
      pending: data.pending || framing,
      framing,
      provider: data.provider,
      error: notice ? t(notice) : data.error,
      status: data.status,
      stats: resourceStats(data.alternatives),
      plot: plot && {
        id: plot.id,
        code: plotCode(plot),
        area: plot.areaSquareMeters,
        size: plot.sizeMeters,
        use: useOf(plot.id),
      },
      actions: wheelActions({
        pending: data.pending || framing,
        full: data.full,
        zoneMenu: state.zoneMenu,
        use: plot && useOf(plot.id),
      }),
      legend:
        state.zoneMenu || (state.tier === 'district' && zoning().length)
          ? zoneLegend(zoning())
          : null,
      cards: carouselCards(alternatives, plot?.id, {
        builtId: plot ? state.built[plot.id] : null,
        focusId: focused?.id,
        pendingId: data.pendingId,
      }),
      focused: focused && {
        id: focused.id,
        title: focused.title,
        kind: focused.parameters.kind,
        icon: KIND_ICONS[focused.parameters.kind],
        parameters: focused.parameters,
        revision: focused.revision,
        concept: Boolean(focused.concept),
        built: state.built[plot.id] === focused.id,
      },
      callouts: state.tier === 'detail' ? detailCallouts(focused) : [],
      pins: state.tier === 'district' ? pinsNow() : [],
    });
  }

  function sync() {
    render();
    present();
  }

  function dispatch(action) {
    const next = playReducer(state, action);
    if (next === state) return;
    const tierOnly = action.type === 'tier';
    state = next;
    if (tierOnly) {
      drawConcepts();
      present();
      scene.requestRender();
    } else sync();
  }

  // --- per-frame anchors -------------------------------------------------
  const occluder = new Cesium.EllipsoidalOccluder(
    Cesium.Ellipsoid.WGS84,
    Cesium.Cartesian3.ZERO,
  );
  const scratch = new Cesium.Cartesian2();
  function project(lon, lat, height) {
    const world = Cesium.Cartesian3.fromDegrees(lon, lat, height);
    const camera = viewer.camera;
    const toPoint = Cesium.Cartesian3.subtract(
      world,
      camera.positionWC,
      new Cesium.Cartesian3(),
    );
    if (Cesium.Cartesian3.dot(toPoint, camera.directionWC) <= 0) return null;
    occluder.cameraPosition = camera.positionWC;
    if (!occluder.isPointVisible(world)) return null;
    const p = scene.cartesianToCanvasCoordinates(world, scratch);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const rect = scene.canvas.getBoundingClientRect();
    const x = Math.round(p.x + rect.left);
    const y = Math.round(p.y + rect.top);
    const pad = 40;
    if (x < -pad || y < -pad || x > rect.right + pad || y > rect.bottom + pad)
      return null;
    return { x, y };
  }
  function frame() {
    if (!state.active || disposed) return;
    const camera = viewer.camera;
    const plot = state.plot;
    if (plot) {
      const base = baseHeight(plot);
      range = Cesium.Cartesian3.distance(
        camera.positionWC,
        Cesium.Cartesian3.fromDegrees(plot.center.lon, plot.center.lat, base),
      );
    } else {
      const c = camera.positionCartographic;
      const ground = scene.globe?.show ? (scene.globe.getHeight(c) ?? 0) : 0;
      range = c.height - ground;
    }
    const tier = zoomTier(range, state.tier);
    if (tier !== state.tier) dispatch({ type: 'tier', tier });
    const anchors = {
      plot: null,
      footprint: null,
      tag: null,
      holo: null,
      callouts: {},
      pins: {},
    };
    if (plot) {
      const base = baseHeight(plot);
      anchors.plot = project(plot.center.lon, plot.center.lat, base);
      anchors.footprint = plot.corners.map(([lon, lat]) =>
        project(lon, lat, base),
      );
      const [lon, lat] = plot.corners[2];
      anchors.tag = project(lon, lat, base + BOX_HEIGHT);
      const a = shownByPlot().get(plot.id);
      if (a) {
        const g = holoGeometry(a);
        anchors.holo = project(plot.center.lon, plot.center.lat, g.top);
      }
      if (state.tier === 'detail') {
        for (const c of detailCallouts(selectedAlternative())) {
          const p = plotPoint(plot, c.fx, c.fy);
          anchors.callouts[c.id] = project(p.lon, p.lat, base + 2);
        }
      }
    }
    if (state.tier === 'district') {
      for (const pin of pinsNow()) {
        const h = heights.get(pin.plotId) ?? 0;
        anchors.pins[pin.plotId] = project(pin.center.lon, pin.center.lat, h);
      }
    }
    const key = JSON.stringify(anchors);
    if (key !== lastAnchors) {
      lastAnchors = key;
      store.place(anchors);
    }
  }

  // --- input ---------------------------------------------------------------
  function pickPoint(position) {
    let world = null;
    try {
      if (scene.pickPositionSupported) world = scene.pickPosition(position);
    } catch {
      world = null;
    }
    let carto = world && Cesium.Cartographic.fromCartesian(world);
    if (
      !carto ||
      !Number.isFinite(carto.height) ||
      Math.abs(carto.height) > 9000
    ) {
      world = viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84);
      carto = world && Cesium.Cartographic.fromCartesian(world);
    }
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      height: carto.height,
    };
  }
  function ownPlot(position) {
    let hit = null;
    try {
      hit = scene.pick(position);
    } catch {
      return null;
    }
    const entity = hit?.id;
    if (!entity || !ds.entities.contains(entity)) return null;
    // Only a standing concept names its plot; tints and footprints fall through
    // to the ground pick, which snaps to the plot under the cursor.
    return entity._cityPlot ?? null;
  }
  function onClick({ position }) {
    if (framing) return;
    // Clicking a concept card or the selected footprint selects that plot again.
    const mine = ownPlot(position);
    if (mine) {
      dispatch({ type: 'select', plot: mine });
      return;
    }
    const point = pickPoint(position);
    const plot = point && snapPlot(point);
    if (!plot) {
      dispatch({ type: 'clear' });
      return;
    }
    baseHeight(plot, point.height);
    notice = null;
    // From far away (district, or well beyond plot framing) the click swoops in.
    const far =
      state.tier === 'district' ||
      (!state.plot && range > FRAMES.oblique.range * 1.6);
    dispatch({ type: 'select', plot });
    // From the district view a plot click flies in to plot range, like a game map.
    if (far) void fly(plot, 'oblique');
  }
  function onMove({ endPosition }) {
    hoverQueued = endPosition;
    win.requestAnimationFrame?.(() => {
      if (!hoverQueued || !state.active) return;
      const world = viewer.camera.pickEllipsoid(
        hoverQueued,
        Cesium.Ellipsoid.WGS84,
      );
      hoverQueued = null;
      if (!world) return dispatch({ type: 'hover', plot: null });
      const c = Cesium.Cartographic.fromCartesian(world);
      const plot = snapPlot({
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
      });
      if (plot?.id !== state.hover?.id) dispatch({ type: 'hover', plot });
    });
  }
  function onKey(event) {
    if (event.key !== 'Escape' || !state.active) return;
    if (doc.querySelector('dialog[open]')) return;
    const target = event.target;
    if (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    controls.exit();
  }

  function fly(plot, kind) {
    const frameOf = FRAMES[kind];
    const base = baseHeight(plot);
    const camera = viewer.camera;
    const lead = scene.canvas.clientWidth < 600 ? NARROW_LEAD[kind] : 0;
    // Aim at a point between the camera and the plot, which lifts the plot on screen.
    const metersLon = 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
    const aimLat =
      plot.center.lat - (Math.cos(camera.heading) * lead) / 111_320;
    const aimLon =
      plot.center.lon - (Math.sin(camera.heading) * lead) / metersLon;
    return new Promise((resolve) => {
      camera.cancelFlight?.();
      camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(aimLon, aimLat, base),
          plot.sizeMeters,
        ),
        {
          offset: new Cesium.HeadingPitchRange(
            camera.heading,
            Cesium.Math.toRadians(frameOf.pitch),
            frameOf.range,
          ),
          duration: 1.4,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          complete: () => resolve(true),
          cancel: () => resolve(false),
        },
      );
    });
  }
  // Give the map a bounded moment to load the framed tiles before capture.
  function settled(timeoutMs = 15000) {
    const started = now();
    return new Promise((resolve) => {
      const check = () => {
        const tilesetsReady = Array.from(
          { length: scene.primitives.length },
          (_, i) => scene.primitives.get(i),
        ).every((p) => !p?.show || p.tilesLoaded !== false);
        const globeReady = !scene.globe?.show || scene.globe.tilesLoaded;
        if ((tilesetsReady && globeReady) || now() - started > timeoutMs)
          resolve();
        else {
          scene.requestRender();
          setTimeout(check, 120);
        }
      };
      check();
    });
  }

  async function reimagine(kind) {
    const plot = state.plot;
    if (!plot || framing || data.pending || data.full) return;
    framing = true;
    notice = null;
    present();
    try {
      await fly(plot, 'oblique');
      await settled();
      // The capture keeps the cyan footprint so the concept knows its plot.
      clearList(grid);
      clearList(hover);
      for (const holo of holos.values()) holo.show = false;
      scene.requestRender();
    } finally {
      framing = false;
    }
    if (disposed || !state.active || state.plot !== plot) return sync();
    const id = await builder.reimagine({ plot, kind });
    // The concept takes the stage; clicking the plot brings the wheel back.
    if (id && state.plot?.id === plot.id) dispatch({ type: 'landed', id });
    else sync();
  }

  // A sampled (not picked) ground is re-measured once the framed tiles load,
  // so a restored concept stands on the surface instead of a coarse tile.
  function reground(plot) {
    if (disposed || !state.active || picked.has(plot.id)) return;
    const before = heights.get(plot.id);
    heights.delete(plot.id);
    if (Math.abs(baseHeight(plot) - before) < 0.5) return;
    removeHolo(plot.id);
    const tint = tints.get(plot.id);
    if (tint) {
      ds.entities.remove(tint._cityBeacon);
      ds.entities.remove(tint);
    }
    tints.delete(plot.id);
    sync();
  }

  // The first entry after a page load frames the latest restored concept.
  function resume() {
    if (resumed) return;
    const c = viewer.camera.positionCartographic;
    const a = resumeAlternative(
      data.alternatives,
      c && {
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
        height: c.height,
      },
    );
    if (!a) return;
    const plot = a.site.plot;
    dispatch({ type: 'resume', plot, id: a.id });
    if (state.plot !== plot) return;
    resumed = true;
    void fly(plot, 'oblique')
      .then((landed) => landed && settled(8000))
      .then(() => reground(plot));
  }

  const controls = {
    toggle() {
      if (state.active) controls.exit();
      else controls.enter();
    },
    enter() {
      if (disposed || state.active) return;
      lease = claimPointer(OWNER);
      if (!lease) {
        notice = msg('Finish the active map tool, then open City builder.');
        present();
        return;
      }
      notice = null;
      handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(onMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      // Borrow the Viewer's own select/track clicks for the mode's lifetime.
      const stock = viewer.screenSpaceEventHandler;
      saved = {
        click:
          stock?.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) ?? null,
        double:
          stock?.getInputAction(
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
          ) ?? null,
      };
      stock?.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      stock?.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      doc.addEventListener('keydown', onKey, true);
      removeRender = scene.postRender.addEventListener(frame);
      doc.body.classList.add(BODY_CLASS);
      dispatch({ type: 'enter' });
      frame();
      resume();
    },
    exit() {
      if (!state.active) return;
      handler?.destroy();
      handler = null;
      const stock = viewer.screenSpaceEventHandler;
      if (stock && saved) {
        if (saved.click)
          stock.setInputAction(
            saved.click,
            Cesium.ScreenSpaceEventType.LEFT_CLICK,
          );
        if (saved.double)
          stock.setInputAction(
            saved.double,
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
          );
      }
      saved = null;
      doc.removeEventListener('keydown', onKey, true);
      removeRender?.();
      removeRender = null;
      releaseContinuousRender(OWNER);
      doc.body.classList.remove(BODY_CLASS);
      releasePointer(lease);
      lease = null;
      notice = null;
      lastAnchors = '';
      store.place(null);
      dispatch({ type: 'exit' });
    },
    act(id) {
      if (!state.plot) return;
      if (id === 'zone' || id === 'back') {
        dispatch({ type: 'zone-menu', open: id === 'zone' });
        return;
      }
      if (id === 'clear-use' || CITY_LAND_USES.includes(id)) {
        void builder.setZone({
          plot: state.plot,
          use: id === 'clear-use' ? null : id,
        });
        return;
      }
      if (id === 'inspect') {
        void fly(state.plot, 'detail');
        return;
      }
      const tried = plotAlternatives(
        data.alternatives ?? [],
        state.plot.id,
      ).map((a) => a.parameters.kind);
      const kind = id === 'reimagine' ? nextKind(tried) : id;
      if (KIND_ICONS[kind]) void reimagine(kind);
    },
    focus(id) {
      dispatch({ type: 'focus', id });
    },
    build(id) {
      if (!state.plot) return;
      dispatch({ type: 'build', plotId: state.plot.id, id });
    },
    async reroll(id) {
      const landed = await builder.reroll(id);
      if (state.active) dispatch({ type: landed ? 'landed' : 'focus', id });
    },
    openRecords() {
      builder.open();
    },
  };

  const probe = Object.freeze({
    snapshot: () =>
      Object.freeze({
        active: state.active,
        tier: state.tier,
        range,
        framing,
        pending: Boolean(data.pending),
        plot: state.plot && {
          id: state.plot.id,
          center: { ...state.plot.center },
        },
        footprint:
          Boolean(ds.entities.getById(`${OWNER}-footprint`)) && ds.show,
        concepts: [...holos.values()]
          .filter((e) => e.show !== false && ds.show)
          .map((e) => e._cityAlternative),
        grounding: Object.fromEntries(
          [...holos.values()].map((e) => [e._cityAlternative, e._cityGround]),
        ),
        anchors: lastAnchors ? JSON.parse(lastAnchors) : null,
        bodyClass: doc.body.classList.contains(BODY_CLASS),
        zoning: zoning().map((z) => ({ plotId: z.plot.id, use: z.use })),
        zoneTints: ds.show ? zoneTints.size : 0,
      }),
  });
  if (win) win.__gevCityPlay = probe;
  store.connect(controls);
  present();

  return {
    controls,
    receive(next) {
      data = next ?? data;
      if (disposed) return;
      sync();
    },
    destroy() {
      if (disposed) return;
      controls.exit();
      disposed = true;
      if (win?.__gevCityPlay === probe) delete win.__gevCityPlay;
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
      if (store.controls === controls) {
        store.connect(null);
        store.publish(null);
        store.place(null);
      }
    },
  };
}
