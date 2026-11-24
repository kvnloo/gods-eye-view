/**
 * Situation mode is opt-in: `?situation=1` opens the page in it (a TV or
 * wall display), and the set_situation_mode action turns it on or off.
 */
export function readSituationConfig({ location = globalThis.location } = {}) {
  const params = new URLSearchParams(location?.search || '');
  const value = params.get('situation');
  return { enabled: value === '1' || value === 'true' || value === 'on' };
}
