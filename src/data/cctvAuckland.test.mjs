import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aucklandCameraName,
  aucklandCameraToSource,
  loadAucklandSourcesFromOpenData,
} from '../../server/providers/cctv/sources.js';
import {
  AUCKLAND_CAMERAS_URL,
  AUCKLAND_GROUND_ELEVATION_M,
  AUCKLAND_IMAGE_ORIGIN,
  AUCKLAND_IMAGE_URL,
  AUCKLAND_MAX_CATALOG_BYTES,
  CCTV_SHARED_SOURCE_SLOTS,
  DEFAULT_AUCKLAND_MAX_SOURCES,
} from '../../server/providers/cctv/constants.js';
import {
  CAMERA_CODE_MAX_CHARS,
  isLikelyAucklandCoordinate,
} from '../../server/providers/cctv/normalize.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';
import { directionToHeading } from './directionText.js';

/**
 * A response whose body is a live stream, plus a flag that flips when the
 * stream is cancelled. A rejection path that returns without cancelling holds
 * the transport open, so the flag is what the refusal tests actually assert.
 */
const streamingResponse = (init = {}) => {
  const state = { cancelled: false };
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, init), state };
};

const CARRINGTON_ID = 654;
const CONSTELLATION_ID = 821;

/** One camera in NZTA's documented Traffic and Travel REST API format. */
const apiCamera = (overrides = {}, props = {}) => {
  const coords = overrides.geometry?.coordinates;
  return {
    id: props.ExternalId ?? CARRINGTON_ID,
    name: props.Name ?? 'SH16 Carrington Rd Overbridge',
    description: props.Description ?? 'East along Northwestern Motorway',
    offline: props.Offline ?? false,
    underMaintenance: props.UnderMaintenance ?? false,
    imageUrl:
      props.ImageUrl ??
      `https://www.trafficnz.info/camera/${CARRINGTON_ID}.jpg`,
    latitude: props.Latitude ?? coords?.[1] ?? '-36.87173',
    longitude: props.Longitude ?? coords?.[0] ?? '174.71018',
    direction: props.Direction ?? 'Eastbound',
    region: { id: props.RegionID ?? 2 },
  };
};

const apiPayload = (cameras) => ({ response: { camera: cameras } });

test('an Auckland API camera maps to a source on the pinned HTTPS frame host', () => {
  const source = aucklandCameraToSource(apiCamera());
  assert.equal(source.id, `auckland-${CARRINGTON_ID}`);
  assert.equal(source.name, 'SH16 Carrington Rd Overbridge');
  assert.equal(source.city, 'Auckland');
  assert.equal(source.cityId, 'auckland');
  assert.equal(source.provider, 'Waka Kotahi NZ Transport Agency');
  assert.equal(source.lat, -36.87173);
  assert.equal(source.lon, 174.71018);
  assert.equal(source.feedType, 'image');
  assert.equal(source.sourceKind, 'auckland-nzta');
  assert.equal(source.license, 'NZTA Traffic and Travel API (operator terms apply)');
  assert.equal(source.groundElevationM, AUCKLAND_GROUND_ELEVATION_M);
  assert.equal(source.url, AUCKLAND_IMAGE_URL(CARRINGTON_ID));
  assert.equal(source.url, source.snapshotUrl);
  assert.ok(source.url.startsWith(AUCKLAND_IMAGE_ORIGIN));
  assert.equal(source.headingConfidence, 'high');
  assert.equal(source.headingDeg, 90);
});

test('frame URLs are synthesized from API id; imageUrl cannot steer the proxy', () => {
  const source = aucklandCameraToSource(
    apiCamera(
      {},
      {
        ImageUrl: 'https://evil.example/cameras/x/image',
        ExternalId: CARRINGTON_ID,
      },
    ),
  );
  assert.equal(source.url, AUCKLAND_IMAGE_URL(CARRINGTON_ID));
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.id, `auckland-${CARRINGTON_ID}`);
});

