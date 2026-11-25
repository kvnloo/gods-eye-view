/**
 * @module render/cesium/themes/tileShaderHost
 * @description FORK-ONLY (exp/theme-engine-v0). A tileset holds ONE
 * CustomShader; the theme (stage 0) and other features (city massing's seat
 * shadow) each want one. The host composes "parts" into a single
 * CustomShader per tileset:
 *
 *   part = { id, order, uniforms: {u_name: {type, value}}, glsl, body,
 *            lightingModel?, hosts?: Set }
 *
 * `glsl` holds the part's functions (uniform names must be unique across
 * parts; prefix them), `body` the statements run inside fragmentMain in
 * `order`. Attaching or detaching a part rebuilds the shader (Cesium then
 * rebuilds the tiles' draw commands once); uniform changes go through
 * `setUniform` on every composed shader that uses the part, never a rebuild.
 *
 * A host is found on the tileset under `Symbol.for('gev.tileShaderHost')`,
 * so code outside the renderer (cityMassing.js) can attach a part without
 * importing this module.
 */
export const HOST_KEY = Symbol.for('gev.tileShaderHost');

/** The GLSL of a composed shader (pure; exported for tests). */
export function composeFragment(parts) {
  const sorted = [...parts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return `${sorted.map((p) => `// part: ${p.id}\n${p.glsl ?? ''}`).join('\n')}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
${sorted.map((p) => `  ${p.body}`).join('\n')}
}
`;
}

/** The tileset's host, created on first use. */
export function tileShaderHost(Cesium, tileset) {
  if (tileset[HOST_KEY]) return tileset[HOST_KEY];
  const parts = new Map();
  const prior = tileset.customShader;
  let shader = null;

  function rebuild() {
    for (const part of parts.values()) part.hosts?.delete(shader);
    if (!parts.size) {
      shader = null;
      if (!tileset.isDestroyed?.()) tileset.customShader = prior;
      return;
    }
    const list = [...parts.values()];
    const uniforms = {};
    for (const part of list) Object.assign(uniforms, part.uniforms);
    const lit = list.find((p) => p.lightingModel !== undefined);
    shader = new Cesium.CustomShader({
      mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
      lightingModel: lit?.lightingModel,
      uniforms,
      fragmentShaderText: composeFragment(list),
    });
    for (const part of list) (part.hosts ??= new Set()).add(shader);
    if (!tileset.isDestroyed?.()) tileset.customShader = shader;
  }

  const host = {
    get shader() {
      return shader;
    },
    parts: () => [...parts.keys()],
    attach(part) {
      parts.set(part.id, part);
      rebuild();
      return shader;
    },
    detach(id) {
      const part = parts.get(id);
      if (!part) return;
      part.hosts?.delete(shader);
      parts.delete(id);
      rebuild();
      if (!parts.size) delete tileset[HOST_KEY];
    },
    /** Set a uniform on the composed shader and remember it in its part. */
    setUniform(name, value) {
      for (const part of parts.values())
        if (part.uniforms[name]) part.uniforms[name].value = value;
      shader?.setUniform(name, value);
    },
  };
  tileset[HOST_KEY] = host;
  return host;
}

/**
 * Set a uniform of `part` on every shader it is composed into (and keep it
 * for the next rebuild). For parts owned outside this module.
 */
export function setPartUniform(part, name, value) {
  if (part.uniforms[name]) part.uniforms[name].value = value;
  for (const shader of part.hosts ?? []) shader.setUniform(name, value);
}
