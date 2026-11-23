// exp/city-loop-v5 look pass A: shore boulders for the diorama (pure geometry, no Cesium import).
// A boulder is one squashed, smooth-shaded ellipsoid, with a flatter mossy cap on top when `moss` is given.
// Colours may carry a fourth component, the vertex tag the light shader reads (colour alpha).

export const SHORE = Object.freeze({
  rock: ['#b4b0a6', '#a6a39a', '#bdb8ac', '#9c998f'],
  moss: ['#a2bb4a', '#8eaa40', '#b3c457'],
});

export function appendBoulder(soup, ico, x, y, z, radius, stone, moss, random) {
  const w = radius * (0.9 + random() * 0.25);
  const d = radius * (0.75 + random() * 0.25);
  const h = radius * (0.55 + random() * 0.2);
  appendLobe(soup, ico, x, y, z + h * 0.35, w, h, stone, d / w);
  if (moss) appendLobe(soup, ico, x + (random() - 0.5) * 0.2 * w, y, z + h * 0.8, w * 0.72, h * 0.32, moss, d / w);
}

function appendLobe(soup, { v, f }, x, y, z, width, height, color, depth) {
  const positions = v.map(([a, b, c]) => [x + a * width, y + b * width * depth, z + c * height]);
  // The ellipsoid normal follows the inverse scale of the unit sphere normal.
  const normals = v.map(([a, b, c]) => {
    const vertical = (c * width) / height;
    const lateral = b / depth;
    const length = Math.hypot(a, lateral, vertical);
    return [a / length, lateral / length, vertical / length];
  });
  for (const face of f) {
    for (const index of face) {
      soup.p.push(...positions[index]);
      soup.n.push(...normals[index]);
      soup.c.push(color[0], color[1], color[2], color[3] ?? 1);
    }
  }
}
