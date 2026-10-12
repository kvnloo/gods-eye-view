"""Source-only synthetic SUMO XML tests; not evidence of live or field results."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('sumo-statistics-receipt.py')
spec = importlib.util.spec_from_file_location('sumo_receipt', SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def metadata():
    return {
        'runId': 'synthetic-fixed-seed7',
        'planRevision': 'synthetic-fixed',
        'sumoOptions': {
            'tripinfoOutputWriteUnfinished': True,
            'durationLogStatistics': True,
        },
        'context': {
            'networkRevision': 'fixture:roads-1',
            'demandRevision': 'fixture:synthetic-demand-1',
            'inputEvidenceRevision': 'fixture:synthetic-1',
            'simulatorId': 'sumo',
            'simulatorVersion': 'fixture:unverified',
            'evaluationRevision': 'sumo-stats-complete-v1',
            'randomSeed': 7,
            'windowStartMs': 0,
            'windowEndMs': 60000,
        },
    }


def stats(*, loaded=4, inserted=4, running=0, waiting=0, count=4,
          teleports=0, time_loss='30.0', begin='0', end='60'):
    return (f'<statistics><performance begin="{begin}" end="{end}" />'
            f'<vehicles loaded="{loaded}" inserted="{inserted}" '
            f'running="{running}" waiting="{waiting}" />'
            f'<teleports total="{teleports}" />'
            f'<vehicleTripStatistics count="{count}" timeLoss="{time_loss}" '
            'duration="120.0" totalTravelTime="480.0" '
            'totalDepartDelay="12.0" /></statistics>').encode()


class SumoReceiptTests(unittest.TestCase):
    def test_finished_complete_metrics_are_simulation_only(self):
        result = mod.build_receipt(metadata(), stats())
        self.assertEqual(result['determination'], 'simulated')
        self.assertEqual(result['quality']['coverage'], 'complete')
        self.assertEqual(result['metrics']['meanVehicleTimeLossSeconds'], 30)
        self.assertEqual(result['metrics']['totalVehicleTravelTimeSeconds'], 480)
        self.assertEqual(len(result['sourceRef']), 71)
        self.assertTrue(result['sourceRef'].startswith('sha256:'))

    def test_zero_is_observed_zero_not_unknown(self):
        result = mod.build_receipt(metadata(), stats(time_loss='0.0'))
        self.assertEqual(result['metrics']['meanVehicleTimeLossSeconds'], 0)

    def test_censored_or_pending_traffic_never_looks_like_a_win(self):
        cases = [
            (dict(running=1), 'unfinished-or-waiting-vehicles'),
            (dict(waiting=1), 'unfinished-or-waiting-vehicles'),
            (dict(loaded=5), 'not-all-vehicles-inserted'),
            (dict(count=3), 'incomplete-trip-statistics'),
            (dict(teleports=1), 'simulator-teleports'),
            (dict(loaded=0, inserted=0, count=0), 'no-inserted-vehicles'),
        ]
        for kwargs, reason in cases:
            with self.subTest(kwargs=kwargs):
                result = mod.build_receipt(metadata(), stats(**kwargs))
                self.assertEqual(result['metrics'], {})
                self.assertEqual(result['quality']['coverage'], 'partial')
                self.assertIn(reason, result['quality']['reasonCodes'])

    def test_context_time_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'windowEndMs'):
            mod.build_receipt(metadata(), stats(end='59'))
        with self.assertRaisesRegex(ValueError, 'windowStartMs'):
            mod.build_receipt(metadata(), stats(begin='1'))

    def test_missing_and_invalid_output_does_not_fake_zero(self):
        for xml in [
            b'<statistics/>',
            b'<statistics><performance/><vehicles/></statistics>',
            stats(time_loss='nan'),
            stats(time_loss='-4'),
            stats(count=5),
            stats(loaded=-1),
            stats().replace(b'timeLoss="30.0" ', b''),
            stats().replace(b'<teleports total="0" />', b''),
            b'<!DOCTYPE foo [<!ENTITY x "xx">]><statistics/>',
            b'not xml',
        ]:
            with self.subTest(xml=xml[:40]):
                if b'timeLoss=' not in xml and b'<vehicleTripStatistics' in xml:
                    result = mod.build_receipt(metadata(), xml)
                    self.assertEqual(result['metrics'], {})
                    self.assertIn('missing-timeLoss', result['quality']['reasonCodes'])
                else:
                    with self.assertRaises(ValueError):
                        mod.build_receipt(metadata(), xml)

    def test_required_attested_options_and_identity(self):
        for mutate in [
            lambda m: m.pop('sumoOptions'),
            lambda m: m['context'].update(simulatorId='unknown'),
            lambda m: m['context'].update(randomSeed=True),
            lambda m: m.update(planRevision=''),
            lambda m: m['context'].update(windowEndMs=0),
        ]:
            m = metadata()
            mutate(m)
            with self.subTest(m=m), self.assertRaises(ValueError):
                mod.build_receipt(m, stats())

    def test_source_hash_is_byte_exact_and_deterministic(self):
        first = mod.build_receipt(metadata(), stats())
        self.assertEqual(first, mod.build_receipt(metadata(), stats()))
        self.assertNotEqual(first['sourceRef'], mod.build_receipt(metadata(), stats(time_loss='31'))['sourceRef'])

    def test_cli_writes_machine_readable_json_and_reports_invalid_xml(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            p = directory / 'metadata.json'
            q = directory / 'stat.xml'
            output = directory / 'result.json'
            p.write_text(json.dumps(metadata()), encoding='utf-8')
            q.write_bytes(stats())
            result = subprocess.run([sys.executable, str(SCRIPT), '--metadata', str(p),
                                     '--statistics', str(q), '--output', str(output)],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text())['quality']['coverage'], 'complete')
            q.write_bytes(b'<bad')
            fail = subprocess.run([sys.executable, str(SCRIPT), '--metadata', str(p),
                                   '--statistics', str(q)], capture_output=True, text=True, check=False)
            self.assertEqual(fail.returncode, 2)
            self.assertIn('invalid SUMO statistics XML', fail.stderr)

    def test_xml_to_json_to_node_comparator_contract(self):
        compare_script = Path(__file__).with_name('compare-sumo-receipts.mjs')
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            paths = []
            for ident, plan, loss in [('base', 'fixed', '40'), ('new', 'actuated', '30')]:
                m = metadata()
                m['runId'] = ident
                m['planRevision'] = plan
                xml = stats(time_loss=loss)
                output = directory / f'{ident}.json'
                output.write_text(json.dumps(mod.build_receipt(m, xml)), encoding='utf-8')
                paths.append(str(output))
            result = subprocess.run(['node', str(compare_script), *paths],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            comp = json.loads(result.stdout)
            self.assertEqual(comp['status'], 'comparable')
            self.assertEqual(comp['metrics']['meanVehicleTimeLossSeconds']['delta'], -10)
            self.assertEqual(comp['metrics']['meanPersonDelaySeconds']['status'], 'missing')

            # A deceptively fast candidate with vehicles still in flight is
            # incomplete; the Node comparator must also fail closed.
            m = metadata()
            m.update(runId='new', planRevision='actuated')
            paths[1] = str(directory / 'new.json')
            Path(paths[1]).write_text(
                json.dumps(mod.build_receipt(m, stats(time_loss='1', running=1))),
                encoding='utf-8',
            )
            bad = subprocess.run(['node', str(compare_script), *paths],
                                 capture_output=True, text=True, check=False)
            self.assertEqual(bad.returncode, 2)
            self.assertEqual(json.loads(bad.stdout)['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
