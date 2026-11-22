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
  assert.match(frame.slice(0, 2400), /scene\.requestRender\(\)/);
  assert.match(frame.slice(0, 2400), /scene\.postRender\.addEventListener/);
  // The "on" frame is the app's own (its shadow map untouched, asserted on);
  // each frame records the shadow map it was drawn with.
  assert.match(source, /if \(on !== null\) viewer\.shadows = on;/);
  assert.match(source, /const on = await appFrame\(label\);/);
  assert.doesNotMatch(source, /renderedFrame\(true\);\s*const off/);
  assert.match(frame.slice(0, 2400), /drawnWith = scene\.shadowMap\.enabled/);
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

test('the shadow is measured on the drawn block and shown as an on/off crop', () => {
  assert.match(
    source,
    /s\.sampled && s\.drawn/,
    'massing on waits until drawn',
  );
  assert.match(source, /s\.storeys === 8 && s\.drawn/, '+2 waits until drawn');
  const shadow = source.slice(
    source.indexOf("'The block casts a shadow"),
    source.indexOf("'Readout beside the plot"),
  );
  assert.match(shadow, /await shadowEvidence\('shadow'\);/);
  assert.match(shadow, /shadowCrop\(\s*'03b-shadow-crop'/);
});

test("the rendered shadow tip and Cesium's scene sun are checked against the sun module", () => {
  const shadow = source.slice(
    source.indexOf("'The block casts a shadow"),
    source.indexOf("'Readout beside the plot"),
  );
  assert.match(shadow, /sunSeparation\(cesiumSun, s\.sun\)/);
  assert.match(shadow, /separation <= 1,/);
  assert.match(shadow, /assertTip\('tip6', tip6\)/);
  const step = source.slice(source.indexOf("'Stepper +2"));
  assert.match(step, /assertTip\('tip8', tip8\)/);
  assert.match(step, /Math\.abs\(ratio - 8 \/ 6\) <= 0\.05 \* \(8 \/ 6\)/);
  // max(1 m, 5 %) of the formula, height measured to the ground at the tip.
  assert.match(source, /Math\.max\(1, 0\.05 \* tip\.expectedReach\)/);
});

test('HOMES and SHADOW REACH are read on desktop and in the phone strip', () => {
  assert.match(source, /homes: '46',/);
  assert.match(source, /shadow: '45 m',/);
  assert.match(source, /homes: '61',/);
  assert.match(source, /shadow: '59 m',/);
  const phone = source.slice(source.indexOf("'Mobile 390x844"));
  assert.match(phone, /insideViewport\(S\.extra, MOBILE\)/);
  assert.match(phone, /noOverlap\(S\.extra, other\)/);
  assert.match(phone, /legibility\('extra-mobile', S\.extra\)/);
});

test('every run cuts its own 30 s demo from the journey page, splash and shadow-off frames left out', () => {
  for (const name of [
    'select',
    'selected',
    'zone',
    'massing',
    'massingDrawn',
    'step',
    'stepDrawn',
  ])
    assert.match(source, new RegExp(`mark\\('${name}'\\)`), name);
  assert.match(source, /report\.marks\.flicker\.push/);
  assert.match(source, /demoCut\(report\.marks\)/);
  assert.match(source, /'demo\.mp4'/);
});

test('the journey checks the building on the canvas and the cast shadow of the study', () => {
  assert.match(source, /s\.blockMaterial, 'GevCityMassingFacade'/);
  assert.match(source, /s\.facade\.bands\.length, s\.storeys/);
  assert.match(source, /windows\.runs >= 0\.8 \* lines\.bays/);
  assert.match(source, /assert\.equal\(prism, 0/);
  assert.match(source, /shade\.ratio <= 0\.75/);
  assert.match(source, /beside\.ratio >= 0\.95/);
  assert.match(source, /assert\.equal\(patch, false/);
});
