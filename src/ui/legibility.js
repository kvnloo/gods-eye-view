// Text legibility over the globe: WCAG 2 contrast of computed CSS colours,
// with translucent glass composited over a worst-case white backdrop (a bright
// photoreal roof), and the 12 px floor for caps labels. Pure; no DOM.

const WHITE = [255, 255, 255];

// OKLab (Ottosson) to gamma-encoded sRGB 0-255.
function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => {
    const e = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, e)) * 255;
  });
}

/** `rgb()`, `rgba()`, `color(srgb …)`, `oklab()` or `oklch()` to [r, g, b, a] (0-255, 0-1), or null when nothing paints. */
export function parseColor(value) {
  const text = String(value ?? '').trim();
  let rgba = null;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(text);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    rgba = [r, g, b, a];
  } else if (srgb) {
    const [r, g, b, a = 1] = srgb[1]
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);
    rgba = [r * 255, g * 255, b * 255, a];
  } else if (/^okl(ab|ch)\(/.test(text)) {
    const [L, x, y, a = 1] = text
      .slice(text.indexOf('(') + 1, -1)
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);
    const lab = text.startsWith('oklch')
      ? [x * Math.cos((y * Math.PI) / 180), x * Math.sin((y * Math.PI) / 180)]
      : [x, y];
    rgba = [...fromOklab(L, ...lab), a];
  }
  if (!rgba || rgba.some((n) => !Number.isFinite(n)) || rgba[3] <= 0)
    return null;
  return rgba;
}

/** Paint a translucent colour over an opaque one. */
export function composite([r, g, b, a = 1], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour over background layers (outermost first) on a white backdrop.
 * Passes at 4.5:1 or better, and caps labels need at least 12 px.
 */
export function textLegibility({ color, layers = [], fontSize, caps }) {
  const ground = layers
    .map(parseColor)
    .filter(Boolean)
    .reduce((under, layer) => composite(layer, under), WHITE);
  const ink = parseColor(color);
  const ratio = ink ? contrastRatio(composite(ink, ground), ground) : 1;
  const reason =
    caps && fontSize < 12
      ? 'caps-under-12px'
      : ratio < 4.5
        ? 'contrast-under-4.5'
        : null;
  return { ratio, ok: !reason, reason };
}
