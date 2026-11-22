const LABEL = 'AI concept, not a plan or an approval';
const REQUEST_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 600000;
const RESPONSE_LIMIT = IMAGE_LIMIT + 1024;
const encoder = new TextEncoder();
const FIXTURE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAAD/ElEQVR42u3dPWobQRgG4LlaDpDaZ3CTOhDsK+QCapIydQgEF6mcWpDOVdpAIFeIKiOklbS787szD7ylGT598+yAVjPj8Offi0Tm3fsPk/m1/zqZS3+vk/EJWgA00AI00EADDTTQAjTQQAvQQAvQQAMNNNBAC9BAAy1Adwr66cvH7WbyEz3vd5GpBTpT5f1NMdBAAw000EC3D/rN49vtgr5ZPNCjgD5QOM9WQM8vHuj+Qb8KuN/dzZTRDuilxQPdOehXDcdZx6I86BXFA90/6BMQkyyaBb20eKAnPu3f388nafZvrrOYXOFWr3OFQa8rfj7orcwy0C83V7h161x50CuKB9oKbYUGegugj98PzDFxk0VJ0KuLB7r/FXrOi4JmV+ilxQM9BOjrr3IbB72oeKB7fm13RcDmQM8s3mu7IX5YWaS5tR9W4h9FoIEGGujm93LM1NzmXo6YRxFou+3stgPafmj7oYF2YsWJFaCBBhpooIEGGmiggQYaaKCBBhpooIH2HhpovxT6pRBo93K4lwNo93K4lwNo93IAPdSJFae+ge4HtHs5gLZCW6GBbg+0ezmA7vbUt3s5gO7wGgP3cgwBur+4l8P/KewTtGsMgAYaaKAbBu1eDqB7A2233Vig9z8+bzf2Q8+pvL8pBnroEytAAw000EADDTTQQAMNNNBAAw000EADDTTQQAMNNNBAAz3uXo6RQducBDTQQA+Q3KAFaKCBFqCBFqCBBhpooIEWoIEGWoAGGmiggQYaaKCBlqugLzVX4rMUtMQHaKCBFqCBBhpooIEWoIEeGfSlpotsMUAL0CJAi5QA7WuEL4XecgjQQAMNNNBAC9BAAy1AAy1ANwfaGQcnVhzBEqCBBhpooIGWyqAP/0g9R6GZhgW6SufzzWZIWOJ5mh0W6CqdLzCbIeEnv9/dJaw407BAV+l8sdkMST78ocrjxJebaVigq3S+5GwmAH1S6GS5jQwLdJXOl5zNkPxpjn/+Mg0LdJXOF57NkONpjnz+Mg0LdJXOF55NKzTQVuiz761zap1ZbqZhga7S+fKzGXK0ILLQTMMCXaXzhWczJHxPfqnK1aDTDgt0lc4Xns2Q/Ief5KBTDQt0lc4Xns1QpgWNDAt0lc6XnE2ggQZ6YblNDQt0lc4Xm0277YC2285+aPuhu98P7cSKEytNnFh5/PZTIvP900OS6GR8gAYaaAEaaKCBBhpoARpooAVooAVooIEGGmigBWiggRaggRaggQYaaKCBFqCBBlqABhpooIEGGmiggRaggQZagAYaaKCBBhpooIEWoIEGWoAGGmiggQZaM4EGWoAWoEWAFgFaBGgRoAVoEaBFgBYBWoDWBQFapMn8BzsLjRND4B5cAAAAAElFTkSuQmCC';

