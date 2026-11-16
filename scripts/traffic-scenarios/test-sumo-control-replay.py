"""Integration regression. Requires real SUMO/netconvert 1.24.0 and supported Node."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class ControlReplayTests(unittest.TestCase):
    def test_real_incomplete_control_can_be_rebuilt_from_preserved_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'corridor'
            run = subprocess.run(
                [sys.executable, str(HERE / 'run-sumo-corridor.py'), '--output', str(out)],
                capture_output=True, text=True, timeout=180, check=False)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            summary = json.loads((out / 'summary.json').read_text())
            self.assertEqual(summary['completedSimulationRuns'], 7)
            self.assertEqual(summary['status'], 'passed')
            prefix = out / 'incomplete-control'
            replay = subprocess.run(
                [sys.executable, str(HERE / 'sumo-statistics-receipt.py'),
                 '--metadata', f'{prefix}.meta.json',
                 '--statistics', f'{prefix}.statistics.xml'],
                capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(replay.returncode, 0, replay.stderr)
            rebuilt = json.loads(replay.stdout)
            original = json.loads(Path(f'{prefix}.receipt.json').read_text())
            self.assertEqual(rebuilt, original)
            self.assertEqual(rebuilt['quality']['coverage'], 'partial')
            self.assertEqual(rebuilt['metrics'], {})
            metadata = json.loads(Path(f'{prefix}.meta.json').read_text())
            self.assertEqual(metadata['runId'], 'incomplete-control')
            self.assertEqual(metadata['context']['windowEndMs'], 30000)
            fixed = json.loads((out / 'fixed-41.meta.json').read_text())
            self.assertEqual(metadata['planRevision'], fixed['planRevision'])
            self.assertEqual(metadata['context']['demandRevision'], fixed['context']['demandRevision'])


if __name__ == '__main__':
    unittest.main()
