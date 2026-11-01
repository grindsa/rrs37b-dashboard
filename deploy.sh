#!/usr/bin/env bash
# Deploy RRS37-Dashboard on the webserver (build locally on the host).
# Usage: ./deploy.sh
# Prerequisites: git remote configured, Docker + Compose installed, .env present.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example and fill in values before deploying." >&2
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> Fetching ${BRANCH}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Building and starting containers"
docker compose build
docker compose up -d

echo "==> Status"
docker compose ps

echo "Deploy complete."
