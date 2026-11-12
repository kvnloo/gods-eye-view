import test from 'node:test';
import assert from 'node:assert/strict';
import { snapPlot } from '../data/cityPlot.js';
import {
  ZOOM_TIERS,
  zoomTier,
  wheelLayout,
  wheelSize,
  placeWheel,
  wheelActions,
  nextKind,
  carouselCards,
  resourceStats,
  detailCallouts,
  districtPins,
  createPlayState,
  playReducer,
  plotCode,
} from './cityPlayModel.js';

const plotA = snapPlot({ lat: 37.8007, lon: -122.4103 });
const plotB = snapPlot({ lat: 37.8017, lon: -122.4093 });
const image = 'data:image/png;base64,AAAA';
function alternative(id, plot, kind, extra = {}) {
  return {
    id,
    title: `${kind} ${id}`,
    description: 'd',
    parameters: { kind, trees: 20, widthMeters: 3, shadePercent: 40 },
    concept: null,
    revision: 1,
    versionCount: 1,
    site: plot ? { plot, reference: null } : null,
    ...extra,
  };
}

test('zoomTier maps camera range to district, plot and detail with hysteresis', () => {
  assert.deepEqual(ZOOM_TIERS, { near: 260, far: 1500 });
  assert.equal(zoomTier(5000), 'district');
  assert.equal(zoomTier(1500), 'district');
  assert.equal(zoomTier(800), 'plot');
  assert.equal(zoomTier(260), 'detail');
  assert.equal(zoomTier(120), 'detail');
  // Hysteresis: a tier is kept until the range leaves it by 15 %.
  assert.equal(zoomTier(1400, 'district'), 'district');
  assert.equal(zoomTier(1400, 'plot'), 'plot');
  assert.equal(zoomTier(1200, 'district'), 'plot');
  assert.equal(zoomTier(290, 'detail'), 'detail');
  assert.equal(zoomTier(290, 'plot'), 'plot');
  assert.equal(zoomTier(320, 'detail'), 'plot');
  // Missing measurements keep the previous tier rather than inventing one.
  assert.equal(zoomTier(Number.NaN, 'detail'), 'detail');
  assert.equal(zoomTier(-4, 'district'), 'district');
  assert.equal(zoomTier(undefined), 'plot');
});

test('wheelLayout spreads actions clockwise from twelve o clock', () => {
  assert.deepEqual(wheelLayout(5, 100), [
    { x: 0, y: -100 },
    { x: 95, y: -31 },
    { x: 59, y: 81 },
    { x: -59, y: 81 },
    { x: -95, y: -31 },
  ]);
  assert.deepEqual(wheelLayout(0, 100), []);
});

test('wheelSize and placeWheel keep every wheel button inside the viewport', () => {
  assert.deepEqual(wheelSize({ width: 1440, height: 900 }), {
    radius: 132,
    button: 78,
  });
  assert.deepEqual(wheelSize({ width: 390, height: 844 }), {
    radius: 98,
    button: 62,
  });
  const desktop = { width: 1440, height: 900 };
  const size = wheelSize(desktop);
  const inset = { top: 130, bottom: 120, side: 12 };
  assert.deepEqual(placeWheel({ x: 700, y: 450 }, desktop, size, inset), {
    x: 700,
    y: 450,
    clamped: false,
  });
  const edge = placeWheel({ x: 20, y: 880 }, desktop, size, inset);
  const reach = size.radius + size.button / 2;
  assert.equal(edge.clamped, true);
  assert.equal(edge.x, inset.side + reach);
  assert.equal(edge.y, desktop.height - inset.bottom - reach);
  const phone = { width: 390, height: 844 };
  const small = wheelSize(phone);
  const p = placeWheel({ x: 380, y: 100 }, phone, small, inset);
  const r = small.radius + small.button / 2;
  assert.ok(p.x - r >= 0 && p.x + r <= phone.width);
  assert.ok(p.y - r >= inset.top && p.y + r <= phone.height - inset.bottom);
  assert.equal(placeWheel(null, phone, small, inset), null);
});

