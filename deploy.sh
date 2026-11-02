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

# Enable Growatt NOAH bridge sidecars when credentials are present in .env.
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"
if [[ -z "${COMPOSE_PROFILES}" ]] && grep -qE '^[[:space:]]*GROWATT_USERNAME=[^[:space:]#]+' .env; then
  COMPOSE_PROFILES="noah"
fi
if [[ -n "${COMPOSE_PROFILES}" ]]; then
  export COMPOSE_PROFILES
  echo "==> Compose profiles: ${COMPOSE_PROFILES}"
fi

echo "==> Building and starting containers (version ${BUILD_TIME})"
if ! docker compose build --build-arg "BUILD_TIME=${BUILD_TIME}"; then
  echo "ERROR: docker compose build failed" >&2
  exit 1
fi
if ! docker compose up -d; then
  echo "ERROR: docker compose up failed" >&2
  exit 1
fi

echo "==> Status"
docker compose ps

# Refuse a "successful" deploy if the app container is not running.
if ! docker compose ps --status running --services | grep -qx 'rrs37-dashboard'; then
  echo "ERROR: rrs37-dashboard container is not running after deploy" >&2
  docker compose ps >&2 || true
  exit 1
fi

if [[ "${COMPOSE_PROFILES:-}" == *noah* ]]; then
  for svc in mosquitto noah-mqtt; do
    if ! docker compose ps --status running --services | grep -qx "$svc"; then
      echo "ERROR: ${svc} container is not running (profile noah)" >&2
      docker compose ps >&2 || true
      exit 1
    fi
  done
fi

echo "==> Clearing Docker build cache"
docker builder prune -af

echo "Deploy complete."
# Checked by .github/workflows/deploy.yml; must stay the last line of output.
echo "RRS37_DEPLOY_OK"


