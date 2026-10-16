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
    return {
      contextClasses: context?.className,
      collapsed: context?.classList.contains('collapsed'),
      autoCollapsed: context?.classList.contains('layout-auto-collapsed'),
      miniHidden: mini?.hidden,
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
  assert.equal(
    disclosed.miniHidden,
    false,
    'Compact radio must actually open before rail restoration',
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
  assert.equal(
    restored.collapsed,
    false,
    'Context must actually restore before judging disclosure ownership',
  );
  assert.equal(
    restored.miniHidden,
    expected === 'fixed',
    `${label}: actual radio ownership result`,
  );
} finally {
  await fs.writeFile(
    `radio-owner-proof/${label}.json`,
    JSON.stringify({ url, label, expected, trace }, null, 2),
  );
  await browser.close();
}
