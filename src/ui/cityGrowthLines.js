// What the growth timeline says about one stage of a district plan
// (src/data/cityGrowth.js): one line per figure, each figure once, a change
// read from NOW to the stage through the HUD's one figure formatter. No goal
// score and no canopy: the app holds neither for a growth stage.
import { formatNumber, t, tn } from '../i18n/index.js';
import { hudFigure } from './cityHudFigure.js';

/** A stop of the timeline: NOW, 5 YR, 15 YR. */
export function growthStageLabel(stage) {
  return stage.years
    ? t('{years} YR', { years: formatNumber(stage.years) })
    : t('NOW', { context: 'timeline stage' });
}

/**
 * @param {object} plan A plan of growthPlan().
 * @param {number} index The stage shown.
 * @returns {{id: string, text: string}[]} The stage's lines in reading order.
 *   Deliveries and their assumed rate are left out while the rate is unknown.
 */
export function growthLines(plan, index) {
  const now = plan.stages[0];
  const stage = plan.stages[index];
  const change = (key, unit) =>
    hudFigure({
      before: Math.round(now[key]),
      value: Math.round(stage[key]),
      unit,
      estimate: true,
    });
  const count = (value) => ({ count: formatNumber(value) });
  return [
    {
      id: 'district',
      text: tn(
        plan.plots,
        'DISTRICT · {count} PLOT · {area}',
        'DISTRICT · {count} PLOTS · {area}',
        {
          ...count(plan.plots),
          area: hudFigure({
            value: Math.round(plan.areaSquareMeters),
            unit: 'm²',
          }),
        },
      ),
    },
    {
      id: 'floors',
      text: t('GROWTH FLOORS {floors}', { floors: change('storeys') }),
    },
    ...(stage.lowered
      ? [{ id: 'lowered', text: t('LOWER THAN AN EARLIER STAGE') }]
      : []),
    { id: 'homes', text: t('HOMES {homes}', { homes: change('homes') }) },
    {
      id: 'area',
      text: t('RESIDENTIAL FLOOR AREA {area}', {
        area: change('residentialSquareMeters', 'm²'),
      }),
    },
    ...(stage.deliveriesPerDay === null
      ? []
      : [
          {
            id: 'deliveries',
            text: t('HOME DELIVERIES {rate}', {
              rate: change('deliveriesPerDay', t('/d', { context: 'per day' })),
            }),
          },
          {
            id: 'assumed',
            text: t('ASSUMED: A DELIVERY A DAY FOR EVERY {homes} HOMES', {
              homes: formatNumber(plan.homesPerDelivery),
            }),
          },
        ]),
    {
      id: 'cost',
      text: stage.works
        ? tn(
            stage.works,
            'COST: NEIGHBOURS LIVE BESIDE ROOF WORKS ON {count} PLOT',
            'COST: NEIGHBOURS LIVE BESIDE ROOF WORKS ON {count} PLOTS',
            count(stage.works),
          )
        : t('COST: NO WORKS YET'),
    },
    ...(plan.locked.length
      ? [{ id: 'locked', text: t('LOCKED PLOTS KEEP THEIR SUN FIT') }]
      : []),
  ];
}
