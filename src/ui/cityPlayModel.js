// Pure view-model for City builder play mode. No Cesium, DOM or i18n here:
// the globe adapter supplies ranges and screen points, the view supplies text.

export const ZOOM_TIERS = Object.freeze({ near: 260, far: 1500 });
const HYSTERESIS = 0.15;
const KINDS = ['park', 'plaza', 'bike-lane'];
export const KIND_ICONS = Object.freeze({
  park: 'park',
  plaza: 'deck',
  'bike-lane': 'pedal_bike',
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
  return viewport.width < 600
    ? { radius: 98, button: 62 }
    : { radius: 132, button: 78 };
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
    inset.side + reach,
    viewport.width - inset.side - reach,
  );
  const y = clamp(
    anchor.y,
    inset.top + reach,
    viewport.height - inset.bottom - reach,
  );
  return { x, y, clamped: x !== anchor.x || y !== anchor.y };
}

/** The wheel offers the existing proposal kinds only, plus Reimagine and Inspect. */
export function wheelActions({ pending = false, full = false } = {}) {
  const locked = pending || full;
  return [
    { id: 'reimagine', kind: null, icon: 'auto_awesome', disabled: locked },
    ...KINDS.map((kind) => ({
      id: kind,
      kind,
      icon: KIND_ICONS[kind],
      disabled: locked,
    })),
    { id: 'inspect', kind: null, icon: 'search', disabled: false },
  ];
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

/** Far-tier pins: one per plot with a concept, showing its kept world. */
export function districtPins(alternatives, built) {
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
      built: Boolean(kept),
    });
  }
  return pins;
}

export function createPlayState() {
  return {
    active: false,
    plot: null,
    hover: null,
    tier: 'plot',
    focusId: null,
    built: {},
  };
}

/** Mode state. Unchanged input returns the same object. */
export function playReducer(state, action) {
  switch (action.type) {
    case 'enter':
      return state.active
        ? state
        : { ...state, active: true, plot: null, hover: null, focusId: null };
    case 'exit':
      return {
        ...state,
        active: false,
        plot: null,
        hover: null,
        focusId: null,
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
      };
    case 'clear':
      return { ...state, plot: null, focusId: null };
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
