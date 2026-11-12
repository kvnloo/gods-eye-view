// Pure view-model for City builder play mode. No Cesium, DOM or i18n here:
// the globe adapter supplies ranges and screen points, the view supplies text.
import { CITY_LAND_USES } from '../data/cityLandUse.js';

export const ZOOM_TIERS = Object.freeze({ near: 260, far: 1500 });
const HYSTERESIS = 0.15;
const KINDS = ['park', 'plaza', 'bike-lane'];
export const KIND_ICONS = Object.freeze({
  park: 'park',
  plaza: 'deck',
  'bike-lane': 'pedal_bike',
});
export const LAND_USE_ICONS = Object.freeze({
  housing: 'location_city',
  'mixed-use': 'layers',
  civic: 'public',
  'open-space': 'eco',
});

/** District (far), plot (mid) or detail (near) from the camera range in metres. */
export function zoomTier(range, previous = null) {
  if (!Number.isFinite(range) || range < 0) return previous ?? 'plot';
  const { near, far } = ZOOM_TIERS;
  const farEdge = previous === 'district' ? far * (1 - HYSTERESIS) : far;
  const nearEdge = previous === 'detail' ? near * (1 + HYSTERESIS) : near;
  if (range >= farEdge) return 'district';
  if (range <= nearEdge) return 'detail';
  return 'plot';
}

/** A short stable label for a grid cell (hemisphere, row and column digits). */
export function plotCode(plot) {
  const pad = (n) => String(Math.abs(n) % 10000).padStart(4, '0');
  return `${plot.row < 0 ? 'S' : 'N'}${pad(plot.row)}-${pad(plot.col)}`;
}

/** Button offsets around the wheel centre, clockwise from twelve o'clock. */
export function wheelLayout(count, radius) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((-90 + (i * 360) / count) * Math.PI) / 180;
    return {
      x: Math.round(radius * Math.cos(angle)) || 0,
      y: Math.round(radius * Math.sin(angle)) || 0,
    };
  });
}

export function wheelSize(viewport) {
  // Buttons fit a 12 px caps label.
  return viewport.width < 600
    ? { radius: 116, button: 80 }
    : { radius: 150, button: 96 };
}

/** The screen square the placed wheel's buttons can cover, or null. */
export function wheelBounds(center, size) {
  if (!center) return null;
  const reach = size.radius + size.button / 2;
  return {
    left: center.x - reach,
    top: center.y - reach,
    right: center.x + reach,
    bottom: center.y + reach,
  };
}

/** Clamp the wheel centre so every button stays inside the free viewport. */
export function placeWheel(anchor, viewport, size, inset) {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
    return null;
  const reach = size.radius + size.button / 2;
  const clamp = (value, low, high) =>
    high < low ? (low + high) / 2 : Math.min(high, Math.max(low, value));
  const x = clamp(
    anchor.x,
    (inset.left ?? inset.side) + reach,
    viewport.width - (inset.right ?? inset.side) - reach,
  );
  const y = clamp(
    anchor.y,
    inset.top + reach,
    viewport.height - inset.bottom - reach,
  );
  return { x, y, clamped: x !== anchor.x || y !== anchor.y };
}

/**
 * The wheel offers the existing proposal kinds only, plus Reimagine, Zone and
 * Inspect. Zone swaps in the land-use menu (`use` is the plot's current one).
 */
export function wheelActions({
  pending = false,
  full = false,
  zoneMenu = false,
  use = null,
  zoneFull = false,
} = {}) {
  if (zoneMenu)
    return [
      ...CITY_LAND_USES.map((id) => ({
        id,
        kind: null,
        icon: LAND_USE_ICONS[id],
        selected: id === use,
        disabled: pending || zoneFull,
      })),
      { id: 'clear-use', kind: null, icon: 'close', disabled: pending || !use },
      { id: 'back', kind: null, icon: 'arrow_left', disabled: false },
    ];
  const locked = pending || full;
  return [
    { id: 'reimagine', kind: null, icon: 'auto_awesome', disabled: locked },
    ...KINDS.map((kind) => ({
      id: kind,
      kind,
      icon: KIND_ICONS[kind],
      disabled: locked,
    })),
    { id: 'zone', kind: null, icon: 'category', disabled: pending },
    { id: 'inspect', kind: null, icon: 'search', disabled: false },
  ];
}

/**
 * Proposed land-use legend: plots, area and share of zoned area per use, all
 * derived from the zoned 40 m plots. Nothing zoned: shares are unknown (null).
 */