test('wheelActions offers only honest proposal kinds and disables writes while busy or full', () => {
  const idle = wheelActions({ pending: false, full: false });
  assert.deepEqual(
    idle.map((a) => [a.id, a.kind, a.icon]),
    [
      ['reimagine', null, 'auto_awesome'],
      ['park', 'park', 'park'],
      ['plaza', 'plaza', 'deck'],
      ['bike-lane', 'bike-lane', 'pedal_bike'],
      ['inspect', null, 'search'],
    ],
  );
  assert.ok(idle.every((a) => !a.disabled));
  for (const state of [
    { pending: true, full: false },
    { pending: false, full: true },
  ]) {
    const busy = wheelActions(state);
    assert.deepEqual(
      busy.filter((a) => a.disabled).map((a) => a.id),
      ['reimagine', 'park', 'plaza', 'bike-lane'],
    );
  }
});

test('nextKind cycles through kinds this plot has not tried yet', () => {
  assert.equal(nextKind([]), 'park');
  assert.equal(nextKind(['park']), 'plaza');
  assert.equal(nextKind(['park', 'plaza']), 'bike-lane');
  assert.equal(nextKind(['park', 'plaza', 'bike-lane']), 'park');
  assert.equal(nextKind(['plaza', 'plaza']), 'park');
});

test('carouselCards lists one card per alternative of the selected plot with parameter chips', () => {
  const list = [
    alternative('world-1', plotA, 'park', {
      concept: { image, provider: 'fixture' },
    }),
    alternative('world-2', plotB, 'plaza'),
    alternative('world-3', plotA, 'bike-lane', {
      revision: 2,
      versionCount: 2,
    }),
    alternative('world-4', null, 'park'),
  ];
  const cards = carouselCards(list, plotA.id, {
    builtId: 'world-1',
    focusId: 'world-3',
    pendingId: 'world-3',
  });
  assert.deepEqual(
    cards.map((c) => c.id),
    ['world-1', 'world-3'],
  );
  assert.deepEqual(cards[0].chips, [
    { id: 'trees', value: 20, unit: '' },
    { id: 'shade', value: 40, unit: '%' },
    { id: 'width', value: 3, unit: 'm' },
  ]);
  assert.equal(cards[0].image, image);
  assert.equal(cards[0].built, true);
  assert.equal(cards[0].icon, 'park');
  assert.equal(cards[1].image, null);
  assert.equal(cards[1].focused, true);
  assert.equal(cards[1].pending, true);
  assert.equal(cards[1].revision, 2);
  // Walk access appears only when that module supplies a value.
  assert.ok(!cards.some((c) => c.chips.some((chip) => chip.id === 'walk')));
  const withAccess = carouselCards(list, plotA.id, {
    access: { 'world-1': { delta: 6 } },
  });
  assert.deepEqual(withAccess[0].chips.at(-1), {
    id: 'walk',
    value: 6,
    unit: '',
  });
  assert.equal(withAccess[1].chips.length, 3);
  assert.deepEqual(carouselCards(list, null), []);
});

test('resourceStats derives counts from the project and never shows missing as zero', () => {
  const none = resourceStats(null);
  assert.deepEqual(
    none.map((s) => [s.id, s.value]),
    [
      ['plots', '—'],
      ['worlds', '—'],
      ['concepts', '—'],
      ['trees', '—'],
      ['shade', '—'],
      ['walk', '—'],
    ],
  );
  const empty = resourceStats([]);
  assert.deepEqual(
    empty.map((s) => s.value),
    ['0', '0', '0', '—', '—', '—'],
  );
  const list = [
    alternative('world-1', plotA, 'park', { concept: { image } }),
    alternative('world-2', plotA, 'plaza'),
    alternative('world-3', null, 'bike-lane', {
      parameters: {
        kind: 'bike-lane',
        trees: 5,
        widthMeters: 2,
        shadePercent: 10,
      },
    }),
  ];
  assert.deepEqual(
    resourceStats(list).map((s) => s.value),
    ['1', '3', '1', '+45', '30%', '—'],
  );
});

