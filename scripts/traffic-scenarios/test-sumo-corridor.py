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
