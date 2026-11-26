#!/usr/bin/env python3
"""PR check: every commit in base..head builds on its own.

Each commit is checked out, in order, into one temporary detached worktree,
cleaned with `git clean -ffdx`, and built there. The caller's checkout (HEAD,
branch, index, working files) is never touched; the tool snapshots it before
and after and reports any difference. The temporary worktree is removed in a
`finally` block, also on Ctrl-C or SIGTERM.

Dependencies are installed (`--install`) for the first commit and again only
when package.json or package-lock.json changes; node_modules is kept between
commits otherwise, and everything else is cleaned.

    python3 scripts/factory/build_each_commit.py --base origin/nightly --head HEAD
    python3 scripts/factory/build_each_commit.py --base B --head H --build 'npm run build' --keep-going --json

Exit 0 all commits built, 1 a commit failed (its SHA is reported) or the
range has more than --max-commits, 2 usage or git error, 3 the caller's
checkout changed or the temporary worktree could not be removed.
"""
import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory_git as g  # noqa: E402

DEPENDENCY_FILES = ('package.json', 'package-lock.json')


def commit_range(repo, base, head):
    merge_base = g.out(['merge-base', base, head], repo)
    shas = g.lines(['rev-list', '--reverse', '--topo-order', f'{merge_base}..{head}'], repo)
    commits = []
    for sha in shas:
        parents, subject = g.out(['show', '-s', '--format=%P%x00%s', sha], repo).split('\x00', 1)
        commits.append({'sha': sha, 'subject': subject, 'merge': len(parents.split()) > 1})
    return merge_base, commits


def dependency_key(repo, sha):
    digest = hashlib.sha256()
    for name in DEPENDENCY_FILES:
        found = g.run(['rev-parse', '--verify', '-q', f'{sha}:{name}'], repo, check=False).stdout.strip()
        digest.update(f'{name}={found}\n'.encode())
    return digest.hexdigest()


def tail(text, count=40):
    return '\n'.join(text.splitlines()[-count:])


def _kill_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    process.wait()


