/**
 * Source-first historical place lens for the Planet Playground Time Machine.
 * The Cesium globe stays modern; OpenHistoricalMap owns its dated cartography.
 * No historic imagery, person location, or first-person experience is inferred.
 */
export const EARLIEST_MAP_YEAR = -4000;

// NPS documents residence at this site, not the person's exact whereabouts on
// any chosen day or what they saw. Coordinates point to the present-day site.
export const HISTORICAL_PLACES = Object.freeze([
  Object.freeze({
    id: 'douglass-cedar-hill',
    title: 'Frederick Douglass · Cedar Hill',
    lat: 38.863,
    lon: -76.9851,
    year: 1880,
    associatedFrom: 1878,
    associatedUntil: 1895,
    context:
      'Documented residence, not a recording of his viewpoint or presence on a particular date.',
    sourceName: 'National Park Service · Frederick Douglass at Cedar Hill',
    sourceUrl: 'https://www.nps.gov/frdo/learn/historyculture/places.htm',
  }),
]);

export function historicalYear(
  value,
  currentYear = new Date().getUTCFullYear(),
) {
  const valueText =
    typeof value === 'number' && Number.isInteger(value)
      ? String(value)
      : value;
  if (typeof valueText !== 'string' || !/^-?\d{1,4}$/.test(valueText)) {
    throw new TypeError(
      'Enter a whole year, using a negative number for BCE.',
    );
  }
  const year = Number(valueText);
  if (
    !Number.isSafeInteger(year) ||
    year === 0 ||
    year < EARLIEST_MAP_YEAR ||
    year > currentYear
  ) {
    throw new RangeError(
      'Choose a year from ' +
        EARLIEST_MAP_YEAR +
        ' through ' +
        currentYear +
        ', except year zero.',
    );
  }
  return year;
}

export function historicalPlaceView({
  lat,
  lon,
  year,
  zoom = 12,
  currentYear,
} = {}) {
  if (
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  ) {
    throw new TypeError('A valid latitude and longitude are required.');
  }
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 18) {
    throw new RangeError('Map zoom must be an integer from 1 to 18.');
  }
  const selectedYear = historicalYear(year, currentYear);
  const latitude = Number(lat.toFixed(5));
  const longitude = Number(lon.toFixed(5));
  const mapUrl =
    'https://www.openhistoricalmap.org/#map=' +
    zoom +
    '/' +
    latitude +
    '/' +
    longitude +
    '&date=' +
    selectedYear;
  return Object.freeze({
    lat: latitude,
    lon: longitude,
    year: selectedYear,
    yearLabel:
      selectedYear < 0
        ? -selectedYear + ' BCE'
        : selectedYear + ' CE',
    mapUrl,
    embedUrl:
      mapUrl.replace(
        'https://www.openhistoricalmap.org/',
        'https://embed.openhistoricalmap.org/',
      ) + '&layer=O',
    evidenceStatus: 'coverage-unverified',
    renderStatus:
      'Modern GEV globe; historical map available in a separate view',
  });
}

/**
 * A bounded, user-requested OHM animation. Only the third-party map renders
 * dated geography; modern Cesium terrain is never relabeled as historical.
 */
export function historicalAnimationView({
  lat,
  lon,
  fromYear,
  toYear,
  zoom = 12,
  currentYear,
} = {}) {
  const initial = historicalPlaceView({
    lat,
    lon,
    year: fromYear,
    zoom,
    currentYear,
  });
  const finalYear = historicalYear(toYear, currentYear);
  const distance = finalYear - initial.year;
  if (!distance) throw new RangeError('Choose two different historical years.');
  // OHM supports negative years, but the consumer UI has no year zero.
  // Do not silently invent a transition date across that boundary.
  if ((initial.year < 0) !== (finalYear < 0)) {
    throw new RangeError(
      'For BCE to CE comparisons, open the two years separately.',
    );
  }
  if (Math.abs(distance) > 300) {
    throw new RangeError(
      'Choose a historical window no longer than 300 years.',
    );
  }
  // At most approximately 40 frames, irrespective of the date span.
  const yearStep = Math.ceil(Math.abs(distance) / 40);
  const interval = (distance < 0 ? '-' : '') + 'P' + yearStep + 'Y';
  const base =
    'https://embed.openhistoricalmap.org/#map=' +
    zoom +
    '/' +
    initial.lat +
    '/' +
    initial.lon;
  return Object.freeze({
    fromYear: initial.year,
    toYear: finalYear,
    fromLabel: initial.yearLabel,
    toLabel:
      finalYear < 0 ? -finalYear + ' BCE' : finalYear + ' CE',
    embedUrl:
      base +
      '&start_date=' +
      initial.year +
      '&end_date=' +
      finalYear +
      '&interval=' +
      interval +
      '&framerate=2&layer=O',
    evidenceStatus: 'coverage-unverified',
  });
}

