import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

// Consume the opt-in local bridge secret before providers or navigation load.
const ternUrl = new URL(window.location.href);
const ternPort = ternUrl.searchParams.get('gevTernPort');
const ternToken = ternUrl.searchParams.get('gevTernToken');
if (ternPort !== null || ternToken !== null) {
  ternUrl.searchParams.delete('gevTernPort');
  ternUrl.searchParams.delete('gevTernToken');
  window.history.replaceState(window.history.state, '', ternUrl);
}

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application
  .start()
  .then((components) => {
    if (ternPort && ternToken)
      void import('./tern/browserBridge.js')
        .then(({ connectTernBridge }) =>
          connectTernBridge({
            application,
            components,
            port: ternPort,
            token: ternToken,
          }),
        )
        .catch((error) => console.warn('[GEV Tern]', error.message));
  })
  .catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector('#loading-screen .loader-status');
    loaderStatus.textContent = 'Error: ' + describeError(error);
    loaderStatus.style.color = '#ff4444';
  });

export { application };
