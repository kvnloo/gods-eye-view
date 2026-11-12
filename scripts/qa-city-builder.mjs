#!/usr/bin/env node
// Parent starts the app. This script owns only its headless browser and output files.
// node scripts/qa-city-builder.mjs [--real] [--url http://127.0.0.1:4187]
// QA_SHOTS_DIR defaults to qa-shots/city-builder, relative to the invocation cwd.
// QA_VIDEO_DIR, when set, records the journey as .webm files there.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const args = process.argv.slice(2);
let real = false;
let base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--real') real = true;
  else if (args[i] === '--url' && args[i + 1]) base = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const origin = new URL(base);
assert.ok(
  ['http:', 'https:'].includes(origin.protocol),
  'HTTP app URL required',
);
const output = path.resolve(
  process.env.QA_SHOTS_DIR || 'qa-shots/city-builder',
);
const KEY = 'godsEyeView.cityBuilder.v1';
const LABEL = 'AI concept, not a plan or an approval';
const SITE = {
  name: 'Washington Square park, San Francisco',
  lat: 37.8007,
  lon: -122.4103,
  alt: 1600,
};
const S = {
  dialog: '[data-community-planning-preview]',
  editor: '[data-city-builder-editor]',
  top: '#top-center-actions [data-city-builder-open]',
  scene: '#scene-panel [data-community-planning-preview-open]',
  sceneToggle: '[data-collapse-target="scene-panel"]',
  cards: '[data-planning-alternatives]',
};
const park = {
  title: 'QA neighborhood park',
  description:
    'Replace surplus paving with a public pocket park, native trees, permeable paths and shaded seating.',
  parameters: { kind: 'park', trees: 36, widthMeters: 3, shadePercent: 65 },
};
const bike = {
  title: 'QA protected bike lane',
  description:
    'Add a continuous protected bike lane with raised separators, accessible crossings and street trees. Keep emergency access.',
  parameters: {
    kind: 'bike-lane',
    trees: 12,
    widthMeters: 2.5,
    shadePercent: 35,
  },
};
const plaza = {
  title: 'QA accessible plaza',
  description:
    'Create an accessible public plaza with level pedestrian routes, removable seating and a shaded gathering area.',
  parameters: { kind: 'plaza', trees: 18, widthMeters: 6, shadePercent: 50 },
};
const report = {
  startedAt: new Date().toISOString(),
  mode: real ? 'fixture-and-one-real' : 'fixture-only',
  base,
  site: SITE,
  output,
  assertions: [],
  screenshots: [],
  console: [],
  pageErrors: [],
  requests: [],
  networkErrors: [],
  optionalProviderErrors: [],
  unexpectedErrors: [],
  conceptRequests: [],
  forbiddenConceptRequests: [],
  navigation: null,
};
let browser;
let page;
let phase = 'launch';
let allowOneLocal = false;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const locator = (selector) => page.locator(selector);
const row = (id) => locator(`[data-city-builder-alternative="${id}"]`);
const card = (id) => locator(`[data-alternative-id="${id}"]`);
const latest = (doc, id) =>
  doc.alternatives.find((a) => a.id === id)?.versions.at(-1);
