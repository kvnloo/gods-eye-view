import * as Cesium from 'cesium';

// FORK-ONLY experiment (exp/city-game-hud, ?cityHud=drape): a concept is
// projected straight down onto the photoreal mesh of its plot, like a decal,
// instead of standing as a card or lying on a cut-out board. Nothing is cut,
// so there is no seam: the plot keeps the tiles' own relief and the concept
// lies over it. It is a textured polygon classified onto the 3D tiles (and
// terrain), turned to the capture view's heading, a little translucent so the
// tiles' own light and shadow read through, with a thin cyan edge ring. One
// concept drapes at a time (the one shown on the selected plot, else the
// newest).
//
// (A CustomShader on the photoreal tileset was tried first and changes no
// pixel in this app: the drape probe in the capture harness painted the
// tileset red and the frame did not change. A classified textured polygon
// does draw: same probe, checker test.)
const OPACITY = 0.88;
const EDGE_METERS = 0.9;
const ACCENT = Cesium.Color.fromCssColorString('#2ec8e8');

// A ring polygon: the corners and the same corners pulled `meters` inward.
function ring(corners, meters) {
  const lon0 = corners.reduce((s, [lon]) => s + lon, 0) / corners.length;
  const lat0 = corners.reduce((s, [, lat]) => s + lat, 0) / corners.length;
  const ky = 111_320;
  const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  const inner = corners.map(([lon, lat]) => {
    const x = (lon - lon0) * kx;
    const y = (lat - lat0) * ky;
    const d = Math.hypot(x, y) || 1;
    const k = Math.max(0, d - meters * Math.SQRT2) / d;
    return [lon0 + (x * k) / kx, lat0 + (y * k) / ky];
  });
  return new Cesium.PolygonHierarchy(
    Cesium.Cartesian3.fromDegreesArray(corners.flat()),
    [new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(inner.flat()))],
  );
}

/** The drape owner: `set` a concept on a plot, `show` it, `clear` it. */
export function mountConceptDrape({ viewer }) {
  const scene = viewer?.scene;
  if (!scene || !viewer.dataSources) return null;
  const ds = new Cesium.CustomDataSource('gev-city-drape');
  const added = viewer.dataSources.add(ds);
  let current = null; // { plot, image, heading, decal, edge }

  const api = {
    error: null,
    /** Drape `image` over `plot`, turned to the capture view's `heading` (degrees). */
    set({ plot, image, heading = 0 }) {
      if (current?.plot.id === plot.id && current.image === image) return;
      api.clear();
      try {
        const decal = ds.entities.add({
          id: `gev-city-drape-${plot.id}`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(plot.corners.flat()),
            material: new Cesium.ImageMaterialProperty({
              image,
              transparent: true,
              color: Cesium.Color.WHITE.withAlpha(OPACITY),
            }),
            stRotation: Cesium.Math.toRadians(heading),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        const edge = ds.entities.add({
          polygon: {
            hierarchy: ring(plot.corners, EDGE_METERS),
            material: ACCENT.withAlpha(0.85),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        current = { plot, image, heading, decal, edge };
      } catch (error) {
        api.error = String(error);
        current = null;
      }
      scene.requestRender();
    },
    show(on) {
      if (!current) return;
      if (current.decal.show === on) return;
      current.decal.show = current.edge.show = on;
      scene.requestRender();
    },
    clear(plotId = null) {
      if (!current || (plotId && current.plot.id !== plotId)) return;
      ds.entities.remove(current.decal);
      ds.entities.remove(current.edge);
      current = null;
      scene.requestRender();
    },
    get plotId() {
      return current?.plot.id ?? null;
    },
    get image() {
      return current?.image ?? null;
    },
    get shown() {
      return Boolean(current?.decal.show);
    },
    destroy() {
      api.clear();
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
      if (globalThis.window?.__gevCityDrape === api) delete globalThis.window.__gevCityDrape;
    },
  };
  // A read-only probe for the capture harness.
  if (globalThis.window) globalThis.window.__gevCityDrape = api;
  return api;
}

/** Diagnostic only (the harness's drape probe): a checker decal on the plot. */
export function debugDrapeDecal(viewer, plot) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? '#ff3060' : '#30ff90';
      g.fillRect(i * 8, j * 8, 8, 8);
    }
  const ds = new Cesium.CustomDataSource('gev-drape-probe');
  viewer.dataSources.add(ds);
  ds.entities.add({
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(plot.corners.flat()),
      material: new Cesium.ImageMaterialProperty({ image: c.toDataURL() }),
      classificationType: Cesium.ClassificationType.BOTH,
    },
  });
  viewer.scene.requestRender();
  return () => viewer.dataSources.remove(ds, true);
}
