"""Shared logic for nightly integration, soak observation and staging promotion.

Contract and runbook: docs/factory/NIGHTLY-PROMOTION.md. CI contract consumed:
docs/factory-ci.md (exact-SHA `gev-ci/*` commit statuses, `gev-ci/full`).

Design rules this module enforces:

* Evidence is read from GitHub commit statuses on the *exact* SHA being
  published. A status on any other SHA (a PR head, an older tip) authorizes
  nothing.
* Only the latest status per context counts. A latest `failure`/`error` from
  any creator is red. A latest `success` counts only from a trusted creator.
  Missing or `pending` is not green. Every unknown is a refusal.
* Time comes from GitHub's own `created_at` on statuses. Nothing in this module
  accepts a caller-supplied timestamp for soak evidence, so soak cannot be
  backdated. Statuses cannot be deleted through the API, so the history is
  append-only.
* Branch updates are plain (non-forced) pushes of an already-validated SHA,
  after re-reading the ref. Git refuses a non-fast-forward, and the post-push
  read-back must equal the validated SHA.

Python 3.9+, standard library only.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HERE = Path(__file__).resolve().parent
DEFAULT_POLICY = HERE.parent.parent / "ci" / "factory" / "branch-policy.json"


class Refusal(Exception):
    """A fail-closed refusal. `code` is the process exit status."""

    def __init__(self, reason: str, code: int = 1):
        super().__init__(reason)
        self.reason = reason
        self.code = code


def load_policy(path: Optional[Path] = None) -> dict:
    with open(path or DEFAULT_POLICY, encoding="utf-8") as fh:
        policy = json.load(fh)
    for key in ("nightly_branch", "staging_branch", "ci_full_context", "ci_gate_contexts",
                "trusted_status_creators", "soak_context", "min_soak_hours",
                "max_observation_gap_hours", "min_soak_observations"):
        if key not in policy:
            raise Refusal(f"policy is missing {key!r}", 2)
    if float(policy["min_soak_hours"]) < 24:
        # The owner's bar is >= 24 h. A policy edit cannot lower it below that.
        raise Refusal("policy min_soak_hours is below the 24 h floor", 2)
    return policy


def require_sha(value: str, what: str = "sha") -> str:
    if not isinstance(value, str) or not SHA_RE.match(value):
        raise Refusal(f"{what} must be 40 lowercase hex characters (got {value!r})", 2)
    return value


def parse_time(stamp: str) -> dt.datetime:
    return dt.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def fmt_time(t: Optional[dt.datetime]) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ") if t else "-"


# --------------------------------------------------------------------------
# Status evaluation (pure)
# --------------------------------------------------------------------------

@dataclass
class Status:
    id: int
    context: str
    state: str
    created_at: dt.datetime
    creator: str
    description: str = ""
    target_url: str = ""

    @classmethod
    def from_api(cls, raw: dict) -> "Status":
        return cls(
            id=int(raw.get("id") or 0),
            context=raw["context"],
            state=raw["state"],
            created_at=parse_time(raw["created_at"]),
            creator=((raw.get("creator") or {}).get("login") or ""),
            description=raw.get("description") or "",
            target_url=raw.get("target_url") or "",
        )


def _order(s: Status) -> Tuple[dt.datetime, int]:
    return (s.created_at, s.id)


def latest_by_context(statuses: Iterable[Status]) -> Dict[str, Status]:
    out: Dict[str, Status] = {}
    for s in statuses:
        cur = out.get(s.context)
        if cur is None or _order(s) > _order(cur):
            out[s.context] = s
    return out


@dataclass
class CiVerdict:
    state: str  # green | red | pending
    detail: List[Tuple[str, str, str]] = field(default_factory=list)  # (context, state, note)

    @property
    def green(self) -> bool:
        return self.state == "green"

    def summary(self) -> str:
        bad = [f"{c}={s}{' (' + n + ')' if n else ''}" for c, s, n in self.detail if s != "success" or n]
        return self.state + (": " + ", ".join(bad) if bad else "")


def evaluate_ci(statuses: Sequence[Status], contexts: Sequence[str], trusted: Sequence[str],
                red_prefix: Optional[str] = None) -> CiVerdict:
    """Green only if every context's latest status is a trusted success and no
    context under `red_prefix` has a latest failure/error."""
    latest = latest_by_context(statuses)
    detail: List[Tuple[str, str, str]] = []
    red = pending = False
    for ctx in contexts:
        s = latest.get(ctx)
        if s is None:
            detail.append((ctx, "missing", ""))
            pending = True
        elif s.state in ("failure", "error"):
            detail.append((ctx, s.state, s.description[:80]))
            red = True
        elif s.state != "success":
            detail.append((ctx, s.state, ""))
            pending = True
        elif s.creator not in trusted:
            detail.append((ctx, "untrusted", f"posted by {s.creator or '?'}"))
            pending = True
        else:
            detail.append((ctx, "success", ""))
    if red_prefix:
        for ctx, s in sorted(latest.items()):
            if ctx.startswith(red_prefix) and ctx not in contexts and s.state in ("failure", "error"):
                detail.append((ctx, s.state, s.description[:80]))
                red = True
    return CiVerdict("red" if red else "pending" if pending else "green", detail)


def ci_contexts(policy: dict) -> List[str]:
    return list(policy["ci_gate_contexts"]) + [policy["ci_full_context"]]


def evaluate_exact_ci(statuses: Sequence[Status], policy: dict) -> CiVerdict:
    return evaluate_ci(statuses, ci_contexts(policy), policy["trusted_status_creators"],
                       policy.get("ci_red_prefix"))


@dataclass
class SoakReport:
    ok: bool
    reason: str
    start: Optional[dt.datetime] = None
    end: Optional[dt.datetime] = None
    observations: int = 0
    last_reset: Optional[Status] = None
    ci_green_since: Optional[dt.datetime] = None
    gaps: List[Tuple[str, str, float]] = field(default_factory=list)
    ignored_untrusted: int = 0

    @property
    def hours(self) -> float:
        if not (self.start and self.end):
            return 0.0
        return (self.end - self.start).total_seconds() / 3600

    def as_dict(self) -> dict:
        return {
            "ok": self.ok, "reason": self.reason, "soak_start": fmt_time(self.start),
            "soak_end": fmt_time(self.end), "soak_hours": round(self.hours, 3),
            "observations": self.observations,
            "last_reset": None if not self.last_reset else {
                "context": self.last_reset.context, "state": self.last_reset.state,
                "created_at": fmt_time(self.last_reset.created_at), "id": self.last_reset.id,
                "creator": self.last_reset.creator},
            "ci_green_since": fmt_time(self.ci_green_since),
            "gaps_over_limit": [{"from": a, "to": b, "hours": round(h, 3)} for a, b, h in self.gaps],
            "ignored_untrusted_observations": self.ignored_untrusted,
        }


def compute_soak(statuses: Sequence[Status], policy: dict, now: dt.datetime) -> SoakReport:
    """Soak of one SHA from its own commit-status history.

    * Reset: the newest `failure`/`error` (any creator) in any `gev-ci/*`
      context or the soak context. Soak evidence before it does not count.
    * Observations: trusted `success` statuses in the soak context, posted
      after the reset and after the first trusted `gev-ci/full` success that
      follows it.
    * The observations are split wherever two consecutive ones (or the last one
      and `now`) are more than `max_observation_gap_hours` apart. Only the
      final unbroken run counts. It must span `min_soak_hours` and contain at
      least `min_soak_observations` observations.
    """
    soak_ctx = policy["soak_context"]
    trusted = set(policy["trusted_status_creators"])
    red_prefix = policy.get("ci_red_prefix", "gev-ci/")
    full_ctx = policy["ci_full_context"]
    min_soak = dt.timedelta(hours=float(policy["min_soak_hours"]))
    max_gap = dt.timedelta(hours=float(policy["max_observation_gap_hours"]))
    min_obs = int(policy["min_soak_observations"])

    ordered = sorted(statuses, key=_order)
    resets = [s for s in ordered
              if s.state in ("failure", "error") and (s.context == soak_ctx or s.context.startswith(red_prefix))]
    last_reset = resets[-1] if resets else None
    after = [s for s in ordered if last_reset is None or _order(s) > _order(last_reset)]

    green_full = [s for s in after if s.context == full_ctx and s.state == "success" and s.creator in trusted]
    rep = SoakReport(False, "", last_reset=last_reset)
    if not green_full:
        rep.reason = ("no trusted gev-ci/full success since the last red"
                      if last_reset else "no trusted gev-ci/full success on this SHA")
        return rep
    rep.ci_green_since = green_full[0].created_at

    obs_all = [s for s in after if s.context == soak_ctx and s.state == "success"]
    rep.ignored_untrusted = sum(1 for s in obs_all if s.creator not in trusted)
    obs = [s for s in obs_all if s.creator in trusted and s.created_at >= rep.ci_green_since]
    if not obs:
        rep.reason = "no recorded soak observations since CI went green"
        return rep

    segment: List[Status] = [obs[0]]
    for prev, cur in zip(obs, obs[1:]):
        if cur.created_at - prev.created_at > max_gap:
            rep.gaps.append((fmt_time(prev.created_at), fmt_time(cur.created_at),
                             (cur.created_at - prev.created_at).total_seconds() / 3600))
            segment = [cur]
        else:
            segment.append(cur)
    rep.start, rep.end, rep.observations = segment[0].created_at, segment[-1].created_at, len(segment)

    if now - rep.end > max_gap:
        rep.gaps.append((fmt_time(rep.end), fmt_time(now), (now - rep.end).total_seconds() / 3600))
        rep.reason = f"last soak observation is {(now - rep.end).total_seconds() / 3600:.1f} h old (limit {max_gap.total_seconds() / 3600:g} h)"
        return rep
    if rep.end - rep.start < min_soak:
        rep.reason = f"soaked {rep.hours:.2f} h of the required {min_soak.total_seconds() / 3600:g} h"
        return rep
    if rep.observations < min_obs:
        rep.reason = f"{rep.observations} soak observations, need at least {min_obs}"
        return rep
    rep.ok = True
    rep.reason = f"soaked {rep.hours:.2f} h with {rep.observations} observations and no red"
    return rep


def observation_for(sha: str, in_nightly: bool, tip: str, ci_sha: CiVerdict,
                    ci_tip: Optional[CiVerdict]) -> Tuple[str, str]:
    """(state, description) of one soak observation of `sha`."""
    short = tip[:12]
    if not in_nightly:
        return "failure", f"not in nightly history (tip {short})"
    if ci_sha.state == "red":
        return "failure", "own gev-ci red: " + ci_sha.summary()[:100]
    if not ci_sha.green:
        return "pending", "own gev-ci not green: " + ci_sha.summary()[:100]
    if sha != tip and ci_tip is not None:
        if ci_tip.state == "red":
            return "failure", f"nightly tip {short} is red"
        if not ci_tip.green:
            return "pending", f"nightly tip {short} not validated"
    return "success", f"green in nightly@{short}"


# --------------------------------------------------------------------------
# Adapters
# --------------------------------------------------------------------------

def run(cmd: Sequence[str], cwd: Optional[str] = None, check: bool = True, env: Optional[dict] = None,
        input_text: Optional[str] = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(list(cmd), cwd=cwd, env=env, input=input_text, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and proc.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}... exited {proc.returncode}: {proc.stderr.strip()[:600]}")
    return proc


class GitHubCli:
    """GitHub REST through `gh api` (GH_TOKEN in Actions, the gh login on a host)."""

    def __init__(self, repo: str):
        if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo):
            raise Refusal(f"bad repo {repo!r}", 2)
        self.repo = repo

    def _api(self, args: Sequence[str]) -> object:
        proc = run(["gh", "api", *args])
        return json.loads(proc.stdout) if proc.stdout.strip() else None

    def _paginate(self, path: str) -> list:
        proc = run(["gh", "api", "--paginate", "--slurp", path])
        pages = json.loads(proc.stdout)
        return [item for page in pages for item in page]

    def now(self) -> dt.datetime:
        return dt.datetime.now(dt.timezone.utc)

    def open_prs(self) -> List[dict]:
        return self._paginate(f"repos/{self.repo}/pulls?state=open&per_page=100")

    def pr(self, number: int) -> dict:
        return self._api([f"repos/{self.repo}/pulls/{int(number)}"])  # type: ignore[return-value]

    def statuses(self, sha: str) -> List[Status]:
        require_sha(sha)
        return [Status.from_api(r) for r in self._paginate(f"repos/{self.repo}/commits/{sha}/statuses?per_page=100")]

    def post_status(self, sha: str, state: str, context: str, description: str, target_url: str = "") -> Status:
        require_sha(sha)
        args = ["-X", "POST", f"repos/{self.repo}/statuses/{sha}", "-f", f"state={state}",
                "-f", f"context={context}", "-f", f"description={description[:140]}"]
        if target_url:
            args += ["-f", f"target_url={target_url}"]
        return Status.from_api(self._api(args))  # type: ignore[arg-type]

    def dispatch(self, workflow: str, ref: str, inputs: Dict[str, str]) -> None:
        args = ["-X", "POST", f"repos/{self.repo}/actions/workflows/{workflow}/dispatches", "-f", f"ref={ref}"]
        for k, v in inputs.items():
            args += ["-f", f"inputs[{k}]={v}"]
        self._api(args)


class GitRepo:
    """A private scratch repository that talks to one remote."""

    def __init__(self, remote_url: str, workdir: Optional[str] = None, use_gh_credentials: bool = True):
        self.remote_url = remote_url
        self.dir = workdir or tempfile.mkdtemp(prefix="gev-branch-gate-")
        Path(self.dir).mkdir(parents=True, exist_ok=True)
        self.env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        self.cred: List[str] = ["-c", "credential.helper="]
        if use_gh_credentials and remote_url.startswith("https://github.com/"):
            if os.environ.get("FACTORY_PUSH_TOKEN"):
                # Actions: a GitHub App token that may push workflow files; the API keeps GITHUB_TOKEN.
                helper = '!f() { echo username=x-access-token; echo "password=$FACTORY_PUSH_TOKEN"; }; f'
            else:
                helper = "!gh auth git-credential"
            self.cred += ["-c", f"credential.https://github.com.helper={helper}"]
        if not (Path(self.dir) / "HEAD").exists():
            self.git("init", "-q", "--bare")
            self.git("remote", "add", "origin", remote_url)
            if remote_url.startswith("https://"):
                self.git("config", "remote.origin.promisor", "true")
                self.git("config", "remote.origin.partialclonefilter", "blob:none")

    def git(self, *args: str, check: bool = True, input_text: Optional[str] = None) -> str:
        proc = run(["git", "-C", self.dir, *self.cred, *args], check=check, env=self.env, input_text=input_text)
        return proc.stdout.strip() if check else proc  # type: ignore[return-value]

    def ok(self, *args: str) -> bool:
        return run(["git", "-C", self.dir, *self.cred, *args], check=False, env=self.env).returncode == 0

    def remote_ref(self, branch: str) -> Optional[str]:
        out = self.git("ls-remote", "origin", f"refs/heads/{branch}")
        for line in out.splitlines():
            sha, ref = line.split("\t", 1)
            if ref == f"refs/heads/{branch}":
                return require_sha(sha, f"remote {branch}")
        return None

    def fetch(self, *refspecs: str) -> None:
        extra = ["--filter=blob:none"] if self.remote_url.startswith("https://") else []
        self.git("fetch", "-q", "--no-tags", *extra, "origin", *refspecs)

    def fetch_sha(self, sha: str) -> bool:
        require_sha(sha)
        if self.ok("cat-file", "-e", f"{sha}^{{commit}}"):
            return True
        extra = ["--filter=blob:none"] if self.remote_url.startswith("https://") else []
        return self.ok("fetch", "-q", "--no-tags", *extra, "origin", sha) and \
            self.ok("cat-file", "-e", f"{sha}^{{commit}}")

    def is_ancestor(self, a: str, b: str) -> bool:
        return self.ok("merge-base", "--is-ancestor", a, b)

    def first_parent_range(self, base: str, tip: str) -> List[str]:
        out = self.git("rev-list", "--first-parent", f"{base}..{tip}")
        return [l for l in out.splitlines() if l]

    def merge(self, ours: str, theirs: str, message: str, name: str, email: str) -> Optional[str]:
        """Merge commit of `theirs` into `ours` without a worktree; None on conflict."""
        proc = run(["git", "-C", self.dir, *self.cred, "merge-tree", "--write-tree", "--no-messages", ours, theirs],
                   check=False, env=self.env)
        if proc.returncode == 1:
            return None
        if proc.returncode != 0:
            raise RuntimeError(f"merge-tree failed: {proc.stderr.strip()[:400]}")
        tree = proc.stdout.split()[0]
        env = dict(self.env, GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=email,
                   GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=email)
        out = run(["git", "-C", self.dir, "commit-tree", tree, "-p", ours, "-p", theirs, "-F", "-"],
                  env=env, input_text=message).stdout.strip()
        return require_sha(out, "merge commit")

    def push(self, sha: str, branch: str) -> subprocess.CompletedProcess:
        """Plain push: no force flag of any kind, so the remote refuses a
        non-fast-forward. Returns the process so callers can report stderr."""
        require_sha(sha)
        return run(["git", "-C", self.dir, *self.cred, "push", "--porcelain", "--no-verify", "origin",
                    f"{sha}:refs/heads/{branch}"], check=False, env=self.env)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

class Summary:
    """Markdown report: stdout plus $GITHUB_STEP_SUMMARY when set."""

    def __init__(self, path: Optional[str] = None):
        self.path = path if path is not None else os.environ.get("GITHUB_STEP_SUMMARY")
        self.lines: List[str] = []

    def add(self, *lines: str) -> None:
        for line in lines:
            self.lines.append(line)
            print(line, flush=True)
            if self.path:
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")

    def table(self, header: Sequence[str], rows: Iterable[Sequence[str]]) -> None:
        self.add("| " + " | ".join(header) + " |", "|" + "---|" * len(header))
        for r in rows:
            self.add("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in r) + " |")
        self.add("")


def max_status_id(gh, sha: str) -> int:
    return max((s.id for s in gh.statuses(sha)), default=0)


def wait_for_full(gh, sha: str, policy: dict, minutes: float, poll_seconds: float = 30,
                  sleep: Callable[[float], None] = time.sleep, min_id: int = 0) -> CiVerdict:
    """Poll statuses on `sha` until a gev-ci/full newer than status id `min_id`
    is final, or time runs out. Status ids grow monotonically on GitHub, so an
    older verdict on the same SHA cannot satisfy the wait."""
    deadline = time.monotonic() + minutes * 60
    while True:
        statuses = gh.statuses(sha)
        verdict = evaluate_exact_ci(statuses, policy)
        full = latest_by_context(statuses).get(policy["ci_full_context"])
        if full is not None and full.id > min_id and full.state in ("success", "failure", "error"):
            return verdict
        if time.monotonic() >= deadline:
            return CiVerdict("pending", verdict.detail + [(policy["ci_full_context"], "timeout", f"{minutes:g} min")])
        sleep(poll_seconds)


def run_url() -> str:
    server, repo, rid = (os.environ.get(k) for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return f"{server}/{repo}/actions/runs/{rid}" if server and repo and rid else ""


class HostLock:
    """Serializes runs on one host (Actions uses a concurrency group)."""

    def __init__(self, path: Optional[str]):
        self.path = path
        self.fh = None

    def __enter__(self):
        if not self.path:
            return self
        import fcntl
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a+")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Refusal(f"another branch mutation holds {self.path}", 75)
        return self

    def __exit__(self, *exc):
        if self.fh:
            self.fh.close()
        return False


def default_lock_path() -> str:
    return os.path.join(os.path.expanduser("~"), ".cache", "gev-factory", "branch-mutation.lock")