export function zoneLegend(zoning) {
  const total = zoning.reduce((sum, z) => sum + z.plot.areaSquareMeters, 0);
  return {
    plots: zoning.length,
    areaSquareMeters: total,
    rows: CITY_LAND_USES.map((use) => {
      const plots = zoning.filter((z) => z.use === use);
      const area = plots.reduce((sum, z) => sum + z.plot.areaSquareMeters, 0);
      return {
        use,
        plots: plots.length,
        areaSquareMeters: area,
        sharePercent: total ? Math.round((100 * area) / total) : null,
      };
    }),
  };
}

/** Reimagine picks the first kind this plot has not tried, then cycles. */
export function nextKind(tried) {
  return (
    KINDS.find((kind) => !tried.includes(kind)) ??
    KINDS[tried.length % KINDS.length]
  );
}

function chips(parameters) {
  return [
    { id: 'trees', value: parameters.trees, unit: '' },
    { id: 'shade', value: parameters.shadePercent, unit: '%' },
    { id: 'width', value: parameters.widthMeters, unit: 'm' },
  ];
}

export function plotAlternatives(alternatives, plotId) {
  return plotId ? alternatives.filter((a) => a.site?.plot.id === plotId) : [];
}

/** One card per alternative of the selected plot. */
export function carouselCards(
  alternatives,
  plotId,
  { builtId = null, focusId = null, pendingId = null, access = null } = {},
) {
  return plotAlternatives(alternatives, plotId).map((a) => {
    const list = chips(a.parameters);
    const delta = access?.[a.id]?.delta;
    if (Number.isFinite(delta))
      list.push({ id: 'walk', value: delta, unit: '' });
    return {
      id: a.id,
      title: a.title,
      kind: a.parameters.kind,
      icon: KIND_ICONS[a.parameters.kind],
      revision: a.revision,
      versionCount: a.versionCount,
      image: a.concept?.image ?? null,
      provider: a.concept?.provider ?? null,
      chips: list,
      built: a.id === builtId,
      focused: a.id === focusId,
      pending: a.id === pendingId,
    };
  });
}

/** Top resource bar. Without a project every value is unknown, never zero. */
export function resourceStats(alternatives) {
  const dash = '—';
  if (!alternatives) {
    return ['plots', 'worlds', 'concepts', 'trees', 'shade', 'walk'].map(
      (id) => ({ id, value: dash }),
    );
  }
  const count = alternatives.length;
  const plots = new Set(
    alternatives.filter((a) => a.site).map((a) => a.site.plot.id),
  );
  const trees = alternatives.reduce((sum, a) => sum + a.parameters.trees, 0);
  const shade =
    alternatives.reduce((sum, a) => sum + a.parameters.shadePercent, 0) /
    (count || 1);
  return [
    { id: 'plots', value: String(plots.size) },
    { id: 'worlds', value: String(count) },
    {
      id: 'concepts',
      value: String(alternatives.filter((a) => a.concept).length),
    },
    { id: 'trees', value: count ? `+${trees}` : dash },
    { id: 'shade', value: count ? `${Math.round(shade)}%` : dash },
    // Walk access belongs to a separate validated module; absent here.
    { id: 'walk', value: dash },
  ];
}

/** Near-tier callouts: the proposal's own parameters at points in the footprint. */
export function detailCallouts(alternative) {
  if (!alternative?.concept) return [];
  const p = alternative.parameters;
  return [
    { id: 'kind', fx: 0.82, fy: 0.78, kind: p.kind },
    { id: 'trees', fx: 0.18, fy: 0.7, value: p.trees, unit: '' },
    { id: 'shade', fx: 0.78, fy: 0.22, value: p.shadePercent, unit: '%' },
    { id: 'width', fx: 0.3, fy: 0.12, value: p.widthMeters, unit: 'm' },
  ];
}

/**
 * Far-tier pins: one per plot with a concept (its kept world) or a land use.
 * `walk` maps alternative ids to the existing walk-access estimate, passed
 * through unchanged; land use never recomputes it.
 */
export function districtPins(
  alternatives,
  built,
  { zoning = [], walk = {} } = {},
) {
  const uses = new Map(zoning.map((z) => [z.plot.id, z.use]));
  const byPlot = new Map();
  for (const a of alternatives) {
    if (!a.site) continue;
    const list = byPlot.get(a.site.plot.id) ?? [];
    list.push(a);
    byPlot.set(a.site.plot.id, list);
  }
  const pins = [];
  for (const [plotId, list] of byPlot) {
    const withConcept = list.filter((a) => a.concept);
    if (!withConcept.length) continue;
    const kept = list.find((a) => a.id === built[plotId]);
    const shown = kept ?? withConcept.at(-1);
    pins.push({
      plotId,
      alternativeId: shown.id,
      center: shown.site.plot.center,
      kind: shown.parameters.kind,
      icon: KIND_ICONS[shown.parameters.kind],
      title: shown.title,
      trees: shown.parameters.trees,
      shade: shown.parameters.shadePercent,
      built: Boolean(kept),
      use: uses.get(plotId) ?? null,
      walk: walk[shown.id] ?? null,
    });
  }
  for (const z of zoning) {
    if (pins.some((p) => p.plotId === z.plot.id)) continue;
    pins.push({
      plotId: z.plot.id,
      alternativeId: null,
      center: z.plot.center,
      kind: null,
      icon: LAND_USE_ICONS[z.use],
      title: null,
      trees: null,
      shade: null,
      built: false,
      use: z.use,
      walk: null,
    });
  }
  return pins;
}

