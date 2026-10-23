import { html, ui } from '@stencil-hq/tern';
import { ageLabel } from './projection.mjs';

const MAX_VISIBLE_LAYERS = 40;

function scalar(value, fallback = 'not reported') {
  return value === null || value === undefined ? fallback : String(value);
}

function coords(latitude, longitude) {
  if (latitude === null || longitude === null) return 'position not reported';
  return latitude.toFixed(4) + ', ' + longitude.toFixed(4);
}

/**
 * Native rendering is a projection, not an action owner. Each key is derived
 * from a stable GEV id. Click handlers only change this terminal's UI or ask
 * the already-connected browser for another read-only snapshot.
 */
export function buildSurfaceView(
  snapshot,
  {
    connected = false,
    paused = false,
    help = false,
    notice = '',
    now = Date.now(),
    onRefresh = () => {},
    onTogglePause = () => {},
    onHelp = () => {},
  } = {},
  caps = { kinds: ['col', 'text'], features: [] },
) {
  const kinds = new Set(caps.kinds);
  const features = new Set(caps.features);
  if (!kinds.has('col') || !kinds.has('text'))
    throw new TypeError('TSP peer lacks the minimum col/text vocabulary');
  const txt = (key, value, tone) =>
    ui.text({ key, ...(tone ? { tone } : {}) }, value);
  const section = (key, heading, children) =>
    kinds.has('card')
      ? ui.card({ key, head: heading }, ...children)
      : ui.col({ key }, txt('heading', heading, 'accent'), ...children);

  const main = [
    txt('title', "GOD'S EYE VIEW · Browser context", 'accent'),
    txt(
      'status',
      'Browser ' + (connected ? 'connected' : 'disconnected') +
        (paused ? ' · presentation paused' : '') +
        ' · read-only projection',
      connected ? 'info' : 'warning',
    ),
  ];
  if (notice) main.push(txt('notice', notice, 'warning'));

  const selected = snapshot?.selected;
  main.push(
    section(
      'selection',
      'Selected entity',
      selected
        ? [
            txt('name', selected.name + ' (' + selected.id + ')'),
            txt('origin', 'Source: ' + scalar(selected.source)),
            txt('layer', 'Layer: ' + scalar(selected.layerName || selected.layerId)),
            txt('position', coords(selected.latitude, selected.longitude)),
            txt('status', 'Observation status: ' + scalar(selected.status)),
            txt('age', 'Context refreshed: ' + ageLabel(selected.updatedAt, now) +
              ' (not source observation age)'),
          ]
        : [txt('empty', snapshot ? 'No active selection' : 'Waiting for browser snapshot')],
    ),
  );

  const c = snapshot?.camera;
  main.push(
    section(
      'camera',
      'Camera',
      c
        ? [
            txt('position', 'Center: ' + coords(c.latitude, c.longitude)),
            txt('height', 'Altitude: ' + scalar(c.heightM, 'unknown') + ' m'),
            txt(
              'orientation',
              'Heading: ' + scalar(c.heading) + '° · Pitch: ' + scalar(c.pitch) + '°',
            ),
          ]
        : [txt('empty', 'Camera not reported')],
    ),
  );

  const enabled = snapshot?.layers.filter((layer) => layer.enabled) || [];
  const feedChildren = enabled.slice(0, MAX_VISIBLE_LAYERS).map((layer) =>
    section('feed:' + layer.id, layer.name, [
      txt('health', layer.feedState.toUpperCase(), layer.feedState === 'nominal' ? 'success' : 'warning'),
      txt('source', 'Source: ' + scalar(layer.source)),
      txt(
        'scope',
        scalar(layer.count, '?') + ' loaded · ' +
          'feed last update ' + ageLabel(layer.lastUpdate, now),
      ),
      ...(layer.error ? [txt('error', 'Feed warning: ' + layer.error, 'warning')] : []),
    ]),
  );
  if (enabled.length > MAX_VISIBLE_LAYERS)
    feedChildren.push(txt('remainder', (enabled.length - MAX_VISIBLE_LAYERS) + ' more layers in browser'));
  if (!feedChildren.length) feedChildren.push(txt('empty', 'No enabled layers reported'));
  main.push(section('feeds', 'Enabled layers in snapshot · ' + enabled.length, feedChildren));
  if (snapshot?.omittedLayers > 0)
    main.push(
      txt(
        'layer-coverage',
        'Layer coverage: ' + snapshot.omittedLayers +
          ' layer rows omitted from this snapshot (relay size/80-row cap); ' +
          'view the full roster in the browser.',
        'warning',
      ),
    );

  main.push(
    txt(
      'change',
      snapshot
        ? 'Latest: ' + snapshot.change + ' · browser capture ' +
            ageLabel(snapshot.capturedAt, now) + ' · relay received ' +
            ageLabel(snapshot.receivedAt, now)
        : 'No browser update received yet',
      'muted',
    ),
    txt(
      'caveat',
      'Feed counts are loaded observations, not verified worldwide coverage. ' +
        'Delayed, inferred and fallback data can be wrong.',
      'warning',
    ),
  );

  const instructions = [
    txt('keys', 'Keys: r refresh · p pause · h help · q/esc quit'),
    txt('globe', '3D globe and all data/action ownership remain in the browser.'),
    txt('launch', 'Open the local GEV link printed when this command started.'),
  ];
  const canDock = features.has('dock');
  const canClick = kinds.has('el');
  const controls = canClick
    ? [
        html.button({ key: 'refresh', onClick: onRefresh }, 'Refresh snapshot'),
        html.button({ key: 'pause', onClick: onTogglePause }, paused ? 'Resume UI' : 'Pause UI'),
        html.button({ key: 'help', onClick: onHelp }, help ? 'Hide help' : 'Help'),
      ]
    : [];
  const helpPanel = section('help-content', 'About this surface', instructions);
  const view = {
    main: ui.col(
      { key: 'main', gap: 'sm' },
      ...main,
      ...(canDock ? [] : controls),
      ...(help && !features.has('aside') ? [helpPanel] : []),
    ),
  };
  if (canDock) {
    view.dock = ui.col({ key: 'dock', gap: 'sm' }, ...controls, ...instructions.slice(0, 1));
  }
  if (help && features.has('aside')) {
    view.layer = ui.col({ key: 'layer' }, helpPanel);
  }
  return view;
}
