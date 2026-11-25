// FORK-ONLY experiment (exp/city-postcard): the "Cozy postcard" reality mode,
// behind ?postcard=1. Capture the current view, send it with a prompt through
// the local image bridge (#312, POST /api/city-concept, dev-only), and show the
// answer over the capture with a compare wipe and an AI LOOK · NOT EVIDENCE chip.
// Pure: the prompt, the request body and the wipe, so they test without a page.
//
// Every countable in the prompt comes from the app's own massing model
// (window.__gevCityMassing.snapshot().massing, i.e. plotMassing() in
// src/data/cityMassing.js); nothing is typed in by hand. The postcard is a
// look, never a plan, a measurement or an approval.

export const POSTCARD_ROUTE = '/api/city-concept';
export const POSTCARD_LABEL = 'AI LOOK · NOT EVIDENCE';
/** The bridge's own request and image limits (server/standalone/city-concept.js). */
export const POSTCARD_REQUEST_LIMIT = 1024 * 1024;
export const POSTCARD_IMAGE_LIMIT = 600_000;

/** Whether ?postcard=1 is on in a location search string. */
export function postcardFlag(search = '') {
  return new URLSearchParams(search ?? '').get('postcard') === '1';
}

const STYLE = `Edit this screenshot of a 3D map app into a frame from a cozy stylised city-builder video game.
Keep the camera, framing, perspective, street grid, shoreline and every building's position, footprint and
relative height exactly; only the look changes. Look: painterly LOW-POLY, chunky simplified buildings with
flat-shaded facets and tidy window rows; dense clumps of dark-green faceted pines and rounded low-poly trees;
lush saturated grass with soft painterly brush texture; vivid greens, luminous teal water, cream plaster and
terracotta roofs, soft lilac shadows; soft warm sun with soft global illumination and gentle ambient
occlusion, light bloom, warm haze far away, tilt-shift depth of field. A stylised game, NOT a photograph and
NOT a photo of a miniature model. Remove every user-interface overlay, label and credit and paint the world
beneath. Draw no text, numbers, logos or UI.`;

function whole(n) {
  return Number.isInteger(n) && n > 0;
}

/**
 * The proposed block's countables, from a massing snapshot, or null when none
 * is shown. Throws on an inconsistent model rather than describing it.
 */
export function postcardFacts(snapshot) {
  const m = snapshot?.shown ? snapshot.massing : null;
  if (!m) return null;
  const { storeys, storeyHeightMeters, heightMeters, setbackMeters } = m;
  if (!whole(storeys))
    throw new TypeError('massing storeys must be a whole number');
  if (Math.abs(heightMeters - storeys * storeyHeightMeters) > 0.05)
    throw new TypeError('massing height disagrees with its storeys');
  const side = Math.sqrt(m.footprintAreaSquareMeters ?? NaN);
  const plotSide = Math.sqrt(m.plotAreaSquareMeters ?? NaN);
  if (!Number.isFinite(side) || !Number.isFinite(plotSide) || side >= plotSide)
    throw new TypeError('massing footprint must sit inside its plot');
  return Object.freeze({
    storeys,
    upperFloors: storeys - 1,
    heightMeters: Math.round(heightMeters * 10) / 10,
    footprintMeters: Math.round(side),
    plotMeters: Math.round(plotSide),
    setbackMeters,
  });
}

/** The prompt for one capture: the style plus, when a block stands, its countables. */
export function postcardPrompt(facts = null) {
  if (!facts) return STYLE;
  const f = facts;
  return `${STYLE}
The proposed new building at the centre of the selected plot has exactly ${f.storeys} storeys counting the
ground floor (a ground floor plus exactly ${f.upperFloors} rows of windows above it), about ${f.heightMeters} m
tall, a flat roof, and a square footprint of ${f.footprintMeters} m x ${f.footprintMeters} m centred on its
${f.plotMeters} m x ${f.plotMeters} m plot with a ${f.setbackMeters} m strip of ground all round. Keep it the only
new building.`;
}

/** The bridge request body, or a TypeError when it would exceed the bridge's limit. */
export function postcardRequest(prompt, image) {
  if (typeof prompt !== 'string' || !prompt.trim())
    throw new TypeError('postcard prompt required');
  if (
    typeof image !== 'string' ||
    !/^data:image\/(png|jpeg);base64,/.test(image)
  )
    throw new TypeError('postcard capture must be a PNG or JPEG data URL');
  const body = JSON.stringify({ prompt, image });
  if (new TextEncoder().encode(body).length > POSTCARD_REQUEST_LIMIT)
    throw new TypeError('postcard request exceeds the bridge limit');
  return body;
}

/** The bridge answer's image, checked like the concept generator checks it. */
export function postcardAnswer(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Object.keys(payload).length !== 2 ||
    payload.provider !== 'local' ||
    typeof payload.image !== 'string' ||
    payload.image.length > POSTCARD_IMAGE_LIMIT ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.image)
  )
    throw new TypeError('invalid postcard answer');
  return payload.image;
}

/** The compare wipe as a 0..1 share of the width: left of it is the capture. */
export function clampWipe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/** Why a postcard failed, as a short user-facing line (never provider text). */
export function postcardError(status) {
  if (status === 404 || status === 403)
    return 'Postcard needs the local image bridge (dev server with GEV_CITY_CONCEPT_LOCAL=1).';
  if (status === 409) return 'The image bridge is busy; try again in a moment.';
  if (status === 'capture')
    return 'Could not capture this view yet; wait for the map to finish loading.';
  return 'The postcard could not be made.';
}
