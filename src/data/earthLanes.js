// Earth lanes (HUM-08, kvnloo#145): which Earth a record speaks about, and the
// only ways a record may change lane. Pure data: no UI, storage or network.
// Observed is source-backed evidence, Possible is authored and hypothetical,
// Coordinated is a real external commitment, Measured is an outcome with new
// evidence. Nothing here can tell whether a stated source is true; it makes
// every claim state one and keeps the receipt.

export const EARTH_LANES = Object.freeze([
  'observed',
  'possible',
  'coordinated',
  'measured',
]);

// Each record type belongs to one lane; the first is what a transition yields.
const TYPES = Object.freeze({
  observed: ['evidence'],
  possible: [
    'scenario',
    'proposal',
    'intervention',
    'budget',
    'assumption',
    'simulation',
    'estimate',
    'prediction',
    'desire',
    'annotation',
  ],
  coordinated: ['commitment'],
  measured: ['outcome'],
});

// from: [to, the basis kind it needs, what that basis must state]. No other
// transition exists, so desired, simulated, annotated or predicted records
// have no path to Observed or Measured.
const EDGES = Object.freeze({
  observed: ['possible', 'fork', ['by']],
  possible: ['coordinated', 'commitment', ['externalId', 'owner']],
  coordinated: ['measured', 'evidence', ['source', 'observedAt']],
  measured: ['observed', 'validation', ['validator', 'evidence']],
});

export class EarthLaneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EarthLaneError';
    this.code = code;
  }
}
function refuse(code, message) {
  throw new EarthLaneError(code, message);
}
const stated = (value) => typeof value === 'string' && value.trim() !== '';

/** The lane a record type belongs to, or null for an unknown type. */
export function laneOfType(type) {
  return EARTH_LANES.find((lane) => TYPES[lane].includes(type)) ?? null;
}

// Why a step is refused, as [code, message]; null when it is allowed.
function problem(from, to, basis) {
  const [next, kind, fields] = EDGES[from] ?? [];
  if (next !== to) return ['transition', `no transition ${from} -> ${to}`];
  if (basis?.kind !== kind)
    return ['basis', `${from} -> ${to} needs a ${kind} basis`];
  const missing = [...fields, 'at'].find((field) => !stated(basis[field]));
  return missing ? ['basis', `a ${kind} basis must state ${missing}`] : null;
}

// The one place a record is made: every rule holds for every record.
function record({ lane, type, source, receipts = [] }) {
  if (!EARTH_LANES.includes(lane)) refuse('lane', `unknown lane ${lane}`);
  if (!TYPES[lane].includes(type))
    refuse('type', `${type} is not a ${lane} record type`);
  if (!Array.isArray(receipts)) refuse('receipts', 'receipts must be a list');
  const chain = receipts.map((r) =>
    Object.freeze({
      from: r?.from,
      to: r?.to,
      basis: Object.freeze({ ...r?.basis }),
    }),
  );
  // Every step is an allowed one and joins the next; the last arrives in this
  // lane. Only Observed and Possible records exist without a receipt.
  const arrives = chain.length
    ? chain.at(-1).to === lane
    : lane === 'observed' || lane === 'possible';
  const broken = chain.some(
    (r, i) =>
      problem(r.from, r.to, r.basis) || (i && chain[i - 1].to !== r.from),
  );
  if (!arrives || broken) refuse('receipts', `receipts do not lead to ${lane}`);
  const sourced = lane === 'observed' || lane === 'measured';
  if (sourced && !stated(source))
    refuse('source', `a ${lane} record must state its source`);
  return Object.freeze({
    lane,
    type,
    ...(sourced && { source }),
    receipts: Object.freeze(chain),
  });
}

/**
 * A new record. Only Observed (with its source) and Possible records can be
 * created; Coordinated and Measured are reached by `transition` alone.
 */
export function createRecord({ lane, type, source }) {
  if (lane === 'coordinated' || lane === 'measured')
    refuse('lane', `only a transition reaches ${lane}`);
  return record({ lane, type, source });
}

/**
 * Move a record along one allowed transition. Returns a new record whose last
 * receipt is `{ from, to, basis }`; the given record is never changed.
 *   observed -> possible      basis { kind: 'fork', by, at }
 *   possible -> coordinated   basis { kind: 'commitment', externalId, owner, at }
 *   coordinated -> measured   basis { kind: 'evidence', source, observedAt, at }
 *   measured -> observed      basis { kind: 'validation', validator, evidence, at }
 */
export function transition(from, { to, basis } = {}) {
  const base = record(from);
  const why = problem(base.lane, to, basis);
  if (why) refuse(...why);
  return record({
    lane: to,
    type: TYPES[to][0],
    source: basis.source ?? basis.evidence,
    receipts: [...base.receipts, { from: base.lane, to, basis }],
  });
}
