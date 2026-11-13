import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { shadowReach, shadowTip, sunPosition } from './citySun.js';
import { plotMassing } from './cityMassing.js';
import { plotFromId, snapPlot } from './cityPlot.js';

const D2R = Math.PI / 180;
const near = (actual, expected, label, tolerance) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected} (±${tolerance})`,
  );
// Great-circle angle between two sun positions, degrees.
function separation(a, b) {
  const [e1, a1, e2, a2] = [
    a.elevationDeg,
    a.azimuthDeg,
    b.elevationDeg,
    b.azimuthDeg,
  ].map((v) => v * D2R);
  const c =
    Math.sin(e1) * Math.sin(e2) +
    Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
}
const azimuthGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// The journey's plot: Saints Peter and Paul Church, Washington Square, San
// Francisco (plot-n105201-126637), centre 37.801473230 N, 122.410211341 W.
const PLOT = plotFromId('plot-n105201-126637');

// INDEPENDENT REFERENCES (never values from this code or from Cesium).
// NREL SPA: Reda, I. and Andreas, A., "Solar Position Algorithm for Solar
// Radiation Applications", NREL/TP-560-34302 (rev. 2008), as implemented by
// pvlib-python 0.13.1 solarposition.spa_python (delta_t 69.2 s, 1013.25 hPa,
// 12 C, 0 m); that implementation reproduces the report's published example
// below to 1e-5 deg. `elevation` is the geometric (unrefracted) topocentric
// elevation, as this module and Cesium compute it; `apparent` adds refraction.
// NOAA Solar Calculator (gml.noaa.gov/grad/solcalc, main.js calcAzEl, apparent
// elevation) agrees with SPA within 0.007 deg at all three times.
// Inputs: lanes/play/logs/r4/ref.py and noaa.mjs.
const REFERENCE = [
  {
    utc: '2026-06-21T15:00:00Z', // the journey's sun
    spa: {
      elevationDeg: 23.33297,
      apparentDeg: 23.371558,
      azimuthDeg: 77.666852,
    },
    noaa: { apparentDeg: 23.371134, azimuthDeg: 77.665786 },
  },
  {
    utc: '2026-06-21T20:00:00Z',
    spa: {
      elevationDeg: 75.424707,
      apparentDeg: 75.42907,
      azimuthDeg: 169.434053,
    },
    noaa: { apparentDeg: 75.429436, azimuthDeg: 169.427996 },
  },
  {
    utc: '2026-12-21T22:00:00Z',
    spa: {
      elevationDeg: 23.336713,
      apparentDeg: 23.375295,
      azimuthDeg: 207.999396,
    },
    noaa: { apparentDeg: 23.376962, azimuthDeg: 207.996351 },
  },
];

test('sun altitude and azimuth match NREL SPA and NOAA within 1 degree at three UTC times over the plot', () => {
  for (const { utc, spa, noaa } of REFERENCE) {
    const sun = sunPosition(PLOT.center.lat, PLOT.center.lon, Date.parse(utc));
    near(sun.elevationDeg, spa.elevationDeg, `${utc} altitude vs SPA`, 1);
    assert.ok(
      azimuthGap(sun.azimuthDeg, spa.azimuthDeg) <= 1,
      `${utc} azimuth vs SPA`,
    );
    near(sun.elevationDeg, noaa.apparentDeg, `${utc} altitude vs NOAA`, 1);
    assert.ok(
      azimuthGap(sun.azimuthDeg, noaa.azimuthDeg) <= 1,
      `${utc} azimuth vs NOAA`,
    );
  }
});

test("the SPA report's published example: Golden, Colorado, 2003-10-17 12:30:30 -07:00", () => {
  // NREL/TP-560-34302 example: topocentric zenith 50.11162 deg (refracted),
  // azimuth 194.34024 deg at 39.742476 N, 105.1786 W.
  const sun = sunPosition(
    39.742476,
    -105.1786,
    Date.parse('2003-10-17T19:30:30Z'),
  );
  near(sun.elevationDeg, 90 - 50.11162, 'altitude', 1);
  assert.ok(azimuthGap(sun.azimuthDeg, 194.34024) <= 1, 'azimuth');
});

test("Cesium's own scene sun (UniformState: Simon 1994 sun to Earth-fixed) agrees within 1 degree", () => {
  // As Cesium's UniformState sets sunDirectionWC every frame.
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(PLOT.center.lon, PLOT.center.lat),
  );
  const axis = (i) =>
    Cesium.Cartesian3.fromCartesian4(
      Cesium.Matrix4.getColumn(enu, i, new Cesium.Cartesian4()),
    );
  const [east, north, up] = [0, 1, 2].map(axis);
  for (const { utc } of REFERENCE) {
    const time = Cesium.JulianDate.fromIso8601(utc);
    // Without Earth-orientation data (node; the app loads it only for the
    // starry sky) UniformState's ICRF-to-fixed falls back to this matrix.
    const toFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(
      time,
      new Cesium.Matrix3(),
    );
    const sun =
      Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        time,
        new Cesium.Cartesian3(),
      );
    const dir = Cesium.Cartesian3.normalize(
      Cesium.Matrix3.multiplyByVector(toFixed, sun, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    const cesium = {
      elevationDeg: Math.asin(Cesium.Cartesian3.dot(dir, up)) / D2R,
      azimuthDeg:
        (Math.atan2(
          Cesium.Cartesian3.dot(dir, east),
          Cesium.Cartesian3.dot(dir, north),
        ) /
          D2R +
          360) %
        360,
    };
    const ours = sunPosition(PLOT.center.lat, PLOT.center.lon, Date.parse(utc));
    assert.ok(
      separation(cesium, ours) <= 1,
      `${utc}: ${JSON.stringify({ cesium, ours })}`,
    );
  }
});

test('shadow reach = height / tan(altitude); none without a sun or a height', () => {
  near(
    shadowReach(19.2, { elevationDeg: 45, azimuthDeg: 90 }),
    19.2,
    '45 deg',
    1e-9,
  );
  near(
    shadowReach(19.2, REFERENCE[0].spa),
    19.2 / Math.tan(23.33297 * D2R),
    'journey sun',
    1e-9,
  );
  assert.equal(shadowReach(19.2, { elevationDeg: -2, azimuthDeg: 90 }), null);
  assert.equal(shadowReach(19.2, { elevationDeg: 0, azimuthDeg: 90 }), null);
  assert.equal(shadowReach(19.2, null), null);
  assert.equal(shadowReach(null, { elevationDeg: 30, azimuthDeg: 0 }), null);
});

// Distance (m) and initial bearing (deg) between two [lon, lat] points on a
// sphere: an independent check of the tip, not the module's own plane metric.
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6_371_008.8;
  const [p1, p2, dl] = [lat1 * D2R, lat2 * D2R, (lon2 - lon1) * D2R];
  const h =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const bearing =
    Math.atan2(
      Math.sin(dl) * Math.cos(p2),
      Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
    ) / D2R;
  return {
    meters: 2 * R * Math.asin(Math.sqrt(h)),
    bearing: (bearing + 360) % 360,
  };
}
const centroid = (ring) =>
  [0, 1].map((k) => ring.reduce((s, p) => s + p[k], 0) / ring.length);

test("the rendered block's shadow tip: height / tan(altitude) away from the sun (azimuth + 180), and +2 storeys = 1.333", () => {
  // The journey's block (6 storeys, 19.2 m) at the journey's sun, taken from
  // the SPA reference so the check does not lean on this module's sun.
  const sun = REFERENCE[0].spa;
  const tipLength = (storeys) => {
    const m = plotMassing({ corners: PLOT.corners, storeys });
    const { meters, bearing } = haversine(
      centroid(m.footprint),
      centroid(shadowTip(m.footprint, m.heightMeters, sun)),
    );
    const formula = m.heightMeters / Math.tan(sun.elevationDeg * D2R);
    near(
      meters,
      formula,
      `${storeys} storeys: tip length`,
      Math.max(1, 0.05 * formula),
    );
    assert.ok(
      azimuthGap(bearing, sun.azimuthDeg + 180) <= 0.5,
      `bearing ${bearing}`,
    );
    return meters;
  };
  const six = tipLength(6);
  const eight = tipLength(8);
  near(eight / six, 8 / 6, '+2 storeys', 0.05 * (8 / 6));
});

test('the shadow tip is the footprint moved away from the sun by height / tan(elevation)', () => {
  const plot = snapPlot({ lat: 37.8006, lon: -122.4103 });
  const m = plotMassing({ corners: plot.corners });
  // Sun due east at 45°: the top of a 19.2 m block lands 19.2 m west.
  const tip = shadowTip(m.footprint, m.heightMeters, {
    azimuthDeg: 90,
    elevationDeg: 45,
  });
  const metersLon = 111_320 * Math.cos((plot.center.lat * Math.PI) / 180);
  tip.forEach(([lon, lat], i) => {
    near(
      (lon - m.footprint[i][0]) * metersLon,
      -19.2,
      `corner ${i} west`,
      1e-3,
    );
    near((lat - m.footprint[i][1]) * 111_320, 0, `corner ${i} north`, 1e-3);
  });
  // Sun due south at 45°: the shadow falls 19.2 m north.
  const north = shadowTip(m.footprint, m.heightMeters, {
    azimuthDeg: 180,
    elevationDeg: 45,
  });
  north.forEach(([lon, lat], i) => {
    near((lon - m.footprint[i][0]) * metersLon, 0, `corner ${i} east`, 1e-3);
    near((lat - m.footprint[i][1]) * 111_320, 19.2, `corner ${i} north`, 1e-3);
  });
  assert.equal(
    shadowTip(m.footprint, m.heightMeters, {
      azimuthDeg: 90,
      elevationDeg: -3,
    }),
    null,
    'no sun, no shadow',
  );
  assert.equal(shadowTip(null, 10, { azimuthDeg: 0, elevationDeg: 30 }), null);
});
