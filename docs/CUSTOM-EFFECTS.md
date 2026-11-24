# Custom theme effects and presets (fork-only, exp/theme-engine-v0)

The theme engine (`src/render/cesium/themes/`) restyles the whole globe:
Google Photorealistic 3D Tiles anywhere, any zoom, city builder on or off. It
is a ReShade-style stack: **stage 0** restyles each tileset's own texture in
its CustomShader, then **post effects** run in order on the frame.

Open it with a URL switch:

| Switch                       | What                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `?preset=wintercats`         | built-in preset (`wintercats`, `enhanced-realism`, `cozy`, `none`) |
| `?preset=/presets/mine.json` | a preset file (same origin, or a CORS-enabled URL)                 |
| `?theme=…`                   | alias of `?preset=`                                                |
| `&themeWipe=0.5`             | before/after wipe; left of the cyan line is the map as served      |
| `&themePanel=1`              | developer overlay: effects, order, sliders, custom effects, export |
| `&themeBudget=0`             | never switch effects off for slow frames                           |

The map attribution stays visible: effects draw only into the WebGL frame and
the credits are DOM above it. Do not save, export or bake themed Google tiles.

## Preset JSON

```json
{
  "format": "gev-theme-preset/1",
  "name": "my-theme",
  "label": "My theme",
  "perfTier": "medium",
  "techniques": ["tile", "ao", "haze", "dof", "lut", "grade", "vignette"],
  "uniforms": {
    "tile": { "grass": [0.48, 0.66, 0.25], "roofA": [0.76, 0.35, 0.22] },
    "haze": { "hazeColor": [0.7, 0.86, 0.9] },
    "grade": { "temperature": 0.15, "vibrance": 0.2 }
  },
  "textures": { "lutTexture": "/themes/luts/wintercats.png" },
  "effects": []
}
```

- `techniques`: enabled effects in order (`tile` always runs first, in the
  tiles' own shader). Unknown names are dropped with a notice.
- `uniforms`: per effect; anything not given takes the library default. Colours
  are `[r, g, b]` 0..1.
- `textures.lutTexture`: a 2D strip LUT, width N·N, height N, pixel
  `(b·N + r, g)` (build one with `tools/themes/build_lut.py` from style
  images that are not map content).
- `perfTier`: `low` (20 fps), `medium` (30), `high` (45): below that for ~3 s
  the most expensive effect is switched off and a notice shown.
- `effects`: custom effect files (strings, see below) the preset carries.

The panel's **Export preset JSON** writes the current stack in this format.

## A custom effect

One file: a JSON header in a `/*! gev-effect … */` comment, then GLSL ES 3.00
with a `main()`. The engine prepends the inputs, so the file only declares
what is its own.

```glsl
/*! gev-effect
{ "id": "ink", "label": "Ink outlines", "depth": true, "cost": 1,
  "uniforms": {
    "inkStrength": { "type": "float", "default": 0.6, "min": 0, "max": 1, "step": 0.01, "label": "Ink" },
    "inkColor": { "type": "color", "default": [0.2, 0.12, 0.1], "label": "Ink colour" } } }
*/
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / colorTextureDimensions;
  vec4 src = texture(colorTexture, uv);
  float d = fx_dist(uv);
  float m = max(max(fx_dist(uv + vec2(px.x, 0.0)), fx_dist(uv - vec2(px.x, 0.0))),
                max(fx_dist(uv + vec2(0.0, px.y)), fx_dist(uv - vec2(0.0, px.y))));
  float edge = smoothstep(0.02, 0.08, (m - d) / max(d, 1.0));
  out_FragColor = vec4(mix(src.rgb, inkColor, edge * inkStrength), src.a);
}
```

Always available: `colorTexture`, `colorTextureDimensions`,
`v_textureCoordinates`, `out_FragColor`, `fx_luma(rgb)`, `fx_hash(vec2)` and
Cesium's `czm_*` built-ins (`czm_frameNumber`, `czm_sunDirectionEC`,
`czm_eyeHeight`, …). With `"depth": true`: `fx_eye(uv)` (eye-space position),
`fx_sky(uv)`, `fx_dist(uv)` (metres, 1e8 for sky). With `"launchpad": true`:
`fx_normal(uv)` (view-space normal from the shared prepass).

