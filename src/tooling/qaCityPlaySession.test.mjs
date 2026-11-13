import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The recorded play journey is one page session: a reload mid-journey shows the
// loading splash in the video and reads as a crash. Restore is proven in a
// fresh page of the same browser context after the journey page closes.
test('qa-city-play never reloads mid-journey; restore runs in a fresh page', () => {
  const source = readFileSync(
    new URL('../../scripts/qa-city-play.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\.reload\(/, 'no page reload in the journey');
  assert.match(
    source,
    /await journey\.close\(\);\s*page = await openPage\(context, 'restore'\);/,
    'the restore check opens a new page only after the journey page closes',
  );
});

// A plot is reselected where it stands on screen now, on its own concept (the
// app selects that by plot identity), never at a coordinate saved before
// another plot was selected: a ground click there once selected the cell
// beside it (Boat gate d7d5f4f9, ZONE step).
test('qa-city-play reselects a plot by projecting it now, not at a saved coordinate', () => {
  const source = readFileSync(
    new URL('../../scripts/qa-city-play.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /async function plotOnScreen\(plot[^)]*\)/,
    'the journey projects a plot from its own centre when it clicks it',
  );
  assert.doesNotMatch(
    source,
    /mouse\.click\(\s*firstAt\.x/,
    'the first plot is not clicked at its position from before the second selection',
  );
  assert.match(
    source,
    /const again = await plotOnScreen\(first\.plot[^)]*\);\s*await page\.mouse\.click\(again\.x, again\.y\);/,
    'the first plot is reselected at its projected position',
  );
});
