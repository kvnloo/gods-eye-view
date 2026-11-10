#!/usr/bin/env node
/** Real-app palette gate. Run `node scripts/qa-command-palette.mjs --serve` for an isolated headless session. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import puppeteer from 'puppeteer';

const serve = process.argv.includes('--serve');
const url =
  process.env.QA_BASE_URL ||
  (serve ? 'http://127.0.0.1:4179' : 'http://localhost:4173');
const shots = process.env.QA_SHOTS_DIR || 'qa-shots/command-palette';
const server = serve
  ? spawn(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        '--host',
        '127.0.0.1',
        '--port',
        new URL(url).port,
        '--strictPort',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
  : null;
let serverLog = '';
server?.stdout.on('data', (data) => {
  serverLog += data;
});
server?.stderr.on('data', (data) => {
  serverLog += data;
});
let browser;
const passed = [];
const check = (name, value) => {
  assert.ok(value, name);
  passed.push(name);
  console.log(`PASS ${name}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await fs.mkdir(shots, { recursive: true });
  if (serve) {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null)
        throw new Error(`Vite exited: ${serverLog}`);
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(500);
    }
    assert.ok(ready, `Vite readiness: ${serverLog}`);
  }
  browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${url}/?welcome=0&lang=en`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.voiceCommands?.runner &&
      document.getElementById('command-palette-toggle'),
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    window.__paletteSceneKeys = 0;
    document.addEventListener(
      'keydown',
      (event) => {
        if (['Escape', 'ArrowUp', 'ArrowDown'].includes(event.key))
          window.__paletteSceneKeys++;
      },
      true,
    );
  });
  const isOpen = () => page.$eval('#command-palette', (node) => node.open);
  const open = async () => {
    await page.waitForFunction(
      () => {
        const button = document.getElementById('command-palette-toggle');
        if (!window.__godsEyeView?.voiceCommands?.runner || !button) return false;
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (hit === button || button.contains(hit))
        );
      },
      { timeout: 120000 },
    );
    await page.click('#command-palette-toggle');
    await page.waitForFunction(
      () => document.getElementById('command-palette').open,
    );
  };
  const query = async (text) => {
    await page.$eval('#command-palette-search', (input) => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#command-palette-search', text);
  };
  const choose = async (id) => {
    await page.click(`[id="palette-option-${id}"]`);
    await page.waitForFunction(
      () => !document.getElementById('command-palette').open,
      { timeout: 30000 },
    );
  };
  await open();
  check(
    'visible trigger opens a real modal with input focus',
    await page.evaluate(
      () =>
        document.getElementById('command-palette').matches(':modal') &&
        document.activeElement.id === 'command-palette-search',
    ),
  );
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check(
    'Shift+Tab reaches close',
    await page.evaluate(
      () => document.activeElement.id === 'command-palette-close',
    ),
  );
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check(
    'Tab wraps within the palette',
    await page.evaluate(
      () => document.activeElement.id === 'command-palette-search',
    ),
  );
  await query('thermal');
  check(
    'search exposes the matching active option through ARIA',
    await page.$eval('#command-palette-search', (input) =>
      document
        .getElementById(input.getAttribute('aria-activedescendant'))
        ?.textContent.includes('Thermal'),
    ),
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__godsEyeView.styleManager.activeStyle === 'thermal',
  );
  check(
    'Enter executes through the typed runner and changes actual style',
    !(await isOpen()),
  );
  await page.waitForFunction(
    () => document.activeElement.id === 'command-palette-toggle',
  );
  check('successful execution restores trigger focus', true);

  await page.keyboard.press('p');
  await page.waitForFunction(
    () => document.getElementById('command-palette').open,
  );
  await query('no matching xyzzy');
  check(
    'empty results have no active descendant',
    await page.$eval(
      '#command-palette-search',
      (input) => !input.hasAttribute('aria-activedescendant'),
    ),
  );
  await page.keyboard.press('Enter');
  check('empty Enter leaves the palette open', await isOpen());
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.getElementById('command-palette').open,
  );
  check('plain P opens and Escape closes', true);
  check(
    'modal keys do not reach earlier document capture shortcuts',
    await page.evaluate(() => window.__paletteSceneKeys === 0),
  );
  await page.evaluate(() => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          [modifier]: true,
          bubbles: true,
        }),
      );
    }
  });
  check('modified P is not claimed', !(await isOpen()));

  await open();
  await query('Sea Marks');
  const initiallyEnabled = await page.evaluate(() =>
    window.__godsEyeView.dataManager.isEnabled('sea-marks'),
  );
  await choose('layer:sea-marks');
  check(
    'layer result changes actual manager state',
    await page.evaluate(
      (before) =>
        window.__godsEyeView.dataManager.isEnabled('sea-marks') !== before,
      initiallyEnabled,
    ),
  );
  await open();
  await query('Sea Marks');
  await choose('layer:sea-marks');
  check(
    'second layer action restores original enabled state',
    await page.evaluate(
      (before) =>
        window.__godsEyeView.dataManager.isEnabled('sea-marks') === before,
      initiallyEnabled,
    ),
  );

  await open();
  await query('Open Data Layers');
  await choose('open-data-layers');
  check(
    'panel command expands the actual Data Layers panel',
    await page.$eval(
      '#data-panel',
      (node) => !node.classList.contains('collapsed'),
    ),
  );
  await open();
  await query('normal');
  await choose('style-normal');
  await open();
  await query('');
  const first = await page.$eval('#command-palette-search', (node) =>
    node.getAttribute('aria-activedescendant'),
  );
  await page.keyboard.press('ArrowUp');
  const last = await page.$eval('#command-palette-search', (node) =>
    node.getAttribute('aria-activedescendant'),
  );
  check('ArrowUp wraps to last option', first !== last);
  await page.keyboard.press('ArrowDown');
  check(
    'ArrowDown wraps back',
    first ===
      (await page.$eval('#command-palette-search', (node) =>
        node.getAttribute('aria-activedescendant'),
      )),
  );
  await query('layers');
  await page.screenshot({ path: path.join(shots, 'palette-desktop.png') });
  await page.keyboard.press('Escape');

  for (const [locale, text, expected] of [
    ['es', 'Abrir cámaras', 'open-cameras'],
    ['ru', 'тепловой', 'style-thermal'],
  ]) {
    await page.goto(`${url}/?welcome=0&lang=${locale}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        window.__godsEyeView?.voiceCommands &&
        document.getElementById('command-palette-toggle'),
      { timeout: 120000 },
    );
    await open();
    await query(text);
    check(
      `${locale} translated query matches rendered command`,
      Boolean(await page.$(`[id="palette-option-${expected}"]`)),
    );
    await page.screenshot({ path: path.join(shots, `palette-${locale}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
  });
  await open();
  check(
    'mobile dialog fits the viewport',
    await page.$eval('#command-palette', (node) => {
      const r = node.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        r.top >= 0 &&
        r.bottom <= innerHeight
      );
    }),
  );
  await page.screenshot({ path: path.join(shots, 'palette-mobile.png') });
  await fs.writeFile(
    path.join(shots, 'report.json'),
    JSON.stringify({ passed, pageErrors }, null, 2),
  );
  check(
    'no palette runtime exceptions',
    !pageErrors.some((error) => /palette|showModal|activeId/i.test(error)),
  );
  console.log(`${passed.length} checks passed`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}
