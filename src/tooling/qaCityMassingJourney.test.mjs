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
  const step = source.slice(source.indexOf("'Stepper +2"));
  assert.equal(
    (step.slice(0, 400).match(/locator\(S\.plus\)\.click\(\)/g) ?? []).length,
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
