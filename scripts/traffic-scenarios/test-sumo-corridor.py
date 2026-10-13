"""Unit checks only. Real SUMO execution is the separate workflow step."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).with_name('run-sumo-corridor.py')
spec = importlib.util.spec_from_file_location('corridor', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CorridorTests(unittest.TestCase):
    def test_network_is_explicitly_synthetic_and_straight_only(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            routes = module.build_inputs(out)
            self.assertEqual(len(ET.parse(out / 'nodes.xml').getroot()), 11)
            self.assertEqual(len(ET.parse(out / 'edges.xml').getroot()), 20)
            self.assertEqual(len(ET.parse(out / 'connections.xml').getroot()), 12)
            self.assertEqual(len(routes), 8)
            self.assertEqual(routes['east'], 'm0e m1e m2e m3e')

    def test_demand_is_repeatable_and_differs_across_all_three_seeds(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            routes = module.build_inputs(out)
            hashes = []
            for seed in module.SEEDS:
                first, second = out / 'first.xml', out / 'second.xml'
                count = module.write_demand(first, routes, seed)
                self.assertEqual(count, module.write_demand(second, routes, seed))
                self.assertEqual(first.read_bytes(), second.read_bytes())
                vehicles = ET.parse(first).getroot().findall('vehicle')
                self.assertEqual(len(vehicles), count)
                self.assertTrue(all(v.get('id').startswith('synthetic-') for v in vehicles))
                times = [float(v.get('depart')) for v in vehicles]
                self.assertEqual(times, sorted(times))
                self.assertLessEqual(max(times), module.DEMAND_SECONDS)
                hashes.append(module.digest(first))
            self.assertEqual(len(set(hashes)), 3)

    def test_plan_changes_timing_without_mutating_network_or_clearance(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            root = ET.Element('net')
            for ident in ('J1', 'J2', 'J3'):
                logic = ET.SubElement(root, 'tlLogic', id=ident, programID='0', type='static')
                for duration, state in [('26', 'GGr r'.replace(' ', '')), ('3', 'yyrr'), ('1', 'rrrr')]:
                    ET.SubElement(logic, 'phase', duration=duration, state=state)
            network = out / 'network.xml'
            module.write_xml(network, root)
            before = network.read_bytes()
            fixed, actuated = out / 'fixed.xml', out / 'actuated.xml'
            module.write_plan(network, fixed, 'fixed')
            module.write_plan(network, actuated, 'actuated')
            self.assertEqual(network.read_bytes(), before)
            self.assertNotEqual(module.digest(fixed), module.digest(actuated))
            for left, right in zip(ET.parse(fixed).getroot(), ET.parse(actuated).getroot()):
                self.assertEqual(left.get('type'), 'static')
                self.assertEqual(right.get('type'), 'actuated')
                self.assertEqual(left[0].get('state'), right[0].get('state'))
                self.assertEqual(right[0].get('minDur'), '8')
                self.assertEqual(left[1].attrib, right[1].attrib)
                self.assertEqual(left[2].attrib, right[2].attrib)

    def test_real_netconvert_header_does_not_change_the_network_revision(self):
        # Trimmed from two real SUMO 1.24.0 runs of the same inputs. Only the
        # generated-on time and the local output directory differed.
        header = """<?xml version="1.0" encoding="UTF-8"?>

<!-- generated on {time} by Eclipse SUMO netconvert Version 1.24.0
<netconvertConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/netconvertConfiguration.xsd">

    <input>
        <node-files value="{directory}/nodes.xml"/>
    </input>

    <output>
        <output-file value="{directory}/corridor.net.xml"/>
    </output>

</netconvertConfiguration>
-->

"""
        body = """<net version="1.20" junctionCornerDetail="5" limitTurnSpeed="5.50" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/net_file.xsd">

    <location netOffset="0.00,200.00" convBoundary="0.00,0.00,1200.00,400.00" origBoundary="0.00,-200.00,1200.00,200.00" projParameter="!"/>

    <edge id=":J1_0" function="internal">
        <lane id=":J1_0_0" index="0" speed="13.89" length="14.40" shape="298.40,207.20 298.40,192.80"/>
    </edge>

