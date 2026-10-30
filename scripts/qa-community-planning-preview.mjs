import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';


const qaRoot = fileURLToPath(new URL('../', import.meta.url));
// These six source owners together implement the opt-in bootstrap, authored
// operation projection, Scene dialog and renderer. Pinning only the visible
// preview modules can give a false PASS against a different dev-server core.
const qaSources = [
  'src/data/communityPlanning.js',
  'src/data/collaborationAuthority.js',
  'src/standalone/communityPlanningFixture.js',
  'src/standalone/tools.js',
  'src/ui/communityPlanningPreview.js',
  'src/ui/sceneSharing.js',
];

// Independent fixed closure guard: omitting ANY of the six runtime owners
// must fail before Chromium, including the fixture, projection and renderer.
const requiredQaRuntimeOwners = Object.freeze([
  'src/data/communityPlanning.js',
  'src/data/collaborationAuthority.js',
  'src/standalone/communityPlanningFixture.js',
  'src/standalone/tools.js',
  'src/ui/communityPlanningPreview.js',
  'src/ui/sceneSharing.js',
]);
function assertQaRuntimeOwnerCoverage(paths) {
  const missing = requiredQaRuntimeOwners.filter((owner) => !paths.includes(owner));
  assert.deepEqual(missing, [], 'QA source identity omits required runtime owners');
}
function checkQaRuntimeOwnerNegativeControls() {
  assertQaRuntimeOwnerCoverage(qaSources);
  for (const owner of requiredQaRuntimeOwners) {
    assert.throws(
      () => assertQaRuntimeOwnerCoverage(qaSources.filter((path) => path !== owner)),
      /omits required runtime owners/,
    );
  }
}
checkQaRuntimeOwnerNegativeControls();

/** Reject unsupported engines even when the focused gate runs via plain node. */
function qaSupportedNodeRuntime(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major === 24 && minor >= 14) || major === 26;
}

function checkQaSupportedNodeRuntimeNegativeControls() {
  for (const version of ['24.14.0', '24.16.1', '26.0.0', '26.3.2'])
    assert.equal(
      qaSupportedNodeRuntime(version), true, `supported Node ${version}`,
    );
  for (const version of [
    '22.16.0', '24.13.9', '25.0.0', '27.0.0',
    '24.14.0-rc.1', '26.0.0-rc.1', 'invalid',
  ])
    assert.equal(
      qaSupportedNodeRuntime(version), false, `unsupported Node ${version}`,
    );
}
checkQaSupportedNodeRuntimeNegativeControls();
if (!qaSupportedNodeRuntime(process.versions.node)) {
  throw new Error(
    'GEV Scene QA requires supported Node 24.14.x or later 24.x, or Node 26.x',
  );
}

function assertCheckoutLock(expected, actual, status) {
  if (!/^[0-9a-f]{40}$/.test(expected || ''))
    throw new Error('Set GEV_QA_EXPECTED_SHA to the independently pinned 40-character PR head');
  assert.equal(actual, expected, 'QA checkout HEAD differs from pinned PR head');
  assert.equal(status, '', 'QA checkout has modified or untracked files outside the pinned PR head');
}

function gitOutput(...args) {
  return execFileSync('git', args, { cwd: qaRoot, encoding: 'utf8' }).trim();
}

function assertCurrentCheckout() {
  const expected = process.env.GEV_QA_EXPECTED_SHA;
  // Check the supplied target before touching Git or starting a browser.
  if (!/^[0-9a-f]{40}$/.test(expected || ''))
    throw new Error('Set GEV_QA_EXPECTED_SHA to the independently pinned 40-character PR head');
  assertCheckoutLock(
    expected,
    gitOutput('rev-parse', 'HEAD'),
    gitOutput('status', '--porcelain', '--untracked-files=normal'),
  );
}

function assertSourceIdentity(expected, actual, path) {
  assert.equal(actual, expected, `Dev server is serving stale/different source: ${path}`);
}

/** The Scene QA runner must not point Chromium at a remote/credentialed site. */
function qaLoopbackOrigin(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError('GEV_QA_APP_URL must be a valid loopback HTTP(S) root');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash
  ) {
    throw new TypeError(
      'GEV_QA_APP_URL must be a loopback HTTP(S) root without credentials, query or fragment',
    );
  }
  return parsed.origin;
}

/** Redirects outside the local dev server cannot earn an exact-head QA PASS. */
function assertQaNavigationOrigin(actual, expected) {
  assert.equal(
    new URL(actual).origin,
    expected,
    'GEV QA page left the pinned loopback dev-server origin',
  );
}

/**
 * Abort a redirected top-level document before Chromium contacts another site.
 * A post-goto origin assertion is too late to prevent the remote request.
 */
function qaNavigationAllowedBeforeRequest(raw, expectedOrigin) {
  try {
    const url = new URL(raw);
    // Only the two entry URLs exercised by this gate may navigate the main frame.
    // A same-origin redirect can still leak query tokens to the local server
    // or silently run the wrong fixture unless the path/query are pinned too.
    return (
      url.origin === expectedOrigin &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.hash &&
      (url.search === '' || url.search === '?planningPreview=fixture')
    );
  } catch {
    return false;
  }
}

function dispatchQaInterceptedRequest(request, mainFrame, expectedOrigin) {
  if (request.isNavigationRequest()) {
    // A provisional root navigation can use a different Frame instance,
    // not merely null or the current mainFrame identity.
    const frame = request.frame();
    const topLevel = (
      frame === null ||
      frame === mainFrame ||
      (typeof frame.parentFrame === 'function' && frame.parentFrame() === null)
    );
    if (
      topLevel &&
      !qaNavigationAllowedBeforeRequest(request.url(), expectedOrigin)
    ) {
      return request.abort('blockedbyclient');
    }
  }
  // GEV may load external map tiles/assets; leave known subframes untouched.
  return request.continue();
}

/** Exercise the actual request-decision handler without network access. */
function checkQaPreRequestNegativeControls() {
  const origin = 'http://localhost:4173';
  const mainFrame = {};
  const provisionalRoot = { parentFrame: () => null };
  const childFrame = { parentFrame: () => mainFrame };
  function observedAction(raw, navigation = true, frame = mainFrame) {
    let action = null;
    const request = {
      url: () => raw,
      isNavigationRequest: () => navigation,
      frame: () => frame,
      abort(reason) {
        action = `abort:${reason}`;
        return Promise.resolve();
      },
      continue() {
        action = 'continue';
        return Promise.resolve();
      },
    };
    void dispatchQaInterceptedRequest(request, mainFrame, origin);
    return action;
  }
  assert.equal(observedAction(origin + '/'), 'continue');
  assert.equal(observedAction(origin + '/?planningPreview=fixture'), 'continue');
  // Negative controls: same-origin navigations can still carry sensitive
  // query data or silently switch to a different, unpinned fixture.
  for (const unexpected of [
    origin + '/?access_token=synthetic-canary',
    origin + '/?planningPreview=fixture&api_key=synthetic-canary',
    origin + '/?planningPreview=other',
    origin + '/?planningPreview=fixture&planningPreview=fixture',
    origin + '/login',
    origin + '/?planningPreview=fixture#synthetic-private-fragment',
  ]) {
    assert.equal(
      observedAction(unexpected),
      'abort:blockedbyclient',
      'same-origin redirects outside the two pinned QA entries must be blocked',
    );
  }
  for (const remote of [
    'https://remote.example.test/redirect',
    'http://127.0.0.1:4173/',
    'http://user:secret@localhost:4173/',
    'file:///tmp/stale.html',
    'not a URL',
  ]) {
    assert.equal(
      observedAction(remote),
      'abort:blockedbyclient',
      'redirect/navigation must be rejected before the remote request',
    );
  }
  assert.equal(
    observedAction('https://tiles.example.test/asset.png', false),
    'continue',
    'normal non-navigation map assets must remain available',
  );
  assert.equal(
    observedAction('https://iframe.example.test/', true, childFrame),
    'continue',
    'subframe navigation stays outside this main-frame-only gate',
  );
  for (const unexpected of [
    'https://remote.example.test/new-root',
    origin + '/?access_token=synthetic-canary',
  ]) {
    assert.equal(
      observedAction(unexpected, true, provisionalRoot),
      'abort:blockedbyclient',
      'a provisional root Frame must not bypass the navigation guard',
    );
  }
  assert.equal(
    observedAction(origin + '/?planningPreview=fixture', true, provisionalRoot),
    'continue',
    'a provisional root Frame must still permit the pinned entry',
  );
  // A provisional navigation with no bound frame must not escape the
  // pinned target guard, while valid local entries and map assets still load.
  for (const unexpected of [
    'https://remote.example.test/unbound',
    origin + '/?access_token=synthetic-canary',
    'file:///tmp/unbound.html',
  ]) {
    assert.equal(
      observedAction(unexpected, true, null),
      'abort:blockedbyclient',
      'unbound document navigation must not escape the pinned target',
    );
  }
  assert.equal(
    observedAction(origin + '/?planningPreview=fixture', true, null),
    'continue',
    'pinned provisional entries must remain available',
  );
  assert.equal(
    observedAction('https://tiles.example.test/asset.png', false, null),
    'continue',
    'unbound non-navigation assets must remain available',
  );
}
checkQaPreRequestNegativeControls();

