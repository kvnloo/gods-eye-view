#!/usr/bin/env bash
# Read-only audit of the main-mirror protection model (docs/factory/MAIN-SYNC.md).
# Needs `gh` authenticated as a repository admin. Changes nothing.
set -euo pipefail
R=${1:-kvnloo/gods-eye-view}
bad=0
ok() { printf 'ok   %s\n' "$*"; }
no() { printf 'FAIL %s\n' "$*"; bad=1; }

rules=$(gh api "repos/$R/rules/branches/main" --jq '[.[].type]|sort|join(",")')
[[ $rules == deletion,non_fast_forward,update ]] && ok "effective rules on main: $rules" || no "effective rules on main: '$rules' (want deletion,non_fast_forward,update)"

sets=$(gh api "repos/$R/rulesets" --jq '.[].id')
for id in $sets; do
  rs=$(gh api "repos/$R/rulesets/$id")
  name=$(jq -r .name <<<"$rs"); enf=$(jq -r .enforcement <<<"$rs")
  incl=$(jq -c '.conditions.ref_name.include' <<<"$rs"); byp=$(jq -c '[.bypass_actors[]|.actor_type+":"+.bypass_mode]' <<<"$rs")
  case $name in
    'main: mirror integrity') [[ $enf == active && $byp == '[]' ]] && ok "$name active, no bypass, $incl" || no "$name enforcement=$enf bypass=$byp";;
    'main: sync bot only') [[ $enf == active && $byp == '["DeployKey:always"]' ]] && ok "$name active, bypass $byp, $incl" || no "$name enforcement=$enf bypass=$byp";;
    *) printf 'info other ruleset %s (%s, bypass %s)\n' "$name" "$enf" "$byp";;
  esac
done

# The DeployKey bypass covers every deploy key with write access, so there must be exactly one.
writers=$(gh api "repos/$R/keys" --jq '[.[]|select(.read_only==false)|.title]')
[[ $(jq length <<<"$writers") == 1 ]] && ok "write deploy keys: $writers" || no "write deploy keys must be exactly the sync bot: $writers"

pol=$(gh api "repos/$R/environments/upstream-sync" --jq '.deployment_branch_policy|tostring')
br=$(gh api "repos/$R/environments/upstream-sync/deployment-branch-policies" --jq '[.branch_policies[]|.type+":"+.name]|join(",")')
[[ $br == branch:staging ]] && ok "upstream-sync environment admits only $br ($pol)" || no "upstream-sync branch policies: '$br'"
sec=$(gh api "repos/$R/environments/upstream-sync/secrets" --jq '[.secrets[].name]|join(",")')
[[ $sec == MAIN_SYNC_DEPLOY_KEY ]] && ok "environment secret present: $sec" || no "environment secrets: '$sec'"
repo_sec=$(gh api "repos/$R/actions/secrets" --jq '[.secrets[].name]|join(",")')
[[ $repo_sec != *MAIN_SYNC* ]] && ok "bot key is not a repository-wide secret" || no "bot key exposed as repository secret"

fork=$(git ls-remote "https://github.com/$R" refs/heads/main | cut -f1)
up=$(git ls-remote https://github.com/bilawalsidhu/gods-eye-view refs/heads/main | cut -f1)
[[ $fork == "$up" ]] && ok "fork main == upstream main ($fork)" || printf 'info fork main %s, upstream main %s (sync pending or diverged)\n' "$fork" "$up"
exit $bad