test('API booleans, region, bounding box and invalid ids are rejected', () => {
  assert.equal(aucklandCameraToSource(apiCamera({}, { Offline: 1 })), null);
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { UnderMaintenance: 1 })),
    null,
  );
  assert.equal(aucklandCameraToSource(apiCamera({}, { RegionID: 21 })), null);
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { ExternalId: '../etc/passwd' })),
    null,
  );
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { ExternalId: '0706' })),
    null,
  );
  // Wellington: a plausible lat/lon, and Region 16, but not Auckland.
  assert.equal(
    aucklandCameraToSource(
      apiCamera(
        { geometry: { type: 'Point', coordinates: [174.7762, -41.2865] } },
        { RegionID: 16, Latitude: '-41.2865', Longitude: '174.7762' },
      ),
    ),
    null,
  );
  assert.equal(
    aucklandCameraToSource(
      apiCamera({ geometry: null }, { Latitude: '0', Longitude: '0' }),
    ),
    null,
  );
  assert.equal(
    aucklandCameraToSource(
      apiCamera(
        { geometry: { type: 'Point', coordinates: [175.4, -36.7] } },
        { RegionID: 2 },
      ),
    ),
    null,
    'same-region cameras outside the metro bounds are excluded',
  );
  assert.equal(aucklandCameraToSource(null), null);
  // 2-digit and 3-digit ExternalIds stay.
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { ExternalId: 10 })).id,
    'auckland-10',
  );
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { ExternalId: CONSTELLATION_ID })).id,
    `auckland-${CONSTELLATION_ID}`,
  );
});

test('travel-direction fields are high-confidence; blank uses the id-hash fallback', () => {
  assert.equal(directionToHeading('Southbound'), 180);
  assert.equal(directionToHeading('Eastbound'), 90);
  assert.equal(directionToHeading('South'), NaN);

  const south = aucklandCameraToSource(
    apiCamera({}, { Direction: 'Southbound' }),
  );
  assert.equal(south.headingConfidence, 'high');
  assert.equal(south.headingDeg, 180);

  const blank = aucklandCameraToSource(apiCamera({}, { Direction: '' }));
  assert.equal(blank.headingConfidence, 'low');
  assert.ok(Number.isFinite(blank.headingDeg));
  assert.equal(
    blank.headingDeg,
    aucklandCameraToSource(apiCamera({}, { Direction: 'None' })).headingDeg,
  );
});

test('a nameless row still gets a label', () => {
  assert.equal(
    aucklandCameraName(
      { name: '  SH1 Harbour Bridge  ', description: 'ignored' },
      'auckland-40',
    ),
    'SH1 Harbour Bridge',
  );
  assert.equal(
    aucklandCameraName({ description: 'Looking south' }, 'auckland-40'),
    'Looking south',
  );
  assert.equal(aucklandCameraName({}, 'auckland-40'), 'Auckland Camera 40');
  assert.equal(aucklandCameraName({}, ''), 'Auckland Camera');
});

test('the unselected label is the site name, trimmed to the code width', () => {
  assert.equal(
    aucklandCameraToSource(apiCamera({}, { Name: 'SH1 Onewa Rd' })).code,
    'SH1 ONEWA RD',
  );
  const long = aucklandCameraToSource(
    apiCamera(
      {},
      {
        Name: 'SH1 a very long interchange name that must truncate for the unselected camera code',
      },
    ),
  );
  assert.equal(long.code.length, CAMERA_CODE_MAX_CHARS);
  assert.ok(long.code.endsWith('…'));
});

