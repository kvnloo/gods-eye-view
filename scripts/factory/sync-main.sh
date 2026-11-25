#!/usr/bin/env bash
# Fast-forward the fork's mirror branch (main) to upstream main. Never forces.
#
# Used by .github/workflows/factory-main-sync.yml and runnable by an operator.
#
# Environment:
#   SYNC_MODE          apply (default) | check
#   SYNC_FORK_URL      push/read URL of the fork  (default git@github.com:kvnloo/gods-eye-view.git)
#   SYNC_UPSTREAM_URL  read URL of upstream        (default https://github.com/bilawalsidhu/gods-eye-view.git)
#   SYNC_UPSTREAM_REF  upstream branch             (default main)
#   SYNC_TARGET_BRANCH fork branch to update       (default main; verification uses factory/sync-canary)
#   SYNC_SSH_KEY_FILE  private deploy key file; when set, git uses only this key over SSH with
#                      GitHub's pinned host keys
#   GITHUB_STEP_SUMMARY when set (Actions), the markdown report is appended there too
#
# Exit codes: 0 in sync / fast-forwarded / check ok, 2 authentication or access failure,
# 3 divergence (not fast-forwardable), 4 push rejected, 5 post-push verification mismatch,
# 64 usage error.
# shellcheck disable=SC2016  # backticks are literal markdown for the job summary
set -euo pipefail

mode=${SYNC_MODE:-apply}
fork_url=${SYNC_FORK_URL:-git@github.com:kvnloo/gods-eye-view.git}
upstream_url=${SYNC_UPSTREAM_URL:-https://github.com/bilawalsidhu/gods-eye-view.git}
upstream_ref=${SYNC_UPSTREAM_REF:-main}
target=${SYNC_TARGET_BRANCH:-main}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}

say() { printf '%s\n' "$@" | tee -a "$summary"; }
fail() { # fail <exit> <title> <body...>
  local code=$1 title=$2; shift 2
  printf '::error title=%s::%s\n' "$title" "$1"
  { printf '\n### ❌ %s\n\n' "$title"; printf '%s\n' "$@"; } | tee -a "$summary" >&2
  exit "$code"
}

case $mode in apply|check) ;; *) echo "SYNC_MODE must be apply or check (got '$mode')" >&2; exit 64;; esac
[[ $target =~ ^[A-Za-z0-9._/-]+$ && $upstream_ref =~ ^[A-Za-z0-9._/-]+$ ]] || { echo 'bad branch name' >&2; exit 64; }

work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sync-main.XXXXXX")
trap 'rm -rf "$work"' EXIT

if [[ -n ${SYNC_SSH_KEY_FILE:-} ]]; then
  [[ -s $SYNC_SSH_KEY_FILE ]] || fail 2 'Sync bot credential missing' \
    'The deploy key file is empty or absent. In Actions this means the `MAIN_SYNC_DEPLOY_KEY` secret of the `upstream-sync` environment is not set, or the run is not on `staging` (the only branch the environment admits).' \
    'Fix: see docs/factory/MAIN-SYNC.md, "Rotate or restore the bot key".'
  # GitHub's published SSH host keys (GET /meta .ssh_keys). Pinned: no trust-on-first-use.
  cat > "$work/known_hosts" <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
EOF
  export GIT_SSH_COMMAND="ssh -i '$SYNC_SSH_KEY_FILE' -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='$work/known_hosts' -o ConnectTimeout=20"
fi
export GIT_TERMINAL_PROMPT=0

git init -q --bare "$work/repo"
g() { git -C "$work/repo" -c credential.helper= "$@"; }

remote_sha() { # remote_sha <url> <branch> -> sha, or empty when the branch does not exist
  g ls-remote --exit-code "$1" "refs/heads/$2" 2>"$work/ls.err" | awk '{print $1}'
}

say "## Upstream mirror sync (\`$target\` ← upstream \`$upstream_ref\`, mode \`$mode\`)"
say ''

set +e
fork_before=$(remote_sha "$fork_url" "$target"); rc=$?
set -e
if [[ $rc -ne 0 || ! $fork_before =~ ^[0-9a-f]{40}$ ]]; then
  fail 2 'Cannot read fork with the sync bot credential' \
    "\`git ls-remote\` against the fork exited $rc:" '```' "$(sed -n '1,8p' "$work/ls.err")" '```' \
    'Likely causes: deploy key removed or rotated without updating the `MAIN_SYNC_DEPLOY_KEY` environment secret, a malformed secret, or the target branch no longer exists.' \
    'Do not switch to a personal token: only the deploy key may bypass the main ruleset.'
