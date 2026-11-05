/**
 * Expedition cards compose existing GEV scenes and public-data layers.
 * No new incident data is manufactured here.
 */
export const MISSIONS = Object.freeze([
  {
    id: 'nepal',
    title: 'Nepal · Bhote Koshi',
    description: 'Walk through the authored flood evidence sequence.',
    sceneQuery: 'Bhote Koshi',
  },
  {
    id: 'wildfire',
    title: 'California · Fire scout',
    description: 'Explore terrain and available current fire observations. Not a historic replay.',
    camera: { lat: 39.25, lon: -120.15, altitude: 260000 },
    layers: ['local-firms', 'fire-perimeters'],
  },
  {
    id: 'traffic',
    title: 'Austin · Traffic lab',
    description: 'Fly to Austin and inspect GEV’s simulated road traffic.',
    camera: { lat: 30.2672, lon: -97.7431, altitude: 30000 },
    layers: ['traffic'],
  },
]);

export function availableExpeditions(missions, sceneDirector) {
  return missions.map((mission) => {
    if (!mission.sceneQuery) return { ...mission, available: true };
    const scene = sceneDirector?.findSceneByQuery?.(mission.sceneQuery);
    return { ...mission, available: Boolean(scene), sceneId: scene?.id || null };
  });
}

export const feature = {
  id: 'expeditions',
  title: 'Expeditions',
  mount({ root, services }) {
    const doc = root.ownerDocument;
    const heading = doc.createElement('h3');
    heading.textContent = 'Choose an expedition';
    const intro = doc.createElement('p');
    intro.textContent = 'Fly to a mission, then investigate real public layers or authored evidence.';
    const status = doc.createElement('p');
    status.className = 'gev-playground-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Ready for launch.';
    root.append(heading, intro);
    let alive = true;
    let ownedScene = false;
    let ownedFlight = false;
    const choices = availableExpeditions(MISSIONS, services.sceneDirector);
    for (const mission of choices) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'gev-playground-card';
      const title = doc.createElement('strong');
      title.textContent = mission.title;
      const detail = doc.createElement('span');
      detail.textContent = mission.available ? mission.description : 'Required authored scene unavailable in this project.';
      button.append(title, detail);
      button.disabled = !mission.available;
      button.addEventListener('click', async () => {
        if (!alive) return;
        button.disabled = true;
        status.textContent = 'Opening ' + mission.title + '…';
        try {
          if (mission.sceneId) {
            ownedScene = true;
            const outcome = await services.sceneDirector.startScene(mission.sceneId, {
              single: true,
              preview: false,
            });
            if (alive)
              status.textContent = outcome.started
                ? 'Expedition complete. Explore the evidence in the scene panel.'
                : 'Scene did not start: ' + (outcome.reason || 'unavailable');
          } else {
            if (ownedScene && services.sceneDirector.running)
              services.sceneDirector.stopScene('Switching expedition');
            ownedScene = false;
            services.viewer.trackedEntity = undefined;
            ownedFlight = true;
            services.viewer.camera.flyTo({
              destination: services.Cesium.Cartesian3.fromDegrees(
                mission.camera.lon,
                mission.camera.lat,
                mission.camera.altitude,
              ),
              orientation: {
                heading: 0,
                pitch: services.Cesium.Math.toRadians(-55),
                roll: 0,
              },
              duration: 2.5,
              complete: () => { ownedFlight = false; },
              cancel: () => { ownedFlight = false; },
            });
            const requestedLayers = (mission.layers || []).filter((id) =>
              services.dataManager.layers.has(id),
            );
            await Promise.all(requestedLayers.map((id) =>
              services.dataManager.setEnabled(id, true, { origin: 'user' }),
            ));
            if (alive)
              status.textContent = 'Arrived. Requested: ' +
                (requestedLayers.join(', ') || 'terrain only') +
                '. Feed freshness is shown by each layer.';
          }
        } catch (error) {
          if (alive) status.textContent = 'Expedition unavailable: ' + String(error.message || error);
        } finally {
          if (alive) button.disabled = false;
        }
      });
      root.append(button);
    }
    root.append(status);
    return () => {
      alive = false;
      if (ownedScene && services.sceneDirector.running)
        services.sceneDirector.stopScene('Expedition view closed');
      if (ownedFlight) services.viewer.camera.cancelFlight();
    };
  },
};