/** Screen rectangle around at least two projected points, or null. */
export function boundsOf(points) {
  const list = (points ?? []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (list.length < 2) return null;
  const xs = list.map((p) => p.x);
  const ys = list.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function overlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Place an info card beside a target rectangle (the plot footprint on screen):
 * right, left, above, then below, taking the first spot inside the viewport
 * that covers neither the target nor a keep-out rectangle (map credits, HUD
 * bars, docks), else the least-overlapping one. The leader joins the card edge
 * facing the plot to the nearest point of the footprint.
 */
export function placeBeside({
  target,
  size,
  viewport,
  keepOut = [],
  gap = 48,
  margin = 12,
}) {
  if (!target) return null;
  const clamp = (v, low, high) =>
    high < low ? low : Math.min(high, Math.max(low, v));
  const cx = (target.left + target.right) / 2;
  const cy = (target.top + target.bottom) / 2;
  const y = clamp(
    cy - size.height / 2,
    margin,
    viewport.height - margin - size.height,
  );
  const x = clamp(
    cx - size.width / 2,
    margin,
    viewport.width - margin - size.width,
  );
  const spots = [
    { side: 'right', x: target.right + gap, y },
    { side: 'left', x: target.left - gap - size.width, y },
    { side: 'above', x, y: target.top - gap - size.height },
    { side: 'below', x, y: target.bottom + gap },
  ];
  const cost = ({ x: left, y: top }) => {
    const r = {
      left,
      top,
      right: left + size.width,
      bottom: top + size.height,
    };
    const outside =
      r.left < margin ||
      r.top < margin ||
      r.right > viewport.width - margin ||
      r.bottom > viewport.height - margin;
    return (
      (outside ? 1e9 : 0) +
      [target, ...keepOut].reduce((sum, k) => sum + overlap(r, k), 0)
    );
  };
  const best = spots.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  const from = {
    right: { x: best.x, y: clamp(cy, best.y, best.y + size.height) },
    left: {
      x: best.x + size.width,
      y: clamp(cy, best.y, best.y + size.height),
    },
    above: {
      x: clamp(cx, best.x, best.x + size.width),
      y: best.y + size.height,
    },
    below: { x: clamp(cx, best.x, best.x + size.width), y: best.y },
  }[best.side];
  return {
    ...best,
    clear: cost(best) === 0,
    leader: {
      from,
      to: {
        x: clamp(from.x, target.left, target.right),
        y: clamp(from.y, target.top, target.bottom),
      },
    },
  };
}

const CONTACT_METERS = 3;
const MAX_SHADOW_RATIO = 2.5;
const AMBIENT_SHADE = 0.62;

/**
 * Ground a concept card standing on its plot: a dark contact band under its
 * base and, while the sun is up, the shadow it casts away from the sun
 * (h / tan(elevation), capped at 2.5 h). `shade` lights the card face from the
 * same sun (ambient plus Lambert on the vertical face). Corners are [lon, lat].
 */
export function groundShadow({
  a0,
  a1,
  heightMeters,
  faceAzimuthDeg,
  sun,
  lat,
}) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const metersLat = 111_320;
  const metersLon = metersLat * Math.cos(rad(lat));
  const move = ([lon, la], east, north) => [
    lon + east / metersLon,
    la + north / metersLat,
  ];
  const fe = Math.sin(rad(faceAzimuthDeg)) * CONTACT_METERS;
  const fn = Math.cos(rad(faceAzimuthDeg)) * CONTACT_METERS;
  const contact = [
    move(a0, fe, fn),
    move(a1, fe, fn),
    move(a1, -fe, -fn),
    move(a0, -fe, -fn),
  ];
  if (!(sun?.elevationDeg > 2))
    return { contact, cast: null, lengthMeters: 0, shade: AMBIENT_SHADE };
  const lengthMeters = Math.min(
    heightMeters / Math.tan(rad(sun.elevationDeg)),
    MAX_SHADOW_RATIO * heightMeters,
  );
  const se = -Math.sin(rad(sun.azimuthDeg)) * lengthMeters;
  const sn = -Math.cos(rad(sun.azimuthDeg)) * lengthMeters;
  const lambert = Math.max(
    0,
    Math.cos(rad(sun.elevationDeg)) *
      Math.cos(rad(sun.azimuthDeg - faceAzimuthDeg)),
  );
  return {
    contact,
    cast: [a0, a1, move(a1, se, sn), move(a0, se, sn)],
    lengthMeters,
    shade: AMBIENT_SHADE + (1 - AMBIENT_SHADE) * lambert,
  };
}

// Play mode resumes a restored plot only near the camera, never across cities.
const RESUME_MIN_METERS = 3000;

/**
 * The restored concept to bring back into view when play mode opens: the most
 * recently generated concept on a plot within reach of the camera, or null.
 */
export function resumeAlternative(alternatives, camera) {
  if (!Number.isFinite(camera?.lat) || !Number.isFinite(camera?.lon))
    return null;
  const reach = Math.max(RESUME_MIN_METERS, 2 * (camera.height || 0));
  let best = null;
  let bestAt = -Infinity;
  for (const a of alternatives ?? []) {
    if (!a.site || !a.concept) continue;
    const { lat, lon } = a.site.plot.center;
    const north = (lat - camera.lat) * 111_320;
    const east =
      (lon - camera.lon) * 111_320 * Math.cos((camera.lat * Math.PI) / 180);
    if (Math.hypot(north, east) > reach) continue;
    const at = Date.parse(a.concept.generatedAt);
    if ((Number.isFinite(at) ? at : -Infinity) >= bestAt) {
      best = a;
      bestAt = Number.isFinite(at) ? at : -Infinity;
    }
  }
  return best;
}

/**
 * District pins hang above their plot (bottom-centre anchor). Adjacent plots
 * collide at district range, so a pin that would cover an earlier one is
 * lifted by whole rows until clear; `lift` is how far, for its tether.
 */
export function stackPins(pins, size = { width: 240, height: 48 }, gap = 6) {
  const placed = [];
  return pins.map((pin) => {
    const half = (pin.width ?? size.width) / 2;
    const box = (bottom) => ({
      left: pin.at.x - half,
      right: pin.at.x + half,
      top: bottom - size.height,
      bottom,
    });
    let top = pin.at.y;
    while (placed.some((r) => overlap(box(top), r))) top -= size.height + gap;
    placed.push(box(top));
    return { ...pin, top, lift: pin.at.y - top };
  });
}

export function createPlayState() {
  return {
    active: false,
    plot: null,
    hover: null,
    tier: 'plot',
    focusId: null,
    built: {},
    wheel: false,
    zoneMenu: false,
  };
}

/** Mode state. Unchanged input returns the same object. */
export function playReducer(state, action) {
  switch (action.type) {
    case 'enter':
      return state.active
        ? state
        : {
            ...state,
            active: true,
            plot: null,
            hover: null,
            focusId: null,
            wheel: false,
            zoneMenu: false,
          };
    case 'exit':
      return {
        ...state,
        active: false,
        plot: null,
        hover: null,
        focusId: null,
        wheel: false,
        zoneMenu: false,
      };
    case 'hover':
      return state.active && state.hover !== action.plot
        ? { ...state, hover: action.plot ?? null }
        : state;
    case 'select':
      if (!state.active) return state;
      return {
        ...state,
        plot: action.plot,
        hover: null,
        focusId: state.plot?.id === action.plot?.id ? state.focusId : null,
        wheel: true,
        zoneMenu: false,
      };
    case 'wheel':
      return state.active && state.wheel !== Boolean(action.open)
        ? { ...state, wheel: Boolean(action.open) }
        : state;
    case 'resume':
      // Reopening the mode brings a restored concept back; a user's pick wins.
      return state.active && !state.plot && action.plot
        ? {
            ...state,
            plot: action.plot,
            hover: null,
            focusId: action.id ?? null,
            wheel: false,
          }
        : state;
    case 'landed':
      // A finished Reimagine or Reroll: the concept leads and the wheel closes.
      return state.active
        ? { ...state, focusId: action.id, wheel: false, zoneMenu: false }
        : state;
    case 'zone-menu':
      return state.active && state.plot
        ? { ...state, wheel: true, zoneMenu: Boolean(action.open) }
        : state;
    case 'clear':
      return {
        ...state,
        plot: null,
        focusId: null,
        wheel: false,
        zoneMenu: false,
      };
    case 'tier':
      return ['district', 'plot', 'detail'].includes(action.tier) &&
        action.tier !== state.tier
        ? { ...state, tier: action.tier }
        : state;
    case 'focus':
      return state.active ? { ...state, focusId: action.id } : state;
    case 'build':
      return {
        ...state,
        focusId: action.id,
        built: { ...state.built, [action.plotId]: action.id },
      };
    default:
      return state;
  }
}
