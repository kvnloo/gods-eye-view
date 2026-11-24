import math
import unittest

from sanity_gate import evaluate


class FlatSite:
    def local(self, lon, lat):
        return lon, lat

    def street_orientation(self, x, y):
        return 0, 1, 100

    def water_at(self, x, y):
        return 0

    def water_hits(self, poly, tol):
        return {'waterPoints': 0, 'shoreCrossings': 0}

    def buildings_overlapping(self, poly):
        return []


class SanityGateTest(unittest.TestCase):
    def setUp(self):
        self.placement = {
            'id': 'plot', 'kind': 'massing', 'base': 10,
            'footprint': [(0, 0), (4, 0), (4, 4), (0, 4)], 'terrain': [10] * 5,
        }
        self.frame = {
            'beat': 'build', 'expectedPlace': 'Sausalito', 'hud': 'SAUSALITO',
            'placements': [self.placement],
        }

    def test_correct_placement(self):
        self.assertEqual(evaluate(self.frame, FlatSite()), {'pass': True, 'failures': []})

    def test_bad_placement(self):
        theta = math.radians(25)
        c, s = math.cos(theta), math.sin(theta)
        self.placement['footprint'] = [
            (x * c - y * s, x * s + y * c) for x, y in self.placement['footprint']
        ]
        self.placement['base'] = 9
        self.frame['hud'] = 'SAN FRANCISCO'
        site = FlatSite()
        site.water_hits = lambda poly, tol: {'waterPoints': 1, 'shoreCrossings': 0}
        site.buildings_overlapping = lambda poly: [poly]
        result = evaluate(self.frame, site)
        self.assertFalse(result['pass'])
        yaw = next(f for f in result['failures'] if f['check'] == 'yaw')
        self.assertEqual(yaw, {'check': 'yaw', 'id': 'plot', 'delta_deg': 25.0, 'yaw_deg': 65.0, 'street': 0})
        self.assertEqual(
            {f['check'] for f in result['failures']},
            {'yaw', 'sunk', 'water', 'existing-building', 'hud-place'},
        )

    def test_missing_evidence(self):
        self.placement['terrain'] = [None] * 5
        result = evaluate(self.frame, FlatSite())
        self.assertFalse(result['pass'])
        self.assertEqual(result['failures'][0]['check'], 'missing-terrain')
