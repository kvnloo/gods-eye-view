// The label at the tip of a shadow line on the globe (the City builder design
// loop's tip block): how far the shadow reaches and what that does to the
// sidewalk across the street. Whole metres through the HUD's one figure
// formatter, with one EST closing the line.
import { t } from '../i18n/index.js';
import { hudFigure } from './cityHudFigure.js';

const REACH = {
  was: (reach) => t('SHADOW WAS {reach}', { reach }),
  now: (reach) => t('SHADOW NOW {reach}', { reach }),
  fit: (reach) => t('FIT TO SUN {reach}', { reach }),
};

/**
 * @param {{kind: 'was'|'now'|'fit', reachMeters: number|null, overMeters: number|null}} line
 *   A line of src/data/cityShadowFit.js.
 * @returns {string|null} null while the reach is unknown: nothing to draw.
 */
export function shadowTip(line) {
  if (!Number.isFinite(line?.reachMeters)) return null;
  const reach = hudFigure({ value: Math.round(line.reachMeters), unit: 'm' });
  const over = Math.round(line.overMeters);
  const edge =
    over > 0
      ? hudFigure({ value: over, unit: t('m ONTO SIDEWALK'), estimate: true })
      : t('CLEARS SIDEWALK BY {gap}', {
          gap: hudFigure({ value: Math.abs(over), unit: 'm', estimate: true }),
        });
  return `${REACH[line.kind](reach)} · ${edge}`;
}
