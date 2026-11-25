"""Upstream-port rehearsal against fixture upstream/fork repositories (no network, PRs via --prs-json).

    python3 -m unittest discover -s scripts/factory/tests -v
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from fixtures import PORT_SCRIPT, commit, g, git, init, write


class PortFixture:
    """Upstream main plus a fork whose nightly holds features merged several ways."""

    def __init__(self, root):
        self.root = root
        self.upstream = os.path.join(root, 'upstream')
        self.fork = os.path.join(root, 'fork')
        init(self.upstream)
        a = commit(self.upstream, 'init', **{'app.js': 'line1\nline2\n', 'docs__CURRENT-STATE.md': 'state\n'})
        init(self.fork, branch='nightly')
        git(self.fork, 'fetch', '-q', self.upstream, 'main')
        git(self.fork, 'reset', '-q', '--hard', a)
        commit(self.fork, 'chore(fork): fork-only', **{'fork.txt': 'fork\n'})
        self.prs, self.labels = [], ['bug', 'feature:alpha', 'feature:alps', 'feature:beta', 'feature:gamma',
                                     'feature:delta', 'feature:eps', 'feature:evil', 'feature:twin', 'feature:twin-b',
                                     'feature:open-only', 'feature:already']

        # alpha: merge commit of two new-file commits (clean)
        self.alpha = self.branch('alpha', [('feat(alpha): add', {'src__alpha.js': 'a\n'}),
                                           ('feat(alpha): grow', {'src__alpha.js': 'a\nb\n'})])
        self.merge('alpha', 1, 'feature:alpha')
        # beta: edits the line upstream will also edit (conflict)
        self.branch('beta', [('feat(beta): touch app', {'app.js': 'fork-line1\nline2\n'})])
        self.merge('beta', 2, 'feature:beta')
        # gamma: branch contains a merge of nightly
        git(self.fork, 'switch', '-q', '-c', 'gamma', 'nightly~1')
        commit(self.fork, 'feat(gamma): one', **{'gamma.js': 'g\n'})
        git(self.fork, 'merge', '-q', '--no-ff', '-m', 'Merge nightly into gamma', 'nightly')
        self.merge('gamma', 3, 'feature:gamma')
        # delta: squash merge of a two-commit branch
        head = self.branch('delta', [('feat(delta): one', {'delta.js': 'd\n'}),
                                     ('feat(delta): two', {'delta.js': 'd\nd\n'})])
        git(self.fork, 'switch', '-q', 'nightly')
        git(self.fork, 'merge', '-q', '--squash', 'delta')
        squash = commit(self.fork, 'feat(delta): squashed (#4)')
        self.pr(4, 'feature:delta', squash, head)
        # eps: rebase merge of two commits
        head = self.branch('eps', [('feat(eps): one', {'eps.js': 'e\n'}), ('feat(eps): two', {'eps2.js': 'e\n'})],
                           base='nightly~2')
        git(self.fork, 'switch', '-q', 'nightly')
        for sha in git(self.fork, 'rev-list', '--reverse', 'nightly~2..eps').split():
            git(self.fork, 'cherry-pick', sha)
        self.pr(5, 'feature:eps', git(self.fork, 'rev-parse', 'HEAD'), head)
        # evil: merge commit with an extra hand edit
        self.branch('evil', [('feat(evil): one', {'evil.js': 'v\n'})])
        git(self.fork, 'switch', '-q', 'nightly')
        git(self.fork, 'merge', '-q', '--no-ff', '--no-commit', 'evil')
        write(self.fork, 'sneaky.js', 'x\n')
        git(self.fork, 'add', '-A')
        git(self.fork, 'commit', '-q', '-m', 'Merge evil')
        self.pr(6, 'feature:evil', git(self.fork, 'rev-parse', 'HEAD'), git(self.fork, 'rev-parse', 'evil'))
        # twin: one PR with two feature labels
        self.branch('twin', [('feat(twin): one', {'twin.js': 't\n'})])
        self.merge('twin', 7, 'feature:twin', 'feature:twin-b')
        # open-only: an unmerged PR
        self.prs.append({'number': 8, 'title': 'open', 'state': 'OPEN', 'mergedAt': None, 'mergeCommit': None,
                         'headRefOid': self.alpha, 'baseRefName': 'nightly', 'url': 'u8',
                         'labels': [{'name': 'feature:open-only'}]})
        # already: a file upstream adds identically, plus a new file
        self.branch('already', [('fix(shared): same as upstream', {'shared.txt': 'same\n'}),
                                ('feat(already): new', {'already.js': 'n\n'})])
        self.merge('already', 9, 'feature:already')
        # alpha second PR, merged later: an extra commit for the same feature
        self.branch('alpha2', [('feat(alpha): polish', {'src__alpha2.js': 'p\n'})])
        self.merge('alpha2', 10, 'feature:alpha')
        # alpha PR into another base is skipped
        self.prs.append(dict(self.prs[0], number=11, baseRefName='staging'))

        # Upstream moves on: edits line1 (conflicts with beta) and appends line3.
        commit(self.upstream, 'upstream change', **{'app.js': 'up-line1\nline2\n', 'shared.txt': 'same\n'})
        git(self.fork, 'switch', '-q', 'nightly')

    def branch(self, name, commits, base='nightly'):
        git(self.fork, 'switch', '-q', '-c', name, base)
        for message, files in commits:
            commit(self.fork, message, **files)
        return git(self.fork, 'rev-parse', 'HEAD')

    def merge(self, name, number, *labels):
        git(self.fork, 'switch', '-q', 'nightly')
        git(self.fork, 'merge', '-q', '--no-ff', '-m', f'Merge pull request #{number}', name)
        self.pr(number, labels, git(self.fork, 'rev-parse', 'HEAD'), git(self.fork, 'rev-parse', name))

    def pr(self, number, labels, merge, head):
        labels = [labels] if isinstance(labels, str) else list(labels)
        self.prs.append({'number': number, 'title': f'pr {number}', 'state': 'MERGED',
                         'mergedAt': f'2026-11-{10 + number:02d}T00:00:00Z', 'mergeCommit': {'oid': merge},
                         'headRefOid': head, 'baseRefName': 'nightly', 'url': f'u{number}',
                         'labels': [{'name': name} for name in labels]})

    def source_file(self):
        path = os.path.join(self.root, 'prs.json')
        with open(path, 'w') as handle:
            json.dump({'labels': self.labels, 'prs': self.prs}, handle)
        return path


class UpstreamPortTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='gev-port-test-')
        cls.fx = PortFixture(cls.tmp)
        cls.source = cls.fx.source_file()
        cls.scratch_root = os.path.join(cls.tmp, 'scratch')
        os.makedirs(cls.scratch_root)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, True)

    def port(self, label, *extra):
        before = g.checkout_state(self.fx.fork)
        result = subprocess.run([sys.executable, PORT_SCRIPT, label, '--json', '--prs-json', self.source,
                                 '--upstream-url', self.fx.upstream, '--fork-url', self.fx.fork,
                                 '--scratch-root', self.scratch_root, *extra],
                                cwd=self.fx.fork, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(g.checkout_state(self.fx.fork), before, 'port tool touched the caller checkout')
        report = json.loads(result.stdout)
        if report['cleanup']['status'] != 'retained':
            self.assertEqual(os.listdir(self.scratch_root), [], 'scratch repository left behind')
        return result.returncode, report

    def statuses(self, report):
        return [r['status'] for r in report['results']]

    def test_clean_port_of_two_merged_prs_in_merge_order(self):
        code, report = self.port('feature:alpha')
        self.assertEqual((code, report['outcome']), (0, 'clean'))
        self.assertEqual([p['number'] for p in report['prs']], [1, 10])
        self.assertEqual([p['method'] for p in report['prs']], ['merge', 'merge'])
        self.assertEqual([c['subject'] for c in report['selected_commits']],
                         ['feat(alpha): add', 'feat(alpha): grow', 'feat(alpha): polish'])
        self.assertEqual(self.statuses(report), ['picked'] * 3)
        self.assertEqual([s['number'] for s in report['skipped_prs']], [11])
        self.assertEqual(report['upstream_main'], git(self.fx.upstream, 'rev-parse', 'main'))
        self.assertEqual(report['cleanup']['status'], 'removed')
        self.assertEqual(report['remote_writes'], 0)

    def test_bare_slug_and_keep_retains_inspectable_branch(self):
        code, report = self.port('alpha', '--keep')
        self.assertEqual(code, 0)
        self.assertEqual(report['cleanup']['status'], 'retained')
        repo = os.path.join(report['cleanup']['path'], 'repo.git')
        log = git(repo, 'log', '--format=%s', f"upstream/main..{report['branch']}").splitlines()
        self.assertEqual(log, ['feat(alpha): polish', 'feat(alpha): grow', 'feat(alpha): add'])
        self.assertIn('cherry picked from commit', git(repo, 'log', '-1', '--format=%B', report['branch']))
        self.assertEqual(git(repo, 'branch', '-r'), 'upstream/main')
        shutil.rmtree(report['cleanup']['path'])

    def test_conflict_reports_paths(self):
        code, report = self.port('feature:beta')
        self.assertEqual((code, report['outcome']), (1, 'conflict'))
        self.assertEqual(report['results'][0]['conflicts'], ['app.js'])
        self.assertEqual(report['cleanup']['status'], 'removed')

    def test_change_already_upstream_is_empty_not_conflict(self):
        code, report = self.port('feature:already')
        self.assertEqual(code, 0)
        self.assertEqual(self.statuses(report), ['empty', 'picked'])

    def test_squash_and_rebase_merges(self):
        code, report = self.port('feature:delta')
        self.assertEqual((code, report['prs'][0]['method'], len(report['selected_commits'])), (0, 'squash', 1))
        code, report = self.port('feature:eps')
        self.assertEqual((code, report['prs'][0]['method']), (0, 'rebase'))
        self.assertEqual([c['subject'] for c in report['selected_commits']], ['feat(eps): one', 'feat(eps): two'])

    def test_branch_with_merge_commit_is_unportable(self):
        code, report = self.port('feature:gamma')
        self.assertEqual((code, report['outcome']), (4, 'unportable'))
        self.assertTrue(report['merges'])
        self.assertEqual(report['cleanup']['status'], 'removed')

    def test_hand_resolved_merge_is_unportable(self):
        code, report = self.port('feature:evil')
        self.assertEqual(code, 4)
        self.assertIn('differs from a clean merge', report['message'])

    def test_ambiguous_labels(self):
        code, report = self.port('feature:al')
        self.assertEqual((code, report['outcome']), (2, 'ambiguous'))
        self.assertEqual(report['candidates'], ['feature:alpha', 'feature:alps', 'feature:already'])
        code, report = self.port('feature:twin')
        self.assertEqual(code, 2)
        self.assertIn('several feature labels', report['message'])

    def test_empty_selections(self):
        code, report = self.port('feature:open-only')
        self.assertEqual((code, report['outcome']), (3, 'empty'))
        self.assertEqual(report['skipped_prs'][0]['reason'], 'state OPEN')
        self.assertEqual(report['cleanup']['status'], 'not-created')
        code, report = self.port('feature:alps')
        self.assertEqual(code, 3)
        code, report = self.port('feature:nothing-like-it')
        self.assertEqual((code, report['outcome']), (3, 'empty'))

    def test_bad_label_shape(self):
        code, report = self.port('Feature:Bad Label')
        self.assertEqual((code, report['outcome']), (2, 'usage'))

    def test_fetch_failure_is_environment_error(self):
        code, report = self.port('feature:alpha', '--upstream-url', os.path.join(self.tmp, 'missing'))
        self.assertEqual((code, report['outcome']), (5, 'environment'))
        self.assertEqual(report['cleanup']['status'], 'removed')


class RemoteWriteGuardTest(unittest.TestCase):
    def test_push_is_refused(self):
        for args in (['push', 'origin', 'main'], ['-c', 'x=y', 'push'], ['send-pack', 'x']):
            with self.assertRaises(g.GitError):
                g.run(args, cwd='.')


if __name__ == '__main__':
    unittest.main()
