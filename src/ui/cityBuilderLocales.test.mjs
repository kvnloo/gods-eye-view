import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCityBuilderLocales } from '../../scripts/city-builder-locales.mjs';

test('every City builder and legacy preview message is translated in every catalog', () => {
  const { messages, locales, problems } = checkCityBuilderLocales();
  assert.ok(messages.has('City builder'));
  assert.ok(locales.includes('he.json'));
  assert.deepEqual(problems, []);
});
