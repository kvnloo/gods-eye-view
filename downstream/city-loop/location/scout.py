#!/usr/bin/env python3
"""scout.py fetch|score <name> [lat lon] : Overpass (XML, full recursion) around a centre,
then land-cover shares inside the diorama disc (r=720 m) by 4 m rasterisation.
Data (c) OpenStreetMap contributors, ODbL 1.0."""
import json, math, os, subprocess, sys, time, xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CANDS = json.load(open(os.path.join(HERE, 'candidates.json')))
HALF = 900.0          # fetch half-size (m) = ground bake half used by r700
R = 720.0             # diorama cut radius
PX = 4.0              # raster cell (m)
M = 111_320.0
EP = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']


def bbox(lat, lon, half=HALF):
    dlat = half / M
    dlon = half / (M * math.cos(math.radians(lat)))
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def fetch(name):
    c = CANDS[name]
    s, w, n, e = bbox(c['lat'], c['lon'])
    q = (f'[out:xml][timeout:180][bbox:{s:.6f},{w:.6f},{n:.6f},{e:.6f}];'
         '(way["building"];way["highway"];way["landuse"];way["leisure"];way["natural"];way["waterway"];'
         'relation["type"="multipolygon"]["natural"!~"bay|strait|sea"]["boundary"!~"."];node["natural"="tree"];);'
         '(._;>;);out body;')
    out = os.path.join(HERE, 'osm', f'{name}.osm')
    for i in range(10):
        ep = EP[i % len(EP)]
        r = subprocess.run(['curl', '-s', '-m', '240', '-A', 'gev-city-loc-scout/1.0 (github.com/kvnloo)', '--data-urlencode', f'data={q}', ep,
                            '-o', out + '.part', '-w', '%{http_code}'], capture_output=True, text=True)
        ok = r.stdout.strip() == '200' and os.path.getsize(out + '.part') > 1000
        if ok:
            head = open(out + '.part', 'rb').read(400)
            ok = b'<osm' in head
        print(name, ep, r.stdout.strip(), os.path.getsize(out + '.part') if os.path.exists(out + '.part') else 0, flush=True)
        if ok:
            os.replace(out + '.part', out)
            return out
        time.sleep(min(60, 8 * (i + 1)))
    raise SystemExit(f'fetch failed {name}')


GREEN = {'park', 'garden', 'playground', 'pitch', 'grass', 'recreation_ground', 'forest', 'meadow', 'wood', 'scrub',
         'grassland', 'village_green', 'golf_course', 'nature_reserve', 'heath', 'cemetery', 'orchard', 'allotments', 'common', 'dog_park'}
TREEY = {'forest', 'wood'}
WATER = {'water', 'wetland', 'bay', 'reservoir', 'basin', 'riverbank', 'marina'}


