#!/usr/bin/env bash
# Offline tests for scripts/factory/sync-main.sh using throwaway file:// repositories.
# Covers: in sync, check-only, fast-forward, divergence, upstream rewrite, auth/access failure,
# server-side rejection (a pre-receive hook printing GitHub's GH013 text). Never touches GitHub.
# shellcheck disable=SC2016,SC2034  # check() evals single-quoted assertions that read these vars
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sync="$here/sync-main.sh"
t=$(mktemp -d "${TMPDIR:-/tmp}/sync-main-test.XXXXXX")
trap 'rm -rf "$t"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
unset GITHUB_STEP_SUMMARY SYNC_SSH_KEY_FILE
pass=0; failn=0

mk() { git init -q --bare "$t/$1"; git -C "$t/$1" config uploadpack.allowFilter true; git -C "$t/$1" config uploadpack.allowAnySHA1InWant true; }
setup() {
  rm -rf "$t/up" "$t/fork" "$t/w"; mk up; mk fork
  git init -q -b main "$t/w"
  for i in 1 2; do echo "$i" >"$t/w/f$i"; git -C "$t/w" add .; git -C "$t/w" commit -qm "c$i"; done
  git -C "$t/w" push -q "file://$t/up" main; git -C "$t/w" push -q "file://$t/fork" main
}
up_commit() { echo "u$1" >"$t/w/u$1"; git -C "$t/w" add .; git -C "$t/w" commit -qm "u$1"; git -C "$t/w" push -q "file://$t/up" main; }
sha() { git -C "$t/$1" rev-parse refs/heads/main; }
run() { # run <name> <expected-exit> [env...]
  local name=$1 want=$2; shift 2
  set +e; env "$@" SYNC_FORK_URL="${FORK:-file://$t/fork}" SYNC_UPSTREAM_URL="file://$t/up" bash "$sync" >"$t/out" 2>&1; local rc=$?; set -e
  if [[ $rc == "$want" ]]; then pass=$((pass+1)); echo "PASS $name (exit $rc)"; else failn=$((failn+1)); echo "FAIL $name (exit $rc, want $want)"; sed 's/^/    /' "$t/out"; fi
}
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else failn=$((failn+1)); echo "FAIL $1"; fi; }

setup; run in-sync 0
check 'in-sync says so' 'grep -q "Already in sync" "$t/out"'

setup; up_commit 1; before=$(sha fork)
run check-mode 0 SYNC_MODE=check
check 'check mode leaves fork unchanged' '[[ $(sha fork) == "$before" ]]'

up_commit 2
run fast-forward 0
check 'fork now equals upstream' '[[ $(sha fork) == "$(sha up)" ]]'
check 'reports verified fast-forward' 'grep -q "Fast-forwarded" "$t/out"'

setup; up_commit 1
git -C "$t/w" checkout -q -b side HEAD~1; echo x >"$t/w/x"; git -C "$t/w" add .; git -C "$t/w" commit -qm 'fork-only'
git -C "$t/w" push -q -f "file://$t/fork" side:main; before=$(sha fork)
run divergence 3
check 'divergence leaves fork unchanged' '[[ $(sha fork) == "$before" ]]'
check 'divergence lists fork-only commit' 'grep -q "fork-only" "$t/out"'

setup; up_commit 1; git -C "$t/w" push -q "file://$t/fork" main
git -C "$t/w" push -q -f "file://$t/up" main~1:main; before=$(sha fork)
run upstream-rewound 3
check 'rewound upstream does not rewind fork' '[[ $(sha fork) == "$before" ]]'

setup; FORK="file://$t/missing" run auth-failure 2
check 'auth failure is actionable' 'grep -q "Cannot read fork with the sync bot credential" "$t/out"'

setup; up_commit 1; before=$(sha fork)
printf '#!/bin/sh\necho "remote: error: GH013: Repository rule violations found for refs/heads/main." >&2\nexit 1\n' >"$t/fork/hooks/pre-receive"
chmod +x "$t/fork/hooks/pre-receive"
run rejected-push 4
check 'rejected push names the ruleset' 'grep -q "A repository rule rejected the push" "$t/out"'
check 'rejected push leaves fork unchanged' '[[ $(sha fork) == "$before" ]]'

setup; SYNC_SSH_KEY_FILE="$t/nokey" run missing-key 2
check 'missing key explains environment gate' 'grep -q "upstream-sync" "$t/out"'

run bad-mode 64 SYNC_MODE=force
check 'script never force-pushes' '! grep -nE "^[[:space:]]*(g|git)[[:space:]].*push.*(--force|[[:space:]]-f[[:space:]]|[[:space:]]\"?\+)" "$sync"'

echo "passed=$pass failed=$failn"
[[ $failn == 0 ]]
