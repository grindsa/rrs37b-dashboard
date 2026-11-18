#!/usr/bin/env sh
set -eu

# Backup script for the rrs37b-dashboard stack.
# Includes .env + optional .env.noah + config/smarthome.yml + scripts,
# checksums, optional SCP upload, and retention.
# WhatsApp notification is sent via host venv python (same as proxy).

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_CMD="${COMPOSE_CMD:-docker compose --project-directory $PROJECT_DIR}"
APP_NAME="${APP_NAME:-rrs37b-dashboard}"
BACKUP_ROOT="${BACKUP_ROOT:-}"
TMP_ROOT="${TMP_ROOT:-}"
LOCAL_KEEP="${LOCAL_KEEP:-}"
REMOTE_KEEP="${REMOTE_KEEP:-}"
REMOTE_TARGET="${REMOTE_TARGET:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
SSH_KEY="${SSH_KEY:-}"
LOG_FILE="${LOG_FILE:-$PROJECT_DIR/logs/backup.rrs37b-dashboard.log}"

# WhatsApp notification settings
WA_NOTIFY_NUMBER="${WA_NOTIFY_NUMBER:-}"
WA_NOTIFY_SRV="${WA_NOTIFY_SRV:-}"
WA_NOTIFY_PORT="${WA_NOTIFY_PORT:-}"
WA_PYTHON_BIN="${WA_PYTHON_BIN:-/home/joern/.venv/bin/python}"

# Dashboard paths (secrets + live inventory; app code lives in git)
ENV_FILE_PATH="${ENV_FILE_PATH:-$PROJECT_DIR/.env}"
ENV_NOAH_PATH="${ENV_NOAH_PATH:-$PROJECT_DIR/.env.noah}"
SMARTHOME_YML_PATH="${SMARTHOME_YML_PATH:-$PROJECT_DIR/config/smarthome.yml}"
DASHBOARD_SCRIPTS_DIR="${DASHBOARD_SCRIPTS_DIR:-$PROJECT_DIR/scripts}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-rrs37b-dashboard}"

CHECK_CONFIG=0

now_utc="$(date -u +%Y%m%d-%H%M%S)"
run_id="${APP_NAME}-backup-${now_utc}"
work_dir="$TMP_ROOT/$run_id"
out_dir="$BACKUP_ROOT"
final_archive="$out_dir/${run_id}.tar.gz"

if [ "${1:-}" = "--check-config" ]; then
  CHECK_CONFIG=1
  shift
fi

if [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--check-config]" >&2
  exit 1
fi

log() {
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s %s\n' "$ts" "$*" | tee -a "$LOG_FILE"
}

# Parse one value from .env without executing the file.
read_env_value() {
  key="$1"
  file="$2"
  awk -v k="$key" '
    {
      line=$0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == "" || line ~ /^#/) next

      if (line ~ "^" k "[[:space:]]*=") {
        sub("^" k "[[:space:]]*=[[:space:]]*", "", line)
      } else if (line ~ "^" k "[[:space:]]*:") {
        sub("^" k "[[:space:]]*:[[:space:]]*", "", line)
      } else {
        next
      }

      gsub(/^["\047]|["\047]$/, "", line)
      print line
      exit
    }
  ' "$file"
}

