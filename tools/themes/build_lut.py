"""Build a 33^3 colour LUT (2D strip PNG) for a GEV theme from style reference images.

Usage: python build_lut.py OUT.png REF[:x0,y0,x1,y1] [REF[:crop] ...] [--strength 0.7]

FORK-ONLY (exp/theme-engine-v0). The references must be style images that are
NOT Google Maps content (game screenshots, owner-approved paintings). Only the
scene region is used: pass a crop that leaves out HUD panels.

What the LUT does (a statistics transfer, no learned model):
  * hue: 12 sectors in LCh(ab); each input hue moves part-way toward the
    chroma-weighted mean hue the refs show in that sector;
  * chroma: scaled per sector toward the refs' chroma (relative to a typical
    aerial-photo prior), clamped;
  * lightness: a tone curve that maps the photo prior's 2/50/98 percentiles
    onto the refs';
  * split tone: shadows pick up the refs' mean shadow (a,b), highlights the
    refs' mean highlight (a,b).
The strip layout: width = N*N, height = N; pixel (b*N + r, g).
"""
import json
import sys

import numpy as np
from PIL import Image

N = 33
SECTORS = 12
# A neutral prior for aerial photogrammetry (sRGB-derived Lab statistics of
# typical daylight city photos: low chroma, mid-heavy L). Not measured from
# Google content; a fixed, documented assumption.
PRIOR_CHROMA = 16.0
PRIOR_L = (8.0, 48.0, 92.0)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
MI = np.linalg.inv(M)
WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    xyz = srgb_to_linear(rgb) @ M.T / WHITE
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def lab_to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * WHITE
    return linear_to_srgb(xyz @ MI.T)


def load(spec):
    path, _, crop = spec.partition(':')
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(tuple(int(v) for v in crop.split(',')))
    im.thumbnail((640, 640))
    return np.asarray(im, dtype=np.float64).reshape(-1, 3) / 255.0


def ref_stats(pixels):
    lab = rgb_to_lab(pixels)
    L, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    C = np.hypot(a, b)
    h = np.arctan2(b, a)
    sec = ((h % (2 * np.pi)) / (2 * np.pi) * SECTORS).astype(int) % SECTORS
    hue_mean = np.zeros(SECTORS)
    chroma = np.zeros(SECTORS)
    weight = np.zeros(SECTORS)
    for s in range(SECTORS):
        m = (sec == s) & (C > 6)
        weight[s] = m.sum()
        if m.sum() < 20:
            hue_mean[s] = (s + 0.5) / SECTORS * 2 * np.pi
            chroma[s] = PRIOR_CHROMA
            continue
        w = C[m]
        hue_mean[s] = np.arctan2((np.sin(h[m]) * w).sum(), (np.cos(h[m]) * w).sum())
        chroma[s] = np.percentile(C[m], 60)
    lo, hi = np.percentile(L, [15, 85])
    return {
        'L': [float(v) for v in np.percentile(L, [2, 50, 98])],
        'hue_mean': hue_mean.tolist(),
        'chroma': chroma.tolist(),
        'weight': (weight / max(weight.sum(), 1)).tolist(),
        'shadow_ab': [float(a[L <= lo].mean()), float(b[L <= lo].mean())],
        'highlight_ab': [float(a[L >= hi].mean()), float(b[L >= hi].mean())],
    }


def tone(L, src, dst):
    xs = [0.0, *src, 100.0]
    ys = [0.0, *dst, 100.0]
    return np.interp(L, xs, ys)


