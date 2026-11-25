# Fork `main` = fast-forward-only mirror of upstream

`kvnloo/gods-eye-view` `main` tracks `bilawalsidhu/gods-eye-view` `main` and nothing else. Work goes to
feature branches → `nightly` → `staging` (the default branch). Owner card: t_4f3cfa1b.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Workflow | `.github/workflows/factory-main-sync.yml` | Hourly at :17 (`schedule`) and on `workflow_dispatch` (`mode: apply\|check`). Must be on `staging` for `schedule` to fire. One run at a time (`concurrency: factory-main-sync`, queued, not cancelled). |
| Script | `scripts/factory/sync-main.sh` | Reads both refs, fetches the commit graph (`blob:none`), refuses unless fork `main` is an ancestor of upstream `main`, then a plain `git push` (no force) and an `ls-remote` read-back. Writes a markdown report to the job summary. Exit codes: 0 ok, 2 auth/access, 3 diverged, 4 push rejected, 5 read-back mismatch. |
| Offline tests | `scripts/factory/test-sync-main.sh` | file:// repos: in sync, check, fast-forward, divergence, upstream rewrite, auth failure, GH013 rejection, missing key, no-force guard. |
| Audit | `scripts/factory/verify-main-protection.sh` | Read-only check of everything below. Run it after any settings change. |

## Permission model (least privilege available on a personal-account repo)

- **Bot credential:** one SSH deploy key with write access, titled `gev-main-sync-bot …` (repo-scoped: it can
  push git refs on this repo and nothing else, with no API, issues, settings or other repos). A GitHub App would be
  equally narrow and easier to name as a bypass actor, but app registration needs the owner's browser. Deploy
  keys are the narrowest credential an agent can create through the API.
- **Secret placement:** the private key exists only as `MAIN_SYNC_DEPLOY_KEY` in the `upstream-sync`
  **environment**, whose deployment branch policy admits only `staging`. Workflows on other branches (including
  agent PR branches) cannot read it. It is not a repository-wide secret. The workflow token is `contents: read`.
- **Ruleset `main: mirror integrity`** (active, **no bypass**): `deletion`, `non_fast_forward`. Nobody can
  delete or force-push `main`, including the bot and the repository admin.
- **Ruleset `main: sync bot only`** (active): `update` (`update_allows_fetch_and_merge: false`), bypass
  `DeployKey: always`. Every other writer, including the owner's token that agents use, the GitHub UI, "Sync
  fork" and `GITHUB_TOKEN`, is rejected with GH013. Only deploy-key pushes may fast-forward `main`.
- Both rulesets also cover `refs/heads/factory/sync-canary`, so the protection can be re-tested without
  touching `main`.
- **Constraint:** the `DeployKey` bypass applies to *every* write deploy key on the repo. Never add another
  write deploy key, for promotion or anything else. Use read-only keys or a GitHub App. The audit fails if
  there is more than one.
- **What this cannot stop:** the repository owner (admin) can edit or disable rulesets. That is inherent to
  GitHub. The rulesets stop accidental and agent writes, not the owner.

## Failure triage (the job summary says which)

- **Cannot read fork with the sync bot credential (2):** the key was deleted or rotated, the secret is
  malformed, or the run is not on `staging`. Rotate (below).
- **Diverged (3):** something other than the bot wrote to `main`, or upstream was rewritten. The summary lists
  fork-only commits. Move wanted commits to a `staging`-based branch. Then an admin restores `main` in an
  attended session (force-with-lease with both rulesets temporarily disabled) and re-enables both rulesets.
  Never automate this.
- **Push rejected (4):** GH013 means the bypass or key is wrong. "non-fast-forward" means a race, and the next
  run retries.

## Rotate or restore the bot key

```sh
ssh-keygen -t ed25519 -N '' -C gev-main-sync-bot -f k            # in a private temp dir
gh api -X POST repos/kvnloo/gods-eye-view/keys -f title='gev-main-sync-bot' -f key="$(cat k.pub)" -F read_only=false
gh secret set MAIN_SYNC_DEPLOY_KEY --env upstream-sync --repo kvnloo/gods-eye-view < k
gh api -X DELETE repos/kvnloo/gods-eye-view/keys/<old-id>; rm -f k k.pub
bash scripts/factory/verify-main-protection.sh
```

## Verification record (2026-11-25, t_4f3cfa1b)

The full log is in the card handoff. On the live repo with both rulesets active:
- The owner token (`kvnloo`, admin; this is what agents use) tried to fast-forward the canary. `git push` was
  rejected with GH013 "Cannot update this protected ref". The API `PATCH` returned 422 with the same message.
  The API `DELETE` returned 422 "Cannot delete this branch". The canary was unchanged.
- The bot deploy key ran `sync-main.sh` against the canary. It fast-forwarded `e7e4e54 → 7646568` (9 commits,
  4 s), and the `ls-remote` read-back matched.
- With a key GitHub does not know, the script exited 2 with the remedy. Check mode on `main` exited 0, in sync.
- Not run live: bot force-push and bot delete probes. The operator approval gate did not approve them. Those
  rules come from the no-bypass ruleset, confirmed by API readback (`rules/branches/main` →
  deletion, non_fast_forward, update).
