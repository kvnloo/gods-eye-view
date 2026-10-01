import { createTrafficLayer } from '../../layers/traffic/index.js';
import * as credits from '../../data/dataCredits.js';
import * as ground from '../../data/groundFloor.js';
import * as overlays from '../../overlays/worldOverlay.js';
import * as render from '../../renderGovernor.js';

/** Construct one layer using the application scene owners and a supplied source. */
export function createApplicationTraffic({
  source,
  surface,
  observedSource = null,
}) {
  return createTrafficLayer({
    source,
    observedSource,
    services: {
      credits,
      render,
      overlays,
      ground: surface?.groundFloor || ground,
    },
  });
}
