// FORK-ONLY experiment (exp/city-game-hud): the "game" HUD of City builder
// play mode, behind ?cityHud=game (or a list of its parts). Pure: no Cesium,
// DOM or i18n. The globe adapters (src/standalone/cityPlay.js,
// src/standalone/cityMassing.js) and the overlay (CityGameHud.vue) read it.
//
//   ?cityHud=game                every part below
//   ?cityHud=bar,plots,ground,place,drape   one part each:
//     bar     a slim top resource bar and a bottom icon build tray replace the
//             card dock and the pill stats bar
//     plots   far zoom: the 40 m plot grid and 200 m districts with yield chips
//     ground  growth: a stylised ground plate fills the cut under a district
//     place   placement ghost that snaps to the hovered plot (valid / invalid
//             tint) and the rise-from-ground build with a dust puff
//     drape   a concept is projected onto the photoreal ground of its plot
import { growthPlan } from './cityGrowth.js';
import { gridAt, gridDistrict } from './cityGrid.js';
import {
  METERS_PER_DEGREE,
  PLOT_METERS,
  snapPlot,
} from './cityPlot.js';

export const CITY_HUD_PARTS = Object.freeze([
  'bar',
  'plots',
  'ground',
  'place',
  'drape',
]);

/** The parts asked for in a location search string, as plain booleans. */
export function cityHudFlags(search = '') {
  const q = new URLSearchParams(search ?? '');
  const asked = new Set(
    (q.get('cityHud') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  // exp/city-loop-v3: ?city=v3 is the integrated preset (look=diorama +
  // cityHud=game); an explicit ?cityHud= still wins.
  const all = asked.has('game') || (!q.has('cityHud') && ['v3', 'hero'].includes(q.get('city')));
  const flags = {};
  for (const p of CITY_HUD_PARTS) flags[p] = all || asked.has(p);
  flags.any = CITY_HUD_PARTS.some((p) => flags[p]);
  return Object.freeze(flags);
}

let cached = null;
/** This page's parts (read once). */
export function pageHudFlags() {
  cached ??= cityHudFlags(globalThis.location?.search ?? '');
  return cached;
}

// ---------------------------------------------------------------- the tray
/**
 * The build tray: five categories, each a row of tools. Every tool is an
 * existing play-mode verb (cityPlay.js `controls.act`) or massing control; the
 * tray adds no new world model. `key` is the keyboard shortcut.
 */
export const TRAY_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'zone',
    icon: 'category',
    key: '1',
    tools: Object.freeze([
      { id: 'housing', icon: 'location_city', verb: 'act' },
      { id: 'mixed-use', icon: 'layers', verb: 'act' },
      { id: 'civic', icon: 'public', verb: 'act' },
      { id: 'open-space', icon: 'eco', verb: 'act' },
      { id: 'clear-use', icon: 'close', verb: 'act' },
    ]),
  }),
  Object.freeze({
    id: 'build',
    icon: 'view_in_ar',
    key: '2',
    // exp/city-loop-v3: the three build verbs are back in the tray. The r7
    // declutter (one verb) cost game_feel 2/2; its placement fix (tray clear of
    // the search dock) and known-figures-only bar are kept.
    tools: Object.freeze([
      { id: 'massing', icon: 'view_in_ar', verb: 'massing' },
      { id: 'reimagine', icon: 'auto_awesome', verb: 'act' },
      { id: 'inspect', icon: 'search', verb: 'act' },
    ]),
  }),
  Object.freeze({
    id: 'park',
    icon: 'park',
    key: '3',
    tools: Object.freeze([
      { id: 'park', icon: 'park', verb: 'act' },
      { id: 'plaza', icon: 'deck', verb: 'act' },
    ]),
  }),
  Object.freeze({
    id: 'transit',
    icon: 'pedal_bike',
    key: '4',
    tools: Object.freeze([{ id: 'bike-lane', icon: 'pedal_bike', verb: 'act' }]),
  }),
  Object.freeze({
    id: 'trees',
    icon: 'eco',
    key: '5',
    // Trees ride on the proposals that plant them: a park, or open space.
    tools: Object.freeze([
      { id: 'park', icon: 'park', verb: 'act', as: 'trees' },
      { id: 'open-space', icon: 'eco', verb: 'act', as: 'trees' },
    ]),
  }),
]);
const TOOL_KEYS = ['q', 'w', 'e', 'r', 't'];