/** Interception must be enabled before any goto, including the mobile tab. */
async function guardQaTopLevelNavigation(page, expectedOrigin) {
  const interceptionErrors = [];
  const pendingInterceptions = new Set();
  // An immediate assertion can miss a still-unsettled request.continue/abort.
  function trackInterception(promise) {
    const task = Promise.resolve(promise)
      .catch((error) => interceptionErrors.push(String(error)))
      .finally(() => pendingInterceptions.delete(task));
    pendingInterceptions.add(task);
  }
  page.on('request', (request) => {
    try {
      trackInterception(dispatchQaInterceptedRequest(
        request, page.mainFrame(), expectedOrigin,
      ));
    } catch (error) {
      interceptionErrors.push(String(error));
      trackInterception(request.abort('blockedbyclient'));
    }
  });
  await page.setRequestInterception(true);
  return async () => {
    // New request events may arrive while an older interception settles.
    // A single Promise.all snapshot can falsely certify a later rejection.
    while (pendingInterceptions.size) {
      await Promise.all([...pendingInterceptions]);
    }
    assert.deepEqual(
      interceptionErrors, [],
      'QA browser request interception failed; cannot certify navigation safety',
    );
  };
}

/** A late request rejection must invalidate even an earlier clean QA check. */
async function checkQaLateInterceptionNegativeControls() {
  let onRequest;
  const fakePage = {
    on(event, handler) {
      if (event === 'request') onRequest = handler;
    },
    mainFrame: () => null,
    async setRequestInterception(enabled) {
      assert.equal(enabled, true);
    },
  };
  const assertSafe = await guardQaTopLevelNavigation(
    fakePage, 'http://localhost:4173',
  );
  await assertSafe();
  // Unrelated successfully continued requests remain accepted.
  onRequest({
    isNavigationRequest: () => false,
    continue: () => Promise.resolve(),
  });
  await assertSafe();
  let rejectPending;
  onRequest({
    isNavigationRequest: () => false,
    continue: () => new Promise((_, reject) => {
      rejectPending = reject;
    }),
  });
  let finished = false;
  const pendingCheck = assertSafe().then(
    () => {
      finished = true;
      return null;
    },
    (error) => {
      finished = true;
      return error;
    },
  );
  await Promise.resolve();
  assert.equal(finished, false, 'QA must await outstanding interception work');
  rejectPending(new Error('synthetic late request interception failure'));
  const failure = await pendingCheck;
  assert.match(String(failure), /QA browser request interception failed/);
  await assert.rejects(
    assertSafe(), /QA browser request interception failed/,
  );
}
await checkQaLateInterceptionNegativeControls();

/** Request events arriving during a check must join that same check. */
async function checkQaGrowingInterceptionNegativeControls() {
  let onRequest;
  const fakePage = {
    on(event, handler) {
      if (event === 'request') onRequest = handler;
    },
    mainFrame: () => null,
    async setRequestInterception(enabled) {
      assert.equal(enabled, true);
    },
  };
  const assertSafe = await guardQaTopLevelNavigation(
    fakePage,
    'http://localhost:4173',
  );
  let finishFirst;
  onRequest({
    isNavigationRequest: () => false,
    continue: () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  });
  let finished = false;
  const check = assertSafe().then(
    () => {
      finished = true;
      return null;
    },
    (error) => {
      finished = true;
      return error;
    },
  );
  let rejectSecond;
  onRequest({
    isNavigationRequest: () => false,
    continue: () =>
      new Promise((_, reject) => {
        rejectSecond = reject;
      }),
  });
  finishFirst();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(
    finished,
    false,
    'QA must wait for requests added after its first pending snapshot',
  );
  rejectSecond(new Error('synthetic newly arrived interception failure'));
  const failure = await check;
  assert.match(String(failure), /QA browser request interception failed/);
}
await checkQaGrowingInterceptionNegativeControls();

function checkLocalQaOriginNegativeControls() {
  for (const valid of [
    'http://localhost:4173',
    'https://localhost:4173/',
    'http://127.0.0.1:5173/',
    'http://[::1]:4173/',
  ]) assert.equal(qaLoopbackOrigin(valid), new URL(valid).origin);
  for (const invalid of [
    'https://remote.example.test/',
    'http://localhost.remote.example.test/',
    'http://user:secret@localhost:4173/',
    'http://localhost:4173/?token=synthetic',
    'http://localhost:4173/#private',
    'http://localhost:4173/not-root',
    'file:///tmp/snapshot.html',
    'http://192.168.1.2:4173/',
    'not a URL',
  ]) assert.throws(() => qaLoopbackOrigin(invalid), /GEV_QA_APP_URL/);
  assertQaNavigationOrigin('http://localhost:4173/', 'http://localhost:4173');
  assert.throws(
    () => assertQaNavigationOrigin('https://remote.example.test/', 'http://localhost:4173'),
    /pinned loopback/,
  );
}
checkLocalQaOriginNegativeControls();

function checkIdentityNegativeControls() {
  const valid = 'a'.repeat(40);
  assert.throws(() => assertCheckoutLock('', valid, ''), /GEV_QA_EXPECTED_SHA/);
  assert.throws(() => assertCheckoutLock(valid, 'b'.repeat(40), ''), /differs/);
  assert.throws(() => assertCheckoutLock(valid, valid, ' M src/ui/communityPlanningPreview.js'), /modified or untracked/);
  // A new untracked source can change the dev server without changing HEAD.
  assert.throws(
    () => assertCheckoutLock(valid, valid, '?? src/ui/untracked-planning-module.js'),
    /modified or untracked/,
  );
  assertCheckoutLock(valid, valid, '');
  assert.throws(() => assertSourceIdentity('source-a', 'source-b', '/src/test.js'), /stale/);
}
checkIdentityNegativeControls();

/**
 * An opt-in Scene gate cannot report PASS after an uncaught exception, crash,
 * or preview-owned console error, even when final DOM assertions pass.
 * Unrelated map/provider console errors are outside this focused fixture gate.
 */
const previewConsoleSourcePaths = new Set([
  '/src/data/communityPlanning.js',
  '/src/data/collaborationAuthority.js',
  '/src/standalone/communityPlanningFixture.js',
  '/src/standalone/tools.js',
  '/src/ui/communityPlanningPreview.js',
  '/src/ui/sceneSharing.js',
]);

function isPreviewConsoleError(message, expectedOrigin) {
  const type = message.type();
  // The Scene owner catches disposal errors and emits console.warn instead of
  // pageerror. This exact preview-owned failure must fail QA without relying
  // on Chromium providing a usable source location or stack.
  if (
    (type === 'warn' || type === 'error') &&
    message.text().startsWith('Community planning preview cleanup failed')
  ) return true;
  if (type !== 'error') return false;
  // Bootstrap's handled import error is logged without throwing a pageerror.
  if (message.text().startsWith('Community planning fixture preview failed'))
    return true;
  // Chromium may leave ConsoleMessage.location empty while its stack still
  // identifies the failing preview owner. Inspect both, preserving origin pinning.
  for (const frame of [message.location?.(), ...(message.stackTrace?.() ?? [])]) {
    try {
      const source = new URL(frame?.url);
      if (
        source.origin === expectedOrigin &&
        previewConsoleSourcePaths.has(source.pathname)
      ) return true;
    } catch {
      // An absent/malformed location is not proof of an unrelated console error.
    }
  }
  return false;
}

function watchQaPageFailures(page, label, expectedOrigin) {
  const failures = [];
  const onPageError = (error) =>
    failures.push(`unhandled page exception: ${String(error?.message ?? error)}`);
  const onCrash = (error) =>
    failures.push(`page crash: ${String(error?.message ?? error)}`);
  const onConsole = (message) => {
    if (isPreviewConsoleError(message, expectedOrigin))
      failures.push('preview-owned console error');
  };
  page.on('pageerror', onPageError);
  page.on('error', onCrash);
  page.on('console', onConsole);
  return {
    assertClean: () => assert.deepEqual(
      failures, [], `${label} had unhandled browser failures`,
    ),
    dispose() {
      page.off('pageerror', onPageError);
      page.off('error', onCrash);
      page.off('console', onConsole);
    },
  };
}

