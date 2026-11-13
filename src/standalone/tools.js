import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { startStandaloneChrome } from './startupChrome.js';
import { loadToolCatalog } from './toolCatalog.js';
import { mountCityBuilder } from './cityPlanningServices.js';

/** Only the exact, explicit fixture query may load hypothetical planning UI. */
export function isPlanningFixturePreviewRequested(search) {
  return search === '?planningPreview=fixture';
}

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
    voice: {
      supportedProviders: ['openai', 'gemini'],
      panel: true,
      toolCatalog: loadToolCatalog,
      ...options?.voice,
    },
  });
  if (!isPlanningFixturePreviewRequested(globalThis.location?.search)) {
    options.defer(mountCityBuilder(options));
  } else {
    let dispose = null;
    // Register cleanup before the import, so shutdown never leaks a launcher.
    options.defer(() => {
      dispose?.();
      dispose = () => {};
    });
    void Promise.all([
      import('../ui/communityPlanningPreview.js'),
      import('./communityPlanningFixture.js'),
    ])
      .then(([ui, fixture]) => {
        if (dispose || options.signal?.aborted) return;
        dispose = ui.mountCommunityPlanningPreview(
          fixture.createSyntheticCommunityPlanningFixture(),
        );
      })
      .catch(() => console.error('Community planning fixture preview failed'));
  }
  return tools;
}