def score(name):
    c = CANDS[name]
    lat0, lon0 = c['lat'], c['lon']
    kx = M * math.cos(math.radians(lat0))
    root = ET.parse(os.path.join(HERE, 'osm', f'{name}.osm')).getroot()
    nodes = {}
    trees = 0
    for nd in root.iter('node'):
        x, y = (float(nd.get('lon')) - lon0) * kx, (float(nd.get('lat')) - lat0) * M
        nodes[nd.get('id')] = (x, y)
        if any(t.get('k') == 'natural' and t.get('v') == 'tree' for t in nd.iter('tag')) and math.hypot(x, y) < R:
            trees += 1
    ways = {w.get('id'): ([n.get('ref') for n in w.iter('nd')], {t.get('k'): t.get('v') for t in w.iter('tag')}) for w in root.iter('way')}
    S = int(2 * HALF / PX)
    pix = lambda p: ((p[0] + HALF) / PX, (HALF - p[1]) / PX)
    layers = {k: Image.new('1', (S, S), 0) for k in ('green', 'treey', 'water', 'building', 'road', 'coast')}
    draws = {k: ImageDraw.Draw(v) for k, v in layers.items()}
    nb = 0
    res_b = 0
    names = set()

    def kind_of(tags):
        if tags.get('natural') in WATER or tags.get('waterway') == 'riverbank' or tags.get('landuse') in ('reservoir', 'basin') or tags.get('leisure') == 'marina':
            return 'water'
        k = tags.get('leisure') or tags.get('landuse') or tags.get('natural')
        if k in GREEN:
            return 'treey' if k in TREEY else 'green'
        return None

    def poly(refs):
        return [pix(nodes[r]) for r in refs if r in nodes]

    for wid, (refs, tags) in ways.items():
        ps = poly(refs)
        if len(ps) < 2:
            continue
        closed = refs[0] == refs[-1] and len(ps) >= 4
        if 'building' in tags and closed:
            draws['building'].polygon(ps, fill=1)
            cx = sum(nodes[r][0] for r in refs if r in nodes) / len(ps); cy = sum(nodes[r][1] for r in refs if r in nodes) / len(ps)
            if math.hypot(cx, cy) < R:
                nb += 1
                if tags.get('building') in ('house', 'residential', 'detached', 'semidetached_house', 'terrace', 'apartments', 'yes'):
                    res_b += 1
        elif 'highway' in tags and tags['highway'] not in ('footway', 'path', 'steps', 'cycleway', 'track', 'bridleway', 'corridor'):
            draws['road'].line(ps, fill=1, width=max(1, int((10 if tags['highway'] in ('primary', 'secondary', 'trunk', 'motorway', 'tertiary') else 7) / PX)))
        elif tags.get('natural') == 'coastline':
            draws['coast'].line(ps, fill=1, width=1)
        elif closed:
            k = kind_of(tags)
            if k:
                draws[k].polygon(ps, fill=1)
                if tags.get('name'):
                    names.add(tags['name'])
                if k == 'treey':
                    draws['green'].polygon(ps, fill=1)
        if tags.get('waterway') in ('river', 'stream', 'canal'):
            draws['water'].line(ps, fill=1, width=max(1, int(6 / PX)))
    for rel in root.iter('relation'):
        tags = {t.get('k'): t.get('v') for t in rel.iter('tag')}
        if tags.get('type') != 'multipolygon':
            continue
        k = 'building' if 'building' in tags else kind_of(tags)
        if not k:
            continue
        # outer rings: stitch member ways naively (closed members only, plus chained open ones)
        outers = [ways[m.get('ref')][0] for m in rel.iter('member') if m.get('type') == 'way' and m.get('role') == 'outer' and m.get('ref') in ways]
        inners = [ways[m.get('ref')][0] for m in rel.iter('member') if m.get('type') == 'way' and m.get('role') == 'inner' and m.get('ref') in ways]
        for ring in stitch(outers):
            ps = poly(ring)
            if len(ps) >= 3:
                draws[k].polygon(ps, fill=1)
                if k == 'treey':
                    draws['green'].polygon(ps, fill=1)
        for ring in stitch(inners):
            ps = poly(ring)
            if len(ps) >= 3 and k != 'building':
                draws[k].polygon(ps, fill=0)
        if tags.get('name'):
            names.add(tags['name'])
    A = {k: np.array(v, dtype=bool) for k, v in layers.items()}
    sea = sea_mask(A['coast'], ways, nodes, pix, S)
    A['water'] |= sea
    yy, xx = np.mgrid[0:S, 0:S]
    disc = np.hypot((xx + 0.5) * PX - HALF, HALF - (yy + 0.5) * PX) < R
    tot = disc.sum()
    built = A['building'] | A['road']
    water = A['water'] & ~built
    green = A['green'] & ~built & ~water
    out = {
        'name': name, 'label': c['label'], 'centre': [lat0, lon0],
        'water': round(float((water & disc).sum() / tot), 3),
        'green': round(float((green & disc).sum() / tot), 3),
        'forest': round(float((A['treey'] & ~built & disc).sum() / tot), 3),
        'building': round(float((A['building'] & disc).sum() / tot), 3),
        'road': round(float((A['road'] & ~A['building'] & disc).sum() / tot), 3),
        'buildings_n': nb, 'buildings_per_km2': round(nb / (math.pi * (R / 1000) ** 2)),
        'trees_osm': trees,
    }
    out['veg_water'] = round(out['water'] + out['green'], 3)
    out['other'] = round(1 - out['water'] - out['green'] - out['building'] - out['road'], 3)
    # cover map png for eyeballing
    rgb = np.full((S, S, 3), 220, np.uint8)
    rgb[green] = (110, 170, 80); rgb[A['treey'] & ~built] = (40, 110, 60); rgb[water] = (80, 140, 210)
    rgb[A['road']] = (150, 150, 150); rgb[A['building']] = (200, 90, 60)
    rgb[~disc] = (rgb[~disc] * 0.45).astype(np.uint8)
    # plot marker (40 m) at centre
    if c.get('plot'):
        p = c['plot']
        px0 = int((HALF - 20) / PX); px1 = int((HALF + 20) / PX)
        rgb[px0:px1, px0:px0 + 2] = rgb[px0:px1, px1 - 2:px1] = rgb[px0:px0 + 2, px0:px1] = rgb[px1 - 2:px1, px0:px1] = (0, 230, 255)
    Image.fromarray(rgb).save(os.path.join(HERE, 'cover', f'{name}.png'))
    # plot check: the 40 m plot cell at centre
    cs = slice(int((HALF - 20) / PX), int((HALF + 20) / PX))
    out['plot_building_frac'] = round(float(A['building'][cs, cs].mean()), 3)
    out['plot_green_frac'] = round(float((A['green'][cs, cs] & ~A['building'][cs, cs]).mean()), 3)
    out['named'] = sorted(names)[:40]
    return out


