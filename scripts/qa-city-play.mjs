#!/usr/bin/env node
// City builder play mode journey. The parent starts the app; this script owns
// only its headless browser and output files (same conventions as
// qa-city-builder.mjs).
// node scripts/qa-city-play.mjs [--url http://127.0.0.1:4187] [--only-desktop] [--real]
// --real makes exactly one request through the opted-in local ChatGPT bridge
// (GEV_CITY_CONCEPT_LOCAL=1 dev server) and records that concept in the world.
// QA_SHOTS_DIR defaults to qa-shots/city-play. QA_VIDEO_DIR records .webm and,
// when ffmpeg is on PATH, an .mp4 of the journey.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const args = process.argv.slice(2);
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
let onlyDesktop = false;
let real = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else if (args[i] === '--only-desktop') onlyDesktop = true;
  else if (args[i] === '--real') real = true;
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const output = path.resolve(process.env.QA_SHOTS_DIR || 'qa-shots/city-play');
const videoDir = process.env.QA_VIDEO_DIR;
const KEY = 'godsEyeView.cityBuilder.v1';
// Camera south of Washington Square, San Francisco, looking north at 45°.
const SITE = { lat: 37.7953, lon: -122.4103, alt: 600, heading: 0, pitch: -45 };
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const S = {
  pill: '#top-center-actions [data-city-builder-open]',
  play: '[data-city-play]',
  bar: '[data-city-play-bar]',
  ring: '[data-city-play-wheel] .city-play-wheel-ring',
  wheel: '[data-city-play-wheel]',
  carousel: '[data-city-play-carousel]',
  dialog: '[data-community-planning-preview]',
};
const report = {
  startedAt: new Date().toISOString(),
  base,
  site: SITE,
  output,
  assertions: [],
  screenshots: [],
  console: [],
  pageErrors: [],
  forbiddenConceptRequests: [],
  measurements: {},
};
let browser;
let page;
let phase = 'launch';
const locator = (selector) => page.locator(selector);
const probe = () => page.evaluate(() => window.__gevCityPlay?.snapshot());
const persisted = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);

