import * as Cesium from 'cesium';
import { msg, t } from '../i18n/index.js';
import { claimPointer, releasePointer } from '../data/inputOwnership.js';
import { neighborPlots, plotPoint, snapPlot } from '../data/cityPlot.js';
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
  nextKind,
  playReducer,
  plotAlternatives,
  plotCode,
  resourceStats,
  wheelActions,
  zoomTier,
} from '../ui/cityPlayModel.js';

const OWNER = 'city-play';
const BODY_CLASS = 'gev-city-play';
const BOX_HEIGHT = 18;
const HOLO_WIDTH = 46;
const SCAN_MS = 1400;
const ACCENT = Cesium.Color.fromCssColorString('#2ec8e8');
const KIND_COLORS = {
  park: Cesium.Color.fromCssColorString('#5ee08a'),
  plaza: Cesium.Color.fromCssColorString('#ffc25c'),
  'bike-lane': ACCENT,
};
const CLASSIFY = Cesium.ClassificationType.BOTH;
const FRAMES = {
  oblique: { pitch: -32, range: 340 },
  detail: { pitch: -38, range: 170 },
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
  let data = { alternatives: null, pending: false, pendingId: null };
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
  const heights = new Map();
  const appeared = new Map();
  const ds = new Cesium.CustomDataSource('gev-city-play');
  const added = viewer.dataSources.add(ds);
  const holos = new Map();
  const tints = new Map();
  const select = [];
  const hover = [];
  const grid = [];

  function baseHeight(plot, picked) {
    if (Number.isFinite(picked)) heights.set(plot.id, picked);
    if (heights.has(plot.id)) return heights.get(plot.id);
    let h = 0;
    try {
      const surface = Cesium.Cartographic.toCartesian(
        Cesium.Cartographic.fromDegrees(plot.center.lon, plot.center.lat),
      );
      const clamped = scene.clampToHeightSupported
        ? scene.clampToHeight(surface)
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
    for (const cell of neighborPlots(plot, 2)) {
      grid.push(
        ds.entities.add({
          polyline: {
            positions: ring(cell),
            width: 1.5,
            material: ACCENT.withAlpha(0.32),
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
          material: ACCENT.withAlpha(0.28),
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
      ds.entities.add({
        wall: {
          positions: ring(plot, base),
          minimumHeights: Array(5).fill(base),
          maximumHeights: Array(5).fill(base + BOX_HEIGHT),
          material: ACCENT.withAlpha(0.16),
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
    return { base, top: base + 6 + (HOLO_WIDTH * 2) / 3, a0, a1 };
  }

  function drawConcepts() {
    const shown = state.active ? shownByPlot() : new Map();
    const tier = state.tier;
    for (const [plotId, entity] of holos) {
      const a = shown.get(plotId);
      if (!a || entity._cityKey !== `${a.id}:${a.revision}`) {
        ds.entities.remove(entity);
        holos.delete(plotId);
      }
    }
    for (const [plotId, entity] of tints) {
      if (
        !shown.has(plotId) ||
        entity._cityKind !== shown.get(plotId).parameters.kind
      ) {
        ds.entities.remove(entity);
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
        tints.set(plotId, tint);
      }
      if (!holos.has(plotId)) {
        const g = holoGeometry(a);
        if (!appeared.has(key)) appeared.set(key, now());
        const start = appeared.get(key);
        const lift = g.base + 6;
        const heights = () => {
          const k = Math.min(1, (now() - start) / SCAN_MS);
          const h = lift + (g.top - lift) * (1 - (1 - k) ** 3);
          return [h, h];
        };
        const animating = now() - start < SCAN_MS;
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
              color: Cesium.Color.WHITE.withAlpha(0.92),
            }),
            outline: false,
          },
        });
        holo._cityKey = key;
        holo._cityAlternative = a.id;
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
      holos.get(plotId).show = tier !== 'district';
    }
  }

  function render() {
    ds.show = state.active;
    drawHover();
    drawSelection();
    drawConcepts();
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
      },
      actions: wheelActions({
        pending: data.pending || framing,
        full: data.full,
      }),
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
      pins:
        state.tier === 'district'
          ? districtPins(alternatives, state.built)
          : [],
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
      tag: null,
      holo: null,
      callouts: {},
      pins: {},
    };
    if (plot) {
      const base = baseHeight(plot);
      anchors.plot = project(plot.center.lon, plot.center.lat, base);
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
      for (const pin of districtPins(data.alternatives ?? [], state.built)) {
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
  function onClick({ position }) {
    if (framing) return;
    const point = pickPoint(position);
    const plot = point && snapPlot(point);
    if (!plot) {
      dispatch({ type: 'clear' });
      return;
    }
    baseHeight(plot, point.height);
    notice = null;
    dispatch({ type: 'select', plot });
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
    return new Promise((resolve) => {
      camera.cancelFlight?.();
      camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(plot.center.lon, plot.center.lat, base),
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
  function settled(timeoutMs = 6000) {
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
    if (id && state.plot?.id === plot.id) dispatch({ type: 'focus', id });
    else sync();
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
      await builder.reroll(id);
      if (state.active) dispatch({ type: 'focus', id });
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
        anchors: lastAnchors ? JSON.parse(lastAnchors) : null,
        bodyClass: doc.body.classList.contains(BODY_CLASS),
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
