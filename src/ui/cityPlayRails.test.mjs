import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('./styles/city-play.css', import.meta.url),
  'utf8',
);

// The rails fade for 300 ms after play mode starts. Their panels and buttons
// set `pointer-events: auto` themselves (kit.css .ui-rail), so the rule on the
// rail alone leaves them taking clicks meant for the map (#319).
test('play mode takes clicks away from everything inside the rails at once', () => {
  for (const rail of ['#left-panel-stack', '#right-context-rail', '#pp-toggles'])
    assert.match(
      css,
      new RegExp(
        `body\\.gev-city-play ${rail} \\*[^{]*\\{[^}]*pointer-events:\\s*none\\s*!important`,
      ),
      `${rail} descendants`,
    );
});
