import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';
import { dataDir } from '../providers/common/data-dir.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Copy dotenv values into the process, except the directory selector.
 * A value loaded FROM .env must not move the credential store that owns it.
 * GEV_DATA_DIR is accepted only when present in the launch environment.
 */
export function mergeLoadedEnv(loaded, env = process.env) {
  for (const [key, value] of Object.entries(loaded)) {
    if (key === 'GEV_DATA_DIR') continue;
    if (env[key] === undefined) env[key] = value;
  }
}

/** Load this checkout's configuration and attach its local provider middleware. */
export function standaloneConfig(
  { command, mode },
  { nominatimStorageDir } = {},
) {
  // GEV_DATA_DIR (Docker) keeps the saved .env outside the read-only code.
  mergeLoadedEnv(loadEnv(mode, dataDir(root), ''));
  const tools = standaloneVoiceTools();
  return createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins({
        realtime: { tools },
        gemini: { tools },
        nominatimStorageDir,
      }),
      localMcpPlugin(),
      googleTokenUnavailablePlugin(),
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    photonUrl: process.env.PHOTON_URL,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
}

export default defineConfig(standaloneConfig);
