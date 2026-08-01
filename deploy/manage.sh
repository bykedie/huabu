#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${MOYU_INSTALL_DIR:-/opt/moyu-canvas}"
BACKUP_ROOT="${MOYU_BACKUP_ROOT:-}"
SCRIPT_SOURCE=$(realpath -m -- "${BASH_SOURCE[0]}")
SCRIPT_DIR=$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" && pwd -P)
if [[ -z ${MOYU_INSTALL_DIR:-} && ${SCRIPT_DIR##*/} == deploy && -f "$SCRIPT_DIR/../.env.example" ]]; then
  INSTALL_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
fi
ENV_FILE="$INSTALL_DIR/.env"

usage() {
  cat <<'EOF'
用法：h [status]

墨屿画布服务器交互式运维工具。请在 Ubuntu/Debian 上以 root 身份运行。
默认访问地址为 http://公网IP:公网端口；HTTP 未加密。

命令：
  status       显示服务状态和公网访问地址
  -h, --help   显示此帮助
EOF
}

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
need_root() { [[ ${EUID:-$(id -u)} -eq 0 ]] || die '需要 root 权限'; }
need_install() { [[ -d "$INSTALL_DIR" ]] || die "未找到安装目录：$INSTALL_DIR"; [[ -f "$ENV_FILE" ]] || die "未找到配置文件：$ENV_FILE"; }

env_value() {
  local key=$1 default=${2:-} value
  value=$(sed -n "s/^${key}=//p" "$ENV_FILE" 2>/dev/null | tail -n 1 | tr -d '\r' || true)
  [[ -n $value ]] && printf '%s' "$value" || printf '%s' "$default"
}

valid_port() {
  [[ $1 =~ ^[0-9]+$ && ${#1} -le 5 ]] || return 1
  (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}
valid_integer_range() {
  local value=$1 min=$2 max=$3
  [[ $value =~ ^[0-9]+$ && ${#value} -le ${#max} ]] || return 1
  (( 10#$value >= min && 10#$value <= max ))
}
valid_bind() { [[ $1 == 0.0.0.0 || $1 == 127.0.0.1 ]]; }
valid_ipv4() {
  local value=$1 part
  local -a parts
  IFS=. read -r -a parts <<< "$value"
  [[ ${#parts[@]} -eq 4 ]] || return 1
  for part in "${parts[@]}"; do
    [[ $part =~ ^[0-9]{1,3}$ ]] || return 1
    (( 10#$part <= 255 )) || return 1
  done
}
valid_domain() {
  local domain=$1 label
  [[ $domain =~ ^[A-Za-z0-9.-]+$ && ${#domain} -le 253 && $domain != .* && $domain != *. && $domain != *..* && $domain == *.* ]] || return 1
  IFS=. read -r -a labels <<< "$domain"
  for label in "${labels[@]}"; do [[ $label =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1; done
}
valid_email() { [[ $1 =~ ^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$ ]]; }

set_env_value() {
  local key=$1 value=$2 tmp
  [[ $value != *$'\n'* && $value != *$'\r'* ]] || die "$key 不能包含换行符"
  tmp=$(mktemp "$ENV_FILE.XXXXXX")
  chmod 600 "$tmp"
  local line prefix found=0
  prefix="$key="
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line == "$prefix"* ]]; then
      printf '%s\n' "$prefix$value" >> "$tmp"
      found=1
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$ENV_FILE"
  if (( ! found )); then printf '%s\n' "$prefix$value" >> "$tmp"; fi
  mv -f -- "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

compose() { (cd "$INSTALL_DIR" && docker compose "$@"); }
backup_root_path() {
  local requested=${BACKUP_ROOT:-$(env_value MOYU_BACKUP_ROOT /srv/canvas-backups)} root install_real
  [[ $requested == /* ]] || die '备份根目录必须是绝对路径'
  root=$(realpath -m -- "$requested")
  install_real=$(realpath -m -- "$INSTALL_DIR")
  case $root in "$install_real"|"$install_real"/*) die '备份根目录必须位于安装目录之外' ;; esac
  mkdir -p -- "$root"
  root=$(cd -- "$root" && pwd -P)
  case $root in "$install_real"|"$install_real"/*) die '备份根目录解析后位于安装目录内' ;; esac
  printf '%s' "$root"
}
current_port() {
  local p
  p=$(env_value PUBLIC_PORT 3102)
  valid_port "$p" || p=3102
  printf '%s' "$((10#$p))"
}
public_port() { current_port; }
public_bind() { local b=$(env_value PUBLIC_BIND 0.0.0.0); valid_bind "$b" || b=0.0.0.0; printf '%s' "$b"; }
configured_domain() {
  local domain
  domain=$(env_value MOYU_DOMAIN '')
  [[ -n $domain ]] || domain=$(env_value PUBLIC_DOMAIN '')
  printf '%s' "$domain"
}
domain_tls_enabled() { [[ $(env_value MOYU_TLS 0) == 1 ]]; }
public_ip() {
  local ip
  ip=$(curl -4fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)
  valid_ipv4 "$ip" || ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  valid_ipv4 "$ip" && printf '%s' "$ip" || printf '%s' PUBLIC_IP
}
wait_for_health() {
  local port=$1
  for _ in {1..60}; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
remove_temp_files() {
  local path
  for path in "$@"; do [[ -z $path ]] || rm -f -- "$path"; done
}
restore_nginx_state() {
  local site=$1 site_existed=$2 site_backup=$3 link=$4 link_existed=$5 link_target=$6
  if (( site_existed )); then cp -a -- "$site_backup" "$site"; else rm -f -- "$site"; fi
  rm -f -- "$link"
  if (( link_existed )); then ln -s -- "$link_target" "$link"; fi
}

print_status() {
  need_install
  local bind=$(public_bind) port=$(current_port) ip=$(public_ip) domain=$(configured_domain)
  printf '墨屿画布目录：%s\n监听地址：%s:%s -> 容器端口：3102\n' "$INSTALL_DIR" "$bind" "$port"
  if [[ -n $domain ]] && domain_tls_enabled; then printf '访问地址：https://%s/\n' "$domain"; elif [[ -n $domain ]]; then printf '访问地址：http://%s/\n安全提示：HTTP 未加密，请先配置 HTTPS 再使用密码或 API 密钥。\n' "$domain"; else printf '访问地址：http://%s:%s/\n安全提示：HTTP 未加密，请先配置 HTTPS 再使用密码或 API 密钥。\n' "$ip" "$port"; fi
  if command -v docker >/dev/null 2>&1; then compose ps || true; else printf 'Docker：未安装\n'; fi
}

service_action() { need_install; case $1 in start) compose up -d ;; stop) compose stop ;; restart) compose restart ;; esac; print_status; }

safe_update() {
  need_install; command -v git >/dev/null 2>&1 || die '需要安装 Git'
  local expected=${MOYU_BRANCH:-codex/infinite-canvas} branch head remote_head backup_root port
  git check-ref-format --branch "$expected" >/dev/null 2>&1 || die '预期部署分支无效'
  [[ $(cd "$INSTALL_DIR" && git remote get-url origin) == "${MOYU_REPO_URL:-https://github.com/bykedie/huabu.git}" ]] || die '拒绝更新：origin 与预期仓库不一致'
  branch=$(cd "$INSTALL_DIR" && git branch --show-current); [[ $branch == $expected ]] || die "当前分支不符合预期：$branch"
  [[ -z $(cd "$INSTALL_DIR" && git status --porcelain) ]] || die '拒绝更新：仓库存在未提交修改'
  (cd "$INSTALL_DIR" && git fetch --prune origin "$branch")
  head=$(cd "$INSTALL_DIR" && git rev-parse HEAD); remote_head=$(cd "$INSTALL_DIR" && git rev-parse FETCH_HEAD)
  (cd "$INSTALL_DIR" && git merge-base --is-ancestor "$head" "$remote_head") || die '拒绝更新：远端历史无法快进合并'
  if [[ $head == $remote_head ]]; then printf '当前已是最新版本。\n'; return; fi
  backup_root=$(backup_root_path); port=$(public_port)
  [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"
  (cd "$INSTALL_DIR" && ./deploy/backup.sh "$backup_root")
  (cd "$INSTALL_DIR" && git merge --ff-only "$remote_head")
  if ! compose up -d --build || ! wait_for_health "$port"; then
    if (cd "$INSTALL_DIR" && git update-ref "refs/heads/$branch" "$head" "$remote_head" \
      && git read-tree --reset -u "$head" && [[ -z $(git status --porcelain) ]]) \
      && compose up -d --build && wait_for_health "$port"; then
      die "更新未通过健康检查，已回滚到 $head；已验证的备份保留在 $backup_root"
    fi
    die "更新失败且自动代码回滚未恢复健康；请使用 $backup_root 下已验证的备份恢复"
  fi
}

configure_port() {
  need_install
  local bind port old_bind old_port domain env_backup site_backup='' site link nginx_tmp=''
  local site_existed=0 link_existed=0 link_target=''
  old_bind=$(public_bind); old_port=$(current_port); domain=$(configured_domain)
  site=/etc/nginx/sites-available/moyu-canvas; link=/etc/nginx/sites-enabled/moyu-canvas
  read -r -p "公网监听地址 [0.0.0.0/127.0.0.1]（当前：$old_bind）：" bind
  bind=${bind:-$old_bind}; valid_bind "$bind" || die '监听地址必须是 0.0.0.0 或 127.0.0.1'
  read -r -p "公网端口 1-65535（当前：$old_port）：" port
  port=${port:-$old_port}; valid_port "$port" || die '端口必须是 1-65535 之间的整数'
  port=$((10#$port))
  if [[ -n $domain ]]; then
    [[ $bind == 127.0.0.1 ]] || die '域名模式要求 PUBLIC_BIND=127.0.0.1'
    [[ $port -ne 80 && $port -ne 443 ]] || die '域名模式下应用端口不能使用 80 或 443'
    [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || die '未找到 deploy/nginx.conf'
    if [[ -L $link ]]; then link_existed=1; link_target=$(readlink -- "$link"); elif [[ -e $link ]]; then die "Nginx 启用路径不是符号链接：$link"; fi
    if [[ -f $site ]]; then site_existed=1; site_backup=$(mktemp); cp -a -- "$site" "$site_backup"; fi
    nginx_tmp=$(mktemp)
    if (( site_existed )); then
      sed -E "s|^[[:space:]]*proxy_pass[[:space:]]+http://127[.]0[.]0[.]1:[0-9]+;|        proxy_pass http://127.0.0.1:${port};|" "$site" > "$nginx_tmp"
    else
      sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$nginx_tmp"
    fi
    grep -q "proxy_pass http://127.0.0.1:${port};" "$nginx_tmp" || { remove_temp_files "$site_backup" "$nginx_tmp"; die '无法更新 Nginx 代理端口'; }
    chmod 644 "$nginx_tmp"; mv -f -- "$nginx_tmp" "$site"; nginx_tmp=''
    rm -f -- "$link"; ln -s -- "$site" "$link"
    if ! nginx -t; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; remove_temp_files "$site_backup"; die 'Nginx 配置校验失败，已恢复原站点配置'; fi
  fi
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"
  set_env_value PUBLIC_BIND "$bind"; set_env_value PUBLIC_PORT "$port"
  if ! compose up -d || ! wait_for_health "$port"; then
    cp -a -- "$env_backup" "$ENV_FILE"
    if [[ -n $domain ]]; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; nginx -t && systemctl reload nginx || true; fi
    compose up -d || true; wait_for_health "$old_port" || true
    remove_temp_files "$env_backup" "$site_backup" "$nginx_tmp"
    die '服务无法在新端口健康运行，已恢复原配置'
  fi
  if [[ -n $domain ]] && ! systemctl reload nginx; then
    cp -a -- "$env_backup" "$ENV_FILE"; restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"
    compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die 'Nginx 重新加载失败，已恢复原配置'
  fi
  if [[ $bind == 0.0.0.0 ]] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then ufw allow "${port}/tcp" comment 'Moyu Canvas public port' >/dev/null; fi
  remove_temp_files "$env_backup" "$site_backup"; print_status
}

configure_domain() {
  need_install
  local domain email='' port old_port env_backup site_backup='' nginx_tmp=''
  local site=/etc/nginx/sites-available/moyu-canvas link=/etc/nginx/sites-enabled/moyu-canvas
  local site_existed=0 link_existed=0 link_target=''
  read -r -p '域名（留空将关闭域名模式）：' domain
  port=$(public_port); old_port=$port
  if [[ -n $domain ]]; then
    valid_domain "$domain" || die '域名格式无效'
    [[ $port -ne 80 && $port -ne 443 ]] || die '域名模式下应用端口不能使用 80 或 443'
    read -r -p "Let's Encrypt 邮箱（留空则仅配置 HTTP）：" email
    [[ -z $email ]] || valid_email "$email" || die '证书邮箱格式无效'
    [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || die '未找到 deploy/nginx.conf'
    apt-get update
    if [[ -n $email ]]; then apt-get install -y nginx certbot python3-certbot-nginx; else apt-get install -y nginx; fi
  fi
  if [[ -L $link ]]; then link_existed=1; link_target=$(readlink -- "$link"); elif [[ -e $link ]]; then die "Nginx 启用路径不是符号链接：$link"; fi
  if [[ -f $site ]]; then site_existed=1; site_backup=$(mktemp); cp -a -- "$site" "$site_backup"; fi
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"
  if [[ -z $domain ]]; then
    set_env_value MOYU_DOMAIN ''; set_env_value PUBLIC_DOMAIN ''; set_env_value MOYU_TLS 0; set_env_value PUBLIC_BIND 0.0.0.0
    if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; remove_temp_files "$env_backup" "$site_backup"; die '恢复公网 IP + 端口模式失败'; fi
    rm -f -- "$link" "$site"
    if command -v nginx >/dev/null 2>&1 && ! nginx -t; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; remove_temp_files "$env_backup" "$site_backup"; die 'Nginx 校验失败，未关闭域名模式' ; fi
    if command -v nginx >/dev/null 2>&1 && ! systemctl reload nginx; then
      restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"
      cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true
      nginx -t && systemctl reload nginx || true
      remove_temp_files "$env_backup" "$site_backup"; die 'Nginx 重新加载失败，未关闭域名模式'
    fi
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then ufw allow "${port}/tcp" comment 'Moyu Canvas public port' >/dev/null; fi
    remove_temp_files "$env_backup" "$site_backup"; printf '已关闭域名模式，并恢复公网 IP + 端口访问。\n'; print_status; return
  fi
  nginx_tmp=$(mktemp); sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$nginx_tmp"; chmod 644 "$nginx_tmp"
  set_env_value PUBLIC_BIND 127.0.0.1; set_env_value MOYU_DOMAIN "$domain"; set_env_value PUBLIC_DOMAIN ''; if [[ -n $email ]]; then set_env_value MOYU_TLS 1; else set_env_value MOYU_TLS 0; fi
  if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; remove_temp_files "$env_backup" "$site_backup" "$nginx_tmp"; die '启用域名模式后应用未恢复健康，已恢复原配置'; fi
  mv -f -- "$nginx_tmp" "$site"; nginx_tmp=''; rm -f -- "$link"; ln -s -- "$site" "$link"
  if ! nginx -t || ! systemctl enable --now nginx || ! systemctl reload nginx; then
    restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die 'Nginx 配置或启动失败，已恢复原域名和监听配置'
  fi
  if [[ -n $email ]] && ! certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"; then
    restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die '证书申请失败，已恢复原域名和监听配置'
  fi
  remove_temp_files "$env_backup" "$site_backup"; printf '域名配置已完成。\n'; print_status
}

configure_relay() {
  need_install; local kind relay_kind base key models key_action
  printf '1) 文字中转  2) 视频中转\n'; read -r -p '请选择：' kind
  case $kind in
    1) relay_kind=text ;;
    2) relay_kind=video ;;
    *) die '未知的中转类型' ;;
  esac
  read -r -p '中转站基础地址（生产环境必须使用 HTTPS）：' base
  read -r -p '开放模型（多个模型用英文逗号分隔）：' models
  read -r -s -p 'API 密钥（隐藏输入；留空保留当前值，输入 CLEAR 清除）：' key; printf '\n'
  if [[ $key == CLEAR ]]; then key_action=clear; key=''; elif [[ -z $key ]]; then key_action=keep; else key_action=set; fi
  [[ $base != *$'\n'* && $base != *$'\r'* && $models != *$'\n'* && $models != *$'\r'* && $key != *$'\n'* && $key != *$'\r'* ]] || die '中转配置不能包含换行符'
  printf '%s\0%s\0%s\0%s\0' "$base" "$models" "$key_action" "$key" | compose run --rm -T --no-deps app node server/manage-config.js relay "$relay_kind"
  if [[ $relay_kind == text ]]; then set_env_value AI_API_KEY ''; else set_env_value AI_VIDEO_API_KEY ''; fi
  unset key
  compose up -d --force-recreate app
  wait_for_health "$(public_port)" || die '中转配置已保存，但重建后的应用未恢复健康'
  printf '中转配置已保存，API 密钥未显示。\n'
}

configure_commercial() {
  need_install; local welcome video max_canvas max_assets env_backup port
  read -r -p '新用户欢迎积分（0-10000000）：' welcome; valid_integer_range "$welcome" 0 10000000 || die '欢迎积分无效'
  read -r -p '每次视频生成积分（1-1000000）：' video; valid_integer_range "$video" 1 1000000 || die '视频生成积分无效'
  read -r -p '每位用户最大画布数（1-10000）：' max_canvas; valid_integer_range "$max_canvas" 1 10000 || die '画布数量上限无效'
  read -r -p '每位用户最大资产数（1-10000）：' max_assets; valid_integer_range "$max_assets" 1 10000 || die '资产数量上限无效'
  welcome=$((10#$welcome)); video=$((10#$video)); max_canvas=$((10#$max_canvas)); max_assets=$((10#$max_assets))
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"; port=$(public_port)
  set_env_value WELCOME_POINTS "$welcome"; set_env_value AI_VIDEO_POINTS "$video"; set_env_value MAX_CANVASES_PER_USER "$max_canvas"; set_env_value MAX_ASSETS_PER_USER "$max_assets"
  if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die '服务拒绝商业配置，已恢复原环境配置'; fi
  if ! compose run --rm -T --no-deps app node server/manage-config.js video-points "$video"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die '数据库拒绝视频积分配置，已恢复原环境配置'; fi
  remove_temp_files "$env_backup"; printf '商业与配额配置已保存。\n'
}

backup_now() { local root; need_install; root=$(backup_root_path); [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"; (cd "$INSTALL_DIR" && ./deploy/backup.sh "$root"); }
list_backups() { local root; need_install; root=$(backup_root_path); find "$root" -mindepth 1 -maxdepth 1 -type d -name 'canvas-*' -printf '%f\n' 2>/dev/null | sort -r || true; }
restore_backup() {
  need_install; local name root_real target_real answer
  root_real=$(backup_root_path)
  read -r -p '备份目录名称：' name; [[ $name =~ ^canvas-[A-Za-z0-9._-]+$ ]] || die '备份名称无效'
  [[ -d "$root_real/$name" ]] || die '未找到备份目录'
  target_real=$(cd -- "$root_real/$name" && pwd -P); [[ $target_real == "$root_real/"* ]] || die '备份符号链接解析到备份根目录之外'
  read -r -p '输入 RESTORE 确认替换数据库：' answer; [[ $answer == RESTORE ]] || { printf '已取消恢复。\n'; return; }; "$INSTALL_DIR/deploy/restore.sh" "$target_real"
}
show_logs() { need_install; local mode; read -r -p '1) 最近日志  2) 持续查看日志：' mode; [[ $mode == 2 ]] && compose logs -f --tail=100 app || compose logs --tail=200 app; }
diagnose() { need_install; printf '== Git 状态 ==\n'; (cd "$INSTALL_DIR" && git status --short --branch); printf '== 服务状态 ==\n'; compose ps; printf '== 健康检查 ==\n'; curl -fsS "http://127.0.0.1:$(public_port)/api/health" || true; printf '\n== 磁盘空间 ==\n'; df -h "$INSTALL_DIR"; }
admin_token_menu() {
  need_install
  local action token answer env_backup port
  printf '1) 查看  2) 轮换  3) 清除\n'; read -r -p '请选择：' action
  case $action in
    1)
      token=$(env_value ADMIN_SETUP_TOKEN '')
      if [[ -z $token ]]; then printf '管理员初始化令牌：未配置。\n'; return; fi
      read -r -p '输入 SHOW 在当前 root 终端显示令牌：' answer
      [[ $answer == SHOW ]] || { printf '已取消显示。\n'; return; }
      printf '管理员初始化令牌：%s\n' "$token"
      unset token
      ;;
    2|3)
      env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"; port=$(public_port)
      if [[ $action == 2 ]]; then token=$(openssl rand -hex 32); set_env_value ADMIN_SETUP_TOKEN "$token"; unset token; else set_env_value ADMIN_SETUP_TOKEN ''; fi
      if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die '服务拒绝令牌修改，已恢复原值'; fi
      remove_temp_files "$env_backup"
      if [[ $action == 2 ]]; then printf '初始化令牌已轮换，需要时可选择“查看”显示。\n'; else printf '初始化令牌已清除。\n'; fi
      ;;
    *) die '未知选项' ;;
  esac
}

menu() {
  while true; do
    printf '\n=== 墨屿画布 / h 运维面板 ===\n1 查看状态与公网地址\n2 启动服务\n3 停止服务\n4 重启服务\n5 安全更新 Git 代码\n6 配置公网监听与端口\n7 配置域名与 HTTPS\n8 配置文字/视频中转\n9 配置商业参数与配额\n10 立即备份\n11 查看备份列表\n12 恢复备份\n13 查看日志\n14 运行诊断\n15 管理员初始化令牌\n0 退出\n'
    local choice; read -r -p '请选择：' choice || exit 0
    case $choice in 1) print_status ;; 2) service_action start ;; 3) service_action stop ;; 4) service_action restart ;; 5) safe_update ;; 6) configure_port ;; 7) configure_domain ;; 8) configure_relay ;; 9) configure_commercial ;; 10) backup_now ;; 11) list_backups ;; 12) restore_backup ;; 13) show_logs ;; 14) diagnose ;; 15) admin_token_menu ;; 0) exit 0 ;; *) printf '未知选项。\n' ;; esac
  done
}

case ${1:-} in
  -h|--help) usage ;;
  status) need_root; print_status ;;
  '') need_root; menu ;;
  *) usage; die "未知命令：$1" ;;
esac
