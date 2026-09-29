#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const shots = process.env.QA_SHOTS_DIR ||
  path.join(repoRoot, 'qa-shots', 'observed-traffic');
const headful = process.argv.includes('--headful');
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (await puppeteer.executablePath().catch(() => null));

if (!executablePath || !fs.existsSync(executablePath))
  throw new Error('Puppeteer Chrome for Testing is unavailable');
fs.mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({
  headless: headful ? false : 'new',
  executablePath,
  args: [
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

const failures = [];
const check = (name, passed, detail = '') => {
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(name);
};

const cameras = [
  {
    id: 'ca-d12-tv-imperial-1',
    name: 'Imperial Highway @ Harbor',
    city: 'Fullerton',
    cityId: 'ca-d12',
    provider: 'Caltrans',
    lat: 33.916,
    lon: -117.924,
    headingDeg: 90,
    headingConfidence: 'high',
    pitchDeg: -24,
    fovDeg: 56,
    rangeM: 210,
    mountHeightM: 10,
    groundElevationM: 45,
    feedType: 'image',
    sourceKind: 'caltrans-open-data',
  },
  {
    id: 'ca-d12-tv-brea-2',
    name: 'Brea Boulevard @ Imperial Highway',
    city: 'Brea',
    cityId: 'ca-d12',
    provider: 'Caltrans',
    lat: 33.918,
    lon: -117.9,
    headingDeg: 270,
    headingConfidence: 'high',
    pitchDeg: -24,
    fovDeg: 56,
    rangeM: 210,
    mountHeightM: 10,
    groundElevationM: 60,
    feedType: 'image',
    sourceKind: 'caltrans-open-data',
  },
  {
    id: 'ca-d12-tv-yorba-3',
    name: 'Imperial Highway @ Yorba Linda',
    city: 'Yorba Linda',
    cityId: 'ca-d12',
    provider: 'Caltrans',
    lat: 33.89,
    lon: -117.81,
    headingDeg: 90,
    headingConfidence: 'high',
    pitchDeg: -24,
    fovDeg: 56,
    rangeM: 210,
    mountHeightM: 10,
    groundElevationM: 90,
    feedType: 'image',
    sourceKind: 'caltrans-open-data',
  },
  {
    id: 'ca-d12-tv-unknown-4',
    name: 'Imperial Highway @ QA Missing Observation',
    city: 'Anaheim',
    cityId: 'ca-d12',
    provider: 'Caltrans',
    lat: 33.88,
    lon: -117.84,
    headingDeg: 180,
    headingConfidence: 'high',
    pitchDeg: -24,
    fovDeg: 56,
    rangeM: 210,
    mountHeightM: 10,
    groundElevationM: 75,
    feedType: 'image',
    sourceKind: 'caltrans-open-data',
  },
];

await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== new URL(base).origin) {
    request.continue();
    return;
  }
  if (url.pathname === '/api/cctv/sources') {
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sources: cameras }),
    });
    return;
  }
  if (url.pathname === '/api/cctv/health') {
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cameras: cameras.map((camera) => ({
          id: camera.id,
          status: 'ok',
          sourceKind: 'snapshot',
          label: 'QA camera fixture',
          message: '',
          updatedAt: Date.now(),
        })),
      }),
    });
    return;
  }
  if (url.pathname.startsWith('/api/cctv/frame/')) {
    request.respond({
      status: 200,
      contentType: 'image/svg+xml',
      body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">' +
        '<rect width="100%" height="100%" fill="#111"/>' +
        '<text x="40" y="80" fill="white" font-size="28">Observed traffic QA</text>' +
        '</svg>',
    });
    return;
  }
  request.continue();
});

