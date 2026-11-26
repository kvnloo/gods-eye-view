# Nightly integration and staging promotion

Owner card: t_cf66fac4. CI contract consumed: [`docs/factory-ci.md`](../factory-ci.md)
(exact-SHA `gev-ci/*` commit statuses; `gev-ci/full` is the required check).

| Piece | File |
|---|---|
| Policy (values below) | `ci/factory/branch-policy.json` |
| Shared logic | `scripts/factory/branch_gates.py` |
| Nightly integration | `scripts/factory/nightly_integrate.py`, `.github/workflows/factory-nightly-integrate.yml` |
| Soak observation | `scripts/factory/soak_observe.py`, `.github/workflows/factory-soak-observe.yml` |
| Staging promotion | `scripts/factory/promote_staging.py`, `.github/workflows/factory-promote-staging.yml` |
| Tests | `scripts/factory/tests/test_branch_gates.py` |
| Server-side guards | rulesets 28125550 and 28125551 (below) |

## The invariant

`staging ⊑ nightly`: staging is always an ancestor of nightly, and both branches
only move forward. Every SHA that either branch points to carries a green
`gev-ci/full` on that exact SHA. Integration and promotion refuse to run when the
invariant is already broken, and never repair it by rewriting history.

## Nightly integration

Runs on a schedule (08:41 UTC) or on demand. In order:

1. **Read refs.** Read `nightly` (call it B) and `staging`. If staging is not an
   ancestor of B, refuse.
2. **Select.** Take open PRs labeled `nightly`, oldest number first. A PR is
   eligible only if all of these hold:

   | Condition | Otherwise |
   |---|---|
   | Not a draft | `skipped: draft` |
   | Base is `nightly` or `staging` | `skipped: base X is not integrated`. Stacked PRs wait for their parent. |
   | Head is on `kvnloo/gods-eye-view` | `skipped: head is on <fork>` |
   | Every `gev-ci/*` context is green on the exact head SHA. The latest status per context counts: a trusted success passes. A failure or error from anyone fails. Missing, pending or untrusted is not green. | `skipped: head not green (…)` |
   | Head is not already in B | `skipped: already in nightly` |
   | Merges cleanly onto the tip built so far | `skipped: conflicts with nightly after …` |

3. **PRs based on `staging`.** There are 19, retargeted from `main` during the
   migration. They are integrated the same way: their head is merged into
   nightly. The PR stays open against `staging`. GitHub should mark it merged
   once a promotion makes staging contain its head. That is GitHub's documented
   behaviour for a pushed base, but it is not yet observed on this repo, so
   check it on the first such promotion. Nothing is ever pushed to staging from
   a PR. The summary labels these rows. On 2026-11-25, 18 of the 19 are
   drafts and #111 has no gev-ci results, so none would qualify yet (see the
   eligibility preview in the card report).
4. **Build.** Build one merge commit per PR with `git merge-tree` and
   `commit-tree`. No working tree is used. Each merge's first parent is the
   previous tip, so `git log --first-parent nightly` lists the published tips.
   The message records the PR, its exact head SHA and its base.
5. **Validate the exact integration SHA.** Push it to a new branch named
   `factory/nightly-candidate/<UTC stamp>-<sha12>`. Validation needs a ref on
   GitHub, and the name is new every time, so no push is ever forced. Then run
   full CI on that SHA, with B as `base-sha`: in Actions,
   `factory-ci-sha.yml` (dispatch); on a host, `scripts/factory-ci-boat.sh`. The
   verdict is read back from the commit statuses on that SHA, never from a job
   exit code. The wait only accepts a `gev-ci/full` newer than the run's start,
   by status id, so an older verdict cannot satisfy it.
6. **Red batch.** If the batch is red, rebuild one PR at a time on top of the
   last green tip and validate each one. The number of CI runs per integration
   is capped at `max_ci_runs_per_integration` (8). The last green SHA is the only
   one that can be published.
