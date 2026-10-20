import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

// Development-only opt-in: the experiment never intercepts production sessions.
const steadySplatsLab = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('experiment') === 'steadysplats';

const application = steadySplatsLab ? null : createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

if (steadySplatsLab) {
  import('./experiments/steadysplats/demo.js')
    .then(({ startSteadySplatsExperiment }) => startSteadySplatsExperiment())
    .catch((error) => console.error('SteadySplats experiment failed:', error));
} else {
  application.start().catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector('#loading-screen .loader-status');
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  });
}

export { application };
