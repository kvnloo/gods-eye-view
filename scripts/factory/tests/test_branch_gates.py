"""End-to-end tests for nightly integration, soak observation and staging promotion.

Real git: a local bare `origin` with receive.denyNonFastForwards and a
pre-receive hook that refuses a nightly/staging update whose new SHA lacks a
trusted gev-ci/full success (what the GitHub ruleset does). Fake GitHub: an
in-memory PR list and commit-status store whose clock is owned by the fake
server, exactly as `created_at` is owned by GitHub. The production code paths
are called unchanged; no production flag exists to inject time or statuses.

    python3 -m unittest discover -s scripts/factory/tests -p 'test_branch_gates.py' -v
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import branch_gates as bg  # noqa: E402
import nightly_integrate as ni  # noqa: E402
import promote_staging as ps  # noqa: E402
import soak_observe as so  # noqa: E402

REPO = "kvnloo/gods-eye-view"
POLICY = bg.load_policy()
GATES = bg.ci_contexts(POLICY)
T0 = dt.datetime(2026, 11, 20, 0, 0, 0, tzinfo=dt.timezone.utc)

HOOK = r'''#!/usr/bin/env python3
import json, sys
STATUSES = %r
data = json.load(open(STATUSES))
for line in sys.stdin:
    old, new, ref = line.split()
    if ref not in ("refs/heads/nightly", "refs/heads/staging"):
        continue
    if new == "0" * 40:
        print("deletion refused"); sys.exit(1)
    full = [s for s in data.get(new, []) if s["context"] == "gev-ci/full"]
    full.sort(key=lambda s: (s["created_at"], s["id"]))
    if not full or full[-1]["state"] != "success" or full[-1]["creator"]["login"] not in ("kvnloo", "github-actions[bot]"):
        print("required status gev-ci/full is not success on " + new); sys.exit(1)
'''


def git(cwd, *args, env=None):
    out = subprocess.run(["git", "-C", str(cwd), *args], text=True, capture_output=True, env=env)
    if out.returncode:
        raise AssertionError(f"git {' '.join(args)}: {out.stderr}")
    return out.stdout.strip()


class FakeGitHub:
    def __init__(self, origin: Path, store: Path):
        self.origin, self.store = origin, store
        self.clock = T0
        self.next_id = 1000
        self.data: dict = {}
        self.prs: dict = {}
        self.on_statuses = None  # callable(sha) for race injection
        self.dispatched: list = []
        self._save()

    # clock owned by the "server"
    def now(self):
        return self.clock

    def advance(self, hours: float):
        self.clock += dt.timedelta(hours=hours)

    def _save(self):
        self.store.write_text(json.dumps(self.data))

    def post_status(self, sha, state, context, description, target_url="", creator="kvnloo"):
        bg.require_sha(sha)
        self.next_id += 1
        raw = {"id": self.next_id, "context": context, "state": state, "description": description[:140],
               "target_url": target_url, "created_at": bg.fmt_time(self.clock), "creator": {"login": creator}}
        self.data.setdefault(sha, []).append(raw)
        self._save()
        self.clock += dt.timedelta(seconds=1)
        return bg.Status.from_api(raw)

    def statuses(self, sha):
        if self.on_statuses:
            self.on_statuses(sha)
        return [bg.Status.from_api(r) for r in self.data.get(sha, [])]

    def add_pr(self, number, branch, base, labels=("nightly",), draft=False, head_repo=REPO):
        self.prs[number] = {"number": number, "branch": branch, "base": base, "labels": list(labels),
                            "draft": draft, "head_repo": head_repo, "state": "open"}

    def _render(self, p):
        sha = git(self.origin, "rev-parse", f"refs/heads/{p['branch']}")
        return {"number": p["number"], "state": p["state"], "draft": p["draft"], "title": f"PR {p['number']}",
                "html_url": f"https://github.com/{REPO}/pull/{p['number']}",
                "labels": [{"name": n} for n in p["labels"]], "base": {"ref": p["base"]},
                "head": {"sha": sha, "ref": p["branch"], "repo": {"full_name": p["head_repo"]}}}

    def open_prs(self):
        return [self._render(p) for p in self.prs.values() if p["state"] == "open"]

    def pr(self, number):
        return self._render(self.prs[number])

    def dispatch(self, workflow, ref, inputs):
        self.dispatched.append((workflow, ref, inputs))


class FakeCI:
    """Validates by tree content: a file RED, or both semantic-a and semantic-b, is a failure."""

    def __init__(self, gh: FakeGitHub, origin: Path):
        self.gh, self.origin, self.runs = gh, origin, []
        self.before_post = None

    def verdict(self, sha):
        names = set(git(self.origin, "ls-tree", "-r", "--name-only", sha).splitlines())
        return "failure" if "RED" in names or {"semantic-a", "semantic-b"} <= names else "success"

    def start(self, sha, base=""):
        self.runs.append(sha)
        if self.before_post:
            self.before_post(sha)
        state = self.verdict(sha)
        for ctx in GATES[:-1]:
            self.gh.post_status(sha, "failure" if (state == "failure" and ctx == "gev-ci/unit") else "success",
                                ctx, "fake gate", creator="github-actions[bot]")
        self.gh.post_status(sha, state, "gev-ci/full", "fake full", creator="github-actions[bot]")


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gev-gates-test-"))
        self.origin = self.tmp / "origin.git"
        self.store = self.tmp / "statuses.json"
        git(self.tmp, "init", "-q", "--bare", str(self.origin))
        git(self.origin, "config", "receive.denyNonFastForwards", "true")
        git(self.origin, "config", "receive.denyDeletes", "true")
        self.gh = FakeGitHub(self.origin, self.store)
        hook = self.origin / "hooks" / "pre-receive"
        hook.write_text(HOOK % str(self.store))
        hook.chmod(0o755)
        self.work = self.tmp / "work"
        git(self.tmp, "init", "-q", "-b", "nightly", str(self.work))
        for k, v in (("user.name", "t"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
            git(self.work, "config", k, v)
        git(self.work, "remote", "add", "origin", str(self.origin))
        self.ci = FakeCI(self.gh, self.origin)
        root = self.commit("README", "root\n")
        git(self.work, "push", "-q", "origin", "nightly:refs/heads/seed")  # unprotected ref first
        self.ci.start(root)  # nightly/staging start validated, like 53f0caa
        git(self.work, "push", "-q", "origin", "nightly", "nightly:staging")
        self.root = root

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def commit(self, path, text, msg=None):
        (self.work / path).write_text(text)
        git(self.work, "add", path)
        git(self.work, "commit", "-q", "-m", msg or f"add {path}")
        return git(self.work, "rev-parse", "HEAD")

    def branch(self, name, base, files, green=True, push=True):
        git(self.work, "fetch", "-q", "origin")
        git(self.work, "checkout", "-q", "-B", name, base)
        sha = ""
        for path, text in files:
            sha = self.commit(path, text)
        if push:
            git(self.work, "push", "-q", "origin", f"{name}:refs/heads/{name}")
        if green:
            self.ci.start(sha)
        return sha

    def remote(self, branch):
        return git(self.origin, "rev-parse", f"refs/heads/{branch}")

    def repo(self):
        return bg.GitRepo(str(self.origin), workdir=str(self.tmp / f"scratch-{len(os.listdir(self.tmp))}"),
                          use_gh_credentials=False)

    def integrate(self, dry_run=False, validator=None, policy=None):
        return ni.integrate(self.gh, self.repo(), policy or POLICY, validator or self.ci, bg.Summary(path=str(self.tmp / "summary.md")),
                            dry_run=dry_run, poll_seconds=0, sleep=lambda s: None, stamp="20261120T000000Z")

    def observe(self, only=None):
        return so.observe(self.gh, self.repo(), POLICY, bg.Summary(path=""), only)

    def promote(self, sha, dry_run=False):
        return ps.promote(self.gh, self.repo(), POLICY, sha, bg.Summary(path=str(self.tmp / "promo.md")),
                          dry_run=dry_run)

    def soak_hourly(self, hours, start_after=1.0):
        self.gh.advance(start_after)
        for _ in range(int(hours)):
            self.observe()
            self.gh.advance(1)


class TestHarness(Fixture):
    def test_origin_enforces_like_github(self):
        """The harness itself refuses unvalidated and non-ff updates (so tests prove real refusals)."""
        sha = self.branch("unvalidated", self.root, [("u.txt", "u\n")], green=False)
        r = subprocess.run(["git", "-C", str(self.work), "push", "origin", f"{sha}:refs/heads/nightly"],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("required status gev-ci/full", r.stderr)
        self.assertEqual(self.remote("nightly"), self.root)


class TestIntegration(Fixture):
    def make_prs(self):
        a = self.branch("feat/a", self.root, [("a.txt", "a\n")])
        b = self.branch("feat/b", self.root, [("b.txt", "b\n")])
        s = self.branch("feat/on-staging", self.root, [("s.txt", "s\n")])
        self.branch("feat/unlabeled", self.root, [("x1.txt", "x\n")])
        self.branch("feat/draft", self.root, [("x2.txt", "x\n")])
        self.branch("feat/fork", self.root, [("x3.txt", "x\n")])
        self.branch("feat/stacked", self.root, [("x4.txt", "x\n")])
        self.branch("feat/red-head", self.root, [("RED", "x\n")])
        self.branch("feat/no-ci", self.root, [("x5.txt", "x\n")], green=False)
        untrusted = self.branch("feat/untrusted", self.root, [("x6.txt", "x\n")], green=False)
        for ctx in GATES:
            self.gh.post_status(untrusted, "success", ctx, "self-reported", creator="drive-by")
        flaky = self.branch("feat/flaky", self.root, [("x7.txt", "x\n")])
        self.gh.post_status(flaky, "failure", "gev-ci/unit", "rerun went red", creator="kvnloo")
        self.branch("feat/c1", self.root, [("conflict.txt", "one\n")])
        self.branch("feat/c2", self.root, [("conflict.txt", "two\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        self.gh.add_pr(2, "feat/b", "nightly")
        self.gh.add_pr(3, "feat/on-staging", "staging")
        self.gh.add_pr(4, "feat/unlabeled", "nightly", labels=())
        self.gh.add_pr(5, "feat/draft", "nightly", draft=True)
        self.gh.add_pr(6, "feat/fork", "nightly", head_repo="someone/gods-eye-view")
        self.gh.add_pr(7, "feat/stacked", "feat/a")
        self.gh.add_pr(8, "feat/red-head", "nightly")
        self.gh.add_pr(9, "feat/no-ci", "nightly")
        self.gh.add_pr(10, "feat/untrusted", "nightly")
        self.gh.add_pr(11, "feat/flaky", "nightly")
        self.gh.add_pr(12, "feat/c1", "nightly")
        self.gh.add_pr(13, "feat/c2", "nightly")
        return a, b, s

    def test_accepts_only_green_eligible_prs_and_validates_the_exact_integration_sha(self):
        a, b, s = self.make_prs()
        res = self.integrate()
        self.assertEqual(res.exit_code, 0, res.reason)
        out = {c.number: c.outcome for c in res.candidates}
        self.assertNotIn(4, out)  # unlabeled PRs are never listed
        self.assertEqual(out[1], "integrated")
        self.assertEqual(out[2], "integrated")
        self.assertTrue(out[3].startswith("integrated (base staging"), out[3])
        self.assertEqual(out[12], "integrated")
        self.assertIn("draft", out[5])
        self.assertIn("not `kvnloo/gods-eye-view`", out[6])
        self.assertIn("base `feat/a` is not integrated", out[7])
        self.assertIn("head not green (red", out[8])
        self.assertIn("missing", out[9])
        self.assertIn("untrusted", out[10])
        self.assertIn("gev-ci/unit=failure", out[11])
        self.assertIn("conflicts", out[13])
        tip = self.remote("nightly")
        self.assertEqual(res.published, tip)
        self.assertEqual(self.ci.runs[-1], tip)  # CI ran on the exact published SHA
        self.assertTrue(bg.evaluate_exact_ci(self.gh.statuses(tip), POLICY).green)
        # first-parent chain is root -> merges, so nightly only ever fast-forwards
        chain = git(self.origin, "rev-list", "--first-parent", f"{self.root}..{tip}").splitlines()
        self.assertEqual(len(chain), 4)
        for head in (a, b, s):
            self.assertEqual(subprocess.run(["git", "-C", str(self.origin), "merge-base", "--is-ancestor", head, tip]).returncode, 0)
        self.assertEqual(self.remote("staging"), self.root)  # integration never touches staging
        summary = (self.tmp / "summary.md").read_text()
        for needle in (tip, a, "gev-ci verdict (exact SHA)", "#13"):
            self.assertIn(needle, summary)

    def test_red_batch_falls_back_to_one_pr_at_a_time(self):
        self.branch("feat/sa", self.root, [("semantic-a", "a\n")])
        self.branch("feat/sb", self.root, [("semantic-b", "b\n")])
        self.gh.add_pr(21, "feat/sa", "nightly")
        self.gh.add_pr(22, "feat/sb", "nightly")
        res = self.integrate()
        self.assertEqual(res.exit_code, 0, res.reason)
        out = {c.number: c.outcome for c in res.candidates}
        self.assertEqual(out[21], "integrated")
        self.assertIn("rejected: red on top of nightly", out[22])
        self.assertEqual(len(res.attempts), 3)  # batch (red), #21 (green), #21+#22 (red)
        self.assertIn("red", res.attempts[0].verdict)
        tip = self.remote("nightly")
        self.assertEqual(tip, res.attempts[1].sha)
        names = git(self.origin, "ls-tree", "-r", "--name-only", tip).split()
        self.assertIn("semantic-a", names)
        self.assertNotIn("semantic-b", names)

    def test_single_red_integration_publishes_nothing(self):
        self.branch("feat/sa", self.root, [("semantic-a", "a\n")])
        base_with_b = self.branch("feat/sb", self.root, [("semantic-b", "b\n")])
        # land semantic-b on nightly first through the integrator itself
        self.gh.add_pr(31, "feat/sb", "nightly")
        self.assertEqual(self.integrate().exit_code, 0)
        self.gh.prs[31]["state"] = "closed"
        before = self.remote("nightly")
        self.gh.add_pr(32, "feat/sa", "nightly")
        res = self.integrate()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("no candidate produced a green integration SHA", res.reason)
        self.assertEqual(self.remote("nightly"), before)
        self.assertTrue(base_with_b)

    def test_refuses_when_nightly_moves_during_validation(self):
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        other = self.branch("hotfix", self.root, [("h.txt", "h\n")])

        def race(sha):
            if sha != other and self.remote("nightly") == self.root:
                git(self.work, "push", "-q", "origin", f"{other}:refs/heads/nightly")
        self.ci.before_post = race
        res = self.integrate()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("moved during the run", res.reason)
        self.assertEqual(self.remote("nightly"), other)

    def test_refuses_when_a_pr_head_moves_after_its_check(self):
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")

        def push_new_head(sha):
            if git(self.origin, "rev-parse", "refs/heads/feat/a") != self.remote("nightly"):
                git(self.work, "checkout", "-q", "feat/a")
                self.commit("a2.txt", "late\n")
                git(self.work, "push", "-q", "origin", "feat/a")
                self.ci.before_post = None
        self.ci.before_post = push_new_head
        res = self.integrate()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("PR #1 changed during the run", res.reason)
        self.assertEqual(self.remote("nightly"), self.root)

    def test_red_status_after_validation_blocks_publish(self):
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        orig_pr = self.gh.pr

        def pr_then_flip(number):
            # a re-run goes red after the CI wait saw green, before the publish re-read
            tip = self.ci.runs[-1]
            if not any(s["state"] == "failure" for s in self.gh.data.get(tip, [])):
                self.gh.post_status(tip, "failure", "gev-ci/perf-smoke", "late rerun red")
            return orig_pr(number)
        self.gh.pr = pr_then_flip
        res = self.integrate()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("no longer green", res.reason)
        self.assertEqual(self.remote("nightly"), self.root)

    def test_stale_green_on_pr_head_does_not_authorize_the_merge_commit(self):
        a = self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        # nobody validates the merge commit; a zero wait budget times out at once
        res = self.integrate(validator=ni.ExternalValidator(), policy=dict(POLICY, ci_wait_minutes=0))
        self.assertEqual(res.exit_code, 1)
        self.assertIn("timeout", res.attempts[0].verdict)
        self.assertEqual(self.remote("nightly"), self.root)
        self.assertTrue(bg.evaluate_exact_ci(self.gh.statuses(a), POLICY).green)

    def test_nothing_to_do_and_dry_run_never_push(self):
        res = self.integrate()
        self.assertEqual((res.exit_code, res.reason), (0, "nothing to integrate"))
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        res = self.integrate(dry_run=True)
        self.assertEqual(res.exit_code, 0)
        self.assertEqual(res.candidates[0].outcome, "would integrate")
        self.assertEqual(self.remote("nightly"), self.root)
        self.assertEqual(git(self.origin, "for-each-ref", "refs/heads/factory/"), "")

    def test_already_integrated_pr_is_skipped(self):
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        self.assertEqual(self.integrate().exit_code, 0)
        res = self.integrate()
        self.assertEqual(res.candidates[0].outcome, "skipped: already in nightly")
        self.assertEqual(res.reason, "nothing to integrate")

    def test_broken_invariant_refuses(self):
        # staging gets a commit nightly lacks (validated so the hook admits it)
        side = self.branch("side", self.root, [("side.txt", "s\n")])
        git(self.work, "push", "-q", "origin", f"{side}:refs/heads/staging")
        res = self.integrate()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("is not an ancestor", res.reason)


class TestSoakMath(unittest.TestCase):
    def st(self, i, ctx, state, hours, creator="kvnloo"):
        return bg.Status(i, ctx, state, T0 + dt.timedelta(hours=hours), creator)

    def obs(self, hours_list, start_id=100, creator="kvnloo"):
        return [self.st(start_id + n, "gev-soak/nightly", "success", h, creator) for n, h in enumerate(hours_list)]

    def green(self, at=0.0):
        return [self.st(i, c, "success", at, "github-actions[bot]") for i, c in enumerate(GATES, 1)]

    def test_exactly_24h_passes_and_23h_fails(self):
        base = self.green()
        ok = bg.compute_soak(base + self.obs([h for h in range(1, 26)]), POLICY, T0 + dt.timedelta(hours=25))
        self.assertTrue(ok.ok, ok.reason)
        self.assertEqual(ok.hours, 24.0)
        short = bg.compute_soak(base + self.obs(range(1, 24)), POLICY, T0 + dt.timedelta(hours=23))
        self.assertFalse(short.ok)
        self.assertIn("22.00 h of the required 24 h", short.reason)

    def test_red_resets_start(self):
        statuses = self.green() + self.obs(range(1, 40))
        statuses.append(self.st(90, "gev-ci/unit", "failure", 10.5))
        statuses += [self.st(91, "gev-ci/unit", "success", 11, "github-actions[bot]"),
                     self.st(92, "gev-ci/full", "success", 11, "github-actions[bot]")]
        rep = bg.compute_soak(statuses, POLICY, T0 + dt.timedelta(hours=39))
        self.assertTrue(rep.ok, rep.reason)
        self.assertEqual(bg.fmt_time(rep.start), bg.fmt_time(T0 + dt.timedelta(hours=11)))
        self.assertEqual(rep.last_reset.context, "gev-ci/unit")
        # as seen at hour 34: only 23 h since the reset, so not yet
        cut = [s for s in statuses if s.created_at <= T0 + dt.timedelta(hours=34)]
        early = bg.compute_soak(cut, POLICY, T0 + dt.timedelta(hours=34))
        self.assertFalse(early.ok)
        self.assertIn("23.00 h", early.reason)

    def test_red_soak_observation_resets_and_untrusted_greens_are_ignored(self):
        statuses = self.green() + self.obs(range(1, 30))
        statuses.append(self.st(95, "gev-soak/nightly", "failure", 5.5))
        rep = bg.compute_soak(statuses, POLICY, T0 + dt.timedelta(hours=29))
        self.assertFalse(rep.ok)
        self.assertIn("no trusted gev-ci/full success since the last red", rep.reason)
        fake = self.green() + self.obs(range(1, 30), creator="drive-by")
        rep = bg.compute_soak(fake, POLICY, T0 + dt.timedelta(hours=29))
        self.assertFalse(rep.ok)
        self.assertEqual(rep.ignored_untrusted, 29)

    def test_gaps_break_the_streak(self):
        statuses = self.green() + self.obs([1, 2, 3, 12, 13, 18, 24, 26])
        rep = bg.compute_soak(statuses, POLICY, T0 + dt.timedelta(hours=26))
        self.assertFalse(rep.ok)
        self.assertEqual(len(rep.gaps), 1)
        stale = bg.compute_soak(self.green() + self.obs(range(1, 30)), POLICY, T0 + dt.timedelta(hours=40))
        self.assertFalse(stale.ok)
        self.assertIn("old (limit 6 h)", stale.reason)

    def test_observations_before_ci_went_green_do_not_count(self):
        statuses = self.obs(range(0, 30)) + self.green(at=20)
        rep = bg.compute_soak(statuses, POLICY, T0 + dt.timedelta(hours=29))
        self.assertFalse(rep.ok)
        self.assertEqual(rep.observations, 10)

    def test_policy_cannot_lower_the_floor(self):
        p = Path(tempfile.mkdtemp()) / "p.json"
        p.write_text(json.dumps(dict(POLICY, min_soak_hours=1)))
        with self.assertRaises(bg.Refusal):
            bg.load_policy(p)


class TestPromotion(Fixture):
    def nightly_tip(self):
        self.branch("feat/a", self.root, [("a.txt", "a\n")])
        self.gh.add_pr(1, "feat/a", "nightly")
        res = self.integrate()
        self.assertEqual(res.exit_code, 0, res.reason)
        return res.published

    def test_accepts_after_24h_green_soak_and_fast_forwards(self):
        tip = self.nightly_tip()
        self.soak_hourly(25)
        p = self.promote(tip)
        self.assertEqual(p.exit_code, 0, p.reason)
        self.assertEqual(self.remote("staging"), tip)
        self.assertGreaterEqual(p.soak["soak_hours"], 24)
        self.assertEqual(bg.latest_by_context(self.gh.statuses(tip))["gev-promote/staging"].state, "success")
        again = self.promote(tip)
        self.assertEqual(again.exit_code, 0)
        self.assertIn("already at", again.reason)

    def test_an_older_nightly_sha_soaks_while_nightly_moves_on(self):
        first = self.nightly_tip()
        self.soak_hourly(12)
        self.branch("feat/b", self.root, [("b.txt", "b\n")])
        self.gh.add_pr(2, "feat/b", "nightly")
        self.gh.prs[1]["state"] = "closed"
        second = self.integrate().published
        self.assertNotEqual(second, first)
        self.soak_hourly(13, start_after=0)
        self.assertEqual(self.promote(first).exit_code, 0)
        self.assertEqual(self.remote("staging"), first)
        refused = self.promote(second)  # only ~13 h of its own soak
        self.assertEqual(refused.exit_code, 1)
        self.assertIn("soaked", refused.reason)
        self.assertEqual(self.remote("staging"), first)

    def test_refuses_insufficient_soak(self):
        tip = self.nightly_tip()
        self.soak_hourly(23)
        p = self.promote(tip)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("of the required 24 h", p.reason)
        self.assertEqual(self.remote("staging"), self.root)

    def test_refuses_when_red_inside_the_window(self):
        tip = self.nightly_tip()
        self.soak_hourly(10)
        self.gh.post_status(tip, "error", "gev-ci/globe-smoke", "rerun could not draw", creator="github-actions[bot]")
        self.ci.start(tip)  # rerun green again
        self.soak_hourly(20, start_after=0)
        p = self.promote(tip)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("soaked", p.reason)
        self.assertEqual(p.soak["last_reset"]["context"], "gev-ci/globe-smoke")
        self.soak_hourly(5, start_after=0)
        self.assertEqual(self.promote(tip).exit_code, 0)

    def test_refuses_when_the_nightly_tip_goes_red(self):
        tip = self.nightly_tip()
        self.soak_hourly(12)
        self.gh.post_status(tip, "failure", "gev-ci/full", "rerun red", creator="github-actions[bot]")
        self.soak_hourly(14, start_after=0)
        p = self.promote(tip)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("gev-ci", p.reason)

    def test_refuses_with_missing_evidence(self):
        tip = self.nightly_tip()
        p = self.promote(tip)  # CI green, zero soak observations before this run
        self.assertEqual(p.exit_code, 1)
        self.assertEqual(self.remote("staging"), self.root)
        self.assertIn("soaked 0.00 h of the required 24 h", p.reason)
        # a SHA in nightly history whose statuses are gone from the store: the merged PR head
        pr_head = git(self.origin, "rev-parse", "refs/heads/feat/a")
        self.gh.data.pop(pr_head, None)
        self.gh._save()
        p = self.promote(pr_head)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("gev-ci on", p.reason)
        self.assertIn("missing", p.reason)

    def test_refuses_sha_outside_nightly_history(self):
        tip = self.nightly_tip()
        self.soak_hourly(25)
        outside = self.branch("feat/outside", tip, [("o.txt", "o\n")])
        for _ in range(30):
            self.gh.post_status(outside, "success", "gev-soak/nightly", "forged observation")
            self.gh.advance(1)
        p = self.promote(outside)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("not in `nightly` history", p.reason)

    def test_refuses_divergence(self):
        tip = self.nightly_tip()
        self.soak_hourly(25)
        side = self.branch("side", self.root, [("side.txt", "s\n")])
        git(self.work, "push", "-q", "origin", f"{side}:refs/heads/staging")
        p = self.promote(tip)
        self.assertEqual(p.exit_code, 1)
        self.assertIn("not an ancestor", p.reason)
        self.assertEqual(self.remote("staging"), side)

    def test_refuses_when_refs_change_mid_promotion(self):
        tip = self.nightly_tip()
        self.soak_hourly(25)
        self.branch("feat/b", self.root, [("b.txt", "b\n")])
        self.gh.add_pr(2, "feat/b", "nightly")
        self.gh.prs[1]["state"] = "closed"
        newer = {}
        before = len(self.gh.data[tip])

        def move_nightly(sha):
            # fires on the first read after promotion posted its fresh observation
            if sha == tip and not newer and len(self.gh.data[tip]) > before:
                self.gh.on_statuses = None
                newer["sha"] = self.integrate().published
        self.gh.on_statuses = move_nightly
        p = self.promote(tip)
        self.assertTrue(newer.get("sha"))
        self.assertEqual(p.exit_code, 1)
        self.assertIn("refs changed during promotion", p.reason)
        self.assertEqual(self.remote("staging"), self.root)

    def test_refuses_bad_sha_and_dry_run_does_not_push(self):
        tip = self.nightly_tip()
        self.assertEqual(self.promote(tip[:12]).exit_code, 2)
        self.assertEqual(self.promote("main").exit_code, 2)
        self.soak_hourly(25)
        p = self.promote(tip, dry_run=True)
        self.assertEqual(p.exit_code, 0, p.reason)
        self.assertIn("dry run", p.reason)
        self.assertEqual(self.remote("staging"), self.root)


if __name__ == "__main__":
    unittest.main()
