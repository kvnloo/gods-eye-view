"""Unit checks only: invented numbers, no network, no simulator, no study values."""
import importlib.util
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


counts = load('observed_counts_under_test', 'observed-counts.py')
runner = load('observed_runner_under_test', 'run-observed-corridor.py')
FIXTURE = json.loads(runner.FIXTURE.read_text(encoding='utf-8'))


def sheet(name, start_hour, suffix, order=('Southbound', 'Westbound', 'Northbound', 'Eastbound'),
          spoil=None):
    """An invented sheet in the published layout: approach k, interval n -> [k+1, 10n+k, 2, 1]."""
    lines = [f'City of Nowhere      File Name : {name}', 'N/S: A Street     Site Code : 0',
             'E/W: B Street     Start Date : 1/1/2000', 'Weather: Clear    Page No : 1', '',
             '      ' + counts.SHEET_GROUPS, '   ' + '   '.join(order),
             ' Start Time ' + ' Left Thru Right RTOR App. Total' * 4 + ' Exclu. Total Inclu. Total Int. Total']
    for n in range(8):
        cells, included = [], 0
        for k in range(4):
            movement = [k + 1, 10 * n + k, 2, 1]
            cells += movement + [sum(movement[:3])]
            included += sum(movement[:3])
        cells += [4, included, included + 4]
        if spoil == n:
            cells[1] += 1
        minutes = start_hour * 60 + 15 * n
        lines.append(f'   {minutes // 60:02d}:{minutes % 60:02d} {suffix} ' + ' '.join(map(str, cells)))
    return '\n'.join(lines + ['  Grand Total 1 2 3', ''])


def worksheet(number, lanes='2 0 2 0 1   1 0 2 1 0   0 0 1! 0 0   1 0 3 0 2'):
    return (f'Intersection #{number} A St. & B St.\n****\nCycle (sec): 100\n'
            'Approach:      North Bound      South Bound       East Bound       West Bound\n'
            'Movement:     L - T - R        L - T - R        L - T - R        L - T - R\n'
            f'Lanes:        {lanes}\nVolume Module:\nLanes:  2.00 2.00 1.00\n')


def study_text():
    parts = []
    for place in FIXTURE['intersections']:
        parts += [sheet(f"{place['sheet']} AM", 7, 'AM'), sheet(f"{place['sheet']} PM", 4, 'PM'),
                  worksheet(place['worksheet'])]
    return '\n'.join(parts)


def derived():
    text = study_text()
    return {'counts': {p['sheet']: {w['id']: counts.parse_sheet(text, f"{p['sheet']} {w['id']}", w['start'])
                                    for w in FIXTURE['source']['windows']} for p in FIXTURE['intersections']},
            'lanes': {p['sheet']: counts.parse_lanes(text, p['worksheet']) for p in FIXTURE['intersections']}}


