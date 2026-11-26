#!/usr/bin/env python3
"""Record one soak observation on every validated nightly tip not yet on staging.

    python3 scripts/factory/soak_observe.py [--sha <full sha>]

Tracked SHAs are the first-parent commits of `staging..nightly` that carry a
`gev-ci/full` status (the tips nightly integration published). For each one it
posts a `gev-soak/nightly` commit status:

* success  the SHA is in nightly history, its own gev-ci/* are green, and the
           current nightly tip is green;
* failure  it left nightly history, its own gev-ci/* turned red, or the
           nightly tip is red. A failure resets that SHA's soak;
* pending  inconclusive (own CI or tip not validated). It neither extends nor
           resets soak; long runs of it break soak through the gap limit.

GitHub stamps `created_at` and the creator on every status and offers no delete,
so this status history is the persisted, append-only soak ledger.
Exit: 0 observed, 1 could not observe, 2 usage.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import branch_gates as bg  # noqa: E402


def observe(gh, git: bg.GitRepo, policy: dict, summary: bg.Summary, only: Optional[str] = None,
            target_url: str = "") -> Tuple[int, List[Tuple[str, str, str]]]:
    nightly, staging, ctx = policy["nightly_branch"], policy["staging_branch"], policy["soak_context"]
    tip, stage = git.remote_ref(nightly), git.remote_ref(staging)
    if not tip or not stage:
        summary.add(f"❌ cannot read `{nightly}`/`{staging}`; nothing observed")
        return 1, []
    git.fetch(f"+refs/heads/{nightly}:refs/gate/nightly", f"+refs/heads/{staging}:refs/gate/staging")
    ci_tip = bg.evaluate_exact_ci(gh.statuses(tip), policy)

    if only:
        bg.require_sha(only)
        if not git.fetch_sha(only):
            summary.add(f"❌ `{only}` is not a commit of the repository; nothing observed")
            return 1, []
        tracked = [only]
    else:
        tracked = [s for s in git.first_parent_range(stage, tip)
                   if any(st.context == policy["ci_full_context"] for st in gh.statuses(s))][:50]

    rows: List[Tuple[str, str, str]] = []
    for sha in tracked:
        in_nightly = git.is_ancestor(sha, tip)
        ci_sha = bg.evaluate_exact_ci(gh.statuses(sha), policy)
        state, desc = bg.observation_for(sha, in_nightly, tip, ci_sha, None if sha == tip else ci_tip)
        posted = gh.post_status(sha, state, ctx, desc, target_url)
        rows.append((sha, state, f"{desc} (status {posted.id} at {bg.fmt_time(posted.created_at)})"))

    summary.add(f"## Soak observation (`{ctx}`)", "",
                f"nightly `{tip}` ({ci_tip.state}), staging `{stage}`", "")
    if rows:
        summary.table(["SHA", "observation", "detail"], [[f"`{s}`", st, d] for s, st, d in rows])
    else:
        summary.add("No validated nightly tips are ahead of staging.")
    return 0, rows


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sha", help="observe only this SHA")
    args = ap.parse_args(argv)
    try:
        policy = bg.load_policy()
        gh = bg.GitHubCli(policy["repo"])
        git = bg.GitRepo(f"https://github.com/{policy['repo']}.git")
        code, _ = observe(gh, git, policy, bg.Summary(), args.sha, bg.run_url())
        return code
    except bg.Refusal as exc:
        print(f"refused: {exc.reason}", file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
