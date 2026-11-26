#!/usr/bin/env python3
"""Integrate green PRs labeled `nightly` into `nightly`, validated by exact-SHA CI.

    python3 scripts/factory/nightly_integrate.py --validator boat|dispatch|external [--dry-run]

1. Read `nightly` (B) and `staging`; refuse unless staging is an ancestor of B.
2. List open PRs with the `nightly` label. Eligible: not draft, base `nightly`
   or `staging`, head on this repo, already not in B, and every gev-ci/*
   context green on the exact head SHA from a trusted creator.
3. Merge eligible heads onto B in PR-number order (merge commits, first parent
   = the previous nightly tip). A conflicting PR is skipped.
4. Push the result to a new `factory/nightly-candidate/<stamp>-<sha12>` branch
   and run full CI on that exact SHA (Boat, workflow dispatch, or an external
   runner). Read the verdict back from commit statuses on that SHA.
5. If the batch is red, rebuild one PR at a time on top of the last green tip,
   validating each, within `max_ci_runs_per_integration`.
6. Publish only a SHA whose own statuses are green: re-read `nightly` (must
   still be B) and every merged PR head (must be unchanged), re-read the
   statuses, plain-push (fast-forward only), and read the ref back.

Exit: 0 published or nothing to do, 1 refused or red, 2 usage, 75 locked.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import branch_gates as bg  # noqa: E402


@dataclass
class Candidate:
    number: int
    base: str
    head: str
    title: str
    url: str
    outcome: str = ""
    included: bool = False


@dataclass
class Attempt:
    sha: str
    prs: List[int]
    ref: str
    verdict: str = ""


@dataclass
class Result:
    exit_code: int
    nightly_before: str = ""
    nightly_after: str = ""
    published: Optional[str] = None
    candidates: List[Candidate] = field(default_factory=list)
    attempts: List[Attempt] = field(default_factory=list)
    reason: str = ""

    def as_dict(self) -> dict:
        return {
            "exit_code": self.exit_code, "reason": self.reason,
            "nightly_before": self.nightly_before, "nightly_after": self.nightly_after,
            "published": self.published,
            "prs": [c.__dict__ for c in self.candidates],
            "attempts": [a.__dict__ for a in self.attempts],
        }


class BoatValidator:
    """Runs scripts/factory-ci-boat.sh synchronously; it posts the statuses."""

    def __init__(self, script: Path):
        self.script = script

    def start(self, sha: str, base: str) -> None:
        bg.run(["bash", str(self.script), sha, base], check=False)


class DispatchValidator:
    """Dispatches factory-ci-sha.yml; its report job posts the statuses."""

    def __init__(self, gh, workflow: str, ref: str):
        self.gh, self.workflow, self.ref = gh, workflow, ref

    def start(self, sha: str, base: str) -> None:
        self.gh.dispatch(self.workflow, self.ref, {"sha": sha, "base-sha": base})


class ExternalValidator:
    """Another runner validates candidate refs; just wait for its statuses."""

    def start(self, sha: str, base: str) -> None:
        return None


def assess(pr: dict, policy: dict, gh, repo: str) -> Candidate:
    head = (pr.get("head") or {}).get("sha") or ""
    c = Candidate(int(pr["number"]), (pr.get("base") or {}).get("ref") or "", head,
                  pr.get("title") or "", pr.get("html_url") or "")
    if pr.get("draft"):
        c.outcome = "skipped: draft"
        return c
    if c.base not in policy["integrable_bases"]:
        c.outcome = (f"skipped: base `{c.base}` is not integrated (only "
                     f"{', '.join(policy['integrable_bases'])}); retarget once its parent lands")
        return c
    head_repo = ((pr.get("head") or {}).get("repo") or {}).get("full_name")
    if head_repo != repo:
        c.outcome = f"skipped: head is on `{head_repo}`, not `{repo}`"
        return c
    if not bg.SHA_RE.match(head):
        c.outcome = "skipped: head SHA unreadable"
        return c
    contexts = bg.ci_contexts(policy) + list(policy.get("pr_extra_required_contexts", []))
    verdict = bg.evaluate_ci(gh.statuses(head), contexts, policy["trusted_status_creators"],
                             policy.get("ci_red_prefix"))
    if not verdict.green:
        c.outcome = f"skipped: head not green ({verdict.summary()})"
        return c
    c.outcome = "eligible"
    return c


def merge_message(c: Candidate, nightly: str) -> str:
    return (f"Merge PR #{c.number} into {nightly}\n\n{c.title}\n\nPR: {c.url}\nHead: {c.head}\n"
            f"PR-Base: {c.base}\nIntegrated-By: scripts/factory/nightly_integrate.py\n")


def integrate(gh, git: bg.GitRepo, policy: dict, validator, summary: bg.Summary, dry_run: bool = False,
              poll_seconds: float = 30, sleep: Callable[[float], None] = time.sleep,
              stamp: Optional[str] = None) -> Result:
    repo, nightly, staging = policy["repo"], policy["nightly_branch"], policy["staging_branch"]
    name, email = policy["committer_name"], policy["committer_email"]
    stamp = stamp or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    res = Result(1)
    summary.add(f"## Nightly integration ({'dry run' if dry_run else 'apply'})", "")

    base = git.remote_ref(nightly)
    stage = git.remote_ref(staging)
    if not base or not stage:
        res.reason = f"cannot read `{nightly}` or `{staging}`"
        return _finish(res, summary)
    res.nightly_before = res.nightly_after = base
    git.fetch(f"+refs/heads/{nightly}:refs/gate/nightly", f"+refs/heads/{staging}:refs/gate/staging")
    if not git.is_ancestor(stage, base):
        res.reason = (f"`{staging}` {stage} is not an ancestor of `{nightly}` {base}; the ff-only promotion "
                      "invariant is broken. Nothing was integrated")
        return _finish(res, summary)
    summary.table(["ref", "sha"], [[f"`{nightly}` (B)", f"`{base}`"], [f"`{staging}`", f"`{stage}`"]])

    label = policy["nightly_label"]
    prs = [p for p in gh.open_prs() if label in {l.get("name") for l in p.get("labels") or []}]
    for pr in sorted(prs, key=lambda p: int(p["number"])):
        c = assess(pr, policy, gh, repo)
        if c.outcome == "eligible":
            if not git.fetch_sha(c.head):
                c.outcome = "skipped: head commit not fetchable"
            elif git.is_ancestor(c.head, base):
                c.outcome = "skipped: already in nightly"
        res.candidates.append(c)
    eligible = [c for c in res.candidates if c.outcome == "eligible"]

    def build(on: str, items: List[Candidate]) -> tuple:
        tip, used = on, []
        for c in items:
            merged = git.merge(tip, c.head, merge_message(c, nightly), name, email)
            if merged is None:
                c.outcome = f"skipped: conflicts with nightly after {', '.join('#%d' % u.number for u in used) or 'B'}"
                continue
            tip = merged
            used.append(c)
        return tip, used

    tip, used = build(base, eligible)
    if not used:
        res.exit_code = 0
        res.reason = "nothing to integrate"
        return _finish(res, summary)

    if dry_run:
        for c in used:
            c.outcome = "would integrate"
        res.exit_code = 0
        res.reason = f"dry run: would validate `{tip}` (not pushed)"
        res.attempts.append(Attempt(tip, [c.number for c in used], "(local only)", "not run"))
        return _finish(res, summary)

    runs_left = int(policy.get("max_ci_runs_per_integration", 8))

    def validate(sha: str, prs_in: List[Candidate], on: str) -> bg.CiVerdict:
        nonlocal runs_left
        runs_left -= 1
        ref = f"{policy['candidate_ref_prefix']}{stamp}-{sha[:12]}"
        att = Attempt(sha, [c.number for c in prs_in], ref)
        res.attempts.append(att)
        push = git.push(sha, ref)
        if push.returncode != 0:
            att.verdict = "candidate push failed"
            return bg.CiVerdict("pending", [("push", "error", push.stderr.strip()[:200])])
        min_id = bg.max_status_id(gh, sha)
        validator.start(sha, on)
        verdict = bg.wait_for_full(gh, sha, policy, float(policy.get("ci_wait_minutes", 90)),
                                   poll_seconds, sleep, min_id=min_id)
        att.verdict = verdict.summary()
        return verdict

    accepted: List[Candidate] = []
    verdict = validate(tip, used, base)
    if verdict.green:
        accepted, good = list(used), tip
    else:
        good = base
        if len(used) > 1:
            # Find which PRs are green on their own, one at a time on top of the last green tip.
            for c in used:
                if runs_left <= 0:
                    c.outcome = "not retried: CI run budget spent"
                    continue
                single, ok = build(good, [c])
                if not ok:
                    continue
                v = validate(single, [c], good)
                if v.green:
                    good = single
                    accepted.append(c)
                else:
                    c.outcome = f"rejected: red on top of nightly ({v.summary()[:160]})"
        else:
            used[0].outcome = f"rejected: integration red ({verdict.summary()[:160]})"

    if good == base:
        res.reason = "no candidate produced a green integration SHA; nightly unchanged"
        return _finish(res, summary)

    # Publish `good`. Every check is re-done against live state right before the push.
    now_base = git.remote_ref(nightly)
    if now_base != base:
        res.reason = f"`{nightly}` moved during the run ({base} -> {now_base}); refusing to publish"
        return _finish(res, summary)
    for c in accepted:
        live = gh.pr(c.number)
        live_head = (live.get("head") or {}).get("sha")
        if live.get("state") != "open" or live_head != c.head:
            res.reason = (f"PR #{c.number} changed during the run (state {live.get('state')}, head "
                          f"{live_head}); refusing to publish {good}")
            return _finish(res, summary)
    final = bg.evaluate_exact_ci(gh.statuses(good), policy)
    if not final.green:
        res.reason = f"statuses on `{good}` are no longer green ({final.summary()}); refusing to publish"
        return _finish(res, summary)
    if not git.is_ancestor(base, good):
        res.reason = "internal: integration SHA does not descend from nightly"
        return _finish(res, summary)
    push = git.push(good, nightly)
    after = git.remote_ref(nightly)
    if push.returncode != 0 or after != good:
        res.nightly_after = after or ""
        res.reason = (f"push of `{good}` to `{nightly}` was refused or not visible (exit {push.returncode}, "
                      f"remote now {after}): {push.stderr.strip()[:300]}")
        return _finish(res, summary)
    for c in accepted:
        c.included = True
        c.outcome = "integrated" + (" (base staging: stays open until staging is promoted past it)"
                                    if c.base == staging else "")
    res.exit_code, res.published, res.nightly_after = 0, good, good
    res.reason = f"`{nightly}` fast-forwarded {base[:12]} -> {good[:12]}"
    return _finish(res, summary)


def _finish(res: Result, summary: bg.Summary) -> Result:
    if res.candidates:
        summary.add("### Labeled PRs", "")
        summary.table(["PR", "base", "head SHA", "outcome"],
                      [[f"#{c.number}", f"`{c.base}`", f"`{c.head}`", c.outcome] for c in res.candidates])
    else:
        summary.add("No open PRs carry the `nightly` label.", "")
    if res.attempts:
        summary.add("### Integration SHAs validated by full CI", "")
        summary.table(["integration SHA", "PRs", "candidate ref", "gev-ci verdict (exact SHA)"],
                      [[f"`{a.sha}`", ", ".join(f"#{n}" for n in a.prs), f"`{a.ref}`", a.verdict]
                       for a in res.attempts])
    icon = "✅" if res.exit_code == 0 else "❌"
    summary.add(f"{icon} **{res.reason}**", "",
                f"nightly before `{res.nightly_before}`, after `{res.nightly_after}`")
    return res


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--validator", choices=["boat", "dispatch", "external"], required=True)
    ap.add_argument("--ci-workflow", default="factory-ci-sha.yml")
    ap.add_argument("--ci-ref", default="staging", help="ref whose factory-ci-sha.yml is dispatched")
    ap.add_argument("--dry-run", action="store_true", help="assess and merge locally; push nothing")
    ap.add_argument("--report", help="also write the JSON result here")
    ap.add_argument("--lock", default=bg.default_lock_path(), help="host lock file ('' to rely on Actions concurrency)")
    args = ap.parse_args(argv)
    try:
        policy = bg.load_policy()
        gh = bg.GitHubCli(policy["repo"])
        git = bg.GitRepo(f"https://github.com/{policy['repo']}.git")
        if args.validator == "boat":
            validator = BoatValidator(Path(__file__).resolve().parent.parent / "factory-ci-boat.sh")
        elif args.validator == "dispatch":
            validator = DispatchValidator(gh, args.ci_workflow, args.ci_ref)
        else:
            validator = ExternalValidator()
        with bg.HostLock(args.lock or None):
            res = integrate(gh, git, policy, validator, bg.Summary(), dry_run=args.dry_run)
    except bg.Refusal as exc:
        print(f"refused: {exc.reason}", file=sys.stderr)
        return exc.code
    if args.report:
        Path(args.report).write_text(json.dumps(res.as_dict(), indent=2) + "\n", encoding="utf-8")
    return res.exit_code


if __name__ == "__main__":
    sys.exit(main())
