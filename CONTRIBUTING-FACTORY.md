# Fork factory contribution guide

This fork (`kvnloo/gods-eye-view`) runs a feature factory on top of upstream
`bilawalsidhu/gods-eye-view`. Everything here exists so that any feature can be
cherry-picked onto upstream `main` on its own. `CONTRIBUTING.md` still governs
runtime, testing and documentation conventions; its "branch off `main`" line is
for upstream contributors.

## Branches

- `main` mirrors upstream; no fork PRs or fork commits belong there.
- `staging` is stable: only fast-forward promotion of soaked `nightly` commits.
- `nightly` is preview. Branch from `origin/staging` and open PRs with
  `gh pr create --base nightly`. If a feature needs preview-only work, say so in
  the PR instead of pulling unrelated commits in.

## Rules

1. **One feature per PR**, labelled with exactly one `feature:<slug>` label
   (lowercase, digits, `-`). Several PRs may share a label when a feature lands
   in steps; a PR never carries two `feature:*` labels.
2. **Default-off flag per feature.** Read it once, in the feature's own new
   module, never from a shared registry file (that file would become hot):
   - query parameter `?<camelSlug>=1`, the existing `?trafficDebug=1` /
     `?embed=1` convention;
   - build-time config `VITE_GEV_<SLUG>=1` via `import.meta.env` for a deploy
     that should turn it on by default.
   Test both paths. Docs, gate fixes and regressions that restore existing
   behaviour need no flag.
3. **New files over edits to hot files.** Put the feature and its tests in new
   files and wire them in with the smallest possible edit. See [Hot files](#hot-files).
4. **No drive-by reformatting** or unrelated cleanup in a feature commit. Run
   `npm run format` on files you own; mechanical formatting gets its own commit
   (and usually its own PR).
5. **Conventional commits**: `type(scope): subject`, with `type` one of `feat`,
   `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, and `scope`
   the feature slug or the area (`traffic`, `voice`, `factory`, …).
6. **Atomic commits that port.** Every commit builds on its own and makes one
   reviewable step. Rebase instead of merging `nightly` into your branch: a
   branch containing merge commits cannot be ported and the port tool refuses
   it. Keep fork-only infrastructure (CI, factory docs) out of feature PRs.

## Hot files

A hot entry is a file, or a group that changes together, that so many changes
touch that two PRs in flight are likely to conflict on it. Entries and the
budget live in [`scripts/factory/hot-files.json`](scripts/factory/hot-files.json).

Evidence (2026-11-25, `python3 scripts/factory/hot_file_evidence.py --ref
upstream/main --since 2026-08-25 --open-prs kvnloo/gods-eye-view`): 763
first-parent changes on upstream `main` at `77e0937` (633 merged PRs, 130 direct
commits) and the 123 open fork PRs. An entry is hot at ≥10% of either set.

| Entry | Upstream changes | Open fork PRs |
|---|---|---|
| `docs/CURRENT-STATE.md` | 72% | 40% |
| `scripts/package-boundaries.json` | 34% | 18% |
| `scripts/format-scope.json` | 34% | 57% |
| `CHANGELOG.md` | 32% | 15% |
| `package.json` / `package-lock.json` | 14% | 7% |
| `src/i18n/locales/*.json` (+ `same-as-english.json`), one entry | 12% | 12% |
| `DATA_SOURCES.md` | 12% | 7% |
| `README.md` | 12% | 7% |

Upstream itself records `CHANGELOG.md` as "the most frequent merge conflict in
the open queue" (CHANGELOG.md, the `changelog.d` entry, #787); a live rehearsal of
fork PR #52 on upstream `7646568` conflicts in `CHANGELOG.md`, `.env.example` and
`server/standalone/vite.config.js`. Use `changelog.d/<pr>-<slug>.md`, never
`CHANGELOG.md`.

**N = 4** (`max_hot_entries`). A legitimate flagged feature can need four: the
`CURRENT-STATE.md` update `CONTRIBUTING.md` requires, a `package-boundaries.json`
entry for a new export, a `format-scope.json` entry for new tests, and
translations for new UI text. Measured with this list, 85% of upstream changes
and 122 of 123 open fork PRs fit in 4 (N = 3 would fit 77% and 88%). What N = 4
rejects is the tail of multi-surface changes. Change N or the list only in a
PR that reruns the evidence script and updates this table.

## Required checks

`.github/workflows/factory-modularity.yml`, on PRs into `nightly`:

| Check (job name) | What fails it | Local command |
|---|---|---|
| `factory-modularity/hot-files` | more than N hot entries touched | `python3 scripts/factory/hot_files.py --base origin/nightly --head HEAD` |
| `factory-modularity/commit-builds` | any commit in the range fails `npm ci` / `npm run build`, or the range has more than 30 commits | `python3 scripts/factory/build_each_commit.py --base origin/nightly --head HEAD` |
| `factory-modularity/tooling-tests` | the tools' fixture tests fail | `python3 -m unittest discover -s scripts/factory/tests -v` |

PRs whose head branch is `main` (upstream sync) skip the first two. The CI-gates
card owns `ci.yml` / `factory-ci-sha.yml` and their check names. GitHub Actions
is currently disabled on the fork (dispatch returns HTTP 422), so until it is
enabled these run as local or external `gev-ci/*` status gates using the same
commands.

`build_each_commit.py` builds each commit in a temporary detached worktree
(`git clean -ffdx` between commits; `npm ci` only when `package.json` or
`package-lock.json` changes), never touches your checkout, removes the worktree
even on Ctrl-C/SIGTERM, prints `FAILING SHA: <sha>` with the log tail, and exits
3 if your checkout changed or the cleanup failed. `--keep-going` builds the rest
after a failure; `--build`/`--install` swap the commands.

## Upstream port rehearsal

```
python3 scripts/upstream-port.py feature:<slug> [--keep] [--json]
```

- Resolves the exact label (a bare slug means `feature:<slug>`). An unknown
  label lists near matches and stops; it is never guessed.
- Selects every merged PR with the label into `nightly` (`--base` to change),
  ordered by merge time then number; open, closed or other-base PRs are listed
  as not selected.
- Expands each PR into what landed: a merge commit becomes the PR's own commits
  (refused if the branch contains merges or the merge carries hand resolutions);
  a rebase merge its rebased commits; a squash merge the squash commit.
- Fetches upstream `main` into a new throwaway repository under `$TMPDIR` and
  cherry-picks in memory (`git merge-tree`) onto `upstream-port/<slug>`. It never
  reads or writes your checkout; its remotes have `refused://` push URLs and
  the git wrapper refuses push.
- Reports each commit as `picked`, `empty` (already upstream), `conflict` (with
  paths) or `not-attempted`, and the cleanup status. `--keep` retains the
  scratch repository for inspection.

Exit codes: 0 clean, 1 conflict, 2 bad or ambiguous label, 3 nothing to port,
4 not portable as atomic commits, 5 gh or fetch failure.

It never pushes, opens PRs or comments. The `oss-factory-gev` cron alone posts
upstream.
