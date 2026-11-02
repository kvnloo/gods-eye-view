// The CCTV observed-traffic row and card details follow the UI language.
// trafficObservations.test.mjs pins the English wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../../i18n/index.js';
import {
  formatObservedTrafficAge,
  summarizeCameraTrafficObservation,
} from './trafficObservations.js';

const NOW = Date.parse('2026-09-29T04:00:00Z');

function snapshot(record, overrides = {}) {
  return {
    configured: true,
    source: 'fixture',
    records: [
      {
        id: 'cam-1:westbound',
        cameraId: 'cam-1',
        windowEnd: NOW - 10_000,
        ...record,
      },
    ],
    partial: false,
    error: null,
    ...overrides,
  };
}

test('de: status, rate, counts and age are translated', (t) => {
  t.after(() => setLocale('en'));
  setLocale('de');
  const rate = summarizeCameraTrafficObservation(
    snapshot({ flow: { vehiclesPerMin: 18 } }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(rate.statusLabel, 'VERKEHRSBEOB. · GEMESSEN');
  assert.equal(rate.primary, '18 Fzg./min');
  assert.equal(rate.ageLabel, 'vor 10 s');
  assert.equal(rate.cardDetails[0], 'BEOBACHTET · 18 Fzg./min');

  const one = summarizeCameraTrafficObservation(
    snapshot({ flow: { counts: { car: 1 } } }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(one.primary, '1 Fahrzeug');
  const missing = summarizeCameraTrafficObservation(snapshot({}), 'cam-2', {
    now: NOW,
  });
  assert.equal(missing.statusLabel, 'VERKEHRSBEOB. · UNBEKANNT');
  assert.equal(formatObservedTrafficAge(2 * 24 * 60 * 60_000), 'vor 2 T');
});

test('en: a single counted vehicle reads singular', (t) => {
  t.after(() => setLocale('en'));
  setLocale('en');
  const one = summarizeCameraTrafficObservation(
    snapshot({ flow: { counts: { car: 1 } } }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(one.primary, '1 vehicle');
  assert.equal(one.statusLabel, 'TRAFFIC OBS · MEASURED');
});
