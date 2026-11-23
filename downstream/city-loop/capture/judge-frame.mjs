export function frameProvenance() {
  const v = window.__godsEyeView.viewer;
  const s = v.scene;
  const p = s.primitives;
  let shownTilesets = 0;
  for (let i = 0; i < p.length; i++) {
    const x = p.get(i);
    if ('tilesLoaded' in x && typeof x.root !== 'undefined' && x.show) shownTilesets++;
  }
  const layers = [];
  const il = v.imageryLayers;
  for (let i = 0; i < (il?.length ?? 0); i++) {
    const l = il.get(i);
    if (l.show) layers.push(String(l.imageryProvider?.url ?? l.imageryProvider?._resource?.url ?? l.imageryProvider?.constructor?.name ?? ''));
  }
  const googleLogos = document.querySelectorAll(
    '#cesium-credits img[src*="google" i], .cesium-credit-lightbox img[src*="google" i]',
  );
  const visibleGoogleLogos = [...googleLogos].filter(
    (image) => getComputedStyle(image).display !== 'none',
  ).length;
  const globe = Boolean(s.globe?.show);
  const globeGoogle = globe && layers.some((u) => /google/i.test(u));
  return {
    shownTilesets,
    globe,
    imagery: globe ? layers.map((u) => u.replace(/([?&](key|access_token|token)=)[^&]+/g, '$1REDACTED').slice(0, 120)) : [],
    googleLogos: visibleGoogleLogos,
    googleSurface: shownTilesets > 0 || globeGoogle,
    googleTiles: shownTilesets > 0 || globeGoogle || visibleGoogleLogos > 0,
  };
}

export async function captureJudgeFrame(page, name) {
  const refused = (tiles) =>
    new Error(`judge frame ${name} refused: Google tiles may be on screen ${JSON.stringify(tiles)}`);
  let tiles = await page.evaluate(frameProvenance);
  if (tiles.googleSurface !== false) throw refused(tiles);
  // A hidden surface can leave its logo in Cesium's credit DOM. Scope the
  // style to the capture so late DOM updates cannot reintroduce the logo.
  const style = await page.addStyleTag({
    content: `#cesium-credits img[src*="google" i],
      .cesium-credit-lightbox img[src*="google" i] { display: none !important; }`,
  });
  try {
    tiles = await page.evaluate(frameProvenance);
    if (tiles.googleTiles !== false) throw refused(tiles);
    const png = await page.screenshot({ timeout: 60000 });
    const after = await page.evaluate(frameProvenance);
    if (after.googleTiles !== false) throw refused(after);
    return { tiles, png };
  } finally {
    await style.evaluate((element) => element.remove());
  }
}
