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