function checkQaPageFailureObserverNegativeControls() {
  const handlers = new Map();
  const fakePage = {
    on(event, handler) { handlers.set(event, handler); },
    off(event, handler) {
      assert.equal(handlers.get(event), handler);
      handlers.delete(event);
    },
  };
  const origin = 'http://localhost:4173';
  const consoleMessage = (
    type, url, text = 'synthetic preview failure', stackUrls = [],
  ) => ({
    type: () => type,
    location: () => ({ url }),
    stackTrace: () => stackUrls.map((source) => ({ url: source })),
    text: () => text,
  });
  for (const [event, message] of [
    ['pageerror', 'synthetic uncaught error'],
    ['error', 'synthetic renderer crash'],
  ]) {
    const watcher = watchQaPageFailures(fakePage, 'injected failure', origin);
    watcher.assertClean();
    handlers.get(event)(new Error(message));
    assert.throws(() => watcher.assertClean(), /unhandled browser failures/);
    watcher.dispose();
    assert.equal(handlers.size, 0, 'browser failure listeners must be removed');
  }
  for (const source of [
    origin + '/src/ui/communityPlanningPreview.js?t=1',
    origin + '/src/data/communityPlanning.js',
    origin + '/src/standalone/tools.js',
  ]) {
    const watcher = watchQaPageFailures(fakePage, 'preview console', origin);
    handlers.get('console')(consoleMessage('error', source));
    assert.throws(() => watcher.assertClean(), /unhandled browser failures/);
    watcher.dispose();
    assert.equal(handlers.size, 0, 'console listeners must be removed');
  }
  // A blank/foreign top call site must not hide a preview-owned error in
  // Puppeteer's stack; remote path aliases are not this local owner's errors.
  for (const [location, stackUrls] of [
    ['', [origin + '/src/ui/communityPlanningPreview.js?t=1']],
    ['https://tiles.example.test/unrelated.js', [
      origin + '/src/ui/sceneSharing.js',
    ]],
  ]) {
    const watcher = watchQaPageFailures(fakePage, 'preview stack', origin);
    handlers.get('console')(consoleMessage(
      'error', location, 'synthetic preview stack error', stackUrls,
    ));
    assert.throws(() => watcher.assertClean(), /unhandled browser failures/);
    watcher.dispose();
    assert.equal(handlers.size, 0, 'stack error listeners must be removed');
  }
  const bootstrap = watchQaPageFailures(fakePage, 'bootstrap console', origin);
  handlers.get('console')(consoleMessage(
    'error', '', 'Community planning fixture preview failed',
  ));
  assert.throws(() => bootstrap.assertClean(), /unhandled browser failures/);
  bootstrap.dispose();
  // Source-level error-path control: createSceneDialog disposal can throw;
  // mountCommunityPlanningPreview catches it and logs console.warn. A clean
  // DOM after that failure is NOT a successful cleanup receipt.
  for (const type of ['warn', 'error']) {
    const watcher = watchQaPageFailures(fakePage, 'failed cleanup', origin);
    handlers.get('console')(consoleMessage(
      type, '', 'Community planning preview cleanup failed Error: synthetic disposer',
    ));
    assert.throws(() => watcher.assertClean(), /unhandled browser failures/);
    watcher.dispose();
    assert.equal(handlers.size, 0, 'cleanup-warning listeners must be removed');
  }
  const unrelated = watchQaPageFailures(fakePage, 'unrelated console', origin);
  for (const [type, source] of [
    ['log', origin + '/src/ui/communityPlanningPreview.js'],
    ['error', origin + '/src/ui/otherFeature.js'],
    ['error', 'https://tiles.example.test/src/ui/communityPlanningPreview.js'],
  ]) handlers.get('console')(consoleMessage(type, source));
  for (const [type, stackUrl] of [
    ['log', origin + '/src/ui/communityPlanningPreview.js'],
    ['error', origin + '/src/ui/unrelated.js'],
    ['error', 'https://tiles.example.test/src/ui/communityPlanningPreview.js'],
  ]) handlers.get('console')(consoleMessage(
    type, '', 'unrelated stack', [stackUrl],
  ));
  // Avoid upgrading unrelated provider warnings or harmless log text to FAIL.
  handlers.get('console')(consoleMessage(
    'warn', origin + '/src/ui/communityPlanningPreview.js',
    'synthetic unrelated provider warning',
  ));
  handlers.get('console')(consoleMessage(
    'log', '', 'Community planning preview cleanup failed synthetic log',
  ));
  unrelated.assertClean();
  unrelated.dispose();
  assert.equal(handlers.size, 0, 'all page listeners must be removed');
}
checkQaPageFailureObserverNegativeControls();
assertCurrentCheckout();

// Vite's ?raw module returns the exact source text from the server's root.
// Compare all six directly involved owners with the pinned clean checkout. A browser
// pointed at another checkout must not earn an exact-head PASS.
const pinnedSources = Object.fromEntries(
  qaSources.map((path) => [
    `/${path}`,
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
  ]),
);
async function assertServedSourceIdentity(page) {
  const served = await page.evaluate(async (paths) => {
    const sources = {};
    for (const path of paths) {
      const module = await import(`${path}?raw`);
      sources[path] = module.default;
    }
    return sources;
  }, Object.keys(pinnedSources));
  assert.deepEqual(Object.keys(served).sort(), Object.keys(pinnedSources).sort());
  for (const [path, expected] of Object.entries(pinnedSources))
    assertSourceIdentity(expected, served[path], path);
}

/**
 * Observe actual requests rather than the capped Resource Timing buffer,
 * which may silently omit lazy imports on a busy GEV startup.
 */
function watchPreviewModuleRequests(page, expectedOrigin) {
  const paths = new Set();
  const baselineRequests = new Set();
  // Track additional credited HTTPS origins for imported synthetic sources.
  const creditedSourceOrigins = new Set(['https://example.org']);
  let requestCount = 0;
  const onRequest = (request) => {
    requestCount += 1;
    const requested = new URL(request.url());
    const pathname = requested.pathname;
    // Fixture baseline URLs are plain-text credits, never network inputs.
    if (creditedSourceOrigins.has(requested.origin))
      baselineRequests.add(requested.href);
    if (
      requested.origin === expectedOrigin &&
      (pathname === '/src/ui/communityPlanningPreview.js' ||
        pathname === '/src/standalone/communityPlanningFixture.js')
    ) {
      paths.add(pathname);
    }
  };
  page.on('request', onRequest);
  return {
    snapshot: () => [...paths].sort(),
    baselineRequests: () => [...baselineRequests].sort(),
    requestCount: () => requestCount,
    watchCreditedSource(sourceUrl) {
      const source = new URL(sourceUrl);
      if (source.protocol !== 'https:') throw new TypeError('HTTPS source required');
      creditedSourceOrigins.add(source.origin);
    },
    clear: () => {
      paths.clear();
      baselineRequests.clear();
      requestCount = 0;
    },
    dispose: () => page.off('request', onRequest),
  };
}

/** Negative control: prove baseline network detection without making a request. */
function checkBaselineRequestObserver() {
  let observedRequest = null;
  const fakePage = {
    on(event, listener) {
      assert.equal(event, 'request');
      observedRequest = listener;
    },
    off(event, listener) {
      assert.equal(event, 'request');
      assert.equal(listener, observedRequest);
    },
  };
  const watcher = watchPreviewModuleRequests(fakePage, 'http://localhost:4173');
  // A remote asset can reuse GEV module pathnames but cannot prove local opt-in.
  for (const path of [
    '/src/ui/communityPlanningPreview.js',
    '/src/standalone/communityPlanningFixture.js',
  ]) observedRequest({ url: () => `https://tiles.example.test${path}` });
  assert.deepEqual(
    watcher.snapshot(), [],
    'remote path aliases must not count as pinned GEV module requests',
  );
  for (const path of [
    '/src/ui/communityPlanningPreview.js',
    '/src/standalone/communityPlanningFixture.js',
  ]) observedRequest({ url: () => `http://localhost:4173${path}` });
  assert.deepEqual(watcher.snapshot(), [
    '/src/standalone/communityPlanningFixture.js',
    '/src/ui/communityPlanningPreview.js',
  ]);
  watcher.clear();
  observedRequest({ url: () => 'https://example.org/synthetic-fixture' });
  assert.deepEqual(watcher.baselineRequests(), [
    'https://example.org/synthetic-fixture',
  ]);
  watcher.clear();
  assert.deepEqual(watcher.baselineRequests(), []);
  // Negative controls must detect a source on another credited HTTPS origin,
  // including a wrong-path fetch, without issuing a real network request.
  const alternate = 'https://credited-source.example.net/fixture-v2';
  watcher.watchCreditedSource(alternate);
  observedRequest({ url: () => alternate });
  assert.deepEqual(watcher.baselineRequests(), [alternate]);
  watcher.clear();
  const unexpected = 'https://credited-source.example.net/other-path';
  observedRequest({ url: () => unexpected });
  assert.deepEqual(watcher.baselineRequests(), [unexpected]);
  watcher.clear();
  assert.throws(() => watcher.watchCreditedSource('http://example.net/'), TypeError);
  watcher.dispose();
}
checkBaselineRequestObserver();

/**
 * Headless gate for the opt-in GEV Scene preview. Start the GEV dev server first.
 * It never edits a real place or downloads municipal data.
 */
