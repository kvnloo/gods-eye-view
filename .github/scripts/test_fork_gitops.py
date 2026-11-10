import importlib.util
from pathlib import Path
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

    def test_missing_payload_fails_closed(self):
        self.assertTrue(policy.check({}))

    def test_other_repository_fails_closed(self):
        event = self.event()
        event['repository']['full_name'] = 'bilawalsidhu/gods-eye-view'
        self.assertTrue(policy.check(event))


if __name__ == '__main__':
    unittest.main()
