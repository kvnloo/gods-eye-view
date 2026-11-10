#!/usr/bin/env python3
"""Validate the fork's PR target and branch namespace without API access."""
import json
import os
from pathlib import Path
import re
import sys


def check(event):
    errors = []
    if event.get('repository', {}).get('full_name') != 'kvnloo/gods-eye-view':
        errors.append('This policy applies only to kvnloo/gods-eye-view')
    pull = event.get('pull_request', {})
    if pull.get('base', {}).get('ref') != 'main':
        errors.append('PR base must be main')
    branch = pull.get('head', {}).get('ref', '')
    if not re.fullmatch(r'(feature|wave|salvage|refresh)/[^\s]+', branch):
        errors.append('PR head must use feature/*, wave/*, salvage/*, or refresh/*')
    return errors


if __name__ == '__main__':
    try:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        errors = check(event)
    except (KeyError, OSError, ValueError, AttributeError, TypeError) as error:
        print(f'Cannot validate PR event: {error}', file=sys.stderr)
        raise SystemExit(1)
    for error in errors:
        print(error, file=sys.stderr)
    raise SystemExit(bool(errors))
