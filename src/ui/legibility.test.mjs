import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseColor,
  composite,
  contrastRatio,
  textLegibility,
} from './legibility.js';

test('parseColor reads the computed colour forms browsers return', () => {
  assert.deepEqual(parseColor('rgb(232, 234, 237)'), [232, 234, 237, 1]);
  assert.deepEqual(parseColor('rgba(12, 12, 20, 0.72)'), [12, 12, 20, 0.72]);
  // color-mix() computes to color(srgb r g b / a) with 0..1 channels.
  assert.deepEqual(
    parseColor('color(srgb 1 0.5 0 / 0.25)'),
    [255, 127.5, 0, 0.25],
  );
  assert.deepEqual(parseColor('color(srgb 0 0 0)'), [0, 0, 0, 1]);
  assert.equal(parseColor('transparent'), null);
  assert.equal(
    parseColor('rgba(0, 0, 0, 0)'),
    null,
    'fully transparent paints nothing',
  );
  assert.equal(parseColor('none'), null);
});

test('contrastRatio follows WCAG 2 relative luminance', () => {
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrastRatio([0, 0, 0], [0, 0, 0]), 1);
  // #777 on white is the classic 4.48:1 near-miss.
  assert.equal(
    Math.round(contrastRatio([119, 119, 119], [255, 255, 255]) * 100) / 100,
    4.48,
  );
  assert.deepEqual(
    composite([0, 0, 0, 0.5], [255, 255, 255]),
    [127.5, 127.5, 127.5],
  );
});

test('textLegibility composites glass layers over a bright backdrop and checks caps size', () => {
  const glass = ['rgba(12, 12, 20, 0.72)'];
  // Muted GEV text (50 % alpha) on 72 % glass over a white roof: about 2.9:1.
  const muted = textLegibility({
    color: 'rgba(232, 234, 237, 0.5)',
    layers: glass,
    fontSize: 12,
    caps: true,
  });
  assert.equal(muted.ok, false);
  assert.ok(muted.ratio > 2.5 && muted.ratio < 3.2, String(muted.ratio));
  // Darkened glass and 76 % text clear 4.5:1 even over white.
  const fixed = textLegibility({
    color: 'color(srgb 0.909804 0.917647 0.929412 / 0.76)',
    layers: ['rgba(12, 12, 20, 0.72)', 'rgba(4, 8, 12, 0.46)'],
    fontSize: 12,
    caps: true,
  });
  assert.equal(fixed.ok, true, String(fixed.ratio));
  assert.ok(fixed.ratio >= 4.5);
  // Caps labels under 12 px fail even with good contrast; mixed case does not.
  const tiny = textLegibility({
    color: 'rgb(232, 234, 237)',
    layers: ['rgb(10, 10, 15)'],
    fontSize: 9,
    caps: true,
  });
  assert.equal(tiny.ok, false);
  assert.equal(tiny.reason, 'caps-under-12px');
  assert.equal(
    textLegibility({
      color: 'rgb(232, 234, 237)',
      layers: ['rgb(10, 10, 15)'],
      fontSize: 11,
      caps: false,
    }).ok,
    true,
  );
});

test('play-mode CSS never sets text below 12 px', () => {
  const css = readFileSync(
    new URL('./styles/city-play.css', import.meta.url),
    'utf8',
  );
  const sizes = [
    ...css.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  assert.ok(sizes.length > 10, 'sizes found');
  assert.deepEqual(
    sizes.filter((px) => px < 12),
    [],
    'caps labels and notes in play mode are at least 12 px',
  );
});
