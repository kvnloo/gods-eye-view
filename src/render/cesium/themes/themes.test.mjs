import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST_EFFECTS, EFFECT_IDS, defaultsOf } from './effectLibrary.js';
import { TILE_UNIFORMS, TILE_GLSL } from './tileStage.js';
import {
  BUILT_IN_PRESETS,
  normalizePreset,
  presetRequest,
  loadPreset,
} from './presets.js';
import { parseCustomEffect } from './customEffects.js';
import { composeFragment } from './tileShaderHost.js';
import { cityLookFlags } from '../../../data/cityLookFlags.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

test('every declared effect uniform is a uniform of its shader, with UI annotations', () => {
  for (const effect of POST_EFFECTS) {
    const sources = effect.passes
      ? effect.passes.map((p) => p.fragmentShader).join('\n')
      : effect.fragmentShader;
    for (const [name, spec] of Object.entries(effect.uniforms)) {
      assert.match(
        sources,
        new RegExp(`uniform (float|vec3) ${name};`),
        `${effect.id}.${name}`,
      );
      assert.ok(spec.label, `${effect.id}.${name} label`);
      assert.ok(
        ['float', 'bool', 'color'].includes(spec.type),
        `${effect.id}.${name} type`,
      );
      if (spec.type === 'float')
        assert.ok(
          spec.min <= spec.default && spec.default <= spec.max,
          `${effect.id}.${name} range`,
        );
    }
    if (effect.launchpad)
      assert.match(sources, /uniform sampler2D launchpadTexture;/);
  }
  for (const name of Object.keys(TILE_UNIFORMS))
    assert.match(TILE_GLSL, new RegExp(`u_th_${name}\\b`));
});

test('built-in presets name only library effects and declared uniforms', () => {
  const declared = (id) =>
    id === 'tile'
      ? TILE_UNIFORMS
      : POST_EFFECTS.find((e) => e.id === id).uniforms;
  for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
    const { problems } = normalizePreset(preset);
    assert.deepEqual(problems, [], name);
    for (const id of preset.techniques)
      assert.ok(EFFECT_IDS.includes(id), `${name}: ${id}`);
    for (const [id, values] of Object.entries(preset.uniforms))
      for (const k of Object.keys(values))
        assert.ok(k in declared(id), `${name}: ${id}.${k}`);
  }
  assert.ok(BUILT_IN_PRESETS.wintercats.techniques.includes('tile'));
  assert.equal(BUILT_IN_PRESETS.none.techniques.length, 0);
  assert.equal(BUILT_IN_PRESETS.none.quality, undefined);
  for (const name of ['wintercats', 'enhanced-realism']) {
    const q = normalizePreset(BUILT_IN_PRESETS[name]).preset.quality;
    assert.deepEqual(
      [q.resolutionScale, q.maximumScreenSpaceError, q.msaa],
      ['dpr', 8, 4],
    );
  }
});

test('a malformed preset is cleaned, never thrown', () => {
  const { preset, problems } = normalizePreset({
    techniques: ['tile', 'nope', 'tile', 'lut'],
    uniforms: { lut: { lutStrength: 'x', ok: 0.5 }, ghost: { a: 1 } },
    textures: { lutTexture: 'javascript:alert(1)' },
    perfTier: 'ultra',
  });
  assert.deepEqual(preset.techniques, ['tile', 'lut']);
  assert.deepEqual(preset.uniforms.lut, { ok: 0.5 });
  assert.deepEqual(preset.textures, {});
  assert.equal(preset.perfTier, 'medium');
  assert.ok(problems.length >= 4);
  assert.deepEqual(normalizePreset(null).preset.techniques, []);
});

test('the page asks for a theme with ?preset= or ?theme=', () => {
  assert.equal(presetRequest(''), null);
  assert.deepEqual(
    presetRequest('?theme=wintercats&themeWipe=0.4&themePanel=1'),
    {
      value: 'wintercats',
      wipe: 0.4,
      panel: true,
      budget: true,
      quality: true,
      osm: true,
      osmDebug: false,
    },
  );
  assert.equal(presetRequest('?preset=/p.json&themeBudget=0').budget, false);
  assert.equal(presetRequest('?preset=none&themeOsm=0').osm, false);
  assert.equal(presetRequest('?preset=none&themeOsmDebug=1').osmDebug, true);
});

