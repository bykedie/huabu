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
public_port=3102
public_bind=0.0.0.0
port_explicit=0
bind_explicit=0

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
  --email EMAIL          Let's Encrypt 通知邮箱；启用 TLS 时必填
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
  [[ $value =~ ^[0-9]+$ ]] || die "--port 必须是 1-65535 的整数"
  [[ ${#value} -le 5 ]] || die "--port 必须是 1-65535 的整数"
  (( 10#$value >= 1 && 10#$value <= 65535 )) || die "--port 必须是 1-65535 的整数"
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
[[ $public_bind == 0.0.0.0 || $public_bind == 127.0.0.1 ]] || die "--bind 只能是 0.0.0.0 或 127.0.0.1"
validate_port "$public_port"
if [[ -n $domain ]]; then
  validate_domain "$domain"
  if [[ $enable_tls -eq 1 ]]; then
    [[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$ ]] || die "启用 HTTPS 时必须提供有效的 --email；或显式使用 --no-tls"
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
if [[ -f $install_dir/.env ]]; then
  old_port=$(read_env_value "$install_dir/.env" PUBLIC_PORT)
  if [[ $old_port =~ ^[0-9]+$ && $old_port -ge 1 && $old_port -le 65535 ]]; then
    current_port=$old_port
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

backup_deployment() {
  local backup_dir=$backup_root/canvas-$(date +%Y%m%d-%H%M%S)-$$
  mkdir -p -- "$backup_root"
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
  if ! docker compose run --rm --no-deps -v "$backup_dir:/backup:ro" app node server/check-db.js /backup/app.db; then
    docker compose start app >/dev/null 2>&1 || true
    wait_for_health "$current_port" || true
    rm -rf -- "$backup_dir"
    return 1
  fi
  docker compose start app >/dev/null
  wait_for_health "$current_port" || { rm -rf -- "$backup_dir"; return 1; }
  echo "更新前备份完成：$backup_dir"
}

if [[ -d $install_dir/.git ]]; then
  existing_remote=$(git -C "$install_dir" remote get-url origin)
  [[ $existing_remote == "$repo_url" ]] || die "现有仓库 origin 与目标仓库不一致"
  current_branch=$(git -C "$install_dir" branch --show-current)
  [[ $current_branch == "$branch" ]] || die "现有部署分支与目标分支不一致"
  [[ -z $(git -C "$install_dir" status --porcelain) ]] || die "现有部署仓库存在未提交修改，请先人工处理"
  git -C "$install_dir" fetch --prune origin "$branch"
  git -C "$install_dir" merge-base --is-ancestor HEAD FETCH_HEAD || die "远程更新不是快进提交，已拒绝覆盖"
  if [[ $(git -C "$install_dir" rev-parse HEAD) != $(git -C "$install_dir" rev-parse FETCH_HEAD) ]]; then
    if [[ -n $(cd "$install_dir" && docker compose ps -a -q app 2>/dev/null) ]]; then
      (cd "$install_dir" && backup_deployment) || die "更新前备份失败，已停止更新"
    fi
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

if [[ $port_explicit -eq 0 ]]; then
  old_port=$(read_env_value .env PUBLIC_PORT)
  if [[ $old_port =~ ^[0-9]+$ && $old_port -ge 1 && $old_port -le 65535 ]]; then
    public_port=$old_port
  fi
fi
if [[ $bind_explicit -eq 0 ]]; then
  old_bind=$(read_env_value .env PUBLIC_BIND)
  if [[ $old_bind == 0.0.0.0 || $old_bind == 127.0.0.1 ]]; then
    public_bind=$old_bind
  fi
fi
validate_port "$public_port"
if [[ -n $domain && ($public_port -eq 80 || $public_port -eq 443) ]]; then
  die "域名模式的应用端口不能使用 Nginx 的 80 或 443，请改用其他 --port"
fi
set_env_value PUBLIC_BIND "$public_bind"
set_env_value PUBLIC_PORT "$public_port"

docker compose up -d --build
wait_for_health "$public_port" || die "应用未能在两分钟内通过宿主端口 $public_port 健康检查；请运行 docker compose logs app"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then
  ufw allow "${public_port}/tcp" comment 'Moyu Canvas public port' >/dev/null
  if [[ -n $domain ]]; then
    ufw allow 80/tcp comment 'Moyu Canvas HTTP' >/dev/null
    ufw allow 443/tcp comment 'Moyu Canvas HTTPS' >/dev/null
  fi
fi

manage_target=$(realpath -m -- "$install_dir/deploy/manage.sh")
h_path=/usr/local/bin/h
if [[ -e $h_path || -L $h_path ]]; then
  [[ -L $h_path ]] || die "$h_path 已存在且不是本项目链接，拒绝覆盖"
  [[ $(readlink -f -- "$h_path" 2>/dev/null || true) == "$manage_target" ]] || die "$h_path 已存在且不是本项目链接，拒绝覆盖"
else
  ln -s -- "$manage_target" "$h_path"
fi

if [[ -n $domain ]]; then
  template=deploy/nginx.conf
  [[ -f $template ]] || die "缺少 Nginx 模板：$template"
  grep -q '__DOMAIN__' "$template" || die "Nginx 模板缺少 __DOMAIN__ 占位符"
  grep -q '__PUBLIC_PORT__' "$template" || die "Nginx 模板缺少 __PUBLIC_PORT__ 占位符"
  site=/etc/nginx/sites-available/moyu-canvas
  site_link=/etc/nginx/sites-enabled/moyu-canvas
  site_backup=
  site_existed=0
  link_existed=0
  link_target=
  if [[ -f $site ]]; then
    site_existed=1
    site_backup=$(mktemp)
    cp -a -- "$site" "$site_backup"
  fi
  if [[ -L $site_link ]]; then
    link_existed=1
    link_target=$(readlink -- "$site_link")
  elif [[ -e $site_link ]]; then
    [[ -z $site_backup ]] || rm -f -- "$site_backup"
    die "Nginx 启用路径已存在且不是符号链接：$site_link"
  fi
  restore_nginx_site() {
    if [[ $site_existed -eq 1 ]]; then cp -a -- "$site_backup" "$site"; else rm -f -- "$site"; fi
    rm -f -- "$site_link"
    if [[ $link_existed -eq 1 ]]; then ln -s -- "$link_target" "$site_link"; fi
  }
  nginx_tmp=$(mktemp)
  sed -e "s|__DOMAIN__|$domain|g" -e "s|__PUBLIC_PORT__|$public_port|g" "$template" > "$nginx_tmp"
  chmod 644 "$nginx_tmp"
  mv -f -- "$nginx_tmp" "$site"
  rm -f -- "$site_link"
  ln -s -- "$site" "$site_link"
  if ! nginx -t; then
    restore_nginx_site
    [[ -z $site_backup ]] || rm -f -- "$site_backup"
    die "Nginx 配置校验失败，原配置已恢复"
  fi
  systemctl enable --now nginx
  systemctl reload nginx
  if [[ $enable_tls -eq 1 ]]; then
    if ! certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"; then
      restore_nginx_site
      nginx -t && systemctl reload nginx || true
      [[ -z $site_backup ]] || rm -f -- "$site_backup"
      die "HTTPS 证书申请失败；已尽量恢复原 Nginx 配置，请检查域名解析和 80/443 端口"
    fi
  fi
  [[ -z $site_backup ]] || rm -f -- "$site_backup"
  set_env_value MOYU_DOMAIN "$domain"
  if [[ $enable_tls -eq 1 ]]; then set_env_value MOYU_TLS 1; else set_env_value MOYU_TLS 0; fi
fi

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

if [[ -n $domain ]]; then
  if [[ $enable_tls -eq 1 ]]; then
    echo "部署完成：https://${domain}/"
    echo "健康检查：https://${domain}/api/health"
  else
    echo "部署完成：http://${domain}/"
    echo "健康检查：http://${domain}/api/health"
    echo "警告：当前为 HTTP，公网传输未加密。"
  fi
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