test('the official API payload loads and collapses duplicate camera ids', async (t) => {
  t.mock.method(console, 'log', () => {});
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requested.push([String(url), init.headers.Accept, init.redirect]);
    return Response.json(
      apiPayload([
        apiCamera(),
        apiCamera({}, { Name: 'SH16 Carrington Rd Overbridge (duplicate)' }),
        apiCamera(
          {
            geometry: { type: 'Point', coordinates: [174.726254, -36.750564] },
          },
          {
            ExternalId: CONSTELLATION_ID,
            Name: 'SH1 Constellation Dr',
            Latitude: '-36.750564',
            Longitude: '174.726254',
            Direction: 'Southbound',
            ImageUrl: 'https://evil.example/x.jpg',
            id: 1548,
          },
        ),
        apiCamera({}, { Offline: 1, ExternalId: 706 }),
      ]),
    );
  });
  const cameras = await loadAucklandSourcesFromOpenData();
  assert.deepEqual(requested, [
    [AUCKLAND_CAMERAS_URL, 'application/json', 'manual'],
  ]);
  assert.deepEqual(
    new Set(cameras.map((camera) => camera.id)),
    new Set([`auckland-${CARRINGTON_ID}`, `auckland-${CONSTELLATION_ID}`]),
  );
  assert.equal(
    cameras.find((camera) => camera.id === `auckland-${CARRINGTON_ID}`).name,
    'SH16 Carrington Rd Overbridge',
  );
});

test('the forbidden Journeys GeoJSON asset is not accepted as an API payload', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [174.71018, -36.87173] },
          properties: {
            ExternalId: CARRINGTON_ID,
            Name: 'SH16 Carrington Rd Overbridge',
            RegionID: 7,
            Offline: 0,
            UnderMaintenance: 0,
          },
        },
      ],
    }),
  );
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);
});

test('an upstream failure yields an empty pack and releases the response', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const failed = streamingResponse({ status: 503 });
  t.mock.method(globalThis, 'fetch', async () => failed.response);
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);
  assert.equal(failed.state.cancelled, true, 'the failed body is cancelled');

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down');
  });
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);
});

test('the catalog fetch refuses redirects and oversized bodies', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const seen = [];
  const redirected = streamingResponse({
    status: 302,
    headers: { location: 'https://evil.example/cameras.json' },
  });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen.push([String(url), init.redirect]);
    return redirected.response;
  });
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);
  assert.deepEqual(seen, [[AUCKLAND_CAMERAS_URL, 'manual']]);
  assert.equal(
    redirected.state.cancelled,
    true,
    'the redirect body is cancelled',
  );

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    const body = JSON.stringify(apiPayload([apiCamera()]));
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'content-length': String(AUCKLAND_MAX_CATALOG_BYTES + 1),
      },
    });
  });
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    const oversized = 'x'.repeat(AUCKLAND_MAX_CATALOG_BYTES + 1024);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversized));
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
  assert.deepEqual(await loadAucklandSourcesFromOpenData(), []);
});

test('a reduced pack cap keeps cameras nearest the metro anchors', async (t) => {
  t.mock.method(console, 'log', () => {});
  const saved = process.env.CCTV_AUCKLAND_MAX_SOURCES;
  t.after(() => {
    if (saved === undefined) delete process.env.CCTV_AUCKLAND_MAX_SOURCES;
    else process.env.CCTV_AUCKLAND_MAX_SOURCES = saved;
  });
  process.env.CCTV_AUCKLAND_MAX_SOURCES = '8';
  const rows = [
    ...[-36.52, -36.522, -36.524, -36.526, -36.528, -36.53].map((lat, i) =>
      apiCamera(
        { geometry: { type: 'Point', coordinates: [174.671, lat] } },
        {
          ExternalId: 800 + i,
          Name: `Puhoi ${i}`,
          Latitude: String(lat),
          Longitude: '174.671',
          Direction: 'Southbound',
        },
      ),
    ),
    ...[-36.8485, -36.849, -36.8495, -36.85, -36.8505, -36.851].map((lat, i) =>
      apiCamera(
        { geometry: { type: 'Point', coordinates: [174.7633, lat] } },
        {
          ExternalId: 60 + i,
          Name: `Downtown ${i}`,
          Latitude: String(lat),
          Longitude: '174.7633',
          Direction: 'Northbound',
        },
      ),
    ),
  ];
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(apiPayload(rows)),
  );
  const cameras = await loadAucklandSourcesFromOpenData();
  assert.equal(cameras.length, 8);
  assert.deepEqual(
    cameras.map((camera) => camera.name.slice(0, 8)),
    [
      'Downtown',
      'Downtown',
      'Downtown',
      'Downtown',
      'Downtown',
      'Downtown',
      'Puhoi 5',
      'Puhoi 4',
    ],
    'downtown fills first; the North Shore anchor still keeps a share',
  );
});

