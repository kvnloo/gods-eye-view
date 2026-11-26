# Agent instructions

## Fork factory (kvnloo/gods-eye-view)

These rules apply to agents working on the `kvnloo/gods-eye-view` fork. The full
rules, evidence and commands are in [CONTRIBUTING-FACTORY.md](CONTRIBUTING-FACTORY.md).

- Branch from `origin/staging`; open PRs into `nightly`. Never commit to `main`
  (upstream mirror) or `staging` (promotion only).
- One feature per PR with exactly one `feature:<slug>` label.
- Every feature is default-off behind its own flag: query parameter
  `?<camelSlug>=1`, or build-time config `VITE_GEV_<SLUG>=1`, read in the
  feature's own module. No shared flag registry.
- Prefer new files. Touch at most 4 hot entries (`scripts/factory/hot-files.json`:
  `docs/CURRENT-STATE.md`, `scripts/package-boundaries.json`,
  `scripts/format-scope.json`, `CHANGELOG.md`, `package.json`/lockfile,
  `src/i18n/locales/*`, `DATA_SOURCES.md`, `README.md`). Never edit
  `CHANGELOG.md`; add `changelog.d/<pr>-<slug>.md`.
- No drive-by reformatting or cleanup in feature commits.
- Conventional commits `type(scope): subject`; each commit builds on its own; no
  merge commits inside a feature branch (rebase instead).
- Before asking for review run
  `python3 scripts/factory/hot_files.py --base origin/nightly --head HEAD` and
  `python3 scripts/factory/build_each_commit.py --base origin/nightly --head HEAD`.
- `python3 scripts/upstream-port.py feature:<slug>` is a local dry run only.
  Never push to, open PRs on, or comment on `bilawalsidhu/gods-eye-view`; the
  `oss-factory-gev` cron owns upstream posting.