const json = (name, data) =>
  writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`);
const persisted = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const persistedText = () =>
  page.evaluate((key) => localStorage.getItem(key), KEY);

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
async function screenshot(name, target = page) {
  const filename = `${name}.png`;
  await target.screenshot({
    path: path.join(output, filename),
    animations: 'disabled',
    timeout: 20000,
  });
  report.screenshots.push(filename);
}
function waitForConceptResponse(timeout) {
  return new Promise((resolve, reject) => {
    const matches = (request) =>
      new URL(request.url()).pathname === '/api/city-concept' &&
      request.method() === 'POST';
    const finish = (error, response) => {
      clearTimeout(timer);
      page.off('response', responded);
      page.off('requestfailed', failed);
      page.off('framenavigated', navigated);
      error ? reject(error) : resolve(response);
    };
    const responded = (response) => {
      if (matches(response.request())) finish(null, response);
    };
    const failed = (request) => {
      if (matches(request))
        finish(
          new Error(`Concept request failed: ${request.failure()?.errorText}`),
        );
    };
    const navigated = (frame) => {
      if (frame === page.mainFrame())
        finish(new Error('App navigated during explicit generation'));
    };
    const timer = setTimeout(
      () => finish(new Error('Concept response timed out')),
      timeout,
    );
    timer.unref();
    page.on('response', responded);
    page.on('requestfailed', failed);
    page.on('framenavigated', navigated);
  });
}
async function settled(timeout = 30000) {
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute('aria-busy') === 'false',
    S.editor,
    { timeout },
  );
}
async function expectAttribute(target, name, value) {
  await target.waitFor({ state: 'visible' });
  assert.equal(await target.getAttribute(name), value);
}
async function imageReady(target) {
  await target.waitFor({ state: 'visible' });
  await target.evaluate(async (img) => {
    await img.decode();
    if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0)
      throw new Error('Image must decode');
  });
}
async function startup(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    null,
    { timeout: 120000 },
  );
  await locator('#loading-screen').waitFor({ state: 'hidden' });
  await locator('#cesiumContainer canvas')
    .first()
    .waitFor({ state: 'visible' });
}
function startupUrl(share = false) {
  const url = new URL(base);
  url.searchParams.set('welcome', '0');
  url.hash = share
    ? new URLSearchParams({
        v: '2',
        lat: String(SITE.lat),
        lon: String(SITE.lon),
        alt: String(SITE.alt),
        heading: '0',
        pitch: '-90',
        roll: '0',
        style: 'normal',
      }).toString()
    : '';
  return url.href;
}
async function atSite(timeout = 45000) {
  await page.waitForFunction(
    ({ lat, lon }) => {
      const p = window.__godsEyeView?.viewer?.camera?.positionCartographic;
      return (
        p &&
        Math.abs((p.latitude * 180) / Math.PI - lat) < 0.025 &&
        Math.abs((p.longitude * 180) / Math.PI - lon) < 0.025 &&
        p.height > 50 &&
        p.height < 20000 &&
        !window.__godsEyeView.viewer.camera._currentFlight
      );
    },
    SITE,
    { timeout },
  );
}
async function fillAlternative(value) {
  await locator('#city-builder-title').fill(value.title);
  await locator('#city-builder-description').fill(value.description);
  await locator('#city-builder-kind').selectOption(value.parameters.kind);
  await locator('#city-builder-trees').fill(String(value.parameters.trees));
  await locator('#city-builder-width').fill(
    String(value.parameters.widthMeters),
  );
  await locator('#city-builder-shade').fill(
    String(value.parameters.shadePercent),
  );
  await locator('[data-city-builder-save]').click();
  await settled();
}
function assertEdit(actual, expected) {
  assert.ok(actual, 'Saved version exists');
  for (const field of ['title', 'description', 'parameters'])
    assert.deepEqual(actual[field], expected[field]);
}
async function pixelEvidence(bytes, name) {
  const { data, info } = await sharp(bytes)
    .resize(160, 100, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set();
  let sum = 0;
  let squares = 0;
  let lit = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luma;
    squares += luma * luma;
    if (luma > 8) lit++;
  }
  const count = info.width * info.height;
  const evidence = {
    quantizedColors: colors.size,
    meanLuma: sum / count,
    lumaDeviation: Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)),
    visibleFraction: lit / count,
    sha256: hash(bytes),
  };
  report[name] = evidence;
  assert.ok(
    colors.size > 100 &&
      evidence.lumaDeviation > 7 &&
      evidence.visibleFraction > 0.2,
    `${name}: map pixels must be varied and nonblank, not a flat placeholder`,
  );
}
async function saveRaster(dataUrl, stem) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  assert.ok(match, 'PNG/JPEG data URL required');
  const bytes = Buffer.from(match[2], 'base64');
  const filename = `${stem}.${match[1] === 'jpeg' ? 'jpg' : 'png'}`;
  await sharp(bytes).metadata();
  await writeFile(path.join(output, filename), bytes);
  return { filename, bytes: bytes.length, sha256: hash(bytes) };
}
async function comparisonShot(name, id, mobile = false) {
  const baseline = locator('[data-planning-baseline]');
  const concept = card(id).locator('[data-planning-concept]');
  await imageReady(baseline.locator('img'));
  await imageReady(concept.locator('img'));
  await locator(S.cards).scrollIntoViewIfNeeded();
  if (mobile) {
    await baseline.scrollIntoViewIfNeeded();
    await screenshot(`${name}-baseline`);
    await concept.scrollIntoViewIfNeeded();
    await screenshot(`${name}-concept`);
  }
  await screenshot(name, locator(S.cards));
}
function optionalUrl(value) {
  try {
    const u = new URL(value);
    return (
      /^\/api\/(?:google\/(?:tiles-token|nearby-places|text-search|place-details)$|openai\/hud-summary$|opensky(?:\/|$)|adsb(?:\/|$)|ais(?:\/|$)|cctv(?:\/|$)|space-track(?:\/|$)|celestrak(?:\/|$))/.test(
        u.pathname,
      ) ||
      /^(?:opensky-network\.org|api\.adsb\.lol|celestrak\.org|api\.planespotters\.net)$/.test(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}
function optionalConsole(entry) {
  // Never classify Vue/component warnings as optional network noise.
  if (
    /\[Vue warn\]|vue warn|Unhandled error during execution/i.test(entry.text)
  )
    return false;
  if (
    /Failed to load resource|net::ERR_|NetworkError|Failed to fetch/i.test(
      entry.text,
    ) &&
    optionalUrl(entry.location?.url)
  )
    return true;
  return /^\[Data:(?:Flights|Satellites|Ships|CCTV)\].*(?:fetch|network|HTTP|status|unavailable|timeout|401|403|429|503)/i.test(
    entry.text,
  );
}
async function diagnostics() {
  return page.evaluate((key) => {
    const app = window.__godsEyeView;
    const p = app?.viewer?.camera?.positionCartographic;
    const text = localStorage.getItem(key);
    let saved;
    try {
      const doc = JSON.parse(text);
      saved = doc && {
        project: doc.project,
        reference: {
          ...doc.reference,
          image: `<${doc.reference.image.length} characters>`,
        },
        alternatives: doc.alternatives.map((a) => ({
          id: a.id,
          revisions: a.versions.map((v) => ({
            revision: v.revision,
            title: v.title,
            provider: v.concept?.provider,
          })),
        })),
      };
    } catch {
      saved = { unreadable: true, length: text?.length };
    }
    return {
      url: location.href,
      loading: document.querySelector('#loading-screen')?.className,
      camera: p && {
        lat: (p.latitude * 180) / Math.PI,
        lon: (p.longitude * 180) / Math.PI,
        alt: p.height,
      },
      map: app?.mapStackController?.getState?.(),
      saved,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(
        (el) => el.textContent,
      ),
      dialogText: document.querySelector('[data-community-planning-preview]')
        ?.innerText,
      activeElement: document.activeElement?.outerHTML,
      buttons: [...document.querySelectorAll('button')]
        .filter((b) => b.getClientRects().length)
        .map((b) => ({
          text: b.textContent,
          label: b.getAttribute('aria-label'),
          disabled: b.disabled,
        })),
    };
  }, KEY);
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
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    acceptDownloads: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    // Opt-in journey recording (.webm per page), finalized when the browser closes.
    ...(process.env.QA_VIDEO_DIR && {
      recordVideo: {
        dir: process.env.QA_VIDEO_DIR,
        size: { width: 1440, height: 1000 },
      },
    }),
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const requests = new WeakMap();
  page.on('console', (message) =>
    report.console.push({
      phase,
      type: message.type(),
      text: message.text(),
      location: message.location(),
    }),
  );
  page.on('pageerror', (error) =>
    report.pageErrors.push({
      phase,
      message: error.message,
      stack: error.stack,
    }),
  );
  page.on('request', (request) => {
    const entry = {
      phase,
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    };
    requests.set(request, entry);
    report.requests.push(entry);
    if (new URL(request.url()).pathname === '/api/city-concept') {
      const body = request.postData() || '';
      report.conceptRequests.push({
        phase,
        method: request.method(),
        bodyBytes: Buffer.byteLength(body),
        bodySha256: hash(body),
      });
    }
  });
  page.on('response', (response) => {
    const entry = requests.get(response.request());
    if (entry) {
      entry.status = response.status();
      entry.contentType = response.headers()['content-type'];
    }
    if (response.status() >= 400)
      report.networkErrors.push({
        phase,
        url: response.url(),
        status: response.status(),
      });
  });
  page.on('requestfailed', (request) => {
    const entry = requests.get(request);
    if (entry) entry.failure = request.failure()?.errorText;
    report.networkErrors.push({
      phase,
      url: request.url(),
      error: request.failure()?.errorText,
    });
  });
  // Safety gate, not a fixture: no response is substituted and all app logic is real.
  await context.route('**/api/city-concept*', async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== '/api/city-concept')
      return route.continue();
    if (!real || !allowOneLocal || request.method() !== 'POST') {
      report.forbiddenConceptRequests.push({
        phase,
        url: request.url(),
        method: request.method(),
      });
      await route.abort('blockedbyclient');
      return;
    }
    allowOneLocal = false;
    await route.continue();
  });

  await check(
    'Normal startup, loading screen hidden, fresh browser storage',
    async () => {
      await startup(startupUrl());
      assert.equal(await persistedText(), null);
      await screenshot('01-startup');
    },
  );
  await check(
    'Fly to a public site through visible Location search',
    async () => {
      try {
        const toggle = locator('#location-bar-toggle');
        if ((await toggle.getAttribute('aria-expanded')) !== 'true')
          await toggle.click();
        const pin = locator('[data-pin-target="location-bar"]');
        if ((await pin.getAttribute('aria-pressed')) !== 'true')
          await pin.click();
        await locator('#search-toggle').click();
        await locator('#location-search').fill(`${SITE.lat}, ${SITE.lon}`);
        await locator('#location-search').press('Enter');
        await atSite();
        report.navigation = {
          method: 'visible-coordinate-search',
          query: `${SITE.lat}, ${SITE.lon}`,
        };
        if ((await pin.getAttribute('aria-pressed')) === 'true')
          await pin.click();
        if ((await toggle.getAttribute('aria-expanded')) === 'true')
          await toggle.click();
      } catch (error) {
        report.navigation = {
          method: 'app-share-url-fallback',
          reason: String(error),
          url: startupUrl(true),
        };
        console.warn(
          `Location search unavailable; using app share URL: ${error.message}`,
        );
        await screenshot('02-search-fallback');
        await startup(startupUrl(true));
        await atSite();
      }
    },
  );
  await check(
    'Live Cesium globe, loaded map data and nonblank actual pixels',
    async () => {
      await page.waitForFunction(
        () => {
          const { viewer, mapStackController } = window.__godsEyeView;
          const primitives = viewer.scene.primitives;
          const loadedTileset = Array.from(
            { length: primitives.length },
            (_, i) => primitives.get(i),
          ).some((item) => item.show && item.tilesLoaded === true);
          const loadedSurface = viewer.scene.globe?.show
            ? viewer.scene.globe.tilesLoaded
            : loadedTileset;
          return (
            loadedSurface && mapStackController?.getState?.().status === 'ready'
          );
        },
        null,
        { timeout: 120000 },
      );
      report.map = await page.evaluate(() => {
        const { viewer, mapStackController, tileset } = window.__godsEyeView;
        return {
          canvasMatches:
            viewer.scene.canvas ===
            document.querySelector('#cesiumContainer canvas'),
          globeType: viewer.scene.globe.constructor.name,
          imageryLayers: viewer.imageryLayers.length,
          stack: mapStackController.getState(),
          tilesetPresent:
            Boolean(tileset) ||
            Array.from({ length: viewer.scene.primitives.length }, (_, i) =>
              viewer.scene.primitives.get(i),
            ).some((item) => item.show && item.tilesLoaded === true),
          webglLost: viewer.scene.context._gl.isContextLost(),
        };
      });
      assert.equal(report.map.canvasMatches, true);
      assert.equal(report.map.webglLost, false);
      assert.ok(report.map.imageryLayers > 0 || report.map.tilesetPresent);
      const canvas = locator('#cesiumContainer canvas').first();
      const pixels = await canvas.screenshot({
        path: path.join(output, '03-live-globe.png'),
      });
      report.screenshots.push('03-live-globe.png');
      await pixelEvidence(pixels, 'liveGlobePixels');
      const mapResponses = report.requests.filter(
        (r) =>
          r.status === 200 &&
          /(?:tile|imagery|World_Imagery|\.b3dm|\.ktx2|\/maps\/)/i.test(
            r.url,
          ) &&
          /(?:image|octet-stream|json)/i.test(r.contentType || ''),
      );
      report.mapResponseCount = mapResponses.length;
      assert.ok(
        mapResponses.length > 0,
        'Real map/tile responses must have loaded. No stubbed map',
      );
    },
  );
  await check(
    'Top-center City builder starts a titled project and saves the reference',
    async () => {
      await locator(S.top).click();
      await locator(S.dialog).waitFor({ state: 'visible' });
      await locator('#city-builder-project-title').fill(
        'QA Washington Square community project',
      );
      assert.equal(
        await locator('[data-planning-mode="game"]').isDisabled(),
        true,
      );
      await locator('[data-city-builder-start]').click();
      await settled();
      await imageReady(locator('[data-city-builder-reference] img'));
      assert.match(
        await locator('[data-city-builder-persistence]').innerText(),
        /saved on this device/,
      );
      const doc = await persisted();
      assert.equal(doc.project.title, 'QA Washington Square community project');
      assert.equal(doc.kind, 'city-builder');
      assert.ok(Math.abs(doc.reference.camera.lat - SITE.lat) < 0.025);
      assert.ok(Math.abs(doc.reference.camera.lon - SITE.lon) < 0.025);
      assert.ok(
        doc.reference.bounds.length === 4 &&
          Number.isFinite(Date.parse(doc.reference.capturedAt)),
      );
      assert.ok(
        doc.reference.sources.length > 0,
        'Captured source attribution required',
      );
      assert.equal(
        await locator('[data-city-builder-reference] img').getAttribute('src'),
        doc.reference.image,
      );
      await pixelEvidence(
        Buffer.from(doc.reference.image.split(',')[1], 'base64'),
        'baselinePixels',
      );
      report.baseline = await saveRaster(
        doc.reference.image,
        'baseline-source',
      );
      await json('baseline-source.json', {
        ...doc.reference,
        imageFile: report.baseline.filename,
      });
      assert.equal(report.conceptRequests.length, 0);
      await screenshot(
        '04-project-reference',
        locator('[data-city-builder-reference]'),
      );
    },
  );
  await check(
    'Author park, then New alternative and protected bike lane',
    async () => {
      await fillAlternative(park);
      let doc = await persisted();
      assert.equal(doc.alternatives.length, 1);
      assertEdit(latest(doc, 'world-1'), park);
      assert.equal(
        await locator('[data-planning-mode="game"]').isDisabled(),
        true,
      );
      await locator('[data-city-builder-new]').click();
      assert.equal(await locator('#city-builder-title').inputValue(), '');
      await fillAlternative(bike);
      doc = await persisted();
      assert.equal(doc.alternatives.length, 2);
      assertEdit(latest(doc, 'world-2'), bike);
      assert.equal(
        await locator('[data-planning-mode="game"]').isDisabled(),
        false,
      );
      assert.equal(
        report.conceptRequests.length,
        0,
        'Authoring must never request generation',
      );
    },
  );
  await check(
    'Edit first alternative, inspect history and restore as a new version',
    async () => {
      await row('world-1').locator('[data-city-builder-edit]').click();
      assert.equal(
        await locator('#city-builder-description').inputValue(),
        park.description,
      );
      const edited = {
        ...park,
        title: `${park.title} revised`,
        description:
          'Revised park option with more shade and a wider accessible path.',
        parameters: { ...park.parameters, trees: 48, widthMeters: 4 },
      };
      await fillAlternative(edited);
      let doc = await persisted();
      assert.equal(doc.alternatives[0].versions.length, 2);
      assertEdit(latest(doc, 'world-1'), edited);
      await row('world-1').locator('summary').click();
      const original = row('world-1').locator(
        '[data-city-builder-revision="1"]',
      );
      assert.match(await original.innerText(), /native trees/);
      await original.locator('[data-city-builder-restore]').click();
      doc = await persisted();
      assert.equal(doc.alternatives[0].versions.length, 3);
      assert.equal(latest(doc, 'world-1').parentRevision, 2);
      assertEdit(latest(doc, 'world-1'), park);
      assertEdit(doc.alternatives[0].versions[1], edited);
      assertEdit(latest(doc, 'world-2'), bike);
      await screenshot('05-restored-history', row('world-1'));
      await row('world-1').locator('summary').click();
    },
  );
  await check(
    'Third novel alternative remains visible and selectable',
    async () => {
      await locator('[data-city-builder-new]').click();
      await fillAlternative(plaza);
      const doc = await persisted();
      assert.equal(doc.alternatives.length, 3);
      assertEdit(latest(doc, 'world-3'), plaza);
      assert.equal(await locator('[data-alternative-id]:visible').count(), 3);
      await locator('[data-planning-mode="game"]').click();
      await expectAttribute(
        locator('[data-planning-mode="game"]'),
        'aria-pressed',
        'true',
      );
      assert.equal(await locator('[data-planning-focus-id]').count(), 3);
      for (const id of ['world-1', 'world-2', 'world-3']) {
        await locator(`[data-planning-focus-id="${id}"]`).click();
        await expectAttribute(
          locator(`[data-planning-focus-id="${id}"]`),
          'aria-pressed',
          'true',
        );
        assert.equal(await locator('[data-alternative-id]:visible').count(), 1);
        assert.equal(await card(id).isVisible(), true);
        assert.equal(
          await locator('[data-planning-baseline]').isVisible(),
          true,
        );
      }
      await locator('[data-planning-focus-id="world-1"]').click();
    },
  );
  await check(
    'Offline Fixture Imagine stores its label, provider and exact baseline source',
    async () => {
      assert.equal(
        report.conceptRequests.length,
        0,
        'No city-concept requests before explicit local Imagine',
      );
      assert.equal(
        await locator('#city-builder-provider').inputValue(),
        'fixture',
      );
      await locator('#city-builder-provider').selectOption('fixture');
      assert.match(
        await locator('[data-city-builder-fixture]').innerText(),
        /sample image, not a generated view/,
      );
      await row('world-1').locator('[data-city-builder-imagine]').click();
      await settled();
      const doc = await persisted();
      const concept = latest(doc, 'world-1').concept;
      assert.ok(concept);
      assert.equal(concept.label, LABEL);
      assert.equal(concept.provider, 'fixture');
      assert.deepEqual(concept.sourceView, doc.reference);
      assert.ok(Number.isFinite(Date.parse(concept.generatedAt)));
      assert.ok(concept.prompt.includes(park.description));
      assert.notEqual(concept.image, doc.reference.image);
      assert.equal(
        report.conceptRequests.length,
        0,
        'Fixture must not call local provider',
      );
      assert.equal(
        await card('world-1').locator('figcaption').innerText(),
        LABEL,
      );
      assert.equal(
        await card('world-1')
          .locator('[data-planning-concept] img')
          .getAttribute('src'),
        concept.image,
      );
      assert.equal(
        await locator('[data-planning-baseline] img').getAttribute('src'),
        doc.reference.image,
      );
      const baselineBox = await locator(
        '[data-planning-baseline]',
      ).boundingBox();
      const alternativeBox = await card('world-1').boundingBox();
      assert.ok(
        baselineBox &&
          alternativeBox &&
          Math.abs(baselineBox.y - alternativeBox.y) < 2 &&
          alternativeBox.x > baselineBox.x,
        'Desktop Game view must put baseline and selected alternative side by side',
      );
      await comparisonShot('06-fixture-compare', 'world-1');
      await locator('[data-planning-mode="co-op"]').click();
      assert.equal(await locator('[data-alternative-id]:visible').count(), 3);
      await screenshot('07-all-three-compare', locator(S.cards));
    },
  );

  if (real)
    await check(
      'Opt-in: disclose ChatGPT transfer and Imagine exactly one alternative',
      async () => {
        assert.equal(report.conceptRequests.length, 0);
        await locator('#city-builder-provider').selectOption('local');
        assert.equal(
          await locator('#city-builder-provider').inputValue(),
          'local',
        );
        assert.equal(
          report.conceptRequests.length,
          0,
          'Provider selection alone must not generate',
        );
        assert.match(
          await locator('[data-city-builder-remote-notice]').innerText(),
          /sends.*ChatGPT.*not on-device/,
        );
        const before = await persisted();
        const responsePromise = waitForConceptResponse(660000);
        // Attach the rejection handler now so a failed click cannot leave an unhandled timer.
        responsePromise.catch(() => {});
        allowOneLocal = true;
        const deadline = Date.now() + 660000;
        await row('world-2').locator('[data-city-builder-imagine]').click();
        const response = await responsePromise;
        assert.equal(response.status(), 200, 'Local generation HTTP status');
        await settled(Math.max(1, deadline - Date.now()));
        const doc = await persisted();
        const concept = latest(doc, 'world-2').concept;
        assert.equal(report.conceptRequests.length, 1);
        assert.equal(
          concept?.provider,
          'chatgpt-subscription/comfyui-codex-image',
        );
        assert.equal(concept.label, LABEL);
        assert.deepEqual(concept.sourceView, before.reference);
        assert.deepEqual(doc.reference, before.reference);
        assert.ok(concept.prompt.includes(bike.description));
        assert.notEqual(
          concept.image,
          latest(doc, 'world-1').concept.image,
          'Local result must not be fixture imagery',
        );
        const body = JSON.parse(response.request().postData());
        assert.equal(
          body.image,
          before.reference.image,
          'Provider receives the full captured baseline, not a UI thumbnail',
        );
        assert.equal(body.prompt, concept.prompt);
        const generated = await saveRaster(concept.image, 'real-generated');
        const source = await saveRaster(
          concept.sourceView.image,
          'real-baseline-source',
        );
        await json('real-source-metadata.json', {
          provider: concept.provider,
          label: concept.label,
          generatedAt: concept.generatedAt,
          prompt: concept.prompt,
          sourceView: concept.sourceView,
          generated,
          source,
          request: report.conceptRequests[0],
        });
        await json('real-city-project.json', doc);
        await locator('[data-planning-mode="game"]').click();
        await locator('[data-planning-focus-id="world-2"]').click();
        await comparisonShot('08-real-local-compare', 'world-2');
        await locator('#city-builder-provider').selectOption('fixture');
      },
    );

  let exported;
  await check(
    'Export a downloaded JSON project and import via visible file input',
    async () => {
      const before = await persisted();
      const downloadPromise = page.waitForEvent('download');
      await locator('[data-city-builder-export]').click();
      const download = await downloadPromise;
      const exportedPath = path.join(output, 'city-project-export.json');
      await download.saveAs(exportedPath);
      assert.equal(await download.failure(), null);
      exported = JSON.parse(await readFile(exportedPath, 'utf8'));
      assert.deepEqual(exported, before);
      // Change a real version first; importing an identical document alone proves little.
      await row('world-3').locator('[data-city-builder-edit]').click();
      await fillAlternative({
        ...plaza,
        title: 'QA temporary edit before roundtrip',
      });
      assert.notDeepEqual(await persisted(), exported);
      const input = locator('#city-builder-import');
      await input.scrollIntoViewIfNeeded();
      assert.equal(await input.isVisible(), true);
      await input.setInputFiles(exportedPath);
      await settled();
      assert.deepEqual(await persisted(), exported);
      assert.match(await locator(S.editor).innerText(), /Project imported/);
      assert.equal(await locator('[data-alternative-id]:visible').count(), 3);
    },
  );
  await check(
    'Malformed and structurally invalid imports fail closed, preserving project',
    async () => {
      const before = await persistedText();
      const requestCount = report.conceptRequests.length;
      const invalid = {
        ...exported,
        reference: { ...exported.reference, image: 'not-a-raster' },
      };
      for (const [name, buffer] of [
        ['malformed.json', Buffer.from('{"kind":')],
        ['invalid-schema.json', Buffer.from(JSON.stringify(invalid))],
      ]) {
        await locator('#city-builder-import').scrollIntoViewIfNeeded();
        await locator('#city-builder-import').setInputFiles({
          name,
          mimeType: 'application/json',
          buffer,
        });
        await settled();
        assert.match(
          await locator(`${S.editor} [role="alert"]`).innerText(),
          /Invalid project file\. Nothing was imported or sent to a provider/,
        );
        assert.equal(await persistedText(), before);
        assert.equal(report.conceptRequests.length, requestCount);
        assert.equal(await locator('[data-alternative-id]:visible').count(), 3);
      }
    },
  );
  await check(
    'Reload preserves every version, baseline and generated concept',
    async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(
        () =>
          window.__godsEyeView?.viewer &&
          document
            .querySelector('#loading-screen')
            ?.classList.contains('hidden'),
        null,
        { timeout: 120000 },
      );
      await locator(S.top).click();
      await settled();
      assert.deepEqual(await persisted(), exported);
      assert.match(
        await locator('[data-city-builder-persistence]').innerText(),
        /saved on this device/,
      );
      assert.equal(await locator('[data-city-builder-alternative]').count(), 3);
      await imageReady(locator('[data-city-builder-reference] img'));
      assert.equal(
        await locator('#city-builder-provider').inputValue(),
        'fixture',
      );
    },
  );
  await check(
    'A second tab cannot overwrite the writer workspace',
    async () => {
      const other = await context.newPage();
      try {
        await other.goto(startupUrl(true), { waitUntil: 'domcontentloaded' });
        await other.waitForFunction(
          () =>
            window.__godsEyeView?.viewer &&
            document
              .querySelector('#loading-screen')
              ?.classList.contains('hidden'),
          null,
          { timeout: 120000 },
        );
        await other.locator(S.top).click();
        await other.locator('[data-city-builder-edit]').first().click();
        await other
          .locator('#city-builder-description')
          .fill('A second-tab draft must not overwrite the first tab.');
        await other.locator('[data-city-builder-save]').click();
        assert.match(
          await other
            .locator('[data-city-builder-editor] [role="alert"]')
            .innerText(),
          /storage is unavailable or full/i,
        );
        assert.deepEqual(
          await other.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)),
            KEY,
          ),
          exported,
        );
      } finally {
        await other.close();
      }
      await page.bringToFront();
    },
  );
  await check(
    'Scene entry works through the panel collapse action and launcher',
    async () => {
      await locator('[data-planning-cancel]').click();
      await locator(S.dialog).waitFor({ state: 'detached' });
      assert.equal(
        await locator(S.top).evaluate((el) => el === document.activeElement),
        true,
        'Close returns focus to the top-center launcher that opened the dialog',
      );
      const rail = locator('[data-rail-item="scene-panel"]');
      await rail.waitFor({ state: 'visible' });
      if ((await rail.getAttribute('aria-pressed')) !== 'true')
        await rail.click();
      await expectAttribute(rail, 'aria-pressed', 'true');
      await locator(S.scene).scrollIntoViewIfNeeded();
      assert.match(await locator(S.scene).innerText(), /City builder/);
      await locator(S.scene).click();
      await locator(S.dialog).waitFor({ state: 'visible' });
      assert.deepEqual(await persisted(), exported);
      await locator('[data-planning-mode="game"]').click();
      await locator('[data-planning-focus-id="world-1"]').click();
      await comparisonShot('09-scene-entry-compare', 'world-1');
    },
  );
  await check(
    'Mobile viewport keeps comparison, third Inspect option and editor accessible',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await comparisonShot('10-mobile-fixture-compare', 'world-1', true);
      await locator('[data-planning-focus-id="world-3"]').click();
      await expectAttribute(
        locator('[data-planning-focus-id="world-3"]'),
        'aria-pressed',
        'true',
      );
      assert.equal(await card('world-3').isVisible(), true);
      assert.equal(await locator('[data-alternative-id]:visible').count(), 1);
      await locator('#city-builder-title').scrollIntoViewIfNeeded();
      assert.equal(await locator('#city-builder-title').isVisible(), true);
      const dimensions = await locator(S.dialog).evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      assert.ok(
        dimensions.scroll <= dimensions.width + 2,
        'No horizontal dialog overflow on mobile',
      );
      await screenshot('11-mobile-editor');
      await locator('[data-planning-focus-id="world-1"]').click();
      assert.deepEqual(await persisted(), exported);
    },
  );
  await check(
    'No unexpected concept calls, page errors, console errors or Vue warnings',
    async () => {
      assert.equal(report.forbiddenConceptRequests.length, 0);
      assert.equal(report.conceptRequests.length, real ? 1 : 0);
      assert.deepEqual(report.pageErrors, []);
      const errors = report.console.filter(
        (e) =>
          e.type === 'error' ||
          /\[Vue warn\]|vue warn|Unhandled error during execution/i.test(
            e.text,
          ),
      );
      report.optionalProviderErrors = [
        ...report.networkErrors.filter((e) => optionalUrl(e.url)),
        ...errors.filter(optionalConsole),
      ];
      report.unexpectedErrors = errors.filter((e) => !optionalConsole(e));
      assert.deepEqual(
        report.unexpectedErrors,
        [],
        'Unexpected browser errors and all Vue warnings are regressions. See console.json',
      );
    },
  );
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.failure = { phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(`FAIL ${phase}: ${error.stack || error}`);
  if (page && !page.isClosed()) {
    try {
      await screenshot('failure');
    } catch (e) {
      report.failure.screenshotError = String(e);
    }
    try {
      await json('failure-diagnostics.json', await diagnostics());
    } catch (e) {
      report.failure.diagnosticsError = String(e);
    }
  }
} finally {
  allowOneLocal = false;
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      report.cleanupError = String(error);
      report.status = 'fail';
      process.exitCode = 1;
    }
  }
  const errors = report.console.filter(
    (e) =>
      e.type === 'error' ||
      /\[Vue warn\]|vue warn|Unhandled error during execution/i.test(e.text),
  );
  report.optionalProviderErrors = [
    ...report.networkErrors.filter((e) => optionalUrl(e.url)),
    ...errors.filter(optionalConsole),
  ];
  report.unexpectedErrors = errors.filter((e) => !optionalConsole(e));
  report.finishedAt = new Date().toISOString();
  await json('console.json', report.console);
  await json('pageerrors.json', report.pageErrors);
  await json('requests.json', report.requests);
  await json('optional-provider-errors.json', report.optionalProviderErrors);
  await json('summary.json', report);
  console.log(
    `${report.status.toUpperCase()}: ${report.assertions.filter((a) => a.status === 'pass').length} assertions; report ${path.join(output, 'summary.json')}`,
  );
}
