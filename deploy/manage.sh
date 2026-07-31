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
Usage: h [status]

Interactive server management for Moyu Canvas. Run as root on Ubuntu/Debian.
Default access is HTTP at http://PUBLIC_IP:PUBLIC_PORT; HTTP is not encrypted.

Commands:
  status       Print service state and public URL
  -h, --help   Show this help
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_root() { [[ ${EUID:-$(id -u)} -eq 0 ]] || die 'root privileges are required'; }
need_install() { [[ -d "$INSTALL_DIR" ]] || die "install directory not found: $INSTALL_DIR"; [[ -f "$ENV_FILE" ]] || die "configuration file not found: $ENV_FILE"; }

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
  [[ $value != *$'\n'* && $value != *$'\r'* ]] || die "$key may not contain a newline"
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
  [[ $requested == /* ]] || die 'backup root must be an absolute path'
  root=$(realpath -m -- "$requested")
  install_real=$(realpath -m -- "$INSTALL_DIR")
  case $root in "$install_real"|"$install_real"/*) die 'backup root must be outside the install directory' ;; esac
  mkdir -p -- "$root"
  root=$(cd -- "$root" && pwd -P)
  case $root in "$install_real"|"$install_real"/*) die 'backup root resolves inside the install directory' ;; esac
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
  printf 'Moyu Canvas: %s\nBind: %s:%s -> container:3102\n' "$INSTALL_DIR" "$bind" "$port"
  if [[ -n $domain ]] && domain_tls_enabled; then printf 'Public URL: https://%s/\n' "$domain"; elif [[ -n $domain ]]; then printf 'Public URL: http://%s/\nWarning: HTTP is not encrypted. Configure HTTPS before using passwords or API keys.\n' "$domain"; else printf 'Public URL: http://%s:%s/\nWarning: HTTP is not encrypted. Configure HTTPS before using passwords or API keys.\n' "$ip" "$port"; fi
  if command -v docker >/dev/null 2>&1; then compose ps || true; else printf 'Docker: not installed\n'; fi
}

service_action() { need_install; case $1 in start) compose up -d ;; stop) compose stop ;; restart) compose restart ;; esac; print_status; }

safe_update() {
  need_install; command -v git >/dev/null 2>&1 || die 'git is required'
  local expected=${MOYU_BRANCH:-codex/infinite-canvas} branch head remote_head backup_root port
  git check-ref-format --branch "$expected" >/dev/null 2>&1 || die 'invalid expected deployment branch'
  [[ $(cd "$INSTALL_DIR" && git remote get-url origin) == "${MOYU_REPO_URL:-https://github.com/bykedie/huabu.git}" ]] || die 'refusing update: origin does not match the expected repository'
  branch=$(cd "$INSTALL_DIR" && git branch --show-current); [[ $branch == $expected ]] || die "unexpected branch: $branch"
  [[ -z $(cd "$INSTALL_DIR" && git status --porcelain) ]] || die 'refusing update: repository has uncommitted changes'
  (cd "$INSTALL_DIR" && git fetch --prune origin "$branch")
  head=$(cd "$INSTALL_DIR" && git rev-parse HEAD); remote_head=$(cd "$INSTALL_DIR" && git rev-parse FETCH_HEAD)
  (cd "$INSTALL_DIR" && git merge-base --is-ancestor "$head" "$remote_head") || die 'refusing update: remote history is not a fast-forward'
  if [[ $head == $remote_head ]]; then printf 'Already up to date.\n'; return; fi
  backup_root=$(backup_root_path); port=$(public_port)
  [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"
  (cd "$INSTALL_DIR" && ./deploy/backup.sh "$backup_root")
  (cd "$INSTALL_DIR" && git merge --ff-only "$remote_head")
  if ! compose up -d --build || ! wait_for_health "$port"; then
    if (cd "$INSTALL_DIR" && git update-ref "refs/heads/$branch" "$head" "$remote_head" \
      && git read-tree --reset -u "$head" && [[ -z $(git status --porcelain) ]]) \
      && compose up -d --build && wait_for_health "$port"; then
      die "update failed health checks and was rolled back to $head; the validated backup remains under $backup_root"
    fi
    die "update failed and automatic code rollback did not restore health; use the validated backup under $backup_root"
  fi
}

configure_port() {
  need_install
  local bind port old_bind old_port domain env_backup site_backup='' site link nginx_tmp=''
  local site_existed=0 link_existed=0 link_target=''
  old_bind=$(public_bind); old_port=$(current_port); domain=$(configured_domain)
  site=/etc/nginx/sites-available/moyu-canvas; link=/etc/nginx/sites-enabled/moyu-canvas
  read -r -p "Public bind [0.0.0.0/127.0.0.1] (current $old_bind): " bind
  bind=${bind:-$old_bind}; valid_bind "$bind" || die 'bind must be 0.0.0.0 or 127.0.0.1'
  read -r -p "Public port 1-65535 (current $old_port): " port
  port=${port:-$old_port}; valid_port "$port" || die 'port must be an integer from 1 to 65535'
  port=$((10#$port))
  if [[ -n $domain ]]; then
    [[ $bind == 127.0.0.1 ]] || die 'domain mode requires PUBLIC_BIND=127.0.0.1'
    [[ $port -ne 80 && $port -ne 443 ]] || die 'domain mode cannot use application port 80 or 443'
    [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || die 'deploy/nginx.conf not found'
    if [[ -L $link ]]; then link_existed=1; link_target=$(readlink -- "$link"); elif [[ -e $link ]]; then die "nginx enable path is not a symlink: $link"; fi
    if [[ -f $site ]]; then site_existed=1; site_backup=$(mktemp); cp -a -- "$site" "$site_backup"; fi
    nginx_tmp=$(mktemp)
    if (( site_existed )); then
      sed -E "s|^[[:space:]]*proxy_pass[[:space:]]+http://127[.]0[.]0[.]1:[0-9]+;|        proxy_pass http://127.0.0.1:${port};|" "$site" > "$nginx_tmp"
    else
      sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$nginx_tmp"
    fi
    grep -q "proxy_pass http://127.0.0.1:${port};" "$nginx_tmp" || { remove_temp_files "$site_backup" "$nginx_tmp"; die 'nginx proxy port could not be updated'; }
    chmod 644 "$nginx_tmp"; mv -f -- "$nginx_tmp" "$site"; nginx_tmp=''
    rm -f -- "$link"; ln -s -- "$site" "$link"
    if ! nginx -t; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; remove_temp_files "$site_backup"; die 'nginx configuration failed; previous site restored'; fi
  fi
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"
  set_env_value PUBLIC_BIND "$bind"; set_env_value PUBLIC_PORT "$port"
  if ! compose up -d || ! wait_for_health "$port"; then
    cp -a -- "$env_backup" "$ENV_FILE"
    if [[ -n $domain ]]; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; nginx -t && systemctl reload nginx || true; fi
    compose up -d || true; wait_for_health "$old_port" || true
    remove_temp_files "$env_backup" "$site_backup" "$nginx_tmp"
    die 'service failed on the new port; previous configuration restored'
  fi
  if [[ -n $domain ]] && ! systemctl reload nginx; then
    cp -a -- "$env_backup" "$ENV_FILE"; restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"
    compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die 'nginx reload failed; previous configuration restored'
  fi
  if [[ $bind == 0.0.0.0 ]] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then ufw allow "${port}/tcp" comment 'Moyu Canvas public port' >/dev/null; fi
  remove_temp_files "$env_backup" "$site_backup"; print_status
}

configure_domain() {
  need_install
  local domain email='' port old_port env_backup site_backup='' nginx_tmp=''
  local site=/etc/nginx/sites-available/moyu-canvas link=/etc/nginx/sites-enabled/moyu-canvas
  local site_existed=0 link_existed=0 link_target=''
  read -r -p 'Domain (blank disables domain mode): ' domain
  port=$(public_port); old_port=$port
  if [[ -n $domain ]]; then
    valid_domain "$domain" || die 'invalid domain'
    [[ $port -ne 80 && $port -ne 443 ]] || die 'domain mode cannot use application port 80 or 443'
    read -r -p "Let's Encrypt email (blank for HTTP only): " email
    [[ -z $email ]] || valid_email "$email" || die 'invalid certificate email'
    [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || die 'deploy/nginx.conf not found'
    apt-get update
    if [[ -n $email ]]; then apt-get install -y nginx certbot python3-certbot-nginx; else apt-get install -y nginx; fi
  fi
  if [[ -L $link ]]; then link_existed=1; link_target=$(readlink -- "$link"); elif [[ -e $link ]]; then die "nginx enable path is not a symlink: $link"; fi
  if [[ -f $site ]]; then site_existed=1; site_backup=$(mktemp); cp -a -- "$site" "$site_backup"; fi
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"
  if [[ -z $domain ]]; then
    set_env_value MOYU_DOMAIN ''; set_env_value PUBLIC_DOMAIN ''; set_env_value MOYU_TLS 0; set_env_value PUBLIC_BIND 0.0.0.0
    if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; remove_temp_files "$env_backup" "$site_backup"; die 'failed to restore public-port mode'; fi
    rm -f -- "$link" "$site"
    if command -v nginx >/dev/null 2>&1 && ! nginx -t; then restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; remove_temp_files "$env_backup" "$site_backup"; die 'nginx validation failed; domain mode was not disabled'; fi
    if command -v nginx >/dev/null 2>&1 && ! systemctl reload nginx; then
      restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"
      cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true
      nginx -t && systemctl reload nginx || true
      remove_temp_files "$env_backup" "$site_backup"; die 'nginx reload failed; domain mode was not disabled'
    fi
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then ufw allow "${port}/tcp" comment 'Moyu Canvas public port' >/dev/null; fi
    remove_temp_files "$env_backup" "$site_backup"; printf 'Domain mode disabled; public IP and port mode restored.\n'; print_status; return
  fi
  nginx_tmp=$(mktemp); sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$nginx_tmp"; chmod 644 "$nginx_tmp"
  set_env_value PUBLIC_BIND 127.0.0.1; set_env_value MOYU_DOMAIN "$domain"; set_env_value PUBLIC_DOMAIN ''; if [[ -n $email ]]; then set_env_value MOYU_TLS 1; else set_env_value MOYU_TLS 0; fi
  if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; remove_temp_files "$env_backup" "$site_backup" "$nginx_tmp"; die 'application failed after enabling domain mode; previous configuration restored'; fi
  mv -f -- "$nginx_tmp" "$site"; nginx_tmp=''; rm -f -- "$link"; ln -s -- "$site" "$link"
  if ! nginx -t || ! systemctl enable --now nginx || ! systemctl reload nginx; then
    restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die 'nginx failed; previous domain and bind configuration restored'
  fi
  if [[ -n $email ]] && ! certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"; then
    restore_nginx_state "$site" "$site_existed" "$site_backup" "$link" "$link_existed" "$link_target"; cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$old_port" || true; nginx -t && systemctl reload nginx || true
    remove_temp_files "$env_backup" "$site_backup"; die 'certificate request failed; previous domain and bind configuration restored'
  fi
  remove_temp_files "$env_backup" "$site_backup"; printf 'Domain configured.\n'; print_status
}

configure_relay() {
  need_install; local kind relay_kind base key models key_action
  printf '1) Text relay  2) Video relay\n'; read -r -p 'Select: ' kind
  case $kind in
    1) relay_kind=text ;;
    2) relay_kind=video ;;
    *) die 'unknown relay selection' ;;
  esac
  read -r -p 'Relay base URL (HTTPS in production): ' base
  read -r -p 'Models (comma-separated): ' models
  read -r -s -p 'API key (hidden; blank keeps current, type CLEAR to clear): ' key; printf '\n'
  if [[ $key == CLEAR ]]; then key_action=clear; key=''; elif [[ -z $key ]]; then key_action=keep; else key_action=set; fi
  [[ $base != *$'\n'* && $base != *$'\r'* && $models != *$'\n'* && $models != *$'\r'* && $key != *$'\n'* && $key != *$'\r'* ]] || die 'relay values may not contain line breaks'
  printf '%s\0%s\0%s\0%s\0' "$base" "$models" "$key_action" "$key" | compose run --rm -T --no-deps app node server/manage-config.js relay "$relay_kind"
  if [[ $relay_kind == text ]]; then set_env_value AI_API_KEY ''; else set_env_value AI_VIDEO_API_KEY ''; fi
  unset key
  compose up -d --force-recreate app
  wait_for_health "$(public_port)" || die 'relay configuration was saved, but the recreated application did not become healthy'
  printf 'Relay configuration saved without displaying the key.\n'
}

configure_commercial() {
  need_install; local welcome video max_canvas max_assets env_backup port
  read -r -p 'Welcome points (0-10000000): ' welcome; valid_integer_range "$welcome" 0 10000000 || die 'invalid welcome points'
  read -r -p 'Video points per generation (1-1000000): ' video; valid_integer_range "$video" 1 1000000 || die 'invalid video points'
  read -r -p 'Max canvases per user (1-10000): ' max_canvas; valid_integer_range "$max_canvas" 1 10000 || die 'invalid canvas limit'
  read -r -p 'Max assets per user (1-10000): ' max_assets; valid_integer_range "$max_assets" 1 10000 || die 'invalid asset limit'
  welcome=$((10#$welcome)); video=$((10#$video)); max_canvas=$((10#$max_canvas)); max_assets=$((10#$max_assets))
  env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"; port=$(public_port)
  set_env_value WELCOME_POINTS "$welcome"; set_env_value AI_VIDEO_POINTS "$video"; set_env_value MAX_CANVASES_PER_USER "$max_canvas"; set_env_value MAX_ASSETS_PER_USER "$max_assets"
  if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die 'service rejected the commercial settings; previous environment restored'; fi
  if ! compose run --rm -T --no-deps app node server/manage-config.js video-points "$video"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die 'database rejected the video point setting; previous environment restored'; fi
  remove_temp_files "$env_backup"; printf 'Commercial and quota settings saved.\n'
}

backup_now() { local root; need_install; root=$(backup_root_path); [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"; (cd "$INSTALL_DIR" && ./deploy/backup.sh "$root"); }
list_backups() { local root; need_install; root=$(backup_root_path); find "$root" -mindepth 1 -maxdepth 1 -type d -name 'canvas-*' -printf '%f\n' 2>/dev/null | sort -r || true; }
restore_backup() {
  need_install; local name root_real target_real answer
  root_real=$(backup_root_path)
  read -r -p 'Backup directory name: ' name; [[ $name =~ ^canvas-[A-Za-z0-9._-]+$ ]] || die 'invalid backup name'
  [[ -d "$root_real/$name" ]] || die 'backup directory not found'
  target_real=$(cd -- "$root_real/$name" && pwd -P); [[ $target_real == "$root_real/"* ]] || die 'backup symlink resolves outside the backup root'
  read -r -p 'Type RESTORE to confirm database replacement: ' answer; [[ $answer == RESTORE ]] || { printf 'Restore cancelled.\n'; return; }; "$INSTALL_DIR/deploy/restore.sh" "$target_real"
}
show_logs() { need_install; local mode; read -r -p '1) Recent logs  2) Follow logs: ' mode; [[ $mode == 2 ]] && compose logs -f --tail=100 app || compose logs --tail=200 app; }
diagnose() { need_install; printf '== Git ==\n'; (cd "$INSTALL_DIR" && git status --short --branch); printf '== Services ==\n'; compose ps; printf '== Health ==\n'; curl -fsS "http://127.0.0.1:$(public_port)/api/health" || true; printf '\n== Disk ==\n'; df -h "$INSTALL_DIR"; }
admin_token_menu() {
  need_install
  local action token answer env_backup port
  printf '1) View  2) Rotate  3) Clear\n'; read -r -p 'Select: ' action
  case $action in
    1)
      token=$(env_value ADMIN_SETUP_TOKEN '')
      if [[ -z $token ]]; then printf 'Administrator initialization token: not configured.\n'; return; fi
      read -r -p 'Type SHOW to display the token in this root terminal: ' answer
      [[ $answer == SHOW ]] || { printf 'Display cancelled.\n'; return; }
      printf 'Administrator initialization token: %s\n' "$token"
      unset token
      ;;
    2|3)
      env_backup=$(mktemp); cp -a -- "$ENV_FILE" "$env_backup"; port=$(public_port)
      if [[ $action == 2 ]]; then token=$(openssl rand -hex 32); set_env_value ADMIN_SETUP_TOKEN "$token"; unset token; else set_env_value ADMIN_SETUP_TOKEN ''; fi
      if ! compose up -d || ! wait_for_health "$port"; then cp -a -- "$env_backup" "$ENV_FILE"; compose up -d || true; wait_for_health "$port" || true; remove_temp_files "$env_backup"; die 'service rejected the token change; previous value restored'; fi
      remove_temp_files "$env_backup"
      if [[ $action == 2 ]]; then printf 'Initialization token rotated. Use View to display it when needed.\n'; else printf 'Initialization token cleared.\n'; fi
      ;;
    *) die 'unknown selection' ;;
  esac
}

menu() {
  while true; do
    printf '\n=== Moyu Canvas / h ===\n1 Status and public URL\n2 Start service\n3 Stop service\n4 Restart service\n5 Safe Git update\n6 Public bind and port\n7 Domain and HTTPS\n8 Text/video relay settings\n9 Commercial and quota settings\n10 Backup now\n11 List backups\n12 Restore backup\n13 Logs\n14 Diagnostics\n15 Administrator initialization token\n0) Exit\n'
    local choice; read -r -p 'Select: ' choice || exit 0
    case $choice in 1) print_status ;; 2) service_action start ;; 3) service_action stop ;; 4) service_action restart ;; 5) safe_update ;; 6) configure_port ;; 7) configure_domain ;; 8) configure_relay ;; 9) configure_commercial ;; 10) backup_now ;; 11) list_backups ;; 12) restore_backup ;; 13) show_logs ;; 14) diagnose ;; 15) admin_token_menu ;; 0) exit 0 ;; *) printf 'Unknown selection.\n' ;; esac
  done
}

case ${1:-} in
  -h|--help) usage ;;
  status) need_root; print_status ;;
  '') need_root; menu ;;
  *) usage; die "unknown command: $1" ;;
esac
