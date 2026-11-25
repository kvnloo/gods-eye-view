#!/usr/bin/env python3
"""PR check: touch at most N hot-file entries.

A hot entry is a file, or a group of files that change together (all translation
catalogues count as one entry), that most upstream changes touch, so two PRs in
flight touching it are the likeliest merge conflict. The list, N and the
evidence they were chosen from live in `scripts/factory/hot-files.json`.

    python3 scripts/factory/hot_files.py --base origin/nightly --head HEAD
    python3 scripts/factory/hot_files.py --files a.js docs/CURRENT-STATE.md
    python3 scripts/factory/hot_files.py --base B --head H --max 3 --json

Exit 0 within budget, 1 over budget, 2 usage or git error.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import factory_git as g  # noqa: E402

DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hot-files.json')


def glob_regex(pattern):
    """`*` matches within one path segment, `**/` any number of segments."""
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out.append('(?:.*/)?')
            i += 3
        elif pattern.startswith('**', i):
            out.append('.*')
            i += 2
        elif pattern[i] == '*':
            out.append('[^/]*')
            i += 1
        elif pattern[i] == '?':
            out.append('[^/]')
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile('^' + ''.join(out) + '$')


def load_config(path=None):
    with open(path or DEFAULT_CONFIG, encoding='utf-8') as handle:
        config = json.load(handle)
    n = config.get('max_hot_entries')
    if not isinstance(n, int) or n < 0:
        raise ValueError('max_hot_entries must be a non-negative integer')
    ids = set()
    for entry in config.get('entries', []):
        if entry['id'] in ids or not entry.get('paths'):
            raise ValueError(f"hot entry {entry['id']!r} is duplicated or has no paths")
        ids.add(entry['id'])
        entry['_regex'] = [glob_regex(p) for p in entry['paths']]
    return config


def hot_entries_touched(paths, config):
    """{entry id: sorted touched paths} for every hot entry the paths hit."""
    touched = {}
    for entry in config['entries']:
        hits = sorted({p for p in paths if any(r.match(p) for r in entry['_regex'])})
        if hits:
            touched[entry['id']] = hits
    return touched


def changed_paths(repo, base, head):
    merge_base = g.out(['merge-base', base, head], repo)
    return merge_base, g.lines(['diff', '--name-only', '--no-renames', merge_base, head], repo)


def evaluate(paths, config, limit=None):
    limit = config['max_hot_entries'] if limit is None else limit
    touched = hot_entries_touched(paths, config)
    return {
        'max_hot_entries': limit,
        'hot_entries_touched': len(touched),
        'hot_files_touched': sum(len(v) for v in touched.values()),
        'entries': touched,
        'changed_files': len(paths),
        'ok': len(touched) <= limit,
    }


def render(result):
    lines = [f"Hot-file budget: {result['hot_entries_touched']}/{result['max_hot_entries']} hot entries "
             f"({result['hot_files_touched']} hot files of {result['changed_files']} changed)"]
    for entry, paths in result['entries'].items():
        lines.append(f"  {entry}: {', '.join(paths)}")
    if not result['ok']:
        lines.append('FAIL: split the PR, or move the change into new files and wire it with one small edit.'
                     ' See CONTRIBUTING-FACTORY.md#hot-files.')
    else:
        lines.append('OK')
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--config')
    parser.add_argument('--base')
    parser.add_argument('--head', default='HEAD')
    parser.add_argument('--files', nargs='*', help='check these paths instead of a git range')
    parser.add_argument('--max', type=int, help='override max_hot_entries')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        if args.files is not None:
            paths, merge_base = args.files, None
        elif args.base:
            merge_base, paths = changed_paths(args.repo, args.base, args.head)
        else:
            parser.error('pass --base (and --head) or --files')
    except (ValueError, OSError, g.GitError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    result = evaluate(paths, config, args.max)
    result['merge_base'] = merge_base
    print(json.dumps(result, indent=2) if args.json else render(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
