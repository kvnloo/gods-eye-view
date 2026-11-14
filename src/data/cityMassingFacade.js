// How the assumed massing block is drawn as a building: one floor band per
// storey at the massing's own storey height, a shopfront at the ground, a
// window rhythm in whole bays per wall and a parapet inside the top band, so
// the top stays the massing height and every shadow number holds. A look,
// never a design: the block is still an estimate (src/data/cityMassing.js).
import { localFrame } from './cityMassing.js';

/**
 * The look's constants. Glass is given as shares of the storey height (sill,
 * head) and of the bay width; the colours are solid, in the app's palette
 * (stone body, slate frames, amber fascia): cyan stays the plot outline.
 */
export const FACADE = Object.freeze({
  bayMeters: 3.2,
  parapetShare: 0.18,
  parapetMaxMeters: 0.6,
  shopfront: Object.freeze({ sill: 0.1, head: 0.72, share: 0.8 }),
  floor: Object.freeze({ sill: 0.26, head: 0.8, share: 0.56 }),
  // The sign band over the shopfront glass, as shares of the ground storey.
  fascia: Object.freeze({ bottom: 0.76, top: 0.92 }),
  colors: Object.freeze({
    body: '#d8d4cb',
    frame: '#26343a',
    glass: '#1b2a33',
    blind: '#c9c4b8',
    fascia: '#c9924b',
    coping: '#eceae4',
    roof: '#9a9fa3',
    paving: '#989690',
    glow: '#cfeef6',
  }),
});

/**
 * The building for a massing (`plotMassing`): its bands from the ground up,
 * the parapet, each wall of the footprint with its window bays (and where it
 * lies, in metres east/north of the footprint's middle, for the shader) and
 * the material. Null when the massing has no footprint: no block, no building.
 */
export function massingFacade(massing) {
  const { footprint, storeys, storeyHeightMeters, heightMeters } = massing;
  if (!footprint) return null;
  const bands = Array.from({ length: storeys }, (_, i) => {
    const kind = i === 0 ? 'shopfront' : 'floor';
    const bottomMeters = i * storeyHeightMeters;
    const { sill, head, share } = FACADE[kind];
    return Object.freeze({
      storey: i + 1,
      kind,
      bottomMeters,
      topMeters:
        i + 1 === storeys ? heightMeters : bottomMeters + storeyHeightMeters,
      glass: Object.freeze({
        sillMeters: bottomMeters + sill * storeyHeightMeters,
        headMeters: bottomMeters + head * storeyHeightMeters,
        share,
      }),
    });
  });
  const parapetMeters = Math.min(
    FACADE.parapetMaxMeters,
    FACADE.parapetShare * storeyHeightMeters,
  );
  const frame = localFrame(footprint);
  const turn = Math.sign(
    frame.points.reduce((sum, [x, y], i) => {
      const [x2, y2] = frame.points[(i + 1) % frame.points.length];
      return sum + x * y2 - x2 * y;
    }, 0),
  );
  const walls = frame.points.map((a, i) => {
    const b = frame.points[(i + 1) % frame.points.length];
    const lengthMeters = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = [(b[0] - a[0]) / lengthMeters, (b[1] - a[1]) / lengthMeters];
    // Outward, whichever way the footprint winds.
    const normal = [turn * along[1], -turn * along[0]];
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bays = Math.max(1, Math.round(lengthMeters / FACADE.bayMeters));
    return Object.freeze({
      from: footprint[i],
      to: footprint[(i + 1) % footprint.length],
      lengthMeters,
      bays,
      bayMeters: lengthMeters / bays,
      normal: Object.freeze(normal),
      offsetMeters: middle[0] * normal[0] + middle[1] * normal[1],
      // Along the wall's own tangent (the normal turned a quarter left).
      middleMeters: -middle[0] * normal[1] + middle[1] * normal[0],
    });
  });
  return Object.freeze({
    footprint,
    origin: Object.freeze(frame.toLonLat([0, 0])),
    storeys,
    storeyHeightMeters,
    heightMeters,
    bands: Object.freeze(bands),
    parapet: Object.freeze({
      bottomMeters: heightMeters - parapetMeters,
      topMeters: heightMeters,
    }),
    walls: Object.freeze(walls),
    material: Object.freeze({
      translucent: false,
      alpha: 1,
      colors: FACADE.colors,
    }),
  });
}