7. **Publish, failing closed.** Right before the push, all of these are checked
   again:
   - `nightly` still equals B;
   - every included PR is open with the same head SHA;
   - the statuses on the SHA to publish are still green.

   Then a plain `git push <sha>:refs/heads/nightly` (no force flag), and a read
   of the remote ref, which must equal the SHA.
8. **Report.** The workflow summary has a table with one row per labeled PR
   (base, full head SHA, outcome) and a table with one row per validated
   integration SHA (PRs, candidate ref, per-context verdict). It also records
   nightly before and after. `--report` writes the same data as JSON; the
   workflow uploads it as an artifact.

Exit codes: 0 means published or nothing to do. 1 means refused or red. 2 is a
usage error. 75 means another run holds the host lock.

## Serialization and race safety

These layers are independent. Any one of them stops a wrong SHA from being
published.

| Layer | Stops |
|---|---|
| Actions `concurrency: factory-branch-mutation`, shared by integration and promotion. A host flock on `~/.cache/gev-factory/branch-mutation.lock`. | two mutators from the same runner type |
| Re-read `nightly`/`staging` before the push; refuse if either moved | a concurrent update between validation and publish |
| Re-read the statuses on the exact SHA before the push | a red re-run, or a stale green |
| Re-read every included PR head | a PR force-updated after its check |
| Plain push: git and GitHub refuse a non-fast-forward | lost commits. If the ref moved to an ancestor of the validated SHA in the last instant, the push still publishes exactly the validated SHA. |
| Ruleset **28125551** `nightly+staging: exact-SHA gev-ci/full`: `required_status_checks: [gev-ci/full]`, no bypass | GitHub itself refuses any push to nightly or staging whose new SHA lacks a passing `gev-ci/full`. This covers other agents, manual pushes and stale scripts. |
| Ruleset **28125550** `nightly+staging: no rewrite`: `deletion` and `non_fast_forward`, no bypass | force pushes and deletion, by anyone, admin included |
| Post-push read-back | an update that did not land as the validated SHA |

A live probe on 2026-11-26 showed the status ruleset refusing a push. It used the
same rule shape on the throwaway namespace `factory/ruleset-probe/**` (ruleset
28125518, disabled after the probe) with a probe-only context:

- Creating a branch at a commit with no status: `GH013 … Required status check
  "factory-probe/required" is expected`, refused.
- A fast-forward to a commit with a `failure`: `… is failing`, refused.
- The same pushes after a `success` was posted: accepted.

Caveat: for a merge through the PR UI, GitHub evaluates required checks on the
PR head, not on the merge commit it creates. Only the integrator validates the
merge commit itself. Prefer the `nightly` label to the merge button.

## Soak: what is persisted and how it is audited

**Ledger.** The ledger is the commit-status history of each SHA on GitHub.
GitHub sets the `created_at` timestamp and the `creator` login on each status,
and the REST API has no delete for statuses. So the history is append-only, is
timestamped by the server, and cannot be backdated by any script, this one
included. No code path accepts a caller-supplied time or a soak start.

**Observation.** `soak_observe.py` runs hourly (`53 * * * *`). It posts one
`gev-soak/nightly` status on every tracked SHA. Tracked SHAs are the
first-parent commits in `staging..nightly` that carry a `gev-ci/full` status,
which are the tips that integration published. The posted state is one of:

- `success`: the SHA is in nightly history, its own `gev-ci/*` statuses are
  green, and the current nightly tip is green.
- `failure` (a reset): the SHA left nightly history, its own `gev-ci/*` statuses
  went red, or the nightly tip is red.
- `pending`: the result is inconclusive, for example the tip is not validated.
  Pending neither extends nor resets soak, but a long pending stretch breaks
  soak through the gap rule.

An older tip keeps soaking after nightly moves past it, so you can always
promote a slightly older SHA that has finished its 24 h.

