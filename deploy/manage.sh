#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${MOYU_INSTALL_DIR:-/opt/moyu-canvas}"
BACKUP_ROOT="${MOYU_BACKUP_ROOT:-/srv/canvas-backups}"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ ${SCRIPT_DIR##*/} == deploy && -f "$SCRIPT_DIR/../.env.example" ]]; then
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
valid_bind() { [[ $1 == 0.0.0.0 || $1 == 127.0.0.1 ]]; }
valid_domain() {
  local domain=$1 label
  [[ $domain =~ ^[A-Za-z0-9.-]+$ && ${#domain} -le 253 && $domain != .* && $domain != *. && $domain != *..* && $domain == *.* ]] || return 1
  IFS=. read -r -a labels <<< "$domain"
  for label in "${labels[@]}"; do [[ $label =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1; done
}

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
  [[ $ip =~ ^[0-9.]+$ ]] || ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  [[ -n $ip ]] && printf '%s' "$ip" || printf '%s' PUBLIC_IP
}

print_status() {
  need_install
  local bind=$(public_bind) port=$(current_port) ip=$(public_ip) domain=$(configured_domain)
  printf 'Moyu Canvas: %s\nBind: %s:%s -> container:3102\n' "$INSTALL_DIR" "$bind" "$port"
  if [[ -n $domain && $(domain_tls_enabled; echo $?) -eq 0 ]]; then printf 'Public URL: https://%s/\n' "$domain"; elif [[ -n $domain ]]; then printf 'Public URL: http://%s/\nWarning: HTTP is not encrypted. Configure HTTPS before using passwords or API keys.\n' "$domain"; else printf 'Public URL: http://%s:%s/\nWarning: HTTP is not encrypted. Configure HTTPS before using passwords or API keys.\n' "$ip" "$port"; fi
  if command -v docker >/dev/null 2>&1; then compose ps || true; else printf 'Docker: not installed\n'; fi
}

service_action() { need_install; case $1 in start) compose up -d ;; stop) compose stop ;; restart) compose restart ;; esac; print_status; }

safe_update() {
  need_install; command -v git >/dev/null 2>&1 || die 'git is required'
  local expected=${MOYU_BRANCH:-codex/infinite-canvas} branch head remote_head
  [[ $(cd "$INSTALL_DIR" && git remote get-url origin) == "${MOYU_REPO_URL:-https://github.com/bykedie/huabu.git}" ]] || die 'refusing update: origin does not match the expected repository'
  branch=$(cd "$INSTALL_DIR" && git branch --show-current); [[ $branch == $expected ]] || die "unexpected branch: $branch"
  [[ -z $(cd "$INSTALL_DIR" && git status --porcelain) ]] || die 'refusing update: repository has uncommitted changes'
  (cd "$INSTALL_DIR" && git fetch --prune origin "$branch")
  head=$(cd "$INSTALL_DIR" && git rev-parse HEAD); remote_head=$(cd "$INSTALL_DIR" && git rev-parse "origin/$branch")
  (cd "$INSTALL_DIR" && git merge-base --is-ancestor "$head" "$remote_head") || die 'refusing update: remote history is not a fast-forward'
  if [[ $head == $remote_head ]]; then printf 'Already up to date.\n'; return; fi
  [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"
  (cd "$INSTALL_DIR" && ./deploy/backup.sh "$BACKUP_ROOT")
  (cd "$INSTALL_DIR" && git merge --ff-only "$remote_head")
  compose up -d --build
}

configure_port() {
  need_install
  local bind port old_bind old_port domain env_backup site_backup site link nginx_tmp site_existed=0
  old_bind=$(public_bind)
  old_port=$(current_port)
  domain=$(configured_domain)
  site=/etc/nginx/sites-available/moyu-canvas
  link=/etc/nginx/sites-enabled/moyu-canvas
  read -r -p "Public bind [0.0.0.0/127.0.0.1] (current $old_bind): " bind
  bind=${bind:-$old_bind}
  valid_bind "$bind" || die 'bind must be 0.0.0.0 or 127.0.0.1'
  read -r -p "Public port 1-65535 (current $old_port): " port
  port=${port:-$old_port}
  valid_port "$port" || die 'port must be an integer from 1 to 65535'
  env_backup=$(mktemp)
  cp -a -- "$ENV_FILE" "$env_backup"
  site_backup=
  if [[ -n $domain ]]; then
    [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || { rm -f -- "$env_backup"; die 'deploy/nginx.conf not found'; }
    site_backup=$(mktemp)
    if [[ -f $site ]]; then cp -a -- "$site" "$site_backup"; site_existed=1; else : > "$site_backup"; fi
    nginx_tmp=$(mktemp)
    sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$nginx_tmp"
    mv -f -- "$nginx_tmp" "$site"
    ln -sfn -- "$site" "$link"
    if ! nginx -t; then
      cp -a -- "$env_backup" "$ENV_FILE"
      if (( site_existed )); then cp -a -- "$site_backup" "$site"; else rm -f -- "$site" "$link"; fi
      rm -f -- "$env_backup" "$site_backup"
      die 'nginx configuration failed; previous port and site restored'
    fi
  fi
  set_env_value PUBLIC_BIND "$bind"
  set_env_value PUBLIC_PORT "$((10#$port))"
  if ! compose up -d; then
    cp -a -- "$env_backup" "$ENV_FILE"
    if [[ -n $domain ]]; then
      if (( site_existed )); then cp -a -- "$site_backup" "$site"; else rm -f -- "$site" "$link"; fi
      nginx -t && systemctl reload nginx || true
    fi
    compose up -d || true
    rm -f -- "$env_backup" "$site_backup"
    die 'service restart failed; previous port and site restored'
  fi
  if [[ -n $domain ]] && ! systemctl reload nginx; then
    cp -a -- "$env_backup" "$ENV_FILE"
    if (( site_existed )); then cp -a -- "$site_backup" "$site"; else rm -f -- "$site" "$link"; fi
    nginx -t && systemctl reload nginx || true
    compose up -d || true
    rm -f -- "$env_backup" "$site_backup"
    die 'nginx reload failed; previous port and site restored'
  fi
  rm -f -- "$env_backup" "$site_backup"
  print_status
}

configure_domain() {
  need_install
  if ! command -v nginx >/dev/null 2>&1; then
    apt-get update
    apt-get install -y nginx
  fi
  systemctl enable --now nginx
  local domain email port site=/etc/nginx/sites-available/moyu-canvas link=/etc/nginx/sites-enabled/moyu-canvas backup=''
  read -r -p 'Domain (blank disables domain mode): ' domain
  if [[ -z $domain ]]; then rm -f -- "$link" "$site"; systemctl reload nginx 2>/dev/null || true; set_env_value MOYU_DOMAIN ''; set_env_value PUBLIC_DOMAIN ''; set_env_value MOYU_TLS 0; printf 'Domain mode disabled.\n'; return; fi
  valid_domain "$domain" || die 'invalid domain'
  read -r -p "Let's Encrypt email (blank for HTTP only): " email
  if [[ -n $email ]] && ! command -v certbot >/dev/null 2>&1; then
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
  fi
  port=$(public_port); [[ -f "$INSTALL_DIR/deploy/nginx.conf" ]] || die 'deploy/nginx.conf not found'
  if [[ -f $site ]]; then backup=$(mktemp); cp -a -- "$site" "$backup"; fi
  sed -e "s/__DOMAIN__/$domain/g" -e "s/__PUBLIC_PORT__/$port/g" "$INSTALL_DIR/deploy/nginx.conf" > "$site"; ln -sfn -- "$site" "$link"
  if ! nginx -t; then [[ -n $backup ]] && cp -a -- "$backup" "$site" || rm -f -- "$site" "$link"; rm -f -- "$backup"; die 'nginx configuration failed; previous configuration restored'; fi
  if ! systemctl reload nginx; then
    if [[ -n $backup ]]; then cp -a -- "$backup" "$site"; else rm -f -- "$site" "$link"; fi
    nginx -t && systemctl reload nginx || true
    rm -f -- "$backup"
    die 'nginx reload failed; previous configuration restored'
  fi
  if [[ -n $email ]]; then
    command -v certbot >/dev/null 2>&1 || { [[ -n $backup ]] && cp -a -- "$backup" "$site" || rm -f -- "$site" "$link"; nginx -t && systemctl reload nginx || true; rm -f -- "$backup"; die 'certbot is required for HTTPS'; }
    if ! certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"; then
      [[ -n $backup ]] && cp -a -- "$backup" "$site" || rm -f -- "$site" "$link"; nginx -t && systemctl reload nginx || true; rm -f -- "$backup"; die 'certificate request failed; previous configuration restored'
    fi
  fi
  rm -f -- "$backup"; set_env_value MOYU_DOMAIN "$domain"; set_env_value PUBLIC_DOMAIN ''; if [[ -n $email ]]; then set_env_value MOYU_TLS 1; else set_env_value MOYU_TLS 0; fi; printf 'Domain configured.\n'
}

configure_relay() {
  need_install; local kind base key models
  printf '1) Text relay  2) Video relay\n'; read -r -p 'Select: ' kind
  case $kind in
    1) read -r -p 'Text relay base URL: ' base; read -r -s -p 'Text relay API key (hidden): ' key; printf '\n'; read -r -p 'Text models (comma-separated): ' models; set_env_value AI_BASE_URL "$base"; set_env_value AI_API_KEY "$key"; set_env_value AI_MODELS "$models" ;;
    2) read -r -p 'Video relay base URL: ' base; read -r -s -p 'Video relay API key (hidden): ' key; printf '\n'; read -r -p 'Video models (comma-separated): ' models; set_env_value AI_VIDEO_BASE_URL "$base"; set_env_value AI_VIDEO_API_KEY "$key"; set_env_value AI_VIDEO_MODELS "$models" ;;
    *) die 'unknown relay selection' ;;
  esac
  unset key; compose up -d; printf 'Relay configuration saved without displaying the key.\n'
}

configure_commercial() {
  need_install; local welcome video max_canvas max_assets
  read -r -p 'Welcome points (integer): ' welcome; [[ $welcome =~ ^[0-9]+$ ]] || die 'invalid points'
  read -r -p 'Video points per generation (integer): ' video; [[ $video =~ ^[0-9]+$ ]] || die 'invalid points'
  read -r -p 'Max canvases per user: ' max_canvas; [[ $max_canvas =~ ^[1-9][0-9]*$ ]] || die 'invalid limit'
  read -r -p 'Max assets per user: ' max_assets; [[ $max_assets =~ ^[1-9][0-9]*$ ]] || die 'invalid limit'
  set_env_value WELCOME_POINTS "$welcome"; set_env_value AI_VIDEO_POINTS "$video"; set_env_value MAX_CANVASES_PER_USER "$max_canvas"; set_env_value MAX_ASSETS_PER_USER "$max_assets"; compose up -d; printf 'Commercial and quota settings saved.\n'
}

backup_now() { need_install; [[ -x "$INSTALL_DIR/deploy/backup.sh" ]] || chmod +x "$INSTALL_DIR/deploy/backup.sh"; (cd "$INSTALL_DIR" && ./deploy/backup.sh "$BACKUP_ROOT"); }
list_backups() { mkdir -p -- "$BACKUP_ROOT"; find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'canvas-*' -printf '%f\n' 2>/dev/null | sort -r || true; }
restore_backup() {
  need_install; local name target root_real target_real answer
  read -r -p 'Backup directory name: ' name; [[ $name == canvas-* && $name != */* && $name != *$'\\n'* ]] || die 'invalid backup name'
  root_real=$(realpath -m -- "$BACKUP_ROOT"); target_real=$(realpath -m -- "$BACKUP_ROOT/$name"); [[ $target_real == "$root_real/"* && -d $target_real ]] || die 'backup must be inside backup root'
  read -r -p 'Type RESTORE to confirm database replacement: ' answer; [[ $answer == RESTORE ]] || { printf 'Restore cancelled.\n'; return; }; "$INSTALL_DIR/deploy/restore.sh" "$target_real"
}
show_logs() { need_install; local mode; read -r -p '1) Recent logs  2) Follow logs: ' mode; [[ $mode == 2 ]] && compose logs -f --tail=100 app || compose logs --tail=200 app; }
diagnose() { need_install; printf '== Git ==\n'; (cd "$INSTALL_DIR" && git status --short --branch); printf '== Services ==\n'; compose ps; printf '== Health ==\n'; curl -fsS "http://127.0.0.1:$(public_port)/api/health" || true; printf '\n== Disk ==\n'; df -h "$INSTALL_DIR"; }
admin_token_menu() { need_install; local action token; printf '1) View status  2) Rotate  3) Clear\n'; read -r -p 'Select: ' action; case $action in 1) [[ -n $(env_value ADMIN_SETUP_TOKEN '') ]] && printf 'Administrator initialization token: configured (value hidden).\n' || printf 'Administrator initialization token: not configured.\n' ;; 2) token=$(openssl rand -hex 32); set_env_value ADMIN_SETUP_TOKEN "$token"; unset token; compose up -d; printf 'Initialization token rotated and kept hidden.\n' ;; 3) set_env_value ADMIN_SETUP_TOKEN ''; compose up -d; printf 'Initialization token cleared.\n' ;; *) die 'unknown selection' ;; esac; }

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
