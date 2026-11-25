#!/usr/bin/env python3
"""osm_geo.py: stdlib-only geometry over a gev-city-diorama fixture (OSM, ODbL).

Used by sanity_gate.py. A fixture (public/city-diorama/*.osm.json) holds OSM
buildings, roads and areas in local east/north metres from its `centre`
(x = (lon - lon0) * kx, y = (lat - lat0) * M, M = 111 320, kx = M cos lat0)
and, from schema @2, a 4 m run-length water raster (OSM water/wetland areas,
waterways, and the sea rebuilt from natural=coastline). Optionally a raw
Overpass XML file adds the vector coastline and water outlines, so a footprint
edge that crosses the shore is caught even where the raster rounds it away.
No numpy/shapely, so it runs anywhere the harness runs.
"""
import json
import math
import xml.etree.ElementTree as ET

M = 111_320.0


# ---------- plane geometry (local metres)
def area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def centroid(poly):
    a = area(poly)
    if abs(a) < 1e-9:
        return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    cx = cy = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        k = x0 * y1 - x1 * y0
        cx += (x0 + x1) * k
        cy += (y0 + y1) * k
    return (cx / (6 * a), cy / (6 * a))


def inside(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def _orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def seg_cross(p1, p2, q1, q2):
    d1, d2 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    d3, d4 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def seg_point_dist(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def polys_overlap(a, b):
    """True when two simple polygons share interior area (edge crossing or containment)."""
    for i in range(len(a)):
        for j in range(len(b)):
            if seg_cross(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    return inside(centroid(a), b) or inside(centroid(b), a) or inside(a[0], b) or inside(b[0], a)


def inset(poly, d):
    """Move every vertex `d` metres towards the centroid along the bisector (convex quads)."""
    cx, cy = centroid(poly)
    out = []
    for x, y in poly:
        L = math.hypot(x - cx, y - cy) or 1.0
        k = max(0.0, L - d * math.sqrt(2)) / L
        out.append((cx + (x - cx) * k, cy + (y - cy) * k))
    return out


def sample_poly(poly, step=1.0):
    """Points on the outline every `step` m plus an interior lattice every `step` m."""
    pts = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        k = max(1, int(math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step)))
        pts += [(a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k) for t in range(k)]
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if inside((x, y), poly):
                pts.append((x, y))
            x += step
        y += step
    return pts


def bearing_mod90(a, b):
    """Edge orientation in degrees clockwise from north, folded into [0, 90)."""
    ang = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1]))
    return ang % 90.0


def ang_diff90(a, b):
    d = abs((a - b) % 90.0)
    return min(d, 90.0 - d)


def poly_yaw(poly):
    """Orientation (mod 90) of a quad/polygon: length-weighted circular mean of its edges."""
    sx = sy = 0.0
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        t = math.radians(bearing_mod90(a, b) * 4)
        sx += L * math.cos(t)
        sy += L * math.sin(t)
    return (math.degrees(math.atan2(sy, sx)) / 4) % 90.0


