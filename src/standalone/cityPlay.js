import { watch } from 'vue';
import { t } from '../i18n/index.js';
import {
  claimPointer,
  isLeaseCurrent,
  releasePointer,
} from '../data/inputOwnership.js';
import {
  neighborPlots,
  plotBlock,
  plotPoint,
  snapPlot,
} from '../data/cityPlot.js';
import { groundPoint, resolveClickedPlot } from '../data/cityPlotPick.js';
import { observerSolarPosition } from '../data/satellitePass.js';
import { CITY_LAND_USES, MAX_ZONED_PLOTS } from '../data/cityLandUse.js';
import { fromDegrees, toLonLatH } from '../geo/ellipsoid.js';
import { sphereFromPoints } from '../geo/sphere.js';
import { distance, dot, sub, toRadians } from '../geo/vector.js';
import { inputFor } from '../input/dispatcher.js';
import { heightsOf } from '../queries/heights.js';
import {
  canvasOf,
  findCamera,
  findDraw,
  findFrame,
  findGlobe,
  findInput,
  findQuery,
} from '../render/rendererOf.js';
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
  plotLane,
  resourceStats,
  resumeAlternative,
  wheelActions,
  zoneLegend,
  zoomTier,
} from '../ui/cityPlayModel.js';
import { createCityDrawGroup, cssAlpha } from './cityDrawGroup.js';

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
const ACCENT = '#2ec8e8';
const KIND_COLORS = {
  park: '#5ee08a',
  plaza: '#ffc25c',
  'bike-lane': ACCENT,
};
// Proposed land-use tints reuse GEV's existing palette.
const ZONE_COLORS = {
  housing: '#ffc25c',
  'mixed-use': '#ff5c6e',
  civic: ACCENT,
  'open-space': '#5ee08a',
};
// What clamped items drape on: the globe and the 3D tiles both.
const CLAMP = { height: 'clampGround', clampTo: 'both' };
const FRAMES = {
  oblique: { pitch: -34, range: 290 },
  detail: { pitch: -30, range: 225 },
  // A district fills the view: its range is this many times its radius.
  district: { pitch: -32, fit: 4 },
};
// The draw set the standing concepts are drawn in: a pick on one names its plot.
const CONCEPTS = `${OWNER}-concepts`;

/** A plot's corners as a polygon ring (unclosed), on the ground or at `height`. */
const corners = (plot, height) =>
  plot.corners.map(([lon, lat]) =>
    height === undefined ? { lon, lat } : { lon, lat, height },
  );
/** A plot's outline, closed, in ECEF, on the ellipsoid or at `height`. */
const ring = (plot, height = 0) =>
  [...plot.corners, plot.corners[0]].map(([lon, lat]) =>
    fromDegrees(lon, lat, height),
  );
/** A clamped polygon over a plot (or any corner list). */
const drape = (id, cornerList, fill, extra = {}) => ({
  id,
  geometry: {
    kind: 'polygon',
    rings: [cornerList.map(([lon, lat]) => ({ lon, lat }))],
  },
  fill,
  ...CLAMP,
  ...extra,
});
/** A line draped on the ground. */
const drapedLine = (id, positions, widthPx, style, extra = {}) => ({
  id,
  positions,
  widthPx,
  mode: 'draped',
  clampTo: 'both',
  style,
  ...extra,
});
const solid = (color) => ({ kind: 'solid', color });
const glow = (color, power) => ({ kind: 'glow', color, power });
/** A wall up a closed ring of a plot from `base` to `top`, lit. */
const wall = (id, plot, base, top, fill) => ({
  id,
  geometry: {
    kind: 'wall',
    positions: [...plot.corners, plot.corners[0]].map(([lon, lat]) => ({
      lon,
      lat,
      height: base,
    })),
    minimumHeights: Array(5).fill(base),
    maximumHeights: Array(5).fill(top),
  },
  fill,
  height: 'absolute',
  lit: true,
});

