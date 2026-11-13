import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The massing journey proves the round-3 contract end to end; this guard fails
// when a step it depends on drops out of scripts/qa-city-massing.mjs.
const source = readFileSync(
  new URL('../../scripts/qa-city-massing.mjs', import.meta.url),
  'utf8',
);

test('qa-city-massing runs with the flag on and proves a flag-off page has no massing', () => {
  assert.match(source, /await startup\(true\);/);
  assert.match(source, /await startup\(false\);/);
  assert.match(source, /probe: '__gevCityMassing' in window/);
});

test('the stepper goes +2 and the numbers and block are checked at 8 storeys', () => {
  const step = source.slice(
    source.indexOf("'Stepper +2"),
    source.indexOf('await page.close();'),
  );
  assert.equal(
    (step.match(/locator\(S\.plus\)\.click\(\)/g) ?? []).length,
    2,
    'two clicks on +',
  );
  assert.match(step, /storeys: '8'/);
  assert.match(
    step,
    /blockExtrudedHeight/,
    'the block entity itself re-extrudes',
  );
});

test('reload is a fresh page that recomputes massing instead of restoring it', () => {
  assert.doesNotMatch(source, /\.reload\(/, 'no reload mid-journey');
  assert.match(
    source,
    /await page\.close\(\);\s*page = await openPage\(context, 'restore'\);/,
  );
  const restore = source.slice(source.indexOf("openPage(context, 'restore')"));
  assert.match(restore, /storeys start from the default/);
  assert.match(restore, /the save is untouched/);
});

test('the journey covers a 390x844 phone', () => {
  assert.match(source, /const MOBILE = \{ width: 390, height: 844 \};/);
  assert.match(source, /setViewportSize\(MOBILE\)/);
  assert.match(source, /insideViewport\(S\.readout, MOBILE\)/);
});

test('the journey keeps its grounding, shadow and readout checks', () => {
  // 1: one toggle before massing, a saved zoned plot to compare with.
  assert.match(source, /count\(\), 1\)/);
  assert.match(source, /await zonePlot\('housing'\);/);
  // 2: the drawn block's base against the ground sampled at the plot centre.
  assert.match(source, /Math\.abs\(s\.blockBase - ground\) <= 0\.5/);
  // 3: the cast shadow measured in pixels, and lengthened by +2 storeys.
  assert.match(source, /await shadowEvidence\('shadow'\);/);
  assert.match(source, /shade8\.ratio < 0\.8/);
  // 4: the readout covers nothing and every label is legible.
  assert.match(source, /await clearOfMassing\(shadow6\.shadePoints\);/);
  assert.match(
    source,
    /for \(const other of HUD\) await noOverlap\(S\.readout, other\);/,
  );
  assert.match(source, /await legibility\('readout'\);/);
});

test('the reference ground is sampled before MASSING cuts the plot out of 3D tiles', () => {
  const grounding = source.slice(
    source.indexOf("'MASSING on: a ground plate"),
    source.indexOf("'The block casts a shadow"),
  );
  const sampled = grounding.indexOf('await groundSamples()');
  assert.ok(sampled > 0, 'the ground is sampled in the grounding check');
  assert.ok(
    sampled < grounding.indexOf('await massingOn(plotId)'),
    'before the toggle, so the photoreal cut cannot hide the ground',
  );
  assert.match(grounding, /Math\.abs\(s\.blockBase - ground\) <= 0\.5/);
  // On 3D tiles nothing of the mesh may stand above the base inside the plot.
  assert.match(grounding, /await cutEvidence\(samples, s\)/);
});

test('each shadow capture is a newly rendered frame; identical captures fail the run as INVALID', () => {
  const frame = source.slice(source.indexOf('async function renderedFrame'));
  assert.match(frame.slice(0, 1200), /scene\.requestRender\(\)/);
  assert.match(frame.slice(0, 1200), /scene\.postRender\.addEventListener/);
  const lum = source.slice(source.indexOf('async function luminance'));
  assert.match(lum.slice(0, 2000), /distinctFrames\(on, off, label\)/);
  assert.match(source, /error instanceof InvalidMeasurement/);
  assert.match(source, /report\.status = invalid \? 'invalid' : 'fail'/);
});

test('QA_PLOT selects the plot by id, by default one over a real building', () => {
  assert.match(
    source,
    /const PLOT = process\.env\.QA_PLOT \|\| 'plot-n105201-126637';/,
  );
  assert.match(source, /assert\.equal\(\(await play\(\)\)\.plot\.id, PLOT/);
});
