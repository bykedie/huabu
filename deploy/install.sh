#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_url=${MOYU_REPO_URL:-https://github.com/bykedie/huabu.git}
branch=${MOYU_BRANCH:-codex/infinite-canvas}
install_dir=${MOYU_INSTALL_DIR:-/opt/moyu-canvas}
backup_root=${MOYU_BACKUP_ROOT:-/srv/canvas-backups}
domain=
email=
enable_tls=1
domain_explicit=0
preserve_domain_config=0
public_port=3102
public_bind=0.0.0.0
access_mode=public
port_explicit=0
bind_explicit=0
backup_explicit=0

usage() {
  cat <<'EOF'
用法：
  sudo bash deploy/install.sh
  sudo bash deploy/install.sh --port 8080 --bind 0.0.0.0
  sudo bash deploy/install.sh --domain canvas.example.com --email admin@example.com

选项：
  --port PORT            公网宿主端口（1-65535），默认 3102
  --bind ADDRESS         监听地址，只允许 0.0.0.0 或 127.0.0.1，默认 0.0.0.0
  --domain DOMAIN        可选站点域名；只有提供此项才安装和配置 Nginx
  --email EMAIL          可选的 Let's Encrypt 通知邮箱；留空时无邮箱注册证书
  --no-tls               域名模式只配置 HTTP；不提供 --domain 时始终为 HTTP
  --repo-url URL         Git 仓库，默认 https://github.com/bykedie/huabu.git
  --branch BRANCH        部署分支，默认 codex/infinite-canvas
  --install-dir PATH     安装目录，默认 /opt/moyu-canvas
  --backup-dir PATH      仓库外备份根目录，默认 /srv/canvas-backups
  -h, --help             显示帮助

同名 MOYU_REPO_URL、MOYU_BRANCH、MOYU_INSTALL_DIR、MOYU_BACKUP_ROOT
环境变量可覆盖对应默认值。已有 .env、秘密和 Docker 数据卷不会被覆盖。
重跑时未显式提供 --port 或 --bind 会保留已有 .env 中的值。
EOF
}

die() {
  echo "部署失败：$*" >&2
  exit 1
}