test('loadPreset resolves built-ins and fetches URLs', async () => {
  assert.equal((await loadPreset('wintercats')).preset.name, 'wintercats');
  assert.deepEqual((await loadPreset('bogus')).problems, [
    'unknown preset bogus',
  ]);
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ name: 'mine', techniques: ['grade'] }),
  });
  const { preset } = await loadPreset('/presets/mine.json', { fetchImpl });
  assert.deepEqual([preset.name, preset.techniques], ['mine', ['grade']]);
});

test('custom effects parse from a header + GLSL file, and bad ones are refused', () => {
  const file = `/*! gev-effect
{ "id": "ink", "depth": true, "uniforms": { "inkStrength": { "type": "float", "default": 0.5 } } } */
void main() { out_FragColor = texture(colorTexture, v_textureCoordinates) * inkStrength; }`;
  const { effect, problems } = parseCustomEffect(file);
  assert.deepEqual(problems, []);
  assert.equal(effect.id, 'ink');
  assert.match(effect.fragmentShader, /uniform float inkStrength;/);
  assert.match(effect.fragmentShader, /vec3 fx_eye/);
  assert.deepEqual(defaultsOf(effect.uniforms), { inkStrength: 0.5 });
  assert.ok(parseCustomEffect('void main(){}').problems.length);
  assert.ok(
    parseCustomEffect(
      '/*! gev-effect {"id":"lut"} */ void main(){}',
    ).problems[0].includes('built-in'),
  );
  assert.ok(
    parseCustomEffect(
      '/*! gev-effect {"id":"x1","uniforms":{"colorTexture":{"type":"float"}}} */ void main(){}',
    ).problems.some((p) => p.includes('bad uniform name')),
  );
  assert.ok(
    parseCustomEffect(
      '/*! gev-effect {"id":"x2"} */ #version 300 es\nvoid main(){}',
    ).problems.length,
  );
});

test('the shader host composes parts in order inside one fragmentMain', () => {
  const src = composeFragment([
    { id: 'seat', order: 10, glsl: 'void b() {}', body: 'b();' },
    { id: 'theme', order: 0, glsl: 'void a() {}', body: 'a();' },
  ]);
  assert.ok(src.indexOf('a();') < src.indexOf('b();'));
  assert.equal(src.match(/void fragmentMain/g).length, 1);
});

test('the wintercats LUT ships as a 33-cube strip PNG', () => {
  const png = fs.readFileSync(
    path.join(ROOT, 'public/themes/luts/wintercats.png'),
  );
  assert.equal(png.readUInt32BE(16), 33 * 33);
  assert.equal(png.readUInt32BE(20), 33);
});

test('a whole-globe theme turns the island looks off', () => {
  assert.equal(cityLookFlags('?city=hero').look, 'diorama');
  assert.equal(cityLookFlags('?city=hero&theme=wintercats').look, null);
  assert.equal(cityLookFlags('?look=cozy&preset=cozy').look, null);
  assert.equal(cityLookFlags('?look=cozy').look, 'cozy');
});

test('the documented fantasy preset loads with its carried custom effect', () => {
  const file = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public/presets/elven-moon.json'), 'utf8'),
  );
  const { preset, problems } = normalizePreset(file);
  assert.deepEqual(problems, []);
  assert.ok(preset.techniques.includes('ink'));
  assert.equal(parseCustomEffect(preset.effects[0]).effect.id, 'ink');
});

test('a preset hud block dims the scope mask and bad values are dropped', () => {
  const ok = normalizePreset({ techniques: [], hud: { scopeMask: 0.15 } });
  assert.deepEqual(ok.preset.hud, { scopeMask: 0.15 });
  assert.deepEqual(ok.problems, []);
  const bad = normalizePreset({ techniques: [], hud: { scopeMask: 3 } });
  assert.deepEqual(bad.preset.hud, {});
  assert.ok(bad.problems.includes('bad hud.scopeMask'));
  assert.equal(normalizePreset({ techniques: [] }).preset.hud, null);
});

test('every tile-stage uniform is used by the tile GLSL', () => {
  for (const k of Object.keys(TILE_UNIFORMS))
    assert.match(TILE_GLSL, new RegExp(`u_th_${k}\\b`), k);
});