/**
 * The tray as the overlay draws it. `category` is the open category id;
 * `plot` whether a plot is selected; `pending` while a concept is imagined;
 * `full` when no concept slot is left; `zoneFull` when the zoning budget is
 * spent and this plot has no use; `use` the plot's land use; `massingOn`
 * whether the assumed block stands. A disabled tool says why (`reason`).
 */
export function trayModel({
  category = 'build',
  plot = false,
  pending = false,
  full = false,
  zoneFull = false,
  use = null,
  massingOn = false,
  massing = true,
} = {}) {
  const open =
    TRAY_CATEGORIES.find((c) => c.id === category) ?? TRAY_CATEGORIES[1];
  const why = (tool) => {
    if (!plot) return 'no-plot';
    if (tool.id === 'massing') return massing ? null : 'unavailable';
    if (tool.id === 'inspect') return null;
    if (tool.id === 'clear-use') return pending ? 'pending' : use ? null : 'no-use';
    if (['housing', 'mixed-use', 'civic', 'open-space'].includes(tool.id))
      return pending ? 'pending' : zoneFull && use !== tool.id ? 'budget' : null;
    if (pending) return 'pending';
    if (full) return 'full';
    return null;
  };
  return {
    open: open.id,
    categories: TRAY_CATEGORIES.map((c) => ({
      id: c.id,
      icon: c.icon,
      key: c.key,
      open: c.id === open.id,
    })),
    tools: open.tools.map((tool, i) => {
      const reason = why(tool);
      return {
        ...tool,
        key: TOOL_KEYS[i] ?? null,
        disabled: Boolean(reason),
        reason,
        active:
          (tool.id === 'massing' && massingOn) ||
          (use != null && tool.id === use),
      };
    }),
  };
}

/**
 * What a key press does on the tray: `{type: 'category', id}`,
 * `{type: 'tool', tool}` or null. Modifier keys and typing never trigger.
 */
export function trayShortcut(event, model) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = String(event.key ?? '').toLowerCase();
  const category = model.categories.find((c) => c.key === key);
  if (category) return { type: 'category', id: category.id };
  const tool = model.tools.find((t) => t.key === key);
  if (tool && !tool.disabled) return { type: 'tool', tool };
  return null;
}

// ------------------------------------------------------------ the top bar
/** People per home the population chip assumes (an assumption, labelled). */
export const PERSONS_PER_HOME = 2.3;

/**
 * The slim top bar as raw figures. Every value is the app's own: plots and
 * concepts are counts; homes come from the massing / growth estimators and
 * are ranges; residents are homes x PERSONS_PER_HOME (an assumption, EST);
 * the zoning budget is the real cap (MAX_ZONED_PLOTS). Unknown stays null.
 * `growth` is the published timeline `{stage, plan}` or null; `massing` the
 * one block's `{homes}` or null; `turn` counts kept worlds.
 */
/** What the HUD shows for an unknown place (I2: never a guessed city). */
export const UNKNOWN_PLACE = '—';

/** The place text for the top bar: the name, or a dash when unknown. */
export function placeText(name) {
  return typeof name === 'string' && name.trim() ? name : UNKNOWN_PLACE;
}

export function topBarModel({
  place = null,
  growth = null,
  massing = null,
  zoned = 0,
  zoneCap = null,
  stats = [],
  kept = 0,
  goals = [],
  clock = null,
} = {}) {
  const stat = (id) => stats.find((s) => s.id === id)?.value ?? null;
  let homes = null;
  if (growth?.plan) {
    const stages = growth.plan.stages;
    const shown = stages[growth.stage ?? 0] ?? stages[0];
    homes = {
      value: shown.homes,
      low: Math.min(...stages.map((s) => s.homes)),
      high: Math.max(...stages.map((s) => s.homes)),
      stage: shown.id,
    };
  } else if (Number.isFinite(massing?.homes)) {
    homes = { value: massing.homes, low: massing.homes, high: massing.homes };
  }
  const residents =
    homes && Number.isFinite(homes.value)
      ? {
          value: Math.round(homes.value * PERSONS_PER_HOME),
          estimate: true,
        }
      : { value: null, estimate: true };
  // A chip with no figure is left off the bar (`shown` false), as the
  // parent's stats bar does: a row of dashes read as clutter (round-1 panel).
  const chips = [
      { id: 'residents', ...residents },
      {
        id: 'homes',
        value: homes?.value ?? null,
        low: homes?.low ?? null,
        high: homes?.high ?? null,
        estimate: true,
      },
      {
        id: 'zoning',
        value: zoned,
        cap: Number.isFinite(zoneCap) ? zoneCap : null,
      },
      { id: 'concepts', value: stat('concepts') },
      { id: 'trees', value: stat('trees'), estimate: true },
  ].map((c) => ({ ...c, shown: Number.isFinite(c.value) }));
  return {
    place,
    chips,
    goals: goals.slice(0, 2),
    turn: {
      kept,
      stage: homes?.stage ?? (growth ? 'now' : null),
      clock,
    },
  };
}

