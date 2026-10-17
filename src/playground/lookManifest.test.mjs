import assert from 'node:assert/strict';
import test from 'node:test';
import { LOOK_PACKS } from './lookPacks.js';
import {
  LOOK_MANIFEST_SCHEMA,
  createLookManifest,
  parseLookManifest,
  serializeLookManifest,
} from './lookManifest.js';

const seed = LOOK_PACKS.find((look) => look.id === 'storybook-wilds');

test('curated look exports deterministic, credited, explicitly creative remix', () => {
  const authored = createLookManifest(seed, 'Community Artist');
  assert.equal(authored.schema, LOOK_MANIFEST_SCHEMA);
  assert.equal(authored.id, 'community-storybook-wilds');
  assert.equal(authored.creative, true);
  assert.deepEqual(authored.author, {
    name: 'Community Artist',
    basedOn: 'storybook-wilds',
  });
  assert.equal(authored.style, 'anime');
  assert.ok(Object.isFrozen(authored));
  assert.ok(Object.isFrozen(authored.grade));
  assert.ok(Object.isFrozen(authored.author));
  const text = serializeLookManifest(authored);
  assert.deepEqual(parseLookManifest(text), authored);
  assert.equal(serializeLookManifest(parseLookManifest(text)), text);
});

test('optional grade parameters get normalized to full defaults', () => {
  const edited = {
    ...createLookManifest(seed, 'Test Author'),
    grade: { warmth: 0.25, saturation: 1.4 },
  };
  const normalized = parseLookManifest(JSON.stringify(edited));
  assert.equal(normalized.grade.warmth, 0.25);
  assert.equal(normalized.grade.saturation, 1.4);
  assert.equal(normalized.grade.vignette, 0);
  assert.equal(normalized.grade.exposure, 0);
  assert.equal(Object.keys(normalized.grade).length, 7);
});

test('rejects unexpected keys, spoofed schema and malformed authorship', () => {
  const initial = createLookManifest(seed, 'Test Author');
  for (const invalid of [
    { ...initial, script: 'javascript:alert(1)' },
    { ...initial, schema: 'gev.visual-look.v0' },
    { ...initial, creative: false },
    { ...initial, id: 'original' },
    { ...initial, author: { name: 'Test Author', basedOn: 'unknown-look' } },
    { ...initial, author: { name: 'Test Author', basedOn: 'storybook-wilds', sourceUrl: 'https://example.org' } },
    { ...initial, author: { name: '' , basedOn: 'storybook-wilds' } },
    { ...initial, title: 'x'.repeat(81) },
  ]) {
    assert.throws(() => parseLookManifest(JSON.stringify(invalid)));
  }
  assert.throws(() => parseLookManifest('{ "__proto__": {}, "schema":"gev.visual-look.v1" }'));
});

test('rejects executable shader keys, nonfinite values and oversized payloads', () => {
  const initial = createLookManifest(seed, 'Test Author');
  for (const badGrade of [
    { ...initial.grade, fragmentShader: 'void main() {}' },
    { exposure: 0.7 },
    { contrast: -1 },
    null,
    [],
  ]) {
    assert.throws(() => parseLookManifest(JSON.stringify({
      ...initial,
      grade: badGrade,
    })));
  }
  assert.throws(() => parseLookManifest(' '.repeat(4100)));
  assert.throws(() => parseLookManifest('not-json'));
  assert.throws(() => parseLookManifest('null'));
});

test('prototype and noncanonical runtime records cannot escape typed boundary', () => {
  const initial = createLookManifest(seed, 'Test Author');
  const tricky = Object.create(null);
  Object.assign(tricky, initial);
  tricky.title = 'A';
  assert.throws(() => serializeLookManifest(tricky));
  const polluted = JSON.parse(JSON.stringify(initial));
  Object.defineProperty(polluted, '__proto__', { value: 1, enumerable: true });
  assert.throws(() => serializeLookManifest(polluted));
});
