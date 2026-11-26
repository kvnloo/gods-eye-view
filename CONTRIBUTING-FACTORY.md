# Fork factory contribution guide

- `main` mirrors upstream; no fork PRs or fork commits belong there.
- `staging` is stable. Existing PRs moved from `main` are historical intake; do not merge them directly to staging. Port their feature commits to a branch targeting `nightly` before new work lands.
- `nightly` is preview. Start new branches from stable `origin/staging`, as specified by the factory plan, and explicitly set `gh pr create --base nightly`. If a feature needs preview-only work, declare the dependency instead of silently incorporating unrelated commits.
- One feature per PR. Give each feature a default-off query/config flag, document how to enable it and test both paths. Docs, gate fixes and regressions that restore existing behavior do not need runtime flags.
- Put feature code and tests in focused new files. Use the established application contracts for the smallest possible wiring change. Keep mechanical formatting and unrelated cleanup out of behavior commits. Use `type(scope): subject`; every commit should build on its own.
- Use a unique `feature:<slug>` PR label. Keep exact commit provenance and avoid bundling dependencies that are not part of the feature. See `CONTRIBUTING.md` for the project’s runtime and testing conventions (its `main` instructions are for upstream).

## Upstream rehearsal

Run `python3 scripts/upstream-port.py feature:<slug>` from this fork checkout. It selects exactly one merged nightly PR with that exact label, pins its merge and source commits, fetches current upstream `main`, and tries the feature commits in order in a separate local checkout. It prints each attempted commit and any conflicted paths. The scratch branch is retained for inspection. It never pushes or opens an upstream PR; the upstream contribution process owns publication.
