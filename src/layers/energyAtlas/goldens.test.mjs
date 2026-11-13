import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annualAveragePowerW,
  hoursInCalendarYear,
  normalizeEnergyObservation,
  worldKardashevEstimate,
} from './model.js';

// Cited real-world goldens. The fixture holds each value as published and the
// source row of every conversion constant; all arithmetic stays in this file.
const fixture = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/energy-goldens.json', import.meta.url),
    'utf8',
  ),
);

const constant = (id) => {
  const row = fixture.constants[id];
  assert.ok(row, `no cited constant ${id}`);
  return row.value;
};

// Joules in one published unit, built only from cited constants.
const JOULES_PER_UNIT = {
  ktoe: () =>
    constant('GWH_PER_KTOE') * constant('SI_GIGA') * constant('J_PER_WH'),
};

const joules = (golden) => {
  const perUnit = JOULES_PER_UNIT[golden.unit];
  assert.ok(perUnit, `no cited conversion for unit ${golden.unit}`);
  return golden.valueAsPublished * perUnit();
};

// Independent of the model: the Gregorian calendar gives the year length.
const secondsInUtcYear = (year) =>
  (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 1000;

const annualTWh = (golden) =>
  joules(golden) / (constant('J_PER_WH') * constant('SI_TERA'));

const observation = (golden) => ({
  schemaVersion: 1,
  area: {
    id: golden.area.id,
    type: golden.area.type,
    boundaryDataset: golden.area.boundaryDataset,
    boundaryRevision: golden.area.boundaryRevision,
  },
  metric: golden.metric,
  calendarYear: golden.dataYear,
  annualTWh: annualTWh(golden),
  status: golden.status,
  geographyCoverage: golden.geographyCoverage,
  source: {
    publisher: golden.publisher,
    url: golden.url,
    datasetVersion: golden.releasedAt,
    releasedAt: golden.releasedAt,
    licence: golden.licence,
    attribution: golden.attribution,
  },
});

const relativeError = (model, cited) => Math.abs(model - cited) / cited;
const energyGoldens = fixture.goldens.filter(
  (golden) => golden.kind === 'annual_energy',
);

test('every golden carries a complete citation', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, 'test-fixture');
  const ids = fixture.goldens.map((golden) => golden.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const golden of fixture.goldens) {
    for (const field of [
      'publisher',
      'dataset',
      'table',
      'unit',
      'measuresNote',
    ])
      assert.ok(golden[field]?.trim(), `${golden.id} lacks ${field}`);
    assert.equal(new URL(golden.url).protocol, 'https:', golden.id);
    assert.match(golden.releasedAt, /^\d{4}-\d{2}-\d{2}$/, golden.id);
    assert.ok(Number.isInteger(golden.dataYear), golden.id);
    assert.ok(Number.isFinite(golden.valueAsPublished), golden.id);
    assert.ok(golden.valueAsPublished > 0, golden.id);
    assert.ok(['final', 'primary'].includes(golden.measures), golden.id);
  }
});

test('every conversion constant has a source row', () => {
  for (const [id, row] of Object.entries(fixture.constants)) {
    assert.ok(Number.isFinite(row.value) && row.value > 0, id);
    for (const field of ['unit', 'publisher', 'document', 'locator'])
      assert.ok(row[field]?.trim(), `${id} lacks ${field}`);
    assert.equal(new URL(row.url).protocol, 'https:', id);
  }
});

test('cited unit conversions agree with each other and with the model', () => {
  // 1 W = 1 J/s, so one watt hour is one hour of seconds.
  assert.equal(constant('J_PER_WH'), constant('S_PER_HOUR'));
  assert.equal(constant('S_PER_DAY'), 24 * constant('S_PER_HOUR'));
  for (const year of [2018, 2024, 2025]) {
    assert.equal(
      hoursInCalendarYear(year) * constant('S_PER_HOUR'),
      secondsInUtcYear(year),
    );
  }
  assert.equal(secondsInUtcYear(2024), 366 * constant('S_PER_DAY'));
  assert.equal(secondsInUtcYear(2025), 365 * constant('S_PER_DAY'));
  // 8760 TWh spread over the 8760 hours of 2025 is exactly 1 TW.
  assert.equal(
    annualAveragePowerW(8760, 2025),
    (constant('SI_TERA') * constant('J_PER_WH')) / constant('S_PER_HOUR'),
  );
  // Prefix wiring: 11.63 GWh x 3.6 TJ/GWh = 41.868 TJ per ktoe (arithmetic).
  assert.ok(
    relativeError(JOULES_PER_UNIT.ktoe(), 41.868 * constant('SI_TERA')) < 1e-15,
  );
});

for (const golden of energyGoldens) {
  test(`golden ${golden.id}: model average power matches the cited value`, (t) => {
    const record = normalizeEnergyObservation(observation(golden));
    assert.ok(record, 'the model rejects this cited observation');
    assert.equal(record.calendarYear, golden.dataYear);
    assert.equal(record.source.releasedAt, golden.releasedAt);

    const citedW = joules(golden) / secondsInUtcYear(golden.dataYear);
    const modelW = annualAveragePowerW(record.annualTWh, record.calendarYear);
    const error = relativeError(modelW, citedW);
    t.diagnostic(
      `metric golden=${golden.id} cited_W=${citedW} model_W=${modelW} rel_err=${error}`,
    );
    assert.ok(error < 1e-12, `relative error ${error}`);

    // Second opinion: values derived outside JavaScript, in exact rationals.
    assert.ok(
      relativeError(record.annualTWh, golden.derived.annualTWh) < 1e-12,
    );
    assert.ok(relativeError(modelW, golden.derived.averagePowerW) < 1e-12);

    // A country or a final-energy total never gets a Kardashev index.
    if (golden.area.type !== 'world' || golden.measures !== 'primary')
      assert.equal(worldKardashevEstimate(observation(golden)), null);
  });
}

test('golden desnz-uk-2024-total-final-energy: leap year and final-energy scope', () => {
  const golden = fixture.goldens.find(
    (row) => row.id === 'desnz-uk-2024-total-final-energy',
  );
  assert.equal(golden.measures, 'final');
  assert.equal(golden.metric, 'total_final_energy');
  assert.equal(hoursInCalendarYear(golden.dataYear), 8784);
  // 119531.338 ktoe is about 1390 TWh a year, or about 158 GW on average.
  assert.equal(Math.round(annualTWh(golden)), 1390);
  assert.equal(
    Math.round(annualAveragePowerW(annualTWh(golden), 2024) / 1e9),
    158,
  );
});
