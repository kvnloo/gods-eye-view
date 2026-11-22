// "Cozy Valley" look: a fork-only, experimental reality-mode prototype.
// Real-time Cesium post-process chain over the live globe (photoreal tiles stay
// the geometry; only the image is graded). Not upstream-bound.
//
// Chain (in order): ambient occlusion (library stage, when the context
// supports depth textures) -> bloom (scene's built-in bloom) -> one custom
// "cozy" stage: warm key grade + lift/gamma/gain LUT approximation,
// saturation, soft posterise, tilt-shift blur band and vignette. The cozy stage
// carries a compare wipe: pixels left of `wipe` (0..1 of width) show the input
// to the stage (the original image, AO aside), right of it the graded image.
//
// Usage inside the running app (vite dev serves this file):
//   const m = await import('/downstream/city-loop/filter/cozyValley.js');
//   const look = m.installCozyValley(window.__godsEyeView.viewer, { wipe: 0 });
//   look.set({ wipe: 0.5 }); look.remove();
// Or by URL param (see installFromUrl): ?look=cozy[&lookWipe=0.5]

const FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform float wipe;
uniform float strength;
uniform float saturation;
uniform float posterize;
uniform float tiltCenter;
uniform float tiltBand;
uniform float tiltBlur;
uniform float vignette;
uniform float warmR;
uniform float warmG;
uniform float warmB;
uniform float texelX;
uniform float texelY;

vec3 grade(vec3 c) {
  vec3 warm = vec3(warmR, warmG, warmB);
  // Lift / gamma / gain toward a warm golden-hour key with teal-ish shadows.
  vec3 lift = vec3(0.025, 0.035, 0.05);
  vec3 gain = warm;
  c = c * gain + lift * (1.0 - c);
  c = pow(max(c, 0.0), vec3(0.92, 0.95, 1.02));
  // Soft S-curve for a painterly, low-contrast-shadows look.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  // Soft posterise: blend toward quantised colour (painterly banding).
  if (posterize > 0.0) {
    float steps = 9.0;
    vec3 q = floor(c * steps + 0.5) / steps;
    c = mix(c, q, posterize);
  }
  return clamp(c, 0.0, 1.0);
}

vec3 blurAt(vec2 uv, float r, vec2 texel) {
  // 13-tap disc blur; radius r in pixels.
  vec3 acc = texture(colorTexture, uv).rgb;
  float n = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    float rr = (i % 2 == 0) ? r : r * 0.5;
    acc += texture(colorTexture, uv + vec2(cos(a), sin(a)) * rr * texel).rgb;
    n += 1.0;
  }
  return acc / n;
}