Header rules: `id` is `a-z0-9-`, not a built-in name; uniform types are
`float`, `bool` (sent as 0/1 float), `color`/`vec3`; no `#version` or
`#extension`; at most 20 000 characters.

Load it with the panel (paste, or pick a `.glsl` file), from a preset's
`effects`, or from the console:

```js
__gevTheme.addEffect(fileText, { enable: true });
```

**Safety.** A custom effect that fails to compile or throws is switched off at
the end of that frame and its error shown in the panel; the globe keeps
drawing. Custom effects are post effects only; they never change tile shaders.

## Example: a "fantasy universe" preset

Moonlit, violet-sky elven realm: teal-silver foliage, cool fog, glowing
highlights, soft focus, ink edges from the custom effect above.

```json
{
  "format": "gev-theme-preset/1",
  "name": "elven-moon",
  "label": "Elven moonlight",
  "perfTier": "medium",
  "techniques": [
    "tile",
    "ao",
    "haze",
    "dof",
    "bloom",
    "grade",
    "ink",
    "vignette",
    "grain"
  ],
  "uniforms": {
    "tile": {
      "grass": [0.36, 0.62, 0.58],
      "canopy": [0.16, 0.32, 0.36],
      "water": [0.35, 0.45, 0.85],
      "waterDeep": [0.15, 0.18, 0.45],
      "wall": [0.86, 0.88, 0.95],
      "street": [0.6, 0.62, 0.72],
      "roofA": [0.42, 0.36, 0.7],
      "roofB": [0.22, 0.3, 0.48],
      "roofC": [0.8, 0.82, 0.92],
      "roofD": [0.3, 0.24, 0.4],
      "shadow": [0.3, 0.28, 0.6],
      "key": [0.85, 0.92, 1.1]
    },
    "haze": {
      "hazeColor": [0.55, 0.5, 0.85],
      "hazeDensity": 0.06,
      "skyTint": 0.5,
      "skyColor": [0.45, 0.35, 0.75]
    },
    "bloom": {
      "bloomThreshold": 0.6,
      "bloomIntensity": 1.6,
      "bloomTint": [0.8, 0.85, 1.0]
    },
    "grade": {
      "temperature": -0.5,
      "tint": 0.2,
      "exposure": -0.3,
      "contrast": 1.1,
      "lift": [0.03, 0.02, 0.08]
    },
    "dof": { "tiltAmount": 0.4 },
    "vignette": { "vignette": 0.45, "vignetteColor": [0.2, 0.15, 0.4] },
    "grain": { "grain": 0.03 }
  },
  "textures": {},
  "effects": [
    "/*! gev-effect\n{ \"id\": \"ink\", \"depth\": true, \"uniforms\": { \"inkStrength\": { \"type\": \"float\", \"default\": 0.6 }, \"inkColor\": { \"type\": \"color\", \"default\": [0.2, 0.12, 0.1] } } }\n*/\nvoid main() { vec2 uv = v_textureCoordinates; vec2 px = 1.0 / colorTextureDimensions; vec4 src = texture(colorTexture, uv); float d = fx_dist(uv); float m = max(max(fx_dist(uv + vec2(px.x, 0.0)), fx_dist(uv - vec2(px.x, 0.0))), max(fx_dist(uv + vec2(0.0, px.y)), fx_dist(uv - vec2(0.0, px.y)))); float edge = smoothstep(0.02, 0.08, (m - d) / max(d, 1.0)); out_FragColor = vec4(mix(src.rgb, vec3(0.1, 0.08, 0.2), edge * 0.6), src.a); }"
  ]
}
```

Save it under `public/presets/elven-moon.json` and open
`?preset=/presets/elven-moon.json`.