/** A count-up between two figures for the score chips, eased; t in 0..1. */
export function tickFigure(from, to, t) {
  if (!Number.isFinite(to)) return null;
  const a = Number.isFinite(from) ? from : 0;
  const k = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - k) ** 3;
  return Math.round(a + (to - a) * eased);
}

// ---------------------------------------------------- the district layer
/** Plots on a side of one far-zoom district cell (5 x 5 = 200 m). */
export const DISTRICT_SIDE = 5;

/**
 * The far-zoom district cells around a point: `radius` cells each way of the
 * cell holding it. Cells are a fixed 200 m (DISTRICT_SIDE plots) grid in the
 * plot grid's local metric at the point's latitude; each cell holds the grid
 * plots under its 5 x 5 plot-centre points (rows are bricks, as a shift-click
 * district's are).
 */
export function districtCells(point, radius = 1, side = DISTRICT_SIDE) {
  // A fitted grid's claim is one district: its own street-aligned plots.
  const grid = gridAt(point);
  if (grid) return grid.plots().length ? [gridDistrict(grid)] : [];
  if (!snapPlot(point)) return [];
  const step = side * PLOT_METERS;
  const ky = METERS_PER_DEGREE;
  const kx = METERS_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
  const i0 = Math.floor((point.lat * ky) / step);
  const j0 = Math.floor((point.lon * kx) / step);
  const half = PLOT_METERS / 2;
  const cells = [];
  for (let di = -radius; di <= radius; di++)
    for (let dj = -radius; dj <= radius; dj++) {
      const i = i0 + di;
      const j = j0 + dj;
      const at = (north, east) => ({
        lat: (i * step + north) / ky,
        lon: (j * step + east) / kx,
      });
      // Row by row (rows are bricks shifted against each other), the plots
      // under the cell's plot-centre points, each once.
      const seen = new Set();
      const plots = [];
      for (let r = 0; r < side; r++)
        for (let c = 0; c < side; c++) {
          const p = snapPlot(
            at(half + r * PLOT_METERS, half + c * PLOT_METERS),
          );
          if (p && !seen.has(p.id)) {
            seen.add(p.id);
            plots.push(p);
          }
        }
      if (plots.length)
        cells.push({
          id: `d${i}_${j}`,
          plots,
          center: at(step / 2, step / 2),
          corners: [
            [at(0, 0).lon, at(0, 0).lat],
            [at(0, step).lon, at(0, step).lat],
            [at(step, step).lon, at(step, step).lat],
            [at(step, 0).lon, at(step, 0).lat],
          ],
        });
    }
  return cells;
}

/**
 * A district cell's yield chip: its plots and land, and the homes its assumed
 * growth (src/data/cityGrowth.js: every plot at 3 storeys, 12 of 25 rising
 * to 5) would hold, as the low-high range over the timeline. An estimate of
 * assumed blocks, never a forecast: `estimate: true`.
 */
export function cellYield(cell) {
  if (!cell?.plots?.length) return null;
  const plan = growthPlan({ plots: cell.plots, anchorId: cell.plots[0].id });
  const homes = plan.stages.map((s) => s.homes);
  return {
    id: cell.id,
    plots: plan.plots,
    hectares: plan.areaSquareMeters / 10_000,
    homesLow: Math.min(...homes),
    homesHigh: Math.max(...homes),
    estimate: true,
  };
}

// --------------------------------------------- the district's ground (growth)
/** A sample this far above the fitted ground is a roof or a tree, not ground. */
export const ROOF_ABOVE_METERS = 2;

