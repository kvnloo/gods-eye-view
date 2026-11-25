#!/usr/bin/env python3
"""build_fixture_loc.py <name> <out.json> [R=760]
Overpass XML (osm/<name>.osm, see scout.py) -> gev-city-diorama-fixture@2 around the
candidate's plot centre: buildings, roads, green/water areas, mapped trees (as @1), plus
`water`: a 4 m raster of all water (OSM water areas, rivers, and sea rebuilt from the
coastline), run-length coded, with one id per connected water body so the page can
level each body. Data (c) OpenStreetMap contributors, ODbL 1.0."""
import datetime, json, math, os, sys, xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scout  # noqa: E402

name, out = sys.argv[1], sys.argv[2]
R = float(sys.argv[3]) if len(sys.argv) > 3 else 760.0
c = scout.CANDS[name]
lat0, lon0 = c['lat'], c['lon']
M = 111_320.0
kx = M * math.cos(math.radians(lat0))
src = os.path.join(HERE, 'osm', f'{name}.osm')
root = ET.parse(src).getroot()


def en(lat, lon):
    return [round((lon - lon0) * kx, 1), round((lat - lat0) * M, 1)]


nodes, trees = {}, []
for n in root.iter('node'):
    p = en(float(n.get('lat')), float(n.get('lon')))
    nodes[n.get('id')] = p
    tags = {t.get('k'): t.get('v') for t in n.iter('tag')}
    if tags.get('natural') == 'tree' and math.hypot(*p) < R:
        trees.append(p)
ways = {w.get('id'): ([nd.get('ref') for nd in w.iter('nd')], {t.get('k'): t.get('v') for t in w.iter('tag')}) for w in root.iter('way')}
pts = lambda refs: [nodes[r] for r in refs if r in nodes]
near = lambda ps, r: any(math.hypot(*p) < r for p in ps)


def num(v):
    try:
        return float(str(v).split(';')[0].replace('m', '').strip())
    except Exception:
        return None


GREEN = {'park', 'garden', 'playground', 'pitch', 'grass', 'recreation_ground', 'forest', 'meadow', 'wood', 'scrub', 'grassland',
         'village_green', 'golf_course', 'nature_reserve', 'heath', 'common', 'dog_park', 'cemetery', 'orchard', 'allotments'}
WATERK = {'water', 'wetland', 'reservoir', 'basin', 'riverbank'}


def kind(tags):
    k = tags.get('leisure') or tags.get('landuse') or tags.get('natural')
    if tags.get('natural') in WATERK or tags.get('landuse') in ('reservoir', 'basin') or tags.get('waterway') == 'riverbank':
        return 'wetland' if tags.get('natural') == 'wetland' else 'water'
    return k if k in GREEN else None


buildings, roads, areas = [], [], []
for wid, (refs, tags) in ways.items():
    ps = pts(refs)
    if len(ps) < 2:
        continue
    if 'building' in tags and len(ps) >= 4 and ps[0] == ps[-1] and near(ps, R):
        buildings.append({'p': ps[:-1], 'h': num(tags.get('height')), 'lv': num(tags.get('building:levels')), 'k': tags.get('building'), 'n': tags.get('name')})
    elif 'highway' in tags and near(ps, R + 60):
        roads.append({'p': ps, 't': tags['highway'], 'n': tags.get('name')})
    else:
        k = kind(tags)
        if k and ps[0] == ps[-1] and near(ps, R + 60):
            areas.append({'p': ps[:-1], 'k': k, 'n': tags.get('name')})
for rel in root.iter('relation'):
    tags = {t.get('k'): t.get('v') for t in rel.iter('tag')}
    if tags.get('type') != 'multipolygon':
        continue
    k = 'building' if 'building' in tags else kind(tags)
    if not k:
        continue
    outers = [ways[m.get('ref')][0] for m in rel.iter('member') if m.get('type') == 'way' and m.get('role') == 'outer' and m.get('ref') in ways]
    for ring in scout.stitch(outers):
        ps = pts(ring)
        if len(ps) >= 4 and ps[0] == ps[-1] and near(ps, R + 60):
            if k == 'building':
                buildings.append({'p': ps[:-1], 'h': num(tags.get('height')), 'lv': num(tags.get('building:levels')), 'k': tags.get('building'), 'n': tags.get('name')})
            elif k in ('water', 'wetland'):
                pass  # big water relations go through the raster below (inner islands handled there)
            else:
                areas.append({'p': ps[:-1], 'k': k, 'n': tags.get('name')})

