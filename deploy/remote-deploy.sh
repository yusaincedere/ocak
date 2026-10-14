#!/usr/bin/env bash
# Updates this server to a given commit and restarts Ocak. Rolls back if the new
# version doesn't come up healthy. Called by the Deploy workflow over SSH.
#
#   remote-deploy.sh <40-char commit SHA>
#
# When used as a forced command in authorized_keys, the SHA arrives in
# $SSH_ORIGINAL_COMMAND instead (the key can then run nothing but this script).
#
# Optional app settings can be piped in as KEY=value lines (the Deploy workflow sends the
# ones set as GitHub variables). Only the keys in SETTINGS are accepted; each must be a
# plain http(s) URL. They're written into deploy/.env before the app restarts.
set -euo pipefail

SETTINGS=(AVATAR_API_MALE AVATAR_API_FEMALE DESKTOP_DOWNLOAD_URL)

# Everything lives in main(), which bash reads completely before running it,
# so the script can safely update its own file during `git checkout`.
main() {
  local sha=${1:-${SSH_ORIGINAL_COMMAND:-}}
  if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
    echo "Usage: remote-deploy.sh <40-character commit SHA>" >&2
    exit 2
  fi

  local repo
  repo=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)
  cd "$repo"

  [[ -f deploy/.env ]] || { echo "Missing deploy/.env - run deploy/setup.sh first" >&2; exit 1; }
  apply_settings

  git fetch --quiet origin main
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "Refusing to deploy $sha: it is not on origin/main" >&2
    exit 1
  fi

  local previous
  previous=$(git rev-parse HEAD)
  echo "Deploying ${sha:0:12} (was ${previous:0:12})"

  git checkout --quiet --detach "$sha"
  if up_and_healthy; then
    docker image prune --force >/dev/null
    echo "Deployed ${sha:0:12}"
    return 0
  fi

  echo "New version is not healthy; rolling back to ${previous:0:12}" >&2
  (cd deploy && docker compose logs --tail=80 app) >&2 || true
  git checkout --quiet --detach "$previous"
  up_and_healthy || echo "Rollback is not healthy either - check the server" >&2
  exit 1
}

# Reads KEY=value lines from stdin (if any) and updates deploy/.env.
apply_settings() {
  [[ -t 0 ]] && return 0 # run by hand in a terminal: nothing piped in
  local line key value allowed
  while IFS= read -r -t 5 line || [[ -n $line ]]; do
    [[ $line =~ ^([A-Z_]+)=(.*)$ ]] || continue
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    allowed=0
    for k in "${SETTINGS[@]}"; do [[ $k == "$key" ]] && allowed=1; done
    if ((!allowed)); then
      echo "Ignoring setting $key (not allowed)" >&2
      continue
    fi
    [[ -z $value ]] && continue # not set on GitHub: keep whatever the server has
    if [[ ${#value} -gt 2000 || ! $value =~ ^https?://[^[:space:]\'\"\`\$\\]+$ ]]; then
      echo "Ignoring setting $key: not a plain http(s) URL" >&2
      continue
    fi
    if grep -q "^$key=" deploy/.env; then
      local tmp
      tmp=$(mktemp)
      awk -v k="$key" -v v="$value" 'index($0, k "=") == 1 { print k "=" v; next } { print }' deploy/.env >"$tmp"
      cat "$tmp" >deploy/.env # keep the file's owner and permissions
      rm -f "$tmp"
    else
      printf '%s=%s\n' "$key" "$value" >>deploy/.env
    fi
    echo "Set $key"
  done
}

up_and_healthy() {
  (
    cd deploy
    docker compose up -d --build --remove-orphans
    # Caddy only re-reads its config on reload; harmless when nothing changed.
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  ) || return 1

  local port
  port=$(sed -n 's/^PORT=//p' deploy/.env | tail -1)
  port=${port:-3000}
  for _ in $(seq 1 30); do
    if curl --fail --silent --max-time 3 --output /dev/null "http://127.0.0.1:$port/api/health"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

main "$@"
