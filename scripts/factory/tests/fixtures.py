"""Shared fixtures for the fork-factory tool tests: throwaway git repositories."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FACTORY = os.path.dirname(HERE)
SCRIPTS = os.path.dirname(FACTORY)
sys.path.insert(0, FACTORY)

import factory_git as g  # noqa: E402

PORT_SCRIPT = os.path.join(SCRIPTS, 'upstream-port.py')


def git(repo, *args):
    return subprocess.run(['git', *args], cwd=repo, check=True, text=True, env=g.git_env(),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()


def write(repo, path, text):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as handle:
        handle.write(text)


def commit(repo, message, **files):
    for path, text in files.items():
        write(repo, path.replace('__', '/'), text)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', message)
    return git(repo, 'rev-parse', 'HEAD')


def init(repo, branch='main'):
    os.makedirs(repo)
    git(repo, 'init', '-q', '-b', branch)
    git(repo, 'config', 'commit.gpgsign', 'false')
    git(repo, 'config', 'uploadpack.allowAnySHA1InWant', 'true')


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='gev-factory-test-')
        self.addCleanup(shutil.rmtree, self.tmp, True)
