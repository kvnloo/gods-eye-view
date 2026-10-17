import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';

const [url, label, expected] = process.argv.slice(2);
assert(url && label && expected);
await fs.mkdir('radio-owner-proof', { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage();
const trace = [];
const state = () =>
  page.evaluate(() => {
    const context = document.getElementById('global-context-panel');
    const mini = document.getElementById('context-radio-mini');
    const dock = document.getElementById('context-radio-dock');
    const toggle = document.getElementById('context-radio-toggle-btn');
    // `hidden === false` alone cannot prove something was visibly rendered.
    // It may still be suppressed by CSS or a hidden ancestor.
    const rendered = (element) => {
      if (!element || element.hidden) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden'
          || Number(style.opacity) <= 0) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const miniRect = mini?.getBoundingClientRect();
    return {
      contextClasses: context?.className,
      collapsed: context?.classList.contains('collapsed'),
      autoCollapsed: context?.classList.contains('layout-auto-collapsed'),
      miniHidden: mini?.hidden,
      compactOpen: dock?.classList.contains('disclosure-open'),
      radioControls: toggle?.getAttribute('aria-controls'),
      miniRendered: rendered(mini),
      miniBounds: miniRect && { x: miniRect.x, y: miniRect.y, width: miniRect.width, height: miniRect.height },
      contextRendered: rendered(context),
      expanded: document
        .getElementById('context-radio-toggle-btn')
        ?.getAttribute('aria-expanded'),
    };
  });
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${url}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.styleManager?._panelLayout,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    const manager = window.__godsEyeView.styleManager;
    manager._setHudVariant('tactical');
    manager.hud.setMode('on');
    manager._updateHudButtonState();
    for (const id of [
      'global-context-panel',
      'weather-panel',
      'recent-imagery-panel',
      'cctv-panel',
      'scene-panel',
    ]) {
      if (document.getElementById(id)) manager.setPanelCollapsed(id, false);
    }
  });
  let found = false;
  for (const height of [700, 600, 500, 400, 320]) {
    await page.setViewport({ width: 1440, height });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const observed = await state();
    trace.push({ phase: 'natural-resize', height, ...observed });
    if (observed.collapsed && observed.autoCollapsed) {
      assert.equal(observed.compactOpen, false, 'Compact Radio must start closed');
      assert.equal(observed.miniHidden, true, 'Compact Radio must start hidden');
      assert.equal(observed.expanded, 'false', 'Collapsed launcher must start unexpanded');
      assert.equal(observed.radioControls, 'context-radio-mini', 'Collapsed launcher must own compact Radio');
      found = true;
      break;
    }
  }
  assert(
    found,
    'Could not reach actual automatic Context collapse through layout/viewport changes; no class injection allowed',
  );
  await page.click('#context-radio-toggle-btn');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const disclosed = await state();
  assert.equal(disclosed.compactOpen, true, 'Radio click must open actual disclosure ownership');
  assert.equal(disclosed.expanded, 'true', 'Radio click must expand launcher ARIA state');
  assert.equal(disclosed.radioControls, 'context-radio-mini', 'Expanded launcher must target compact mini');
  assert.equal(
    disclosed.miniHidden,
    false,
    'Compact radio must actually open before rail restoration',
  );
  assert.equal(
    disclosed.miniRendered,
    true,
    'Compact radio must be visibly rendered, not merely missing its hidden attribute',
  );
  trace.push({ phase: 'compact-disclosed', ...disclosed });
  await page.screenshot({
    path: `radio-owner-proof/${label}-before-restore.png`,
    fullPage: true,
  });
  await page.setViewport({ width: 1440, height: 1400 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const restored = await state();
  trace.push({ phase: 'after-real-resize', ...restored });
  await page.screenshot({
    path: `radio-owner-proof/${label}-after-restore.png`,
    fullPage: true,
  });
  assert.equal(restored.radioControls, 'radio-panel', 'Restored launcher must target nested Radio');
  assert.equal(restored.compactOpen, expected === 'buggy', `${label}: compact disclosure ownership on rail restoration`);
  assert.equal(
    restored.collapsed,
    false,
    'Context must actually restore before judging disclosure ownership',
  );
  assert.equal(
    restored.contextRendered,
    true,
    'Context must be visibly rendered before judging actual overlap',
  );
  assert.equal(
    restored.miniHidden,
    expected === 'fixed',
    `${label}: actual radio ownership result`,
  );
  assert.equal(
    restored.miniRendered,
    expected === 'buggy',
    `${label}: radio must visibly persist in baseline and visibly disappear in candidate`,
  );
} finally {
  await fs.writeFile(
    `radio-owner-proof/${label}.json`,
    JSON.stringify({ url, label, expected, trace }, null, 2),
  );
  await browser.close();
}
