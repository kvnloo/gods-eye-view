"""Per-commit isolated builds: failing SHA, checkout restored, cleanup on SIGTERM.

    python3 -m unittest discover -s scripts/factory/tests -v
"""
import contextlib
import io
import json
import os
import unittest

from fixtures import TempCase, commit, g, git, init, write
import build_each_commit


class BuildEachCommitTest(TempCase):
    def setUp(self):
        super().setUp()
        self.repo = os.path.join(self.tmp, 'r')
        init(self.repo)
        self.base = commit(self.repo, 'base', **{'build.sh': 'exit 0\n', 'package.json': '{"v":1}'})
        self.c1 = commit(self.repo, 'feat(a): one', a='1')
        self.c2 = commit(self.repo, 'feat(a): break', **{'build.sh': 'echo broken >&2; exit 7\n'})
        self.c3 = commit(self.repo, 'fix(a): repair', **{'build.sh': 'exit 0\n', 'package.json': '{"v":2}'})
        # The caller's checkout is dirty: tracked edit, staged file and untracked file.
        write(self.repo, 'a', 'local edit')
        write(self.repo, 'staged', 's')
        git(self.repo, 'add', 'staged')
        write(self.repo, 'untracked', 'u')
        self.before = g.checkout_state(self.repo)
        self.installs = os.path.join(self.tmp, 'installs')

    def run_tool(self, *extra):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = build_each_commit.main(['--repo', self.repo, '--base', self.base, '--json',
                                           '--install', f'echo x >> {self.installs}', '--build', 'sh build.sh',
                                           *extra])
        return code, json.loads(out.getvalue())

    def assert_untouched(self, report):
        self.assertTrue(report['checkout_unchanged'])
        self.assertEqual(g.checkout_state(self.repo), self.before)
        self.assertTrue(report['cleanup']['removed'])
        self.assertFalse(os.path.exists(os.path.dirname(report['cleanup']['worktree'])))

    def test_reports_first_failing_sha_and_restores_checkout(self):
        code, report = self.run_tool()
        self.assertEqual(code, 1)
        self.assertEqual(report['failing_sha'], self.c2)
        self.assertEqual([r['sha'] for r in report['results']], [self.c1, self.c2])
        self.assertIn('broken', report['results'][1]['log_tail'])
        self.assert_untouched(report)

    def test_keep_going_builds_all_and_installs_only_on_dependency_change(self):
        code, report = self.run_tool('--keep-going')
        self.assertEqual(code, 1)
        self.assertEqual([r['ok'] for r in report['results']], [True, False, True])
        self.assertEqual([r['installed'] for r in report['results']], [True, False, True])
        with open(self.installs) as handle:
            self.assertEqual(handle.read().count('x'), 2)
        self.assert_untouched(report)

    def test_green_range_and_empty_range(self):
        code, report = self.run_tool('--head', self.c1)
        self.assertEqual((code, report['failing_sha']), (0, None))
        self.assert_untouched(report)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build_each_commit.main(['--repo', self.repo, '--base', 'HEAD', '--build', 'false']), 0)

    def test_commit_cap(self):
        code, report = self.run_tool('--max-commits', '2')
        self.assertEqual(code, 1)
        self.assertIn('exceed --max-commits 2', report['error'])
        self.assertEqual(report['results'], [])

    def test_sigterm_mid_build_still_cleans_up(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = build_each_commit.main(['--repo', self.repo, '--base', self.base, '--json', '--install', '',
                                           '--build', f'kill -TERM {os.getpid()}; sleep 5'])
        report = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assertIn('interrupted', report['error'])
        self.assert_untouched(report)


if __name__ == '__main__':
    unittest.main()
