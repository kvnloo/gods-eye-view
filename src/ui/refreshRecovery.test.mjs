import test from 'node:test';
import assert from 'node:assert/strict';

// Match the feedback owner's existing Cesium-free test fixture.
globalThis.document ??= {
  hidden: false,
  createElement: () => ({}),
  addEventListener() {},
  removeEventListener() {},
};
const { ShellFeedback } = await import('./shellFeedback.js');

function fixture(t) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  document.hidden = false;
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: true,
    lifecycleState: 'enabled',
    stats: { status: 'ready', lastUpdate: 1000, count: 2 },
  };
  const rows = [layer];
  const views = [];
  const owner = new ShellFeedback({
    readLayers: () => rows,
    store: { publishLoading: (view) => views.push(view), publishTraffic() {} },
  });
  t.after(() => {
    owner.destroy();
    document.hidden = false;
  });
  const emit = (type, epoch, now, stats = {}) => {
    layer.stats = { ...layer.stats, refreshing: true };
    owner._loadingFeedbackEvent = {
      type: 'refresh-transition',
      layerId: layer.id,
      refreshEpoch: epoch,
    };
    owner._updateGlobalLoadingFeedback(now - 1);
    layer.stats = { status: 'ready', count: 2, lastUpdate: 2000, ...stats };
    owner._loadingFeedbackEvent = {
      type,
      layerId: layer.id,
      refreshEpoch: epoch,
    };
    owner._updateGlobalLoadingFeedback(now);
  };
  const fail = (epoch = 1, now = 0) =>
    emit('refresh-failed', epoch, now, {
      lastUpdate: 1000,
      managerRefreshError: 'Source unavailable',
    });
  const view = () => views.at(-1) || { hidden: true, label: '' };
  return { layer, rows, owner, views, emit, fail, view };
}

test('a recovered refresh names its layer after failure dwell, once per episode', (t) => {
  const f = fixture(t);
  f.fail();
  assert.equal(f.view().state, 'error');
  f.emit('refresh', 2, 1000);
  assert.equal(f.view().state, 'error', 'the failure keeps its full dwell');
  assert.equal(f.owner._refreshEpisodes.get('flights').shown, false);
  f.owner._updateGlobalLoadingFeedback(6001);
  assert.equal(f.view().label, 'REFRESH RECOVERED');
  assert.equal(f.view().detail, 'Flights');
  assert.equal(f.view().hidden, false);
  assert.equal(f.owner._refreshEpisodes.get('flights').shown, true);
  const deadline = f.owner._globalStatusNotice.hideAt;
  f.emit('refresh', 3, 6500, { lastUpdate: 3000 });
  assert.equal(
    f.owner._globalStatusNotice.hideAt,
    deadline,
    'no extended dwell',
  );
  f.owner._updateGlobalLoadingFeedback(deadline + 1);
  assert.equal(f.view().hidden, true);
  f.emit('refresh', 4, deadline + 100, { lastUpdate: 4000 });
  assert.equal(f.view().hidden, true, 'ordinary refresh cannot reannounce');
  f.fail(5, deadline + 1000);
  f.emit('refresh', 6, deadline + 2000, { lastUpdate: 5000 });
  f.owner._updateGlobalLoadingFeedback(deadline + 7001);
  assert.equal(f.view().label, 'REFRESH RECOVERED');
  assert.equal(f.view().hidden, false, 'a new failure starts a new episode');
});

test('startup success, duplicate and stale events cannot invent recovery', (t) => {
  const f = fixture(t);
  f.emit('refresh', 1, 0);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  f.fail(2, 100);
  for (const epoch of [2, 1, NaN, undefined]) f.emit('refresh', epoch, 200);
  f.owner._updateGlobalLoadingFeedback(5200);
  assert.equal(f.view().hidden, true);
});