function invalid() {
  return new TypeError('Invalid or unbounded planning concept data');
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonCopy(value, limit) {
  const text = JSON.stringify(value, (_key, item) => {
    if (
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      (typeof item === 'number' && !Number.isFinite(item))
    )
      throw invalid();
    return item;
  });
  if (!text || encoder.encode(text).length > limit) throw invalid();
  return JSON.parse(text);
}

function raster(value, limit) {
  if (typeof value !== 'string' || value.length > limit) throw invalid();
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match || match[2].length % 4 !== 0) throw invalid();
  let bytes;
  try {
    bytes = atob(match[2]);
  } catch {
    throw invalid();
  }
  if (btoa(bytes) !== match[2]) throw invalid();
  const valid =
    match[1] === 'png'
      ? bytes.length >= 45 &&
        bytes.startsWith('\x89PNG\r\n\x1a\n') &&
        bytes.slice(12, 16) === 'IHDR' &&
        bytes.endsWith('\x00\x00\x00\x00IEND\xaeB`\x82')
      : bytes.length >= 4 &&
        bytes.startsWith('\xff\xd8\xff') &&
        bytes.endsWith('\xff\xd9');
  if (!valid) throw invalid();
  return value;
}

function prepare({ description, parameters, sourceView } = {}) {
  if (
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 8000 ||
    !record(parameters) ||
    !record(sourceView) ||
    !record(sourceView.camera) ||
    !Array.isArray(sourceView.sources) ||
    sourceView.sources.length > 30 ||
    typeof sourceView.capturedAt !== 'string' ||
    sourceView.capturedAt.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T/.test(sourceView.capturedAt) ||
    !Number.isFinite(Date.parse(sourceView.capturedAt))
  )
    throw invalid();
  const bounds = sourceView.bounds;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -90 ||
    bounds[3] > 90 ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    throw invalid();
  const reference = jsonCopy(
    {
      camera: sourceView.camera,
      bounds,
      sources: sourceView.sources,
      capturedAt: sourceView.capturedAt,
    },
    32768,
  );
  reference.image = raster(sourceView.image, REQUEST_LIMIT);
  const params = jsonCopy(parameters, 16000);
  const { image, ...context } = reference;
  const prompt = [
    'Create a landscape urban-design pretotype from the attached reference image.',
    'Preserve the reference camera and site bounds. Show an illustrative possibility only.',
    LABEL,
    'Do not imply surveyed geometry, predicted effects, feasibility, ownership, or official approval.',
    `Description: ${description}`,
    `Parameters: ${JSON.stringify(params)}`,
    `Reference context: ${JSON.stringify(context)}`,
  ].join('\n');
  if (encoder.encode(prompt).length > 32768) throw invalid();
  const body = JSON.stringify({ prompt, image });
  if (encoder.encode(body).length > REQUEST_LIMIT) throw invalid();
  return { prompt, sourceView: reference, body };
}

async function readResponse(response, signal) {
  if (
    !response.ok ||
    response.redirected ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    Number(response.headers.get('content-length')) > RESPONSE_LIMIT ||
    !response.body
  )
    throw new Error('Local concept generation failed');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) throw invalid();
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const payload = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  if (
    !record(payload) ||
    Object.keys(payload).length !== 2 ||
    payload.provider !== 'local'
  )
    throw invalid();
  return raster(payload.image, IMAGE_LIMIT);
}

export function createPlanningConceptGenerator({
  provider = 'fixture',
  fetch = globalThis.fetch,
  now = () => new Date().toISOString(),
} = {}) {
  if (provider !== 'fixture' && provider !== 'local')
    throw new TypeError('Unsupported planning concept provider');
  return {
    provider,
    async generate(input, { signal } = {}) {
      signal?.throwIfAborted();
      const prepared = prepare(input);
      let image = FIXTURE_IMAGE;
      if (provider === 'local') {
        const response = await fetch('/api/city-concept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          body: prepared.body,
          signal,
        });
        image = await readResponse(response, signal);
      }
      signal?.throwIfAborted();
      return {
        prompt: prepared.prompt,
        provider:
          provider === 'local'
            ? 'chatgpt-subscription/comfyui-codex-image'
            : 'fixture',
        generatedAt: now(),
        sourceView: prepared.sourceView,
        image,
        label: LABEL,
      };
    },
  };
}
