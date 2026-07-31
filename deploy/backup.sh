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
backup_dir="$backup_root/canvas-$(date +%Y%m%d-%H%M%S)-$$"
mkdir "$backup_dir"
app_stopped=0

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
  if [[ $status -ne 0 ]]; then
    rm -rf -- "$backup_dir"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

app_stopped=1
docker compose stop app
docker compose cp -a app:/app/data/. "$backup_dir/"
docker compose run --rm --no-deps -v "$backup_dir:/backup:ro" app \
  node server/check-db.js /backup/app.db
docker compose start app
wait_for_health
app_stopped=0

trap - EXIT INT TERM
echo "备份完成：$backup_dir"