**Computing soak** (`compute_soak`, pure, unit-tested):

1. **Reset.** The reset point is the newest `failure` or `error`, from any
   creator, in any `gev-ci/*` context or in `gev-soak/nightly`.
2. **Start.** After the reset, find the first trusted `gev-ci/full` success.
   Trusted creators are listed in `trusted_status_creators`: `kvnloo` for Boat
   runs and `github-actions[bot]`. Observations count from that success onward.
   Observations from any other creator are counted in the report, then ignored.
3. **Gaps.** Split the trusted `success` observations wherever two are more than
   `max_observation_gap_hours` (6) apart. Only the final unbroken run counts. The
   last observation must also be within 6 h of now.
4. **Pass.** That run must span at least `min_soak_hours` (24) and hold at least
   `min_soak_observations` (4) observations. `load_policy` refuses any policy
   value below 24 h.

**Audit any SHA:**

```sh
gh api --paginate "repos/kvnloo/gods-eye-view/commits/<sha>/statuses?per_page=100" \
  --jq '.[] | [.created_at, .context, .state, .creator.login, .description] | @tsv' | sort
```

Each promotion also posts `gev-promote/staging` on the promoted SHA. The
workflow summary embeds the computed soak report: start, end, hours,
observation count, the last reset with its status id, and any gaps. The
`promotion.json` artifact is kept for 400 days.

**Limits.** GitHub keeps at most 1,000 statuses per SHA and context. At one
observation an hour that is about 41 days for a SHA that never gets promoted.
A commit status proves who posted it, not which code ran. A trusted principal
could post green observations by hand. They still could not backdate them, and
the creator and `target_url` show who posted each one. A dedicated GitHub App
identity for the observer would narrow this further. That App is pending, see
Credentials.

## Staging promotion

Run it with an explicitly chosen SHA:

```sh
# Actions (once on staging): Actions → Factory staging promotion → Run workflow → sha=<40 hex>
# Host (from a trusted checkout of staging):
python3 scripts/factory/promote_staging.py --sha <40-hex> --dry-run   # every check, no push
python3 scripts/factory/promote_staging.py --sha <40-hex>
```

It refuses on the first failing check below. The workflow also validates the
SHA's format before checking anything out.

| Check | Refusal |
|---|---|
| Full 40-hex SHA. Branch names and short SHAs are not accepted. | exit 2 |
| Commit exists. The SHA is in `nightly` history (an ancestor of, or equal to, the tip). | not in nightly history |
| `staging` is an ancestor of the SHA | divergence; the move would not be a fast-forward |
| Every `gev-ci/*` context on that exact SHA is a trusted success | failed or missing evidence |
| A fresh `gev-soak/nightly` observation is green, then `compute_soak` passes | insufficient soak, a red during the window, a gap, or a stale observation |
| `staging` and `nightly` still equal the values first read. The statuses are still green. | refs changed, or the state changed |
| Plain push, then read the ref back | push refused, or the result is not visible |

If staging already equals the SHA, the result is a no-op with exit 0.

## Nightly stays compatible with ff-only promotion

- Nightly only gains commits. Integration adds merge commits whose first parent
  is the old tip, and ruleset 28125550 forbids rewinding or deleting the branch.
  Any SHA that was ever on nightly therefore stays in nightly history.
- Staging only moves to a SHA that is already in nightly history and descends
  from the current staging. So `staging ⊑ nightly` holds after every promotion,
  and the next promotion is again a fast-forward.
- To undo a change, merge a revert PR into nightly. Never reset nightly. A bad
  change that already reached staging is fixed by promoting a later nightly SHA
  that contains the revert, after its own soak.
- `main` (the upstream mirror, card t_4f3cfa1b) reaches nightly as an ordinary
  PR (head `main`) that is merged, not rebased. Fork-only work never goes to
  main.
