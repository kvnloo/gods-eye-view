// One crown prototype is shared by every instance of a broadleaf variant.
// Look pass A: the crown is a cluster of smooth-shaded lobes; the side lobes sit a shade darker than the
// top lobe (a painted ambient-occlusion cue), so a crown reads as one soft rounded mass.
export function appendClusteredCanopy(soup, ico, x, y, z, radius, color, random, lowDetail, tag = 1) {
  const turn = Math.PI * 2;
  const rotation = random() * turn;
  const branches = lowDetail ? 4 : 5;
  const shade = (k) => [...color.slice(0, 3).map((c) => c * k), tag];

  for (let i = 0; i < branches; i++) {
    const angle = rotation + (i * turn) / branches + (random() - 0.5) * 0.35;
    const offset = radius * (0.55 + random() * 0.12);
    const width = radius * (0.46 + random() * 0.1);
    const height = radius * (0.28 + random() * 0.25);
    appendLobe(soup, ico, x + Math.cos(angle) * offset, y + Math.sin(angle) * offset,
      z + height, width, width * 1.1, shade(0.86 + random() * 0.08));
  }
  appendLobe(soup, ico, x, y, z + radius * 0.7, radius * 0.78, radius * 0.8, shade(1.06));
}

// A boulder: one squashed smooth lobe, with a flatter mossy cap on top when `moss` is given.
export function appendBoulder(soup, ico, x, y, z, radius, stone, moss, random) {
  const w = radius * (0.9 + random() * 0.25);
  const d = radius * (0.75 + random() * 0.25);
  const h = radius * (0.55 + random() * 0.2);
  appendLobe(soup, ico, x, y, z + h * 0.35, w, h, stone, d / w);
  if (moss) appendLobe(soup, ico, x + (random() - 0.5) * 0.2 * w, y, z + h * 0.8, w * 0.72, h * 0.32, moss, d / w);
}

function appendLobe(soup, { v, f }, x, y, z, width, height, color, depth = 1) {
  const positions = v.map(([a, b, c]) => [x + a * width, y + b * width * depth, z + c * height]);
  // The ellipsoid normal follows the inverse scale of the unit sphere normal.
  const normals = v.map(([a, b, c]) => {
    const vertical = c * width / height;
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
