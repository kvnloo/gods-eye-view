import { t } from '../i18n/index.js';
import {
  createPedestrianGraph,
  evaluateWalkAccess,
} from '../data/walkAccess.js';
import { WALK_ACCESS_FIXTURE as NETWORK } from '../data/walkAccessFixture.js';

// The offline fixture is the only network today; evaluations are pure, so cache.
const graph = createPedestrianGraph(NETWORK);
const evaluations = new Map();
const PAD = 30;
const top = Math.max(...NETWORK.nodes.map((n) => n.y));
const right = Math.max(...NETWORK.nodes.map((n) => n.x));
const svg = ({ x, y }) => ({ x: x + PAD, y: top - y + PAD });
const nodes = new Map(NETWORK.nodes.map((n) => [n.id, svg(n)]));
const MAP = Object.freeze({
  viewBox: `0 0 ${right + 2 * PAD} ${top + 2 * PAD}`,
  edges: NETWORK.edges.map(({ from, to }) => ({
    id: `${from}-${to}`,
    x1: nodes.get(from).x,
    y1: nodes.get(from).y,
    x2: nodes.get(to).x,
    y2: nodes.get(to).y,
  })),
});

function evaluate(site) {
  const key = site?.id ?? null;
  if (!evaluations.has(key))
    evaluations.set(
      key,
      evaluateWalkAccess({
        graph,
        zones: NETWORK.zones,
        parks: site ? [...NETWORK.parks, site] : NETWORK.parks,
      }),
    );
  return evaluations.get(key);
}

const metres = (value) => t('{value} m', { value: Math.round(value) });
const span = ([low, high]) =>
  t('{low}–{high} m', { low: Math.round(low), high: Math.round(high) });
function signed(value) {
  const r = Math.round(value);
  return t('{value} m', { value: r < 0 ? `−${-r}` : r > 0 ? `+${r}` : '±0' });
}
const siteLabel = (site) => t('Site {name}', { name: site.label });

function row(id, label, result, site, baseline) {
  if (result.status !== 'evaluated')
    return {
      id,
      label,
      state: 'unknown',
      note: t('Unknown: no demand zone reaches a park on this network.'),
    };
  const unknown = result.zoneCount - result.knownCount;
  return {
    id,
    label,
    state: 'evaluated',
    site: site ? siteLabel(site) : t('Existing park only'),
    mean: metres(result.meanMeters),
    meanMeters: result.meanMeters,
    meanRange: span(result.meanRange),
    worst: metres(result.worstMeters),
    worstRange: span(result.worstRange),
    known: t('{known} of {total} zones', {
      known: result.knownCount,
      total: result.zoneCount,
    }),
    unknown: unknown
      ? t(
          'Unknown zones: {count} (disconnected or off-network), not counted as zero',
          { count: unknown },
        )
      : null,
    delta:
      baseline?.status === 'evaluated'
        ? t('Mean {mean} · worst {worst}', {
            mean: signed(result.meanMeters - baseline.meanMeters),
            worst: signed(result.worstMeters - baseline.worstMeters),
          })
        : null,
    zones: NETWORK.zones.map((zone, i) => ({
      id: zone.id,
      ...svg(zone),
      label:
        result.zones[i].meters === null
          ? '?'
          : String(Math.round(result.zones[i].meters)),
    })),
    parks: [
      ...NETWORK.parks.map((park) => ({ id: park.id, ...svg(park) })),
      ...(site ? [{ id: site.id, ...svg(site), proposed: true }] : []),
    ],
  };
}

/** Baseline and per-alternative walk access as display strings; no state. */
export function presentCityWalkAccess(alternatives) {
  const baseline = evaluate(null);
  const rows = [
    row('baseline', t('Reference-only baseline'), baseline, null, null),
  ];
  for (const { id, title, parameters } of alternatives) {
    const siteId = parameters.site ?? null;
    const site = NETWORK.sites.find((s) => s.id === siteId);
    if (parameters.kind === 'bike-lane')
      rows.push({
        id,
        label: title,
        state: 'not-applicable',
        note: t(
          'Not applicable: walk access to a park is estimated for park and plaza alternatives.',
        ),
      });
    else if (!site)
      rows.push({
        id,
        label: title,
        state: 'unknown',
        note:
          siteId === null
            ? t('Unknown: choose a site to estimate walk access.')
            : t('Unknown: this site is not on the current network.'),
      });
    else rows.push(row(id, title, evaluate(site), site, baseline));
  }
  return {
    title: t('Walking access to the nearest park'),
    label: t('HYPOTHETICAL ESTIMATE · NOT A BENEFIT CLAIM'),
    network: t(
      'Network: offline synthetic sample {revision}, not the streets at this site. It contains no OpenStreetMap data.',
      { revision: NETWORK.revision },
    ),
    method: t(
      'Shortest walking paths between network nodes. Demand: {zones} zones with uniform weights (no sourced demand data). Range: each zone may snap to its nearest node or one edge away.',
      { zones: NETWORK.zones.length },
    ),
    unchanged: t(
      'Concept images, the baseline reference and observed facts stay unchanged.',
    ),
    sites: NETWORK.sites.map((site) => ({
      id: site.id,
      label: siteLabel(site),
    })),
    rows,
    map: MAP,
  };
}
