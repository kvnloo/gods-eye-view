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
    description.textContent = 'Reskin Earth, fly somewhere surprising, and keep the look in your normal shareable view.';
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
        styleManager.setStyle(id, { applyPreset: true, userInitiated: true });
        readout.textContent = label + ' lens active.';
      });
      looks.append(button);
    }
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
    root.append(title, description, lookTitle, looks, actions, readout);
    readout.textContent = 'Current lens: ' + (styleManager.activeStyle || 'normal') + '.';
    return () => {
      if (ownedFlight) viewer.camera.cancelFlight();
    };
  },
};
