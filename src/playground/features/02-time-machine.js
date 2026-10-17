/**
 * Clock scrubber for authored SceneDirector time, not a fabricated global time feed.
 */
export function clampSceneProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}
export function playableScenes(sceneDirector) {
  return (sceneDirector?.listScenes?.() || []).filter((scene) =>
    typeof scene.id === 'string' && Number(scene.shots) > 0,
  );
}
export const feature = {
  id: 'time-machine',
  title: 'Time Machine',
  mount({ root, services }) {
    const doc = root.ownerDocument;
    const title = doc.createElement('h3');
    title.textContent = 'Rewind an authored scene';
    const description = doc.createElement('p');
    description.textContent = 'Step through observed evidence and camera states. This is a scene clock, not a universal historical data feed.';
    const scenes = playableScenes(services.sceneDirector);
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Scene to explore');
    select.style.width = '100%';
    for (const scene of scenes) {
      const option = doc.createElement('option');
      option.value = scene.id;
      option.textContent = scene.title + ' · ' + scene.shots + ' beats';
      select.append(option);
    }
    const nepal = scenes.find((scene) => /bhote|nepal/i.test(scene.title));
    if (nepal) select.value = nepal.id;
    const slider = doc.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scene timeline percent');
    const progress = doc.createElement('p');
    progress.className = 'gev-playground-muted';
    progress.textContent = '0% · beginning';
    const actions = doc.createElement('div');
    actions.className = 'gev-playground-actions';
    const seek = doc.createElement('button');
    seek.type = 'button';
    seek.textContent = 'Jump to beat';
    const play = doc.createElement('button');
    play.type = 'button';
    play.textContent = 'Play scene';
    const stop = doc.createElement('button');
    stop.type = 'button';
    stop.textContent = 'Stop';
    actions.append(seek, play, stop);
    const notice = doc.createElement('p');
    notice.setAttribute('role', 'status');
    notice.className = 'gev-playground-status';
    notice.textContent = scenes.length ? 'Choose a point, then jump.' : 'No authored scenes are available.';
    select.disabled = !scenes.length;
    seek.disabled = !scenes.length;
    play.disabled = !scenes.length;
    let alive = true;
    let playbackOwned = false;
    let seekCounter = 0;
    slider.addEventListener('input', () => {
      progress.textContent = slider.value + '% · authored scene clock';
    });
    seek.addEventListener('click', async () => {
      const generation = ++seekCounter;
      notice.textContent = 'Seeking…';
      try {
        const ok = await services.sceneDirector.seekScene(
          select.value,
          clampSceneProgress(Number(slider.value) / 100),
        );
        if (alive && generation === seekCounter)
          notice.textContent = ok ? 'Scene state loaded.' : 'This point is unavailable.';
      } catch (error) {
        if (alive && generation === seekCounter)
          notice.textContent = 'Seek failed: ' + String(error.message || error);
      }
    });
    play.addEventListener('click', async () => {
      if (services.sceneDirector.running) {
        notice.textContent = 'A scene is already playing.';
        return;
      }
      playbackOwned = true;
      notice.textContent = 'Playing authored scene…';
      try {
        const result = await services.sceneDirector.startScene(select.value, {
          single: true,
          preview: false,
        });
        if (alive)
          notice.textContent = result.started ? 'Playback complete.' : 'Playback ended: ' + (result.reason || 'cancelled');
      } catch (error) {
        if (alive) notice.textContent = 'Playback failed: ' + String(error.message || error);
      }
    });
    stop.addEventListener('click', () => {
      services.sceneDirector.stopScene('Stopped from Time Machine');
      playbackOwned = false;
      notice.textContent = 'Stopped.';
    });
    if (scenes.length) root.append(title, description, select, slider, progress, actions, notice);
    else root.append(title, description, notice);
    return () => {
      alive = false;
      seekCounter++;
      if (playbackOwned && services.sceneDirector.running)
        services.sceneDirector.stopScene('Time Machine closed');
    };
  },
};
