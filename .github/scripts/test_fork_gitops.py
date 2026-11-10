import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'fork_gitops', Path(__file__).with_name('check-fork-gitops.py')
)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ForkPolicyTests(unittest.TestCase):
    def event(self, branch='feature/example', base='main'):
        return {'repository': {'full_name': 'kvnloo/gods-eye-view'},
                'pull_request': {'base': {'ref': base}, 'head': {'ref': branch}}}

    def test_allowed_prefixes(self):
        for prefix in ('feature', 'wave', 'salvage', 'refresh'):
            with self.subTest(prefix=prefix):
                self.assertEqual(policy.check(self.event(prefix + '/example')), [])

    def test_stacked_base_fails(self):
        self.assertIn('PR base must be main', policy.check(self.event(base='feature/parent')))

    def test_old_prefixes_fail(self):
        for branch in ('factory/example', 'promotion/example', 'main', 'feature/'):
            with self.subTest(branch=branch):
                self.assertTrue(policy.check(self.event(branch)))

    def test_cli_accepts_valid_events_and_rejects_invalid_events(self):
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / 'event.json'
            for event, expected in ((self.event(), 0), (self.event(base='preview'), 1),
                                    (self.event(branch='factory/old'), 1), ({}, 1)):
                with self.subTest(event=event):
                    event_path.write_text(json.dumps(event))
                    run = subprocess.run([sys.executable, str(Path(policy.__file__))],
                                         env={**os.environ, 'GITHUB_EVENT_PATH': str(event_path)},
                                         capture_output=True, text=True)
                    self.assertEqual(run.returncode, expected, run.stderr)

    def test_cli_rejects_malformed_input(self):
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / 'event.json'
            event_path.write_text('{')
            run = subprocess.run([sys.executable, str(Path(policy.__file__))],
                                 env={**os.environ, 'GITHUB_EVENT_PATH': str(event_path)},
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 1)

    def test_workflow_executes_only_trusted_base_code(self):
        workflow = (Path(__file__).parent.parent / 'workflows/fork-gitops.yml').read_text()
        self.assertIn('  pull_request_target:', workflow)
        self.assertIn('ref: ${{ github.event.pull_request.base.sha }}', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('  contents: read', workflow)
        self.assertNotIn('pull_request.head', workflow)

    def test_missing_payload_fails_closed(self):
        self.assertTrue(policy.check({}))

    def test_other_repository_fails_closed(self):
        event = self.event()
        event['repository']['full_name'] = 'bilawalsidhu/gods-eye-view'
        self.assertTrue(policy.check(event))


if __name__ == '__main__':
    unittest.main()