def shell(command, cwd, timeout):
    """Run command in its own process group so a timeout or interrupt kills all of it."""
    started = time.time()
    process = subprocess.Popen(command, shell=True, cwd=cwd, text=True, start_new_session=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output, round(time.time() - started, 1)
    except subprocess.TimeoutExpired:
        _kill_group(process)
        output = process.stdout.read() if process.stdout else ''
        return 124, output + f'\n[timed out after {timeout}s]', round(time.time() - started, 1)
    except BaseException:
        _kill_group(process)
        raise
    finally:
        if process.stdout:
            process.stdout.close()


def _raise_interrupt(signum, _frame):
    raise KeyboardInterrupt(f'signal {signum}')


def build_each(repo, commits, install, build, keep_going, timeout, results, cleanup, root=None):
    """Build commits in one temp worktree, appending to results; always remove it, recording into cleanup."""
    cleanup.update(worktree=None, removed=False, error=None)
    scratch = tempfile.mkdtemp(prefix='gev-commit-builds-', dir=root)
    tree = os.path.join(scratch, 'tree')
    cleanup['worktree'] = tree
    previous_handler = signal.signal(signal.SIGTERM, _raise_interrupt)
    try:
        g.run(['worktree', 'add', '--detach', '--quiet', tree, commits[0]['sha']], repo)
        installed_key = None
        for commit in commits:
            sha = commit['sha']
            g.run(['checkout', '--detach', '--force', '--quiet', sha], tree)
            key = dependency_key(repo, sha)
            reinstall = install and key != installed_key
            g.run(['clean', '-ffdxq'] + ([] if reinstall else ['-e', 'node_modules']), tree)
            entry: dict = dict(commit, installed=bool(reinstall))
            output = ''
            if reinstall:
                code, output, seconds = shell(install, tree, timeout)
                entry.update(step='install', seconds=seconds)
                if code == 0:
                    installed_key = key
            else:
                code = 0
            if code == 0:
                code, output, seconds = shell(build, tree, timeout)
                entry.update(step='build', seconds=seconds)
            entry['ok'] = code == 0
            entry['exit'] = code
            if code != 0:
                entry['log_tail'] = tail(output)
            results.append(entry)
            if code != 0 and not keep_going:
                break
    finally:
        signal.signal(signal.SIGTERM, previous_handler)
        try:
            if os.path.exists(tree):
                g.run(['worktree', 'remove', '--force', tree], repo)
            g.run(['worktree', 'prune'], repo)
            shutil.rmtree(scratch, ignore_errors=True)
            cleanup['removed'] = not os.path.exists(scratch)
        except g.GitError as error:  # report, never mask the build result
            cleanup['error'] = str(error)


def render(report):
    out = [f"Per-commit build: {len(report['commits'])} commit(s) in {report['merge_base'][:12]}..{report['head'][:12]}"]
    for entry in report['results']:
        mark = 'ok  ' if entry['ok'] else 'FAIL'
        merge = ' (merge)' if entry['merge'] else ''
        out.append(f"  {mark} {entry['sha']} {entry['subject']}{merge} [{entry['step']} {entry['seconds']}s]")
    not_run = len(report['commits']) - len(report['results'])
    if not_run:
        out.append(f'  ... {not_run} later commit(s) not built (stopped at first failure; use --keep-going)')
    failed = report['failing_sha']
    if failed:
        first = next(e for e in report['results'] if e['sha'] == failed)
        out.append(f'FAILING SHA: {failed} ({first["step"]} exited {first["exit"]})')
        out.append(first.get('log_tail', ''))
    out.append(f"Caller checkout unchanged: {report['checkout_unchanged']}; "
               f"temporary worktree removed: {report['cleanup']['removed']}")
    if report.get('error'):
        out.append('ERROR: ' + report['error'])
    return '\n'.join(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', default='HEAD')
    parser.add_argument('--install', default='npm ci --no-audit --no-fund',
                        help="dependency install command; '' disables")
    parser.add_argument('--build', default='npm run build')
    parser.add_argument('--max-commits', type=int, default=30)
    parser.add_argument('--timeout', type=int, default=1200, help='seconds per install/build step')
    parser.add_argument('--keep-going', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    repo = os.path.abspath(args.repo)
    try:
        before = g.checkout_state(repo)
        head = g.out(['rev-parse', '--verify', f'{args.head}^{{commit}}'], repo)
        merge_base, commits = commit_range(repo, args.base, head)
    except g.GitError as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    report = {'merge_base': merge_base, 'head': head, 'commits': [c['sha'] for c in commits],
              'results': [], 'failing_sha': None, 'cleanup': {'removed': True},
              'checkout_unchanged': True, 'error': None}
    code = 0
    if not commits:
        report['error'] = None
    elif len(commits) > args.max_commits:
        report['error'] = (f'{len(commits)} commits exceed --max-commits {args.max_commits}; '
                           'split the PR into smaller features')
        code = 1
    else:
        report['cleanup'] = {}
        try:
            build_each(repo, commits, args.install, args.build, args.keep_going, args.timeout,
                       report['results'], report['cleanup'])
        except g.GitError as error:
            report['error'] = str(error)
            code = 2
        except KeyboardInterrupt as interrupt:
            report['error'] = f'interrupted ({interrupt}); temporary worktree cleaned up'
            code = 2
        failed = [e for e in report['results'] if not e['ok']]
        if failed:
            report['failing_sha'] = failed[0]['sha']
            report['failing_shas'] = [e['sha'] for e in failed]
            code = max(code, 1)
    after = g.checkout_state(repo)
    report['checkout_unchanged'] = before == after
    if not report['checkout_unchanged'] or not report['cleanup'].get('removed', True):
        code = 3
    print(json.dumps(report, indent=2) if args.json else render(report))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
