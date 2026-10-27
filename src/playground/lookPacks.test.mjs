import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOOK_PACKS,
  GRADE_DEFAULTS,
  COLOR_GRADE_SHADER,
  isValidLookPack,
  createLookPackController,
} from './lookPacks.js';

function fixture() {
  const owned = new Set();
  const selections = [];
  const notifications = [];
  const activeStages = {};
  for (const name of ['retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow'])
    activeStages[name] = { uniforms: {} };
  let renders = 0;
  let created = 0;
  const controller = createLookPackController({
    viewer: { scene: {
      postProcessStages: {
        add(stage) { owned.add(stage); },
        remove(stage) { owned.delete(stage); },
      },
      requestRender() { renders++; },
    } },
    Cesium: { PostProcessStage: class {
      constructor(options) {
        created++;
        Object.assign(this, options);
      }
    } },
    onChange(id) { notifications.push(id); },
    styleManager: {
      stages: activeStages,
      setStyle(name, options) { selections.push({ name, options }); },
    },
  });
  return {
    controller, owned, selections, notifications, activeStages,
    get renders() { return renders; },
    get created() { return created; },
  };
}

test('the curated catalog has unique bounded data-only packs', () => {
  assert.equal(LOOK_PACKS.length, 9);
  assert.equal(new Set(LOOK_PACKS.map((pack) => pack.id)).size, 9);
  assert.ok(LOOK_PACKS.every(isValidLookPack));
  assert.ok(LOOK_PACKS.every(Object.isFrozen));
  assert.ok(LOOK_PACKS.filter((pack) => pack.grade).every((pack) =>
    Object.isFrozen(pack.grade)));
  assert.equal(LOOK_PACKS.find((pack) => pack.id === 'original').grade, null);
});

test('invalid, unsafe, and nonfinite pack metadata is rejected', () => {
  const base = LOOK_PACKS.find((pack) => pack.id === 'cinematic-earth');
  assert.equal(isValidLookPack({ ...base, id: 'javascript:evil' }), false);
  assert.equal(isValidLookPack({ ...base, style: 'remoteShader' }), false);
  assert.equal(isValidLookPack({ ...base, grade: { exposure: Infinity } }), false);
  assert.equal(isValidLookPack({ ...base, grade: { exposure: 15 } }), false);
  assert.equal(isValidLookPack({ ...base, grade: { fragmentShader: 'anything' } }), false);
  assert.equal(isValidLookPack({ ...base, grade: ['bad'] }), false);
});

test('the static grade shader samples only the scene and declares all uniforms', () => {
  assert.match(COLOR_GRADE_SHADER, /texture\(colorTexture, uv\)/);
  for (const key of Object.keys(GRADE_DEFAULTS))
    assert.match(COLOR_GRADE_SHADER, new RegExp('uniform float ' + key + ';'));
  assert.doesNotMatch(COLOR_GRADE_SHADER, /depthTexture|fetch\(/);
});

test('creative styles reuse one owned stage and can be reset to original', () => {
  const f = fixture();
  assert.equal(f.controller.apply('cinematic-earth'), true);
  assert.equal(f.created, 1);
  assert.equal(f.owned.size, 1);
  const stage = [...f.owned][0];
  assert.equal(stage.enabled, true);
  assert.equal(stage.uniforms.contrast, 1.13);
  assert.equal(f.selections[0].name, 'normal');
  assert.equal(f.selections[0].options.applyPreset, false);
  assert.equal(f.controller.activeId, 'cinematic-earth');
  assert.deepEqual(f.notifications, ['cinematic-earth']);

  assert.equal(f.controller.apply('storybook-wilds'), true);
  assert.equal(f.created, 1);
  assert.equal(f.owned.size, 1);
  assert.equal(f.selections[1].name, 'anime');
  assert.equal(stage.uniforms.contrast, 1.06);
  assert.equal(stage.uniforms.warmth, 0.48);

  assert.equal(f.controller.apply('original'), true);
  assert.equal(stage.enabled, false);
  assert.equal(f.controller.activeId, 'original');
  assert.equal(f.selections.at(-1).name, 'normal');
  assert.deepEqual(f.notifications.slice(0, 3), [
    'cinematic-earth', 'storybook-wilds', 'original',
  ]);
  assert.ok(f.renders >= 3);
  f.controller.destroy();
  f.controller.destroy();
  assert.equal(f.owned.size, 0);
  assert.equal(f.notifications.at(-1), null);
  assert.equal(f.controller.apply('storybook-wilds'), false);
});

test('base-style mutation is marked internal during look application', () => {
  const f = fixture();
  assert.equal(f.controller.applyingBaseStyle, false);
  f.controller.apply('cinematic-earth');
  assert.equal(f.controller.applyingBaseStyle, false);
  f.controller.destroy();
});

test('unknown pack and missing base shader do not alter rendering', () => {
  const f = fixture();
  assert.equal(f.controller.apply('made-up'), false);
  delete f.activeStages.anime;
  assert.equal(f.controller.apply('storybook-wilds'), false);
  assert.equal(f.created, 0);
  assert.equal(f.renders, 0);
  assert.equal(f.selections.length, 0);
});

test('quick sensor lens can clear creative grade without changing selected style', () => {
  const f = fixture();
  f.controller.apply('frontier-film');
  const stage = [...f.owned][0];
  const before = f.selections.length;
  f.controller.clearGrade();
  assert.equal(stage.enabled, false);
  assert.equal(f.controller.activeId, null);
  assert.equal(f.selections.length, before);
  f.controller.destroy();
});