/**
 * One smooth ground under a growth district, fitted to height samples taken
 * BEFORE the photoreal mesh is cut: `samples` are `{x, y, h}` in local metres
 * (east, north) with h the lowest ground sampled at each plot. A plane is
 * fitted by least squares, then samples more than ROOF_ABOVE_METERS above it
 * (roofs, trees) are dropped and it is fitted again (3 passes). Fewer than
 * three usable samples: a level ground at the lowest one. Returns `{at(x, y),
 * floor, used}`, `floor` the lowest the plane reaches over the samples, or
 * null when nothing was sampled. Every plate stands on `at` and reaches down
 * to `floor`, so no gap opens between neighbours on a slope.
 */
export function districtGround(samples) {
  let pts = (samples ?? []).filter(
    (s) => s && [s.x, s.y, s.h].every(Number.isFinite),
  );
  if (!pts.length) return null;
  const level = (h) => ({ a: h, b: 0, c: 0 });
  let plane = level(Math.min(...pts.map((p) => p.h)));
  for (let pass = 0; pass < 3 && pts.length >= 3; pass++) {
    const fit = fitPlane(pts);
    if (!fit) break;
    plane = fit;
    const kept = pts.filter(
      (p) => p.h - (plane.a + plane.b * p.x + plane.c * p.y) <= ROOF_ABOVE_METERS,
    );
    if (kept.length === pts.length || kept.length < 3) break;
    pts = kept;
  }
  const at = (x, y) => plane.a + plane.b * x + plane.c * y;
  const all = (samples ?? []).filter((s) => s && [s.x, s.y].every(Number.isFinite));
  return {
    at,
    floor: Math.min(...all.map((s) => at(s.x, s.y))),
    used: pts.length,
  };
}

// Least-squares plane h = a + b x + c y, or null when the points are collinear.
function fitPlane(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sh = 0, sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0;
  for (const { x, y, h } of pts) {
    sx += x; sy += y; sh += h;
    sxx += x * x; syy += y * y; sxy += x * y;
    sxh += x * h; syh += y * h;
  }
  // Normal equations, solved by Cramer's rule.
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const r = [sh, sxh, syh];
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const col = (i) => m.map((row, k) => row.map((v, j) => (j === i ? r[k] : v)));
  return { a: det(col(0)) / d, b: det(col(1)) / d, c: det(col(2)) / d };
}

// ------------------------------------------------------ placement + juice
/**
 * Whether the armed tool may be placed on a plot: `{valid, reason}`. A zone
 * tool needs zoning budget unless the plot already has a use; a concept tool
 * needs a free concept slot and nothing pending; massing is always placeable.
 */
export function placementCheck({
  tool = null,
  plot = null,
  pending = false,
  full = false,
  zoneFull = false,
  use = null,
} = {}) {
  if (!tool || !plot) return { valid: false, reason: 'none' };
  if (tool === 'massing' || tool === 'inspect')
    return { valid: true, reason: null };
  if (['housing', 'mixed-use', 'civic', 'open-space'].includes(tool)) {
    if (pending) return { valid: false, reason: 'pending' };
    if (zoneFull && !use) return { valid: false, reason: 'budget' };
    return { valid: true, reason: null };
  }
  if (pending) return { valid: false, reason: 'pending' };
  if (full) return { valid: false, reason: 'full' };
  return { valid: true, reason: null };
}

/** Milliseconds a build takes to rise. */
export const RISE_MS = 1100;

/**
 * Share of its height a rising block shows `ms` after the build: 0 -> 1 with
 * a small overshoot that settles (a back-out ease), exactly 1 from RISE_MS.
 */
export function riseShare(ms, duration = RISE_MS) {
  if (!(ms > 0)) return 0;
  if (ms >= duration) return 1;
  const t = ms / duration;
  const s = 1.25;
  const u = t - 1;
  return 1 + (s + 1) * u ** 3 + s * u ** 2;
}

/**
 * The dust puff around a footprint `ms` after the build: `count` puffs placed
 * evenly round the footprint's edge (fractions 0..1 of its half size), each
 * growing outward and fading out by `duration`. Deterministic.
 */
export function dustPuffs(ms, { count = 10, duration = 1400 } = {}) {
  const t = Math.min(1, Math.max(0, ms / duration));
  if (t >= 1) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count + (i % 2) * 0.21;
    const reach = 0.95 + 0.55 * (1 - (1 - t) ** 2);
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      size: 0.22 + 0.5 * t,
      alpha: 0.55 * (1 - t) ** 1.5,
    };
  });
}

/** The grid side in metres (re-exported for the adapters). */
export const GRID_METERS = PLOT_METERS;