void main() {
  vec2 texel = vec2(texelX, texelY);
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  if (uv.x < wipe) {
    out_FragColor = src;
    // Wipe seam: a thin cyan line (#2EC8E8) so the compare reads as a tool.
    if (abs(uv.x - wipe) < texel.x * 1.5) out_FragColor = vec4(0.18, 0.78, 0.91, 1.0);
    return;
  }
  // Tilt-shift: sharp horizontal band around tiltCenter, blur grows outside.
  float d = abs(uv.y - tiltCenter);
  float t = smoothstep(tiltBand, tiltBand + 0.28, d);
  vec3 c = t > 0.001 ? mix(src.rgb, blurAt(uv, tiltBlur * t, texel), t) : src.rgb;
  vec3 g = grade(c);
  // Vignette.
  vec2 v = uv - 0.5;
  g *= mix(1.0, smoothstep(0.85, 0.25, length(v)), vignette);
  vec3 outc = mix(src.rgb, g, strength);
  if (abs(uv.x - wipe) < texel.x * 1.5 && wipe > 0.0) outc = vec3(0.18, 0.78, 0.91);
  out_FragColor = vec4(outc, src.a);
}
`;

export const COZY_DEFAULTS = Object.freeze({
  wipe: 0,
  strength: 1,
  saturation: 1.28,
  posterize: 0.22,
  tiltCenter: 0.55,
  tiltBand: 0.12,
  tiltBlur: 7,
  vignette: 0.55,
  warm: [1.08, 1.0, 0.86],
  // AO off by default: in round 0 (SwiftShader, Google 3D tiles) Cesium's HBAO
  // crushed the whole frame to near-black, including the un-graded wipe side.
  ao: false,
  // Bloom off by default: in round 0 Cesium's bloom (brightness 0, contrast 128)
  // blew the photoreal frame out to near-white on both sides of the wipe.
  bloom: false,
});

export function installCozyValley(viewer, options = {}) {
  // No global Cesium is needed: take the PostProcessStage constructor from the
  // scene's own FXAA stage, so this module works with any app bundling.
  const scene = viewer.scene;
  const stages = scene.postProcessStages;
  const PostProcessStage = options.PostProcessStage ?? stages.fxaa.constructor;
  const opts = { ...COZY_DEFAULTS, ...options };
  const report = { ao: 'off', bloom: 'off', cozy: 'off' };
  const prior = {
    bloom: stages.bloom.enabled,
    ao: stages.ambientOcclusion.enabled,
  };

  // AO: Cesium's built-in HBAO, needs depth textures.
  if (opts.ao) {
    if (scene.context?.depthTexture) {
      const ao = stages.ambientOcclusion;
      ao.enabled = true;
      ao.uniforms.intensity = 2.2;
      ao.uniforms.bias = 0.1;
      ao.uniforms.lengthCap = 0.12;
      ao.uniforms.stepSize = 1.0;
      ao.uniforms.blurStepSize = 1.2;
      report.ao = 'on';
    } else report.ao = 'unsupported';
  }
  if (opts.bloom) {
    const b = stages.bloom;
    b.enabled = true;
    b.uniforms.contrast = 128;
    b.uniforms.brightness = 0.0;
    b.uniforms.glowOnly = false;
    b.uniforms.delta = 1.0;
    b.uniforms.sigma = 2.6;
    b.uniforms.stepSize = 1.2;
    report.bloom = 'on';
  }
  const uniforms = {
    wipe: () => opts.wipe,
    strength: () => opts.strength,
    saturation: () => opts.saturation,
    posterize: () => opts.posterize,
    tiltCenter: () => opts.tiltCenter,
    tiltBand: () => opts.tiltBand,
    tiltBlur: () => opts.tiltBlur,
    vignette: () => opts.vignette,
    warmR: () => opts.warm[0],
    warmG: () => opts.warm[1],
    warmB: () => opts.warm[2],
    texelX: () => 1 / Math.max(1, scene.drawingBufferWidth),
    texelY: () => 1 / Math.max(1, scene.drawingBufferHeight),
  };
  const cozy = stages.add(
    new PostProcessStage({
      name: 'gev_fork_cozy_valley',
      fragmentShader: FS,
      uniforms,
    }),
  );
  report.cozy = 'on';
  scene.requestRender?.();
  return {
    report,
    options: opts,
    set(next) {
      Object.assign(opts, next);
      scene.requestRender?.();
    },
    remove() {
      stages.remove(cozy);
      stages.bloom.enabled = prior.bloom;
      stages.ambientOcclusion.enabled = prior.ao;
      scene.requestRender?.();
    },
  };
}

// Wire by URL param (?look=cozy&lookWipe=0.5) once the app viewer exists.
export async function installFromUrl(win = globalThis.window) {
  const q = new URLSearchParams(win.location.search);
  if (q.get('look') !== 'cozy') return null;
  for (let i = 0; i < 600 && !win.__godsEyeView?.viewer; i++)
    await new Promise((r) => setTimeout(r, 100));
  const viewer = win.__godsEyeView?.viewer;
  if (!viewer) return null;
  const look = installCozyValley(viewer, {
    wipe: Number(q.get('lookWipe') ?? 0) || 0,
  });
  win.__gevCozyValley = look;
  return look;
}
