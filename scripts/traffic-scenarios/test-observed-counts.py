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
        # every printed total still adds up; only "more on red than turned right" is wrong
        on_red = sheet('X AM', 7, 'AM').replace(' 1 0 2 1 3 ', ' 1 0 2 3 3 ', 1).replace(' 4 24 28', ' 6 24 30', 1)
        self.assertNotIn(' 4 24 28', on_red)
        self.assertIn(' 1 0 2 3 3 ', on_red)
        with self.assertRaisesRegex(ValueError, 'totals'):
            counts.parse_sheet(on_red, 'X AM', '07:00')
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
        # right-on-red vehicles are already inside "right"; adding them would count them twice
        self.assertEqual(counts.movements(derived(), rose, 'S', 'AM')[0], [1, 0, 2])

    def test_scored_set_is_fixed_and_absent_is_not_zero(self):
        scored = counts.scored_count_hours(FIXTURE, derived())
        self.assertEqual(len(scored), FIXTURE['scoring']['countHours'])
        self.assertEqual(len({item['id'] for item in scored}), 32)
        self.assertEqual({item['id'][-2:] for item in scored}, set(FIXTURE['scoring']['hours']))
        first = scored[0]
        self.assertEqual(first['id'], 'm0e@07')       # towards SR-91 at Prospect, model heading E
        self.assertEqual(first['observed'], sum(4 + 10 * n + 3 + 2 for n in range(4)))
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

    def test_caltrans_step_uses_half_the_two_way_peak_hour_at_each_end(self):
        settings, _ = runner.settings_for(FIXTURE, 'S2')
        self.assertEqual(settings, {**FIXTURE['defaults'], 'network': 'sourced', 'mainline': 'caltrans'})
        entries, shares = runner.demand_inputs(FIXTURE, derived(), settings, 'AM')
        self.assertEqual(entries['m0e'], ([4300 / 2 / 4] * 9, False))
        self.assertEqual(entries['m3w'], ([4400 / 2 / 4] * 9, False))
        self.assertEqual(entries['N2in'], ([30.0] * 9, False))
        self.assertEqual(shares(2, 'E', 5), (0, 1, 0))

    def test_boundary_step_feeds_the_volumes_that_left_the_boundary_intersections(self):
        settings, _ = runner.settings_for(FIXTURE, 'S3')
        self.assertEqual(settings['mainline'], 'counts')
        entries, _ = runner.demand_inputs(FIXTURE, derived(), settings, 'PM')
        # invented sheet: approach k (S, W, N, E order), interval n -> [left k+1, thru 10n+k, right 2]
        # Rose (compass = model): heading E takes Eastbound thru (10n+3) + Southbound left (1) + Northbound right (2)
        self.assertEqual(entries['m0e'], ([6] + [10 * n + 6 for n in range(8)], True))
        # Yorba Linda (model W is Northbound): Northbound thru (10n+2) + Eastbound left (4) + Westbound right (2)
        self.assertEqual(entries['m3w'], ([8] + [10 * n + 8 for n in range(8)], True))
        self.assertEqual(entries['S1in'], ([30.0] * 9, False))

    def test_signal_step_changes_the_control_type_only(self):
        before, after = (runner.settings_for(FIXTURE, step)[0] for step in ('S3', 'S4'))
        self.assertEqual((before['signals'], after['signals']), ('fixed', 'actuated'))
        self.assertEqual({k: v for k, v in after.items() if k != 'signals'},
                         {k: v for k, v in before.items() if k != 'signals'})
        self.assertEqual(FIXTURE['parameters']['actuatedTimings']['status'], 'ASSUMED')

    def test_turning_step_uses_the_counted_split_of_each_interval(self):
        settings, _ = runner.settings_for(FIXTURE, 'S5')
        _, shares = runner.demand_inputs(FIXTURE, derived(), settings, 'AM')
        # Bastanchury, model heading E is Southbound (k=0): [left 1, thru 10n, right 2]; warm-up reuses interval 0
        self.assertEqual(shares(2, 'E', 0), [1, 0, 2])
        self.assertEqual(shares(2, 'E', 1), [1, 0, 2])
        self.assertEqual(shares(2, 'E', 8), [1, 70, 2])
        self.assertEqual(shares(2, 'S', 3), [2, 21, 2])     # model S is Westbound (k=1)

    def test_cross_street_step_feeds_the_counted_approach_volumes(self):
        settings, _ = runner.settings_for(FIXTURE, 'S6')
        entries, _ = runner.demand_inputs(FIXTURE, derived(), settings, 'AM')
        # Prospect (compass = model): north leg is Southbound (k=0): 1 + 10n + 2; south leg is Northbound (k=2)
        self.assertEqual(entries['N1in'], ([3] + [10 * n + 3 for n in range(8)], True))
        self.assertEqual(entries['S1in'], ([7] + [10 * n + 7 for n in range(8)], True))
        # Lemon (model S is Westbound, k=1): 2 + (10n + 1) + 2
        self.assertEqual(entries['N3in'], ([5] + [10 * n + 5 for n in range(8)], True))
        self.assertEqual(len(entries), 8)

    def test_speed_step_sets_posted_limits_on_the_mainline_only(self):
        self.assertEqual(runner.settings_for(FIXTURE, 'S7')[0]['speed'], 'osm')
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            runner.build_sourced_network(out, FIXTURE, derived(), posted=True)
            speed = {e.get('id'): e.get('speed') for e in ET.parse(out / 'edges.xml').getroot()}
            self.assertEqual([speed[f'm{i}e'] for i in range(4)], ['22.35', '22.35', '22.35', '17.88'])
            self.assertEqual(speed['m3w'], '17.88')
            self.assertEqual(speed['N2in'], '13.89')
            runner.write_demand(out / 'd.xml', {'m0e': ([1] * 9, True)}, lambda *_: (0, 1, 0), 7, 22.35)
            self.assertEqual(ET.parse(out / 'd.xml').getroot().find('vType').get('maxSpeed'), '22.35')

    def test_flow_arithmetic_needs_no_simulator(self):
        stack_as_is, _ = runner.settings_for(FIXTURE, 'S1')
        predicted = runner.flow_arithmetic(FIXTURE, derived(), stack_as_is)
        self.assertEqual(len(predicted), 32)
        self.assertEqual({predicted[f'm{i}e@{hour}'] for i in range(4) for hour in ('07', '17')}, {600})
        self.assertEqual(predicted['m0w@08'], 300)
        turning, _ = runner.settings_for(FIXTURE, 'S6')
        predicted = runner.flow_arithmetic(FIXTURE, derived(), turning)
        # Prospect, heading E, interval n: 10n + 6 arrive; the next link gets their through share plus the
        # north leg's left (1 of 10n + 3) and the south leg's right (2 of 10n + 7)
        expected = sum((10 * n + 6) * (10 * n + 3) / (10 * n + 9) + (10 * n + 3) / (10 * n + 3)
                       + 2 * (10 * n + 7) / (10 * n + 7) for n in range(4))
        self.assertAlmostEqual(predicted['m1e@07'], expected)
        self.assertEqual(predicted['m0e@07'], sum(10 * n + 6 for n in range(4)))

    def test_a_rejected_step_is_not_carried_forward(self):
        fixture = json.loads(json.dumps(FIXTURE))
        fixture['steps'].append({'id': 'S99', 'change': 'x', 'set': {'cross': 'stack'}, 'source': 'x'})
        self.assertEqual(runner.settings_for(fixture, 'S7')[0]['speed'], 'osm')
        self.assertEqual(runner.settings_for(fixture, 'S99')[0]['speed'], 'stack')
        self.assertEqual(runner.settings_for(fixture, 'S99')[0]['signals'], 'actuated')

    def test_step_settings_accumulate_and_unknown_step_fails(self):
        settings, change = runner.settings_for(FIXTURE, 'S0')
        self.assertEqual(settings, FIXTURE['defaults'])
        self.assertIn('none', change)
        with self.assertRaises(ValueError):
            runner.settings_for(FIXTURE, 'S99')


if __name__ == '__main__':
    unittest.main()
