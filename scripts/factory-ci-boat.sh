#!/usr/bin/env bash
# Run every factory gate on one exact commit in a disposable Boat VM and post
# the gev-ci/* commit statuses from this (trusted) host. The VM gets no
# credentials; it only reads the public repository. Contract: docs/factory-ci.md.
#
#   scripts/factory-ci-boat.sh <sha> [base-sha]
#
# Needs: boat (signed in), gh (signed in with statuses + contents write on the
# fork), git, jq. Evidence goes to the factory/ci-evidence branch and each
# status links to it. Exit 0 only when gev-ci/full is success.
set -euo pipefail
repo=${GEV_CI_REPO:-kvnloo/gods-eye-view}
sha=${1:?usage: factory-ci-boat.sh <sha> [base-sha]}
base=${2:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "sha must be 40 lowercase hex characters" >&2; exit 2; }
[[ -z $base || $base =~ ^[0-9a-f]{40}$ ]] || { echo "base-sha must be a full SHA" >&2; exit 2; }
gh api "repos/$repo/commits/$sha" --jq .sha | grep -qx "$sha" || { echo "$sha is not a commit of $repo" >&2; exit 2; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
local_out=${GEV_CI_OUT:-$PWD/ci-runs}/$sha/$stamp
mkdir -p "$local_out"
box=$(boat new --no-update --no-env --type default --ttl 7200 --name "gev-ci-${sha:0:12}" --json | jq -r 'select(.event == "ready") | .id')
[[ $box == bx_* ]] || { echo "could not start a Boat VM" >&2; exit 3; }
trap 'boat delete --no-update "$box" --yes > /dev/null 2>&1 || true' EXIT

remote=$(cat <<'REMOTE'
set -euo pipefail
export GIT_TERMINAL_PROMPT=0 GEV_CI_RUNNER=boat-default-4vcpu
unset GH_TOKEN GITHUB_TOKEN
cd /home/user
npm install --silent --no-audit --no-fund --prefix runtime node@24.22.2
export PATH=/home/user/runtime/node_modules/.bin:$PATH
git init -q src && cd src
git fetch -q "https://github.com/$REPO.git" "$SHA" '+refs/heads/main:refs/remotes/origin/main'
[[ -z $BASE ]] || git fetch -q "https://github.com/$REPO.git" "$BASE"
git checkout -q --detach "$SHA"
[[ $(git rev-parse HEAD) == "$SHA" ]]
mkdir -p ci-results
start=$SECONDS
# A failed install records no gate results, so every status reads error.
if npm ci --no-audit --no-fund > ci-results/npm-ci.log 2>&1; then
  echo "$((SECONDS - start))" > ci-results/install-seconds.txt
  node scripts/factory-ci.mjs --out ci-results ${BASE:+--base-ref "$BASE"} || true
fi
printf '%s\n' "$SHA" > ci-results/sha.txt
node --version > ci-results/node-version.txt
tar -czf /home/user/ci-results.tgz --exclude='*.ndjson' ci-results
REMOTE
)
boat exec --no-update "$box" --timeout 0 env REPO="$repo" SHA="$sha" BASE="$base" bash -c "$remote" | tee "$local_out/remote.log"
boat exec --no-update --json "$box" --timeout 120 base64 -w0 /home/user/ci-results.tgz > "$local_out/fetch.json"
[[ $(jq -r '.exitCode' "$local_out/fetch.json") == 0 && $(jq -r '.stdoutTruncated' "$local_out/fetch.json") == false ]] \
  || { echo "could not retrieve results" >&2; exit 3; }
jq -r .stdout "$local_out/fetch.json" | base64 -d | tar -xzf - -C "$local_out"
rm "$local_out/fetch.json"
[[ $(cat "$local_out/ci-results/sha.txt") == "$sha" ]]

# Publish evidence to factory/ci-evidence, then link every status to it.
evidence=$(mktemp -d)
git -C "$evidence" init -q
git -C "$evidence" fetch -q --depth=1 "https://github.com/$repo.git" factory/ci-evidence 2>/dev/null \
  && git -C "$evidence" checkout -q FETCH_HEAD || git -C "$evidence" checkout -q --orphan factory/ci-evidence
mkdir -p "$evidence/$sha/$stamp"
cp "$local_out"/ci-results/*.{json,log,png,txt} "$evidence/$sha/$stamp/" 2>/dev/null || true
git -C "$evidence" add -A
git -C "$evidence" -c user.name=gev-factory -c user.email=gev-factory@users.noreply.github.com commit -qm "ci(evidence): gev-ci for $sha ($stamp)"
GIT_TERMINAL_PROMPT=0 git -C "$evidence" -c credential.helper= -c 'credential.https://github.com.helper=!gh auth git-credential' \
  push -q "https://github.com/$repo.git" HEAD:refs/heads/factory/ci-evidence
url="https://github.com/$repo/tree/factory/ci-evidence/$sha/$stamp"

node "$(dirname "$0")/factory-ci.mjs" statuses "$local_out/ci-results" > "$local_out/statuses.tsv"
while IFS=$'\t' read -r context state description; do
  gh api -X POST "repos/$repo/statuses/$sha" -f state="$state" -f context="$context" \
    -f description="$description" -f target_url="$url" > /dev/null
  printf '%s\t%s\t%s\n' "$context" "$state" "$description"
done < "$local_out/statuses.tsv"
echo "evidence: $url"
[[ $(awk -F'\t' '$1 == "gev-ci/full" { print $2 }' "$local_out/statuses.tsv") == success ]]