</net>
"""
        runs = [('2026-11-13 06:42:36', '/home/user/traffic/runs/step1-a94a08cb/sumo-corridor'),
                ('2026-11-13 06:45:30', '/home/user/traffic/runs/step1b-a94a08cb/sumo-corridor')]
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for index, (time, source) in enumerate(runs):
                path = Path(directory) / f'{index}.net.xml'
                path.write_text(header.format(time=time, directory=source) + body, encoding='utf-8')
                paths.append(path)
            self.assertNotEqual(module.digest(paths[0]), module.digest(paths[1]))
            for path in paths:
                module.pin_network(path)
                self.assertNotIn(b'generated on', path.read_bytes())
                self.assertEqual(ET.parse(path).getroot().tag, 'net')
            self.assertEqual(module.digest(paths[0]), module.digest(paths[1]))
            # The pin still covers the road bytes: a changed lane is a new revision.
            paths[1].write_bytes(paths[1].read_bytes().replace(b'speed="13.89"', b'speed="8.33"'))
            self.assertNotEqual(module.digest(paths[0]), module.digest(paths[1]))
            # A second run-specific header must not pass as a pinned network.
            paths[0].write_text(header.format(time=runs[0][0], directory=runs[0][1]) * 2 + body, encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'run-specific header'):
                module.pin_network(paths[0])

    def test_trace_request_keeps_program_files_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            plan = out / 'fixed.add.xml'
            plan.write_text('<additional/>')
            before = plan.read_bytes()
            request = out / 'trace.add.xml'
            destination = out / 'switches.xml'
            module.write_trace_request(request, destination)
            self.assertEqual(plan.read_bytes(), before)
            root = ET.parse(request).getroot()
            events = root.findall('timedEvent')
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].get('type'), 'SaveTLSSwitchStates')
            self.assertEqual(events[0].get('dest'), str(destination.resolve()))

    def test_controller_trace_is_execution_evidence_not_plan_intent(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / 'switches.xml'

            def save(ids=('J1', 'J2', 'J3'), program='experiment-actuated'):
                root = ET.Element('tlsStates')
                for ident in ids:
                    ET.SubElement(root, 'tlsState', id=ident, time='21',
                                  state='Gr', programID=program, phase='1')
                module.write_xml(trace, root)

            save()
            proof = module.verify_active_signal_programs(trace, 'actuated')
            self.assertEqual(proof['controllers'], ['J1', 'J2', 'J3'])
            self.assertEqual(proof['programId'], 'experiment-actuated')
            self.assertEqual(proof['switchRecords'], 3)

            for ids, program in [
                (('J1', 'J2'), 'experiment-actuated'),
                (('J1', 'J2', 'J3'), 'experiment-fixed'),
                (('J1', 'J2', 'J4'), 'experiment-actuated'),
                ((), 'experiment-actuated'),
            ]:
                with self.subTest(ids=ids, program=program):
                    save(ids, program)
                    with self.assertRaises(ValueError):
                        module.verify_active_signal_programs(trace, 'actuated')
            trace.write_text('<bad/>')
            with self.assertRaises(ValueError):
                module.verify_active_signal_programs(trace, 'actuated')
            trace.unlink()
            with self.assertRaises(ValueError):
                module.verify_active_signal_programs(trace, 'actuated')

    def test_lost_vehicles_collisions_and_missing_safety_withhold_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'stats.xml'
            receipt = {'quality': {'coverage': 'complete', 'vehicleCounts': {'loaded': 100}}}
            path.write_text('<statistics><safety collisions="0" emergencyStops="0"/></statistics>')
            module.require_coverage(receipt, path, 100)
            with self.assertRaises(ValueError):
                module.require_coverage(receipt, path, 101)
            for xml in ['<statistics/>', '<statistics><safety collisions="1" emergencyStops="0"/></statistics>',
                        '<statistics><safety collisions="0" emergencyStops="1"/></statistics>']:
                path.write_text(xml)
                with self.assertRaises(ValueError):
                    module.require_coverage(receipt, path, 100)

    def test_missing_simulator_leaves_failed_receipt_not_synthetic_results(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module.shutil, 'which', return_value=None):
            out = Path(directory) / 'results'
            with self.assertRaisesRegex(RuntimeError, 'no simulator fallback'):
                module.main(['--output', str(out)])
            import json
            result = json.loads((out / 'summary.json').read_text())
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['pairs'], [])
            self.assertEqual(result['completedSimulationRuns'], 0)
            self.assertIn('Completed SUMO executions: 0', (out / 'summary.md').read_text())

    def test_zero_baseline_percentage_is_explicitly_undefined(self):
        self.assertEqual(module.format_change(None), 'n/a')
        self.assertEqual(module.format_change(0), '0.00%')
        self.assertEqual(module.format_change(-12.5), '-12.50%')


if __name__ == '__main__':
    unittest.main()
