import { toLonLatH } from '../geo/ellipsoid.js';
import { snapPlot } from './cityPlot.js';

/**
 * The ground point under the cursor: {lat, lon, height}, or null. `query`
 * is the renderer's query port (`src/render/contract/query.d.ts`);
 * `globeShown` whether the globe surface is drawn now.
 */
export function groundPoint(query, globeShown, { x, y }) {
  if (!query) return null;
  let world = null;
  // On the globe the click's own ray meets the terrain. A depth pick read after
  // a pick can land on play mode's translucent prism instead (#319).
  if (globeShown) {
    try {
      const ray = query.pickRay(x, y);
      world = (ray && query.pickGlobe(ray)) ?? null;
    } catch {
      world = null;
    }
  }
  // Photoreal tiles hide the globe; their surface is in the depth buffer.
  try {
    if (!world) world = query.pickPosition(x, y);
  } catch {
    world = null;
  }
  let at = world && toLonLatH(world);
  if (!at || !Number.isFinite(at.height) || Math.abs(at.height) > 9000) {
    try {
      world = query.pickEllipsoid(x, y);
    } catch {
      world = null;
    }
    at = world && toLonLatH(world);
  }
  if (!at) return null;
  return { lat: at.lat, lon: at.lon, height: at.height };
}

function conceptPlot(query, { x, y }, plotOf) {
  let hit = null;
  try {
    hit = query.pick(x, y);
  } catch {
    return null;
  }
  // Only a standing concept names its plot; tints and footprints fall through
  // to the ground pick, which snaps to the plot under the cursor.
  return (hit && !hit.surface && plotOf(hit)) || null;
}

/**
 * The plot a City builder click names: a standing concept's own plot (no
 * height), else the grid cell under the cursor with the ground height there.
 * `plotOf(hit)` is the plot a picked draw-set item of play mode's own names
 * (a standing concept), else null. Null when the click meets no plot.
 */
export function resolveClickedPlot({ query, globeShown, position, plotOf }) {
  if (!query) return null;
  const named = conceptPlot(query, position, plotOf);
  if (named) return { plot: named, height: undefined };
  const point = groundPoint(query, globeShown, position);
  const plot = point && snapPlot(point);
  return plot ? { plot, height: point.height } : null;
}