notify_backup_result() {
  exit_code="$1"

  if [ -z "$WA_NOTIFY_NUMBER" ]; then
    return 0
  fi

  if [ -z "$WA_NOTIFY_SRV" ] || [ -z "$WA_NOTIFY_PORT" ]; then
    log "WARN: WA_NOTIFY_NUMBER set but WA_NOTIFY_SRV/WA_NOTIFY_PORT missing; skipping WA notification"
    return 0
  fi

  if [ ! -x "$WA_PYTHON_BIN" ]; then
    log "WARN: WA_PYTHON_BIN not executable: $WA_PYTHON_BIN"
    return 0
  fi

  result="successful"
  if [ "$exit_code" -ne 0 ]; then
    result="failed"
  fi

  wa_msg="$(date +%d.%m.%Y) rrs37b-dashboard backup ${result}. run_id:${run_id}"

  set +e
  wa_output="$({
    WA_MSG="$wa_msg" WA_DEST="$WA_NOTIFY_NUMBER" WA_HOST="$WA_NOTIFY_SRV" WA_PORT_VAL="$WA_NOTIFY_PORT" \
      "$WA_PYTHON_BIN" -c 'import os; from wa_hack_cli import simple_send; simple_send(os.environ["WA_HOST"], int(os.environ["WA_PORT_VAL"]), os.environ["WA_DEST"], os.environ["WA_MSG"])'
  } 2>&1)"
  wa_status=$?
  set -e

  if [ "$wa_status" -eq 0 ] && ! printf '%s' "$wa_output" | grep -Eqi 'unable to connect|connection error'; then
    log "WA notification sent to configured destination"
  else
    log "WARN: WA notification failed"
    if [ -n "$wa_output" ]; then
      log "WARN: WA notification output: $wa_output"
    fi
  fi
}

finalize() {
  exit_code="$1"
  if [ "$CHECK_CONFIG" -eq 0 ]; then
    notify_backup_result "$exit_code"
  fi
  rm -rf "$work_dir"
}
trap 'finalize $?' EXIT

cd "$PROJECT_DIR"

env_file="$ENV_FILE_PATH"
if [ ! -f "$env_file" ]; then
  log "ERROR: missing $env_file"
  exit 1
fi

if [ -z "${BACKUP_ROOT:-}" ]; then
  BACKUP_ROOT="$(read_env_value BACKUP_ROOT "$env_file")"
fi
if [ -z "${TMP_ROOT:-}" ]; then
  TMP_ROOT="$(read_env_value TMP_ROOT "$env_file")"
fi
if [ -z "${REMOTE_TARGET:-}" ]; then
  REMOTE_TARGET="$(read_env_value REMOTE_TARGET "$env_file")"
fi
if [ -z "${REMOTE_DIR:-}" ]; then
  REMOTE_DIR="$(read_env_value REMOTE_DIR "$env_file")"
fi
if [ -z "${SSH_KEY:-}" ]; then
  SSH_KEY="$(read_env_value SSH_KEY "$env_file")"
fi
if [ -z "${LOCAL_KEEP:-}" ]; then
  LOCAL_KEEP="$(read_env_value LOCAL_KEEP "$env_file")"
fi
if [ -z "${REMOTE_KEEP:-}" ]; then
  REMOTE_KEEP="$(read_env_value REMOTE_KEEP "$env_file")"
fi

if [ -z "${WA_ADMIN_NUMBER:-}" ]; then
  WA_ADMIN_NUMBER="$(read_env_value WA_ADMIN_NUMBER "$env_file")"
fi
if [ -z "${WA_SRV:-}" ]; then
  WA_SRV="$(read_env_value WA_SRV "$env_file")"
fi
if [ -z "${WA_PORT:-}" ]; then
  WA_PORT="$(read_env_value WA_PORT "$env_file")"
fi
if [ -z "${WA_NOTIFY_NUMBER:-}" ]; then
  WA_NOTIFY_NUMBER="$(read_env_value WA_NOTIFY_NUMBER "$env_file")"
fi
if [ -z "${WA_NOTIFY_SRV:-}" ]; then
  WA_NOTIFY_SRV="$(read_env_value WA_NOTIFY_SRV "$env_file")"
fi
if [ -z "${WA_NOTIFY_PORT:-}" ]; then
  WA_NOTIFY_PORT="$(read_env_value WA_NOTIFY_PORT "$env_file")"
fi
if [ -z "${WA_PYTHON_BIN:-}" ]; then
  WA_PYTHON_BIN="$(read_env_value WA_PYTHON_BIN "$env_file")"
fi
if [ -z "${SMARTHOME_YML_PATH:-}" ] || [ "$SMARTHOME_YML_PATH" = "$PROJECT_DIR/config/smarthome.yml" ]; then
  smarthome_from_env="$(read_env_value SMARTHOME_YML_PATH "$env_file")"
  if [ -n "$smarthome_from_env" ]; then
    SMARTHOME_YML_PATH="$smarthome_from_env"
  fi
