# Branch migration: kvnloo/gods-eye-view

Owner approval: Kevin, 2026-11-24 ~14:50, item "1. yes" in `PLAN.md`. Archive `main` at 53f0caa, copy it to `staging`, retarget open PRs to `staging`, then force fork `main` to upstream `main`.

**Status: complete. Do not repeat any step.** Replaying the forced `main` update would now rewind a mirror that has since been fast-forwarded.

## Final refs (re-verified 2026-11-25T23:15:52Z with `git ls-remote` and the GitHub API)

| Ref | SHA | Check |
|---|---|---|
| tag `archive/main-pre-sync-20261124` | `53f0caa6e54d9769740d69424e8bf26364b00a6a` | lightweight tag, object type `commit` |
| `staging` (default branch) | `53f0caa6e54d9769740d69424e8bf26364b00a6a` | `default_branch=staging`; keeps the 71 fork-only commits (compare main...staging: 71 ahead / 969 behind) |
| `nightly` | `53f0caa6e54d9769740d69424e8bf26364b00a6a` | unchanged since creation; 6 open PRs target it |
| `main` | `7646568a92bb62df6262dd42bcae221d3fe5ce8a` | equal to `bilawalsidhu/gods-eye-view` `refs/heads/main` (also `HEAD`) |

Upstream `main` before the cutover was `77e0937bb77e10c99c5672e535b015df46281f67`. Upstream compare `77e0937...7646568` gives `ahead` 133 / behind 0, so the later move of `main` was a pure fast-forward. No conflicting branch named `archive/main-pre-sync-20261124` exists. The four older `archive/historic-fires-*` branches are untouched. `main` has no branch protection yet (GitHub returns HTTP 404 "Branch not protected"); that work belongs to t_4f3cfa1b.

## Step log

1. Archive tag `archive/main-pre-sync-20261124` → 53f0caa, pushed and verified by ls-remote (tek, 2026-11-24).
2. `staging` and `nightly` created at 53f0caa, verified (tek, 2026-11-24).
3. 19 open PRs with base `main` retargeted to `staging`. GitHub records each retarget as a `BaseRefChangedEvent` between 2026-11-24T21:23:41Z and 21:24:46Z (actor kvnloo). Before the reset, a re-enumeration found 0 open PRs on `main`. No PR was closed or commented on.
4. Attended cutover (2026-11-24 ~16:45 CST): `git push --force-with-lease=main:53f0caa6e54d9769740d69424e8bf26364b00a6a origin 77e0937:refs/heads/main`. Afterwards ls-remote showed main=77e0937, and the compare against upstream was identical (0/0).
5. Default branch set to `staging` with `gh api PATCH` and verified.
6. 2026-11-25: `sync-main.sh --apply` fast-forwarded `main` from 77e0937 to 7646568 (133 commits, `force=false`) and verified the result.

## PR migration reconciliation

Enumeration: REST `GET /pulls?state=open&per_page=100`, paginated, returned 122 PRs. GraphQL `pullRequests(states:OPEN).totalCount` also returned 122. The plan's "~116 open PRs, mostly base=main" was a stale estimate. Only 19 open PRs ever had base `main` at migration time. The others are stacked on feature or `upstream-main*` branches and were correctly left alone.

| Open PR base now | Count |
|---|---|
| `staging` | 19 |
| `upstream-main` | 14 |
| `nightly` | 6 |
| `feat/historic-fires-continuation` | 6 |
| `city-v1/07-score` | 4 |
| `exp/disaster-access-kernel-131` | 4 |
| `feat/planet-playground-demo-20261016` | 3 |
| `feat/gev-look-manifests-20261017` | 2 |
| other stacked feature bases (52 more) | 64 |
| **`main`** | **0** |

