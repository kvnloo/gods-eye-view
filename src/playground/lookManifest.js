import {
  GRADE_DEFAULTS,
  GRADE_LIMITS,
  LOOK_PACKS,
  isValidLookPack,
} from './lookPacks.js';

/** A small authored data document, never remote shader code or a live data source. */
export const LOOK_MANIFEST_SCHEMA = 'gev.visual-look.v1';
const MAX_SERIALIZED_LENGTH = 4096;
const PACK_KEYS = new Set([
  'schema', 'id', 'title', 'family', 'description',
  'style', 'grade', 'author', 'creative',
]);
const AUTHOR_KEYS = new Set(['name', 'basedOn']);
const isRecord = (item) =>
  item !== null && typeof item === 'object' &&
  !Array.isArray(item) && Object.getPrototypeOf(item) === Object.prototype;
const allowedKeys = (item, keys) => Object.keys(item).every((key) => keys.has(key));
const boundedText = (value, limit) =>
  typeof value === 'string' && value.length > 0 && value.length <= limit &&
  !/[\x00-\x1f\x7f]/.test(value);
const originIds = new Set(LOOK_PACKS.map((pack) => pack.id));

/**
 * Parse one untrusted, local data-only look manifest into a canonical,
 * immutable shape. This function is the only validation boundary.
 */
export function parseLookManifest(json) {
  if (typeof json !== 'string' || json.length > MAX_SERIALIZED_LENGTH)
    throw new TypeError('Look manifest must be bounded JSON text');

  let input;
  try {
    input = JSON.parse(json);
  } catch {
    throw new TypeError('Look manifest is not JSON');
  }
  if (!isRecord(input) || !allowedKeys(input, PACK_KEYS) ||
      input.schema !== LOOK_MANIFEST_SCHEMA || input.creative !== true ||
      typeof input.id !== 'string' ||
      !/^community-[a-z0-9-]{1,50}$/.test(input.id) ||
      !boundedText(input.title, 80) ||
      !boundedText(input.family, 32) ||
      !boundedText(input.description, 220) ||
      !isRecord(input.author) ||
      !allowedKeys(input.author, AUTHOR_KEYS) ||
      !boundedText(input.author.name, 80) ||
      !originIds.has(input.author.basedOn) ||
      !isRecord(input.grade) || !Object.keys(input.grade).length)
    throw new TypeError('Look manifest has unsupported metadata');

  const grade = { ...GRADE_DEFAULTS };
  for (const [key, value] of Object.entries(input.grade)) {
    const limit = GRADE_LIMITS[key];
    if (!limit || typeof value !== 'number' || !Number.isFinite(value) ||
        value < limit[0] || value > limit[1])
      throw new TypeError('Look manifest has invalid grading parameters');
    grade[key] = value;
  }

  const pack = {
    id: input.id,
    title: input.title,
    family: input.family,
    description: input.description,
    style: input.style,
    grade,
  };
  if (!isValidLookPack(pack))
    throw new TypeError('Look manifest references an unsupported renderer style');

  return Object.freeze({
    schema: LOOK_MANIFEST_SCHEMA,
    id: pack.id,
    title: pack.title,
    family: pack.family,
    description: pack.description,
    style: pack.style,
    grade: Object.freeze(grade),
    author: Object.freeze({
      name: input.author.name,
      basedOn: input.author.basedOn,
    }),
    creative: true,
  });
}

/** Export stable, canonical JSON. Unsupported fields never enter the document. */
export function serializeLookManifest(value) {
  if (!isRecord(value))
    throw new TypeError('Look manifest must be a plain data record');
  return JSON.stringify(parseLookManifest(JSON.stringify(value)));
}

/** Seed a user remix from an actual curated pack, preserving its source credit. */
export function createLookManifest(look, authorName) {
  const origin = LOOK_PACKS.find((entry) => entry.id === look?.id);
  if (!origin || !origin.grade)
    throw new TypeError('A creative curated look is required');
  return parseLookManifest(JSON.stringify({
    schema: LOOK_MANIFEST_SCHEMA,
    id: `community-${origin.id}`,
    title: origin.title,
    family: origin.family,
    description: origin.description,
    style: origin.style,
    grade: origin.grade,
    author: { name: authorName, basedOn: origin.id },
    creative: true,
  }));
}