const origin = qaLoopbackOrigin(process.env.GEV_QA_APP_URL || 'http://localhost:4173');
const optOutUrl = new URL(origin);
optOutUrl.searchParams.delete('planningPreview');
const url = new URL(origin);
url.searchParams.set('planningPreview', 'fixture');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
let moduleRequests;
let desktopFailures;
try {
  const page = await browser.newPage();
  desktopFailures = watchQaPageFailures(page, 'desktop Scene QA', origin);
  const assertDesktopRequestsSafe = await guardQaTopLevelNavigation(page, origin);
  moduleRequests = watchPreviewModuleRequests(page, origin);
  await page.setViewport({ width: 1100, height: 900 });
  // Normal startup must not expose the fixture-only Scene launcher.
  await page.goto(optOutUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assertQaNavigationOrigin(page.url(), origin);
  await assertDesktopRequestsSafe();
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.sceneDirector?._controls &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  assert.equal(
    await page.$('[data-community-planning-preview-open]'),
    null,
    'the fixture launcher must be absent without planningPreview=fixture',
  );
  assert.equal(await page.$('[data-planning-source-provenance]'), null);
  assert.equal(await page.$('[data-planning-local-only]'), null);
  assert.ok(
    moduleRequests.requestCount() > 0,
    'request observer missed startup',
  );
  assert.deepEqual(
    moduleRequests.snapshot(),
    [],
    'normal startup must not request the fixture-only planning modules',
  );
  assert.deepEqual(
    moduleRequests.baselineRequests(), [],
    'normal startup must not request synthetic baseline URLs',
  );
  moduleRequests.clear();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assertQaNavigationOrigin(page.url(), origin);
  await assertDesktopRequestsSafe();
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.sceneDirector?._controls &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  // A programmatic .click() on a collapsed panel gives a false browser PASS.
  if (
    await page.$eval('#scene-panel', (panel) =>
      panel.classList.contains('collapsed'),
    )
  )
    await page.click('[data-collapse-target="scene-panel"]');
  await page.waitForSelector('[data-community-planning-preview-open]', {
    visible: true,
    timeout: 45000,
  });
  await page.click('[data-community-planning-preview-open]');
  await page.waitForSelector('[data-community-planning-preview]');
  // The modal must begin at its hypothetical heading, not on Cancel before
  // the cards are constructed. A native Tab must still reach real controls.
  assert.equal(
    await page.$eval('[data-community-planning-preview]', (dialog) =>
      document.activeElement === dialog.querySelector('h2[tabindex="-1"]')),
    true,
    'initial modal focus must announce the hypothetical planning heading',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.$eval('[data-community-planning-preview]', (dialog) =>
      document.activeElement === dialog.querySelector('[data-planning-cancel]')),
    true,
    'Tab from heading must reach the native Cancel control',
  );
  assert.ok(
    moduleRequests.requestCount() > 0,
    'request observer missed opt-in',
  );
  assert.deepEqual(moduleRequests.snapshot(), [
    '/src/standalone/communityPlanningFixture.js',
    '/src/ui/communityPlanningPreview.js',
  ]);
  assert.deepEqual(
    moduleRequests.baselineRequests(), [],
    'rendering synthetic baseline credits must not request their source URLs',
  );
  await assertServedSourceIdentity(page);
  // Inspect the real boot predicate through Vite, not a copied test helper.
  // Extra and duplicate query keys must never opt in to synthetic planning UI.
  const queryDecisions = await page.evaluate(async () => {
    const { isPlanningFixturePreviewRequested } =
      await import('/src/standalone/tools.js');
    return [
      ['?planningPreview=fixture', true],
      ['', false],
      ['?planningPreview=other', false],
      ['?planningPreview=fixture&access_token=synthetic-canary', false],
      ['?planningPreview=fixture&planningPreview=fixture', false],
      ['?foo=bar&planningPreview=fixture', false],
      ['?planningPreview=%66ixture', false],
    ].map(([search, expected]) => ({
      search,
      actual: isPlanningFixturePreviewRequested(search),
      expected,
    }));
  });
  for (const { search, actual, expected } of queryDecisions)
    assert.equal(actual, expected, `Fixture gate misclassified query ${search}`);
  const checked = await page.evaluate(() => {
    const dialog = document.querySelector('[data-community-planning-preview]');
    const text = dialog.textContent;
    const provenance = [...dialog.querySelectorAll(
      '[data-planning-source-provenance]',
    )].map((node) => node.textContent);
    return {
      open: dialog.open,
      alternatives: dialog.querySelectorAll('[data-alternative-id]').length,
      markers: dialog.querySelectorAll('svg circle').length,
      synthetic: text.includes('SYNTHETIC FIXTURE'),
      hypothetical: (text.match(/HYPOTHETICAL · NOT APPROVED/g) || []).length,
      alice: text.includes('Recorded author: alice'),
      bob: text.includes('Recorded author: bob'),
      editProvenance: [...dialog.querySelectorAll('.planning-edit-provenance')]
        .map((node) => node.textContent),
      official: text.includes('Approval: not-requested'),
      provenance,
      localOnly: dialog.querySelector('[data-planning-local-only]')?.textContent,
      recordSummary: dialog.querySelector('[data-planning-record-summary]')?.textContent,
      excludedDisclosure: dialog.querySelector('[data-planning-excluded-details]'),
    };
  });
  assert.deepEqual(checked, {
    open: true,
    alternatives: 2,
    markers: 5,
    synthetic: true,
    hypothetical: 2,
    alice: true,
    bob: true,
    editProvenance: [
      'Recorded edit: bob-play-v1 · logical counter: 1 (unverified, not approval)',
      'Recorded edit: alice-trees-v1 · logical counter: 1 (unverified, not approval)',
    ],
    official: true,
    provenance: [
      'Baseline citation (UNVERIFIED): synthetic-source · revision: fixture-v1 · ' +
        'claimed attribution: Generated example, not official parcel data · ' +
        'claimed license (NOT rights-cleared): synthetic-test-data · ' +
        'source URL (not fetched): https://example.org/synthetic-fixture',
    ],
    localOnly: 'LOCAL-ONLY DISPLAY · No shared room, live participants or synchronized edits.',
    recordSummary: 'Planning records: 0 stale/incompatible excluded; ' +
      '0 valid beyond this two-proposal preview. ' +
      'This snapshot cannot reconstruct overwritten edits or resolve conflicts.',
    excludedDisclosure: null,
  });
  assert.ok(
    checked.provenance.every((line) =>
      line.includes('UNVERIFIED') && line.includes('NOT rights-cleared')),
    'author-entered attribution/license cannot masquerade as verified reuse rights',
  );
  const initiallyVisible = await page.$eval(
    '[data-community-planning-preview] [data-alternative-id]',
    (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
  );
  assert.deepEqual(initiallyVisible, ['play-first', 'trees-first']);
  // Use Puppeteer pointer interaction, not a hidden button's synthetic click.
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="game"]',
  );
  const focused = await page.$$eval(
    '[data-community-planning-preview] [data-alternative-id]',
    (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
  );
  assert.deepEqual(focused, ['play-first']);
  assert.equal(
    await page.$eval('[data-planning-mode-status]', (el) => el.textContent),
    'View: game · inspecting Play & community garden · proposal play-first (hypothetical) · neither mode grants authority',
  );
  assert.equal(
    await page.$eval('[data-planning-focus-navigation]', (el) => el.hidden),
    false,
  );
  await page.click('[data-planning-focus-id="trees-first"]');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['trees-first'],
  );
  assert.equal(
    await page.$eval('[data-planning-mode-status]', (el) => el.textContent),
    'View: game · inspecting Trees & shade · proposal trees-first (hypothetical) · neither mode grants authority',
  );
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="co-op"]',
  );
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );
  assert.equal(
    await page.$eval('[data-planning-focus-navigation]', (el) => el.hidden),
    true,
  );
  // Use Puppeteer pointer interaction, not a hidden button's synthetic click.
  await page.click(
    '[data-community-planning-preview] [data-planning-mode="game"]',
  );
  const mode = await page.$eval('[data-planning-mode-status]', (el) => ({
    text: el.textContent,
    role: el.getAttribute('role'),
    live: el.getAttribute('aria-live'),
    atomic: el.getAttribute('aria-atomic'),
  }));
  assert.deepEqual(mode, {
    text: 'View: game · inspecting Trees & shade · proposal trees-first (hypothetical) · neither mode grants authority',
    role: 'status',
    live: 'polite',
    atomic: 'true',
  });
  // Native button activation, not a synthetic click: focus then press Enter.
  assert.equal(
    await page.evaluate(() => {
      const button = document.querySelector('[data-planning-focus-id="play-first"]');
      button.focus();
      return document.activeElement === button;
    }),
    true,
  );
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first'],
  );
  assert.equal(
    await page.$eval('[data-planning-focus-id="play-first"]', (el) =>
      el.getAttribute('aria-pressed')),
    'true',
  );
  assert.equal(
    await page.$eval('[data-planning-mode-status]', (el) => el.textContent),
    'View: game · inspecting Play & community garden · proposal play-first (hypothetical) · neither mode grants authority',
  );
  assert.equal(
    await page.evaluate(() => {
      const dialog = document.querySelector('[data-community-planning-preview]');
      const button = [...dialog.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Co-op view',
      );
      button.focus();
      return document.activeElement === button;
    }),
    true,
  );
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );

  assert.equal(
    await page.$eval('[data-planning-mode-status]', (el) => el.textContent),
    'View: co-op · neither mode grants authority',
  );

  // Game's Inspect controls precede the mode footer in tab order. A native
  // keyboard entry must reveal and focus the selected Inspect action; pointer
  // entry must leave focus on the tapped/clicked mode control instead.
  await page.keyboard.press('Tab');
  assert.equal(
    await page.$eval('[data-planning-mode="game"]', (button) =>
      document.activeElement === button),
    true,
    'Tab from Co-op must reach Game mode',
  );
  await page.keyboard.press('Enter');
  assert.equal(
    await page.$eval('[data-planning-focus-id="play-first"]', (button) =>
      document.activeElement === button),
    true,
    'keyboard Game entry must focus its revealed selected Inspect control',
  );
  // A scripted/touch-like mode change need not focus the clicked button.
  // Hiding a still-focused Inspect button would drop focus to the document.
  await page.$eval('[data-planning-mode="co-op"]', (button) => button.click());
  assert.deepEqual(
    await page.$eval('[data-community-planning-preview]', (dialog) => ({
      coOpFocused: document.activeElement ===
        dialog.querySelector('[data-planning-mode="co-op"]'),
      inspectHidden: dialog.querySelector('[data-planning-focus-navigation]').hidden,
      visibleCount: [...dialog.querySelectorAll('[data-alternative-id]')]
        .filter((article) => !article.hidden).length,
    })),
    { coOpFocused: true, inspectHidden: true, visibleCount: 2 },
    'closing Game must not strand focus inside hidden Inspect navigation',
  );
  await page.click('[data-planning-mode="game"]');
  assert.equal(
    await page.$eval('[data-planning-mode="game"]', (button) =>
      document.activeElement === button),
    true,
    'pointer Game entry must not steal focus from the clicked mode control',
  );
  await page.click('[data-planning-mode="co-op"]');

  // Set mobile/touch emulation before navigation. Changing isMobile or
  // hasTouch on the active desktop page can reload it and destroy the modal.
  const mobilePage = await browser.newPage();
  const assertMobileRequestsSafe = await guardQaTopLevelNavigation(mobilePage, origin);
  // The mobile tab has an independent request stream. The desktop watcher
  // alone cannot establish that credits stay network-inert during touch QA.
  const mobileRequests = watchPreviewModuleRequests(mobilePage, origin);
  const mobileFailures = watchQaPageFailures(mobilePage, 'mobile Scene QA', origin);
  try {
    await mobilePage.setViewport({
      width: 375,
      height: 667,
      isMobile: true,
      hasTouch: true,
    });
    await mobilePage.goto(url.href, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    assertQaNavigationOrigin(mobilePage.url(), origin);
    await assertMobileRequestsSafe();
    await mobilePage.waitForFunction(
      () =>
        window.__godsEyeView?.sceneDirector?._controls &&
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 60000 },
    );
    if (
      await mobilePage.$eval('#scene-panel', (panel) =>
        panel.classList.contains('collapsed'),
      )
    )
      await mobilePage.tap('[data-collapse-target="scene-panel"]');
    await mobilePage.waitForSelector('[data-community-planning-preview-open]', {
      visible: true,
      timeout: 45000,
    });
    // Touch the actual opt-in launcher rather than clicking an invisible node.
    await mobilePage.tap('[data-community-planning-preview-open]');
    await mobilePage.waitForSelector('[data-community-planning-preview]', {
      visible: true,
    });
    const mobile = await mobilePage.evaluate(() => {
      const dialog = document.querySelector('[data-community-planning-preview]');
      const rect = dialog.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        left: rect.left,
        right: rect.right,
        open: dialog.open,
        disclaimer: dialog.textContent.includes('HYPOTHETICAL · NOT APPROVED'),
        localOnly: dialog.querySelector('[data-planning-local-only]')?.textContent,
        alternatives: dialog.querySelectorAll('[data-alternative-id]').length,
      };
    });
    assert.equal(mobile.open, true);
    assert.equal(mobile.disclaimer, true);
    assert.equal(mobile.localOnly, 'LOCAL-ONLY DISPLAY · No shared room, live participants or synchronized edits.');
    assert.equal(mobile.alternatives, 2);
    assert.ok(mobile.viewportWidth <= 400, 'mobile CSS viewport did not activate');
    assert.ok(
      mobile.left >= -1 && mobile.right <= mobile.viewportWidth + 1,
      'planning dialog clips outside the mobile CSS viewport',
    );
    // Real emulated touch must switch between one-card and two-card modes.
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-mode="game"]',
    );
    assert.deepEqual(
      await mobilePage.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
      ),
      ['play-first'],
    );
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-mode="co-op"]',
    );
    assert.deepEqual(
      await mobilePage.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
      ),
      ['play-first', 'trees-first'],
    );
    // Phones have no Escape key: prove the visible Cancel control actually
    // disposes the dialog through emulated touch and leaves one live launcher.
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-cancel]',
    );
    assert.equal(await mobilePage.$('[data-community-planning-preview]'), null);
    assert.equal(await mobilePage.$('[data-planning-local-only]'), null);
    assert.equal(
      await mobilePage.$$eval(
        '[data-community-planning-preview-open]',
        (items) => items.length,
      ),
      1,
    );
    // A legitimate long HTTPS reference must not force horizontal scrolling.
    // The unwrapped measurement is an explicit negative control, not a
    // production setting; no external URL is fetched by this fixture.
    // Use another valid HTTPS origin so the network observer cannot pass
    // solely by watching the default example.org fixture host.
    const longSourceUrl = `https://credited-source.example.net/${'x'.repeat(1400)}`;
    mobileRequests.watchCreditedSource(longSourceUrl);
    const longSourceLayout = await mobilePage.evaluate(async (longSourceUrl) => {
      const { createSyntheticCommunityPlanningFixture } = await import(
        '/src/standalone/communityPlanningFixture.js'
      );
      const { createCommunityPlanningProject } = await import(
        '/src/data/communityPlanning.js'
      );
      const { openCommunityPlanningPreview } = await import(
        '/src/ui/communityPlanningPreview.js'
      );
      const { project, collaborationState } =
        createSyntheticCommunityPlanningFixture();
      const sourcedProject = createCommunityPlanningProject({
        ...project,
        baseline: {
          ...project.baseline,
          sources: [{ ...project.baseline.sources[0], url: longSourceUrl }],
        },
      });
      const preview = openCommunityPlanningPreview({
        project: sourcedProject,
        collaborationState,
      });
      try {
        const provenance = preview.element.querySelector(
          '[data-planning-source-provenance]',
        );
        const measure = () => ({
          clientWidth: preview.body.clientWidth,
          scrollWidth: preview.body.scrollWidth,
        });
        const wrapped = measure();
        const previousWrap = preview.body.style.overflowWrap;
        preview.body.style.overflowWrap = 'normal';
        provenance.style.whiteSpace = 'nowrap';
        const unwrapped = measure();
        provenance.style.whiteSpace = '';
        preview.body.style.overflowWrap = previousWrap;
        return {
          fixtureUrlDisplayed: provenance.textContent.includes(longSourceUrl),
          wrapped,
          unwrapped,
        };
      } finally {
        preview.dispose();
      }
    }, longSourceUrl);
    assert.equal(longSourceLayout.fixtureUrlDisplayed, true);
    assert.ok(
      longSourceLayout.unwrapped.scrollWidth >
        longSourceLayout.unwrapped.clientWidth + 1,
      'long-URL negative control did not exercise mobile overflow',
    );
    assert.ok(
      longSourceLayout.wrapped.scrollWidth <=
        longSourceLayout.wrapped.clientWidth + 1,
      'a credited long HTTPS source must fit within the mobile dialog body',
    );
    // Reopen by touch, not an invisible synthetic click; confirm the mounted
    // Scene owner has no stale modal/listener after the first dismissal.
    if (
      await mobilePage.$eval('#scene-panel', (panel) =>
        panel.classList.contains('collapsed'),
      )
    )
      await mobilePage.tap('[data-collapse-target="scene-panel"]');
    await mobilePage.waitForSelector('[data-community-planning-preview-open]', {
      visible: true,
    });
    await mobilePage.tap('[data-community-planning-preview-open]');
    await mobilePage.waitForSelector('[data-community-planning-preview]', {
      visible: true,
    });
    assert.equal(
      await mobilePage.$eval(
        '[data-community-planning-preview]',
        (dialog) => dialog.open,
      ),
      true,
    );
    await mobilePage.tap(
      '[data-community-planning-preview] [data-planning-cancel]',
    );
    assert.equal(await mobilePage.$('[data-community-planning-preview]'), null);
    assert.deepEqual(
      mobileRequests.baselineRequests(), [],
      'mobile touch, long-source display and teardown must not fetch credited baselines',
    );
    mobileFailures.assertClean();
    await assertMobileRequestsSafe();
  } finally {
    mobileFailures.dispose();
    mobileRequests.dispose();
    await mobilePage.close();
  }

  // Escape must fully dispose the modal; reopening must be fresh and singular.
  await page.keyboard.press('Escape');
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  assert.equal(
    await page.$eval('[data-community-planning-preview-open]', (button) =>
      document.activeElement === button),
    true,
    'Escape must restore keyboard focus to the surviving Scene launcher',
  );
  assert.equal(
    await page.$$eval('[data-community-planning-preview-open]', (items) => items.length),
    1,
  );
  // Escape may close the accordion too; re-open using the installed control.
  if (
    await page.$eval('#scene-panel', (panel) =>
      panel.classList.contains('collapsed'),
    )
  )
    await page.click('[data-collapse-target="scene-panel"]');
  await page.waitForSelector('[data-community-planning-preview-open]', {
    visible: true,
  });
  await page.click('[data-community-planning-preview-open]');
  await page.waitForSelector('[data-community-planning-preview]');
  assert.equal(
    await page.$eval('[data-community-planning-preview]', (dialog) => dialog.open),
    true,
  );
  assert.deepEqual(
    await page.$$eval(
      '[data-community-planning-preview] [data-alternative-id]',
      (items) => items.filter((item) => !item.hidden).map((item) => item.dataset.alternativeId),
    ),
    ['play-first', 'trees-first'],
  );
  if (process.env.GEV_QA_SCREENSHOT)
    await page.screenshot({ path: process.env.GEV_QA_SCREENSHOT });
  // Cancel must be an actual visible pointer target, not Element.click().
  await page.click(
    '[data-community-planning-preview] [data-planning-cancel]',
  );
  assert.equal(
    await page.$('[data-community-planning-preview]'),
    null,
  );
  assert.equal(
    await page.$eval('[data-community-planning-preview-open]', (button) =>
      document.activeElement === button),
    true,
    'Cancel must return focus to the surviving Scene launcher',
  );
  assert.equal(await page.$('[data-planning-source-provenance]'), null);
  assert.equal(await page.$('[data-planning-local-only]'), null);

  // Distinct proposal IDs must remain accessible when titles collide.
  // All operations use the existing schema and synthetic fixture baseline.
  const duplicateTitles = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { createPlanningAlternativeOperation } = await import(
      '/src/data/communityPlanning.js'
    );
    const { createCollaborationState, applyCollaborationOperations } =
      await import('/src/data/collaborationAuthority.js');
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project } = createSyntheticCommunityPlanningFixture();
    const operations = ['play-first', 'trees-first'].map((id, index) =>
      createPlanningAlternativeOperation(project, {
        operationId: `same-title-${id}`,
        actorId: index === 0 ? 'alice' : 'bob',
        counter: 1,
        alternativeId: id,
        title: 'Shared park name',
        features: [],
        assumptions: [],
      }),
    );
    const { state } = applyCollaborationOperations(
      createCollaborationState(),
      operations,
    );
    const dialog = openCommunityPlanningPreview({
      project,
      collaborationState: state,
    });
    try {
      const root = dialog.element;
      const cards = [...root.querySelectorAll('[data-alternative-id]')]
        .map((node) => node.getAttribute('aria-label'));
      const inspect = [...root.querySelectorAll('[data-planning-focus-id]')]
        .map((node) => node.textContent);
      const schematics = [...root.querySelectorAll('[data-alternative-id] svg')]
        .map((node) => node.getAttribute('aria-label'));
      root.querySelector('[data-planning-mode="game"]').click();
      root.querySelector('[data-planning-focus-id="trees-first"]').click();
      return {
        cards,
        inspect,
        schematics,
        status: root.querySelector('[data-planning-mode-status]').textContent,
      };
    } finally {
      dialog.dispose();
    }
  });
  assert.deepEqual(duplicateTitles, {
    cards: [
      'Shared park name · proposal play-first',
      'Shared park name · proposal trees-first',
    ],
    inspect: [
      'Inspect Shared park name · proposal play-first',
      'Inspect Shared park name · proposal trees-first',
    ],
    schematics: [
      'Synthetic marker positions for Shared park name · proposal play-first; not surveyed',
      'Synthetic marker positions for Shared park name · proposal trees-first; not surveyed',
    ],
    status: 'View: game · inspecting Shared park name · proposal trees-first (hypothetical) · neither mode grants authority',
  });
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // Scene owner teardown can happen with the modal still open, not just on
  // Cancel or Escape. Verify a temporary owner removes the dialog, launcher,
  // and click listener without disturbing the installed Scene launcher.
  const mounted = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const panel = document.getElementById('scene-panel');
    const before = panel.querySelectorAll(
      '[data-community-planning-preview-open]',
    ).length;
    const dispose = mountCommunityPlanningPreview({
      project,
      collaborationState,
      panel,
    });
    const buttons = panel.querySelectorAll(
      '[data-community-planning-preview-open]',
    );
    const ephemeral = buttons[buttons.length - 1];
    ephemeral.dataset.planningQaTemporaryLauncher = '';
    window.__gevPlanningTeardownQa = { dispose, ephemeral };
    return { before, during: buttons.length };
  });
  assert.deepEqual(mounted, { before: 1, during: 2 });
  // Real pointer activation; this is a second mount, not a synthetic DOM stub.
  await page.click('[data-planning-qa-temporary-launcher]');
  assert.equal(
    await page.$eval(
      '[data-community-planning-preview]',
      (dialog) => dialog.open,
    ),
    true,
  );
  const disposed = await page.evaluate(() => {
    const owner = window.__gevPlanningTeardownQa;
    try {
      owner.dispose();
      const afterFirst = {
        controls: document.querySelectorAll(
          '[data-community-planning-preview-open]',
        ).length,
        modals: document.querySelectorAll(
          '[data-community-planning-preview]',
        ).length,
      };
      owner.dispose();
      owner.ephemeral.click();
      return {
        afterFirst,
        afterSecondControls: document.querySelectorAll(
          '[data-community-planning-preview-open]',
        ).length,
        afterSecondModals: document.querySelectorAll(
          '[data-community-planning-preview]',
        ).length,
        detached: !owner.ephemeral.isConnected,
      };
    } finally {
      delete window.__gevPlanningTeardownQa;
    }
  });
  assert.deepEqual(disposed, {
    afterFirst: { controls: 1, modals: 0 },
    afterSecondControls: 1,
    afterSecondModals: 0,
    detached: true,
  });
  // Third and later valid authored alternatives are not compared, but their
  // provenance must remain discoverable and bounded instead of disappearing.
  const additional = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { createPlanningAlternativeOperation } = await import(
      '/src/data/communityPlanning.js'
    );
    const { applyCollaborationOperation } = await import(
      '/src/data/collaborationAuthority.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const inspect = (count) => {
      const { project, collaborationState } =
        createSyntheticCommunityPlanningFixture();
      let state = collaborationState;
      for (let i = 0; i < count; i++) {
        const padded = String(i).padStart(2, '0');
        const operation = createPlanningAlternativeOperation(project, {
          operationId: `charlie-extra-${padded}`,
          actorId: 'charlie',
          counter: i + 1,
          alternativeId: `zz-${padded}`,
          title: `Extra hypothetical park ${padded}`,
          features: [],
          assumptions: ['No site ownership checked'],
        });
        const next = applyCollaborationOperation(state, operation);
        if (!next.result.accepted || !next.result.changed)
          throw new Error('synthetic operation was not accepted');
        state = next.state;
      }
      const preview = openCommunityPlanningPreview({
        project,
        collaborationState: state,
      });
      try {
        const root = preview.element;
        const details = root.querySelector('[data-planning-additional-details]');
        return {
          cards: [...root.querySelectorAll('[data-alternative-id]')]
            .map((item) => item.dataset.alternativeId),
          summary: root.querySelector('[data-planning-record-summary]').textContent,
          heading: details?.querySelector('summary')?.textContent,
          records: [...(details?.querySelectorAll('[data-planning-additional-record]') ?? [])]
            .map((item) => item.textContent),
          overflow: details?.querySelector('li:last-child')?.textContent,
        };
      } finally {
        preview.dispose();
      }
    };
    return { one: inspect(1), many: inspect(10) };
  });
  assert.deepEqual(additional.one.cards, ['play-first', 'trees-first']);
  assert.ok(additional.one.summary.includes('1 valid beyond this two-proposal preview'));
  assert.equal(
    additional.one.heading,
    'Inspect 1 additional valid hypothetical proposal not shown in comparison',
  );
  assert.deepEqual(additional.one.records, [
    'Extra hypothetical park 00 · proposal zz-00 · Recorded author: charlie (unverified identity) · ' +
      'Source revision: synthetic-parcel-v1 · HYPOTHETICAL · NOT APPROVED',
  ]);
  assert.deepEqual(additional.many.cards, ['play-first', 'trees-first']);
  assert.ok(additional.many.summary.includes('10 valid beyond this two-proposal preview'));
  assert.equal(additional.many.records.length, 8);
  assert.ok(additional.many.records[0].includes('proposal zz-00'));
  assert.ok(additional.many.records[7].includes('proposal zz-07'));
  assert.equal(additional.many.overflow, '2 more valid proposals not listed');
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // Negative control: an unsupported/stale imported proposal is excluded
  // visibly, without leaking into the two valid synthetic alternatives.
  const excluded = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const key = 'draft-scenario:community-plan:synthetic-park:trees-first';
    const original = collaborationState.authored[key].fields.proposal;
    const staleRecord = {
      fields: {
        proposal: {
          ...original,
          value: {
            ...original.value,
            alternativeId: 'stale',
            baselineRevision: 'obsolete-r0',
          },
        },
      },
    };
    collaborationState.authored[
      'draft-scenario:community-plan:synthetic-park:stale'
    ] = staleRecord;
    collaborationState.authored[
      'draft-scenario:community-plan:other-project:unrelated'
    ] = staleRecord;
    const preview = openCommunityPlanningPreview({ project, collaborationState });
    try {
      return {
        summary: preview.element.querySelector(
          '[data-planning-record-summary]',
        ).textContent,
        visibleIds: [
          ...preview.element.querySelectorAll('[data-alternative-id]'),
        ].map((item) => item.dataset.alternativeId),
        disclosure: preview.element.querySelector(
          '[data-planning-excluded-details] summary',
        )?.textContent,
        excludedEntries: [...preview.element.querySelectorAll(
          '[data-planning-excluded-record]',
        )].map((item) => item.textContent),
        unrelatedVisible: preview.element.textContent.includes('other-project'),
      };
    } finally {
      preview.dispose();
    }
  });
  assert.ok(excluded.summary.includes('1 stale/incompatible excluded'));
  assert.deepEqual(excluded.visibleIds, ['play-first', 'trees-first']);
  assert.equal(excluded.disclosure, 'Inspect 1 excluded proposal record');
  assert.deepEqual(excluded.excludedEntries, [
    'Excluded stale · baseline revision differs from reference; other validation failures may exist',
  ]);
  assert.equal(excluded.unrelatedVisible, false);
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // Rejected proposal identities are a bounded disclosure, not a CRDT arrival
  // log. Reordering identical imported records must not change which eight
  // IDs appear, and malformed IDs must remain masked.
  const exclusionOrder = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const ids = [
      'zz', 'aa', 'yy', 'bb', 'xx', 'cc', 'ww', 'dd', 'vv', 'ee',
      '../private-location',
    ];
    const inspect = (order) => {
      const { project, collaborationState } =
        createSyntheticCommunityPlanningFixture();
      const original = collaborationState.authored[
        'draft-scenario:community-plan:synthetic-park:trees-first'
      ].fields.proposal;
      for (const id of order) {
        collaborationState.authored[
          `draft-scenario:community-plan:synthetic-park:${id}`
        ] = {
          fields: {
            proposal: {
              ...original,
              value: {
                ...original.value,
                alternativeId: id,
                baselineRevision: 'obsolete-r0',
              },
            },
          },
        };
      }
      const dialog = openCommunityPlanningPreview({
        project,
        collaborationState,
      });
      try {
        const root = dialog.element;
        const details = root.querySelector('[data-planning-excluded-details]');
        return {
          entries: [
            ...details.querySelectorAll('[data-planning-excluded-record]'),
          ].map((item) => item.textContent),
          overflow: details.querySelector('li:last-child')?.textContent,
          invalidLeaked: root.textContent.includes('../private-location'),
          alternatives: [...root.querySelectorAll('[data-alternative-id]')]
            .map((item) => item.dataset.alternativeId),
        };
      } finally {
        dialog.dispose();
      }
    };
    return { forward: inspect(ids), reverse: inspect([...ids].reverse()) };
  });
  assert.deepEqual(
    exclusionOrder.forward,
    exclusionOrder.reverse,
    'excluded record order/cap must not depend on import arrival order',
  );
  assert.deepEqual(exclusionOrder.forward.entries, [
    'Excluded (invalid proposal id) · invalid proposal identifier; other validation failures may exist',
    ...['aa', 'bb', 'cc', 'dd', 'ee', 'vv', 'ww'].map(
      (id) =>
        `Excluded ${id} · proposal ID differs from its record key; other validation failures may exist`,
    ),
  ]);
  assert.equal(
    exclusionOrder.forward.overflow,
    '3 more excluded records not listed',
  );
  assert.equal(exclusionOrder.forward.invalidLeaked, false);
  assert.deepEqual(exclusionOrder.forward.alternatives, [
    'play-first',
    'trees-first',
  ]);
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // Distinguish specific observable mismatches without guessing merge history,
  // echoing rejected payloads, or inferring real-world author/approval rights.
  const exclusionReasons = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const key = (id) => `draft-scenario:community-plan:${project.id}:${id}`;
    const seed = collaborationState.authored[key('play-first')];
    const put = (id, changes = {}) => {
      collaborationState.authored[key(id)] = {
        ...seed,
        targetId: `community-plan:${project.id}:${id}`,
        fields: {
          proposal: {
            ...seed.fields.proposal,
            value: {
              ...seed.fields.proposal.value,
              alternativeId: id,
              ...changes,
            },
          },
        },
      };
    };
    put('wrong-project', { projectId: 'other-project' });
    // Imported projection must disclose unsupported authority/model claims
    // without echoing untrusted payloads or promoting them into valid cards.
    put('unsupported-schema', { schemaVersion: 99 });
    put('observed-state', { state: 'observed' });
    put('claimed-impact', { modeledImpact: 'fabricated-traffic-benefit' });
    put('claimed-approval', { approval: 'municipal-approved-<script>' });
    put('wrong-baseline', { baselineRevision: 'obsolete-r0' });
    put('wrong-kind');
    collaborationState.authored[key('wrong-kind')].kind = 'comment';
    put('no-payload');
    delete collaborationState.authored[key('no-payload')].fields.proposal.value;
    const preview = openCommunityPlanningPreview({ project, collaborationState });
    try {
      return [...preview.element.querySelectorAll(
        '[data-planning-excluded-record]',
      )].map((item) => item.textContent);
    } finally {
      preview.dispose();
    }
  });
  assert.deepEqual(exclusionReasons, [
    'Excluded claimed-approval · proposal carries an unverified approval claim; other validation failures may exist',
    'Excluded claimed-impact · proposal claims an evaluated impact; other validation failures may exist',
    'Excluded no-payload · missing or malformed proposal payload; other validation failures may exist',
    'Excluded observed-state · proposal is not marked hypothetical; other validation failures may exist',
    'Excluded unsupported-schema · unsupported proposal schema revision; other validation failures may exist',
    'Excluded wrong-baseline · baseline revision differs from reference; other validation failures may exist',
    'Excluded wrong-kind · record ownership metadata differs; other validation failures may exist',
    'Excluded wrong-project · proposal belongs to another project; other validation failures may exist',
  ]);
  assert.ok(
    !exclusionReasons.some((line) => /fabricated-traffic-benefit|municipal-approved-<script>/.test(line)),
    'rejected impact/approval payloads must never be echoed into Scene text',
  );
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // Negative controls: a stale winner cannot count as a valid proposal.
  // One or zero valid alternatives must not expose a usable compare mode.
  const insufficient = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const inspect = (staleIds) => {
      const { project, collaborationState } =
        createSyntheticCommunityPlanningFixture();
      for (const id of staleIds) {
        const key = `draft-scenario:community-plan:synthetic-park:${id}`;
        const proposal = collaborationState.authored[key].fields.proposal;
        proposal.value = {
          ...proposal.value,
          baselineRevision: 'obsolete-r0',
        };
      }
      const preview = openCommunityPlanningPreview({ project, collaborationState });
      try {
        const root = preview.element;
        return {
          visibleIds: [...root.querySelectorAll('[data-alternative-id]')]
            .map((item) => item.dataset.alternativeId),
          gameDisabled: [...root.querySelectorAll('button')].find(
            (button) => button.textContent === 'Game view'
          ).disabled,
          notice: root.querySelector('[data-planning-comparison-unavailable]')
            ?.textContent,
          excluded: root.querySelector('[data-planning-record-summary]')
            .textContent.includes(`${staleIds.length} stale/incompatible excluded`),
        };
      } finally {
        preview.dispose();
      }
    };
    return {
      one: inspect(['play-first']),
      none: inspect(['play-first', 'trees-first']),
    };
  });
  assert.deepEqual(insufficient, {
    one: {
      visibleIds: ['trees-first'],
      gameDisabled: true,
      notice: 'Only one valid proposal is available; comparing requires two.',
      excluded: true,
    },
    none: {
      visibleIds: [],
      gameDisabled: true,
      notice: 'No valid proposals to compare; excluded records cannot be displayed as alternatives.',
      excluded: true,
    },
  });
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  // A missing or malformed clock must never invent authorship or an edit ID.
  const missingClock = await page.evaluate(async () => {
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const { openCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { project, collaborationState } =
      createSyntheticCommunityPlanningFixture();
    const key = 'draft-scenario:community-plan:synthetic-park:play-first';
    delete collaborationState.authored[key].fields.proposal.clock;
    const preview = openCommunityPlanningPreview({ project, collaborationState });
    try {
      const card = preview.element.querySelector(
        '[data-alternative-id="play-first"]',
      );
      return {
        author: card.querySelector('.planning-author-credit').textContent,
        edit: card.querySelector('.planning-edit-provenance').textContent,
      };
    } finally {
      preview.dispose();
    }
  });
  assert.deepEqual(missingClock, {
    author: 'Recorded author: unknown',
    edit: 'Recorded edit: unknown (no valid recorded operation metadata)',
  });
  assert.equal(await page.$('[data-community-planning-preview]'), null);
  assert.deepEqual(
    moduleRequests.baselineRequests(), [],
    'mode changes, provenance disclosures and teardown must never fetch baseline source URLs',
  );
  // A Scene panel can be detached before its owner runs the disposer.
  // A retained off-DOM button must not resurrect a hypothetical modal.
  const disconnectedOwner = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const host = document.createElement('section');
    const inner = document.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    document.body.append(host);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    try {
      host.remove(); // Simulate detached Scene host before disposal.
      launcher.click();
      const blockedWhileDetached = !document.querySelector(
        '[data-community-planning-preview]',
      );
      document.body.append(host); // Reattached live owner still works.
      launcher.click();
      const openedAfterReattach = Boolean(document.querySelector(
        '[data-community-planning-preview]',
      )?.open);
      document.querySelector(
        '[data-community-planning-preview] [data-planning-cancel]',
      )?.click();
      const cleanAfterClose = !document.querySelector(
        '[data-community-planning-preview]',
      );
      return { blockedWhileDetached, openedAfterReattach, cleanAfterClose };
    } finally {
      stop();
      host.remove();
    }
  });
  assert.deepEqual(disconnectedOwner, {
    blockedWhileDetached: true,
    openedAfterReattach: true,
    cleanAfterClose: true,
  });
  // A launcher moved into an unrelated connected host is not owned by Scene.
  // Returning it to Scene restores opt-in without reviving a stale dialog.
  const relocatedOwner = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const host = document.createElement('section');
    const inner = document.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    const otherHost = document.createElement('section');
    document.body.append(host, otherHost);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    const isOpen = () => Boolean(document.querySelector(
      '[data-community-planning-preview]',
    ));
    try {
      otherHost.appendChild(launcher);
      launcher.click();
      const blockedOutsideScene = !isOpen();
      inner.appendChild(launcher);
      launcher.click();
      const openedInsideScene = isOpen();
      document.querySelector(
        '[data-community-planning-preview] [data-planning-cancel]',
      )?.click();
      const cleanAfterClose = !isOpen();
      return { blockedOutsideScene, openedInsideScene, cleanAfterClose };
    } finally {
      stop();
      host.remove();
      otherHost.remove();
    }
  });
  assert.deepEqual(relocatedOwner, {
    blockedOutsideScene: true,
    openedInsideScene: true,
    cleanAfterClose: true,
  });
  // A stale Scene owner document can lose its Window before disposal. Even
  // if a layout rectangle is retained, its click must not throw or reopen UI.
  const retiredDocumentOwner = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const retired = document.implementation.createHTMLDocument('retired scene');
    const host = retired.createElement('section');
    const inner = retired.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    retired.body.append(host);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    // Force the stale-layout negative control to reach the browsing-context
    // check regardless of how Chromium lays out disconnected documents.
    launcher.getClientRects = () => [new DOMRect(0, 0, 1, 1)];
    const errors = [];
    const onError = (event) => errors.push(String(event.message));
    window.addEventListener('error', onError);
    try {
      launcher.click();
    } finally {
      window.removeEventListener('error', onError);
      stop();
    }
    return {
      noBrowsingContext: retired.defaultView === null,
      blocked: !document.querySelector('[data-community-planning-preview]'),
      errors,
    };
  });
  assert.deepEqual(retiredDocumentOwner, {
    noBrowsingContext: true,
    blocked: true,
    errors: [],
  });
  // Synthetic click delivery on a connected but inaccessible Scene launcher
  // must not create a dialog. Visible opt-in still opens and closes normally.
  const inaccessibleOwnerActivation = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const wrapper = document.createElement('div');
    const host = document.createElement('section');
    const inner = document.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    wrapper.append(host);
    document.body.append(wrapper);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    const isOpen = () => Boolean(document.querySelector(
      '[data-community-planning-preview]',
    ));
    try {
      host.hidden = true;
      launcher.click();
      const hiddenBlocked = !isOpen();
      host.hidden = false;
      host.classList.add('collapsed');
      launcher.click();
      const collapsedBlocked = !isOpen();
      host.classList.remove('collapsed');
      host.style.visibility = 'hidden';
      launcher.click();
      const visibilityBlocked = !isOpen();
      host.style.visibility = '';
      host.inert = true;
      launcher.click();
      const inertBlocked = !isOpen();
      host.inert = false;
      host.setAttribute('aria-hidden', 'true');
      launcher.click();
      const ariaHiddenBlocked = !isOpen();
      host.removeAttribute('aria-hidden');
      // Zero-opacity controls retain layout and script click delivery.
      host.style.opacity = '0';
      const opacityStillLaysOut = launcher.getClientRects().length > 0;
      launcher.click();
      const hostOpacityBlocked = !isOpen();
      host.style.opacity = '';
      launcher.style.opacity = '0';
      launcher.click();
      const launcherOpacityBlocked = !isOpen();
      launcher.style.opacity = '';
      wrapper.style.opacity = '0';
      launcher.click();
      const ancestorOpacityBlocked = !isOpen();
      wrapper.style.opacity = '';
      launcher.click();
      const visibleOpened = isOpen();
      document.querySelector(
        '[data-community-planning-preview] [data-planning-cancel]',
      )?.click();
      const cleanAfterClose = !isOpen();
      return {
        hiddenBlocked, collapsedBlocked, visibilityBlocked, inertBlocked,
        ariaHiddenBlocked, opacityStillLaysOut, hostOpacityBlocked,
        launcherOpacityBlocked, ancestorOpacityBlocked, visibleOpened, cleanAfterClose,
      };
    } finally {
      stop();
      wrapper.remove();
    }
  });
  assert.deepEqual(inaccessibleOwnerActivation, {
    hiddenBlocked: true,
    collapsedBlocked: true,
    visibilityBlocked: true,
    inertBlocked: true,
    ariaHiddenBlocked: true,
    opacityStillLaysOut: true,
    hostOpacityBlocked: true,
    launcherOpacityBlocked: true,
    ancestorOpacityBlocked: true,
    visibleOpened: true,
    cleanAfterClose: true,
  });
  // A connected Scene owner may be hidden/collapsed during a modal close.
  // Do not restore keyboard focus to a launcher outside the accessible view.
  const hiddenOwnerFocus = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const host = document.createElement('section');
    const inner = document.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    document.body.append(host);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    const originalFocus = launcher.focus.bind(launcher);
    let focusCalls = 0;
    launcher.focus = (...args) => {
      focusCalls++;
      originalFocus(...args);
    };
    const cancel = () => document.querySelector(
      '[data-community-planning-preview] [data-planning-cancel]',
    )?.click();
    try {
      launcher.click();
      host.hidden = true;
      cancel();
      const hiddenNotFocused = focusCalls === 0;
      host.hidden = false;
      launcher.click();
      cancel();
      const visibleFocused = focusCalls === 1 &&
        document.activeElement === launcher;
      launcher.click();
      host.classList.add('collapsed');
      cancel();
      const collapsedNotFocused = focusCalls === 1;
      host.classList.remove('collapsed');
      launcher.click();
      host.style.visibility = 'hidden';
      cancel();
      const invisibleNotFocused = focusCalls === 1;
      return {
        hiddenNotFocused,
        visibleFocused,
        collapsedNotFocused,
        invisibleNotFocused,
        cleanAfterClose: !document.querySelector(
          '[data-community-planning-preview]',
        ),
      };
    } finally {
      stop();
      host.remove();
    }
  });
  assert.deepEqual(hiddenOwnerFocus, {
    hiddenNotFocused: true,
    visibleFocused: true,
    collapsedNotFocused: true,
    invisibleNotFocused: true,
    cleanAfterClose: true,
  });
  // Fault-inject the actual modal close path. A close failure must not
  // strand a Scene preview, block reopening, or permit teardown resurrection.
  const closeFaultRecovery = await page.evaluate(async () => {
    const { mountCommunityPlanningPreview } = await import(
      '/src/ui/communityPlanningPreview.js'
    );
    const { createSyntheticCommunityPlanningFixture } = await import(
      '/src/standalone/communityPlanningFixture.js'
    );
    const host = document.createElement('section');
    const inner = document.createElement('div');
    inner.className = 'scene-panel-inner';
    host.append(inner);
    document.body.append(host);
    const stop = mountCommunityPlanningPreview({
      ...createSyntheticCommunityPlanningFixture(),
      panel: host,
    });
    const launcher = host.querySelector(
      '[data-community-planning-preview-open]',
    );
    try {
      launcher.click();
      const first = document.querySelector('[data-community-planning-preview]');
      // Inject only a synthetic browser exception; no network or real data.
      first.close = () => {
        throw new Error('synthetic Scene dialog close fault');
      };
      first.querySelector('[data-planning-cancel]').click();
      const faultCleared = !first.isConnected &&
        !document.querySelector('[data-community-planning-preview]');
      const focusRecovered = document.activeElement === launcher;
      launcher.click();
      const reopened = document.querySelector(
        '[data-community-planning-preview]',
      );
      const reopenedAfterFault = Boolean(reopened && reopened !== first);
      reopened?.querySelector('[data-planning-cancel]')?.click();
      const ordinaryCloseRecovered = !reopened?.isConnected &&
        document.activeElement === launcher;
      launcher.click();
      const duringTeardown = document.querySelector(
        '[data-community-planning-preview]',
      );
      stop();
      stop(); // idempotent host teardown
      const teardownCleared = !launcher.isConnected &&
        !duringTeardown?.isConnected;
      launcher.click(); // detached stale control must not remount the modal
      const staleLauncherBlocked = !document.querySelector(
        '[data-community-planning-preview]',
      );
      return {
        faultCleared,
        focusRecovered,
        reopenedAfterFault,
        ordinaryCloseRecovered,
        teardownCleared,
        staleLauncherBlocked,
      };
    } finally {
      stop();
      host.remove();
    }
  });
  assert.deepEqual(closeFaultRecovery, {
    faultCleared: true,
    focusRecovered: true,
    reopenedAfterFault: true,
    ordinaryCloseRecovered: true,
    teardownCleared: true,
    staleLauncherBlocked: true,
  });
  // Reduced-motion media negative control: a real Chromium media override must
  // change matchMedia before the fixture-only comparison is exercised.
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);
  assert.equal(
    await page.evaluate(() =>
      matchMedia('(prefers-reduced-motion: reduce)').matches),
    false,
    'reduced-motion negative control must start disabled',
  );
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  try {
    assert.equal(
      await page.evaluate(() =>
        matchMedia('(prefers-reduced-motion: reduce)').matches),
      true,
      'Chromium did not enable the requested reduced-motion preference',
    );
    if (
      await page.$eval('#scene-panel', (panel) =>
        panel.classList.contains('collapsed'))
    )
      await page.click('[data-collapse-target="scene-panel"]');
    await page.click('[data-community-planning-preview-open]');
    await page.waitForSelector('[data-community-planning-preview]', {
      visible: true,
    });
    assert.equal(
      await page.$eval('[data-community-planning-preview]', (dialog) =>
        document.activeElement === dialog.querySelector('h2[tabindex="-1"]')),
      true,
      'reduced-motion modal must still focus its hypothetical heading',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await page.$eval('[data-community-planning-preview]', (dialog) =>
        document.activeElement === dialog.querySelector('[data-planning-cancel]')),
      true,
      'reduced-motion heading must still lead to native controls',
    );
    await page.click('[data-planning-mode="game"]');
    assert.deepEqual(
      await page.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items
            .filter((item) => !item.hidden)
            .map((item) => item.dataset.alternativeId),
      ),
      ['play-first'],
    );
    await page.$eval('[data-planning-focus-id="trees-first"]', (button) =>
      button.focus());
    await page.keyboard.press('Enter');
    assert.deepEqual(
      await page.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items
            .filter((item) => !item.hidden)
            .map((item) => item.dataset.alternativeId),
      ),
      ['trees-first'],
    );
    await page.click('[data-planning-mode="co-op"]');
    assert.deepEqual(
      await page.$$eval(
        '[data-community-planning-preview] [data-alternative-id]',
        (items) =>
          items
            .filter((item) => !item.hidden)
            .map((item) => item.dataset.alternativeId),
      ),
      ['play-first', 'trees-first'],
    );
    // Animation observer negative control: inject then cancel one test-only
    // animation to prove the probe can detect motion without asserting that
    // the overall Cesium globe (outside this preview) is animation-free.
    const animationProbe = await page.$eval(
      '[data-planning-alternatives]',
      (cards) => {
        const count = () =>
          cards.getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length;
        const current = count();
        const testOnly = cards.animate(
          [{ opacity: 1 }, { opacity: 0.5 }],
          { duration: 5000 },
        );
        const detected = count();
        testOnly.cancel();
        return { current, detected };
      },
    );
    assert.equal(
      animationProbe.current, 0,
      'reduced-motion proposal cards must not run an animation',
    );
    assert.ok(
      animationProbe.detected > 0,
      'animation probe negative control failed to detect inserted animation',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.$('[data-community-planning-preview]'), null);
    assert.equal(
      await page.$eval('[data-community-planning-preview-open]', (button) =>
        document.activeElement === button),
      true,
      'reduced-motion Escape must return focus to the surviving launcher',
    );
    assert.deepEqual(
      moduleRequests.baselineRequests(),
      [],
      'reduced-motion mode changes must not fetch source credits',
    );
  } finally {
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
  }

  // A successful DOM walkthrough cannot mask an earlier unhandled runtime error.
  desktopFailures.assertClean();
  await assertDesktopRequestsSafe();
  // Fail closed if the checkout changed while the browser gate was running.
  assertCurrentCheckout();
  console.log('Community planning preview: synthetic proposals, inert source credits, attribution, missing-clock fail-closed, keyboard, mobile, reduced-motion, teardown PASS');
} finally {
  desktopFailures?.dispose();
  moduleRequests?.dispose();
  await browser.close();
}