test('detailCallouts place proposal parameters inside the footprint; nothing without a concept', () => {
  const a = alternative('world-1', plotA, 'plaza', { concept: { image } });
  const callouts = detailCallouts(a);
  assert.deepEqual(
    callouts.map((c) => c.id),
    ['kind', 'trees', 'shade', 'width'],
  );
  for (const c of callouts) {
    assert.ok(c.fx >= 0 && c.fx <= 1 && c.fy >= 0 && c.fy <= 1, c.id);
  }
  assert.equal(callouts[0].kind, 'plaza');
  assert.equal(callouts[1].value, 20);
  assert.deepEqual(detailCallouts(null), []);
  assert.deepEqual(detailCallouts(alternative('world-2', plotA, 'park')), []);
});

test('districtPins mark each plot that has a concept, preferring the built world', () => {
  const list = [
    alternative('world-1', plotA, 'park', { concept: { image } }),
    alternative('world-2', plotA, 'plaza', { concept: { image } }),
    alternative('world-3', plotB, 'bike-lane'),
  ];
  const latest = districtPins(list, {});
  assert.equal(latest.length, 1);
  assert.equal(latest[0].plotId, plotA.id);
  assert.equal(latest[0].alternativeId, 'world-2');
  assert.equal(latest[0].kind, 'plaza');
  assert.deepEqual(latest[0].center, plotA.center);
  const built = districtPins(list, { [plotA.id]: 'world-1' });
  assert.equal(built[0].alternativeId, 'world-1');
  assert.equal(built[0].built, true);
});

test('playReducer enters and exits the mode and restores a clean HUD state', () => {
  const s0 = createPlayState();
  assert.deepEqual(s0, {
    active: false,
    plot: null,
    hover: null,
    tier: 'plot',
    focusId: null,
    built: {},
  });
  assert.equal(playReducer(s0, { type: 'select', plot: plotA }), s0);
  assert.equal(playReducer(s0, { type: 'hover', plot: plotA }), s0);
  const s1 = playReducer(s0, { type: 'enter' });
  assert.equal(s1.active, true);
  const s2 = playReducer(s1, { type: 'hover', plot: plotB });
  assert.equal(s2.hover, plotB);
  const s3 = playReducer(s2, { type: 'select', plot: plotA });
  assert.equal(s3.plot, plotA);
  assert.equal(s3.hover, null);
  const s4 = playReducer(s3, { type: 'focus', id: 'world-1' });
  assert.equal(s4.focusId, 'world-1');
  assert.equal(
    playReducer(s4, { type: 'select', plot: plotA }).focusId,
    'world-1',
  );
  assert.equal(playReducer(s4, { type: 'select', plot: plotB }).focusId, null);
  const s5 = playReducer(s4, {
    type: 'build',
    plotId: plotA.id,
    id: 'world-1',
  });
  assert.deepEqual(s5.built, { [plotA.id]: 'world-1' });
  const s6 = playReducer(s5, { type: 'tier', tier: 'detail' });
  assert.equal(s6.tier, 'detail');
  assert.equal(playReducer(s6, { type: 'tier', tier: 'nope' }), s6);
  const out = playReducer(s6, { type: 'exit' });
  assert.equal(out.active, false);
  assert.equal(out.plot, null);
  assert.equal(out.focusId, null);
  assert.equal(out.hover, null);
  assert.deepEqual(out.built, s5.built, 'kept worlds survive leaving the mode');
  const again = playReducer(out, { type: 'enter' });
  assert.equal(again.plot, null);
  assert.equal(playReducer(again, { type: 'enter' }), again);
  assert.equal(playReducer(again, { type: 'clear' }).plot, null);
});

test('plotCode is a short stable label for a grid cell, not a parcel number', () => {
  assert.match(plotCode(plotA), /^[NS]\d{4}-\d{4}$/);
  assert.equal(plotCode(plotA), plotCode(snapPlot(plotA.center)));
  assert.notEqual(plotCode(plotA), plotCode(plotB));
  assert.match(plotCode(snapPlot({ lat: -33.85, lon: 151.2 })), /^S/);
});
