import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function captureTargets(app, query, plotOverride) {
  const params = new URLSearchParams(query);
  const key = params.get('cityLoc');
  const preset = params.get('city');
  let location = null;
  if (key || preset === 'hero' || preset === 'v3') {
    const { cityLocation } = await import(
      pathToFileURL(path.join(app, 'src/data/cityLocations.js')).href
    );
    location = cityLocation(params);
    if (key && !location) throw new Error(`unknown cityLoc ${key}`);
  }
  return {
    location,
    plot: plotOverride || location?.gridPlot || location?.plot || 'plot-n105201-126637',
    oppositePlot: location?.gridOppositePlot,
  };
}
