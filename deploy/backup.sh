#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

cd "$(dirname "$0")/.."
project_root=$(pwd -P)

read_public_port() {
  local value=3102
  if [[ -f .env ]]; then
    value=$(sed -n 's/^PUBLIC_PORT=//p' .env | tail -n 1)
    value=${value%$'\r'}
    [[ -n $value ]] || value=3102
  fi
  if [[ ! $value =~ ^[0-9]+$ || ${#value} -gt 5 ]] \
    || (( 10#$value < 1 || 10#$value > 65535 )); then
    echo "PUBLIC_PORT 必须是 1-65535 的整数。" >&2
    return 78
  fi
  printf '%s' "$((10#$value))"
}

public_port=$(read_public_port)

wait_for_health() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:${public_port}/api/health" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

validate_database_files() {
  local directory=$1 sidecar
  [[ -f "$directory/app.db" && ! -L "$directory/app.db" && -s "$directory/app.db" ]] \
    || { echo "备份副本缺少非空且非符号链接的普通 app.db。" >&2; return 65; }
  for sidecar in app.db-wal app.db-shm; do
    [[ ! -e "$directory/$sidecar" || (! -L "$directory/$sidecar" && -f "$directory/$sidecar") ]] \
      || { echo "备份副本中的 $sidecar 必须是普通文件且不能是符号链接。" >&2; return 65; }
  done
}

requested_root=${1:-/srv/canvas-backups}
if [[ $requested_root != /* ]]; then
  echo "备份根目录必须是项目目录外的绝对路径。" >&2
  exit 64
fi
if ! backup_root=$(realpath -m -- "$requested_root" 2>/dev/null); then
  echo "无法解析备份根目录。" >&2
  exit 64
fi
case "$backup_root" in
  "$project_root"|"$project_root"/*)
    echo "备份根目录必须位于项目目录之外。" >&2
    exit 64
    ;;
esac
if ! mkdir -p -- "$backup_root" 2>/dev/null; then
  echo "无法创建备份根目录，请检查路径和权限。" >&2
  exit 73
fi
backup_root=$(cd "$backup_root" && pwd -P)
case "$backup_root" in
  "$project_root"|"$project_root"/*)
    echo "备份根目录解析后位于项目目录内。" >&2
    exit 64
    ;;
esac
backup_dir="$backup_root/canvas-$(date +%Y%m%d-%H%M%S)-$$"
mkdir "$backup_dir"
app_stopped=0
backup_valid=0

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  if [[ $app_stopped -eq 1 ]]; then
    docker compose start app >/dev/null && wait_for_health
    if [[ $? -ne 0 ]]; then
      echo "应用未能在备份后恢复健康，请立即检查。" >&2
      status=1
    fi
  fi
  if [[ $status -ne 0 && $backup_valid -eq 0 ]]; then
    rm -rf -- "$backup_dir"
  elif [[ $status -ne 0 ]]; then
    echo "应用恢复失败，但已校验的备份保留在：$backup_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

app_stopped=1
docker compose stop app
docker compose cp -a app:/app/data/. "$backup_dir/"
validate_database_files "$backup_dir"
docker compose run --rm --no-deps -v "$backup_dir:/backup:ro" app \
  node server/check-db.js /backup/app.db
backup_valid=1
docker compose start app
wait_for_health
app_stopped=0

trap - EXIT INT TERM
echo "备份完成：$backup_dir"
