#!/usr/bin/env bash
# Deploy RRS37-Dashboard on the webserver.
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

# Git refuses operations when the tree is owned by another user (common for
# /srv/stacks/*). Mark this path safe for the deploying account.
if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq "$ROOT"; then
  git config --global --add safe.directory "$ROOT"
fi

echo "==> Fetching ${BRANCH} in ${ROOT}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

BUILD_TIME="$(TZ=Europe/Berlin date +%Y-%m-%d-%H-%M-%S)"
export BUILD_TIME
echo "==> Building and starting containers (version ${BUILD_TIME})"
docker compose build --build-arg "BUILD_TIME=${BUILD_TIME}"
docker compose up -d

echo "==> Status"
docker compose ps

echo "==> Clearing Docker build cache"
docker builder prune -af

echo "Deploy complete."