for (const [name, stats] of Object.entries({
  'old accepted data': { lastUpdate: 1000 },
  stale: { stale: true },
  fallback: { fallback: true },
  partial: { partial: true },
  degraded: { degraded: true },
  unavailable: { available: false },
  error: { error: 'Still failing' },
  'missing key': { keyRequired: true },
  guidance: { status: 'zoom-in' },
  loading: { loading: true },
})) {
  test(`${name} is not evidence of refresh recovery`, (t) => {
    const f = fixture(t);
    f.fail();
    f.emit('refresh', 2, 1000, stats);
    f.owner._updateGlobalLoadingFeedback(5100);
    assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  });
}

test('recovery cannot replace acquisition or any ordinary live notice', (t) => {
  const f = fixture(t);
  for (const persistent of [true, false]) {
    f.fail(persistent ? 1 : 3, 0);
    f.owner._showGlobalStatusNotice('ACQUIRING', {
      state: 'acquiring',
      persistent,
    });
    const notice = f.owner._globalStatusNotice;
    f.emit('refresh', persistent ? 2 : 4, 1000);
    assert.equal(f.owner._globalStatusNotice, notice);
    f.owner.clearLoadingStatus();
    f.owner._updateGlobalLoadingFeedback(5100);
    assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  }
});

test('pending recovery expires instead of announcing long after an unrelated retry', (t) => {
  const f = fixture(t);
  f.rows.push({
    id: 'alpr-cameras',
    enabled: true,
    stats: {
      retryAt: Date.now() + 60000,
      error: 'Retry pending',
    },
  });
  f.fail();
  f.emit('refresh', 2, 1000);
  f.owner._updateGlobalLoadingFeedback(11001);
  f.rows.pop();
  f.owner._updateGlobalLoadingFeedback(12000);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
});

for (const reason of [
  'hidden',
  'failed-again',
  'disabled',
  'removed',
  'stale',
]) {
  test(`a queued recovery is withdrawn when ${reason}`, (t) => {
    const f = fixture(t);
    f.fail();
    f.emit('refresh', 2, 1000);
    if (reason === 'hidden') document.hidden = true;
    if (reason === 'failed-again') f.fail(3, 2000);
    if (reason === 'disabled') f.layer.enabled = false;
    if (reason === 'removed') f.rows.length = 0;
    if (reason === 'stale') f.layer.stats.stale = true;
    f.owner._updateGlobalLoadingFeedback(2001);
    document.hidden = false;
    f.owner._updateGlobalLoadingFeedback(8000);
    assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  });
}

test('a recovery observed while hidden is consumed, not replayed on return', (t) => {
  const f = fixture(t);
  f.fail();
  document.hidden = true;
  f.emit('refresh', 2, 1000);
  document.hidden = false;
  f.emit('refresh', 3, 5100, { lastUpdate: 3000 });
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  assert.equal(f.owner._refreshEpisodes.get('flights').shown, false, 'consumed is not surfaced');
});

for (const [locale, expected] of [
  ['es', 'ACTUALIZACIÓN RECUPERADA'],
  ['ru', 'ОБНОВЛЕНИЕ ВОССТАНОВЛЕНО'],
]) {
  test(`${locale}: a visible recovery relocalizes without extending its deadline`, async (t) => {
    const { setLocale } = await import('../i18n/index.js');
    const f = fixture(t);
    t.after(() => setLocale('en'));
    f.fail();
    f.emit('refresh', 2, 1000);
    f.owner._updateGlobalLoadingFeedback(6001);
    const deadline = f.owner._globalStatusNotice.hideAt;
    setLocale(locale);
    assert.equal(f.view().label, expected);
    assert.equal(f.owner._globalStatusNotice.hideAt, deadline);
  });
}