fi
if [ -z "${DASHBOARD_SCRIPTS_DIR:-}" ] || [ "$DASHBOARD_SCRIPTS_DIR" = "$PROJECT_DIR/scripts" ]; then
  scripts_from_env="$(read_env_value DASHBOARD_SCRIPTS_DIR "$env_file")"
  if [ -n "$scripts_from_env" ]; then
    DASHBOARD_SCRIPTS_DIR="$scripts_from_env"
  fi
fi

LOCAL_KEEP="${LOCAL_KEEP:-3}"
REMOTE_KEEP="${REMOTE_KEEP:-12}"
BACKUP_ROOT="${BACKUP_ROOT:-${TMPDIR:-/tmp}/rrs37b-dashboard-backups}"
TMP_ROOT="${TMP_ROOT:-${TMPDIR:-/tmp}}"
REMOTE_DIR="${REMOTE_DIR:-/public/Backups/web-srv/rrs37b-dashboard}"
WA_NOTIFY_NUMBER="${WA_NOTIFY_NUMBER:-${WA_ADMIN_NUMBER:-}}"
WA_NOTIFY_SRV="${WA_NOTIFY_SRV:-${WA_SRV:-}}"
WA_NOTIFY_PORT="${WA_NOTIFY_PORT:-${WA_PORT:-}}"

out_dir="$BACKUP_ROOT"
work_dir="$TMP_ROOT/$run_id"
final_archive="$out_dir/${run_id}.tar.gz"

REMOTE_DIR_NORM="${REMOTE_DIR%/}"
if [ -z "$REMOTE_DIR_NORM" ]; then
  REMOTE_DIR_NORM="/"
fi

ssh_opts=""
if [ -n "$SSH_KEY" ]; then
  if [ ! -f "$SSH_KEY" ]; then
    log "ERROR: SSH_KEY file not found: $SSH_KEY"
    exit 1
  fi
  ssh_opts="-i $SSH_KEY"
fi

has_env_noah=0
if [ -f "$ENV_NOAH_PATH" ]; then
  has_env_noah=1
fi

if [ "$CHECK_CONFIG" -eq 1 ]; then
  if $COMPOSE_CMD ps -q "$COMPOSE_SERVICE" >/dev/null 2>&1; then
    dashboard_service_status="ok"
  else
    dashboard_service_status="not-found-or-unreachable"
  fi

  if [ -n "$REMOTE_TARGET" ]; then
    remote_upload="enabled"
  else
    remote_upload="disabled"
  fi

  if [ -n "$WA_NOTIFY_NUMBER" ]; then
    wa_notify="enabled"
  else
    wa_notify="disabled"
  fi

  if [ "$has_env_noah" -eq 1 ]; then
    env_noah_status="present"
  else
    env_noah_status="absent"
  fi

  echo "backup config check"
  echo "project_dir=$PROJECT_DIR"
  echo "compose_cmd=$COMPOSE_CMD"
  echo "env_file=$env_file"
  echo "env_noah=$ENV_NOAH_PATH ($env_noah_status)"
  echo "app_name=$APP_NAME"
  echo "backup_root=$BACKUP_ROOT"
  echo "tmp_root=$TMP_ROOT"
  echo "local_keep=$LOCAL_KEEP"
  echo "remote_keep=$REMOTE_KEEP"
  echo "remote_target=${REMOTE_TARGET:-<empty>}"
  echo "remote_dir=$REMOTE_DIR_NORM"
  echo "ssh_key=${SSH_KEY:-<empty>}"
  echo "smarthome_yml_path=$SMARTHOME_YML_PATH"
  echo "dashboard_scripts_dir=$DASHBOARD_SCRIPTS_DIR"
  echo "compose_service=$COMPOSE_SERVICE"
  echo "wa_python_bin=$WA_PYTHON_BIN"
  echo "wa_notify_number=${WA_NOTIFY_NUMBER:-<empty>}"
  echo "wa_notify_srv=${WA_NOTIFY_SRV:-<empty>}"
  echo "wa_notify_port=${WA_NOTIFY_PORT:-<empty>}"
  echo "remote_upload=$remote_upload"
  echo "wa_notification=$wa_notify"
  echo "dashboard_service_status=$dashboard_service_status"
  echo "result=ok"
  exit 0
