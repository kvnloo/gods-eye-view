#!/usr/bin/env python3
# FORK-ONLY record (exp/city-loop-v4): the transform that made the schema @1
# public/city-diorama/north-beach{,-r700}.osm.json (ODbL 4.6: the method of alteration).
# Those inputs came from the OSM editing API (api 0.6 /map), which the OSM API usage
# policy reserves for editing. Do not fetch from it again: refresh with
# refresh_fixture.sh (Overpass) and build_fixture_loc.py instead.
"""OSM XML (api 0.6 /map) -> compact diorama fixture JSON in local ENU metres
around a centre. Data (c) OpenStreetMap contributors, ODbL 1.0.
usage: build_fixture.py map.osm[,more.osm] out.json lat lon radius"""
import json, math, sys, xml.etree.ElementTree as ET

src, out, lat0, lon0, R = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:6])
M = 111_320.0
kx = M * math.cos(math.radians(lat0))


def en(lat, lon):
    return [round((lon - lon0) * kx, 1), round((lat - lat0) * M, 1)]


roots = [ET.parse(f).getroot() for f in src.split(',')]
nodes, ways = {}, {}
trees = []
seen_tree = set()
class _All:
    def iter(self, tag):
        seen = set()
        for r in roots:
            for e in r.iter(tag):
                i = e.get('id')
                if i in seen:
                    continue
                seen.add(i)
                yield e
root = _All()
for n in root.iter('node'):
    p = en(float(n.get('lat')), float(n.get('lon')))
    nodes[n.get('id')] = p
    tags = {t.get('k'): t.get('v') for t in n.iter('tag')}
    if tags.get('natural') == 'tree' and math.hypot(*p) < R:
        trees.append(p)
for w in root.iter('way'):
    ways[w.get('id')] = ([nd.get('ref') for nd in w.iter('nd')], {t.get('k'): t.get('v') for t in w.iter('tag')})


def pts(refs):
    return [nodes[r] for r in refs if r in nodes]


def near(ps, r):
    return any(math.hypot(*p) < r for p in ps)


def num(v):
    try:
        return float(str(v).split(';')[0].replace('m', '').strip())
    except Exception:
        return None


buildings, roads, areas = [], [], []
GREEN = {'park', 'garden', 'playground', 'pitch', 'grass', 'recreation_ground', 'forest', 'meadow', 'wood', 'scrub', 'grassland', 'village_green'}
for wid, (refs, tags) in ways.items():
    ps = pts(refs)
    if len(ps) < 2:
        continue
    if 'building' in tags and len(ps) >= 4 and ps[0] == ps[-1] and near(ps, R):
        h = num(tags.get('height'))
        lv = num(tags.get('building:levels'))
        buildings.append({'p': ps[:-1], 'h': h, 'lv': lv, 'k': tags.get('building'), 'n': tags.get('name')})
    elif 'highway' in tags and near(ps, R + 60):
        roads.append({'p': ps, 't': tags['highway'], 'n': tags.get('name')})
    else:
        kind = tags.get('leisure') or tags.get('landuse') or tags.get('natural')
        if kind in GREEN or kind == 'water':
            if ps[0] == ps[-1] and near(ps, R + 60):
                areas.append({'p': ps[:-1], 'k': kind, 'n': tags.get('name')})
# multipolygon relations: outer rings of parks / buildings
for r in root.iter('relation'):
    tags = {t.get('k'): t.get('v') for t in r.iter('tag')}
    if tags.get('type') != 'multipolygon':
        continue
    kind = 'building' if 'building' in tags else (tags.get('leisure') or tags.get('landuse') or tags.get('natural'))
    for m in r.iter('member'):
        if m.get('type') == 'way' and m.get('role') == 'outer' and m.get('ref') in ways:
            ps = pts(ways[m.get('ref')][0])
            if len(ps) >= 4 and ps[0] == ps[-1] and near(ps, R):
                if kind == 'building':
                    buildings.append({'p': ps[:-1], 'h': num(tags.get('height')), 'lv': num(tags.get('building:levels')), 'k': tags.get('building'), 'n': tags.get('name')})
                elif kind in GREEN or kind == 'water':
                    areas.append({'p': ps[:-1], 'k': kind, 'n': tags.get('name')})
fx = {
    'schema': 'gev-city-diorama-fixture@1',
    'licence': 'ODbL-1.0',
    'attribution': '© OpenStreetMap contributors',
    'source': 'https://api.openstreetmap.org/api/0.6/map (fetched 2026-11-22)',
    'centre': {'lat': lat0, 'lon': lon0},
    'radiusMeters': R,
    'units': 'local east/north metres from centre',
    'buildings': buildings,
    'roads': roads,
    'areas': areas,
    'trees': trees,
}
json.dump(fx, open(out, 'w'), separators=(',', ':'))
print(json.dumps({'buildings': len(buildings), 'withHeight': sum(b['h'] is not None for b in buildings), 'withLevels': sum(b['lv'] is not None for b in buildings), 'roads': len(roads), 'areas': len(areas), 'areaNames': sorted({a['n'] for a in areas if a['n']}), 'trees': len(trees)}))
