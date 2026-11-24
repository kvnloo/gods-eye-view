/**
 * FORK-ONLY (exp/theme-engine-v0, loop v3). OSM class mask worker: fetches
 * OpenFreeMap tiles and rasterises mask tiles off the main thread
 * (maskJob.js), transferring the RGBA bytes back.
 */
import { createMaskGenerator } from './maskJob.js';

const generator = createMaskGenerator();

self.onmessage = async (event) => {
  const { id, tile } = event.data ?? {};
  try {
    const out = await generator.maskTile(tile);
    self.postMessage({ id, ok: true, rgba: out.rgba, features: out.features, stats: { ...generator.stats } }, [
      out.rgba.buffer,
    ]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
};