async function check(name, run) {
  phase = name;
  try {
    await run();
    report.assertions.push({ name, status: 'pass' });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.assertions.push({
      name,
      status: 'fail',
      error: error.stack || String(error),
    });
    throw error;
  }
}
async function screenshot(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(output, filename), timeout: 30000 });
  report.screenshots.push(filename);
}
async function until(predicate, label, timeout = 60000, arg) {
  try {
    await page.waitForFunction(predicate, arg, { timeout, polling: 250 });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}
function siteUrl() {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  url.hash = new URLSearchParams({
    v: '2',
    lat: String(SITE.lat),
    lon: String(SITE.lon),
    alt: String(SITE.alt),
    heading: String(SITE.heading),
    pitch: String(SITE.pitch),
    roll: '0',
    style: 'normal',
  }).toString();
  return url.href;
}
async function startup() {
  await page.goto(siteUrl(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await until(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    'app ready',
    120000,
  );
  await until(
    ({ lat, lon }) => {
      const v = window.__godsEyeView.viewer;
      const p = v.camera.positionCartographic;
      return (
        Math.abs((p.latitude * 180) / Math.PI - lat) < 0.02 &&
        Math.abs((p.longitude * 180) / Math.PI - lon) < 0.02 &&
        !v.camera._currentFlight
      );
    },
    'camera at site',
    60000,
    SITE,
  );
  await tilesLoaded();
}
async function tilesLoaded(timeout = 120000) {
  await until(
    () => {
      const { viewer, mapStackController } = window.__godsEyeView;
      const primitives = viewer.scene.primitives;
      const loadedTileset = Array.from({ length: primitives.length }, (_, i) =>
        primitives.get(i),
      ).some((item) => item.show && item.tilesLoaded === true);
      const surface = viewer.scene.globe?.show
        ? viewer.scene.globe.tilesLoaded
        : loadedTileset;
      return surface && mapStackController?.getState?.().status === 'ready';
    },
    'map tiles loaded',
    timeout,
  );
}
async function pixelEvidence(name) {
  const bytes = await locator('#cesiumContainer canvas').first().screenshot();
  const { data, info } = await sharp(bytes)
    .resize(160, 100, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set();
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
    sum += luma;
    squares += luma * luma;
  }
  const n = info.width * info.height;
  const evidence = {
    quantizedColors: colors.size,
    lumaDeviation: Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)),
  };
  report.measurements[name] = evidence;
  assert.ok(
    evidence.quantizedColors > 100 && evidence.lumaDeviation > 7,
    `${name}: globe pixels must be real varied map imagery, not a flat colour`,
  );
}
async function center(selector) {
  const box = await locator(selector).first().boundingBox();
  assert.ok(box, `${selector} has a box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function insideViewport(selector, viewport) {
  for (const box of await locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        id: el.dataset.cityPlayAction ?? el.className,
      };
    }),
  )) {
    assert.ok(
      box.left >= -1 &&
        box.top >= -1 &&
        box.right <= viewport.width + 1 &&
        box.bottom <= viewport.height + 1,
      `${selector} ${box.id} must be fully on screen: ${JSON.stringify(box)}`,
    );
  }
}
async function clickGlobe(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await until(
    () => window.__gevCityPlay?.snapshot().plot,
    'a plot is selected',
    20000,
  );
}
async function mapPoint(viewport) {
  // The middle of the free map area: walk up from 52 % height past any overlay.
  return page.evaluate(({ width, height }) => {
    const canvas = document.querySelector('#cesiumContainer canvas');
    const x = Math.round(width / 2);
    for (let y = Math.round(height * 0.52); y > 140; y -= 12) {
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return { x, y: Math.round(height * 0.4) };
  }, viewport);
}
async function selectPlotWithWheel(viewport) {
  // Click the free map; the wheel must follow the plot.
  const at = await mapPoint(viewport);
  await clickGlobe(at.x, at.y);
  // A far click swoops the camera in; measure the wheel once the flight lands.
  await until(
    () => !window.__godsEyeView.viewer.camera._currentFlight,
    'camera framed the plot',
    30000,
  );
  await page.waitForTimeout(300);
  // From the district view the plot click flies in before the wheel opens.
  await locator(S.ring).waitFor({ state: 'visible', timeout: 30000 });
  await until(
    () => window.__gevCityPlay.snapshot().anchors?.plot,
    'plot projected',
    20000,
  );
}
async function reopenWheel() {
  // A landed concept closes the wheel; clicking the plot brings it back.
  const at = (await probe()).anchors?.plot;
  assert.ok(at, 'selected plot is projected on screen');
  await page.mouse.click(at.x, at.y);
  await locator(S.ring).waitFor({ state: 'visible', timeout: 20000 });
}
async function reimagine(action, alternativeId) {
  await locator(`[data-city-play-action="${action}"]`).click();
  await until(
    (id) => {
      const s = window.__gevCityPlay.snapshot();
      return !s.framing && !s.pending && s.concepts.includes(id);
    },
    `${alternativeId} concept stands on the plot`,
    90000,
    alternativeId,
  );
  await locator(`[data-city-play-card="${alternativeId}"] img`).waitFor({
    state: 'visible',
  });
}
async function wheelZoom(target, deltaY, maxSteps = 60) {
  const box = await locator('#cesiumContainer canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
  for (let i = 0; i < maxSteps; i++) {
    if ((await probe()).tier === target) return i;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(250);
  }
  return (await probe()).tier === target ? maxSteps : -1;
}

await mkdir(output, { recursive: true });
try {
  const env = { ...process.env };
  for (const key of [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'WAYLAND_SOCKET',
    'MIR_SOCKET',
    'XAUTHORITY',
  ])
    delete env[key];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    headless: true,
    env,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ozone-platform=headless',
    ],
  });
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    ...(videoDir && { recordVideo: { dir: videoDir, size: DESKTOP } }),
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('console', (m) =>
    report.console.push({
      phase,
      type: m.type(),
      text: m.text(),
      location: m.location(),
    }),
  );
  page.on('pageerror', (e) =>
    report.pageErrors.push({ phase, message: e.message, stack: e.stack }),
  );
  // Fixture only: any concept network request is a regression. --real allows one.
  let allowOne = false;
  await context.route('**/api/city-concept*', async (route) => {
    if (real && allowOne && route.request().method() === 'POST') {
      allowOne = false;
      report.realConceptRequests = (report.realConceptRequests ?? 0) + 1;
      await route.continue();
      return;
    }
    report.forbiddenConceptRequests.push({ phase, url: route.request().url() });
    await route.abort('blockedbyclient');
  });
  if (real) {
    await check(
      'One real local-bridge concept stands on the plot',
      async () => {
        await startup();
        await pixelEvidence('startupGlobe');
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        await locator('[data-city-play-records="bar"]').click();
        await locator(S.dialog).waitFor({ state: 'visible' });
        await locator('#city-builder-provider').selectOption('local');
        await locator('[data-city-builder-remote-notice]').waitFor({
          state: 'visible',
        });
        await screenshot('r01-provider-disclosed');
        await locator('[data-planning-cancel]').click();
        await locator(S.dialog).waitFor({ state: 'detached' });
        await selectPlotWithWheel(DESKTOP);
        await screenshot('r02-plot-wheel');
        allowOne = true;
        await locator('[data-city-play-action="park"]').click();
        await until(
          () => {
            const s = window.__gevCityPlay.snapshot();
            return (
              !s.framing &&
              !s.pending &&
              (s.concepts.length > 0 ||
                document.querySelector('[data-city-play-error]'))
            );
          },
          'real concept generated or failed visibly',
          420000,
        );
        const doc = await persisted();
        const concept = doc?.alternatives?.[0]?.versions?.[0]?.concept;
        report.realConcept = concept && {
          provider: concept.provider,
          chars: concept.image.length,
          generatedAt: concept.generatedAt,
        };
        assert.equal(
          concept?.provider,
          'chatgpt-subscription/comfyui-codex-image',
          'real provider recorded',
        );
        await page.waitForTimeout(1800);
        await screenshot('r03-real-concept-in-world');
        await reopenWheel();
        await locator('[data-city-play-action="inspect"]').click();
        await until(
          () => window.__gevCityPlay.snapshot().tier === 'detail',
          'detail tier',
          30000,
        );
        await page.waitForTimeout(1500);
        await screenshot('r04-real-concept-detail');
        assert.equal(report.realConceptRequests, 1, 'exactly one real request');
        assert.deepEqual(report.forbiddenConceptRequests, []);
      },
    );
    report.status = 'pass';
  }

  if (!real) {
    await check(
      'Real globe loads at the site with real map pixels',
      async () => {
        await startup();
        await pixelEvidence('startupGlobe');
        assert.equal(
          await page.evaluate((k) => localStorage.getItem(k), KEY),
          null,
        );
        await screenshot('01-hud');
      },
    );

    await check(
      'City builder pill enters play mode: rails collapse, resource bar shows unknowns',
      async () => {
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        assert.equal(
          await locator(S.pill).getAttribute('aria-pressed'),
          'true',
        );
        const s = await probe();
        assert.equal(s.active, true);
        assert.equal(s.bodyClass, true);
        await until(
          () =>
            getComputedStyle(document.querySelector('#left-panel-stack'))
              .visibility === 'hidden',
          'left rail collapsed',
          5000,
        );
        const values = await locator(
          '[data-city-play-stat] .city-play-stat-value',
        ).allInnerTexts();
        assert.deepEqual(
          values,
          ['—', '—', '—', '—', '—', '—'],
          'no project: missing is never zero',
        );
        await locator('[data-city-play-hint]').waitFor({ state: 'visible' });
        await screenshot('02-play-mode');
      },
    );

    await check(
      'Clicking the globe selects a plot; the wheel is anchored within 40 px',
      async () => {
        await page.mouse.move(DESKTOP.width * 0.4, DESKTOP.height * 0.45);
        await page.waitForTimeout(400);
        await selectPlotWithWheel(DESKTOP);
        const s = await probe();
        assert.equal(s.footprint, true, 'footprint entity drawn on the globe');
        const wheel = await center(S.ring);
        const d = Math.hypot(
          wheel.x - s.anchors.plot.x,
          wheel.y - s.anchors.plot.y,
        );
        report.measurements.wheelOffsetPx = d;
        assert.ok(
          d <= 40,
          `wheel centre ${JSON.stringify(wheel)} within 40 px of plot ${JSON.stringify(s.anchors.plot)} (${d.toFixed(1)} px)`,
        );
        assert.deepEqual(
          await locator('[data-city-play-action]').evaluateAll((els) =>
            els.map((e) => e.dataset.cityPlayAction),
          ),
          ['reimagine', 'park', 'plaza', 'bike-lane', 'inspect'],
        );
        await locator('[data-city-play-tag]').waitFor({ state: 'visible' });
        await insideViewport('[data-city-play-action]', DESKTOP);
        await pixelEvidence('plotSelectedGlobe');
        await screenshot('03-plot-wheel');
      },
    );

    let plotId;
    await check(
      'REIMAGINE frames the plot, saves a sited alternative and stands its concept in the world',
      async () => {
        plotId = (await probe()).plot.id;
        await reimagine('reimagine', 'world-1');
        assert.equal(
          await locator(S.wheel).count(),
          0,
          'the concept takes the stage',
        );
        await locator('[data-city-play-holo-tag]').waitFor({
          state: 'visible',
        });
        const doc = await persisted();
        assert.equal(doc.alternatives.length, 1);
        assert.equal(doc.alternatives[0].site.plot.id, plotId);
        assert.equal(
          doc.alternatives[0].versions[0].concept.provider,
          'fixture',
        );
        assert.equal(
          doc.alternatives[0].versions[0].concept.label,
          'AI concept, not a plan or an approval',
        );
        assert.match(
          await locator('[data-city-play-ai-label]').innerText(),
          /AI concept, not a plan or an approval/i,
        );
        await page.waitForTimeout(1600);
        await tilesLoaded(30000);
        await pixelEvidence('reimaginedGlobe');
        await screenshot('04-reimagined');
      },
    );

    await check('REROLL saves version 2 with a new concept', async () => {
      await locator('[data-city-play-reroll]').click();
      await until(
        (key) =>
          JSON.parse(localStorage.getItem(key)).alternatives[0].versions
            .length === 2,
        'version 2 saved',
        60000,
        KEY,
      );
      await until(
        () => !window.__gevCityPlay.snapshot().pending,
        'reroll settled',
        60000,
      );
      const doc = await persisted();
      assert.ok(
        doc.alternatives[0].versions[1].concept,
        'version 2 has its concept',
      );
      assert.match(
        await locator('[data-city-play-card="world-1"]').innerText(),
        /2/,
      );
      await screenshot('05-reroll-v2');
    });

    await check(
      'Zoom in: INSPECT reaches the detail tier with callouts and a stats card',
      async () => {
        await reopenWheel();
        assert.equal(
          (await probe()).plot.id,
          plotId,
          'the same plot is selected again',
        );
        await locator('[data-city-play-action="inspect"]').click();
        await until(
          () => window.__gevCityPlay.snapshot().tier === 'detail',
          'detail tier',
          30000,
        );
        await locator('[data-city-play-callout] .city-play-callout-label')
          .first()
          .waitFor({ state: 'visible', timeout: 20000 });
        await locator('[data-city-play-stats]').waitFor({ state: 'visible' });
        report.measurements.detailCallouts = await locator(
          '[data-city-play-callout]',
        ).count();
        await tilesLoaded(30000);
        await screenshot('06-detail-callouts');
      },
    );

    await check(
      'Zoom out: the district tier shows a pin for the reimagined plot',
      async () => {
        const steps = await wheelZoom('district', 900);
        report.measurements.zoomOutWheelSteps = steps;
        if (steps < 0) {
          // Recorded, not hidden: fall back to a camera move if wheel input is too slow here.
          report.measurements.zoomOutFallback = 'camera.zoomOut';
          await page.evaluate(() =>
            window.__godsEyeView.viewer.camera.zoomOut(2500),
          );
          await until(
            () => window.__gevCityPlay.snapshot().tier === 'district',
            'district tier',
            20000,
          );
        }
        await locator(`[data-city-play-pin="${plotId}"]`).waitFor({
          state: 'visible',
          timeout: 20000,
        });
        await tilesLoaded(60000).catch(() => {});
        await screenshot('07-district-pin');
      },
    );

    await check('Esc exits play mode and restores the HUD', async () => {
      await page.keyboard.press('Escape');
      await locator(S.play).waitFor({ state: 'detached' });
      const s = await probe();
      assert.equal(s.active, false);
      assert.equal(s.bodyClass, false);
      assert.equal(await locator(S.pill).getAttribute('aria-pressed'), 'false');
      await until(
        () =>
          getComputedStyle(document.querySelector('#left-panel-stack'))
            .visibility !== 'hidden',
        'left rail restored',
        5000,
      );
      await screenshot('08-exit-hud');
    });

    await check(
      'Reload restores the project; play mode shows its stats and in-world concept',
      async () => {
        const before = await persisted();
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
        await until(
          () =>
            window.__godsEyeView?.viewer &&
            document
              .querySelector('#loading-screen')
              ?.classList.contains('hidden'),
          'app ready after reload',
          120000,
        );
        assert.deepEqual(await persisted(), before);
        // The app restores the shared view with its own flight; let it land first.
        await until(
          () => !window.__godsEyeView.viewer.camera._currentFlight,
          'camera settled after reload',
          60000,
        );
        await page.waitForTimeout(1500);
        await locator(S.pill).click();
        await locator(S.play).waitFor({ state: 'visible' });
        const stats = Object.fromEntries(
          await locator('[data-city-play-stat]').evaluateAll((els) =>
            els.map((e) => [
              e.dataset.cityPlayStat,
              e.querySelector('.city-play-stat-value').textContent,
            ]),
          ),
        );
        assert.equal(stats.plots, '1');
        assert.equal(stats.worlds, '1');
        assert.equal(stats.concepts, '1');
        assert.equal(stats.walk, '—');
        await tilesLoaded(60000).catch(() => {});
        await screenshot('09-reload-restored');
      },
    );

    await check(
      'Project records drawer opens from the carousel with the same document',
      async () => {
        await selectPlotWithWheel(DESKTOP);
        await reimagine('plaza', 'world-2');
        await locator('[data-city-play-records="carousel"]').click();
        await locator(S.dialog).waitFor({ state: 'visible' });
        assert.equal(
          await locator('[data-city-builder-alternative]').count(),
          2,
        );
        await screenshot('10-records-drawer');
        await locator('[data-planning-cancel]').click();
        await locator(S.dialog).waitFor({ state: 'detached' });
      },
    );

    if (!onlyDesktop) {
      await check(
        'Mobile 390x844: wheel and carousel adapt and every control is reachable',
        async () => {
          await page.setViewportSize(MOBILE);
          await page.waitForTimeout(800);
          await locator(S.play).waitFor({ state: 'visible' });
          await selectPlotWithWheel(MOBILE);
          await insideViewport('[data-city-play-action]', MOBILE);
          await insideViewport('[data-city-play-bar]', MOBILE);
          await screenshot('11-mobile-wheel');
          await reimagine('park', 'world-3');
          await insideViewport(
            '[data-city-play-build], [data-city-play-reroll], [data-city-play-records="carousel"]',
            MOBILE,
          );
          const strip = await locator('.city-play-cards').evaluate((el) => ({
            w: el.clientWidth,
            sw: el.scrollWidth,
          }));
          report.measurements.mobileCarousel = strip;
          await locator('[data-city-play-build]').click();
          await locator('[data-city-play-card="world-3"].is-built').waitFor({
            state: 'visible',
          });
          await screenshot('12-mobile-carousel');
          await page.setViewportSize(DESKTOP);
        },
      );
    }

    await check(
      'No concept network calls, page errors, console errors or Vue warnings',
      async () => {
        assert.deepEqual(report.forbiddenConceptRequests, []);
        assert.deepEqual(report.pageErrors, []);
        const noise =
          /Failed to load resource|net::ERR_|NetworkError|Failed to fetch|\[Data:(?:Flights|Satellites|Ships|CCTV)\]/i;
        const errors = report.console.filter(
          (e) =>
            /\[Vue warn\]|vue warn|Unhandled error during execution/i.test(
              e.text,
            ) ||
            (e.type === 'error' && !noise.test(e.text)),
        );
        report.unexpectedErrors = errors;
        assert.deepEqual(
          errors,
          [],
          'unexpected browser errors; see summary.json',
        );
      },
    );
  }
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${error.stack || error}`);
  if (page && !page.isClosed()) {
    try {
      await screenshot('failure');
      report.failure.probe = await probe();
    } catch (e) {
      report.failure.screenshotError = String(e);
    }
  }
} finally {
  if (browser)
    await browser.close().catch((e) => (report.cleanupError = String(e)));
  if (videoDir) {
    // Playwright writes .webm; keep it and add an .mp4 for players that need one.
    for (const name of (await readdir(videoDir).catch(() => [])).filter((n) =>
      n.endsWith('.webm'),
    )) {
      const webm = path.join(videoDir, name);
      const mp4 = webm.replace(/\.webm$/, '.mp4');
      const r = spawnSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        webm,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        mp4,
      ]);
      report.video = {
        webm,
        mp4: r.status === 0 ? mp4 : null,
        ffmpeg: r.status,
      };
    }
  }
  report.finishedAt = new Date().toISOString();
  await json('summary.json', report);
  console.log(
    `${report.status.toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} assertions; report ${path.join(output, 'summary.json')}`,
  );
}
