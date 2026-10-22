import { LOOK_PACKS } from '../lookPacks.js';
import {
  createLookManifest,
  parseLookManifest,
  serializeLookManifest,
} from '../lookManifest.js';

/**
 * A thin joy layer over GEV's existing shader engine and Cesium camera.
 * All changes are explicit; no background animation or resource holders.
 */
export const LOOKS = Object.freeze([
  ['normal', 'Original'],
  ['surveillance', 'Night Vision'],
  ['thermal', 'FLIR'],
  ['retro', 'CRT'],
  ['anime', 'Anime'],
  ['noir', 'Noir'],
  ['snow', 'Snow'],
]);
export const DESTINATIONS = Object.freeze([
  { title: 'Iceland Highlands', lat: 64.9, lon: -18.4, altitude: 250000 },
  { title: 'Himalayan Peaks', lat: 27.98, lon: 86.92, altitude: 110000 },
  { title: 'Great Barrier Reef', lat: -18.28, lon: 147.69, altitude: 180000 },
  { title: 'Sahara Dunes', lat: 24.6, lon: 13.7, altitude: 180000 },
  { title: 'Andean Plateau', lat: -22.8, lon: -67.8, altitude: 200000 },
]);
export function chooseDestination(random = Math.random) {
  const n = Number(random());
  const index = Number.isFinite(n)
    ? Math.max(0, Math.min(DESTINATIONS.length - 1, Math.floor(n * DESTINATIONS.length)))
    : 0;
  return DESTINATIONS[index];
}
export const feature = {
  id: 'toybox',
  title: 'Toybox',
  mount({ root, services }) {
    const doc = root.ownerDocument;
    const { viewer, styleManager, Cesium } = services;
    const title = doc.createElement('h3');
    title.textContent = 'Planet Toybox';
    const description = doc.createElement('p');
    description.textContent = 'Reimagine Earth with built-in creative color grades. Filters never change the underlying data; cinematic grades are session-only.';
    const lookTitle = doc.createElement('p');
    lookTitle.textContent = 'Pick a sensor lens';
    const looks = doc.createElement('div');
    looks.className = 'gev-playground-actions';
    const readout = doc.createElement('p');
    readout.setAttribute('role', 'status');
    readout.className = 'gev-playground-status';
    const startPose = {
      destination: Cesium.Cartesian3.clone(viewer.camera.positionWC),
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    };
    for (const [id, label] of LOOKS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        services.lookPacks?.clearGrade();
        styleManager.setStyle(id, { applyPreset: true, userInitiated: true });
        syncComparison();
        readout.textContent = label + ' lens active.';
      });
      looks.append(button);
    }

    const galleryTitle = doc.createElement('p');
    galleryTitle.textContent = 'Visual Universe · creative looks';
    const gallery = doc.createElement('div');
    gallery.className = 'gev-playground-look-gallery';
    for (const pack of LOOK_PACKS) {
      const card = doc.createElement('button');
      card.type = 'button';
      card.className = 'gev-playground-card';
      card.dataset.lookPack = pack.id;
      card.setAttribute('aria-label', 'Choose ' + pack.title);
      const title = doc.createElement('strong');
      title.textContent = pack.title;
      const subtitle = doc.createElement('span');
      subtitle.textContent = pack.family + ' · ' + pack.description;
      card.append(title, subtitle);
      card.addEventListener('click', () => {
        const applied = services.lookPacks?.apply(pack.id) || false;
        readout.textContent = applied
          ? pack.title + ' active. Artistic color only; not an observed-data transformation.'
          : 'This creative look is unavailable on the current renderer.';
      });
      card.setAttribute('aria-pressed', String(services.lookPacks?.activeId === pack.id));
      gallery.append(card);
    }
    const comparison = doc.createElement('div');
    comparison.className = 'gev-playground-compare';
    const compareLabel = doc.createElement('label');
    compareLabel.textContent = 'Compare creative grade vs base lens';
    const compareValue = doc.createElement('span');
    const compareSlider = doc.createElement('input');
    compareSlider.type = 'range';
    compareSlider.min = '0';
    compareSlider.max = '100';
    compareSlider.step = '1';
    compareSlider.setAttribute('aria-label', 'Creative image reveal percentage');
    compareLabel.append(compareSlider, compareValue);
    comparison.append(compareLabel);
    function syncComparison() {
      const selected = services.lookPacks?.activePack;
      comparison.hidden = !selected?.grade;
      const percentage = Math.round((services.lookPacks?.reveal ?? 1) * 100);
      compareSlider.value = String(percentage);
      compareValue.textContent = percentage + '% creative on left';
    }
    compareSlider.addEventListener('input', () => {
      const percent = Number(compareSlider.value);
      if (services.lookPacks?.setReveal(percent / 100)) {
        syncComparison();
        readout.textContent = percent + '% creative on left; right shows the ungraded ' +
          styleManager.activeStyle + ' base lens.';
      }
    });
    // The persistent Creative chip and native style controls live outside Toybox.
    // Keep their active look, pressed gallery card, and comparison UI in sync.
    function syncLookState() {
      const active = services.lookPacks?.activePack;
      for (const card of gallery.querySelectorAll('[data-look-pack]'))
        card.setAttribute('aria-pressed', String(card.dataset.lookPack === active?.id));
      syncComparison();
      readout.textContent = active?.grade
        ? 'Creative look: ' + active.title + ' (reset any time).'
        : active?.id === 'original'
          ? 'Original Earth lens active.'
          : 'Current lens: ' + (styleManager.activeStyle || 'normal') + '.';
    }
    const unsubscribeLookState = services.lookPacks?.subscribe(syncLookState);
    const lab = doc.createElement('details');
    lab.className = 'gev-playground-look-lab';
    const labTitle = doc.createElement('summary');
    labTitle.textContent = 'Local Look Lab · remix and share JSON';
    const labNote = doc.createElement('p');
    labNote.textContent = 'Data-only creative presets. Nothing is uploaded or executed.';
    const authorLabel = doc.createElement('label');
    authorLabel.textContent = 'Author credit for a new remix';
    const authorInput = doc.createElement('input');
    authorInput.type = 'text';
    authorInput.maxLength = 80;
    authorInput.placeholder = 'Your display name';
    authorInput.setAttribute('aria-label', 'Look author credit');
    authorLabel.append(authorInput);
    const fileLabel = doc.createElement('label');
    fileLabel.textContent = 'Editable local JSON (4 KB maximum)';
    const jsonArea = doc.createElement('textarea');
    jsonArea.rows = 6;
    jsonArea.maxLength = 4096;
    jsonArea.spellcheck = false;
    jsonArea.setAttribute('aria-label', 'Look manifest JSON');
    fileLabel.append(jsonArea);
    const labActions = doc.createElement('div');
    labActions.className = 'gev-playground-actions';
    const exportButton = doc.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export current';
    const importButton = doc.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Apply local JSON';
    exportButton.addEventListener('click', () => {
      try {
        const selected = services.lookPacks?.activePack;
        if (!selected?.grade) {
          readout.textContent = 'Choose a creative look before exporting.';
          return;
        }
        const manifest = selected.author
          ? selected
          : createLookManifest(selected, authorInput.value.trim());
        jsonArea.value = serializeLookManifest(manifest);
        jsonArea.focus();
        jsonArea.select();
        readout.textContent = 'Local look JSON ready to copy. Author credit preserved.';
      } catch {
        readout.textContent = 'Enter an author name to create a credited remix.';
      }
    });
    importButton.addEventListener('click', () => {
      try {
        const manifest = parseLookManifest(jsonArea.value);
        if (!services.lookPacks?.applyVerifiedManifest(manifest))
          throw new TypeError('Unsupported base lens');
        readout.textContent = 'Creative remix "' + manifest.title + '" by ' +
          manifest.author.name + ' active. Original Earth resets it.';
      } catch {
        readout.textContent = 'Look JSON was rejected; current view is unchanged.';
      }
    });
    labActions.append(exportButton, importButton);
    lab.append(labTitle, labNote, authorLabel, fileLabel, labActions);
    const actions = doc.createElement('div');
    actions.className = 'gev-playground-actions';
    const surprise = doc.createElement('button');
    surprise.type = 'button';
    surprise.textContent = 'Surprise me';
    const back = doc.createElement('button');
    back.type = 'button';
    back.textContent = 'Return to start';
    actions.append(surprise, back);
    let ownedFlight = false;
    function fly(destination, orientation) {
      ownedFlight = true;
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({
        destination,
        orientation,
        duration: doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2.5,
        complete: () => { ownedFlight = false; },
        cancel: () => { ownedFlight = false; },
      });
    }
    surprise.addEventListener('click', () => {
      const destination = chooseDestination();
      fly(
        Cesium.Cartesian3.fromDegrees(
          destination.lon, destination.lat, destination.altitude,
        ),
        { heading: 0, pitch: Cesium.Math.toRadians(-63), roll: 0 },
      );
      readout.textContent = 'Exploring ' + destination.title + '.';
    });
    back.addEventListener('click', () => {
      fly(startPose.destination, {
        heading: startPose.heading,
        pitch: startPose.pitch,
        roll: startPose.roll,
      });
      readout.textContent = 'Returning to your starting view.';
    });
    root.append(title, description, galleryTitle, gallery, comparison, lab, lookTitle, looks, actions, readout);
    syncLookState();
    return () => {
      unsubscribeLookState?.();
      if (ownedFlight) viewer.camera.cancelFlight();
    };
  },
};
