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
  resumeAlternative,
  groundShadow,
  boundsOf,
  placeBeside,
  wheelBounds,
  zoneLegend,
  stackPins,
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
  // Buttons fit a 12 px caps label ("REIMAGINE", "BIKE LANE").
  assert.deepEqual(wheelSize({ width: 1440, height: 900 }), {
    radius: 150,
    button: 96,
  });
  assert.deepEqual(wheelSize({ width: 390, height: 844 }), {
    radius: 116,
    button: 80,
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
      ['zone', null, 'category'],
      ['inspect', null, 'search'],
    ],
  );
  assert.ok(idle.every((a) => !a.disabled));
  for (const [state, disabled] of [
    [
      { pending: true, full: false },
      ['reimagine', 'park', 'plaza', 'bike-lane', 'zone'],
    ],
    // Six worlds stop new proposals, not land use.
    [
      { pending: false, full: true },
      ['reimagine', 'park', 'plaza', 'bike-lane'],
    ],
  ]) {
    const busy = wheelActions(state);
    assert.deepEqual(
      busy.filter((a) => a.disabled).map((a) => a.id),
      disabled,
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
  assert.equal(latest[0].trees, 20, 'pins carry the proposal yields as badges');
  assert.equal(latest[0].shade, 40);
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
    wheel: false,
    zoneMenu: false,
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
  assert.equal(s3.wheel, true, 'selecting a plot opens its wheel');
  const closed = playReducer(s3, { type: 'wheel', open: false });
  assert.equal(closed.wheel, false, 'a landed concept closes the wheel');
  assert.equal(
    playReducer(closed, { type: 'select', plot: plotA }).wheel,
    true,
    'clicking the plot again reopens it',
  );
  assert.equal(playReducer(s0, { type: 'wheel', open: true }), s0);
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
  assert.equal(out.wheel, false);
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

test('resumeAlternative brings back the latest concept on a plot near the camera', () => {
  const at = (generatedAt) => ({ concept: { image, generatedAt } });
  const camera = { lat: 37.7953, lon: -122.4103, height: 600 };
  assert.equal(
    resumeAlternative(null, camera),
    null,
    'no project, nothing to resume',
  );
  assert.equal(resumeAlternative([], camera), null);
  assert.equal(
    resumeAlternative([alternative('world-1', plotA, 'park')], camera),
    null,
    'a plot without a concept is not resumed',
  );
  assert.equal(
    resumeAlternative(
      [alternative('world-1', null, 'park', at('2026-11-12T20:00:00Z'))],
      camera,
    ),
    null,
    'an unplaced proposal has no plot to show',
  );
  const list = [
    alternative('world-1', plotA, 'park', at('2026-11-12T20:00:05.500Z')),
    alternative('world-2', plotB, 'plaza', at('2026-11-12T20:00:05Z')),
  ];
  // generatedAt compares as time, not text ("05Z" sorts after "05.500Z" as text).
  assert.equal(resumeAlternative(list, camera).id, 'world-1');
  const tie = [
    alternative('world-1', plotA, 'park', at('2026-11-12T20:00:05Z')),
    alternative('world-2', plotB, 'plaza', at('2026-11-12T20:00:05Z')),
  ];
  assert.equal(
    resumeAlternative(tie, camera).id,
    'world-2',
    'a tie keeps the later proposal',
  );
  // Far from the camera (another city), play mode does not fly the user away.
  const tokyo = { lat: 35.68, lon: 139.76, height: 600 };
  assert.equal(resumeAlternative(list, tokyo), null);
  // Reach grows with altitude: from 20 km up a plot 8 km away is still in view.
  const high = {
    lat: 37.8007 - 8000 / 111_320,
    lon: -122.4103,
    height: 20_000,
  };
  assert.equal(resumeAlternative(list, high).id, 'world-1');
  assert.equal(resumeAlternative(list, { ...high, height: 600 }), null);
  assert.equal(resumeAlternative(list, { lat: Number.NaN, lon: 0 }), null);
});

test('playReducer resume selects the restored plot with the concept leading and the wheel closed', () => {
  const inactive = createPlayState();
  const resume = { type: 'resume', plot: plotA, id: 'world-1' };
  assert.equal(playReducer(inactive, resume), inactive, 'only inside the mode');
  const entered = playReducer(inactive, { type: 'enter' });
  const resumed = playReducer(entered, resume);
  assert.equal(resumed.plot, plotA);
  assert.equal(resumed.focusId, 'world-1');
  assert.equal(
    resumed.wheel,
    false,
    'the concept leads; clicking the plot opens the wheel',
  );
  const chosen = playReducer(entered, { type: 'select', plot: plotB });
  assert.equal(
    playReducer(chosen, resume),
    chosen,
    'never overrides a plot the user picked',
  );
  assert.equal(playReducer(entered, { type: 'resume', plot: null }), entered);
});

test('groundShadow grounds a standing card with a contact band and a sun-cast shadow', () => {
  const lat = 37.8;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  // A 48 m card running west to east, facing south toward the capture camera.
  const a0 = [-122.41 - 24 / mLon, lat];
  const a1 = [-122.41 + 24 / mLon, lat];
  const card = { a0, a1, heightMeters: 32, faceAzimuthDeg: 180, lat };
  const meters = ([lon, la]) => ({
    east: (lon - -122.41) * mLon,
    north: (la - lat) * 111_320,
  });
  const near = (a, b, tolerance = 0.05) => Math.abs(a - b) < tolerance;

  // Sun due south at 30 degrees: the shadow falls north, h / tan(elevation) long.
  const noon = groundShadow({
    ...card,
    sun: { azimuthDeg: 180, elevationDeg: 30 },
  });
  assert.ok(
    near(noon.lengthMeters, 32 / Math.tan(Math.PI / 6)),
    String(noon.lengthMeters),
  );
  assert.deepEqual(
    noon.cast.slice(0, 2),
    [a0, a1],
    'the shadow starts at the card base',
  );
  assert.ok(near(meters(noon.cast[2]).north, noon.lengthMeters));
  assert.ok(near(meters(noon.cast[2]).east, 24));
  // A sunlit face is bright; the contact band straddles the base 3 m each side.
  assert.ok(near(noon.shade, 0.62 + 0.38 * Math.cos(Math.PI / 6), 1e-9));
  assert.deepEqual(
    noon.contact.map(meters).map((p) => Math.round(p.north)),
    [-3, -3, 3, 3],
  );

  // Afternoon sun in the south-west: the shadow falls north-east.
  const late = groundShadow({
    ...card,
    sun: { azimuthDeg: 225, elevationDeg: 20 },
  });
  const tip = meters(late.cast[3]);
  assert.ok(tip.north > 0 && tip.east > -24, 'away from the sun');
  // Sun behind the card: its face is in shade, never brighter than ambient.
  const behind = groundShadow({
    ...card,
    sun: { azimuthDeg: 0, elevationDeg: 40 },
  });
  assert.equal(behind.shade, 0.62);
  assert.ok(meters(behind.cast[2]).north < 0, 'shadow falls toward the viewer');
  // A grazing sun cannot stretch the shadow across the district.
  const low = groundShadow({
    ...card,
    sun: { azimuthDeg: 180, elevationDeg: 4 },
  });
  assert.equal(low.lengthMeters, 2.5 * 32);
  // Sun down (or unknown): contact band only, ambient shade.
  for (const sun of [{ azimuthDeg: 180, elevationDeg: -10 }, null]) {
    const dark = groundShadow({ ...card, sun });
    assert.equal(dark.cast, null);
    assert.equal(dark.lengthMeters, 0);
    assert.equal(dark.shade, 0.62);
    assert.equal(dark.contact.length, 4);
  }
});

test('placeBeside anchors an info card next to the plot, clear of credits and HUD', () => {
  assert.equal(boundsOf([]), null);
  assert.equal(
    boundsOf([{ x: 5, y: 5 }]),
    null,
    'one point is not a footprint',
  );
  const target = boundsOf([
    { x: 620, y: 400 },
    { x: 820, y: 410 },
    { x: 800, y: 500 },
    { x: 640, y: 490 },
  ]);
  assert.deepEqual(target, { left: 620, top: 400, right: 820, bottom: 500 });
  const desktop = { width: 1440, height: 900 };
  const size = { width: 260, height: 170 };
  const credits = { left: 20, top: 770, right: 370, bottom: 805 };
  const bar = { left: 370, top: 78, right: 1070, bottom: 112 };
  const right = placeBeside({
    target,
    size,
    viewport: desktop,
    keepOut: [credits, bar],
  });
  assert.equal(right.side, 'right');
  assert.equal(right.clear, true);
  assert.deepEqual(
    [right.x, right.y],
    [868, 365],
    'beside the plot, not at the screen edge',
  );
  assert.deepEqual(right.leader, {
    from: { x: 868, y: 450 },
    to: { x: 820, y: 450 },
  });

  // Near the right edge the card flips to the left of the plot.
  const edge = { left: 1180, top: 400, right: 1380, bottom: 500 };
  const left = placeBeside({ target: edge, size, viewport: desktop });
  assert.equal(left.side, 'left');
  assert.equal(left.x, 1180 - 48 - 260);
  assert.deepEqual(left.leader.from, { x: 1180 - 48, y: 450 });
  assert.deepEqual(left.leader.to, { x: 1180, y: 450 });

  // A keep-out (here the credits) on the right side also flips it.
  const blocked = placeBeside({
    target,
    size,
    viewport: desktop,
    keepOut: [{ left: 860, top: 300, right: 1200, bottom: 600 }],
  });
  assert.equal(blocked.side, 'left');
  assert.equal(blocked.clear, true);

  // Phone: no room beside the plot and the bar sits above, so it goes below.
  const phone = { width: 390, height: 844 };
  const small = { left: 150, top: 300, right: 240, bottom: 380 };
  const below = placeBeside({
    target: small,
    size: { width: 366, height: 150 },
    viewport: phone,
    keepOut: [{ left: 12, top: 76, right: 318, bottom: 200 }],
  });
  assert.equal(below.side, 'below');
  assert.deepEqual([below.x, below.y], [12, 428]);
  assert.deepEqual(below.leader, {
    from: { x: 195, y: 428 },
    to: { x: 195, y: 380 },
  });

  // Nowhere fully clear: the least-overlapping spot, flagged as not clear.
  const crowded = placeBeside({
    target,
    size,
    viewport: desktop,
    keepOut: [{ left: 0, top: 0, right: 1440, bottom: 900 }],
  });
  assert.equal(crowded.clear, false);
  assert.equal(placeBeside({ target: null, size, viewport: desktop }), null);
});

test('a landed concept closes the wheel; the plot tag never overlaps the wheel', () => {
  const entered = playReducer(createPlayState(), { type: 'enter' });
  const open = playReducer(entered, { type: 'select', plot: plotA });
  assert.equal(open.wheel, true);
  // Reimagine and Reroll both end with the concept leading and the wheel closed.
  const landed = playReducer(open, { type: 'landed', id: 'world-2' });
  assert.equal(landed.wheel, false);
  assert.equal(landed.focusId, 'world-2');
  assert.equal(landed.plot, plotA);
  assert.equal(
    playReducer(createPlayState(), { type: 'landed', id: 'x' }).wheel,
    false,
  );
  assert.equal(
    playReducer(createPlayState(), { type: 'landed', id: 'x' }).focusId,
    null,
    'outside the mode nothing changes',
  );

  const size = wheelSize({ width: 1440, height: 900 });
  const ring = wheelBounds({ x: 700, y: 450 }, size);
  assert.deepEqual(ring, { left: 502, top: 252, right: 898, bottom: 648 });
  assert.equal(wheelBounds(null, size), null);
  // The tag goes beside the wheel's bounds, never across a button.
  const desktop = { width: 1440, height: 900 };
  const tag = placeBeside({
    target: ring,
    size: { width: 330, height: 56 },
    viewport: desktop,
    gap: 14,
  });
  assert.equal(tag.side, 'right');
  assert.ok(tag.x >= ring.right, 'clear of the ring');
  // Phone: no room beside a 312 px wheel, so the tag sits above it, below the bar.
  const phone = { width: 390, height: 844 };
  const small = wheelBounds({ x: 195, y: 420 }, wheelSize(phone));
  const above = placeBeside({
    target: small,
    size: { width: 200, height: 40 },
    viewport: phone,
    keepOut: [{ left: 12, top: 76, right: 318, bottom: 130 }],
    gap: 14,
  });
  assert.equal(above.side, 'above');
  assert.ok(above.y + 40 <= small.top);
  assert.equal(above.clear, true);
});

test('the wheel opens a land-use menu and returns to its actions', () => {
  const entered = playReducer(createPlayState(), { type: 'enter' });
  const open = playReducer(entered, { type: 'select', plot: plotA });
  const menu = playReducer(open, { type: 'zone-menu', open: true });
  assert.equal(menu.zoneMenu, true);
  assert.equal(menu.wheel, true);
  assert.equal(
    playReducer(menu, { type: 'zone-menu', open: false }).zoneMenu,
    false,
  );
  assert.equal(
    playReducer(menu, { type: 'select', plot: plotB }).zoneMenu,
    false,
  );
  assert.equal(
    playReducer(menu, { type: 'landed', id: 'world-1' }).zoneMenu,
    false,
  );
  assert.equal(playReducer(menu, { type: 'exit' }).zoneMenu, false);
  assert.equal(
    playReducer(entered, { type: 'zone-menu', open: true }),
    entered,
    'no plot, no menu',
  );
  assert.deepEqual(
    wheelActions({ zoneMenu: true, use: 'housing' }).map((a) => [
      a.id,
      a.icon,
      Boolean(a.selected),
      a.disabled,
    ]),
    [
      ['housing', 'location_city', true, false],
      ['mixed-use', 'layers', false, false],
      ['civic', 'public', false, false],
      ['open-space', 'eco', false, false],
      ['clear-use', 'close', false, false],
      ['back', 'arrow_left', false, false],
    ],
  );
  assert.equal(
    wheelActions({ zoneMenu: true, use: null }).find(
      (a) => a.id === 'clear-use',
    ).disabled,
    true,
  );
  assert.equal(
    wheelActions({ zoneMenu: true, pending: true }).find(
      (a) => a.id === 'civic',
    ).disabled,
    true,
  );
  assert.equal(
    wheelActions({ zoneMenu: true, pending: true }).find((a) => a.id === 'back')
      .disabled,
    false,
  );
});

test('zoneLegend derives plots, area and share per land use from the plots themselves', () => {
  const plotC = snapPlot({ lat: 37.8027, lon: -122.4083 });
  const z = (plot, use) => ({ plot, use });
  const legend = zoneLegend([
    z(plotA, 'housing'),
    z(plotB, 'housing'),
    z(plotC, 'open-space'),
  ]);
  assert.deepEqual(
    legend.rows.map((r) => [
      r.use,
      r.plots,
      r.areaSquareMeters,
      r.sharePercent,
    ]),
    [
      ['housing', 2, 3200, 67],
      ['mixed-use', 0, 0, 0],
      ['civic', 0, 0, 0],
      ['open-space', 1, 1600, 33],
    ],
  );
  assert.equal(legend.plots, 3);
  assert.equal(legend.areaSquareMeters, 4800);
  // Changing one plot's use changes the derived numbers.
  const changed = zoneLegend([
    z(plotA, 'civic'),
    z(plotB, 'housing'),
    z(plotC, 'open-space'),
  ]);
  assert.deepEqual(
    changed.rows.map((r) => r.sharePercent),
    [33, 0, 33, 33],
  );
  assert.deepEqual(
    changed.rows.map((r) => r.plots),
    [1, 0, 1, 1],
  );
  const none = zoneLegend([]);
  assert.equal(none.areaSquareMeters, 0);
  assert.ok(
    none.rows.every((r) => r.plots === 0 && r.sharePercent === null),
    'nothing zoned: shares are unknown, not zero',
  );
});

test('district pins add each plot use and pass the existing walk-access estimate through unchanged', () => {
  const list = [alternative('world-1', plotA, 'park', { concept: { image } })];
  const walk = { 'world-1': '212 m' };
  const zoned = (use) => [
    { plot: plotA, use: 'open-space' },
    { plot: plotB, use },
  ];
  const pins = districtPins(list, {}, { zoning: zoned('housing'), walk });
  const byPlot = Object.fromEntries(pins.map((p) => [p.plotId, p]));
  assert.equal(byPlot[plotA.id].use, 'open-space');
  assert.equal(byPlot[plotA.id].walk, '212 m');
  assert.equal(byPlot[plotA.id].trees, 20);
  // A zoned plot without a concept still gets a pin, with nothing invented.
  assert.equal(byPlot[plotB.id].use, 'housing');
  assert.equal(byPlot[plotB.id].alternativeId, null);
  assert.equal(byPlot[plotB.id].trees, null);
  assert.equal(byPlot[plotB.id].walk, null);
  // Rezoning never changes the walk-access estimate (it is not recomputed).
  const rezoned = districtPins(list, {}, { zoning: zoned('civic'), walk });
  assert.deepEqual(
    rezoned.map((p) => p.walk),
    pins.map((p) => p.walk),
  );
  assert.equal(districtPins(list, {}).length, 1, 'zoning stays optional');
});

test('stackPins lifts colliding district pins until every label is clear', () => {
  const size = { width: 240, height: 48 };
  const pins = stackPins(
    [
      { plotId: 'a', at: { x: 700, y: 360 } },
      { plotId: 'b', at: { x: 730, y: 362 } },
      { plotId: 'c', at: { x: 1200, y: 360 } },
    ],
    size,
  );
  assert.deepEqual(
    pins.map((p) => [p.plotId, p.top, p.lift]),
    [
      ['a', 360, 0],
      ['b', 362 - 54, 54],
      ['c', 360, 0],
    ],
  );
  // Neighbours of neighbours keep climbing.
  const three = stackPins(
    [0, 1, 2].map((i) => ({ plotId: `p${i}`, at: { x: 700, y: 400 } })),
    size,
  );
  assert.deepEqual(
    three.map((p) => p.lift),
    [0, 54, 108],
  );
});