def build(stats, strength):
    g = np.linspace(0, 1, N)
    r, gg, b = np.meshgrid(g, g, g, indexing='ij')  # r fastest along axis 0
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    lab = rgb_to_lab(rgb)
    L, a, bb = lab[:, 0], lab[:, 1], lab[:, 2]
    C = np.hypot(a, bb)
    h = np.arctan2(bb, a)
    # per-sector targets, interpolated circularly between sector centres
    pos = (h % (2 * np.pi)) / (2 * np.pi) * SECTORS - 0.5
    i0 = np.floor(pos).astype(int) % SECTORS
    i1 = (i0 + 1) % SECTORS
    t = pos - np.floor(pos)
    hm = np.array(stats['hue_mean'])
    cm = np.array(stats['chroma'])
    centre = lambda i: (i + 0.5) / SECTORS * 2 * np.pi
    d0 = np.angle(np.exp(1j * (hm[i0] - centre(i0))))
    d1 = np.angle(np.exp(1j * (hm[i1] - centre(i1))))
    dh = (1 - t) * d0 + t * d1
    cs = np.clip(((1 - t) * cm[i0] + t * cm[i1]) / PRIOR_CHROMA, 0.9, 1.35)
    neutral = np.clip(C / 10.0, 0, 1)  # greys keep their hue (none) and gain little
    h2 = h + 0.45 * dh * neutral
    C2 = C * (1 + (cs - 1) * neutral)
    # Never compress the photo's highlights below L 90 or crush blacks above L 12:
    # the refs' scene crops hold few whites, and a theme must keep the map legible.
    dst = [min(stats['L'][0], 12.0), stats['L'][1], max(stats['L'][2], 90.0)]
    L2 = tone(L, PRIOR_L, dst)
    cap = lambda ab, m: [float(np.clip(v, -m, m)) for v in ab]
    stats = {**stats, 'shadow_ab': cap(stats['shadow_ab'], 10), 'highlight_ab': cap(stats['highlight_ab'], 5)}
    sh = np.clip(1 - L2 / 45, 0, 1) ** 1.5
    hl = np.clip((L2 - 60) / 40, 0, 1) ** 1.5
    a2 = C2 * np.cos(h2) + 0.6 * sh * stats['shadow_ab'][0] + 0.4 * hl * stats['highlight_ab'][0]
    b2 = C2 * np.sin(h2) + 0.6 * sh * stats['shadow_ab'][1] + 0.4 * hl * stats['highlight_ab'][1]
    out = lab_to_rgb(np.stack([L2, a2, b2], -1))
    out = rgb + (out - rgb) * strength
    return np.clip(out, 0, 1).reshape(N, N, N, 3)  # [r, g, b]


def to_strip(cube):
    strip = np.zeros((N, N * N, 3))
    for bi in range(N):
        # x = b*N + r, y = g
        strip[:, bi * N:(bi + 1) * N, :] = cube[:, :, bi, :].transpose(1, 0, 2)
    return Image.fromarray((strip * 255 + 0.5).astype(np.uint8), 'RGB')


def main(argv):
    strength = 0.7
    if '--strength' in argv:
        k = argv.index('--strength')
        strength = float(argv[k + 1])
        argv = argv[:k] + argv[k + 2:]
    out, refs = argv[0], argv[1:]
    pixels = np.concatenate([load(s) for s in refs])
    stats = ref_stats(pixels)
    cube = build(stats, strength)
    to_strip(cube).save(out)
    ident = build({**stats, 'hue_mean': [(s + 0.5) / SECTORS * 2 * np.pi for s in range(SECTORS)],
                   'chroma': [PRIOR_CHROMA] * SECTORS, 'L': list(PRIOR_L),
                   'shadow_ab': [0, 0], 'highlight_ab': [0, 0]}, 1.0)
    err = float(np.abs(ident - np.stack(np.meshgrid(*[np.linspace(0, 1, N)] * 3, indexing='ij'), -1)).max())
    with open(out + '.json', 'w') as f:
        json.dump({'refs': refs, 'strength': strength, 'size': N, 'layout': 'strip x=b*N+r, y=g',
                   'stats': stats, 'identity_roundtrip_max_err': err}, f, indent=1)
    print(json.dumps({'out': out, 'identity_roundtrip_max_err': round(err, 5), 'L': stats['L'],
                      'shadow_ab': stats['shadow_ab'], 'highlight_ab': stats['highlight_ab']}))


if __name__ == '__main__':
    main(sys.argv[1:])
