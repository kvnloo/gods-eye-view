import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plotMassing } from './cityMassing.js';
import { plotFromId } from './cityPlot.js';
import {
  POSTCARD_LABEL,
  POSTCARD_REQUEST_LIMIT,
  clampWipe,
  postcardAnswer,
  postcardError,
  postcardFacts,
  postcardFlag,
  postcardPrompt,
  postcardRequest,
} from './cityPostcard.js';

const plot = plotFromId('plot-n105201-126637');
const shown = (storeys) => ({
  shown: true,
  massing: plotMassing({ corners: plot.corners, storeys }),
});

test('only ?postcard=1 turns the mode on', () => {
  assert.equal(postcardFlag('?welcome=0&postcard=1'), true);
  assert.equal(postcardFlag('?postcard=0'), false);
  assert.equal(postcardFlag('?postcard=true'), false);
  assert.equal(postcardFlag(''), false);
});

test('facts come from the massing model, not from typed numbers', () => {
  const f = postcardFacts(shown(6));
  assert.deepEqual(
    { ...f },
    {
      storeys: 6,
      upperFloors: 5,
      heightMeters: 19.2,
      footprintMeters: 32,
      plotMeters: 40,
      setbackMeters: 4,
    },
  );
  assert.equal(postcardFacts(shown(3)).upperFloors, 2);
  assert.equal(postcardFacts({ shown: false, massing: null }), null);
  assert.equal(postcardFacts(undefined), null);
});

test('an inconsistent model is refused, not described', () => {
  const m = shown(6).massing;
  assert.throws(() =>
    postcardFacts({ shown: true, massing: { ...m, heightMeters: 25 } }),
  );
  assert.throws(() =>
    postcardFacts({ shown: true, massing: { ...m, storeys: 5.5 } }),
  );
  assert.throws(() =>
    postcardFacts({
      shown: true,
      massing: { ...m, footprintAreaSquareMeters: m.plotAreaSquareMeters },
    }),
  );
});

test('the prompt states the countables it was given and only those', () => {
  const p = postcardPrompt(postcardFacts(shown(6)));
  assert.match(p, /exactly 6 storeys counting the\s+ground floor/);
  assert.match(p, /exactly 5 rows of windows/);
  assert.match(p, /32 m x 32 m centred on its\s+40 m x 40 m plot/);
  assert.doesNotMatch(postcardPrompt(), /storeys/);
  assert.match(postcardPrompt(), /NOT a photo of a miniature model/);
  assert.match(postcardPrompt(), /Draw no text/);
});

test('the request respects the bridge limit and shape', () => {
  const image = 'data:image/jpeg;base64,/9j/2w==';
  assert.deepEqual(Object.keys(JSON.parse(postcardRequest('p', image))), [
    'prompt',
    'image',
  ]);
  assert.throws(() => postcardRequest('', image));
  assert.throws(() => postcardRequest('p', 'https://example.com/a.jpg'));
  const big = `data:image/jpeg;base64,${'A'.repeat(POSTCARD_REQUEST_LIMIT)}`;
  assert.throws(() => postcardRequest('p', big));
});

test('the answer is checked before it is shown', () => {
  assert.equal(
    postcardAnswer({ provider: 'local', image: 'data:image/png;base64,iVBO' }),
    'data:image/png;base64,iVBO',
  );
  assert.throws(() =>
    postcardAnswer({ provider: 'openai', image: 'data:image/png;base64,iVBO' }),
  );
  assert.throws(() =>
    postcardAnswer({ provider: 'local', image: 'javascript:alert(1)' }),
  );
  assert.throws(() =>
    postcardAnswer({
      provider: 'local',
      image: 'data:image/png;base64,iVBO',
      extra: 1,
    }),
  );
});

test('wipe clamps to 0..1 and errors stay fixed strings', () => {
  assert.equal(clampWipe(-1), 0);
  assert.equal(clampWipe(2), 1);
  assert.equal(clampWipe('0.25'), 0.25);
  assert.equal(clampWipe('x'), 0.5);
  assert.match(postcardError(404), /local image bridge/);
  assert.match(postcardError(502), /could not be made/);
  assert.equal(POSTCARD_LABEL, 'AI LOOK · NOT EVIDENCE');
});
