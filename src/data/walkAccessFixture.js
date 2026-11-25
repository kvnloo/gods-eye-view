/**
 * Offline, synthetic pedestrian network for City builder walk access (#206).
 * A 4 x 4 street grid in local metres (x east, y north). A rail line between
 * columns 2 and 3 is crossable only on rows a and d; a plaza footpath runs
 * diagonally from b1 to c2; a curving path joins d0 and d1. It is not the
 * streets at any real site and carries no OpenStreetMap data.
 */
const X = [0, 160, 320, 480];
const Y = { a: 0, b: 130, c: 260, d: 390 };
const nodes = Object.entries(Y).flatMap(([row, y]) =>
  X.map((x, column) => ({ id: `${row}${column}`, x, y })),
);
const rail = new Set(['b2-b3', 'c2-c3']);
const edges = [
  ...Object.keys(Y).flatMap((row) =>
    [0, 1, 2]
      .map((c) => ({ from: `${row}${c}`, to: `${row}${c + 1}`, meters: 160 }))
      .filter((edge) => !rail.has(`${edge.from}-${edge.to}`)),
  ),
  ...X.flatMap((_, c) =>
    ['ab', 'bc', 'cd'].map(([r, s]) => ({
      from: `${r}${c}`,
      to: `${s}${c}`,
      meters: 130,
    })),
  ),
  { from: 'b1', to: 'c2', meters: 207 },
].map((edge) =>
  edge.from === 'd0' && edge.to === 'd1' ? { ...edge, meters: 175 } : edge,
);

function freeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') freeze(child);
  });
  return Object.freeze(value);
}

export const WALK_ACCESS_FIXTURE = freeze({
  id: 'walk-access-fixture',
  revision: 'walk-access-fixture-v1',
  kind: 'synthetic',
  nodes,
  edges,
  // Aggregated demand zones inside blocks (no residents, homes or trips).
  zones: [
    [40, 35],
    [280, 35],
    [440, 35],
    [40, 165],
    [440, 165],
    [200, 225],
    [440, 295],
    [40, 355],
    [440, 355],
  ].map(([x, y], i) => ({ id: `zone-${i + 1}`, x, y })),
  // The park that exists in the synthetic baseline.
  parks: [{ id: 'park-existing', x: 160, y: 390 }],
  // Candidate public sites a park or plaza alternative may be placed on.
  sites: [
    { id: 'site-a', label: 'A', x: 320, y: 130 },
    { id: 'site-b', label: 'B', x: 480, y: 0 },
    { id: 'site-c', label: 'C', x: 0, y: 260 },
    { id: 'site-d', label: 'D', x: 160, y: 130 },
  ],
});
