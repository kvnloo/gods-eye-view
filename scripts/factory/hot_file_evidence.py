#!/usr/bin/env python3
"""Measure which files most changes touch, to choose the hot-file list and N.

Unit of change: one first-parent commit on the ref (a merged PR's merge commit,
diffed against its first parent, or a direct/squashed commit). Optionally also
reads the fork's open PR queue through `gh` (read-only GraphQL).

    python3 scripts/factory/hot_file_evidence.py --ref upstream/main --since 2026-08-25
    python3 scripts/factory/hot_file_evidence.py --ref upstream/main --since 2026-08-25 --open-prs kvnloo/gods-eye-view

The output is JSON; CONTRIBUTING-FACTORY.md records the snapshot the hot-file
config was chosen from.
"""
import argparse
import collections
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory_git as g  # noqa: E402
from hot_files import load_config, hot_entries_touched  # noqa: E402


def change_units(repo, ref, since):
    """Yield (sha, [paths]) for each first-parent change on ref since date."""
    shas = g.lines(['rev-list', '--first-parent', f'--since={since}', ref], repo)
    for sha in shas:
        parents = g.out(['rev-list', '--parents', '-n', '1', sha], repo).split()[1:]
        base = parents[0] if parents else g.out(['hash-object', '-t', 'tree', '/dev/null'], repo)
        paths = g.lines(['diff', '--name-only', '--no-renames', base, sha], repo)
        yield sha, paths


def open_pr_files(repo_slug):
    owner, name = repo_slug.split('/')
    query = '''query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
      pullRequests(states:OPEN,first:50,after:$cursor){pageInfo{hasNextPage endCursor}
        nodes{number changedFiles files(first:100){nodes{path}}}}}}'''
    cursor, prs = None, []
    while True:
        args = ['gh', 'api', 'graphql', '-f', f'query={query}', '-F', f'owner={owner}', '-F', f'name={name}']
        if cursor:
            args += ['-F', f'cursor={cursor}']
        data = json.loads(subprocess.check_output(args, text=True))
        page = data['data']['repository']['pullRequests']
        for node in page['nodes']:
            prs.append((node['number'], node['changedFiles'], [f['path'] for f in node['files']['nodes']]))
        if not page['pageInfo']['hasNextPage']:
            return prs
        cursor = page['pageInfo']['endCursor']


def summarise(units, config, top):
    counts = collections.Counter()
    per_unit = []
    for _, paths in units:
        counts.update(set(paths))
        per_unit.append(len(hot_entries_touched(paths, config)))
    total = len(per_unit)
    dist = collections.Counter(per_unit)
    cumulative, acc = {}, 0
    for k in sorted(dist):
        acc += dist[k]
        cumulative[k] = round(acc / total, 4) if total else 0
    return {
        'units': total,
        'top_files': [{'path': p, 'units': n, 'share': round(n / total, 4)} for p, n in counts.most_common(top)],
        'hot_entries_per_unit': {str(k): dist[k] for k in sorted(dist)},
        'cumulative_share_at_most': {str(k): v for k, v in cumulative.items()},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--ref', default='upstream/main')
    parser.add_argument('--since', required=True, help='git date, e.g. 2026-08-25')
    parser.add_argument('--config', default=None)
    parser.add_argument('--top', type=int, default=30)
    parser.add_argument('--open-prs', metavar='OWNER/REPO')
    args = parser.parse_args(argv)
    config = load_config(args.config)
    report = {
        'ref': args.ref,
        'ref_sha': g.out(['rev-parse', args.ref], args.repo),
        'since': args.since,
        'history': summarise(list(change_units(args.repo, args.ref, args.since)), config, args.top),
    }
    if args.open_prs:
        prs = open_pr_files(args.open_prs)
        report['open_prs'] = summarise([(n, files) for n, _, files in prs], config, args.top)
        report['open_prs']['repo'] = args.open_prs
        report['open_prs']['truncated_file_lists'] = [n for n, count, files in prs if count > len(files)]
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