The 6 PRs on `nightly` (#334, #335, #336, #337, #338, #339) were opened after the migration and never had base `main`. Older `main` base events on #164, #165 and #264 date from October 2026 and those PRs are on their own bases now. No closed PR with base `main` was closed after 2026-11-23, so nothing was closed by the migration.

| PR | URL | Old base | New base | Outcome |
|---|---|---|---|---|
| [#1](https://github.com/kvnloo/gods-eye-view/pull/1) | https://github.com/kvnloo/gods-eye-view/pull/1 | main | staging | retargeted 2026-11-24T21:23:41Z by kvnloo; open, base `staging`, head `1693f8c3ed1cb5dc70cf83d65f15769d81fbc983` unchanged |
| [#2](https://github.com/kvnloo/gods-eye-view/pull/2) | https://github.com/kvnloo/gods-eye-view/pull/2 | main | staging | retargeted 2026-11-24T21:23:45Z by kvnloo; open, base `staging`, head `40fa55db20725e5292cc1ae7a50f80a48178bee3` unchanged |
| [#111](https://github.com/kvnloo/gods-eye-view/pull/111) | https://github.com/kvnloo/gods-eye-view/pull/111 | main | staging | retargeted 2026-11-24T21:23:48Z by kvnloo; open, base `staging`, head `79daad9b49e7acd8202f7e8b110058da8683a7cb` unchanged |
| [#196](https://github.com/kvnloo/gods-eye-view/pull/196) | https://github.com/kvnloo/gods-eye-view/pull/196 | main | staging | retargeted 2026-11-24T21:23:51Z by kvnloo; open, base `staging`, head `83a851d401f1b07406928e8f29bdfb21798fe971` unchanged |
| [#236](https://github.com/kvnloo/gods-eye-view/pull/236) | https://github.com/kvnloo/gods-eye-view/pull/236 | main | staging | retargeted 2026-11-24T21:23:55Z by kvnloo; open, base `staging`, head `bcaa0881da18ef1913bc8ffc5e0e137635f81315` unchanged |
| [#253](https://github.com/kvnloo/gods-eye-view/pull/253) | https://github.com/kvnloo/gods-eye-view/pull/253 | main | staging | retargeted 2026-11-24T21:23:58Z by kvnloo; open, base `staging`, head `9cb707a9add6c19f5370dfe8c915775c0f110841` unchanged |
| [#260](https://github.com/kvnloo/gods-eye-view/pull/260) | https://github.com/kvnloo/gods-eye-view/pull/260 | main | staging | retargeted 2026-11-24T21:24:02Z by kvnloo; open, base `staging`, head `bf32aeb30512f3cf66bd7e978e5813cf81f86657` unchanged |
| [#262](https://github.com/kvnloo/gods-eye-view/pull/262) | https://github.com/kvnloo/gods-eye-view/pull/262 | main | staging | retargeted 2026-11-24T21:24:05Z by kvnloo; open, base `staging`, head `c8ad76e2bf5b186c45cb8cd01bc64ed47f076758` unchanged |
| [#289](https://github.com/kvnloo/gods-eye-view/pull/289) | https://github.com/kvnloo/gods-eye-view/pull/289 | main | staging | retargeted 2026-11-24T21:24:09Z by kvnloo; open, base `staging`, head `487217fcc225abf1cc6437a0c3c90db017683769` unchanged |
| [#290](https://github.com/kvnloo/gods-eye-view/pull/290) | https://github.com/kvnloo/gods-eye-view/pull/290 | main | staging | retargeted 2026-11-24T21:24:14Z by kvnloo; open, base `staging`, head `1854d5c52b3aa4bf7d6c54665491746aa41020d3` unchanged |
| [#291](https://github.com/kvnloo/gods-eye-view/pull/291) | https://github.com/kvnloo/gods-eye-view/pull/291 | main | staging | retargeted 2026-11-24T21:24:18Z by kvnloo; open, base `staging`, head `274c653d2c5aae5c545c15a726a418e7200112f2` unchanged |
| [#293](https://github.com/kvnloo/gods-eye-view/pull/293) | https://github.com/kvnloo/gods-eye-view/pull/293 | main | staging | retargeted 2026-11-24T21:24:22Z by kvnloo; open, base `staging`, head `96c80b8600c1bffd42dedc48abfc9af25ba25441` unchanged |
| [#294](https://github.com/kvnloo/gods-eye-view/pull/294) | https://github.com/kvnloo/gods-eye-view/pull/294 | main | staging | retargeted 2026-11-24T21:24:26Z by kvnloo; open, base `staging`, head `d6398d121a58571bb942df936315ea78bffc5edd` unchanged |
| [#295](https://github.com/kvnloo/gods-eye-view/pull/295) | https://github.com/kvnloo/gods-eye-view/pull/295 | main | staging | retargeted 2026-11-24T21:24:29Z by kvnloo; open, base `staging`, head `c627b91559cf91565afd4f0be8cadb21147c2467` unchanged |
| [#296](https://github.com/kvnloo/gods-eye-view/pull/296) | https://github.com/kvnloo/gods-eye-view/pull/296 | main | staging | retargeted 2026-11-24T21:24:34Z by kvnloo; open, base `staging`, head `299af2b097844de2ba4c8145b74fe5ad0cc945dd` unchanged |
| [#297](https://github.com/kvnloo/gods-eye-view/pull/297) | https://github.com/kvnloo/gods-eye-view/pull/297 | main | staging | retargeted 2026-11-24T21:24:37Z by kvnloo; open, base `staging`, head `ca5d162e55d9ada7d866cd10e795062f51f6fe64` unchanged |
| [#300](https://github.com/kvnloo/gods-eye-view/pull/300) | https://github.com/kvnloo/gods-eye-view/pull/300 | main | staging | retargeted 2026-11-24T21:24:40Z by kvnloo; open, base `staging`, head `b606dc6150749537d5618b4a1b7f15f9144ecdce` unchanged |
| [#301](https://github.com/kvnloo/gods-eye-view/pull/301) | https://github.com/kvnloo/gods-eye-view/pull/301 | main | staging | retargeted 2026-11-24T21:24:43Z by kvnloo; open, base `staging`, head `a36f87840f0e755ef0d0c4dda2aa6f6c898598aa` unchanged |
| [#310](https://github.com/kvnloo/gods-eye-view/pull/310) | https://github.com/kvnloo/gods-eye-view/pull/310 | main | staging | retargeted 2026-11-24T21:24:46Z by kvnloo; open, base `staging`, head `a3c71a121a3ee150c34bb450f379b6e513578dd0` unchanged |

Reconciliation: 19 retarget events = 19 rows in the ledger = 19 open PRs on `staging`. Every head SHA matches the one recorded at migration time. 0 open PRs target `main`.
