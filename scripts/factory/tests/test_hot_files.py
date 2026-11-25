"""Hot-file budget check.

    python3 -m unittest discover -s scripts/factory/tests -v
"""
import contextlib
import io
import json
import os
import unittest

from fixtures import TempCase, commit, init  # noqa: F401
import hot_files


class HotFilesTest(TempCase):
    def config(self, n=2):
        path = os.path.join(self.tmp, 'hot.json')
        with open(path, 'w') as handle:
            json.dump({'max_hot_entries': n, 'entries': [
                {'id': 'state', 'paths': ['docs/CURRENT-STATE.md']},
                {'id': 'i18n', 'paths': ['src/i18n/locales/*.json']},
                {'id': 'manifest', 'paths': ['package.json', 'package-lock.json']},
            ]}, handle)
        return path

    def test_group_counts_once_and_glob_stays_in_segment(self):
        config = hot_files.load_config(self.config())
        touched = hot_files.hot_entries_touched(
            ['src/i18n/locales/de.json', 'src/i18n/locales/fr.json', 'src/i18n/locales/sub/x.json',
             'src/feature/new.js'], config)
        self.assertEqual(touched, {'i18n': ['src/i18n/locales/de.json', 'src/i18n/locales/fr.json']})

    def test_budget_pass_and_fail(self):
        config = hot_files.load_config(self.config(2))
        ok = hot_files.evaluate(['docs/CURRENT-STATE.md', 'package.json', 'package-lock.json', 'a.js'], config)
        self.assertTrue(ok['ok'])
        self.assertEqual((ok['hot_entries_touched'], ok['hot_files_touched']), (2, 3))
        over = hot_files.evaluate(['docs/CURRENT-STATE.md', 'package.json', 'src/i18n/locales/de.json'], config)
        self.assertFalse(over['ok'])
        self.assertTrue(hot_files.evaluate(['docs/CURRENT-STATE.md', 'package.json',
                                            'src/i18n/locales/de.json'], config, limit=3)['ok'])

    def test_cli_on_git_range(self):
        repo = os.path.join(self.tmp, 'r')
        init(repo)
        base = commit(repo, 'base', a='1')
        commit(repo, 'feat(x): add', **{'docs__CURRENT-STATE.md': 's', 'package.json': '{}',
                                       'src__i18n__locales__de.json': '{}'})
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = hot_files.main(['--repo', repo, '--config', self.config(2), '--base', base, '--head', 'HEAD'])
        self.assertEqual(code, 1)
        self.assertIn('FAIL', out.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(hot_files.main(['--repo', repo, '--config', self.config(2), '--base', base,
                                             '--max', '3']), 0)
            self.assertEqual(hot_files.main(['--repo', repo, '--config', self.config(), '--base', 'nope']), 2)

    def test_shipped_config_is_valid(self):
        config = hot_files.load_config()
        self.assertEqual(config['max_hot_entries'], 4)
        self.assertIn('current-state', {e['id'] for e in config['entries']})


if __name__ == '__main__':
    unittest.main()