fi

if ! $COMPOSE_CMD ps -q "$COMPOSE_SERVICE" >/dev/null 2>&1; then
  log "ERROR: compose service '$COMPOSE_SERVICE' not found"
  exit 1
fi

if [ ! -f "$SMARTHOME_YML_PATH" ]; then
  log "ERROR: smarthome config missing: $SMARTHOME_YML_PATH"
  exit 1
fi
if [ ! -d "$DASHBOARD_SCRIPTS_DIR" ]; then
  log "ERROR: dashboard scripts dir missing: $DASHBOARD_SCRIPTS_DIR"
  exit 1
fi

mkdir -p "$out_dir" "$(dirname "$LOG_FILE")" "$work_dir"

dashboard_scripts_tar="$work_dir/dashboard_scripts.tar.gz"
meta_txt="$work_dir/meta.txt"

log "Starting backup run $run_id"

log "Copying .env"
cp "$env_file" "$work_dir/.env"

if [ "$has_env_noah" -eq 1 ]; then
  log "Copying .env.noah"
  cp "$ENV_NOAH_PATH" "$work_dir/.env.noah"
else
  log "No .env.noah present; skipping"
fi

log "Copying smarthome.yml"
cp "$SMARTHOME_YML_PATH" "$work_dir/smarthome.yml"

log "Packing dashboard scripts"
tar -czf "$dashboard_scripts_tar" -C "$DASHBOARD_SCRIPTS_DIR" .

cat > "$meta_txt" <<EOF
run_id=$run_id
timestamp_utc=$now_utc
project_dir=$PROJECT_DIR
compose_cmd=$COMPOSE_CMD
compose_service=$COMPOSE_SERVICE
env_file=$env_file
env_noah_path=$ENV_NOAH_PATH
env_noah_included=$has_env_noah
smarthome_yml_path=$SMARTHOME_YML_PATH
dashboard_scripts_dir=$DASHBOARD_SCRIPTS_DIR
EOF

archive_members=".env smarthome.yml dashboard_scripts.tar.gz meta.txt"
if [ "$has_env_noah" -eq 1 ]; then
  archive_members=".env .env.noah smarthome.yml dashboard_scripts.tar.gz meta.txt"
fi

log "Writing checksum manifest"
(
  cd "$work_dir"
  # shellcheck disable=SC2086
  sha256sum $archive_members > manifest.sha256
)

log "Creating final archive $final_archive"
# shellcheck disable=SC2086
tar -czf "$final_archive" -C "$work_dir" $archive_members manifest.sha256

log "Pruning local backups (keep=$LOCAL_KEEP)"
ls -1dt "$out_dir"/${APP_NAME}-backup-*.tar.gz 2>/dev/null | awk "NR>$LOCAL_KEEP" | xargs -r rm -f

if [ -n "$REMOTE_TARGET" ]; then
  remote_dir_use="$REMOTE_DIR_NORM"
  remote_file="$remote_dir_use/$(basename "$final_archive")"
  log "Backup server: $REMOTE_TARGET"
  log "Remote backup directory: $remote_dir_use"
  log "Uploading backup to $remote_file"
  # shellcheck disable=SC2086
  scp $ssh_opts "$final_archive" "$REMOTE_TARGET:$remote_file"

  log "Pruning remote backups (keep=$REMOTE_KEEP)"
  # shellcheck disable=SC2086
  ssh $ssh_opts "$REMOTE_TARGET" "ls -1dt '$remote_dir_use'/${APP_NAME}-backup-*.tar.gz 2>/dev/null | awk 'NR>$REMOTE_KEEP' | xargs -r rm -f"
else
  log "REMOTE_TARGET not set; skipping remote upload"
fi

log "Backup complete: $final_archive"