/**
 * Serve the Auckland catalog to the Auckland endpoint and an empty payload to
 * every other pack, so one catalog refresh exercises the registration without
 * reaching the network.
 */
const runCatalogWithMockedUpstreams = async (t) => {
  const requested = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    requested.push(href);
    if (href === AUCKLAND_CAMERAS_URL) {
      return Response.json(
        apiPayload([
          apiCamera(),
          apiCamera(
            {
              geometry: {
                type: 'Point',
                coordinates: [174.726254, -36.750564],
              },
            },
            {
              ExternalId: CONSTELLATION_ID,
              Name: 'SH1 Constellation Dr',
              Latitude: '-36.750564',
              Longitude: '174.726254',
              Direction: 'Southbound',
            },
          ),
        ]),
      );
    }
    return Response.json([]);
  });
  const sources = await createCctvCatalog({ sourceRoot: '/nonexistent' })();
  return { requested, sources };
};

/** Run one catalog refresh with CCTV_AUCKLAND_ENABLED set to `flag`
 * (undefined deletes it) and restore the environment afterwards. */
const runWithAucklandFlag = async (t, flag) => {
  const saved = { ...process.env };
  try {
    delete process.env.CCTV_SOURCES_FILE;
    delete process.env.CCTV_SOURCES_JSON;
    if (flag === undefined) delete process.env.CCTV_AUCKLAND_ENABLED;
    else process.env.CCTV_AUCKLAND_ENABLED = flag;
    return await runCatalogWithMockedUpstreams(t);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
};

test('CCTV_AUCKLAND_ENABLED=1 wires the Auckland lane into the catalog', async (t) => {
  const { requested, sources } = await runWithAucklandFlag(t, '1');
  assert.ok(
    requested.includes(AUCKLAND_CAMERAS_URL),
    'the catalog refresh invokes the Auckland loader',
  );
  assert.deepEqual(
    new Set(sources.filter((s) => s.cityId === 'auckland').map((s) => s.id)),
    new Set([`auckland-${CARRINGTON_ID}`, `auckland-${CONSTELLATION_ID}`]),
    'Auckland cameras reach the served catalog through the registered lane',
  );
});

for (const [label, flag] of [
  ['an unset CCTV_AUCKLAND_ENABLED', undefined],
  ['an empty CCTV_AUCKLAND_ENABLED', ''],
  ['CCTV_AUCKLAND_ENABLED=0', '0'],
  ['CCTV_AUCKLAND_ENABLED=true', 'true'],
]) {
  test(`${label} keeps the lane from being loaded at all`, async (t) => {
    const { requested, sources } = await runWithAucklandFlag(t, flag);
    assert.equal(
      requested.includes(AUCKLAND_CAMERAS_URL),
      false,
      'the opt-in lane never reaches its upstream',
    );
    assert.deepEqual(
      sources.filter((s) => s.cityId === 'auckland'),
      [],
    );
  });
}

test('the shared catalog slots are not raised to make room for this pack', () => {
  assert.equal(CCTV_SHARED_SOURCE_SLOTS, 4000);
  assert.equal(DEFAULT_AUCKLAND_MAX_SOURCES, 120);
});

test('isLikelyAucklandCoordinate spans the metro and rejects the rest', () => {
  assert.equal(isLikelyAucklandCoordinate(-36.8485, 174.7633), true); // Downtown
  assert.equal(isLikelyAucklandCoordinate(-36.750564, 174.726254), true); // Albany
  assert.equal(isLikelyAucklandCoordinate(-37.008, 174.785), true); // Airport
  assert.equal(isLikelyAucklandCoordinate(-41.2865, 174.7762), false); // Wellington
  assert.equal(isLikelyAucklandCoordinate(-43.5321, 172.6362), false); // Christchurch
  assert.equal(isLikelyAucklandCoordinate(0, 0), false);
  assert.equal(isLikelyAucklandCoordinate(NaN, 174.76), false);
});
