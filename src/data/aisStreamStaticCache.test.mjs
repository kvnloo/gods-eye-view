import test from 'node:test';
import assert from 'node:assert/strict';

let instance = 0;
const freshStore = () =>
  import(
    `../../server/providers/vessels/ais-store.js?static-cache=${++instance}`
  );
const staticReport = (mmsi, name, type = 'ShipStaticData') => ({
  MessageType: type,
  Message: { [type]: { UserID: mmsi, Name: name } },
  MetaData: { MMSI: mmsi },
});
const positionReport = (mmsi) => ({
  MessageType: 'PositionReport',
  Message: { PositionReport: { UserID: mmsi, Latitude: 10, Longitude: 20 } },
  MetaData: { MMSI: mmsi },
});
const rowFor = (store, mmsi) =>
  store.aisStreamRows(50000).find((row) => row.mmsi === String(mmsi));

for (const type of ['ShipStaticData', 'StaticDataReport']) {
  test(`${type} expires during positionless traffic and cannot enrich a later fix`, async (t) => {
    const store = await freshStore();
    let now = 2_000_000_000_000;
    t.mock.method(Date, 'now', () => now);
    for (let i = 0; i < 100; i++) {
      assert.equal(
        store.ingestAisStreamEnvelope(
          staticReport(200000000 + i, `old-${i}`, type),
        ),
        true,
      );
    }
    now += store.AISSTREAM_STALE_MS + 1;
    assert.equal(
      store.ingestAisStreamEnvelope(staticReport(300000000, 'fresh', type)),
      true,
    );
    assert.deepEqual(store.aisStreamRows(10), []);
    store.ingestAisStreamEnvelope(positionReport(200000000));
    store.ingestAisStreamEnvelope(positionReport(300000000));
    assert.equal(rowFor(store, 200000000).name, 'MMSI 200000000');
    assert.equal(rowFor(store, 300000000).name, 'fresh');
  });
}

test('static capacity evicts the oldest update and preserves a refreshed MMSI', async (t) => {
  const store = await freshStore();
  t.mock.method(Date, 'now', () => 2_000_000_000_000);
  for (let i = 0; i < store.AISSTREAM_CACHE_MAX; i++) {
    store.ingestAisStreamEnvelope(staticReport(200000000 + i, `vessel-${i}`));
  }
  store.ingestAisStreamEnvelope(staticReport(200000000, 'refreshed'));
  store.ingestAisStreamEnvelope(staticReport(300000000, 'newest'));
  for (const mmsi of [200000000, 200000001, 300000000]) {
    store.ingestAisStreamEnvelope(positionReport(mmsi));
  }
  assert.equal(rowFor(store, 200000000).name, 'refreshed');
  assert.equal(rowFor(store, 200000001).name, 'MMSI 200000001');
  assert.equal(rowFor(store, 300000000).name, 'newest');
});

test('static expiry scans are throttled instead of running for every packet', async (t) => {
  const store = await freshStore();
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const iterate = Map.prototype[Symbol.iterator];
  let scans = 0;
  Map.prototype[Symbol.iterator] = function () {
    scans++;
    return iterate.call(this);
  };
  try {
    for (let i = 0; i < 100; i++) {
      store.ingestAisStreamEnvelope(staticReport(200000000 + i, `vessel-${i}`));
    }
    assert.equal(scans, 1);
    now += 60_000;
    store.ingestAisStreamEnvelope(staticReport(300000000, 'next interval'));
    assert.equal(scans, 2);
  } finally {
    Map.prototype[Symbol.iterator] = iterate;
  }
});

test('an expired static entry is not reused between scheduled sweeps', async (t) => {
  const store = await freshStore();
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  store.ingestAisStreamEnvelope(staticReport(200000000, 'old'));
  now += store.AISSTREAM_STALE_MS;
  store.ingestAisStreamEnvelope(staticReport(300000000, 'fresh'));
  now++;
  store.ingestAisStreamEnvelope(positionReport(200000000));
  assert.equal(rowFor(store, 200000000).name, 'MMSI 200000000');
});
