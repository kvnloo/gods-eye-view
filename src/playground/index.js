/**
 * Small, opt-in exploration surface. Features are deliberately loaded from
 * independent modules so experimental work never owns global app state.
 */
import * as Cesium from 'cesium';
import { createLookPackController, LOOK_PACKS } from './lookPacks.js';

// Node ESM consumers must not invoke the Vite-only glob hook.
const discovered = import.meta.env
  ? import.meta.glob('./features/*.js', { eager: true })
  : {};

export function mountPlanetPlayground(services) {
  const features = Object.entries(discovered)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, module]) => module.feature)
    .filter((item) => item && typeof item.id === 'string' && typeof item.mount === 'function');
  const doc = services.document || document;
  if (doc.querySelector('#planet-playground-launcher') || !features.length)
    return () => {};
  // An embedded globe is controlled by its host; it must not acquire a second UI.
  if (new URLSearchParams(services.window?.location?.search || '').get('embed') === '1')
    return () => {};

  // An opt-in creative filter must remain visibly labeled even after the
  // Playground tray closes or an evidence-oriented tab is selected.
  const creativeChip = doc.createElement('button');
  creativeChip.type = 'button';
  creativeChip.className = 'gev-playground-creative-chip';
  creativeChip.setAttribute('aria-label', 'Return to original Earth view');
  creativeChip.hidden = true;
  const lookPacks = createLookPackController({
    viewer: services.viewer,
    Cesium,
    styleManager: services.styleManager,
    onChange: (id) => {
      const pack = LOOK_PACKS.find((entry) => entry.id === id);
      creativeChip.hidden = !pack || id === 'original';
      creativeChip.textContent = pack ? 'CREATIVE · ' + pack.title + ' · Reset' : '';
    },
  });
  creativeChip.addEventListener('click', () => lookPacks.apply('original'));
  // Direct changes through the original GEV style controls supersede a creative
  // grade. Internal changes made by the look pack are explicitly exempt.
  const eventWindow = services.window || doc.defaultView;
  const onExternalStyleChange = () => {
    if (lookPacks.activeId && !lookPacks.applyingBaseStyle)
      lookPacks.clearGrade();
  };
  eventWindow?.addEventListener('gev:style-change', onExternalStyleChange);

  const launcher = doc.createElement('button');
  launcher.id = 'planet-playground-launcher';
  launcher.type = 'button';
  launcher.textContent = 'EXPLORE';
  launcher.setAttribute('aria-label', 'Open Planet Playground');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'planet-playground');
  launcher.className = 'gev-playground-launcher';

  const panel = doc.createElement('section');
  panel.id = 'planet-playground';
  panel.className = 'gev-playground';
  panel.setAttribute('aria-label', 'Planet Playground');
  panel.hidden = true;
  const header = doc.createElement('header');
  header.className = 'gev-playground-header';
  const heading = doc.createElement('strong');
  heading.textContent = 'PLANET PLAYGROUND';
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.className = 'gev-playground-close';
  close.setAttribute('aria-label', 'Close Planet Playground');
  header.append(heading, close);
  const tabs = doc.createElement('nav');
  tabs.setAttribute('aria-label', 'Playground modes');
  tabs.className = 'gev-playground-tabs';
  const body = doc.createElement('div');
  body.className = 'gev-playground-body';
  body.setAttribute('role', 'tabpanel');
  panel.append(header, tabs, body);

  let opened = false;
  let activeId = null;
  let disposeFeature = null;
  const buttons = [];
  function select(id) {
    const feature = features.find((entry) => entry.id === id);
    if (!feature || activeId === id) return;
    disposeFeature?.();
    disposeFeature = null;
    activeId = id;
    body.replaceChildren();
    body.setAttribute('aria-label', feature.title);
    for (const button of buttons) {
      const selected = button.dataset.mode === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    try {
      disposeFeature = feature.mount({
        root: body,
        services: { ...services, Cesium, lookPacks },
      }) || null;
    } catch (error) {
      const problem = doc.createElement('p');
      problem.textContent = 'This mode could not open. Other modes remain available.';
      body.replaceChildren(problem);
      console.error('Planet Playground mode failed:', feature.id, error);
    }
  }
  function setOpen(next) {
    opened = Boolean(next);
    panel.hidden = !opened;
    launcher.setAttribute('aria-expanded', String(opened));
    if (opened) {
      select(activeId || features[0].id);
      close.focus();
    } else {
      // An inactive mode never keeps live camera, timers or presence listeners.
      disposeFeature?.();
      disposeFeature = null;
      activeId = null;
      launcher.focus();
    }
  }
  for (const feature of features) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.mode = feature.id;
    button.textContent = feature.title;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.addEventListener('click', () => select(feature.id));
    tabs.append(button);
    buttons.push(button);
  }
  launcher.addEventListener('click', () => setOpen(!opened));
  close.addEventListener('click', () => setOpen(false));
  const onKeydown = (event) => {
    if (event.key === 'Escape' && opened && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false);
    }
  };
  doc.addEventListener('keydown', onKeydown);
  doc.body.append(launcher, panel, creativeChip);
  return () => {
    doc.removeEventListener('keydown', onKeydown);
    disposeFeature?.();
    panel.remove();
    launcher.remove();
    creativeChip.remove();
    eventWindow?.removeEventListener('gev:style-change', onExternalStyleChange);
    lookPacks.destroy();
  };
}