class ObservedCountTests(unittest.TestCase):
    def test_geh_formula(self):
        self.assertEqual(counts.geh(0, 0), 0)
        self.assertEqual(counts.geh(1000, 1000), 0)
        self.assertAlmostEqual(counts.geh(1100, 1000), 3.0861, places=4)
        self.assertAlmostEqual(counts.geh(600, 1200), 20.0, places=4)
        with self.assertRaises(ValueError):
            counts.geh(-1, 10)

    def test_sheet_parse_keeps_movements_and_proves_printed_totals(self):
        parsed = counts.parse_sheet(sheet('X AM', 7, 'AM'), 'X AM', '07:00')
        self.assertEqual(parsed['Southbound'][0], [1, 0, 2, 1])
        self.assertEqual(parsed['Eastbound'][7], [4, 73, 2, 1])
        self.assertEqual(len(parsed['Westbound']), 8)
        self.assertEqual(counts.parse_sheet(sheet('X PM', 4, 'PM'), 'X PM', '04:00'), parsed)

    def test_sheet_with_wrong_totals_short_rows_or_other_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'totals'):
            counts.parse_sheet(sheet('X AM', 7, 'AM', spoil=3), 'X AM', '07:00')
        with self.assertRaisesRegex(ValueError, 'consecutive'):
            counts.parse_sheet(sheet('X AM', 7, 'AM'), 'X AM', '07:15')
        with self.assertRaisesRegex(ValueError, 'not found'):
            counts.parse_sheet(sheet('X AM', 7, 'AM'), 'Y AM', '07:00')

    def test_lane_worksheet_and_shared_lane(self):
        lanes = counts.parse_lanes(worksheet(3) + worksheet(30, '9 9 9 9 9 ' * 4), 3)
        self.assertEqual(lanes['Northbound'], ['2', '0', '2', '0', '1'])
        self.assertEqual(counts.lane_moves(lanes['Northbound']), ['r', 't', 't', 'l', 'l'])
        self.assertEqual(counts.lane_moves(lanes['Southbound']), ['tr', 't', 't', 'l'])
        self.assertEqual(counts.lane_moves(lanes['Eastbound']), ['ltr'])
        with self.assertRaisesRegex(ValueError, 'not found'):
            counts.parse_lanes(worksheet(3), 4)

    def test_edited_counts_or_changed_source_stop_the_run(self):
        fixture = json.loads(json.dumps(FIXTURE))
        with patch.object(counts, 'fetch_text', return_value=study_text()):
            fixture['source']['derivedSha256'] = counts.canonical_hash(derived())
            self.assertEqual(counts.load_observed(fixture, 'unused'), derived())
        edited = study_text().replace(' 4 73 2 1 79 ', ' 4 72 3 1 79 ', 1)
        self.assertNotEqual(edited, study_text())
        with patch.object(counts, 'fetch_text', return_value=edited):
            with self.assertRaisesRegex(ValueError, 'never edited'):
                counts.load_observed(fixture, 'unused')
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'source.pdf').write_bytes(b'not the cited study')
            with self.assertRaisesRegex(ValueError, 'pinned hash'):
                counts.fetch_text(FIXTURE['source'], directory)

    def test_model_heading_maps_back_to_the_sheet_compass(self):
        rose, yorba = FIXTURE['intersections'][0], FIXTURE['intersections'][4]
        self.assertEqual([counts.real_direction(rose, h) for h in 'ESWN'],
                         ['Eastbound', 'Southbound', 'Westbound', 'Northbound'])
        self.assertEqual([counts.real_direction(yorba, h) for h in 'ESWN'],
                         ['Southbound', 'Westbound', 'Northbound', 'Eastbound'])
        # right-on-red vehicles are part of the approach volume
        self.assertEqual(counts.movements(derived(), rose, 'S', 'AM')[0], [1, 0, 3])

    def test_scored_set_is_fixed_and_absent_is_not_zero(self):
        scored = counts.scored_count_hours(FIXTURE, derived())
        self.assertEqual(len(scored), FIXTURE['scoring']['countHours'])
        self.assertEqual(len({item['id'] for item in scored}), 32)
        self.assertEqual({item['id'][-2:] for item in scored}, set(FIXTURE['scoring']['hours']))
        first = scored[0]
        self.assertEqual(first['id'], 'm0e@07')       # towards SR-91 at Prospect, model heading E
        self.assertEqual(first['observed'], sum(4 + 10 * n + 3 + 2 + 1 for n in range(4)))
        exact = {item['id']: item['observed'] for item in scored}
        self.assertEqual(counts.score(scored, exact)['share'], 1)
        missing = dict(exact)
        del missing['m0e@07']
        result = counts.score(scored, missing)
        self.assertEqual((result['passed'], result['absent']), (31, 1))
        self.assertIsNone(result['rows'][0]['geh'])
        self.assertFalse(result['rows'][0]['pass'])
        zero = counts.score(scored, {**exact, 'm0e@07': 0})
        self.assertEqual(zero['absent'], 0)
        self.assertGreater(zero['rows'][0]['geh'], 5)

    def test_fixture_stores_no_study_value_and_tags_every_parameter(self):
        self.assertNotIn('counts', FIXTURE)
        self.assertIn('not cleared', FIXTURE['source']['redistribution'])
        for name, parameter in FIXTURE['parameters'].items():
            self.assertTrue(parameter.get('source') or parameter.get('status') == 'ASSUMED', name)
        self.assertEqual(FIXTURE['steps'][0], {**FIXTURE['steps'][0], 'id': 'S0', 'set': {}})
        for step in FIXTURE['steps'][1:]:
            self.assertEqual(len(step['set']), 1, step['id'])   # one change per step
            self.assertTrue(step.get('source'), step['id'])


