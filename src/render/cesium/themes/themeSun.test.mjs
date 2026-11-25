import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampElevation } from './themeSun.js';
import { normalizePreset, normalizeSun } from './presets.js';

const up = { x: 0, y: 0, z: 1 };
const el = (v) => (Math.asin(v.x * up.x + v.y * up.y + v.z * up.z) * 180) / Math.PI;
const unit = (az, e) => {
  const a = (az * Math.PI) / 180;
  const r = (e * Math.PI) / 180;
  return { x: Math.sin(a) * Math.cos(r), y: Math.cos(a) * Math.cos(r), z: Math.sin(r) };
};

test('a sun below the horizon is raised to minEl, azimuth kept', () => {
  const s = clampElevation(unit(200, -25), up, 18, 38);
  assert.ok(Math.abs(el(s) - 18) < 1e-6);
  assert.ok(Math.abs(Math.atan2(s.x, s.y) * 180 / Math.PI + 160) < 1e-6); // 200° == -160°
  assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
  assert.equal(Math.round(s.el0), -25);
});

test('a high noon sun is lowered to maxEl; one inside the band is untouched', () => {
  assert.ok(Math.abs(el(clampElevation(unit(90, 70), up, 18, 38)) - 38) < 1e-6);
  const s = clampElevation(unit(90, 30), up, 18, 38);
  const u = unit(90, 30);
  assert.ok(Math.abs(s.x - u.x) + Math.abs(s.y - u.y) + Math.abs(s.z - u.z) < 1e-9);
});

test('a sun at the zenith still gets a valid direction', () => {
  const s = clampElevation({ x: 0, y: 0, z: 1 }, up, 18, 38);
  assert.ok(Math.abs(el(s) - 38) < 1e-6);
  assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
});

test('the preset sun block is checked, never thrown', () => {
  assert.equal(normalizeSun(undefined), null);
  const p = [];
  const s = normalizeSun({ minEl: 30, maxEl: 10, darkness: 7, color: [1, 0.9, 0.8] }, p);
  assert.equal(s.minEl, 30);
  assert.equal(s.maxEl, 30);
  assert.equal(s.darkness, 0.55);
  assert.deepEqual(s.color, [1, 0.9, 0.8]);
  assert.ok(p.includes('bad sun.darkness'));
  const { preset } = normalizePreset({ name: 'x', techniques: ['tile'], sun: { shadows: false } });
  assert.equal(preset.sun.shadows, false);
  assert.equal(normalizePreset({ name: 'y', techniques: ['tile'] }).preset.sun, null);
});
