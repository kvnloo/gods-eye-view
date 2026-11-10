import { searchHls } from './catalog.js';
import { gibsTemplate, nonCrossingBoxes, wvsSnapshotUrl } from './model.js';

const DATELINE_PROBE_TIMEOUT_MS = 10_000;

/**
 * Worldview Snapshots rejects a BBOX with west > east, so a dateline box is
 * probed as its two non-crossing halves, wider first. Granules do not cross
 * +/-180, so a day has data when either half does.
 */
function requestBoxes(box) {
  if (!(box?.west > box?.east)) return [box];
  const halves = nonCrossingBoxes(box);
  if (!halves.length) return [box];
  return [...halves].sort((a, b) => b.east - b.west - (a.east - a.west));
}

const isPresent = (response) => dataPresent(response) === 'true';

const dataPresent = (response) =>
  response?.ok
    ? String(response.headers?.get?.('Data-Present') ?? '').toLowerCase()
    : '';

/**
 * One answer for a crossing box: the first half that has data (the wider side
 * wins a tie, so the thumbnail shows it); both confirmed empty is empty; any
 * other mix (a failed or unreadable half) is returned as that half's response
 * so the day is never called empty on partial evidence.
 */
function combineHalves(responses) {
  const present = responses.find(isPresent);
  if (present) return present;
  const unproven = responses.find((r) => dataPresent(r) !== 'false');
  return unproven ?? responses[0];
}

/**
 * NASA-compatible imagery acquisition; transport and URL builders are replaceable.
 * Thumbnail responses must expose Data-Present: true for image admission, or
 * false for confirmed empty coverage, including injected getThumbnail sources.
 */
export function createRecentImagerySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  search = searchHls,
  thumbnailUrl = wvsSnapshotUrl,
  tileTemplate = gibsTemplate,
  credit = 'NASA GIBS',
  setTimeoutImpl = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutImpl = (id) => globalThis.clearTimeout(id),
} = {}) {
  return {
    credit,
    searchHls: (query) => search({ ...query, fetchImpl }),
    async getThumbnail(candidate, box, { size = 256, signal } = {}) {
      signal?.throwIfAborted();
      const boxes = requestBoxes(box);
      const urlFor = (half) =>
        thumbnailUrl({
          product: candidate.product,
          day: candidate.day,
          box: half,
          width: size,
          height: size,
        });
      if (boxes.length === 1) {
        const response = await fetchImpl(urlFor(boxes[0]), { signal });
        signal?.throwIfAborted();
        return response;
      }

      // A slow or non-responsive half must not occupy a loader slot forever.
      // Each probe retains the parent caller's cancellation independently.
      const probe = async (half) => {
        const controller = new AbortController();
        let timer;
        let onAbort;
        const cancelled = signal
          ? new Promise((_, reject) => {
              onAbort = () => {
                controller.abort();
                reject(
                  signal.reason ??
                    new DOMException('Thumbnail cancelled', 'AbortError'),
                );
              };
              signal.addEventListener('abort', onAbort, { once: true });
            })
          : null;
        try {
          const deadline = new Promise((_, reject) => {
            timer = setTimeoutImpl(() => {
              controller.abort();
              reject(new Error('Worldview dateline probe timed out'));
            }, DATELINE_PROBE_TIMEOUT_MS);
          });
          return await Promise.race([
            fetchImpl(urlFor(half), { signal: controller.signal }),
            deadline,
            ...(cancelled ? [cancelled] : []),
          ]);
        } finally {
          clearTimeoutImpl(timer);
          signal?.removeEventListener('abort', onAbort);
        }
      };

      const settled = await Promise.allSettled(boxes.map(probe));
      signal?.throwIfAborted();
      const responses = settled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      // A rejected half is an error unless another half proves data present.
      if (responses.length < settled.length && !responses.some(isPresent))
        throw settled.find((result) => result.status === 'rejected').reason;
      const response =
        responses.length > 1 ? combineHalves(responses) : responses[0];
      // A day may be present in only one half. Unknown or failed halves may
      // not drape opaque VIIRS JPEG tiles until they are confirmed present.
      response.presentBoxes = boxes.filter(
        (_half, index) =>
          settled[index].status === 'fulfilled' &&
          isPresent(settled[index].value),
      );
      return response;
    },
    getTileTemplate: (product, day) => tileTemplate(product, day),
  };
}
