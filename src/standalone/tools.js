import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { startStandaloneChrome } from './startupChrome.js';
import { loadToolCatalog } from './toolCatalog.js';
import { mountPlanetPlayground } from '../playground/index.js';

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
  // The playground consumes existing controllers and owns only its UI.
  // Register its cleanup with the same application lifetime.
  options.defer(
    mountPlanetPlayground({
      document,
      window,
      viewer: options.scene.viewer,
      styleManager: options.controls.styleManager,
      dataManager: options.data.dataManager,
      sceneDirector: tools.sceneDirector,
    }),
  );
  return tools;
}
