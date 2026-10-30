/**
 * Small, opt-in exploration surface. Features are deliberately loaded from
 * independent modules so experimental work never owns global app state.
 */
import * as Cesium from 'cesium';

// Node ESM consumers must not invoke the Vite-only glob hook.
const discovered = import.meta.env
  ? import.meta.glob('./features/*.js', { eager: true })
  : {};

export function mountPlanetPlayground(services, featureOverrides = null) {
  const discoveredFeatures = Object.entries(discovered)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, module]) => module.feature)
    .filter((item) => item && typeof item.id === 'string' && typeof item.mount === 'function');
  // Injectable local feature registry keeps lifetime tests independent of Vite.
  const features = Array.isArray(featureOverrides) ? featureOverrides : discoveredFeatures;
  const doc = services.document || document;
  if (doc.querySelector('#planet-playground-launcher') || !features.length)
    return () => {};
  // An embedded globe is controlled by its host; it must not acquire a second UI.
  if (new URLSearchParams(services.window?.location?.search || '').get('embed') === '1')
    return () => {};

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
  tabs.setAttribute('role', 'tablist');
  tabs.className = 'gev-playground-tabs';
  const body = doc.createElement('div');
  body.className = 'gev-playground-body';
  body.id = 'planet-playground-content';
  body.tabIndex = 0;
  body.setAttribute('role', 'tabpanel');
  panel.append(header, tabs, body);

  let opened = false;
  let activeId = null;
  let disposeFeature = null;
  let disposed = false;
  const buttons = [];
  const removeTabListeners = [];
  // One keyboard tab stop follows focus, not the currently mounted mode.
  function setTabStop(target) {
    for (const button of buttons)
      button.tabIndex = button === target ? 0 : -1;
  }
  // A failing feature cleanup must not trap the shell in its previous mode.
  // Only the feature can guarantee that its partially released resources are safe.
  function releaseFeature() {
    const cleanup = disposeFeature;
    disposeFeature = null;
    activeId = null;
    try {
      cleanup?.();
    } catch (error) {
      console.error('Planet Playground mode cleanup failed:', error);
    }
  }
  function select(id) {
    // Hidden tabs remain script-clickable; only an open shell may mount modes.
    if (disposed || !opened) return;
    const feature = features.find((entry) => entry.id === id);
    if (!feature || activeId === id) return;
    releaseFeature();
    activeId = id;
    body.replaceChildren();
    body.setAttribute('aria-label', feature.title);
    const activeTab = buttons.find((button) => button.dataset.mode === id);
    if (activeTab) body.setAttribute('aria-labelledby', activeTab.id);
    for (const button of buttons) {
      const selected = button.dataset.mode === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    try {
      disposeFeature = feature.mount({
        root: body,
        services: { ...services, Cesium },
      }) || null;
    } catch (error) {
      // Retry the same tab after a transient mount failure.
      activeId = null;
      const problem = doc.createElement('p');
      problem.textContent = 'This mode could not open. Other modes remain available.';
      body.replaceChildren(problem);
      console.error('Planet Playground mode failed:', feature.id, error);
    }
  }
  function setOpen(next) {
    if (disposed) return;
    opened = Boolean(next);
    panel.hidden = !opened;
    launcher.setAttribute('aria-expanded', String(opened));
    if (opened) {
      select(activeId || features[0].id);
      close.focus();
    } else {
      // An inactive mode never keeps live camera, timers or presence listeners.
      releaseFeature();
      launcher.focus();
    }
  }
  for (const [index, feature] of features.entries()) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.mode = feature.id;
    button.id = `planet-playground-tab-${index}`;
    button.textContent = feature.title;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', body.id);
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    const onSelect = () => {
      if (disposed || !opened) return;
      // A click on the already-active tab also restores its keyboard stop.
      setTabStop(button);
      select(feature.id);
    };
    // Focus-only navigation: keyboard browsing must not join a room.
    const onTabKeydown = (event) => {
      if (
        disposed || !opened || panel.hidden || event.defaultPrevented ||
        event.altKey || event.ctrlKey || event.metaKey
      ) return;
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft')
        next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      setTabStop(buttons[next]);
      buttons[next].focus();
    };
    button.addEventListener('click', onSelect);
    button.addEventListener('keydown', onTabKeydown);
    removeTabListeners.push(() => {
      button.removeEventListener('click', onSelect);
      button.removeEventListener('keydown', onTabKeydown);
    });
    tabs.append(button);
    buttons.push(button);
  }
  const onLauncherClick = () => setOpen(!opened);
  const onCloseClick = () => setOpen(false);
  launcher.addEventListener('click', onLauncherClick);
  close.addEventListener('click', onCloseClick);
  const onKeydown = (event) => {
    if (event.key === 'Escape' && opened && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false);
    }
  };
  doc.addEventListener('keydown', onKeydown);
  doc.body.append(launcher, panel);
  return () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('keydown', onKeydown);
    launcher.removeEventListener('click', onLauncherClick);
    close.removeEventListener('click', onCloseClick);
    for (const remove of removeTabListeners) remove();
    try {
      releaseFeature();
    } finally {
      opened = false;
      panel.remove();
      launcher.remove();
    }
  };
}