class RunnerTests(unittest.TestCase):
    def test_edges_and_turns(self):
        self.assertEqual(runner.arrival('m0e'), (1, 'E'))
        self.assertEqual(runner.arrival('m3w'), (3, 'W'))
        self.assertEqual(runner.arrival('N2in'), (2, 'S'))
        self.assertIsNone(runner.arrival('S2out'))
        self.assertEqual([runner.turned('E', m) for m in 'ltr'], ['N', 'E', 'S'])
        self.assertEqual(runner.out_edge(2, runner.turned('S', 'l')), 'm2e')   # southbound left heads east
        self.assertEqual(runner.in_edge(2, 'N'), 'S2in')

    def test_routes_follow_shares_and_end_at_the_boundary(self):
        rng = random.Random(1)
        self.assertEqual(runner.sample_route(rng, 'm0e', lambda *_: (0, 1, 0), 0),
                         ['m0e', 'm1e', 'm2e', 'm3e'])
        self.assertEqual(runner.sample_route(rng, 'm3w', lambda *_: (1, 0, 0), 0), ['m3w', 'S3out'])
        self.assertEqual(runner.sample_route(rng, 'N1in', lambda *_: (0, 0, 1), 0), ['N1in', 'm0w'])
        self.assertEqual(runner.sample_route(rng, 'S2in', lambda *_: (0, 0, 0), 0), ['S2in', 'N2out'])

    def test_demand_is_repeatable_and_counted_intervals_are_exact(self):
        entries = {'m0e': ([5] * 9, True), 'N1in': ([30.0] * 9, False), 'S1in': ([0] * 9, False)}
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / 'a.xml', Path(directory) / 'b.xml'
            total = runner.write_demand(first, entries, lambda *_: (0, 1, 0), 7)
            self.assertEqual(total, runner.write_demand(second, entries, lambda *_: (0, 1, 0), 7))
            self.assertEqual(first.read_bytes(), second.read_bytes())
            runner.write_demand(second, entries, lambda *_: (0, 1, 0), 19)
            self.assertNotEqual(first.read_bytes(), second.read_bytes())
            vehicles = ET.parse(first).getroot().findall('vehicle')
            mainline = [float(v.get('depart')) for v in vehicles if v.find('route').get('edges').startswith('m0e')]
            self.assertEqual(len(mainline), 45)
            self.assertEqual([sum(900 * n <= t < 900 * (n + 1) for t in mainline) for n in range(9)], [5] * 9)

    def test_sourced_network_matches_the_stack_ids_and_lane_groups(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            runner.build_sourced_network(out, FIXTURE, derived())
            edges = {e.get('id'): e for e in ET.parse(out / 'edges.xml').getroot()}
            stack_out = out / 'stack'
            stack_out.mkdir()
            runner.stack.build_inputs(stack_out)
            self.assertEqual(set(edges), {e.get('id') for e in ET.parse(stack_out / 'edges.xml').getroot()})
            nodes = {n.get('id'): float(n.get('x')) for n in ET.parse(out / 'nodes.xml').getroot()}
            self.assertEqual([nodes[f'J{i}'] for i in range(5)], [0, 491, 1120, 2801, 3207])
            connections = ET.parse(out / 'connections.xml').getroot().findall('connection')
            pairs = {(c.get('from'), c.get('to')) for c in connections}
            self.assertEqual(len(pairs), 36)                      # 3 signals x 4 approaches x 3 movements
            self.assertIn(('N2in', 'm2e'), pairs)                 # left from the north leg
            for c in connections:
                self.assertLess(int(c.get('fromLane')), int(edges[c.get('from')].get('numLanes')))
                self.assertLess(int(c.get('toLane')), int(edges[c.get('to')].get('numLanes')))

    def test_hourly_counts_keep_a_missing_interval_absent(self):
        root = ET.Element('meandata')
        for index in range(9):
            if index == 6:
                continue
            interval = ET.SubElement(root, 'interval', begin=f'{900 * index}.00', end=f'{900 * index + 900}.00')
            ET.SubElement(interval, 'edge', id='m0e', left='10', arrived='0')
            ET.SubElement(interval, 'edge', id='m3e', left='0', arrived='7')
            ET.SubElement(interval, 'edge', id='m0w', sampledSeconds='0.00')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'edgedata.xml'
            ET.ElementTree(root).write(path)
            simulated = runner.hourly_counts(path, {'id': 'AM', 'firstHour': 7}, ['m0e', 'm3e', 'm0w', 'm1e'])
        self.assertEqual(simulated, {'m0e@07': 40, 'm3e@07': 28, 'm0w@07': 0})

    def test_step_settings_accumulate_and_unknown_step_fails(self):
        settings, change = runner.settings_for(FIXTURE, 'S0')
        self.assertEqual(settings, FIXTURE['defaults'])
        self.assertIn('none', change)
        with self.assertRaises(ValueError):
            runner.settings_for(FIXTURE, 'S99')


if __name__ == '__main__':
    unittest.main()