fi
set +e
up=$(remote_sha "$upstream_url" "$upstream_ref"); rc=$?
set -e
[[ $rc -eq 0 && $up =~ ^[0-9a-f]{40}$ ]] || fail 2 'Cannot read upstream' \
  "\`git ls-remote $upstream_url\` exited $rc:" '```' "$(sed -n '1,8p' "$work/ls.err")" '```' \
  'Upstream may be renamed, private, or GitHub is degraded. Nothing was changed.'

say "| ref | sha |"
say "|---|---|"
say "| fork \`$target\` (before) | \`$fork_before\` |"
say "| upstream \`$upstream_ref\` | \`$up\` |"
say ''

if [[ $fork_before == "$up" ]]; then
  say '✅ Already in sync. Nothing to do.'
  exit 0
fi

# Commit graph only; blobs are fetched lazily from upstream if a push needs them.
for r in upstream fork; do
  if [[ $r == upstream ]]; then url=$upstream_url; else url=$fork_url; fi
  g remote add "$r" "$url"
  g config "remote.$r.promisor" true
  g config "remote.$r.partialclonefilter" blob:none
done
g fetch -q --no-tags --filter=blob:none upstream "+refs/heads/$upstream_ref:refs/sync/upstream" \
  || fail 2 'Fetching upstream failed' 'Upstream could be listed but not fetched. Retry on the next run; nothing was changed.'
if ! g cat-file -e "$fork_before^{commit}" 2>/dev/null; then
  g fetch -q --no-tags --filter=blob:none fork "+refs/heads/$target:refs/sync/fork" \
    || fail 2 'Fetching fork failed' 'The fork could be listed but not fetched with the bot credential. Nothing was changed.'
fi

if ! g merge-base --is-ancestor "$fork_before" "$up"; then
  read -r fork_only up_only < <(g rev-list --left-right --count "$fork_before...$up")
  list=$(g log --format='- `%h` %s (%an)' -n 20 "$up..$fork_before")
  fail 3 'Fork main has diverged from upstream; refusing to update' \
    "Fork \`$target\` has **$fork_only** commit(s) not in upstream; upstream has **$up_only** new commit(s). A fast-forward is impossible and this job never forces." \
    '' 'Fork-only commits (newest first, max 20):' "$list" '' \
    'What to do:' \
    "1. Find who wrote to \`$target\` (Settings → Rules → Insights). Only the sync bot may update it." \
    '2. Move any wanted fork-only commits to a feature branch based on `staging` and open a PR.' \
    "3. An admin restores the mirror in an attended session: \`git push --force-with-lease=$target:$fork_before origin $up:refs/heads/$target\` with the \`main: sync bot only\` and \`main: mirror integrity\` rulesets temporarily disabled, then re-enables both and re-runs this workflow." \
    'If upstream itself was rewritten (force-pushed), confirm that before restoring.'
fi

ahead=$(g rev-list --count "$fork_before..$up")
say "Fast-forward available: **$ahead** new upstream commit(s)."
if [[ $mode == check ]]; then
  say '' '✅ Check mode: no update made.'
  exit 0
fi

# Plain push: the server rejects anything but a fast-forward; there is no force flag here.
set +e
g push --porcelain --no-follow-tags fork "$up:refs/heads/$target" >"$work/push.out" 2>"$work/push.err"
rc=$?
set -e
if [[ $rc -ne 0 ]]; then
  why='The push was rejected.'
  if grep -qiE 'GH013|rule violations|protected branch|Cannot update this protected ref' "$work/push.err"; then
    why='A repository rule rejected the push. The pushing credential is not the designated sync bot, or the bypass for deploy keys was removed from the `main: sync bot only` ruleset.'
  elif grep -qiE 'read.only|denied to deploy key|Permission to .* denied|Permission denied' "$work/push.err"; then
    why='The credential has no write access. The deploy key must be added with write access (read_only=false).'
  elif grep -qiE 'non-fast-forward|fetch first|stale info|rejected' "$work/push.err"; then
    why="\`$target\` moved while this job ran (or would not fast-forward). The next scheduled run re-reads both refs; nothing was forced."
  fi
  fail 4 'Push to fork rejected' "$why" '' "\`git push\` exited $rc:" '```' "$(sed -n '1,20p' "$work/push.err")" "$(cat "$work/push.out")" '```'
fi

after=$(remote_sha "$fork_url" "$target" || true)
[[ $after == "$up" ]] || fail 5 'Post-push verification mismatch' \
  "Push reported success but fork \`$target\` reads \`$after\`, expected \`$up\`. Another writer may have moved it; investigate before the next run."
say '' "✅ Fast-forwarded fork \`$target\` \`${fork_before:0:12}\` → \`${up:0:12}\` ($ahead commit(s)); verified with \`git ls-remote\`."
