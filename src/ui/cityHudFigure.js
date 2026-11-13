// One formatter for every number the City builder play HUD shows. The rules
// come from the City builder design loop: an estimate carries EST, and one
// with false precision (two or more decimals) is cut to two significant
// figures behind "~"; a change reads before → after; an unknown value is no
// figure at all, so a placeholder can never be dressed up as one.
import { formatNumber, t } from '../i18n/index.js';

const UNITS = {
  m: (value) => t('{value} m', { value }),
  'm²': (area) => t('{area} m²', { area }),
  '%': (value) => `${value}%`,
};
const known = (value) => typeof value === 'number' && Number.isFinite(value);

function digits(value, estimate) {
  return estimate && Math.round(value * 10) / 10 !== value
    ? `~${formatNumber(Number(value.toPrecision(2)))}`
    : formatNumber(value, { maximumFractionDigits: 20 });
}

/**
 * The text of one HUD figure, without its label.
 * @param {object} figure
 * @param {number|null} [figure.value] Raw value; anything but a finite number is unknown.
 * @param {number|null} [figure.before] Raw value before the change, when the app holds one.
 * @param {string} [figure.unit] 'm', 'm²', '%' or any other unit text.
 * @param {boolean} [figure.estimate] True for a modelled, assumed or proposed value.
 * @returns {string|null} null when there is no figure to draw.
 */
export function hudFigure({
  value,
  before = null,
  unit = '',
  estimate = false,
} = {}) {
  if (!known(value)) return null;
  const after = digits(value, estimate);
  const from = known(before) ? digits(before, estimate) : after;
  // An equal pair is not a change: the plain value says it.
  const text = from === after ? after : `${from} → ${after}`;
  const withUnit = UNITS[unit]?.(text) ?? (unit ? `${text} ${unit}` : text);
  return estimate
    ? `${withUnit} ${t('EST', { context: 'estimated value' })}`
    : withUnit;
}
