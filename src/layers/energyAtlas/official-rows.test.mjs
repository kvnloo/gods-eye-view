import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annualAveragePowerW,
  normalizeEnergyObservation,
  normalizeEnergySnapshot,
  sameComparableMetric,
} from './model.js';

// Official rows exactly as the publishers print them: geography code, value
// and unit. This file measures how many of them the model ingests with no
// hand conversion. The reference power is the hand conversion that
// goldens.test.mjs uses, built from the cited constants of its fixture.
const load = (name) =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'),
  );
const fixture = load('official-rows.json');
const goldens = load('energy-goldens.json');

const constant = (id) => {
  const row = goldens.constants[id];
  assert.ok(row, `no cited constant ${id}`);
  return row.value;
};

// Joules in one unit, keyed by the unit as published. Same factors as
// JOULES_PER_UNIT in goldens.test.mjs.
const JOULES_PER_PUBLISHED_UNIT = {
  ktoe: constant('GWH_PER_KTOE') * constant('SI_GIGA') * constant('J_PER_WH'),
  'Quadrillion Btu': constant('J_PER_QUAD'),
  Terajoules: constant('SI_TERA'),
};

// Independent of the model: the Gregorian calendar gives the year length.
const secondsInUtcYear = (year) =>
  (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 1000;

const handConvertedW = (row) =>
  (row.valueAsPublished * JOULES_PER_PUBLISHED_UNIT[row.unitAsPublished]) /
  secondsInUtcYear(row.dataYear);

// The row goes to the model as published: no arithmetic and no code
// crosswalk. Only a row with no published geography code takes a declared id.
const asPublished = (row) => ({
  schemaVersion: 1,
  area: {
    id:
      row.geographyCode === null
        ? row.declared.areaId
        : `${row.geographyCodeScheme}:${row.geographyCode}`,
    type: row.declared.areaType,
    boundaryDataset: row.declared.boundaryDataset,
    boundaryRevision: row.declared.boundaryRevision,
  },
  metric: row.declared.metric,
  calendarYear: row.dataYear,
  published: { value: row.valueAsPublished, unit: row.unitAsPublished },
  status: row.declared.status,
  geographyCoverage: row.declared.geographyCoverage,
  source: {
    publisher: row.publisher,
    url: row.url,
    datasetVersion: row.releasedAt,
    releasedAt: row.releasedAt,
    licence: row.licence,
    attribution: row.attribution,
  },
});

const relativeError = (model, cited) => Math.abs(model - cited) / cited;
const rowById = (id) => fixture.rows.find((row) => row.id === id);

// Null when the model ingests the row unchanged, else the reason it does not.
function ingestFailure(row) {
  const input = asPublished(row);
  const record = normalizeEnergyObservation(input);
  if (!record) return 'the model rejects the row as published';
  if (record.area.id !== input.area.id) return 'the geography code changed';
  if (
    record.published?.value !== row.valueAsPublished ||
    record.published?.unit !== row.unitAsPublished
  )
    return 'the record does not carry the value and unit as published';
  const modelW = annualAveragePowerW(record.annualTWh, record.calendarYear);
  const error = relativeError(modelW, handConvertedW(row));
  return error < 1e-9
    ? null
    : `average power is not the hand conversion (relative error ${error})`;
}

test('every official row carries a complete citation and a licence that allows redistribution', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, 'test-fixture');
  const ids = fixture.rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of fixture.rows) {
    for (const field of [
      'publisher',
      'dataset',
      'table',
      'releasedAtSource',
      'geographyLabel',
      'unitAsPublished',
      'unitSource',
      'attribution',
      'note',
    ])
      assert.ok(row[field]?.trim(), `${row.id} lacks ${field}`);
    for (const field of ['url', 'fileUrl', 'licenceUrl'])
      assert.equal(new URL(row[field]).protocol, 'https:', row.id);
    assert.match(row.fileSha256, /^[0-9a-f]{64}$/, row.id);
    assert.match(row.releasedAt, /^\d{4}-\d{2}-\d{2}$/, row.id);
    assert.ok(Number.isInteger(row.dataYear), row.id);
    assert.ok(Number.isFinite(row.valueAsPublished), row.id);
    assert.ok(row.valueAsPublished > 0, row.id);
    // The number is the one the file stores, digit for digit.
    assert.equal(Number(row.valueTextInFile), row.valueAsPublished, row.id);
    assert.ok(
      [
        'Open Government Licence v3.0',
        'Public domain (U.S. government publication)',
        'Statistics Canada Open Licence',
      ].includes(row.licence),
      `${row.id}: licence ${row.licence}`,
    );
    assert.doesNotMatch(row.publisher, /IEA|International Energy Agency/);
    // A published code has a scheme and no declared id; else the reverse.
    assert.equal(
      row.geographyCode === null,
      row.declared.areaId !== undefined,
      row.id,
    );
    assert.equal(
      row.geographyCode === null,
      row.geographyCodeScheme === null,
      row.id,
    );
    // Second opinion: reference power derived outside JavaScript.
    assert.ok(
      relativeError(handConvertedW(row), row.derived.averagePowerW) < 1e-12,
      row.id,
    );
  }
});

