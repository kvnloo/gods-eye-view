import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { startStandaloneChrome } from './startupChrome.js';
import { loadToolCatalog } from './toolCatalog.js';
export function createStandaloneTools(options) {
  const tools = createApplicationTools({
    startChrome: startStandaloneChrome,
    sceneDataPacks: {
      sources: {
        assets: createAssetDirectorySource({
          // A panel names the app's address; see src/tools/globePanel.js.
          baseUrl: new URL(
            '/scene-assets/',
            globalThis.GEV_APP_BASE_URL ?? document.baseURI,
          ).href,
        }),
      },
    },
    ...options,
    voice: { toolCatalog: loadToolCatalog, ...options?.voice },
  });
  // Explicit fixture-only proof. Normal GEV startup loads no proposal UI/code.
  if (
    new URLSearchParams(window.location.search).get('planningPreview') ===
    'fixture'
  ) {
    let stopped = false;
    let dispose = () => {};
    // Startup cleanup registration must happen synchronously, before the
    // async module import, or shutdown could leak an unattached dialog.
    options.defer(() => {
      stopped = true;
      dispose();
    });
    void Promise.all([
      import('../ui/communityPlanningPreview.js'),
      import('./communityPlanningFixture.js'),
    ]).then(([ui, fixture]) => {
      if (stopped || options.signal.aborted) return;
      dispose = ui.mountCommunityPlanningPreview(
        fixture.createSyntheticCommunityPlanningFixture(),
      );
    }).catch(() => {
      if (!stopped) console.error('Community planning fixture preview failed');
    });
  }
  return tools;
}
