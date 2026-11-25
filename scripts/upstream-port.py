#!/usr/bin/env python3
"""Dry-run port of one fork feature onto today's upstream main.

    python3 scripts/upstream-port.py feature:<slug> [--keep] [--json]

1. Resolves the exact `feature:<slug>` label on the fork (a bare slug is read
   as `feature:<slug>`); a label that does not exist lists near matches and
   stops, it is never guessed.
2. Selects every merged PR with that label into --base (default nightly),
   ordered by merge time then number. Open or unmerged PRs are listed, not used.
   A PR carrying two `feature:*` labels is ambiguous and stops the run.
3. Expands each PR into the commits that landed:
   - merge commit: the PR's own commits (first parent..PR head), refusing a
     branch that contains merges or a merge that resolved anything by hand;
   - rebase merge: the rebased commits on the base branch;
   - squash merge: the single squashed commit.
4. Fetches upstream main into a new throwaway repository under $TMPDIR and
   trial-cherry-picks each commit in memory (`git merge-tree`) onto branch
   `upstream-port/<slug>` there. No checkout of yours is read or written.
5. Prints the selected commits, each result (picked / already upstream /
   conflict with paths / not attempted) and the cleanup status. The scratch
   repository is deleted unless --keep.

It never pushes, never opens a PR and never comments: the `oss-factory-gev`
cron owns everything that reaches upstream. Remote-writing git subcommands are
refused by `scripts/factory/factory_git.py`.

Exit codes: 0 every commit applies, 1 a commit conflicts, 2 usage error or
ambiguous label, 3 nothing selected, 4 a PR cannot be ported as atomic commits
(merges inside the branch, hand-resolved merge, unexpected history),
5 environment error (gh or fetch failed).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'factory'))
import factory_git as g  # noqa: E402

FORK = 'kvnloo/gods-eye-view'
UPSTREAM_URL = 'https://github.com/bilawalsidhu/gods-eye-view.git'
SLUG = r'[a-z0-9]+(?:[-.][a-z0-9]+)*'
LABEL_RE = re.compile(rf'^feature:{SLUG}$')
EXIT = {'clean': 0, 'conflict': 1, 'usage': 2, 'ambiguous': 2, 'empty': 3, 'unportable': 4, 'environment': 5}
PR_FIELDS = 'number,title,state,mergedAt,mergeCommit,headRefOid,baseRefName,labels,url'


class Stop(Exception):
    """Ends the run with an explicit outcome."""

    def __init__(self, outcome, message, **details):
        super().__init__(message)
        self.outcome = outcome
        self.details = details


# --- label and PR resolution ------------------------------------------------

def normalise_label(raw):
    label = raw if raw.startswith('feature:') else f'feature:{raw}'
    if not LABEL_RE.match(label):
        raise Stop('usage', f'{raw!r} is not a feature label; expected feature:<slug> (lowercase, digits, - or .)')
    return label


def resolve_label(label, labels):
    if label in labels:
        return label
    slug = label.split(':', 1)[1]
    near = sorted(name for name in labels if name.startswith('feature:') and slug in name.split(':', 1)[1])
    if near:
        raise Stop('ambiguous', f'no label {label}; near matches: {", ".join(near)}. Pass one exactly.',
                   candidates=near)
    raise Stop('empty', f'no label {label} on the fork, so no feature PRs to port')


def select_prs(label, prs, bases):
    """Merged PRs with exactly this feature label into one of bases, in merge order."""
    chosen, skipped = [], []
    for pr in prs:
        names = sorted(item['name'] for item in pr.get('labels', []))
        if label not in names:
            continue
        features = [name for name in names if name.startswith('feature:')]
        if len(features) > 1:
            raise Stop('ambiguous', f"PR #{pr['number']} carries several feature labels ({', '.join(features)}); "
                       'one PR must belong to exactly one feature', pr=pr['number'], labels=features)
        reason = None
        if pr.get('baseRefName') not in bases:
            reason = f"base {pr.get('baseRefName')} is not {'/'.join(bases)}"
        elif pr.get('state') != 'MERGED' or not pr.get('mergedAt'):
            reason = f"state {pr.get('state')}"
        elif not (pr.get('mergeCommit') or {}).get('oid'):
            reason = 'GitHub reports no merge commit'
        if reason:
            skipped.append({'number': pr['number'], 'url': pr.get('url'), 'reason': reason})
        else:
            chosen.append(pr)
    chosen.sort(key=lambda pr: (pr['mergedAt'], pr['number']))
    return chosen, sorted(skipped, key=lambda item: item['number'])


def gh_json(args):
    try:
        return json.loads(subprocess.check_output(['gh', *args], text=True, stderr=subprocess.PIPE))
    except (OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, 'stderr', '') or str(error)
        raise Stop('environment', f"gh {' '.join(args[:3])} failed: {detail.strip()}")


def live_source(fork, label):
    labels = [item['name'] for item in gh_json(['label', 'list', '--repo', fork, '--limit', '1000', '--json', 'name'])]
    if label not in labels:
        return {'labels': labels, 'prs': []}
    prs = gh_json(['pr', 'list', '--repo', fork, '--label', label, '--state', 'all',
                   '--limit', '1000', '--json', PR_FIELDS])
    if len(prs) >= 1000:
        raise Stop('environment', 'gh returned 1000 PRs, the page limit; refusing a possibly truncated selection')
    return {'labels': labels, 'prs': prs}


# --- commit expansion ---------------------------------------------------------

def parents_of(repo, sha):
    return g.out(['rev-list', '--parents', '-n', '1', sha], repo).split()[1:]


def patch_ids(repo, shas):
    ids = []
    for sha in shas:
        diff = g.run(['show', '--format=', '--no-color', sha], repo).stdout
        found = subprocess.run(['git', 'patch-id', '--stable'], cwd=repo, input=diff, text=True,
                               stdout=subprocess.PIPE, check=True).stdout.split()
        ids.append(found[0] if found else None)
    return ids


def expand_pr(repo, pr):
    merge, head = pr['mergeCommit']['oid'], pr['headRefOid']
    parents = parents_of(repo, merge)
    info = {'number': pr['number'], 'url': pr.get('url'), 'title': pr.get('title'),
            'merge_commit': merge, 'head': head}
    if len(parents) > 2:
        raise Stop('unportable', f"PR #{pr['number']}: merge {merge} has {len(parents)} parents (octopus)", pr=info)
    if len(parents) == 2:
        mainline, source = parents
        if source != head:
            raise Stop('unportable', f"PR #{pr['number']}: merge {merge} second parent {source} is not the PR head "
                       f'{head}; the merge does not record the reviewed branch', pr=info)
        merges = g.lines(['rev-list', '--merges', f'{mainline}..{source}'], repo)
        if merges:
            raise Stop('unportable', f"PR #{pr['number']}: branch contains merge commit(s) {', '.join(merges)}; "
                       'rebase it to linear atomic commits before porting', pr=info, merges=merges)
        trial = g.run(['merge-tree', '--write-tree', '--no-messages', mainline, source], repo, check=False)
        tree = trial.stdout.split('\n', 1)[0].strip()
        if trial.returncode != 0 or tree != g.out(['rev-parse', f'{merge}^{{tree}}'], repo):
            raise Stop('unportable', f"PR #{pr['number']}: merge {merge} differs from a clean merge of its parents "
                       '(hand-resolved conflict or extra change); those edits would be lost', pr=info)
        info['method'] = 'merge'
        info['commits'] = g.lines(['rev-list', '--reverse', '--topo-order', f'{mainline}..{source}'], repo)
        return info
    # One parent: GitHub squashed or rebased the PR.
    fork_point = g.run(['merge-base', parents[0] if parents else merge, head], repo, check=False).stdout.strip()
    original = g.lines(['rev-list', '--reverse', '--topo-order', f'{fork_point}..{head}'], repo) if fork_point else []
    landed = g.lines(['rev-list', '--reverse', '--first-parent', '-n', str(len(original)), merge], repo)
    if original and len(landed) == len(original) and patch_ids(repo, landed) == patch_ids(repo, original):
        info['method'] = 'rebase'
        info['commits'] = landed
    else:
        info['method'] = 'squash'
        info['commits'] = [merge]
    return info


# --- scratch repository and trial cherry-picks ----------------------------------

def is_remote_url(url):
    return '://' in url and not url.startswith('file://')


def make_scratch(scratch, upstream_url, fork_url, fetch_shas):
    """Create a bare repository inside scratch and fetch upstream main plus the fork commits."""
    repo = os.path.join(scratch, 'repo.git')
    g.run(['init', '--quiet', '--bare', repo], scratch)
    for name, url in (('upstream', upstream_url), ('fork', fork_url)):
        g.run(['remote', 'add', name, url], repo)
        g.run(['config', f'remote.{name}.pushurl', 'refused://factory-tools-never-push'], repo)
        if is_remote_url(url):
            g.run(['config', f'remote.{name}.promisor', 'true'], repo)
            g.run(['config', f'remote.{name}.partialclonefilter', 'blob:none'], repo)
    flt = ['--filter=blob:none'] if is_remote_url(upstream_url) else []
    g.run(['fetch', '--quiet', '--no-tags', *flt, 'upstream', '+refs/heads/main:refs/remotes/upstream/main'], repo)
    flt = ['--filter=blob:none'] if is_remote_url(fork_url) else []
    g.run(['fetch', '--quiet', '--no-tags', *flt, 'fork', *sorted(set(fetch_shas))], repo)
    return repo


def commit_meta(repo, sha):
    fmt = '%an%x00%ae%x00%ad%x00%B'
    name, email, date, message = g.run(['show', '-s', '--date=raw', f'--format={fmt}', sha], repo).stdout.split('\x00', 3)
    return name, email, date, message.rstrip('\n')


def trial_pick(repo, onto, sha):
    """Cherry-pick sha onto commit `onto` without a worktree. Returns (status, new_sha, paths)."""
    parents = parents_of(repo, sha)
    if len(parents) != 1:
        return 'unportable', None, []
    trial = g.run(['merge-tree', '--write-tree', '--name-only', '--no-messages',
                   f'--merge-base={parents[0]}', onto, sha], repo, check=False)
    if trial.returncode not in (0, 1):
        raise g.GitError(['merge-tree', sha], trial.returncode, trial.stderr)
    tree, *rest = trial.stdout.strip('\n').split('\n')
    if trial.returncode == 1:
        return 'conflict', None, sorted({line for line in rest if line.strip()})
    if tree == g.out(['rev-parse', f'{onto}^{{tree}}'], repo):
        return 'empty', onto, []
    name, email, date, message = commit_meta(repo, sha)
    env_overrides = {'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_AUTHOR_DATE': date}
    saved = {key: os.environ.get(key) for key in env_overrides}
    os.environ.update(env_overrides)
    try:
        new = g.out(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', onto, '-m',
                     f'{message}\n\n(cherry picked from commit {sha})'], repo)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    return 'picked', new, []


def rehearse(label, source, args):
    report = {'label': label, 'fork': args.fork, 'bases': args.base, 'prs': [], 'skipped_prs': [],
              'selected_commits': [], 'upstream_main': None, 'branch': None, 'results': [],
              'outcome': None, 'message': None, 'remote_writes': 0,
              'cleanup': {'status': 'not-created', 'path': None}}
    scratch = None
    try:
        label = resolve_label(label, source['labels'])
        chosen, report['skipped_prs'] = select_prs(label, source['prs'], args.base)
        if not chosen:
            raise Stop('empty', f'{label}: no merged PRs into {"/".join(args.base)}')
        shas = [pr['mergeCommit']['oid'] for pr in chosen] + [pr['headRefOid'] for pr in chosen]
        scratch = tempfile.mkdtemp(prefix='gev-upstream-port-', dir=args.scratch_root)
        report['cleanup'] = {'status': 'created', 'path': scratch}
        try:
            repo = make_scratch(scratch, args.upstream_url, args.fork_url, shas)
        except g.GitError as error:
            raise Stop('environment', f'fetch failed: {error}')
        seen = set()
        for pr in chosen:
            info = expand_pr(repo, pr)
            fresh = [sha for sha in info['commits'] if sha not in seen]
            info['duplicates_skipped'] = len(info['commits']) - len(fresh)
            info['commits'] = fresh
            seen.update(fresh)
            report['prs'].append(info)
            report['selected_commits'] += [{'sha': sha, 'pr': info['number'], 'method': info['method'],
                                            'subject': g.out(['show', '-s', '--format=%s', sha], repo)}
                                           for sha in fresh]
        if not report['selected_commits']:
            raise Stop('empty', f'{label}: the merged PRs contribute no commits')
        head = g.out(['rev-parse', 'refs/remotes/upstream/main'], repo)
        report['upstream_main'] = head
        report['branch'] = f"upstream-port/{label.split(':', 1)[1]}"
        outcome = 'clean'
        for commit in report['selected_commits']:
            if outcome != 'clean':
                report['results'].append({'sha': commit['sha'], 'status': 'not-attempted'})
                continue
            status, new, paths = trial_pick(repo, head, commit['sha'])
            report['results'].append({'sha': commit['sha'], 'status': status, 'new_sha': new, 'conflicts': paths})
            if status == 'conflict':
                outcome = 'conflict'
            elif status == 'unportable':
                outcome = 'unportable'
            else:
                head = new
        g.run(['update-ref', f"refs/heads/{report['branch']}", head], repo)
        report['branch_head'] = head
        report['outcome'] = outcome
        report['message'] = {'clean': 'every commit applies to upstream main',
                             'conflict': 'stopped at the first conflicting commit',
                             'unportable': 'a selected commit is a merge'}[outcome]
    except Stop as stop:
        report['outcome'], report['message'] = stop.outcome, str(stop)
        report.update({k: v for k, v in stop.details.items() if k not in report})
    except g.GitError as error:
        report['outcome'], report['message'] = 'environment', str(error)
    finally:
        if scratch:
            if args.keep:
                report['cleanup'] = {'status': 'retained', 'path': scratch}
            else:
                shutil.rmtree(scratch, ignore_errors=True)
                report['cleanup'] = {'status': 'removed' if not os.path.exists(scratch) else 'failed',
                                     'path': scratch}
    return report


def render(report):
    out = [f"Upstream port rehearsal for {report['label']} (fork {report['fork']}, bases {'/'.join(report['bases'])})"]
    for pr in report['prs']:
        out.append(f"  PR #{pr['number']} {pr['method']} {pr['merge_commit'][:12]}: {pr.get('title') or ''}"
                   f"{' (' + str(pr['duplicates_skipped']) + ' shared commits skipped)' if pr['duplicates_skipped'] else ''}")
    for pr in report['skipped_prs']:
        out.append(f"  not selected: PR #{pr['number']} ({pr['reason']})")
    if report['upstream_main']:
        out.append(f"Upstream main: {report['upstream_main']}; scratch branch {report['branch']}")
    results = {r['sha']: r for r in report['results']}
    for commit in report['selected_commits']:
        result = results.get(commit['sha'], {'status': 'not-attempted'})
        line = f"  {result['status']:<13} {commit['sha']} (#{commit['pr']}) {commit['subject']}"
        if result.get('conflicts'):
            line += '\n' + '\n'.join(f'      conflict: {path}' for path in result['conflicts'])
        out.append(line)
    out.append(f"Outcome: {report['outcome']}: {report['message']}")
    if report.get('candidates'):
        out.append('Candidates: ' + ', '.join(report['candidates']))
    out.append(f"Cleanup: {report['cleanup']['status']}"
               f"{' at ' + report['cleanup']['path'] if report['cleanup']['path'] else ''}")
    out.append('Remote writes: none (no push, no PR); upstream posting belongs to cron oss-factory-gev')
    return '\n'.join(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('label', help='feature:<slug> or <slug>')
    parser.add_argument('--fork', default=FORK)
    parser.add_argument('--base', action='append', help='PR base branch to accept (repeatable; default nightly)')
    parser.add_argument('--upstream-url', default=UPSTREAM_URL)
    parser.add_argument('--fork-url')
    parser.add_argument('--prs-json', help='read labels and PRs from this file instead of gh (fixtures)')
    parser.add_argument('--scratch-root', help='parent directory for the scratch repository (default $TMPDIR)')
    parser.add_argument('--keep', action='store_true', help='retain the scratch repository for inspection')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    args.base = args.base or ['nightly']
    args.fork_url = args.fork_url or f'https://github.com/{args.fork}.git'
    try:
        label = normalise_label(args.label)
        if args.prs_json:
            with open(args.prs_json, encoding='utf-8') as handle:
                source = json.load(handle)
        else:
            source = live_source(args.fork, label)
        report = rehearse(label, source, args)
    except Stop as stop:
        report = {'label': args.label, 'fork': args.fork, 'bases': args.base, 'prs': [], 'skipped_prs': [],
                  'selected_commits': [], 'upstream_main': None, 'results': [], 'outcome': stop.outcome,
                  'message': str(stop), 'remote_writes': 0, 'cleanup': {'status': 'not-created', 'path': None}}
    print(json.dumps(report, indent=2) if args.json else render(report))
    return EXIT[report['outcome']]


if __name__ == '__main__':
    raise SystemExit(main())
