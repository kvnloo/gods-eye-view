// The sun over a play-mode plot and the shadow an assumed massing block casts.
// Pure: degrees, metres, UTC epoch milliseconds. src/data/citySun.test.mjs
// holds it to NREL SPA and NOAA references and to Cesium's own scene sun.
import { localFrame } from './cityMassing.js';

/**
 * The sun at a place and UTC time: altitude above the horizon (`elevationDeg`,
 * geometric, no refraction) and azimuth clockwise from north, in degrees.
 */
export { observerSolarPosition as sunPosition } from './satellitePass.js';

/**
 * How far the top of a block `heightMeters` tall casts its shadow on level
 * ground: height / tan(altitude). Null when the sun is down or nothing stands.
 */
export function shadowReach(heightMeters, sun) {
  if (!(heightMeters > 0) || !(sun?.elevationDeg > 0)) return null;
  return heightMeters / Math.tan((sun.elevationDeg * Math.PI) / 180);
}

/**
 * Where the top of a block's shadow lands: its footprint moved away from the
 * sun (azimuth + 180°) by the shadow reach. Null when the sun is down or
 * nothing stands.
 */
export function shadowTip(footprint, heightMeters, sun) {
  const length = footprint && shadowReach(heightMeters, sun);
  if (!length) return null;
  const az = (sun.azimuthDeg * Math.PI) / 180;
  const frame = localFrame(footprint);
  return frame.points.map(([x, y]) =>
    frame.toLonLat([x - Math.sin(az) * length, y - Math.cos(az) * length]),
  );
}
