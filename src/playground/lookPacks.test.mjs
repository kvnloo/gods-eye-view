import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOOK_PACKS,
  GRADE_DEFAULTS,
  COLOR_GRADE_SHADER,
  isValidLookPack,
  createLookPackController,
} from './lookPacks.js';
import { feature as toyboxFeature } from './features/05-toybox.js';

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


test('single-pass grade comparison can reveal the base lens without new GPU work', () => {
  const f = fixture();
  f.controller.apply('storybook-wilds');
  const stage = [...f.owned][0];
  assert.equal(f.controller.reveal, 1);
  assert.equal(stage.uniforms.reveal, 1);
  assert.equal(f.controller.setReveal(0.5), true);
  assert.equal(stage.uniforms.reveal, 0.5);
  assert.equal(stage.enabled, true);
  assert.equal(f.controller.setReveal(0), true);
  assert.equal(stage.enabled, false, 'no grade pass when fully unrevealed');
  assert.equal(f.controller.activeId, 'storybook-wilds');
  assert.equal(f.controller.setReveal(1), true);
  assert.equal(stage.enabled, true);
  assert.equal(f.created, 1);
  f.controller.apply('cinematic-earth');
  assert.equal(f.controller.reveal, 1, 'changing looks restores full creative view');
  assert.equal(stage.uniforms.reveal, 1);
  assert.equal(f.controller.setReveal(NaN), false);
  assert.equal(f.controller.setReveal(-0.1), false);
  assert.equal(f.controller.setReveal(1.01), false);
  assert.equal(stage.uniforms.reveal, 1);
  f.controller.apply('original');
  assert.equal(f.controller.setReveal(0.5), false);
  assert.equal(stage.enabled, false);
  f.controller.destroy();
});

test('comparison shader uses same source texture and preserves input alpha', () => {
  assert.match(COLOR_GRADE_SHADER, /uniform float reveal;/);
  assert.match(COLOR_GRADE_SHADER, /step\(uv\.x, reveal\)/);
  assert.match(COLOR_GRADE_SHADER, /mix\(source\.rgb, graded, mask\)/);
  assert.match(COLOR_GRADE_SHADER, /source\.a/);
  assert.doesNotMatch(COLOR_GRADE_SHADER, /depthTexture|framebuffer|historyTexture/);
});


test('verified user look preserves author and reuses the curated GPU grade pass', () => {
  const f = fixture();
  const custom = {
    id: 'community-storybook-wilds',
    title: 'My forest remix',
    family: 'Fantasy',
    description: 'An original color-only variation.',
    style: 'anime',
    creative: true,
    author: { name: 'Community Artist', basedOn: 'storybook-wilds' },
    grade: { ...GRADE_DEFAULTS, warmth: 0.22, saturation: 1.3 },
  };
  assert.equal(f.controller.applyVerifiedManifest(custom), true);
  assert.equal(f.controller.activeId, custom.id);
  assert.equal(f.controller.activePack.author.name, 'Community Artist');
  assert.equal(f.selections.at(-1).name, 'anime');
  assert.equal([...f.owned][0].uniforms.warmth, 0.22);
  assert.equal(f.created, 1);
  assert.equal(f.controller.apply('cinematic-earth'), true);
  assert.equal(f.created, 1);
  assert.equal(f.controller.activePack.author, undefined);
  assert.equal(f.controller.apply('original'), true);
  assert.equal([...f.owned][0].enabled, false);
  f.controller.destroy();
  assert.equal(f.owned.size, 0);
});

test('invalid community look cannot mutate current lens', () => {
  const f = fixture();
  f.controller.apply('neon-nocturne');
  const before = f.selections.length;
  const unsafe = {
    id: 'community-evil',
    title: 'Bad',
    family: 'Sci-fi',
    description: 'Not a graded look.',
    style: 'normal',
    creative: true,
    author: { name: 'Untrusted', basedOn: 'neon-nocturne' },
    grade: { fragmentShader: 'void main() {}' },
  };
  assert.equal(f.controller.applyVerifiedManifest(unsafe), false);
  assert.equal(f.selections.length, before);
  assert.equal(f.controller.activeId, 'neon-nocturne');
  f.controller.destroy();
});

// Exercise the real Toybox mount with explicit document/render stubs.
class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.listeners = {};
  }
  append(...children) {
    this.children.push(...children);
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }
  getAttribute(key) {
    return this.attributes[key] ?? null;
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ target: this });
  }
  querySelectorAll(selector) {
    const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
    const nodes = all(this);
    if (selector === '[data-look-pack]')
      return nodes.filter((node) => typeof node.dataset.lookPack === 'string');
    throw new Error('Unexpected selector: ' + selector);
  }
  focus() {}
  select() {}
}
function toyboxFixture() {
  const doc = {
    createElement(tag) {
      return new Element(doc, tag);
    },
    defaultView: {
      matchMedia: () => ({ matches: true }),
      listeners: new Set(),
      addEventListener(name, handler) {
        if (name === 'gev:style-change') this.listeners.add(handler);
      },
      removeEventListener(name, handler) {
        if (name === 'gev:style-change') this.listeners.delete(handler);
      },
      dispatchEvent(event) {
        if (event.type === 'gev:style-change') {
          for (const handler of this.listeners) handler(event);
        }
      },
    },
  };
  const root = new Element(doc, 'section');
  const managedStages = new Set();
  const viewer = {
    scene: {
      postProcessStages: {
        add(stage) {
          managedStages.add(stage);
        },
        remove(stage) {
          managedStages.delete(stage);
        },
      },
      requestRender() {},
    },
    camera: { positionWC: {}, heading: 0, pitch: 0, roll: 0 },
  };
  const styleManager = {
    activeStyle: 'normal',
    stages: Object.fromEntries(
      ['retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow'].map((n) => [n, {}]),
    ),
    setStyle(name) {
      this.activeStyle = name;
    },
  };
  const Cesium = {
    PostProcessStage: class {
      constructor(data) {
        Object.assign(this, data);
      }
    },
    Cartesian3: { clone(p) { return p; } },
  };
  const lookPacks = createLookPackController({ viewer, styleManager, Cesium });
  const dispose = toyboxFeature.mount({
    root, services: { viewer, styleManager, Cesium, lookPacks },
  });
  const findClass = (name) => root.children.find((el) => el.className === name);
  const gallery = findClass('gev-playground-look-gallery');
  const comparison = findClass('gev-playground-compare');
  const status = findClass('gev-playground-status');
  const cards = gallery.querySelectorAll('[data-look-pack]');
  const clickLook = (id) => cards.find((card) => card.dataset.lookPack === id).click();
  const selected = () => cards
    .filter((card) => card.getAttribute('aria-pressed') === 'true')
    .map((card) => card.dataset.lookPack);
  return { lookPacks, viewer, managedStages, dispose, clickLook, selected, comparison, status, doc, styleManager };
}

