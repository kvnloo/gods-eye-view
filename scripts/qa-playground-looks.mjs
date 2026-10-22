#!/usr/bin/env node
/**
 * Rendered acceptance for the opt-in Visual Universe experiment.
 * Requires a running GEV dev server. This is functional WebGL proof, NOT a
 * GPU frame-time benchmark (SwiftShader is only software validation).
 *
 * QA_BASE_URL=http://127.0.0.1:4173 node scripts/qa-playground-looks.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.setViewport({ width: 1440, height: 900 });
  const url = new URL(process.env.QA_BASE_URL || 'http://127.0.0.1:4173');
  url.searchParams.set('welcome', '0');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__godsEyeView?.viewer?.scene &&
      document.querySelector('#planet-playground-launcher') &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 60_000 },
  );

  await page.click('#planet-playground-launcher');
  const toyboxOpened = await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.gev-playground-tabs [role="tab"]')]
      .find((node) => node.textContent === 'Toybox');
    tab?.click();
    return Boolean(tab && document.querySelector('[data-look-pack="original"]'));
  });
  assert.ok(toyboxOpened, 'Toybox catalog must be reachable in EXPLORE');

  fs.mkdirSync('qa-shots/visual-universe', { recursive: true });
  let firstStage = null;
  for (const [id, expectedStyle] of [
    ['cinematic-earth', 'normal'],
    ['storybook-wilds', 'anime'],
    ['neon-nocturne', 'normal'],
    ['arcade-racer', 'anime'],
  ]) {
    await page.click('[data-look-pack="' + id + '"]');
    await page.waitForFunction(
      () => window.__godsEyeView.styleManager.transitions.size === 0,
      { timeout: 10_000 },
    );
    const sample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      viewer.scene.requestRender();
      const stage = viewer.scene.postProcessStages.getStageByName(
        'godsEyeView_creativeGrade',
      );
      const chip = document.querySelector('.gev-playground-creative-chip');
      return {
        style: window.__godsEyeView.styleManager.activeStyle,
        enabled: stage?.enabled,
        stage: stage?.name,
        chipVisible: Boolean(chip && !chip.hidden),
        chipLabel: chip?.textContent,
      };
    });
    assert.equal(sample.style, expectedStyle, id + ' base style');
    assert.equal(sample.stage, 'godsEyeView_creativeGrade');
    assert.equal(sample.enabled, true, id + ' grade is active');
    assert.equal(sample.chipVisible, true, id + ' creative disclosure remains visible');
    assert.ok(sample.chipLabel.includes('Reset'));
    if (firstStage !== null) assert.equal(sample.stage, firstStage);
    firstStage = sample.stage;
    await page.screenshot({ path: 'qa-shots/visual-universe/' + id + '.png' });
  }

  // The persistent Creative reset must update an already-open Toybox.
  await page.click('.gev-playground-creative-chip');
  const resetWhileOpen = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('[data-look-pack]')]
      .filter((card) => card.getAttribute('aria-pressed') === 'true')
      .map((card) => card.dataset.lookPack),
    comparisonHidden: document.querySelector('.gev-playground-compare').hidden,
  }));
  assert.deepEqual(resetWhileOpen.pressed, ['original']);
  assert.equal(resetWhileOpen.comparisonHidden, true);
  await page.click('[data-look-pack="arcade-racer"]');

  for (const [percentage, expectedEnabled] of [[0, false], [50, true], [100, true]]) {
    await page.$eval('.gev-playground-compare input[type="range"]', (input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, percentage);
    const comparison = await page.evaluate(() => {
      const stage = window.__godsEyeView.viewer.scene.postProcessStages
        .getStageByName('godsEyeView_creativeGrade');
      return { enabled: stage?.enabled, reveal: stage?.uniforms?.reveal };
    });
    assert.equal(comparison.enabled, expectedEnabled, 'pass state at ' + percentage);
    assert.equal(comparison.reveal, percentage / 100, 'split at ' + percentage);
    if (percentage === 50)
      await page.screenshot({ path: 'qa-shots/visual-universe/compare-half.png' });
  }

  const exportedJson = await page.evaluate(() => {
    const panel = document.querySelector('.gev-playground-look-lab');
    panel.open = true;
    panel.querySelector('[aria-label="Look author credit"]').value = 'QA Artist';
    [...panel.querySelectorAll('button')]
      .find((button) => button.textContent === 'Export current').click();
    return panel.querySelector('textarea').value;
  });
  const exported = JSON.parse(exportedJson);
  assert.equal(exported.schema, 'gev.visual-look.v1');
  assert.equal(exported.author.name, 'QA Artist');
  assert.equal(exported.author.basedOn, 'arcade-racer');
  assert.equal(exported.creative, true);

  const imported = { ...exported, grade: { ...exported.grade, warmth: 0.21 } };
  await page.evaluate((json) => {
    const panel = document.querySelector('.gev-playground-look-lab');
    panel.querySelector('textarea').value = json;
    [...panel.querySelectorAll('button')]
      .find((button) => button.textContent === 'Apply local JSON').click();
  }, JSON.stringify(imported));
  const look = await page.evaluate(() => ({
    chip: document.querySelector('.gev-playground-creative-chip').textContent,
    uniform: window.__godsEyeView.viewer.scene.postProcessStages
      .getStageByName('godsEyeView_creativeGrade')?.uniforms.warmth,
    comparisonVisible: !document.querySelector('.gev-playground-compare').hidden,
  }));
  assert.ok(look.chip.includes('QA Artist'), 'author disclosure remains visible');
  assert.equal(look.uniform, 0.21, 'valid imported grade was applied');
  assert.equal(look.comparisonVisible, true);

  await page.evaluate((json) => {
    const panel = document.querySelector('.gev-playground-look-lab');
    const bad = JSON.parse(json);
    bad.grade.fragmentShader = 'void main() {}';
    panel.querySelector('textarea').value = JSON.stringify(bad);
    [...panel.querySelectorAll('button')]
      .find((button) => button.textContent === 'Apply local JSON').click();
  }, JSON.stringify(imported));
  const rejection = await page.evaluate(() => ({
    message: document.querySelector('.gev-playground-status')?.textContent,
    uniform: window.__godsEyeView.viewer.scene.postProcessStages
      .getStageByName('godsEyeView_creativeGrade')?.uniforms.warmth,
  }));
  assert.ok(rejection.message.includes('rejected'));
  assert.equal(rejection.uniform, 0.21, 'rejection must preserve the prior look');

  await page.click('.gev-playground-close');
  const persistent = await page.evaluate(() => {
    const chip = document.querySelector('.gev-playground-creative-chip');
    const stage = window.__godsEyeView.viewer.scene.postProcessStages
      .getStageByName('godsEyeView_creativeGrade');
    return { chipVisible: Boolean(chip && !chip.hidden), stageEnabled: stage?.enabled };
  });
  assert.equal(persistent.chipVisible, true, 'disclosure survives closing tray');
  assert.equal(persistent.stageEnabled, true, 'creative grade intentionally persists');

  await page.click('.gev-playground-creative-chip');
  const reset = await page.evaluate(() => {
    const chip = document.querySelector('.gev-playground-creative-chip');
    const manager = window.__godsEyeView.styleManager;
    const stage = window.__godsEyeView.viewer.scene.postProcessStages
      .getStageByName('godsEyeView_creativeGrade');
    return { style: manager.activeStyle, enabled: stage?.enabled, chipHidden: chip?.hidden };
  });
  assert.equal(reset.style, 'normal');
  assert.equal(reset.enabled, false);
  assert.equal(reset.chipHidden, true);

  // Selecting the same underlying native shader must still cancel the
  // creative grade; it cannot stay invisible behind the normal preset UI.
  await page.click('#planet-playground-launcher');
  await page.evaluate(() => {
    [...document.querySelectorAll('.gev-playground-tabs [role="tab"]')]
      .find((node) => node.textContent === 'Toybox')?.click();
  });
  await page.click('[data-look-pack="storybook-wilds"]');
  await page.$eval('.style-btn[data-style="anime"]', (button) => button.click());
  const superseded = await page.evaluate(() => ({
    hidden: document.querySelector('.gev-playground-creative-chip')?.hidden,
    enabled: window.__godsEyeView.viewer.scene.postProcessStages
      .getStageByName('godsEyeView_creativeGrade')?.enabled,
  }));
  assert.equal(superseded.hidden, true);
  assert.equal(superseded.enabled, false);
  const galleryAfterNativeStyle = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('[data-look-pack]')]
      .filter((card) => card.getAttribute('aria-pressed') === 'true')
      .map((card) => card.dataset.lookPack),
    comparisonHidden: document.querySelector('.gev-playground-compare').hidden,
  }));
  assert.deepEqual(galleryAfterNativeStyle.pressed, []);
  assert.equal(galleryAfterNativeStyle.comparisonHidden, true);
  assert.deepEqual(errors, [], 'no browser page errors');
  console.log('[PASS] Visual Universe gallery, grade ownership, persistent disclosure and reset');
  console.log('[INFO] Screenshots: qa-shots/visual-universe/ (not GPU-performance evidence)');
} finally {
  await browser.close();
}