/**
 * Own City builder play mode on the globe: plot picking, the in-world
 * footprint and concept holograms, camera framing, and screen anchors for the
 * overlay. The builder still owns the document; this module only calls its
 * explicit reimagine/reroll/setZone/open controls. It reaches the globe only
 * through the renderer's ports (`src/render/rendererOf.js`): `host` is the
 * scene object the application holds.
 */
export function mountCityPlay({
  host,
  builder,
  store,
  // The selected map's public citation name, or null while none is established.
  mapSource = () => null,
  doc = globalThis.document,
  win = globalThis.window,
  now = () => performance.now(),
}) {
  const draw = findDraw(host);
  const camera = findCamera(host);
  const query = findQuery(host);
  const frameport = findFrame(host);
  const input = findInput(host);
  if (!draw || !camera || !query || !frameport || !input || !doc)
    return { receive() {}, destroy() {} };
  const globe = findGlobe(host);
  const heights = heightsOf(host);
  let state = createPlayState();
  let data = {
    alternatives: null,
    zoning: [],
    pending: false,
    pendingId: null,
  };
  let walkCache = { list: undefined, map: {} };
  let lease = null;
  let offInput = [];
  let stockClicks = null;
  let removeRender = null;
  let removeScan = null;
  let framing = false;
  let notice = null;
  let disposed = false;
  let lastAnchors = '';
  let hoverQueued = null;
  let range = Number.NaN;
  let resumed = false;
  // While Reimagine captures and generates, the map shows the plot as it is.
  let capturing = false;
  // Framed for a capture: the grid, the hover and the concepts step aside.
  let cleared = false;
  const baseHeights = new Map();
  const picked = new Set();
  const appeared = new Map();
  // Each standing concept by plot: what it shows and how it stands.
  const holos = new Map();
  // Each concept's kind tint and district beacon, by plot.
  const tints = new Map();
  const zoneTints = new Map();
  // Decoded concept images, by URL, so a card drawn again draws at once.
  const images = new Map();
  const groups = {
    hover: createCityDrawGroup(draw, 'shapes', `${OWNER}-hover`),
    hoverLines: createCityDrawGroup(draw, 'lines', `${OWNER}-hover-lines`),
    grid: createCityDrawGroup(draw, 'lines', `${OWNER}-grid`),
    select: createCityDrawGroup(draw, 'shapes', `${OWNER}-select`),
    selectLines: createCityDrawGroup(draw, 'lines', `${OWNER}-select-lines`),
    marks: createCityDrawGroup(draw, 'shapes', `${OWNER}-marks`),
    concepts: createCityDrawGroup(draw, 'shapes', CONCEPTS),
    zones: createCityDrawGroup(draw, 'shapes', `${OWNER}-zones`),
    zoneLines: createCityDrawGroup(draw, 'lines', `${OWNER}-zone-lines`),
  };

  const requestRender = () => frameport.requestRender(OWNER);
  const globeShown = () => globe?.isGlobeVisible?.() === true;

  function baseHeight(plot, pickedHeight) {
    // The first pick on a plot fixes its ground; later picks may hit our own holo.
    if (Number.isFinite(pickedHeight) && !baseHeights.has(plot.id)) {
      baseHeights.set(plot.id, pickedHeight);
      picked.add(plot.id);
    }
    if (baseHeights.has(plot.id)) return baseHeights.get(plot.id);
    // The drawn surface, which sees through every draw set (our own holo
    // stands across the plot centre), else the loaded terrain; until tiles
    // are ready the ellipsoid stands in.
    const at = { lon: plot.center.lon, lat: plot.center.lat };
    const h = heights.now(at) ?? heights.now(at, { against: 'terrain' }) ?? 0;
    baseHeights.set(plot.id, h);
    return h;
  }

  function drawHover() {
    const plot = state.hover;
    const shown = plot && plot.id !== state.plot?.id && !cleared;
    groups.hover.put(
      shown
        ? [drape(`${OWNER}-hover`, plot.corners, cssAlpha(ACCENT, 0.12))]
        : [],
    );
    groups.hoverLines.put(
      shown
        ? [
            drapedLine(
              `${OWNER}-hover-edge`,
              ring(plot),
              2,
              solid(cssAlpha(ACCENT, 0.7)),
            ),
          ]
        : [],
    );
  }

  function drawSelection() {
    const plot = state.plot;
    if (!plot) {
      groups.grid.put([]);
      groups.select.put([]);
      groups.selectLines.put([]);
      return;
    }
    const base = baseHeight(plot);
    // Choosing shows the prism and neighbour grid; once a concept stands on the
    // plot only its outline and projector edges remain, so the concept leads.
    const district = state.district;
    // A massing block (behind ?massing=1) leads like a concept does.
    const choosing =
      !district &&
      (state.wheel || !shownByPlot().has(plot.id)) &&
      !store.massing?.on;
    // A district outlines its own plots in place of the neighbour grid.
    const cells = cleared
      ? []
      : (district ?? (choosing && !capturing ? neighborPlots(plot, 1) : []));
    groups.grid.put(
      cells.map((cell) =>
        drapedLine(
          `${OWNER}-grid-${cell.id}`,
          ring(cell),
          district ? 3 : 2,
          solid(cssAlpha(ACCENT, district ? 0.8 : 0.36)),
        ),
      ),
    );
    const shapes = [
      drape(
        `${OWNER}-footprint`,
        plot.corners,
        cssAlpha(ACCENT, choosing ? 0.28 : 0.14),
      ),
    ];
    const lines = [
      drapedLine(`${OWNER}-footprint-edge`, ring(plot), 9, glow(ACCENT, 0.3)),
    ];
    if (choosing) {
      shapes.push(
        wall(
          `${OWNER}-prism`,
          plot,
          base,
          base + BOX_HEIGHT,
          cssAlpha(ACCENT, 0.22),
        ),
      );
      lines.push({
        id: `${OWNER}-prism-top`,
        positions: ring(plot, base + BOX_HEIGHT),
        widthPx: 6,
        mode: 'geodesic',
        style: glow(ACCENT, 0.25),
      });
      plot.corners.forEach(([lon, lat], i) =>
        lines.push({
          id: `${OWNER}-prism-post-${i}`,
          positions: [
            fromDegrees(lon, lat, base),
            fromDegrees(lon, lat, base + BOX_HEIGHT),
          ],
          widthPx: 4,
          mode: '3d',
          style: glow(ACCENT, 0.3),
        }),
      );
    }
    groups.select.put(shapes);
    groups.selectLines.put(lines);
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
    const heading = toRadians(
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
    const face = ((heading * 180) / Math.PI + 540) % 360;
    return { base, lift, top: lift + HOLO_HEIGHT, a0, a1, face };
  }

  // The sun of the scene clock, the same time the renderer lights the globe with.
  function sunAt(plot) {
    try {
      return observerSolarPosition(
        plot.center.lat,
        plot.center.lon,
        frameport.time(),
      );
    } catch {
      return null;
    }
  }

  /**
   * A concept image as the card draws it: decoded once into a canvas, so a
   * card drawn again (each frame while it rises) draws at once; its URL
   * until then.
   */
  function cardImage(url) {
    const known = images.get(url);
    if (known?.canvas) return { canvas: known.canvas, key: url };
    if (!known && typeof win?.Image === 'function') {
      const entry = { canvas: null };
      images.set(url, entry);
      const img = new win.Image();
      img.onload = () => {
        if (disposed) return;
        const canvas = doc.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        entry.canvas = canvas;
        drawConcepts();
        requestRender();
      };
      img.src = url;
    }
    return url;
  }

  // The card's top while it rises: eased in over SCAN_MS from its foot.
  function holoTop(holo) {
    const k = Math.min(1, (now() - holo.start) / SCAN_MS);
    if (k >= 1) return holo.g.top;
    return holo.g.lift + (holo.g.top - holo.g.lift) * (1 - (1 - k) ** 3);
  }

  function drawConcepts() {
    const shown = state.active ? shownByPlot() : new Map();
    const tier = state.tier;
    for (const [plotId, holo] of holos) {
      const a = shown.get(plotId);
      if (!a || holo.key !== `${a.id}:${a.revision}`) holos.delete(plotId);
    }
    for (const [plotId, tint] of tints)
      if (!shown.has(plotId) || tint.kind !== shown.get(plotId).parameters.kind)
        tints.delete(plotId);
    for (const [plotId, a] of shown) {
      const key = `${a.id}:${a.revision}`;
      if (!tints.has(plotId))
        // A tall kind-coloured beacon makes a 40 m plot readable from the
        // district view.
        tints.set(plotId, {
          kind: a.parameters.kind,
          plot: a.site.plot,
          base: baseHeight(a.site.plot),
        });
      if (!holos.has(plotId)) {
        const g = holoGeometry(a);
        if (!appeared.has(key)) appeared.set(key, now());
        const start = appeared.get(key);
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
        const holo = {
          key,
          g,
          start,
          plot: a.site.plot,
          alternative: a.id,
          image: a.concept.image,
          // Contact band and cast shadow drape on tiles and terrain.
          shadows: [
            ['contact', ground.contact, 0.62],
            ['cast', ground.cast, 0.4],
          ].filter(([, cornerList]) => cornerList),
          shade: ground.shade,
          ground: {
            sun,
            baseGapMeters: g.lift - g.base,
            shadowMeters: ground.lengthMeters,
            shade: ground.shade,
            contact: Boolean(ground.contact),
            cast: Boolean(ground.cast),
          },
        };
        holos.set(plotId, holo);
        if (animating) scan(holo, plotId);
      }
      const holo = holos.get(plotId);
      holo.show = tier !== 'district' && !capturing && !cleared;
    }
    const marks = [];
    for (const [plotId, tint] of tints) {
      marks.push(
        drape(
          `${OWNER}-tint-${plotId}`,
          tint.plot.corners,
          cssAlpha(KIND_COLORS[tint.kind], 0.34),
          // A proposed land use takes the plot's ground tint; the beacon stays.
          { show: !useOf(plotId) && !capturing },
        ),
        {
          ...wall(
            `${OWNER}-beacon-${plotId}`,
            tint.plot,
            tint.base,
            tint.base + BEACON_HEIGHT,
            cssAlpha(KIND_COLORS[tint.kind], 0.42),
          ),
          show: tier === 'district',
        },
      );
    }
    for (const [plotId, holo] of holos)
      for (const [part, cornerList, alpha] of holo.shadows)
        marks.push(
          drape(
            `${OWNER}-shadow-${part}-${plotId}`,
            cornerList,
            `rgba(0,0,0,${alpha})`,
            { show: holo.show },
          ),
        );
    groups.marks.put(marks);
    drawHolos();
  }

  // The concept cards, each at its height now: one rising is drawn again
  // every frame until it stands.
  function drawHolos() {
    groups.concepts.put(
      [...holos.values()].map((holo) => {
        const { a0, a1, lift } = holo.g;
        const top = holoTop(holo);
        return {
          id: `${OWNER}-concept-${holo.alternative}`,
          geometry: {
            kind: 'wall',
            positions: [
              { lon: a0[0], lat: a0[1], height: lift },
              { lon: a1[0], lat: a1[1], height: lift },
            ],
            minimumHeights: [lift, lift],
            maximumHeights: [top, top],
          },
          fill: {
            image: cardImage(holo.image),
            // The renderer lights walls from the eye; shade the face by the
            // sun instead.
            color: [holo.shade, holo.shade, holo.shade, 0.94],
          },
          outline: ACCENT,
          height: 'absolute',
          lit: true,
          show: holo.show,
          meta: { plot: holo.plot },
        };
      }),
    );
  }

  // Frames keep coming while a card rises; it then stands at its top.
  function scan(holo, plotId) {
    holdContinuousRender(OWNER);
    removeScan ??= frameport.on('preRender', () => {
      if ([...holos.values()].some((h) => now() - h.start < SCAN_MS + 50))
        drawHolos();
    });
    setTimeout(() => {
      if (disposed) return;
      if (holos.get(plotId) === holo) drawHolos();
      if (![...appeared.values()].some((s) => now() - s < SCAN_MS)) {
        removeScan?.();
        removeScan = null;
        releaseContinuousRender(OWNER);
      }
      requestRender();
    }, SCAN_MS + 50);
  }

  const zoning = () => data.zoning ?? [];
  const useOf = (plotId) =>
    zoning().find((z) => z.plot.id === plotId)?.use ?? null;

  // Each zoned plot drapes its proposed land-use tint and edge on the map.
  function drawZones() {
    const wanted = new Map(
      (state.active ? zoning() : []).map((z) => [z.plot.id, z]),
    );
    for (const [plotId, use] of zoneTints)
      if (wanted.get(plotId)?.use !== use) zoneTints.delete(plotId);
    for (const [plotId, z] of wanted)
      if (!zoneTints.has(plotId)) zoneTints.set(plotId, z.use);
    const tintsNow = [];
    const edges = [];
    for (const [plotId, use] of zoneTints) {
      const z = wanted.get(plotId);
      const color = ZONE_COLORS[use];
      tintsNow.push(
        drape(
          `${OWNER}-zone-${plotId}`,
          z.plot.corners,
          cssAlpha(color, 0.42),
          {
            show: !capturing,
          },
        ),
      );
      edges.push(
        drapedLine(
          `${OWNER}-zone-edge-${plotId}`,
          ring(z.plot),
          3,
          solid(cssAlpha(color, 0.9)),
          { show: !capturing },
        ),
      );
    }
    groups.zones.put(tintsNow);
    groups.zoneLines.put(edges);
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
            .map((r) => [r.id, r.meanMeters]),
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
    for (const group of Object.values(groups)) group.show(state.active);
    drawHover();
    drawSelection();
    drawConcepts();
    drawZones();
    requestRender();
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
    const source = plot && mapSource();
    store.publish({
      active: state.active,
      tier: state.tier,
      wheelOpen: state.wheel,
      pending: data.pending || framing,
      framing,
      provider: data.provider,
      error: notice ? t(notice) : data.error,
      status: data.status,
      stats: resourceStats(data.alternatives, {
        walk: walkByAlternative(),
        focusId: focused?.id,
      }),
      plot: plot && {
        id: plot.id,
        code: plotCode(plot),
        area: plot.areaSquareMeters,
        size: plot.sizeMeters,
        use: useOf(plot.id),
        source,
        lane: plotLane({
          concept: shownByPlot().has(plot.id),
          use: useOf(plot.id),
          source,
        }),
      },
      // The plots of the selected district; the selected plot is its anchor.
      district: state.district?.map((cell) => cell.id) ?? null,
      actions: wheelActions({
        pending: data.pending || framing,
        full: data.full,
        zoneMenu: state.zoneMenu,
        use: plot && useOf(plot.id),
        zoneFull:
          zoning().length >= MAX_ZONED_PLOTS && !(plot && useOf(plot.id)),
      }),
      legend:
        state.zoneMenu || (state.tier === 'district' && zoning().length)
          ? zoneLegend(zoning())
          : null,
      cards: carouselCards(alternatives, plot?.id, {
        builtId: plot ? state.built[plot.id] : null,
        focusId: focused?.id,
        pendingId: data.pendingId,
        zoning: zoning(),
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
      requestRender();
    } else sync();
  }

  // --- per-frame anchors -------------------------------------------------
  // A point on screen in page pixels, or null: behind the eye, past the
  // horizon, or well off the canvas.
  function project(lon, lat, height, eye, rect) {
    const world = fromDegrees(lon, lat, height);
    if (dot(sub(world, eye.position), eye.direction) <= 0) return null;
    if (query.isOccluded(world)) return null;
    const p = query.project(world);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const x = Math.round(p.x + rect.left);
    const y = Math.round(p.y + rect.top);
    const pad = 40;
    if (x < -pad || y < -pad || x > rect.right + pad || y > rect.bottom + pad)
      return null;
    return { x, y };
  }
  function frame() {
    if (!state.active || disposed) return;
    const eye = camera.pose();
    const rect = canvasOf(host)?.getBoundingClientRect();
    if (!rect) return;
    const plot = state.plot;
    if (plot) {
      const base = baseHeight(plot);
      range = distance(
        eye.position,
        fromDegrees(plot.center.lon, plot.center.lat, base),
      );
    } else {
      const ground = globeShown()
        ? (heights.now(
            { lon: eye.lon, lat: eye.lat },
            { against: 'terrain' },
          ) ?? 0)
        : 0;
      range = eye.height - ground;
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
      anchors.plot = project(plot.center.lon, plot.center.lat, base, eye, rect);
      anchors.footprint = plot.corners.map(([lon, lat]) =>
        project(lon, lat, base, eye, rect),
      );
      const [lon, lat] = plot.corners[2];
      anchors.tag = project(lon, lat, base + BOX_HEIGHT, eye, rect);
      const a = shownByPlot().get(plot.id);
      if (a) {
        const g = holoGeometry(a);
        anchors.holo = project(
          plot.center.lon,
          plot.center.lat,
          g.top,
          eye,
          rect,
        );
      }
      if (state.tier === 'detail') {
        for (const c of detailCallouts(selectedAlternative())) {
          const p = plotPoint(plot, c.fx, c.fy);
          anchors.callouts[c.id] = project(p.lon, p.lat, base + 2, eye, rect);
        }
      }
    }
    if (state.tier === 'district') {
      for (const pin of pinsNow()) {
        const h = baseHeight({ id: pin.plotId, center: pin.center });
        anchors.pins[pin.plotId] = project(
          pin.center.lon,
          pin.center.lat,
          h,
          eye,
          rect,
        );
      }
    }
    const key = JSON.stringify(anchors);
    if (key !== lastAnchors) {
      lastAnchors = key;
      store.place(anchors);
    }
  }

  // --- input ---------------------------------------------------------------
  // The ground under the cursor, as the click resolver reads it.
  const pickPoint = (position) => groundPoint(query, globeShown(), position);
  // A standing concept card's plot, from a pick of play mode's own.
  const plotOf = (hit) =>
    hit.set === CONCEPTS ? (hit.meta?.plot ?? null) : null;
  function onClick({ position }, extend = false) {
    if (framing) return;
    // An armed massing tool (the protected edge) takes the next ground click.
    if (store.massingControls?.click?.(pickPoint(position))) return;
    // Shift-click a second plot: the block between it and the selected plot
    // becomes a district, framed whole.
    if (extend && state.plot) {
      const point = pickPoint(position);
      const block = plotBlock(state.plot, point && snapPlot(point));
      if (block) {
        dispatch({ type: 'district', plots: block });
        frameDistrict(block);
      }
      return;
    }
    const hit = resolveClickedPlot({
      query,
      globeShown: globeShown(),
      position,
      plotOf,
    });
    if (!hit) {
      dispatch({ type: 'clear' });
      return;
    }
    const { plot } = hit;
    // Clicking a concept card selects that plot again.
    if (hit.height === undefined) {
      dispatch({ type: 'select', plot });
      return;
    }
    baseHeight(plot, hit.height);
    notice = null;
    // From far away (district, or well beyond plot framing) the click swoops in.
    const far =
      state.tier === 'district' ||
      (!state.plot && range > FRAMES.oblique.range * 1.6);
    dispatch({ type: 'select', plot });
    if (far) void fly(plot, 'oblique');
  }
  function onMove({ endPosition }) {
    hoverQueued = endPosition;
    win.requestAnimationFrame?.(() => {
      if (!hoverQueued || !state.active) return;
      const world = query.pickEllipsoid(hoverQueued.x, hoverQueued.y);
      hoverQueued = null;
      const at = world && toLonLatH(world);
      if (!at) return dispatch({ type: 'hover', plot: null });
      const plot = snapPlot({ lat: at.lat, lon: at.lon });
      if (plot?.id !== state.hover?.id) dispatch({ type: 'hover', plot });
    });
  }
  // Left clicks and moves as the mode always took them: a click alone or
  // with Shift (which extends to a district), a move with no modifier held.
  // While its lease is out no ambient layer selects under them.
  function onPointer(ev) {
    if (!isLeaseCurrent(lease)) return;
    const { shift, ctrl, alt } = ev.modifiers ?? {};
    if (ctrl || alt) return;
    if (ev.type === 'move') {
      if (!shift) onMove({ endPosition: ev.endPosition ?? ev.position });
      return;
    }
    if (ev.button !== 0) return;
    onClick({ position: ev.position }, Boolean(shift));
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
    const heading = camera.pose().heading;
    const lead =
      (canvasOf(host)?.clientWidth ?? 0) < 600 ? NARROW_LEAD[kind] : 0;
    // Aim at a point between the camera and the plot, which lifts the plot on screen.
    const metersLon = 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
    const aimLat = plot.center.lat - (Math.cos(heading) * lead) / 111_320;
    const aimLon = plot.center.lon - (Math.sin(heading) * lead) / metersLon;
    return new Promise((resolve) => {
      camera.cancelFlight();
      camera.flyToBounds(
        { center: fromDegrees(aimLon, aimLat, base), radius: plot.sizeMeters },
        {
          offset: {
            heading,
            pitch: toRadians(frameOf.pitch),
            range: frameOf.range,
          },
          durationS: 1.4,
          easing: 'cubicInOut',
          onComplete: () => resolve(true),
          onCancel: () => resolve(false),
        },
      );
    });
  }
  function frameDistrict(plots) {
    const base = baseHeight(plots[0]);
    const sphere = sphereFromPoints(
      plots.flatMap((cell) => ring(cell, base).slice(0, 4)),
    );
    camera.cancelFlight();
    camera.flyToBounds(sphere, {
      offset: {
        heading: camera.pose().heading,
        pitch: toRadians(FRAMES.district.pitch),
        range: sphere.radius * FRAMES.district.fit,
      },
      durationS: 1.4,
      easing: 'cubicInOut',
    });
  }
  // Give the map a bounded moment to load the framed tiles before capture.
  function settled(timeoutMs = 15000) {
    const started = now();
    return new Promise((resolve) => {
      const check = () => {
        const ready =
          !globe || (globe.isSettled('tiles') && globe.isSettled('terrain'));
        if (ready || now() - started > timeoutMs) resolve();
        else {
          requestRender();
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
      cleared = true;
      drawHover();
      drawSelection();
      drawConcepts();
      requestRender();
    } finally {
      framing = false;
      cleared = false;
    }
    if (disposed || !state.active || state.plot !== plot) return sync();
    // builder.reimagine publishes before it captures: keep the old concept,
    // its shadows and tints off the map until the new concept lands.
    capturing = true;
    let id = null;
    try {
      id = await builder.reimagine({ plot, kind });
    } finally {
      capturing = false;
    }
    // The concept takes the stage; clicking the plot brings the wheel back.
    if (id && state.plot?.id === plot.id) dispatch({ type: 'landed', id });
    else sync();
  }

  // A sampled (not picked) ground is re-measured once the framed tiles load,
  // so a restored concept stands on the surface instead of a coarse tile.
  function reground(plot) {
    if (disposed || !state.active || picked.has(plot.id)) return;
    const before = baseHeights.get(plot.id);
    baseHeights.delete(plot.id);
    if (Math.abs(baseHeight(plot) - before) < 0.5) return;
    holos.delete(plot.id);
    tints.delete(plot.id);
    sync();
  }

  // The first entry after a page load frames the latest restored concept.
  function resume() {
    if (resumed) return;
    resumed = true;
    const eye = camera.pose();
    const a = resumeAlternative(
      data.alternatives,
      eye && { lat: eye.lat, lon: eye.lon, height: eye.height },
    );
    if (!a) return;
    const plot = a.site.plot;
    dispatch({ type: 'resume', plot, id: a.id });
    if (state.plot !== plot) return;
    void fly(plot, 'oblique').then(
      (landed) => landed && settled(8000).then(() => reground(plot)),
    );
  }

  const controls = {
    toggle() {
      if (state.active) controls.exit();
      else controls.enter();
    },
    enter() {
      if (disposed || state.active) return;
      // The newest claim takes over: a newer tool taking the pointer turns
      // City builder off as if the person had.
      const claimed = claimPointer(OWNER, {
        onLost: () => {
          if (lease === claimed) controls.exit();
        },
      });
      if (!claimed) return;
      lease = claimed;
      notice = null;
      offInput = [input.on('click', onPointer), input.on('move', onPointer)];
      // Hold the renderer's own select and follow clicks off for the
      // mode's lifetime.
      stockClicks = inputFor(host).suppressStockClicks();
      doc.addEventListener('keydown', onKey, true);
      removeRender = frameport.on('postRender', frame);
      doc.body.classList.add(BODY_CLASS);
      dispatch({ type: 'enter' });
      frame();
      resume();
    },
    exit() {
      if (!state.active) return;
      for (const off of offInput.splice(0)) off();
      stockClicks?.();
      stockClicks = null;
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
      const plotId = state.plot?.id;
      const landed = await builder.reroll(id);
      // Only the plot that was rerolled hands the stage to its new concept.
      if (state.active && state.plot?.id === plotId)
        dispatch({ type: landed ? 'landed' : 'focus', id });
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
        // What the draw sets hold, as the renderer was handed it.
        footprint:
          groups.select.has(`${OWNER}-footprint`) && groups.select.shown(),
        concepts: groups.concepts.shown()
          ? groups.concepts
              .items()
              .filter((item) => item.show !== false)
              .map((item) => item.id.slice(`${OWNER}-concept-`.length))
          : [],
        grounding: Object.fromEntries(
          [...holos.values()].map((h) => [h.alternative, h.ground]),
        ),
        // The selection prism's walls drawn now.
        prism: groups.select
          .items()
          .filter((item) => item.geometry.kind === 'wall').length,
        anchors: lastAnchors ? JSON.parse(lastAnchors) : null,
        bodyClass: doc.body.classList.contains(BODY_CLASS),
        zoning: zoning().map((z) => ({ plotId: z.plot.id, use: z.use })),
        zoneTints: groups.zones.shown() ? groups.zones.items().length : 0,
        district: state.district?.map((cell) => cell.id) ?? null,
      }),
    /**
     * The map's surface at a point as the renderer's height queries see it,
     * through every draw set (play mode's and massing's own), else the
     * loaded terrain where the globe shows; null where nothing is loaded.
     */
    surfaceAt(lon, lat) {
      const at = { lon, lat };
      return (
        heights.now(at) ??
        (globeShown() ? heights.now(at, { against: 'terrain' }) : null)
      );
    },
  });
  if (win) win.__gevCityPlay = probe;
  store.connect(controls);
  present();
  // The selection prism steps aside while a massing block stands.
  const stopMassing = watch(
    () => Boolean(store.massing?.on),
    () => render(),
  );

  return {
    receive(next) {
      data = next ?? data;
      if (disposed) return;
      sync();
    },
    destroy() {
      if (disposed) return;
      controls.exit();
      stopMassing();
      disposed = true;
      removeScan?.();
      removeScan = null;
      if (win?.__gevCityPlay === probe) delete win.__gevCityPlay;
      for (const group of Object.values(groups)) group.dispose();
      if (store.controls === controls) {
        store.connect(null);
        store.publish(null);
        store.place(null);
      }
    },
  };
}
