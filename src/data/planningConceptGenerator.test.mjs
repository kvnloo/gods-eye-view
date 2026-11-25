import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createPlanningConceptGenerator } from './planningConceptGenerator.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
const TIME = '2026-11-10T12:00:00.000Z';
const LABEL = 'AI concept, not a plan or an approval';
const input = () => ({
  description: 'Add shade, a play area, and accessible paths.',
  parameters: {
    trees: 12,
    budget: 25000,
    accessible: true,
    materials: ['wood', 'gravel'],
  },
  sourceView: {
    camera: {
      longitude: -88.15,
      latitude: 40.05,
      height: 500,
      heading: 20,
      pitch: -45,
    },
    bounds: [-88.2, 40, -88.1, 40.1],
    sources: [{ id: 'fixture-map', attribution: 'Synthetic reference' }],
    capturedAt: TIME,
    image: PNG,
  },
});

function local(fetch) {
  return createPlanningConceptGenerator({
    provider: 'local',
    fetch,
    now: () => TIME,
  });
}

function reply(payload, options) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
}

test('fixture is deterministic, offline, labeled honestly, and embeds a landscape PNG diagram', async () => {
  let calls = 0;
  const generator = createPlanningConceptGenerator({
    fetch: () => {
      calls++;
    },
    now: () => TIME,
  });
  assert.equal(generator.provider, 'fixture');
  assert.equal(calls, 0);
  const first = await generator.generate(input());
  assert.deepEqual(await generator.generate(input()), first);
  assert.equal(calls, 0);
  assert.deepEqual(
    Object.keys(first).sort(),
    [
      'prompt',
      'provider',
      'generatedAt',
      'sourceView',
      'image',
      'label',
    ].sort(),
  );
  assert.equal(first.provider, 'fixture');
  assert.equal(first.label, LABEL);
  assert.equal(first.generatedAt, TIME);
  assert.deepEqual(first.sourceView, input().sourceView);
  const bytes = Buffer.from(first.image.split(',')[1], 'base64');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.readUInt32BE(16) >= 160);
  assert.ok(bytes.readUInt32BE(16) > bytes.readUInt32BE(20));
  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.ok(
    new Set(inflateSync(Buffer.concat(idat))).size > 8,
    'diagram is not a blank pixel',
  );
});

test('prompt records the complete description, all parameters and reference context without claiming approval', async () => {
  const request = input();
  const concept = await createPlanningConceptGenerator().generate(request);
  assert.ok(concept.prompt.includes(request.description));
  assert.ok(concept.prompt.includes(JSON.stringify(request.parameters)));
  for (const key of ['camera', 'bounds', 'sources', 'capturedAt']) {
    assert.ok(concept.prompt.includes(JSON.stringify(request.sourceView[key])));
  }
  assert.ok(concept.prompt.includes(LABEL));
  assert.ok(!concept.prompt.includes(PNG));
});

test('local generation is explicit, same-origin, bounded, and sends only prompt and reference image', async () => {
  const calls = [];
  const controller = new AbortController();
  const generator = local(async (...args) => {
    calls.push(args);
    return reply({ provider: 'local', image: PNG });
  });
  assert.equal(calls.length, 0);
  const original = input();
  const pending = generator.generate(original, { signal: controller.signal });
  original.sourceView.camera.height = 999;
  const concept = await pending;
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, '/api/city-concept');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.signal, controller.signal);
  assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), [
    'image',
    'prompt',
  ]);
  assert.equal(JSON.parse(options.body).image, PNG);
  assert.ok(Buffer.byteLength(options.body) <= 1024 * 1024);
  assert.equal(concept.sourceView.camera.height, 500);
  assert.equal(generator.provider, 'local');
  assert.equal(concept.provider, 'chatgpt-subscription/comfyui-codex-image');
  assert.equal(concept.image, PNG);
  assert.equal(concept.label, LABEL);
});

test('abort rejects fixture and local calls before any work or fetch', async () => {
  for (const provider of ['fixture', 'local']) {
    const controller = new AbortController();
    controller.abort();
    const generator = createPlanningConceptGenerator({
      provider,
      fetch: () => assert.fail('must not fetch'),
    });
    await assert.rejects(
      generator.generate(input(), { signal: controller.signal }),
      { name: 'AbortError' },
    );
  }
});

test('in-flight local abort is propagated without retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const generator = local((_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const pending = generator.generate(input(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('abort while reading a local response cancels the stream', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const generator = local(
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"provider":"local",'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const pending = generator.generate(input(), { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('unknown providers and invalid or oversized inputs never fetch', async () => {
  assert.throws(
    () => createPlanningConceptGenerator({ provider: 'remote' }),
    /provider/i,
  );
  const generator = local(() => assert.fail('invalid input must not fetch'));
  const cases = [
    { ...input(), description: '' },
    { ...input(), description: 'x'.repeat(33000) },
    { ...input(), parameters: { bad: Infinity } },
    { ...input(), parameters: { giant: 'x'.repeat(40000) } },
    ...[
      { camera: null },
      { bounds: [1, 2, 0, 1] },
      { sources: null },
      { capturedAt: 'yesterday' },
      { image: 'https://example.org/ref.png' },
      { image: 'data:image/svg+xml;base64,PHN2Zy8+' },
      {
        image: `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`,
      },
      { image: `${PNG}${'A'.repeat(1024 * 1024)}` },
    ].map((patch) => ({
      ...input(),
      sourceView: { ...input().sourceView, ...patch },
    })),
  ];
  for (const value of cases)
    await assert.rejects(generator.generate(value), /invalid|limit|bounded/i);
});

test('local response rejects provider spoofing, URLs, SVG, extra fields, and oversized or malformed JSON', async () => {
  const bad = [
    {},
    { image: PNG },
    { provider: 'fixture', image: PNG },
    { provider: 'codex', image: PNG },
    { provider: 'chatgpt-subscription/comfyui-codex-image', image: PNG },
    { provider: 'local', image: 'https://example.org/result.jpg' },
    { provider: 'local', image: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { provider: 'local', image: 'data:image/png;base64,PHN2Zy8+' },
    { provider: 'local', image: PNG, prompt: 'server replacement' },
    { provider: 'local', image: `${PNG}${'A'.repeat(600000)}` },
  ];
  for (const value of bad)
    await assert.rejects(local(async () => reply(value)).generate(input()));
  for (const response of [
    new Response('not JSON'),
    reply({ provider: 'local', image: PNG }, { status: 503 }),
    new Response('x'.repeat(601025), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'content-length': '9999999',
      },
    }),
  ]) {
    await assert.rejects(local(async () => response).generate(input()));
  }
});
