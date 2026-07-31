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

usage() {
  cat <<'EOF'
用法：
  sudo bash deploy/install.sh --domain canvas.example.com --email admin@example.com

选项：
  --domain DOMAIN       站点域名，必须先把 A/AAAA 记录指向本机
  --email EMAIL         Let's Encrypt 通知邮箱
  --no-tls              只配置 HTTP；未提供 --email 时必须显式使用
  --repo-url URL        Git 仓库，默认 https://github.com/bykedie/huabu.git
  --branch BRANCH       部署分支，默认 codex/infinite-canvas
  --install-dir PATH    安装目录，默认 /opt/moyu-canvas
  --backup-dir PATH     仓库外备份根目录，默认 /srv/canvas-backups
  -h, --help            显示帮助

同名 MOYU_REPO_URL、MOYU_BRANCH、MOYU_INSTALL_DIR、MOYU_BACKUP_ROOT
环境变量可覆盖对应默认值。已有 .env 和 Docker 数据卷不会被覆盖。
EOF
}

die() {
  echo "部署失败：$*" >&2
  exit 1
}

require_value() {
  [[ $# -ge 2 && -n $2 ]] || die "$1 缺少参数"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) require_value "$1" "${2:-}"; domain=$2; shift 2 ;;
    --email) require_value "$1" "${2:-}"; email=$2; shift 2 ;;
    --no-tls) enable_tls=0; shift ;;
    --repo-url) require_value "$1" "${2:-}"; repo_url=$2; shift 2 ;;
    --branch) require_value "$1" "${2:-}"; branch=$2; shift 2 ;;
    --install-dir) require_value "$1" "${2:-}"; install_dir=$2; shift 2 ;;
    --backup-dir) require_value "$1" "${2:-}"; backup_root=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "请使用 sudo 或 root 运行"
[[ -n $domain ]] || die "必须提供 --domain"
[[ ${#domain} -le 253 ]] || die "域名格式无效"
[[ $domain != .* && $domain != *. && $domain != *..* ]] || die "域名格式无效"
[[ $domain == *.* && ! $domain =~ ^[0-9.]+$ ]] || die "必须提供可用于公网证书的完整域名"
IFS=. read -r -a domain_labels <<< "$domain"
for label in "${domain_labels[@]}"; do
  [[ $label =~ ^[A-Za-z0-9]$|^[A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]$ ]] \
    || die "域名格式无效"
done
if [[ $enable_tls -eq 1 ]]; then
  [[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$ ]] \
    || die "启用 HTTPS 时必须提供有效的 --email；或显式使用 --no-tls"
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
apt-get install -y ca-certificates curl git openssl nginx
if [[ $enable_tls -eq 1 ]]; then
  apt-get install -y certbot python3-certbot-nginx
fi

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 \
    || die "已安装 Docker，但缺少 Compose v2；请先安装 docker-compose-plugin"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$codename" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

mkdir -p -- "$(dirname "$install_dir")"
if [[ -e $install_dir && ! -d $install_dir/.git ]]; then
  die "安装目录已存在但不是 Git 仓库：$install_dir"
fi

if [[ -d $install_dir/.git ]]; then
  existing_remote=$(git -C "$install_dir" remote get-url origin)
  [[ $existing_remote == "$repo_url" ]] \
    || die "现有仓库 origin 为 $existing_remote，与目标仓库不一致"
  current_branch=$(git -C "$install_dir" branch --show-current)
  [[ $current_branch == "$branch" ]] \
    || die "现有部署位于 $current_branch 分支，预期为 $branch"
  [[ -z $(git -C "$install_dir" status --porcelain) ]] \
    || die "现有部署仓库存在未提交修改，请先人工处理"

  git -C "$install_dir" fetch --prune origin "$branch"
  git -C "$install_dir" merge-base --is-ancestor HEAD FETCH_HEAD \
    || die "远程更新不是当前版本的快进提交，已拒绝覆盖"
  if [[ $(git -C "$install_dir" rev-parse HEAD) != $(git -C "$install_dir" rev-parse FETCH_HEAD) ]]; then
    if [[ -n $(cd "$install_dir" && docker compose ps -a -q app 2>/dev/null) ]]; then
      chmod +x "$install_dir/deploy/backup.sh"
      (cd "$install_dir" && ./deploy/backup.sh "$backup_root")
    fi
    git -C "$install_dir" merge --ff-only FETCH_HEAD
  fi
else
  git clone --branch "$branch" --single-branch -- "$repo_url" "$install_dir"
fi

cd "$install_dir"
chmod +x deploy/install.sh deploy/backup.sh deploy/restore.sh
created_env=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  jwt_secret=$(openssl rand -hex 32)
  setup_token=$(openssl rand -hex 32)
  sed -i "s|^JWT_SECRET=.*$|JWT_SECRET=$jwt_secret|" .env
  sed -i "s|^ADMIN_SETUP_TOKEN=.*$|ADMIN_SETUP_TOKEN=$setup_token|" .env
  created_env=1
fi
chmod 600 .env

docker compose up -d --build

wait_for_health() {
  for _ in {1..60}; do
    if curl -fsS http://127.0.0.1:3102/api/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}
wait_for_health || die "应用未能在两分钟内通过健康检查；请运行 docker compose logs app"

site=/etc/nginx/sites-available/moyu-canvas
site_link=/etc/nginx/sites-enabled/moyu-canvas
site_backup=
if [[ -f $site ]]; then
  site_backup=$(mktemp)
  cp -a -- "$site" "$site_backup"
fi
sed "s/server_name canvas\.example\.com;/server_name $domain;/" deploy/nginx.conf > "$site"
ln -sfn "$site" "$site_link"
if ! nginx -t; then
  if [[ -n $site_backup ]]; then cp -a -- "$site_backup" "$site"; else rm -f -- "$site" "$site_link"; fi
  rm -f -- "$site_backup"
  die "Nginx 配置校验失败，原配置已恢复"
fi
systemctl enable --now nginx
systemctl reload nginx

if [[ $enable_tls -eq 1 ]]; then
  if ! certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"; then
    if [[ -n $site_backup ]]; then
      cp -a -- "$site_backup" "$site"
    else
      rm -f -- "$site" "$site_link"
    fi
    nginx -t && systemctl reload nginx
    rm -f -- "$site_backup"
    die "HTTPS 证书申请失败；已尽量恢复原 Nginx 配置，请检查域名解析和 80/443 端口"
  fi
fi
rm -f -- "$site_backup"

scheme=http
[[ $enable_tls -eq 1 ]] && scheme=https
echo "部署完成：${scheme}://${domain}/"
echo "健康检查：${scheme}://${domain}/api/health"
if [[ $created_env -eq 1 ]]; then
  echo "首次管理员初始化码已写入 $install_dir/.env，未输出到日志。"
  echo "需要查看时运行：sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' '$install_dir/.env'"
  echo "首位管理员创建后，请从 .env 删除 ADMIN_SETUP_TOKEN 并重新运行本部署命令。"
fi
