#!/usr/bin/env bash
# Updates this server to a given commit and restarts Ocak. Rolls back if the new
# version doesn't come up healthy. Called by the Deploy workflow over SSH.
#
#   remote-deploy.sh <40-char commit SHA>
#
# When used as a forced command in authorized_keys, the SHA arrives in
# $SSH_ORIGINAL_COMMAND instead (the key can then run nothing but this script).
set -euo pipefail

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
