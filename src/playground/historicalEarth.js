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
    evidenceStatus: 'coverage-unverified',
    renderStatus:
      'Modern GEV globe; historical map available in a separate view',
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

  const actions = doc.createElement('div');
  actions.className = 'gev-playground-actions';
  const siteButton = doc.createElement('button');
  siteButton.type = 'button';
  siteButton.textContent = 'Visit documented site';
  const centerButton = doc.createElement('button');
  centerButton.type = 'button';
  centerButton.textContent = 'Use globe center';
  actions.append(siteButton, centerButton);

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
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.className = 'gev-playground-status';

  let coords = { lat: sample.lat, lon: sample.lon };
  let selectedPlace = sample;
  let ownsFlight = false;

  function update() {
    try {
      const view = historicalPlaceView({
        ...coords,
        year: yearInput.value,
      });
      mapLink.href = view.mapUrl;
      mapLink.hidden = false;
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
      sources.hidden = true;
      context.textContent = '';
      status.textContent = error.message;
    }
  }

  siteButton.addEventListener('click', () => {
    coords = { lat: sample.lat, lon: sample.lon };
    selectedPlace = sample;
    yearInput.value = String(sample.year);
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
        ownsFlight = false;
      },
      cancel: () => {
        ownsFlight = false;
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
  yearInput.addEventListener('input', update);
  section.append(
    heading,
    intro,
    yearLabel,
    actions,
    context,
    sources,
    mapLink,
    status,
  );
  root.append(section);
  update();
  return () => {
    if (ownsFlight) services.viewer.camera.cancelFlight();
    section.remove();
  };
}