export function historicalPlaceAssociation(place, year, currentYear) {
  const selectedYear = historicalYear(year, currentYear);
  if (
    !place ||
    selectedYear < place.associatedFrom ||
    selectedYear > place.associatedUntil
  ) {
    return null;
  }
  return Object.freeze({
    label: place.title,
    status: 'documented-residence',
    sourceName: place.sourceName,
    sourceUrl: place.sourceUrl,
    caveat: place.context,
  });
}

function centerCoordinates(services) {
  const { Cesium, viewer } = services;
  const canvas = viewer.scene.canvas;
  const point = viewer.camera.pickEllipsoid(
    new Cesium.Cartesian2(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    ),
    Cesium.Ellipsoid.WGS84,
  );
  if (!point) return null;
  const c = Cesium.Cartographic.fromCartesian(point);
  return {
    lat: Cesium.Math.toDegrees(c.latitude),
    lon: Cesium.Math.toDegrees(c.longitude),
  };
}

/** Mounts a small independent lens, never modifying live feed clocks or layers. */
export function mountHistoricalEarthLens({ root, services }) {
  const doc = root.ownerDocument;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', 'Historical Earth');
  const heading = doc.createElement('h3');
  heading.textContent = 'Historical Earth · place + year';
  const intro = doc.createElement('p');
  intro.textContent =
    'Find dated map evidence for any globe location. GEV terrain remains present-day, not a reconstruction.';

  const sample = HISTORICAL_PLACES[0];
  const yearLabel = doc.createElement('label');
  yearLabel.textContent = 'Year (negative for BCE)';
  const yearInput = doc.createElement('input');
  yearInput.type = 'number';
  yearInput.min = String(EARLIEST_MAP_YEAR);
  yearInput.max = String(new Date().getUTCFullYear());
  yearInput.step = '1';
  yearInput.value = String(sample.year);
  yearInput.setAttribute('aria-label', 'Historical year');
  yearLabel.append(yearInput);
  const compareLabel = doc.createElement('label');
  compareLabel.textContent = 'Compare with year';
  const compareInput = doc.createElement('input');
  compareInput.type = 'number';
  compareInput.min = String(EARLIEST_MAP_YEAR);
  compareInput.max = String(new Date().getUTCFullYear());
  compareInput.step = '1';
  compareInput.value = String(sample.year + 20);
  compareInput.setAttribute('aria-label', 'Historical comparison year');
  compareLabel.append(compareInput);

  const actions = doc.createElement('div');
  actions.className = 'gev-playground-actions';
  const siteButton = doc.createElement('button');
  siteButton.type = 'button';
  siteButton.textContent = 'Visit documented site';
  const centerButton = doc.createElement('button');
  centerButton.type = 'button';
  centerButton.textContent = 'Use globe center';
  const previewButton = doc.createElement('button');
  previewButton.type = 'button';
  previewButton.textContent = 'Preview dated map';
  const animateButton = doc.createElement('button');
  animateButton.type = 'button';
  animateButton.textContent = 'Animate years';
  actions.append(siteButton, centerButton, previewButton, animateButton);

  const context = doc.createElement('p');
  context.className = 'gev-playground-muted';
  const mapLink = doc.createElement('a');
  mapLink.textContent = 'Explore year on OpenHistoricalMap ↗';
  mapLink.target = '_blank';
  mapLink.rel = 'noopener noreferrer';
  const sourceLink = doc.createElement('a');
  sourceLink.textContent = sample.sourceName + ' ↗';
  sourceLink.href = sample.sourceUrl;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  const sources = doc.createElement('p');
  sources.append(sourceLink);
  const frame = doc.createElement('iframe');
  frame.title = 'OpenHistoricalMap · dated historical features';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.style.width = '100%';
  frame.style.height = '280px';
  frame.style.border = '1px solid rgba(123, 211, 181, 0.3)';
  frame.hidden = true;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.className = 'gev-playground-status';

  let coords = { lat: sample.lat, lon: sample.lon };
  let selectedPlace = sample;
  let ownsFlight = false;
  let flightGeneration = 0;
  let previewMode = null;

  function closePreview() {
    if (!frame.hidden) frame.removeAttribute('src');
    frame.hidden = true;
    previewMode = null;
    previewButton.textContent = 'Preview dated map';
    animateButton.textContent = 'Animate years';
  }

  function update() {
    closePreview();
    try {
      const view = historicalPlaceView({
        ...coords,
        year: yearInput.value,
      });
      mapLink.href = view.mapUrl;
      mapLink.hidden = false;
      previewButton.disabled = false;
      try {
        historicalAnimationView({
          ...coords,
          fromYear: yearInput.value,
          toYear: compareInput.value,
        });
        animateButton.disabled = false;
      } catch {
        animateButton.disabled = true;
      }
      const association =
        selectedPlace &&
        historicalPlaceAssociation(selectedPlace, view.year);
      context.textContent = association
        ? association.label + ' · ' + association.caveat
        : 'Custom location/year · no person-specific perspective verified.';
      sources.hidden = !association;
      status.textContent =
        view.yearLabel +
        ' · ' +
        view.lat +
        ', ' +
        view.lon +
        '. Historical coverage is not verified. The GEV globe is modern.';
    } catch (error) {
      mapLink.removeAttribute('href');
      mapLink.hidden = true;
      previewButton.disabled = true;
      animateButton.disabled = true;
      sources.hidden = true;
      context.textContent = '';
      status.textContent = error.message;
    }
  }

  siteButton.addEventListener('click', () => {
    if (services.sceneDirector?.running) {
      status.textContent = 'Stop the authored scene before moving the camera.';
      return;
    }
    coords = { lat: sample.lat, lon: sample.lon };
    selectedPlace = sample;
    yearInput.value = String(sample.year);
    compareInput.value = String(sample.year + 20);
    const generation = ++flightGeneration;
    ownsFlight = true;
    services.viewer.trackedEntity = undefined;
    services.viewer.camera.flyTo({
      destination: services.Cesium.Cartesian3.fromDegrees(
        sample.lon,
        sample.lat,
        1600,
      ),
      orientation: {
        heading: 0,
        pitch: services.Cesium.Math.toRadians(-50),
        roll: 0,
      },
      duration: 2,
      complete: () => {
        if (generation === flightGeneration) ownsFlight = false;
      },
      cancel: () => {
        if (generation === flightGeneration) ownsFlight = false;
      },
    });
    update();
  });

  centerButton.addEventListener('click', () => {
    const picked = centerCoordinates(services);
    if (!picked) {
      status.textContent =
        'No globe intersection at the crosshair. Zoom out and retry.';
      return;
    }
    coords = picked;
    selectedPlace = null;
    update();
  });
  function openPreview(mode) {
    if (previewMode === mode) {
      closePreview();
      return;
    }
    closePreview();
    try {
      const url =
        mode === 'animate'
          ? historicalAnimationView({
              ...coords,
              fromYear: yearInput.value,
              toYear: compareInput.value,
            }).embedUrl
          : historicalPlaceView({
              ...coords,
              year: yearInput.value,
            }).embedUrl;
      frame.src = url;
      frame.hidden = false;
      previewMode = mode;
      if (mode === 'animate')
        animateButton.textContent = 'Close animation';
      else previewButton.textContent = 'Close dated map';
      status.textContent =
        'Third-party OpenHistoricalMap preview. Historical coverage can be incomplete; ' +
        'the GEV globe remains present-day terrain.';
    } catch (error) {
      status.textContent = error.message;
    }
  }
  previewButton.addEventListener('click', () => openPreview('year'));
  animateButton.addEventListener('click', () => openPreview('animate'));
  yearInput.addEventListener('input', update);
  compareInput.addEventListener('input', update);
  section.append(
    heading,
    intro,
    yearLabel,
    compareLabel,
    actions,
    context,
    sources,
    mapLink,
    frame,
    status,
  );
  root.append(section);
  update();
  return () => {
    closePreview();
    if (ownsFlight) {
      flightGeneration++;
      ownsFlight = false;
      services.viewer.camera.cancelFlight();
    }
    section.remove();
  };
}