test('later routine work retains the cue, but new unhealthy evidence withdraws it', (t) => {
  const f = fixture(t);
  f.fail();
  f.emit('refresh', 2, 1000);
  f.owner._updateGlobalLoadingFeedback(6001);
  const deadline = f.owner._globalStatusNotice.hideAt;
  f.layer.stats.refreshing = true;
  f.layer.stats.loading = true;
  f.owner._updateGlobalLoadingFeedback(6100);
  assert.equal(f.owner._globalStatusNotice.hideAt, deadline);
  f.layer.stats.stale = true;
  f.owner._updateGlobalLoadingFeedback(6200);
  assert.equal(f.owner._globalStatusNotice, null);
});

test('missing failure stats cannot erase the last successful acceptance baseline', (t) => {
  const f = fixture(t);
  f.emit('refresh', 1, 0, { lastUpdate: 2000 });
  f.emit('refresh-failed', 2, 100, { lastUpdate: null, error: 'Stats unavailable' });
  f.emit('refresh', 3, 1000, { lastUpdate: 2000 });
  f.owner._updateGlobalLoadingFeedback(6001);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
});

test('a second failure cannot roll back the acceptance baseline', (t) => {
  const f = fixture(t);
  f.fail(1, 0);
  f.emit('refresh-failed', 2, 100, { lastUpdate: null, error: 'Stats unavailable' });
  f.emit('refresh', 3, 1000, { lastUpdate: 1000 });
  f.owner._updateGlobalLoadingFeedback(6001);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
});

test('a successful refresh records an epoch watermark before any failure', (t) => {
  const f = fixture(t);
  f.emit('refresh', 5, 0, { lastUpdate: 2000 });
  f.emit('refresh-failed', 4, 100, { lastUpdate: 2000, error: 'Old failure' });
  f.emit('refresh', 6, 1000, { lastUpdate: 3000 });
  f.owner._updateGlobalLoadingFeedback(6001);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
});

test('the visibility listener withdraws a pending recovery before resume', (t) => {
  const f = fixture(t);
  let visibility;
  t.mock.method(document, 'addEventListener', (name, callback) => {
    if (name === 'visibilitychange') visibility = callback;
  });
  f.owner.observeVisibility();
  f.fail();
  f.emit('refresh', 2, 1000);
  assert.ok(f.owner._globalStatusNotice?.recovery);
  document.hidden = true;
  visibility();
  assert.equal(f.owner._globalStatusNotice, null);
  assert.equal(f.owner._loadingFeedbackTicker, null);
  document.hidden = false;
  f.owner._updateGlobalLoadingFeedback(6001);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
});

test('real manager stats loss cannot turn unchanged cached data into recovery', async (t) => {
  const { LayerLifecycle } = await import('../data/lifecycle.js');
  const f = fixture(t);
  const manager = new LayerLifecycle({});
  let failing = false;
  let statsMissing = false;
  manager.register({
    id: 'qa-stats-loss', name: 'Stats loss QA', updateInterval: -1,
    init() {}, enable() {}, disable() {}, destroy() {},
    update() { statsMissing = failing; return !failing; },
    getStats() {
      if (statsMissing) throw new Error('Temporary stats failure');
      return { status: 'ready', count: 2, lastUpdate: 1000 };
    },
  });
  f.owner.readLayers = () => manager.getAll();
  let now = 0;
  const off = manager.subscribe((event) => {
    f.owner._loadingFeedbackEvent = event;
    f.owner._updateGlobalLoadingFeedback(now++);
  });
  t.after(off);
  t.mock.method(console, 'warn', () => {});
  await manager.setEnabled('qa-stats-loss', true, { origin: 'qa' });
  await manager.refreshLayer('qa-stats-loss');
  failing = true;
  assert.equal(await manager.refreshLayer('qa-stats-loss'), false);
  failing = false;
  assert.equal(await manager.refreshLayer('qa-stats-loss'), true);
  f.owner._updateGlobalLoadingFeedback(6000);
  assert.notEqual(f.view().label, 'REFRESH RECOVERED');
  await manager.destroyLayer('qa-stats-loss');
});