test('the fixture holds the five UK geographies of one DESNZ table by GSS code', () => {
  const uk = fixture.rows.filter((row) => row.geographyCodeScheme === 'GSS');
  assert.deepEqual(
    uk.map((row) => row.geographyCode),
    ['K02000001', 'E92000001', 'W92000004', 'S92000003', 'N92000002'],
  );
  assert.equal(new Set(uk.map((row) => row.fileSha256)).size, 1);
  assert.equal(new Set(uk.map((row) => row.unitAsPublished)).size, 1);
  for (const row of uk) assert.equal(row.declared.areaType, 'country');
});

test('rows that restate a #318 golden carry the same published value', () => {
  const restated = fixture.rows.filter((row) => row.goldenId);
  assert.equal(restated.length, 3);
  for (const row of restated) {
    const golden = goldens.goldens.find((entry) => entry.id === row.goldenId);
    assert.ok(golden, `${row.id}: no golden ${row.goldenId}`);
    assert.equal(row.valueAsPublished, golden.valueAsPublished, row.id);
    assert.equal(row.dataYear, golden.dataYear, row.id);
    assert.equal(row.fileSha256, golden.fileSha256, row.id);
    assert.equal(row.releasedAt, golden.releasedAt, row.id);
    assert.ok(
      relativeError(handConvertedW(row), golden.derived.averagePowerW) < 1e-12,
      row.id,
    );
  }
});

for (const row of fixture.rows) {
  test(`official row ${row.id}: ingested unchanged`, (t) => {
    const failure = ingestFailure(row);
    t.diagnostic(
      `row=${row.id} code=${row.geographyCode} value=${row.valueAsPublished} unit=${row.unitAsPublished} ingested_unchanged=${failure === null}${failure ? ` reason=${failure}` : ''}`,
    );
    assert.equal(failure, null);
  });
}

test('metric: official rows ingested unchanged / total rows', (t) => {
  const ingested = fixture.rows.filter((row) => ingestFailure(row) === null);
  t.diagnostic(
    `metric rows_ingested_unchanged=${ingested.length}/${fixture.rows.length}`,
  );
  assert.equal(fixture.rows.length, 7);
  assert.equal(ingested.length, fixture.rows.length);
});

test('published value and unit: the model converts, keeps both and fails closed', () => {
  const usa = asPublished(rowById('eia-2024-TETCBUS'));
  const record = normalizeEnergyObservation(usa);
  assert.ok(record, 'the model rejects the row as published');
  assert.deepEqual(record.published, usa.published);
  assert.notEqual(record.published, usa.published);
  assert.ok(Object.isFrozen(record.published));
  // Normalizing a normalized record changes nothing.
  assert.deepEqual(normalizeEnergyObservation(record), record);
  // A TWh figure beside the published value must be its conversion.
  assert.equal(
    normalizeEnergyObservation({ ...usa, annualTWh: record.annualTWh + 1 }),
    null,
  );
  // The unit matches exactly as printed; an unknown unit is never guessed.
  for (const unit of [
    'quadrillion Btu',
    ' Quadrillion Btu',
    'Quad',
    'Btu',
    '',
    'constructor',
    '__proto__',
    null,
    undefined,
    15,
    new String('Quadrillion Btu'),
  ])
    assert.equal(
      normalizeEnergyObservation({
        ...usa,
        published: { ...usa.published, unit },
      }),
      null,
      `unit ${String(unit)}`,
    );
  // Blank, text, negative and non-finite values never become a number.
  for (const value of [null, undefined, NaN, Infinity, -1, '94.582337'])
    assert.equal(
      normalizeEnergyObservation({
        ...usa,
        published: { ...usa.published, value },
      }),
      null,
      `value ${String(value)}`,
    );
  for (const published of [[], 'Quadrillion Btu', 94.582337, true, 0, ''])
    assert.equal(normalizeEnergyObservation({ ...usa, published }), null);
  // A missing observation carries no published number.
  assert.equal(normalizeEnergyObservation({ ...usa, status: 'missing' }), null);
  // An explicit published zero stays zero.
  assert.equal(
    normalizeEnergyObservation({
      ...usa,
      published: { value: 0, unit: 'Quadrillion Btu' },
    }).annualTWh,
    0,
  );
  // A record given in TWh keeps its shape: no published field appears.
  const twh = normalizeEnergyObservation({
    ...usa,
    published: undefined,
    annualTWh: 1,
  });
  assert.equal(twh.annualTWh, 1);
  assert.equal(Object.hasOwn(twh, 'published'), false);
});

