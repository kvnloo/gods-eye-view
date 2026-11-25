#!/usr/bin/env python3
"""Rehearse exactly one merged fork feature on today's upstream main, locally."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

FORK = 'kvnloo/gods-eye-view'
UPSTREAM = 'https://github.com/bilawalsidhu/gods-eye-view.git'


def output(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def rehearse(label):
    pages = json.loads(output('gh', 'api', '--paginate', '--slurp',
        f'repos/{FORK}/pulls?state=closed&base=nightly&per_page=100'))
    matches = [pr for page in pages for pr in page if
        any(item['name'] == label for item in pr['labels'])]
    merged = []
    for pr in matches:
        detail = json.loads(output('gh', 'api', f'repos/{FORK}/pulls/{pr["number"]}'))
        if detail['merged']:
            merged.append(detail)
    if len(merged) != 1:
        raise RuntimeError(f'{label}: expected one merged nightly PR, got {len(merged)}')
    pr = merged[0]
    merge = pr['merge_commit_sha']
    source = pr['head']['sha']
    for sha in (merge, source):
        if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
            raise RuntimeError('GitHub did not return pinned merge and source commits')
    scratch = Path(tempfile.mkdtemp(prefix='gev-upstream-port-'))
    print(f'PR {pr["html_url"]}; rehearsal retained at {scratch}', flush=True)

    def git(*args):
        return output('git', *args, cwd=scratch)

    git('init', '--quiet')
    git('fetch', '--quiet', '--no-tags', UPSTREAM, 'refs/heads/main:refs/remotes/upstream/main')
    git('fetch', '--quiet', '--no-tags', f'https://github.com/{FORK}.git', merge)
    _, *parents = git('rev-list', '--parents', '-n', '1', merge).split()
    if len(parents) != 2 or parents[1] != source:
        raise RuntimeError('Expected a merge commit preserving the exact PR source head')
    commits = git('rev-list', '--reverse', f'{parents[0]}..{source}').splitlines()
    if not commits or git('rev-list', '--merges', f'{parents[0]}..{source}'):
        raise RuntimeError('Cannot isolate a nonempty linear feature; inspect dependencies manually')
    check = git('merge-tree', '--write-tree', parents[0], source).splitlines()[0]
    if check != git('rev-parse', f'{merge}^{{tree}}'):
        raise RuntimeError('Merge has extra resolutions; do not silently omit them')
    git('switch', '--quiet', '-c', 'upstream-port/' + label.split(':', 1)[1], 'upstream/main')
    print(f'Upstream base: {git("rev-parse", "HEAD")}', flush=True)
    for sha in commits:
        print(f'Cherry-pick {sha}', flush=True)
        result = subprocess.run(['git', '-c', 'user.name=GEV port rehearsal', '-c',
            'user.email=gev-port@users.noreply.github.com', '-c', 'commit.gpgsign=false',
            '-c', 'core.hooksPath=/dev/null', 'cherry-pick', '-x', sha], cwd=scratch)
        if result.returncode:
            print('Unmerged paths:\n' + git('diff', '--name-only', '--diff-filter=U'))
            return 1
    print(f'Clean rehearsal: {git("rev-parse", "HEAD")}; no remote writes')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('label')
    args = parser.parse_args()
    if not re.fullmatch(r'feature:[a-z0-9]+(?:-[a-z0-9]+)*', args.label):
        parser.error('expected an exact feature:<slug> label')
    try:
        return rehearse(args.label)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
