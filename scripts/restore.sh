#!/usr/bin/env sh
set -eu

# Restore utility for archives created by scripts/backup.rrs37b-dashboard.sh.
# Restores .env + optional .env.noah + config/smarthome.yml + scripts and
# restarts the dashboard (and noah profile sidecars when .env.noah is present).

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose --project-directory $PROJECT_DIR}"
TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}}"
RESTORE_CONFIRM="${RESTORE_CONFIRM:-no}"

ENV_FILE_PATH="${ENV_FILE_PATH:-$PROJECT_DIR/.env}"
ENV_NOAH_PATH="${ENV_NOAH_PATH:-$PROJECT_DIR/.env.noah}"
SMARTHOME_YML_PATH="${SMARTHOME_YML_PATH:-$PROJECT_DIR/config/smarthome.yml}"
DASHBOARD_SCRIPTS_DIR="${DASHBOARD_SCRIPTS_DIR:-$PROJECT_DIR/scripts}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-rrs37b-dashboard}"

usage() {
  echo "Usage: $0 /path/to/rrs37b-dashboard-backup-YYYYmmdd-HHMMSS.tar.gz"
  echo "Set RESTORE_CONFIRM=yes to run a destructive restore."
}

if [ "${1:-}" = "" ]; then
  usage
  exit 1
fi

archive_path="$1"

if [ ! -f "$archive_path" ]; then
  echo "ERROR: archive not found: $archive_path" >&2
  exit 1
fi

if [ "$RESTORE_CONFIRM" != "yes" ]; then
  echo "ERROR: restore is destructive. Re-run with RESTORE_CONFIRM=yes" >&2
  exit 1
fi

work_dir="$TMP_ROOT/restore-rrs37b-dashboard-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$work_dir"
trap 'rm -rf "$work_dir"' EXIT INT TERM

cd "$PROJECT_DIR"

echo "Extracting archive to $work_dir"
tar -xzf "$archive_path" -C "$work_dir"

for required in .env smarthome.yml dashboard_scripts.tar.gz manifest.sha256; do
  if [ ! -f "$work_dir/$required" ]; then
    echo "ERROR: missing $required in backup archive" >&2
    exit 1
  fi
done

echo "Validating checksum manifest"
(
  cd "$work_dir"
  sha256sum -c manifest.sha256
)

echo "Stopping $COMPOSE_SERVICE"
$COMPOSE_CMD stop "$COMPOSE_SERVICE" || true
# Sidecars may not exist when the noah profile was never enabled.
$COMPOSE_CMD stop mosquitto noah-mqtt >/dev/null 2>&1 || true

echo "Restoring .env"
mkdir -p "$(dirname "$ENV_FILE_PATH")"
cp "$work_dir/.env" "$ENV_FILE_PATH"
chmod 600 "$ENV_FILE_PATH" 2>/dev/null || true

if [ -f "$work_dir/.env.noah" ]; then
  echo "Restoring .env.noah"
  cp "$work_dir/.env.noah" "$ENV_NOAH_PATH"
  chmod 600 "$ENV_NOAH_PATH" 2>/dev/null || true
else
  echo "No .env.noah in archive; leaving existing file untouched (if any)"
fi

echo "Restoring smarthome.yml"
mkdir -p "$(dirname "$SMARTHOME_YML_PATH")"
cp "$work_dir/smarthome.yml" "$SMARTHOME_YML_PATH"
# Prefer deploy-compatible perms (container user node = uid 1000).
if chown "$(id -u)":1000 "$SMARTHOME_YML_PATH" 2>/dev/null; then
  chmod 640 "$SMARTHOME_YML_PATH"
else
  chmod 644 "$SMARTHOME_YML_PATH"
fi

echo "Restoring dashboard scripts"
mkdir -p "$DASHBOARD_SCRIPTS_DIR"
rm -rf "$DASHBOARD_SCRIPTS_DIR"/*
tar -xzf "$work_dir/dashboard_scripts.tar.gz" -C "$DASHBOARD_SCRIPTS_DIR"
chmod +x "$DASHBOARD_SCRIPTS_DIR"/*.sh 2>/dev/null || true

# Same helper as deploy.sh: last KEY= value, strip quotes / trailing comments.
env_value() {
  file="$1"
  key="$2"
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -n1 || true)"
  line="${line#*=}"
  line="$(printf '%s' "$line" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//; s/\r$//')"
  line="${line#\"}"; line="${line%\"}"
  line="${line#\'}"; line="${line%\'}"
  printf '%s' "$line"
}

enable_noah=0
if [ -f "$ENV_NOAH_PATH" ] && grep -qE '^[[:space:]]*GROWATT_USERNAME=[^[:space:]#]+' "$ENV_NOAH_PATH"; then
  enable_noah=1
fi

if [ "$enable_noah" -eq 1 ]; then
  NOAH_MQTT_PW="$(env_value "$ENV_NOAH_PATH" MQTT_PASSWORD)"
  DASHBOARD_MQTT_PW="$(env_value "$ENV_FILE_PATH" NOAH_MQTT_PASSWORD)"
  if [ -z "$NOAH_MQTT_PW" ] || [ -z "$DASHBOARD_MQTT_PW" ]; then
    echo "ERROR: profile noah needs MQTT_PASSWORD in .env.noah and NOAH_MQTT_PASSWORD in .env" >&2
    exit 1
  fi
  echo "Writing .env.mosquitto for broker accounts"
  (
    umask 077
    printf 'MOSQUITTO_NOAH_PASSWORD=%s\nMOSQUITTO_DASHBOARD_PASSWORD=%s\n' \
      "$NOAH_MQTT_PW" "$DASHBOARD_MQTT_PW" > "$PROJECT_DIR/.env.mosquitto.tmp"
    mv "$PROJECT_DIR/.env.mosquitto.tmp" "$PROJECT_DIR/.env.mosquitto"
  )
  unset NOAH_MQTT_PW DASHBOARD_MQTT_PW

  echo "Starting stack with Compose profile noah"
  COMPOSE_PROFILES=noah $COMPOSE_CMD up -d
else
  echo "Starting $COMPOSE_SERVICE"
  $COMPOSE_CMD up -d "$COMPOSE_SERVICE"
fi

echo "Restore completed successfully."
echo "Note: this restarts containers with the current image; run ./deploy.sh if you also need a rebuild."