try {
  await page.goto(`${base}/?welcome=0&observedTraffic=fixture`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => {
      const app = window.__godsEyeView;
      const cctv = app?.dataManager?.layers?.get('cctv')?.module;
      const traffic = app?.dataManager?.layers?.get('traffic')?.module;
      if (!cctv || !traffic) return false;
      const snapshot = traffic.getObservedTrafficSnapshot?.();
      const state = cctv.getUIState?.();
      return (
        app.dataManager.isEnabled('cctv') &&
        app.dataManager.isEnabled('traffic') &&
        snapshot?.configured &&
        snapshot?.records?.length >= 2 &&
        state?.cameras?.some((camera) => camera.trafficObservation)
      );
    },
    { timeout: 60_000 },
  );

  const initial = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const cctv = app.dataManager.layers.get('cctv').module;
    const traffic = app.dataManager.layers.get('traffic').module;
    const state = cctv.getUIState();
    return {
      snapshot: traffic.getObservedTrafficSnapshot(),
      enabled: {
        cctv: app.dataManager.isEnabled('cctv'),
        traffic: app.dataManager.isEnabled('traffic'),
      },
      cameras: state.cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        observation: camera.trafficObservation,
      })),
      activeCameraId: state.activeCameraId,
      row: {
        hidden: document.getElementById('cctv-traffic-observation')?.hidden,
        text: document.getElementById('cctv-traffic-observation')?.textContent,
        state: document.getElementById('cctv-traffic-observation')?.dataset.state,
      },
    };
  });

  check(
    'fixture enables CCTV and Traffic',
    initial.enabled.cctv && initial.enabled.traffic,
    JSON.stringify(initial.enabled),
  );
  check(
    'fixture flows through the normalized observed source',
    initial.snapshot.source === 'GEV corridor fixture' &&
      initial.snapshot.records.every(
        (record) =>
          record.provenance?.method === 'synthetic-fixture' &&
          record.quality?.status === 'synthetic-fixture',
      ),
    `${initial.snapshot.records.length} records · ${initial.snapshot.state}`,
  );
  check(
    'real loaded camera IDs own the observation records',
    initial.snapshot.records.every((record) =>
      cameras.some((camera) => camera.id === record.cameraId),
    ),
  );

  const stale = initial.cameras.find(
    (camera) => camera.observation?.state === 'stale',
  );
  const unknown = initial.cameras.find(
    (camera) => camera.observation?.state === 'unknown',
  );
  const recent = initial.cameras.find(
    (camera) =>
      camera.observation &&
      ['fresh', 'partial'].includes(camera.observation.state),
  );
  check('fixture exposes a recent measured camera', Boolean(recent));
  check('fixture exposes an explicitly stale camera', Boolean(stale));
  check('fixture exposes an explicitly unknown camera', Boolean(unknown));

  const selectAndRead = async (id) => {
    await page.evaluate((cameraId) => {
      window.__godsEyeView.dataManager.layers
        .get('cctv')
        .module.selectCamera(cameraId, { focus: false });
    }, id);
    await page.waitForFunction(
      (cameraId) =>
        window.__godsEyeView.dataManager.layers
          .get('cctv')
          .module.getUIState().activeCameraId === cameraId,
      { timeout: 10_000 },
      id,
    );
    return page.evaluate(() => {
      const row = document.getElementById('cctv-traffic-observation');
      return {
        hidden: row.hidden,
        text: row.textContent,
        state: row.dataset.state,
      };
    });
  };

  if (stale) {
    const row = await selectAndRead(stale.id);
    check(
      'stale camera is never presented as current',
      !row.hidden && row.state === 'stale' && /STALE/.test(row.text),
      JSON.stringify(row),
    );
  }
  if (unknown) {
    const row = await selectAndRead(unknown.id);
    check(
      'missing camera evidence is explicit UNKNOWN',
      !row.hidden && row.state === 'unknown' && /UNKNOWN/.test(row.text),
      JSON.stringify(row),
    );
  }
  if (recent) {
    const row = await selectAndRead(recent.id);
    check(
      'recent observation shows quality and synthetic provenance',
      !row.hidden &&
        /TRAFFIC OBS/.test(row.text) &&
        /Q synthetic-fixture/.test(row.text) &&
        /GEV synthetic corridor fixture/.test(row.text),
      row.text,
    );
  }

  const panelCollapsed = await page.$eval('#cctv-panel', (panel) =>
    panel.classList.contains('collapsed'),
  );
  if (panelCollapsed)
    await page.click('#cctv-panel .panel-collapse-btn');
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({
    path: path.join(shots, 'corridor-fixture.png'),
    fullPage: false,
  });
} finally {
  await browser.close();
}

console.log(
  `OBSERVED TRAFFIC QA: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} failed)`,
);
process.exit(failures.length ? 1 : 0);