- Staging-based PRs reach staging only through nightly, as described above. A
  direct merge into staging would need a green `gev-ci/full` on the PR head
  (ruleset 28125551), and `ci.yml`'s fork branch policy refuses PRs into staging.

## Bootstrap order (schedules fire only from `staging`)

1. Merge into nightly: #343 (factory CI: `factory-ci-sha.yml`, the Boat runner),
   #341 (main sync), #342 (modularity) and this card's PR. Use the label and the
   host runner below, or the PR UI with a green `gev-ci/full` on the head.
2. Run `soak_observe.py` hourly from a host: GitHub Actions is paused on this
   fork, so the hourly observation workflow cannot run yet.
3. After at least 24 h of green soak, promote that nightly SHA. Its tree then
   contains all four PRs. That puts `factory-main-sync.yml` (#341, as t_4f3cfa1b
   asked), `factory-ci-sha.yml` and these three workflows on the default branch.
   From then on `schedule` and dispatch work, once Actions is re-enabled.

Host runner, until Actions runs. Use a clean, trusted checkout of `staging`, with
Kevin's `gh` login (it has the `repo` and `workflow` scopes) and `boat` signed in:

```sh
python3 scripts/factory/soak_observe.py                                  # hourly
python3 scripts/factory/nightly_integrate.py --validator boat --dry-run  # preview
python3 scripts/factory/nightly_integrate.py --validator boat            # nightly
```

No host timer is installed. Installing one is an owner decision.

## Credentials

- **API calls** (PRs, statuses, workflow dispatch): `GITHUB_TOKEN` in Actions,
  and `gh` on a host.
- **Pushes** to nightly, staging and candidate refs: in Actions, an installation
  token of a GitHub App, because `GITHUB_TOKEN` cannot push commits that touch
  `.github/workflows/`. Configure environment `factory-branches` with the
  variable `FACTORY_APP_CLIENT_ID` and the secret `FACTORY_APP_PRIVATE_KEY`.
  The App needs `contents: write` and `workflows: write` on this repository
  only. Restrict the environment to the `staging` branch. Creating the App
  needs the owner in a browser, so it is not done yet.
- **No new deploy key.** The `main: sync bot only` ruleset bypass covers every
  write deploy key (t_4f3cfa1b). `verify-main-protection.sh` fails if a second
  one exists.

## Candidate refs

`factory/nightly-candidate/*` branches keep the exact SHA that was validated,
including red and rejected ones, for audit. Nothing deletes them automatically.
An operator may prune those older than 30 days that are already in nightly, or
that were rejected and are no longer needed.

## Tests

```sh
python3 -m unittest discover -s scripts/factory/tests -p 'test_branch_gates.py' -v
```

The suite (27 tests) uses real git: a local bare origin that refuses a
non-fast-forward or a deletion. Its pre-receive hook enforces a trusted
`gev-ci/full` on nightly and staging, as ruleset 28125551 does. Alongside it
runs a fake GitHub that owns its clock, the way GitHub owns `created_at`. Tests
make time pass by advancing that server clock. Production code has no flag
that injects time, statuses or a remote.

- **Acceptance:** only green and eligible PRs are integrated, including one
  based on staging. CI runs on the exact published SHA. The first-parent chain
  is linear. A red batch falls back to one PR at a time. A promotion succeeds
  after 24 h of soak, and an older nightly SHA is promoted while nightly keeps
  moving.
- **Refusals:**
  - integration: draft, fork, stacked, red, missing, untrusted or flaky head;
    conflict; red integration; nightly moved; PR head moved; red status after
    validation; stale green on the PR head only; broken invariant.
  - promotion: soak of 23 h; red inside the window, then recovery; red tip;
    missing evidence; SHA outside nightly despite forged soak statuses;
    divergence; refs changed mid-promotion; short SHA or branch name; dry run.
  - soak math: exactly 24 h passes and 23 h fails; resets; gaps; staleness;
    observations made before CI went green; untrusted observations; the policy
    floor.
