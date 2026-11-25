import assert from 'node:assert/strict';
import test from 'node:test';
import { captureJudgeFrame } from '../../downstream/city-loop/capture/judge-frame.mjs';

test('select captures a clean surface even when Cesium retains a Google logo', async () => {
  const image = { src: 'https://assets.ion.cesium.com/google-credit.png' };
  let style;
  const scene = { primitives: [], globe: { show: false } };
  const page = {
    async evaluate(fn) {
      globalThis.window = { __godsEyeView: { viewer: { scene } } };
      globalThis.document = { querySelectorAll: () => [image] };
      globalThis.getComputedStyle = () => ({ display: style ? 'none' : 'inline' });
      try {
        return fn();
      } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.getComputedStyle;
      }
    },
    async addStyleTag({ content }) {
      assert.match(content, /img\[src\*="google" i\]/);
      style = true;
      return { async evaluate() { style = false; } };
    },
    async screenshot() {
      assert.ok(style, 'the stale logo is suppressed during capture');
      return Buffer.from('png');
    },
  };
  const result = await captureJudgeFrame(page, 'select--own');
  assert.equal(result.tiles.googleTiles, false);
  assert.equal(result.tiles.googleLogos, 0);
  assert.equal(style, false, 'the attribution styles are restored');

  scene.primitives = { length: 1, get: () => ({ tilesLoaded: true, root: {}, show: true }) };
  await assert.rejects(captureJudgeFrame(page, 'select--own'), /refused/);
  assert.equal(style, false, 'a visible tileset never authorizes suppressing attribution');
});
