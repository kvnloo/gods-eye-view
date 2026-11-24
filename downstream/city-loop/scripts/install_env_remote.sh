#!/bin/bash
# Usage (from the operator machine):
#   ssh groot 'bash -s' < fetch_ion_env.sh | <ssh-to-capture-box> 'bash ~/install_env_remote.sh <app-dir>...'
# Reads one dotenv line from stdin and writes it, mode 600, into <app-dir>/.env
# (gitignored by the app). Prints only a length/fingerprint receipt.
set -euo pipefail
umask 077
line=$(head -1)
case "$line" in CESIUM_ION_TOKEN=?*) ;; *) echo "bad-input" >&2; exit 1;; esac
for d in "$@"; do
  f="$d/.env"
  touch "$f"; chmod 600 "$f"
  grep -v '^CESIUM_ION_TOKEN=' "$f" > "$f.tmp" || true
  printf '%s\n' "$line" >> "$f.tmp"; mv "$f.tmp" "$f"; chmod 600 "$f"
  git -C "$d" check-ignore -q .env && ign=ignored || ign=NOT-IGNORED
  echo "wrote $f ($ign) len=$(( ${#line} - 17 )) sha8=$(printf '%s' "${line#CESIUM_ION_TOKEN=}" | sha256sum | cut -c1-8)"
done
