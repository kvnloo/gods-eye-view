#!/usr/bin/env python3
"""Fast-forward `staging` to one explicitly chosen nightly SHA, or refuse.

    python3 scripts/factory/promote_staging.py --sha <40-hex nightly sha> [--dry-run]

Every condition is required; any unknown is a refusal:

1. `sha` is a full 40-hex SHA of a commit in the repository.
2. `sha` is in `nightly` history (ancestor of, or equal to, the nightly tip).
3. `staging` is an ancestor of `sha`, so the update is a fast-forward.
4. Every gev-ci/* context on that exact SHA is a trusted success.
5. A fresh soak observation is recorded, then the SHA's own status history
   shows >= 24 h of trusted soak observations, no gap over the limit, and no
   red (any gev-ci/* or gev-soak failure/error) since the soak started.
6. `staging` and `nightly` still point where they did at step 2, and the
   statuses are still green, immediately before the push.
7. Plain push (no force; git refuses a non-fast-forward), then read back.

Exit: 0 promoted (or already there), 1 refused, 2 usage, 75 locked.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import branch_gates as bg  # noqa: E402
import soak_observe  # noqa: E402


@dataclass
class Promotion:
    exit_code: int
    sha: str
    reason: str = ""
    staging_before: str = ""
    staging_after: str = ""
    nightly: str = ""
    checks: List[List[str]] = field(default_factory=list)
    soak: Optional[dict] = None

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def promote(gh, git: bg.GitRepo, policy: dict, sha: str, summary: bg.Summary, dry_run: bool = False,
            observe: bool = True, target_url: str = "") -> Promotion:
    staging, nightly = policy["staging_branch"], policy["nightly_branch"]
    p = Promotion(1, sha)
    summary.add(f"## Staging promotion of `{sha}` ({'dry run' if dry_run else 'apply'})", "")

    def check(name: str, ok: bool, detail: str) -> bool:
        p.checks.append([name, "pass" if ok else "FAIL", detail])
        return ok

    def refuse(reason: str) -> Promotion:
        p.reason = "refused: " + reason
        return finish(p, summary)

    try:
        bg.require_sha(sha)
    except bg.Refusal as exc:
        p.exit_code = 2
        check("full SHA", False, exc.reason)
        return refuse(exc.reason)
    check("full SHA", True, "40 hex")

    s0, n0 = git.remote_ref(staging), git.remote_ref(nightly)
    if not s0 or not n0:
        return refuse(f"cannot read `{staging}`/`{nightly}`")
    p.staging_before, p.nightly, p.staging_after = s0, n0, s0
    git.fetch(f"+refs/heads/{nightly}:refs/gate/nightly", f"+refs/heads/{staging}:refs/gate/staging")
    if sha == s0:
        p.exit_code = 0
        p.reason = f"`{staging}` is already at `{sha}`; nothing to do"
        return finish(p, summary)
    if not check("commit exists", git.fetch_sha(sha), "fetched by SHA"):
        return refuse(f"`{sha}` is not a commit of {policy['repo']}")
    if not check("in nightly history", git.is_ancestor(sha, n0), f"ancestor of nightly `{n0}`"):
        return refuse(f"`{sha}` is not in `{nightly}` history (tip `{n0}`)")
    if not check("staging is ancestor", git.is_ancestor(s0, sha), f"`{s0}` ⊑ sha (fast-forward)"):
        return refuse(f"`{staging}` `{s0}` is not an ancestor of `{sha}`; promotion would not be a fast-forward")

    ci = bg.evaluate_exact_ci(gh.statuses(sha), policy)
    if not check("exact-SHA CI", ci.green, ci.summary()):
        return refuse(f"gev-ci on `{sha}` is {ci.summary()}")

    if observe:
        code, rows = soak_observe.observe(gh, git, policy, bg.Summary(path=""), sha, target_url)
        fresh_ok = code == 0 and bool(rows) and rows[0][1] == "success"
        if not check("fresh soak observation", fresh_ok, rows[0][2] if rows else "not recorded"):
            return refuse("the fresh soak observation is not green: " + (rows[0][2] if rows else "not recorded"))
    statuses = gh.statuses(sha)
    # Staleness is judged against the later of the API client's clock and the
    # newest server-stamped observation. Soak length uses server stamps only.
    soak_now = gh.now()
    latest_obs = [s.created_at for s in statuses if s.context == policy["soak_context"]]
    if latest_obs:
        soak_now = max(soak_now, max(latest_obs))
    soak = bg.compute_soak(statuses, policy, soak_now)
    p.soak = soak.as_dict()
    if not check("soak", soak.ok, soak.reason):
        return refuse(soak.reason)

    # Re-read everything that could have changed, right before the push.
    s1, n1 = git.remote_ref(staging), git.remote_ref(nightly)
    if not check("refs unchanged", s1 == s0 and n1 == n0, f"staging `{s1}`, nightly `{n1}`"):
        return refuse(f"refs changed during promotion (staging {s0} -> {s1}, nightly {n0} -> {n1})")
    ci2 = bg.evaluate_exact_ci(gh.statuses(sha), policy)
    if not check("exact-SHA CI (re-read)", ci2.green, ci2.summary()):
        return refuse(f"gev-ci on `{sha}` changed to {ci2.summary()}")

    if dry_run:
        p.exit_code = 0
        p.reason = f"dry run: every check passed; would fast-forward `{staging}` {s0[:12]} -> {sha[:12]}"
        return finish(p, summary)

    push = git.push(sha, staging)
    after = git.remote_ref(staging)
    p.staging_after = after or ""
    if push.returncode != 0 or after != sha:
        return refuse(f"push refused or not visible (exit {push.returncode}, staging now {after}): "
                      f"{push.stderr.strip()[:300]}")
    try:
        gh.post_status(sha, "success", policy["promotion_context"],
                       f"promoted to {staging} from {s0[:12]}; soak {soak.hours:.1f} h", target_url)
    except Exception as exc:  # the ref moved; the audit status is best-effort and reported
        check("promotion record", False, str(exc)[:200])
    p.exit_code = 0
    p.reason = f"`{staging}` fast-forwarded {s0[:12]} -> {sha[:12]}"
    return finish(p, summary)


def finish(p: Promotion, summary: bg.Summary) -> Promotion:
    if p.checks:
        summary.table(["check", "result", "detail"], p.checks)
    if p.soak:
        summary.add("<details><summary>soak evidence</summary>", "", "```json",
                    json.dumps(p.soak, indent=2), "```", "</details>", "")
    summary.add(f"{'✅' if p.exit_code == 0 else '❌'} **{p.reason}**", "",
                f"staging before `{p.staging_before}`, after `{p.staging_after}`; nightly `{p.nightly}`")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sha", required=True, help="full 40-hex nightly SHA to promote")
    ap.add_argument("--dry-run", action="store_true", help="run every check; push nothing")
    ap.add_argument("--report", help="also write the JSON result here")
    ap.add_argument("--lock", default=bg.default_lock_path(), help="host lock file ('' to rely on Actions concurrency)")
    args = ap.parse_args(argv)
    try:
        policy = bg.load_policy()
        gh = bg.GitHubCli(policy["repo"])
        git = bg.GitRepo(f"https://github.com/{policy['repo']}.git")
        with bg.HostLock(args.lock or None):
            p = promote(gh, git, policy, args.sha.strip(), bg.Summary(), dry_run=args.dry_run,
                        target_url=bg.run_url())
    except bg.Refusal as exc:
        print(f"refused: {exc.reason}", file=sys.stderr)
        return exc.code
    if args.report:
        Path(args.report).write_text(json.dumps(p.as_dict(), indent=2) + "\n", encoding="utf-8")
    return p.exit_code


if __name__ == "__main__":
    sys.exit(main())