test('persistent Creative chip reset updates still-open Toybox selection and comparison', () => {
  const f = toyboxFixture();
  f.clickLook('storybook-wilds');
  assert.deepEqual(f.selected(), ['storybook-wilds']);
  assert.equal(f.comparison.hidden, false);
  // Outside-Toybox Reset action in src/playground/index.js.
  assert.equal(f.lookPacks.apply('original'), true);
  assert.deepEqual(f.selected(), ['original']);
  assert.equal(f.comparison.hidden, true);
  assert.equal([...f.managedStages][0].enabled, false);
  f.dispose();
});

test('external native lens overrides clear stale gallery and the disabled comparison', () => {
  const f = toyboxFixture();
  f.clickLook('neon-nocturne');
  f.lookPacks.clearGrade();
  assert.equal(f.lookPacks.activeId, null);
  assert.deepEqual(f.selected(), []);
  assert.equal(f.comparison.hidden, true);
  f.dispose();
});

test('external creative choice updates Toybox while it stays mounted', () => {
  const f = toyboxFixture();
  assert.equal(f.lookPacks.apply('arcade-racer'), true);
  assert.deepEqual(f.selected(), ['arcade-racer']);
  assert.equal(f.comparison.hidden, false);
  assert.match(f.status.textContent, /Arcade Racer/);
  f.dispose();
});

test('Toybox unmount releases its external look-state observer', () => {
  const f = toyboxFixture();
  f.clickLook('storybook-wilds');
  f.dispose();
  f.lookPacks.apply('neon-nocturne');
  assert.deepEqual(f.selected(), ['storybook-wilds']);
  assert.equal(f.lookPacks.activeId, 'neon-nocturne');
  f.lookPacks.destroy();
  assert.equal(f.managedStages.size, 0);
});

test('rapid look changes keep a single grade stage and reset comparison', () => {
  const f = toyboxFixture();
  f.clickLook('storybook-wilds');
  assert.equal(f.lookPacks.setReveal(0.4), true);
  f.clickLook('neon-nocturne');
  assert.equal(f.lookPacks.reveal, 1);
  assert.equal(f.managedStages.size, 1);
  assert.deepEqual(f.selected(), ['neon-nocturne']);
  f.dispose();
  f.lookPacks.destroy();
  assert.equal(f.managedStages.size, 0);
});

test('external reveal changes synchronize the mounted comparison without redundant updates', () => {
  const f = toyboxFixture();
  f.clickLook('storybook-wilds');
  const slider = f.comparison.children[0].children[0];
  assert.equal(slider.value, '100');
  let observed = 0;
  const unsubscribe = f.lookPacks.subscribe(() => { observed++; });
  assert.equal(f.lookPacks.setReveal(0.4), true);
  assert.equal(slider.value, '40');
  assert.equal(f.comparison.hidden, false);
  assert.equal(observed, 1);
  assert.equal(f.lookPacks.setReveal(0.4), true);
  assert.equal(observed, 1, 'unchanged reveal does not rebroadcast or redraw');
  f.lookPacks.apply('original');
  assert.equal(f.comparison.hidden, true);
  assert.deepEqual(f.selected(), ['original']);
  unsubscribe();
  f.dispose();
  f.lookPacks.destroy();
});

test('idle clear and repeated clear are no-ops for notification and scene rendering', () => {
  const f = fixture();
  f.controller.clearGrade();
  assert.equal(f.renders, 0);
  assert.deepEqual(f.notifications, []);
  f.controller.apply('cinematic-earth');
  f.controller.clearGrade();
  const previousRenders = f.renders;
  const previousNotifications = f.notifications.length;
  f.controller.clearGrade();
  assert.equal(f.renders, previousRenders);
  assert.equal(f.notifications.length, previousNotifications);
  f.controller.destroy();
});

test('Toybox native status follows external style changes and detaches its listener', () => {
  const f = toyboxFixture();
  assert.match(f.status.textContent, /Current lens: normal/);
  f.styleManager.activeStyle = 'thermal';
  f.doc.defaultView.dispatchEvent({ type: 'gev:style-change' });
  assert.match(f.status.textContent, /Current lens: thermal/);
  assert.equal(f.comparison.hidden, true);
  f.dispose();
  f.styleManager.activeStyle = 'anime';
  f.doc.defaultView.dispatchEvent({ type: 'gev:style-change' });
  assert.match(f.status.textContent, /Current lens: thermal/,
    'unmounted Toybox must not update its detached status');
  f.lookPacks.destroy();
});