# ---- water raster (4 m), same rasteriser as the scout
HALF, PX = scout.HALF, scout.PX
S = int(2 * HALF / PX)
pix = lambda p: ((p[0] + HALF) / PX, (HALF - p[1]) / PX)
pnodes = {k: (v[0], v[1]) for k, v in nodes.items()}
img = Image.new('1', (S, S), 0)
d = ImageDraw.Draw(img)
coast = Image.new('1', (S, S), 0)
dc = ImageDraw.Draw(coast)
for wid, (refs, tags) in ways.items():
    ps = [pix(pnodes[r]) for r in refs if r in pnodes]
    if len(ps) < 2:
        continue
    if tags.get('natural') == 'coastline':
        dc.line(ps, fill=1, width=1)
    elif kind(tags) in ('water', 'wetland') and refs[0] == refs[-1] and len(ps) >= 4:
        d.polygon(ps, fill=1)
    if tags.get('waterway') in ('river', 'canal'):
        d.line(ps, fill=1, width=max(1, int(8 / PX)))
    elif tags.get('waterway') == 'stream':
        d.line(ps, fill=1, width=1)
for rel in root.iter('relation'):
    tags = {t.get('k'): t.get('v') for t in rel.iter('tag')}
    if tags.get('type') != 'multipolygon' or kind(tags) not in ('water', 'wetland'):
        continue
    mem = lambda role: [ways[m.get('ref')][0] for m in rel.iter('member') if m.get('type') == 'way' and m.get('role') == role and m.get('ref') in ways]
    for ring in scout.stitch(mem('outer')):
        ps = [pix(pnodes[r]) for r in ring if r in pnodes]
        if len(ps) >= 3:
            d.polygon(ps, fill=1)
    for ring in scout.stitch(mem('inner')):
        ps = [pix(pnodes[r]) for r in ring if r in pnodes]
        if len(ps) >= 3:
            d.polygon(ps, fill=0)
W = np.array(img, dtype=bool)
sea = scout.sea_mask(np.array(coast, dtype=bool), ways, pnodes, pix, S)
W |= sea
# connected water bodies (4-neighbour), largest first
lab = np.zeros((S, S), np.int32)
sizes = []
cur = 0
for y0, x0 in zip(*np.nonzero(W)):
    if lab[y0, x0]:
        continue
    cur += 1
    st = [(y0, x0)]
    lab[y0, x0] = cur
    nb = 0
    while st:
        y, x = st.pop()
        nb += 1
        for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= yy < S and 0 <= xx < S and W[yy, xx] and not lab[yy, xx]:
                lab[yy, xx] = cur
                st.append((yy, xx))
    sizes.append((nb, cur))
sizes.sort(reverse=True)
remap = np.zeros(cur + 1, np.int32)
for i, (nb, k) in enumerate(sizes):
    remap[k] = min(i + 1, 250) if nb >= 6 else 0  # drop specks < ~100 m2
lab = remap[lab]
rows = []
for y in range(S):
    row, v, n = [], int(lab[y, 0]), 0
    for x in range(S):
        if int(lab[y, x]) == v:
            n += 1
        else:
            row.append([v, n]); v, n = int(lab[y, x]), 1
    row.append([v, n])
    rows.append(row)
yy, xx = np.mgrid[0:S, 0:S]
disc = np.hypot((xx + 0.5) * PX - HALF, HALF - (yy + 0.5) * PX) < 720
fx = {
    'schema': 'gev-city-diorama-fixture@2',
    'licence': 'ODbL-1.0',
    'licenceUrl': 'https://opendatacommons.org/licenses/odbl/1-0/',
    'copyright': 'https://www.openstreetmap.org/copyright',
    'attribution': '© OpenStreetMap contributors',
    'source': f'Overpass API (overpass-api.de / maps.mail.ru mirror), fetched {datetime.date.today().isoformat()}; transformed by build_fixture_loc.py (local metres, water raster from OSM water areas, waterways and natural=coastline)',
    'location': name,
    'label': c['label'],
    'plot': c['plot'],
    'centre': {'lat': lat0, 'lon': lon0},
    'radiusMeters': R,
    'units': 'local east/north metres from centre',
    'buildings': buildings,
    'roads': roads,
    'areas': areas,
    'trees': trees,
    'water': {'cell': PX, 'half': HALF, 'n': S, 'rows': 'top (north) to bottom; [bodyId, run] pairs west to east; 0 = land', 'rle': rows},
}
json.dump(fx, open(out, 'w'), separators=(',', ':'))
print(json.dumps({'buildings': len(buildings), 'roads': len(roads), 'areas': len(areas), 'trees': len(trees), 'waterBodies': int(lab.max()),
                  'waterShareDisc': round(float((lab > 0)[disc].mean()), 3), 'bytes': os.path.getsize(out)}))
