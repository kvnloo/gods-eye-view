import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchAllTectonicPlateGeoJson,
  normalizeBoundaryType,
  normalizeTectonicPlateSnapshot,
} from './tectonicPlates.js';
import { createUsgsTectonicPlateSource } from '../layers/tectonicPlates/source.js';


test('normalizes known tectonic boundary labels', () => {
  assert.equal(normalizeBoundaryType('Convergent Boundary'), 'convergent');
  assert.equal(normalizeBoundaryType('Divergent Boundary'), 'divergent');
  assert.equal(normalizeBoundaryType('Transform Boundary'), 'transform');
});

test('unknown tectonic boundary label falls back to other', () => {
  assert.equal(normalizeBoundaryType('Something New'), 'other');
  assert.equal(normalizeBoundaryType(null), 'other');
});

test('normalizes a valid USGS LineString feature', () => {
  const result = normalizeTectonicPlateSnapshot({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [66.5439987180665, 86.6549987795701],
            [66.3010025028633, 86.6060028079833],
          ],
        },
        properties: {
          OBJECTID: 1,
          NAME: 'Eurasian:North American',
          LABEL: 'Transform Boundary',
        },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      id: '1',
      name: 'Eurasian:North American',
      boundaryType: 'transform',
      sourceLabel: 'Transform Boundary',
      coordinates: [
        [66.5439987180665, 86.6549987795701],
        [66.3010025028633, 86.6060028079833],
      ],
    },
  ]);
});

test('rejects invalid coordinates', () => {
  const result = normalizeTectonicPlateSnapshot({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [200, 95],
            [10, 20],
          ],
        },
        properties: {
          OBJECTID: 1,
          NAME: 'Broken',
          LABEL: 'Transform Boundary',
        },
      },
    ],
  });

  assert.equal(result, null);
});

test('rejects duplicate ids', () => {
  const result = normalizeTectonicPlateSnapshot({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [10, 20],
            [11, 21],
          ],
        },
        properties: {
          OBJECTID: 1,
          NAME: 'A',
          LABEL: 'Transform Boundary',
        },
      },
      {
        type: 'Feature',
        id: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [12, 22],
            [13, 23],
          ],
        },
        properties: {
          OBJECTID: 1,
          NAME: 'B',
          LABEL: 'Divergent Boundary',
        },
      },
    ],
  });

  assert.equal(result, null);
});
test('fetches tectonic boundaries across multiple pages', async () => {
  const calls = [];

  const fakeFetch = async (url) => {
    calls.push(String(url));

    const offset = Number(new URL(url).searchParams.get('resultOffset'));

    const count = offset === 0 ? 1000 : 175;

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          type: 'FeatureCollection',
          features: Array.from({ length: count }, (_, index) => ({
            type: 'Feature',
            id: offset + index + 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [10, 20],
                [11, 21],
              ],
            },
            properties: {
              OBJECTID: offset + index + 1,
              NAME: 'A:B',
              LABEL: 'Transform Boundary',
            },
          })),
        };
      },
    };
  };

  const result = await fetchAllTectonicPlateGeoJson(fakeFetch);

  assert.equal(calls.length, 2);
  assert.equal(result.features.length, 1175);
});

test('aborting a tectonic-plate request cancels its active USGS fetch', async () => {
  const controller = new AbortController();
  let startedFetch;
  const started = new Promise((resolve) => {
    startedFetch = resolve;
  });
  let finishWithoutAbort;
  let networkAborted = false;

  const source = createUsgsTectonicPlateSource({
    fetchImpl: (_url, { signal } = {}) =>
      new Promise((resolve, reject) => {
        finishWithoutAbort = () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ type: 'FeatureCollection', features: [] }),
          });
        signal?.addEventListener(
          'abort',
          () => {
            networkAborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
        startedFetch();
      }),
  });

  const pending = source.getSnapshot({ signal: controller.signal });
  await started;
  controller.abort();
  finishWithoutAbort();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(networkAborted, true, 'the active HTTP fetch must be aborted');
});

test('aborting tectonic-plate pagination prevents a second USGS request', async () => {
  const controller = new AbortController();
  let calls = 0;
  let receivedSignal;
  const source = createUsgsTectonicPlateSource({
    fetchImpl: async (_url, { signal } = {}) => {
      calls += 1;
      if (calls > 1) {
        throw new Error('unexpected USGS page after cancellation');
      }
      receivedSignal = signal;
      controller.abort();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'FeatureCollection',
          features: Array.from({ length: 1000 }, () => ({})),
        }),
      };
    },
  });

  await assert.rejects(source.getSnapshot({ signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls, 1, 'pagination must stop as soon as aborted');
  assert.equal(receivedSignal, controller.signal);
});
