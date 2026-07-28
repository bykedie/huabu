#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

cd "$(dirname "$0")/.."

wait_for_health() {
  for _ in {1..60}; do
    if curl -fsS http://127.0.0.1:3100/api/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

backup_root=${1:-"$PWD/backups"}
mkdir -p "$backup_root"
backup_root=$(cd "$backup_root" && pwd)
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