def stitch(ws):
    ws = [list(w) for w in ws if w]
    rings = []
    while ws:
        cur = ws.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, w in enumerate(ws):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                ws.pop(i); changed = True; break
        rings.append(cur)
    return rings


def sea_mask(coast, ways, nodes, pix, S):
    """Coastline: land on the left, water on the right. Label regions split by the coast
    lines, vote each region by probes offset to the right/left of every coastline segment."""
    if not coast.any():
        return np.zeros((S, S), bool)
    free = ~coast
    lab = np.zeros((S, S), np.int32)
    cur = 0
    for y0 in range(S):
        for x0 in np.nonzero(free[y0] & (lab[y0] == 0))[0]:
            if lab[y0, x0]:
                continue
            cur += 1
            st = [(y0, x0)]
            lab[y0, x0] = cur
            while st:
                y, x = st.pop()
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < S and 0 <= xx < S and free[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur
                        st.append((yy, xx))
    votes = {}
    for refs, tags in ways.values():
        if tags.get('natural') != 'coastline':
            continue
        ps = [pix(nodes[r]) for r in refs if r in nodes]
        for (ax, ay), (bx, by) in zip(ps, ps[1:]):
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy)
            if L < 1e-6:
                continue
            mx, my = (ax + bx) / 2, (ay + by) / 2
            # image y points down: "right" of travel direction in map coords = (dy, -dx) in image coords
            for sgn, w in ((1, 1), (-1, -1)):
                for d in (2.5, 4.0):
                    qx, qy = int(mx + sgn * (-dy) / L * d), int(my + sgn * (dx) / L * d)
                    if 0 <= qx < S and 0 <= qy < S and lab[qy, qx]:
                        votes[lab[qy, qx]] = votes.get(lab[qy, qx], 0) + w
    water_labels = [k for k, v in votes.items() if v > 0]
    return np.isin(lab, water_labels) | (coast & False)


if __name__ == '__main__':
    os.makedirs(os.path.join(HERE, 'cover'), exist_ok=True)
    cmd, names = sys.argv[1], sys.argv[2:] or list(CANDS)
    rows = []
    for nm in names:
        if cmd == 'fetch':
            if not os.path.exists(os.path.join(HERE, 'osm', f'{nm}.osm')):
                fetch(nm)
        else:
            rows.append(score(nm))
    if rows:
        json.dump(rows, open(os.path.join(HERE, 'scout.json'), 'w'), indent=1)
        for r in rows:
            print(json.dumps({k: v for k, v in r.items() if k != 'named'}))