require_value() {
  [[ $# -ge 2 && -n $2 ]] || die "$1 缺少参数"
}

validate_port() {
  local value=$1
  valid_port "$value" || die "--port 必须是 1-65535 的整数"
}

valid_port() {
  local value=$1
  [[ $value =~ ^[0-9]+$ && ${#value} -le 5 ]] || return 1
  (( 10#$value >= 1 && 10#$value <= 65535 ))
}

validate_domain() {
  local value=$1 label
  [[ ${#value} -le 253 ]] || die "域名格式无效"
  [[ $value != .* && $value != *. && $value != *..* ]] || die "域名格式无效"
  [[ $value == *.* && ! $value =~ ^[0-9.]+$ ]] || die "必须提供可用于公网证书的完整域名"
  IFS=. read -r -a labels <<< "$value"
  for label in "${labels[@]}"; do
    [[ $label =~ ^[A-Za-z0-9]$|^[A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]$ ]] || die "域名格式无效"
  done
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      require_value "$1" "${2:-}"
      public_port=$2
      port_explicit=1
      shift 2
      ;;
    --bind)
      require_value "$1" "${2:-}"
      public_bind=$2
      bind_explicit=1
      shift 2
      ;;
    --domain)
      require_value "$1" "${2:-}"
      domain=$2
      domain_explicit=1
      shift 2
      ;;
    --email)
      require_value "$1" "${2:-}"
      email=$2
      shift 2
      ;;
    --no-tls)
      enable_tls=0
      shift
      ;;
    --repo-url)
      require_value "$1" "${2:-}"
      repo_url=$2
      shift 2
      ;;
    --branch)
      require_value "$1" "${2:-}"
      branch=$2
      shift 2
      ;;
    --install-dir)
      require_value "$1" "${2:-}"
      install_dir=$2
      shift 2
      ;;
    --backup-dir)
      require_value "$1" "${2:-}"
      backup_root=$2
      backup_explicit=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "请使用 sudo 或 root 运行"
if [[ -n $domain ]]; then
  access_mode=domain
  if [[ $bind_explicit -eq 0 ]]; then public_bind=127.0.0.1; fi
  [[ $public_bind == 127.0.0.1 ]] || die "--domain 表示仅域名访问，必须使用 --bind 127.0.0.1；并存模式请在部署后通过 sudo h 选择"
elif [[ $bind_explicit -eq 1 && $public_bind == 127.0.0.1 ]]; then
  access_mode=private
fi
[[ $public_bind == 0.0.0.0 || $public_bind == 127.0.0.1 ]] || die "--bind 只能是 0.0.0.0 或 127.0.0.1"
validate_port "$public_port"
if [[ -n $domain ]]; then
  validate_domain "$domain"
  if [[ $enable_tls -eq 1 ]]; then
    [[ -z $email || $email =~ ^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$ ]] || die "--email 格式无效"
  fi
else
  [[ -z $email ]] || die "--email 只能与 --domain 一起使用"
  enable_tls=0
fi
[[ $repo_url != *[[:space:]]* && -n $repo_url ]] || die "Git 仓库地址无效"
[[ $branch != -* && $branch != *[[:space:]]* && -n $branch ]] || die "部署分支无效"
[[ $install_dir == /* ]] || die "安装目录必须是绝对路径"
[[ $backup_root == /* ]] || die "备份目录必须是绝对路径"

install_dir=$(realpath -m -- "$install_dir")
backup_root=$(realpath -m -- "$backup_root")
case $backup_root in
  "$install_dir"|"$install_dir"/*) die "备份目录必须位于安装目录之外" ;;
esac

h_path=/usr/local/bin/h
expected_manage_target=$(realpath -m -- "$install_dir/deploy/manage.sh")
check_h_path() {
  local raw_target resolved_target
  [[ -e $h_path || -L $h_path ]] || return 0
  [[ -L $h_path ]] || die "$h_path 已存在且不是本项目链接，拒绝覆盖"
  raw_target=$(readlink -- "$h_path") || die "无法读取现有 $h_path"
  if [[ $raw_target != /* ]]; then raw_target=$(dirname "$h_path")/$raw_target; fi
  resolved_target=$(realpath -m -- "$raw_target")
  [[ $resolved_target == "$expected_manage_target" ]] || die "$h_path 已存在且不是本项目链接，拒绝覆盖"
}
check_h_path

[[ -r /etc/os-release ]] || die "无法识别操作系统"
command -v systemctl >/dev/null 2>&1 || die "当前脚本要求使用 systemd 的服务器环境"
[[ -d /run/systemd/system ]] || die "当前系统没有运行 systemd"
# shellcheck disable=SC1091
. /etc/os-release
case ${ID:-} in
  ubuntu|debian) ;;
  *) die "当前一键脚本仅支持 Ubuntu 或 Debian" ;;
esac
codename=${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}
[[ -n $codename ]] || die "无法识别系统发行版代号"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt_packages=(ca-certificates curl git openssl)
if [[ -n $domain ]]; then
  apt_packages+=(nginx)
  [[ $enable_tls -eq 0 ]] || apt_packages+=(certbot python3-certbot-nginx)
fi
apt-get install -y "${apt_packages[@]}"

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || die "已安装 Docker，但缺少 Compose v2；请先安装 docker-compose-plugin"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $codename stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

mkdir -p -- "$(dirname "$install_dir")"
if [[ -e $install_dir && ! -d $install_dir/.git ]]; then
  die "安装目录已存在但不是 Git 仓库：$install_dir"
fi

read_env_value() {
  local file=$1 key=$2
  [[ -f $file ]] || return 0
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1 | tr -d "\r"
}

current_port=3102
old_domain=
old_tls=0
old_mode=
old_bind=0.0.0.0
if [[ -f $install_dir/.env ]]; then
  old_port=$(read_env_value "$install_dir/.env" PUBLIC_PORT)
  if valid_port "$old_port"; then
    current_port=$((10#$old_port))
  fi
  if [[ $backup_explicit -eq 0 ]]; then
    old_backup_root=$(read_env_value "$install_dir/.env" MOYU_BACKUP_ROOT)
    if [[ -n $old_backup_root ]]; then
      [[ $old_backup_root == /* ]] || die "已有 MOYU_BACKUP_ROOT 必须是绝对路径"
      backup_root=$(realpath -m -- "$old_backup_root")
      case $backup_root in
        "$install_dir"|"$install_dir"/*) die "备份目录必须位于安装目录之外" ;;
      esac
    fi
  fi
  old_domain=$(read_env_value "$install_dir/.env" MOYU_DOMAIN)
  [[ -n $old_domain ]] || old_domain=$(read_env_value "$install_dir/.env" PUBLIC_DOMAIN)
  old_bind=$(read_env_value "$install_dir/.env" PUBLIC_BIND)
  [[ $old_bind == 127.0.0.1 ]] || old_bind=0.0.0.0
  old_mode=$(read_env_value "$install_dir/.env" MOYU_ACCESS_MODE)
  case $old_mode in public|domain|both|private) ;;
    *)
      if [[ -n $old_domain && $old_bind == 127.0.0.1 ]]; then old_mode=domain
      elif [[ -n $old_domain ]]; then old_mode=both
      elif [[ $old_bind == 127.0.0.1 ]]; then old_mode=private
      else old_mode=public
      fi
      ;;
  esac
  old_tls=$(read_env_value "$install_dir/.env" MOYU_TLS)
  [[ $old_tls == 1 ]] || old_tls=0
  if [[ $domain_explicit -eq 0 ]]; then
    if [[ $bind_explicit -eq 1 ]]; then
      if [[ -n $old_domain && $public_bind == 0.0.0.0 ]]; then access_mode=both
      elif [[ -n $old_domain ]]; then access_mode=domain
      elif [[ $public_bind == 127.0.0.1 ]]; then access_mode=private
      else access_mode=public
      fi
    else
      access_mode=$old_mode
    fi
    if [[ $access_mode == domain || $access_mode == both ]]; then
      [[ -n $old_domain ]] || die "已有访问模式需要域名，但 .env 未配置 MOYU_DOMAIN"
      validate_domain "$old_domain"
      domain=$old_domain
    fi
    if [[ $access_mode == public || $access_mode == both ]]; then public_bind=0.0.0.0; else public_bind=127.0.0.1; fi
    enable_tls=$old_tls
    if [[ $access_mode == domain || $access_mode == both ]]; then
      preserve_domain_config=1
      if ! command -v nginx >/dev/null 2>&1; then apt-get install -y nginx; fi
    fi
  fi
fi

wait_for_health() {
  local port=$1
  for _ in {1..60}; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null; then
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

rollback_armed=0
rollback_existing=0
rollback_old_head=
rollback_env_backup=
rollback_env_existed=0
rollback_app_was_present=0
rollback_site_captured=0
rollback_site=
rollback_site_link=
rollback_site_backup=
rollback_site_existed=0
rollback_link_existed=0
rollback_link_target=
public_fallback_ready=0

restore_captured_nginx() {
  local failed=0
  [[ $rollback_site_captured -eq 1 ]] || return 0
  if [[ $rollback_site_existed -eq 1 ]]; then
    cp -a -- "$rollback_site_backup" "$rollback_site" || failed=1
  else
    rm -f -- "$rollback_site" || failed=1
  fi
  rm -f -- "$rollback_site_link" || failed=1
  if [[ $rollback_link_existed -eq 1 ]]; then ln -s -- "$rollback_link_target" "$rollback_site_link" || failed=1; fi
  return "$failed"
}

rollback_install() {
  local status=$? current_head rollback_ok=0 public_fallback_active=0 keep_recovery_files=0
  trap - EXIT INT TERM
  if [[ $status -ne 0 && $rollback_armed -eq 1 ]]; then
    set +e
    echo "部署未完成，正在恢复先前可用状态……" >&2
    restore_captured_nginx || rollback_ok=1
    if [[ $rollback_existing -eq 1 ]]; then
      if [[ $rollback_env_existed -eq 1 && -n $rollback_env_backup ]]; then
        cp -a -- "$rollback_env_backup" "$install_dir/.env" || rollback_ok=1
      else
        rm -f -- "$install_dir/.env" || rollback_ok=1
      fi
      current_head=$(git -C "$install_dir" rev-parse HEAD 2>/dev/null || true)
      if [[ -n $rollback_old_head && $current_head != "$rollback_old_head" ]]; then
        if ! git -C "$install_dir" update-ref "refs/heads/$branch" "$rollback_old_head" "$current_head" \
          || ! git -C "$install_dir" read-tree --reset -u "$rollback_old_head"; then
          rollback_ok=1
        fi
      fi
      [[ -z $(git -C "$install_dir" status --porcelain 2>/dev/null) ]] || rollback_ok=1
      if [[ $rollback_app_was_present -eq 1 ]]; then
        if ! (cd "$install_dir" && docker compose up -d --build) || ! wait_for_health "$current_port"; then rollback_ok=1; fi
      fi
    elif [[ $public_fallback_ready -eq 1 && -f $install_dir/.env ]]; then
      cd "$install_dir" || true
      set_env_value PUBLIC_BIND 0.0.0.0 || rollback_ok=1
      set_env_value MOYU_ACCESS_MODE public || rollback_ok=1
      set_env_value MOYU_DOMAIN '' || rollback_ok=1
      set_env_value PUBLIC_DOMAIN '' || rollback_ok=1
      set_env_value MOYU_TLS 0 || rollback_ok=1
      if ! docker compose up -d --build || ! wait_for_health "$public_port"; then
        rollback_ok=1
      else
        public_fallback_active=1
      fi
      if [[ $rollback_ok -eq 0 ]] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then
        ufw allow "${public_port}/tcp" comment 'Moyu Canvas public port' >/dev/null || true
      fi
    fi
    if [[ $rollback_site_captured -eq 1 ]] && command -v nginx >/dev/null 2>&1; then
      if ! nginx -t || ! systemctl reload nginx; then rollback_ok=1; fi
    fi
    if [[ $rollback_ok -eq 0 ]]; then
      if [[ $public_fallback_active -eq 1 ]]; then
        echo "域名或 HTTPS 配置失败，应用已回退到 http://<公网IPv4>:${public_port}/。" >&2
        echo "警告：该回退地址使用未加密 HTTP，在配置 HTTPS 前不要传输登录密码或 API 密钥。" >&2
      else
        echo "先前应用配置已恢复。" >&2
      fi
    else
      keep_recovery_files=1
      echo "自动恢复未能确认健康，请使用已校验备份和服务器日志人工恢复。" >&2
      [[ -z $rollback_env_backup ]] || echo "受限权限的环境快照保留在：$rollback_env_backup" >&2
      [[ -z $rollback_site_backup ]] || echo "受限权限的 Nginx 站点快照保留在：$rollback_site_backup" >&2
    fi
  fi
  if [[ $keep_recovery_files -eq 0 ]]; then
    [[ -z $rollback_env_backup ]] || rm -f -- "$rollback_env_backup"
    [[ -z $rollback_site_backup ]] || rm -f -- "$rollback_site_backup"
  fi
  exit "$status"
}
trap rollback_install EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

backup_deployment() {
  local backup_dir=$backup_root/canvas-$(date +%Y%m%d-%H%M%S)-$$
  local backup_valid=0
  mkdir -p -- "$backup_root"
  backup_root=$(cd -- "$backup_root" && pwd -P)
  case $backup_root in
    "$install_dir"|"$install_dir"/*) echo "备份目录解析后位于安装目录内。" >&2; return 1 ;;
  esac
  backup_dir=$backup_root/canvas-$(date +%Y%m%d-%H%M%S)-$$
  mkdir -- "$backup_dir"
  if ! docker compose stop app; then
    rm -rf -- "$backup_dir"
    return 1
  fi
  if ! docker compose cp -a app:/app/data/. "$backup_dir/"; then
    docker compose start app >/dev/null 2>&1 || true
    wait_for_health "$current_port" || true
    rm -rf -- "$backup_dir"
    return 1
  fi
  if ! validate_database_files "$backup_dir"; then
    docker compose start app >/dev/null 2>&1 || true
    wait_for_health "$current_port" || true
    rm -rf -- "$backup_dir"
    return 1
  fi
  if ! docker compose run --rm -T --no-deps --user 0:0 -v "$backup_dir:/backup:ro" app node server/check-db.js /backup/app.db; then
    docker compose start app >/dev/null 2>&1 || true
    wait_for_health "$current_port" || true
    rm -rf -- "$backup_dir"
    return 1
  fi
  backup_valid=1
  docker compose start app >/dev/null
  if ! wait_for_health "$current_port"; then
    [[ $backup_valid -eq 0 ]] && rm -rf -- "$backup_dir"
    echo "应用恢复失败，但已校验的备份保留在：$backup_dir" >&2
    return 1
  fi
  echo "更新前备份完成：$backup_dir"
}

git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "部署分支格式无效"
if [[ -d $install_dir/.git ]]; then
  rollback_existing=1
  existing_remote=$(git -C "$install_dir" remote get-url origin)
  [[ $existing_remote == "$repo_url" ]] || die "现有仓库 origin 与目标仓库不一致"
  current_branch=$(git -C "$install_dir" branch --show-current)
  [[ $current_branch == "$branch" ]] || die "现有部署分支与目标分支不一致"
  [[ -z $(git -C "$install_dir" status --porcelain) ]] || die "现有部署仓库存在未提交修改，请先人工处理"
  rollback_old_head=$(git -C "$install_dir" rev-parse HEAD)
  if [[ -f $install_dir/.env ]]; then
    rollback_env_backup=$(mktemp)
    cp -a -- "$install_dir/.env" "$rollback_env_backup"
    chmod 600 "$rollback_env_backup"
    rollback_env_existed=1
  fi
  if [[ -n $(cd "$install_dir" && docker compose ps -a -q app 2>/dev/null) ]]; then rollback_app_was_present=1; fi
  git -C "$install_dir" fetch --prune origin "$branch"
  git -C "$install_dir" merge-base --is-ancestor HEAD FETCH_HEAD || die "远程更新不是快进提交，已拒绝覆盖"
  if [[ $(git -C "$install_dir" rev-parse HEAD) != $(git -C "$install_dir" rev-parse FETCH_HEAD) ]]; then
    if [[ $rollback_app_was_present -eq 1 ]]; then
      (cd "$install_dir" && backup_deployment) || die "更新前备份失败，已停止更新"
    fi
    rollback_armed=1
    git -C "$install_dir" merge --ff-only FETCH_HEAD
  fi
else
  git clone --branch "$branch" --single-branch -- "$repo_url" "$install_dir"
fi

cd "$install_dir"
chmod +x deploy/install.sh deploy/backup.sh deploy/restore.sh
[[ -f deploy/manage.sh ]] || die "缺少 deploy/manage.sh，无法安装 h 管理命令"
chmod +x deploy/manage.sh

set_env_value() {
  local key=$1 value=$2 env_tmp
  [[ $value != *$'\n'* && $value != *$'\r'* ]] || die "配置值不能包含换行：$key"
  env_tmp=$(mktemp .env.tmp.XXXXXX)
  chmod 600 "$env_tmp"
  local line prefix found=0
  prefix="$key="
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line == "$prefix"* ]]; then
      printf '%s\n' "$prefix$value" >> "$env_tmp"
      found=1
    else
      printf '%s\n' "$line" >> "$env_tmp"
    fi
  done < .env
  if (( ! found )); then printf '%s\n' "$prefix$value" >> "$env_tmp"; fi
  mv -f -- "$env_tmp" .env
}

created_env=0
if [[ ! -f .env ]]; then
  cp -- .env.example .env
  set_env_value JWT_SECRET "$(openssl rand -hex 32)"
  set_env_value ADMIN_SETUP_TOKEN "$(openssl rand -hex 32)"
  created_env=1
fi
chmod 600 .env
if [[ $rollback_existing -eq 1 ]]; then rollback_armed=1; fi

if [[ $port_explicit -eq 0 ]]; then
  old_port=$(read_env_value .env PUBLIC_PORT)
  if valid_port "$old_port"; then
    public_port=$((10#$old_port))
  fi
fi
if [[ $bind_explicit -eq 0 && $domain_explicit -eq 0 && -z $old_mode ]]; then
  old_bind=$(read_env_value .env PUBLIC_BIND)
  if [[ $old_bind == 0.0.0.0 || $old_bind == 127.0.0.1 ]]; then
    public_bind=$old_bind
  fi
fi
if [[ $domain_explicit -eq 1 ]]; then public_bind=127.0.0.1; access_mode=domain; fi
validate_port "$public_port"
if [[ -n $domain && ($public_port -eq 80 || $public_port -eq 443) ]]; then
  die "域名模式的应用端口不能使用 Nginx 的 80 或 443，请改用其他 --port"
fi
set_env_value PUBLIC_BIND "$public_bind"
set_env_value PUBLIC_PORT "$public_port"
set_env_value MOYU_ACCESS_MODE "$access_mode"
set_env_value MOYU_BACKUP_ROOT "$backup_root"
if [[ -n $domain ]]; then
  set_env_value MOYU_DOMAIN "$domain"
  set_env_value PUBLIC_DOMAIN ''
  if [[ $enable_tls -eq 1 ]]; then set_env_value MOYU_TLS 1; else set_env_value MOYU_TLS 0; fi
else
  if [[ $created_env -eq 1 ]]; then set_env_value MOYU_DOMAIN ''; set_env_value PUBLIC_DOMAIN ''; fi
  set_env_value MOYU_TLS 0
fi

docker compose up -d --build
wait_for_health "$public_port" || die "应用未能在两分钟内通过宿主端口 $public_port 健康检查；请运行 docker compose logs app"
public_fallback_ready=1
if [[ -n $domain ]]; then rollback_armed=1; fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then
  if [[ $public_bind == 0.0.0.0 ]]; then ufw allow "${public_port}/tcp" comment 'Moyu Canvas public port' >/dev/null; fi
  if [[ -n $domain ]]; then
    ufw allow 80/tcp comment 'Moyu Canvas HTTP' >/dev/null
    ufw allow 443/tcp comment 'Moyu Canvas HTTPS' >/dev/null
  fi
fi

check_h_path
if [[ ! -e $h_path && ! -L $h_path ]]; then
  ln -s -- "$expected_manage_target" "$h_path"
fi

if [[ $access_mode == public || $access_mode == private ]]; then
  rollback_site=/etc/nginx/sites-available/moyu-canvas
  rollback_site_link=/etc/nginx/sites-enabled/moyu-canvas
  if [[ -L $rollback_site_link ]]; then
    rollback_link_existed=1
    rollback_link_target=$(readlink -- "$rollback_site_link")
    if [[ -f $rollback_site ]]; then
      rollback_site_existed=1
      rollback_site_backup=$(mktemp)
      cp -a -- "$rollback_site" "$rollback_site_backup"
      chmod 600 "$rollback_site_backup"
    fi
    rollback_site_captured=1
    rollback_armed=1
    rm -f -- "$rollback_site_link"
    if command -v nginx >/dev/null 2>&1; then
      nginx -t || die "关闭域名入口后的 Nginx 配置校验失败"
      if systemctl is-active --quiet nginx; then systemctl reload nginx || die "关闭域名入口后 Nginx 重载失败"; fi
    fi
  elif [[ -e $rollback_site_link ]]; then
    die "Nginx 启用路径已存在且不是符号链接：$rollback_site_link"
  fi
fi

if [[ -n $domain ]]; then
  template=deploy/nginx.conf
  [[ -f $template ]] || die "缺少 Nginx 模板：$template"
  grep -q '__DOMAIN__' "$template" || die "Nginx 模板缺少 __DOMAIN__ 占位符"
  grep -q '__PUBLIC_PORT__' "$template" || die "Nginx 模板缺少 __PUBLIC_PORT__ 占位符"
  rollback_site=/etc/nginx/sites-available/moyu-canvas
  rollback_site_link=/etc/nginx/sites-enabled/moyu-canvas
  if [[ -f $rollback_site ]]; then
    rollback_site_existed=1
    rollback_site_backup=$(mktemp)
    cp -a -- "$rollback_site" "$rollback_site_backup"
    chmod 600 "$rollback_site_backup"
  fi
  if [[ -L $rollback_site_link ]]; then
    rollback_link_existed=1
    rollback_link_target=$(readlink -- "$rollback_site_link")
  elif [[ -e $rollback_site_link ]]; then
    die "Nginx 启用路径已存在且不是符号链接：$rollback_site_link"
  fi
  rollback_site_captured=1
  nginx_tmp=$(mktemp)
  if [[ $preserve_domain_config -eq 1 && $rollback_site_existed -eq 1 ]]; then
    sed -E "s|^[[:space:]]*proxy_pass[[:space:]]+http://127[.]0[.]0[.]1:[0-9]+;|        proxy_pass http://127.0.0.1:${public_port};|" \
      "$rollback_site" > "$nginx_tmp"
  elif [[ $preserve_domain_config -eq 1 && $old_tls -eq 1 ]]; then
    rm -f -- "$nginx_tmp"
    die "现有 HTTPS 部署缺少 Nginx 站点文件；请修复站点后重试，或显式提供 --domain"
  else
    sed -e "s|__DOMAIN__|$domain|g" -e "s|__PUBLIC_PORT__|$public_port|g" "$template" > "$nginx_tmp"
  fi
  grep -q "proxy_pass http://127.0.0.1:${public_port};" "$nginx_tmp" || { rm -f -- "$nginx_tmp"; die "Nginx 代理端口更新失败"; }
  chmod 644 "$nginx_tmp"
  mv -f -- "$nginx_tmp" "$rollback_site"
  rm -f -- "$rollback_site_link"
  ln -s -- "$rollback_site" "$rollback_site_link"
  nginx -t || die "Nginx 配置校验失败"
  systemctl enable --now nginx || die "Nginx 启动失败"
  systemctl reload nginx || die "Nginx 重载失败"
  if [[ $domain_explicit -eq 1 && $enable_tls -eq 1 ]]; then
    certbot_contact=(--register-unsafely-without-email)
    if [[ -n $email ]]; then certbot_contact=(--email "$email"); fi
    certbot --nginx --non-interactive --agree-tos --redirect "${certbot_contact[@]}" -d "$domain" \
      || die "HTTPS 证书申请失败；请检查域名解析和 80/443 端口"
  fi
fi

rollback_armed=0
trap - EXIT INT TERM
[[ -z $rollback_env_backup ]] || rm -f -- "$rollback_env_backup"
[[ -z $rollback_site_backup ]] || rm -f -- "$rollback_site_backup"

is_ipv4() {
  local value=$1 part
  local -a parts
  IFS=. read -r -a parts <<< "$value"
  [[ ${#parts[@]} -eq 4 ]] || return 1
  for part in "${parts[@]}"; do
    [[ $part =~ ^[0-9]{1,3}$ ]] || return 1
    ((10#$part <= 255)) || return 1
  done
}

if [[ $access_mode == domain || $access_mode == both ]]; then
  if [[ $enable_tls -eq 1 ]]; then
    echo "部署完成：https://${domain}/"
    echo "健康检查：https://${domain}/api/health"
  else
    echo "部署完成：http://${domain}/"
    echo "健康检查：http://${domain}/api/health"
    echo "警告：当前为 HTTP，公网传输未加密。"
  fi
  if [[ $access_mode == both ]]; then
    public_ipv4=$(curl -4fsS --max-time 10 https://api.ipify.org 2>/dev/null | tr -d '[:space:]' || true)
    if is_ipv4 "$public_ipv4"; then echo "公网端口同时可用：http://${public_ipv4}:${public_port}/"; else echo "公网端口同时启用，但未能自动探测公网 IPv4。"; fi
    echo "警告：公网端口使用未加密 HTTP。"
  fi
elif [[ $access_mode == private ]]; then
  echo "部署完成：http://127.0.0.1:${public_port}/（仅服务器本机）"
  echo "公网 IP + 端口和域名入口均未启用。"
else
  public_ipv4=$(curl -4fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
  if is_ipv4 "$public_ipv4"; then
    echo "部署完成：http://${public_ipv4}:${public_port}/"
    [[ $public_bind == 0.0.0.0 ]] || echo "警告：当前 --bind 仅监听本机；上面的公网地址不会从外网直达。"
  else
    echo "部署完成：http://<公网IPv4>:${public_port}/"
    echo "未能自动探测公网 IPv4；可运行 curl -4 https://api.ipify.org，或查看云主机控制台/公网网卡地址后替换占位符。"
  fi
  echo "警告：当前为 HTTP，公网传输未加密。"
fi
if [[ $created_env -eq 1 ]]; then
  echo "首次管理员初始化码已写入 $install_dir/.env，未输出到日志。"
  echo "需要查看时运行：sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' '$install_dir/.env'"
  echo "首位管理员创建后，请从 .env 删除 ADMIN_SETUP_TOKEN 并重新运行本部署命令。"
fi
