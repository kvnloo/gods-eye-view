import { parse } from 'acorn';

const GLYPH = /^[a-z0-9_]{2,}$/;

function children(node) {
  return Object.values(node)
    .flatMap((value) =>
      Array.isArray(value)
        ? value
        : value && typeof value === 'object'
          ? [value]
          : [],
    )
    .filter((value) => value && typeof value.type === 'string');
}

// Fixed prose is not a single icon name; whitespace-only padding may surround one.
// Keep unknown expressions conservative; do not guess their runtime values.
function containsFixedProse(node) {
  if (node.type === 'Literal')
    return (
      typeof node.value === 'string' &&
      /\s/.test(node.value) &&
      /\S/.test(node.value)
    );
  if (node.type === 'TemplateLiteral')
    return node.quasis.some(
      (part) =>
        /\s/.test(part.value.cooked ?? part.value.raw) &&
        /\S/.test(part.value.cooked ?? part.value.raw),
    );
  if (node.type === 'BinaryExpression' && node.operator === '+')
    return containsFixedProse(node.left) || containsFixedProse(node.right);
  return false;
}

export function assignedGlyphs(source) {
  const found = new Set();
  function collect(node) {
    if (containsFixedProse(node)) return;
    if (node.type === 'ConditionalExpression') {
      collect(node.consequent);
      collect(node.alternate);
      return; // The condition is not rendered text.
    }
    if (
      node.type === 'Literal' &&
      typeof node.value === 'string' &&
      GLYPH.test(node.value)
    )
      found.add(node.value);
    if (node.type === 'TemplateLiteral')
      for (const part of node.quasis)
        if (GLYPH.test(part.value.cooked ?? part.value.raw))
          found.add(part.value.cooked ?? part.value.raw);
    for (const child of children(node)) collect(child);
  }
  function walk(node) {
    if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'MemberExpression'
    ) {
      const member = node.left;
      const name = member.computed
        ? member.property.value
        : member.property.name;
      if (name === 'textContent' || name === 'innerText') collect(node.right);
    }
    for (const child of children(node)) walk(child);
  }
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return found;
}
