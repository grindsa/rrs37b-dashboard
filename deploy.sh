#!/usr/bin/env bash
# Deploy RRS37-Dashboard on the webserver (build on the host, no registry).
# Expected location: /srv/stacks/rrs37-dashboard
# Usage (on the server): ./deploy.sh
# Prerequisites: git remote configured, Docker + Compose installed, .env present.

set -euo pipefail

EXPECTED_ROOT="/srv/stacks/rrs37-dashboard"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ "$ROOT" != "$EXPECTED_ROOT" ]]; then
  echo "Warning: expected stack path ${EXPECTED_ROOT}, running from ${ROOT}" >&2
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and fill in values before deploying." >&2
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> Fetching ${BRANCH} in ${ROOT}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Building and starting containers"
docker compose build
docker compose up -d

echo "==> Status"
docker compose ps

echo "Deploy complete."