test('GSS-coded UK countries: only the five published codes are countries', () => {
  const uk = asPublished(rowById('desnz-2024-K02000001'));
  const withId = (id) => ({ ...uk, area: { ...uk.area, id } });
  for (const code of [
    'K02000001',
    'E92000001',
    'W92000004',
    'S92000003',
    'N92000002',
  ]) {
    const record = normalizeEnergyObservation(withId(`GSS:${code}`));
    assert.equal(record?.area.id, `GSS:${code}`);
    assert.equal(record.area.type, 'country');
  }
  // Groupings (Great Britain, England and Wales), regions, local authorities
  // and unknown or reshaped codes are not countries.
  for (const id of [
    'GSS:K03000001',
    'GSS:K04000001',
    'GSS:E12000007',
    'GSS:E09000001',
    'GSS:E92000002',
    'GSS:K02000001 ',
    'gss:K02000001',
    'K02000001',
    'GSS:DUKES',
    'ISO3:K02000001',
  ])
    assert.equal(normalizeEnergyObservation(withId(id)), null, id);
  // An ISO3 country id still works.
  assert.ok(normalizeEnergyObservation(withId('ISO3:GBR')));

  // 119531.338 ktoe is about 1390 TWh: the same quantity as the #318 golden.
  assert.equal(Math.round(normalizeEnergyObservation(uk).annualTWh), 1390);

  // One snapshot holds the UK and its four countries, no duplicate claim.
  const rows = fixture.rows.filter((row) => row.geographyCodeScheme === 'GSS');
  assert.equal(normalizeEnergySnapshot(rows.map(asPublished))?.length, 5);
  assert.equal(normalizeEnergySnapshot([uk, uk]), null);

  // Like compares with like: Scotland and Northern Ireland are both complete
  // rows of one table; England and Wales are declared partial, so they do not.
  const published = (id) => asPublished(rowById(id));
  assert.equal(
    sameComparableMetric(
      published('desnz-2024-S92000003'),
      published('desnz-2024-N92000002'),
    ),
    true,
  );
  assert.equal(
    sameComparableMetric(
      published('desnz-2024-E92000001'),
      published('desnz-2024-W92000004'),
    ),
    false,
  );
});

test('Statistics Canada DGUID: only the country code for Canada is a country', () => {
  const canada = asPublished(rowById('statcan-2024-2021A000011124'));
  const withArea = (area) => ({ ...canada, area: { ...canada.area, ...area } });
  const record = normalizeEnergyObservation(canada);
  assert.equal(record?.area.id, 'DGUID:2021A000011124');
  assert.deepEqual(record.published, { value: 8386544, unit: 'Terajoules' });
  // 8386544 TJ is about 2330 TWh: the same quantity as the #318 golden.
  assert.equal(Math.round(record.annualTWh), 2330);
  // The vintage may differ; type A, schema 0000 and GEOUID 11124 may not.
  assert.ok(
    normalizeEnergyObservation(withArea({ id: 'DGUID:2016A000011124' })),
  );
  for (const id of [
    'DGUID:2021A000224',
    'DGUID:2021A000211124',
    'DGUID:2021S000011124',
    'DGUID:2021A00001112',
    'DGUID:21A000011124',
    'DGUID:2021A000011124 ',
    'dguid:2021A000011124',
    '2021A000011124',
    'GSS:2021A000011124',
  ])
    assert.equal(normalizeEnergyObservation(withArea({ id })), null, id);
  // A province-level DGUID is no sub-national id either: that pilot stays UK.
  for (const type of ['region', 'state', 'county', 'local_authority'])
    for (const id of ['DGUID:2021A000224', 'DGUID:2021A000011124'])
      assert.equal(
        normalizeEnergyObservation(withArea({ id, type })),
        null,
        `${type} ${id}`,
      );
  // Canada and the UK publish final energy to different definitions: the
  // model still refuses to rank one national row against the other.
  assert.equal(
    sameComparableMetric(canada, asPublished(rowById('desnz-2024-K02000001'))),
    false,
  );
});
