// I1b: exercise the renderer's actual triangle soup, one footprint at a time
// so neighbouring structures cannot satisfy the check.
export function waterSupportFailures(mesh, fixture, waterRaster, sample) {
  const { buildDiorama, DIORAMA_DEFAULTS, inPolygon, levelWater, waterField } = mesh;
  const input = { water: waterRaster };
  const water = waterField(input);
  const o = { ...DIORAMA_DEFAULTS, forestRing: 0 };
  const n = 151, spacing = 12, half = 900;
  const ground = { n, spacing, half, centre: sample(0, 0), offset: 0, heights: [] };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      ground.heights.push(sample(i * spacing - half, j * spacing - half) ?? ground.centre);
  const levels = levelWater(ground, water);
  if (!waterRaster) throw Object.assign(new Error(`no water raster for ${fixture.key}`), { code: 2 });
  const failures = [];
  let checked = 0;

  for (const [i, building] of fixture.buildings.entries()) {
    const xs = building.p.map(([x]) => x), ys = building.p.map(([, y]) => y);
    // Independent sub-cell probes leave room for the renderer to detect even
    // smaller overlaps, while exercising partial and interior-only overlaps.
    const bodies = new Set();
    for (let y = Math.min(...ys) + 0.25; y < Math.max(...ys); y += 1)
      for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 1)
        if (water?.at(x, y) && inPolygon([x, y], building.p)) bodies.add(water.at(x, y));
    if (!bodies.size) continue;
    input.buildings = [building];
    const { houses, soup } = buildDiorama(input, ground, o, levels);
    if (!houses.length) continue;
    checked++;
    const expected = ['barge', 'houseboat'].includes(building.k) ? 'hull' : 'pier';
    const valid = houses.every(({ support }) => {
      if (support?.kind !== expected || support.end <= support.start) return false;
      const zs = [];
      for (let p = support.start * 9 + 2; p < support.end * 9; p += 3) zs.push(soup.p[p]);
      if (!zs.length || !zs.every(Number.isFinite)) return false;
      const low = Math.min(...zs), high = Math.max(...zs);
      // Raw terrain levels and scene-local height use different origins.
      return [...bodies].some((id) => {
        const plane = levels[id] - ground.centre;
        if (!(low <= plane + 0.01 && high > plane + 0.5)) return false;
        if (expected === 'hull') return high < plane + 1.75;
        // A pier needs a raised deck and multiple posts, not a solid slab
        // extending from the deck to the waterline.
        const deckLevels = new Set(zs.filter((z) => z > plane + 0.5));
        return deckLevels.size >= 2 && zs.filter((z) => z <= plane + 0.01).length >= 24;
      });
    });
    if (!valid) failures.push(`water-support:${fixture.key}:${i}`);
  }
  return { checked, failures };
}
