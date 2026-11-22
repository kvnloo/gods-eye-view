/**
 * One of the City builder's draw sets (`src/render/contract/draw.d.ts`),
 * handed the whole list of what it draws each time: a list with the same
 * items upserts only those that changed (so an item that only shows or
 * hides changes where it is drawn), a list with other items replaces them
 * all, and a list that changed nothing changes nothing.
 * @param {import('../render/contract/draw').DrawPort} draw
 * @param {'shapes'|'lines'} kind
 * @param {string} id The set's id, as picks name it.
 * @param {object} [options] The rest of the set's spec.
 */
export function createCityDrawGroup(draw, kind, id, options = {}) {
  const set = draw[kind]({ id, ...options });
  /** Each item's key as last handed over, by id, in order. */
  let keys = new Map();
  let list = [];
  return {
    put(items) {
      const next = new Map(items.map((item) => [item.id, keyOf(item)]));
      const same =
        next.size === keys.size && [...next.keys()].every((k) => keys.has(k));
      const changed = same
        ? items.filter((item) => keys.get(item.id) !== next.get(item.id))
        : null;
      keys = next;
      list = items;
      if (!same) set.set(items);
      else if (changed.length) set.upsert(changed);
    },
    show(shown) {
      if (set.show !== shown) set.show = shown;
    },
    shown: () => set.show,
    has: (itemId) => keys.has(itemId),
    /** What the set holds, as it was handed over. */
    items: () => list,
    dispose() {
      set.dispose();
      keys = new Map();
      list = [];
    },
  };
}

/** An item's key: its values, a canvas image by its own key. */
function keyOf(item) {
  return JSON.stringify(item, (name, value) =>
    name === 'canvas' && value && typeof value === 'object' ? undefined : value,
  );
}

/** A CSS colour (`#rrggbb`) at `alpha`, as a CSS `rgba()` string. */
export function cssAlpha(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