# ---------- fixture
class Fixture:
    def __init__(self, path, osm_xml=None):
        d = json.load(open(path))
        self.path = path
        self.schema = d.get('schema')
        self.lat0 = d['centre']['lat']
        self.lon0 = d['centre']['lon']
        self.kx = M * math.cos(math.radians(self.lat0))
        self.buildings = [[tuple(p) for p in b['p']] for b in d.get('buildings', []) if len(b.get('p', [])) >= 3]
        self.roads = [(r.get('t'), [tuple(p) for p in r['p']]) for r in d.get('roads', []) if len(r.get('p', [])) >= 2]
        self.areas = [(a.get('k'), a.get('n'), [tuple(p) for p in a['p']]) for a in d.get('areas', [])]
        w = d.get('water')
        self.water = None
        if w:
            n = int(w['n'])
            grid = []
            for row in w['rle']:
                line = []
                for body, run in row:
                    line += [body] * run
                grid.append(line)
            self.water = {'cell': float(w['cell']), 'half': float(w['half']), 'n': n, 'grid': grid}
        self.water_lines = []  # vector shore/water outlines from raw OSM (local metres)
        if osm_xml:
            self._load_osm(osm_xml)

    def _load_osm(self, path):
        root = ET.parse(path).getroot()
        nodes = {n.get('id'): self.local(float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
        for w in root.iter('way'):
            tags = {t.get('k'): t.get('v') for t in w.iter('tag')}
            water = tags.get('natural') in ('coastline', 'water', 'wetland') or tags.get('landuse') in ('reservoir', 'basin') or tags.get('waterway') == 'riverbank'
            if not water:
                continue
            ps = [nodes[nd.get('ref')] for nd in w.iter('nd') if nd.get('ref') in nodes]
            if len(ps) >= 2:
                self.water_lines.append((tags.get('natural') or tags.get('landuse') or 'water', ps))
        # members of water multipolygons (their ways often carry no tags of their own)
        ways = {w.get('id'): w for w in root.iter('way')}
        for rel in root.iter('relation'):
            tags = {t.get('k'): t.get('v') for t in rel.iter('tag')}
            if tags.get('type') != 'multipolygon' or tags.get('natural') not in ('water', 'wetland'):
                continue
            for m in rel.iter('member'):
                w = ways.get(m.get('ref')) if m.get('type') == 'way' else None
                if w is None:
                    continue
                ps = [nodes[nd.get('ref')] for nd in w.iter('nd') if nd.get('ref') in nodes]
                if len(ps) >= 2:
                    self.water_lines.append((tags.get('natural'), ps))

    def local(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * M)

    def lonlat(self, x, y):
        return (self.lon0 + x / self.kx, self.lat0 + y / M)

    def water_at(self, x, y):
        """Water body id at a local point (0 = land), None outside the raster or without one."""
        w = self.water
        if not w:
            return None
        i = int(math.floor((x + w['half']) / w['cell']))
        j = int(math.floor((w['half'] - y) / w['cell']))
        if not (0 <= i < w['n'] and 0 <= j < w['n']):
            return None
        return w['grid'][j][i]

    def water_hits(self, poly, tol=0.5, step=1.0):
        """Points of `poly` (inset by `tol`) on raster water, and footprint edges crossing a vector shore."""
        core = inset(poly, tol)
        pts = [p for p in sample_poly(core, step) if (self.water_at(*p) or 0) > 0]
        crossings = []
        n = len(core)
        for kind, line in self.water_lines:
            for k in range(len(line) - 1):
                a, b = line[k], line[k + 1]
                if max(a[0], b[0]) < min(p[0] for p in core) - 1 or min(a[0], b[0]) > max(p[0] for p in core) + 1:
                    continue
                if max(a[1], b[1]) < min(p[1] for p in core) - 1 or min(a[1], b[1]) > max(p[1] for p in core) + 1:
                    continue
                if any(seg_cross(core[i], core[(i + 1) % n], a, b) for i in range(n)) or inside(a, core):
                    crossings.append(kind)
                    break
        return {'waterPoints': len(pts), 'samples': len(sample_poly(core, step)), 'shoreCrossings': len(crossings), 'kinds': sorted(set(crossings))}

    def street_orientation(self, x, y, radius=150.0, kinds=None):
        """Dominant street orientation (deg mod 90) within `radius` m: length-weighted, 4-fold circular mean
        of the peak of a 1-degree histogram. Returns (deg, strength 0..1, metres counted)."""
        hist = [0.0] * 90
        total = 0.0
        for t, line in self.roads:
            if kinds and t not in kinds:
                continue
            if t in ('footway', 'path', 'steps', 'cycleway', 'motorway', 'motorway_link', 'track', 'service'):
                continue
            for k in range(len(line) - 1):
                a, b = line[k], line[k + 1]
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if math.hypot(mid[0] - x, mid[1] - y) > radius:
                    continue
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L < 0.5:
                    continue
                hist[int(bearing_mod90(a, b)) % 90] += L
                total += L
        if total <= 0:
            return (None, 0.0, 0.0)
        # smooth with a +-3 deg window (circular), take the peak, refine with a circular mean around it
        sm = [sum(hist[(i + d) % 90] for d in range(-3, 4)) for i in range(90)]
        peak = max(range(90), key=lambda i: sm[i])
        sx = sy = w = 0.0
        for d in range(-6, 7):
            i = (peak + d) % 90
            t = math.radians((i + 0.5) * 4)
            sx += hist[i] * math.cos(t)
            sy += hist[i] * math.sin(t)
            w += hist[i]
        deg = (math.degrees(math.atan2(sy, sx)) / 4) % 90.0
        return (deg, w / total, total)

    def building_orientation(self, x, y, radius=120.0):
        """Dominant orientation (mod 90) of building edges within `radius` m, length-weighted."""
        hist = [0.0] * 90
        total = 0.0
        for b in self.buildings:
            c = centroid(b)
            if math.hypot(c[0] - x, c[1] - y) > radius:
                continue
            for i in range(len(b)):
                p, q = b[i], b[(i + 1) % len(b)]
                L = math.hypot(q[0] - p[0], q[1] - p[1])
                if L < 1:
                    continue
                hist[int(bearing_mod90(p, q)) % 90] += L
                total += L
        if total <= 0:
            return (None, 0.0)
        sm = [sum(hist[(i + d) % 90] for d in range(-3, 4)) for i in range(90)]
        peak = max(range(90), key=lambda i: sm[i])
        return (peak + 0.5, sm[peak] / total)

    def buildings_overlapping(self, poly):
        out = []
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        for k, b in enumerate(self.buildings):
            bx = [p[0] for p in b]
            by = [p[1] for p in b]
            if max(bx) < min(xs) or min(bx) > max(xs) or max(by) < min(ys) or min(by) > max(ys):
                continue
            if polys_overlap(poly, b):
                out.append(k)
        return out
