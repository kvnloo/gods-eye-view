// node plots.mjs <app> lat,lon ... : snapPlot ids + centres (the app's own grid)
import { pathToFileURL } from 'node:url';
const [app, ...pts] = process.argv.slice(2);
const { snapPlot } = await import(pathToFileURL(`${app}/src/data/cityPlot.js`).href);
for (const p of pts) {
  const [lat, lon] = p.split(',').map(Number);
  const c = snapPlot({ lat, lon });
  console.log(JSON.stringify({ in: p, id: c.id, lat: c.center.lat, lon: c.center.lon }));
}
