#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "用法：$0 /绝对路径/备份目录" >&2
  exit 64
fi

cd "$(dirname "$0")/.."
backup_dir=$(cd "$1" && pwd)
[[ -s "$backup_dir/app.db" ]] || { echo "备份目录缺少非空 app.db" >&2; exit 65; }

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

restore_from() {
  source_dir=$1
  docker compose run --rm --no-deps -v "$source_dir:/restore:ro" app sh -c '
    rm -f /app/data/app.db /app/data/app.db-wal /app/data/app.db-shm
    cp -a /restore/app.db /app/data/app.db
    for suffix in -wal -shm; do
      if [ -f "/restore/app.db$suffix" ]; then
        cp -a "/restore/app.db$suffix" "/app/data/app.db$suffix"
      fi
    done
  '
}

validate_live_database() {
  docker compose run --rm --no-deps app node server/check-db.js /app/data/app.db
}

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/canvas-restore.XXXXXX")
candidate_dir="$work_dir/candidate"
rollback_dir="$work_dir/rollback"
mkdir "$candidate_dir" "$rollback_dir"
cp -a "$backup_dir/." "$candidate_dir/"
app_stopped=0
rollback_ready=0
replacement_started=0

on_failure() {
  status=$1
  trap - ERR INT TERM
  set +e
  rollback_ok=1
  if [[ $replacement_started -eq 1 && $rollback_ready -eq 1 ]]; then
    echo "恢复失败，正在自动回滚原数据库……" >&2
    docker compose stop app >/dev/null 2>&1
    restore_from "$rollback_dir" && validate_live_database
    rollback_ok=$?
    docker compose start app >/dev/null && wait_for_health
    if [[ $? -ne 0 ]]; then rollback_ok=1; fi
  elif [[ $app_stopped -eq 1 ]]; then
    docker compose start app >/dev/null && wait_for_health
    rollback_ok=$?
  fi
  if [[ $rollback_ok -eq 0 || $replacement_started -eq 0 ]]; then
    rm -rf -- "$work_dir"
  else
    echo "自动回滚未完成，回滚快照保留在：$rollback_dir" >&2
  fi
  exit "$status"
}
trap 'on_failure $?' ERR
trap 'on_failure 130' INT
trap 'on_failure 143' TERM

# 先确认候选是完整的本项目历史库，再在副本上迁移并严格校验。
docker compose run --rm --no-deps -v "$candidate_dir:/candidate:ro" app \
  node server/check-db.js --allow-legacy /candidate/app.db
docker compose run --rm --no-deps -v "$candidate_dir:/candidate" \
  -e DB_PATH=/candidate/app.db app node --input-type=module --eval \
  "const { db } = await import('./server/db.js'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close()"
docker compose run --rm --no-deps -v "$candidate_dir:/candidate:ro" app \
  node server/check-db.js /candidate/app.db

app_stopped=1
docker compose stop app
docker compose cp -a app:/app/data/. "$rollback_dir/"
docker compose run --rm --no-deps -v "$rollback_dir:/rollback:ro" app \
  node server/check-db.js /rollback/app.db
rollback_ready=1

replacement_started=1
restore_from "$candidate_dir"
validate_live_database
docker compose start app
app_stopped=0
wait_for_health
replacement_started=0

trap - ERR INT TERM
rm -rf -- "$work_dir"
echo "恢复完成并通过健康检查。"
