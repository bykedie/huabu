import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const secret = 'jwt-secret-that-is-longer-than-thirty-two-bytes'
const setupToken = 'admin-setup-token-longer-than-thirty-two-bytes'
const clearedChildEnvironment = new Set([
  'JWT_SECRET', 'ADMIN_SETUP_TOKEN',
  'SITE_BILLING_ENABLED',
  'AI_BASE_URL', 'AI_API_KEY', 'AI_IMAGE_BASE_URL', 'AI_IMAGE_API_KEY',
  'AI_VIDEO_BASE_URL', 'AI_VIDEO_API_KEY', 'AI_VIDEO_MEDIA_ORIGINS',
  'PUBLIC_BIND', 'MOYU_ACCESS_MODE', 'MOYU_DOMAIN', 'PUBLIC_DOMAIN',
])
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !clearedChildEnvironment.has(key.toUpperCase())),
)

function runApp(env = {}, script = "await import('./server/app.js')", databaseDirectory) {
  const temp = databaseDirectory || mkdtempSync(join(tmpdir(), 'ink-production-'))
  try {
    return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...childEnvironment,
        NODE_ENV: 'production',
        DB_PATH: join(temp, 'test.db'),
        JWT_SECRET: secret,
        ADMIN_SETUP_TOKEN: setupToken,
        ...env,
      },
    })
  } finally {
    if (!databaseDirectory) rmSync(temp, { recursive: true, force: true })
  }
}

function runDatabaseCheck(databasePath, allowLegacy = false, env = { JWT_SECRET: secret }) {
  return spawnSync(process.execPath, ['server/check-db.js', ...(allowLegacy ? ['--allow-legacy'] : []), databasePath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...childEnvironment, ...env },
  })
}

test('production refuses unsafe secrets and invalid billing settings', () => {
  const weakJwt = runApp({ JWT_SECRET: 'change-me' })
  assert.notEqual(weakJwt.status, 0)
  assert.match(weakJwt.stderr, /JWT_SECRET/)

  const weakSetupToken = runApp({ ADMIN_SETUP_TOKEN: 'replace-me' })
  assert.notEqual(weakSetupToken.status, 0)
  assert.match(weakSetupToken.stderr, /ADMIN_SETUP_TOKEN/)

  const invalidBilling = runApp({ CENTS_PER_POINT: '0' })
  assert.notEqual(invalidBilling.status, 0)
  assert.match(invalidBilling.stderr, /CENTS_PER_POINT/)

  const invalidSiteBilling = runApp({ SITE_BILLING_ENABLED: 'yes' })
  assert.notEqual(invalidSiteBilling.status, 0)
  assert.match(invalidSiteBilling.stderr, /SITE_BILLING_ENABLED/)

  const invalidStorage = runApp({ MAX_CANVAS_BYTES: '2048', MAX_USER_STORAGE_BYTES: '1024' })
  assert.notEqual(invalidStorage.status, 0)
  assert.match(invalidStorage.stderr, /MAX_USER_STORAGE_BYTES/)

  const excessiveAiTimeout = runApp({ AI_TIMEOUT_MS: '120001' })
  assert.notEqual(excessiveAiTimeout.status, 0)
  assert.match(excessiveAiTimeout.stderr, /AI_TIMEOUT_MS/)

  const excessiveImageTimeout = runApp({ AI_IMAGE_TIMEOUT_MS: '300001' })
  assert.notEqual(excessiveImageTimeout.status, 0)
  assert.match(excessiveImageTimeout.stderr, /AI_IMAGE_TIMEOUT_MS/)

  const prematureRecovery = runApp({ AI_TIMEOUT_MS: '120000', AI_PENDING_RECOVERY_MS: '129999' })
  assert.notEqual(prematureRecovery.status, 0)
  assert.match(prematureRecovery.stderr, /AI_PENDING_RECOVERY_MS/)

  const prematureImageRecovery = runApp({ AI_IMAGE_TIMEOUT_MS: '300000', AI_IMAGE_PENDING_RECOVERY_MS: '309999' })
  assert.notEqual(prematureImageRecovery.status, 0)
  assert.match(prematureImageRecovery.stderr, /AI_IMAGE_PENDING_RECOVERY_MS/)

  const prematureVideoRecovery = runApp({ AI_VIDEO_TIMEOUT_MS: '60000', AI_VIDEO_PENDING_RECOVERY_MS: '69999' })
  assert.notEqual(prematureVideoRecovery.status, 0)
  assert.match(prematureVideoRecovery.stderr, /AI_VIDEO_PENDING_RECOVERY_MS/)

  const insufficientMediaStorage = runApp({ AI_IMAGE_MAX_RESPONSE_BYTES: '4096', AI_VIDEO_MAX_RESPONSE_BYTES: '2048', MAX_USER_MEDIA_BYTES: '4095' })
  assert.notEqual(insufficientMediaStorage.status, 0)
  assert.match(insufficientMediaStorage.stderr, /MAX_USER_MEDIA_BYTES/)
})

test('production environment example exposes current video and media settings', () => {
  const exampleKeys = new Set(readFileSync(join(root, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter(Boolean))
  for (const key of [
    'SITE_BILLING_ENABLED', 'AI_IMAGE_TIMEOUT_MS', 'AI_IMAGE_PENDING_RECOVERY_MS',
    'AI_VIDEO_BASE_URL', 'AI_VIDEO_MODELS', 'AI_VIDEO_POINTS',
    'AI_VIDEO_TIMEOUT_MS', 'AI_VIDEO_POLL_MS', 'AI_VIDEO_PENDING_RECOVERY_MS',
    'AI_VIDEO_MAX_RESPONSE_BYTES', 'AI_VIDEO_MEDIA_ORIGINS', 'MAX_USER_MEDIA_BYTES',
  ]) assert.equal(exampleKeys.has(key), true, `${key} is missing from .env.example`)
  for (const key of ['AI_API_KEY', 'AI_IMAGE_API_KEY', 'AI_VIDEO_API_KEY']) {
    assert.equal(exampleKeys.has(key), false, `${key} must not be required by the deployment example`)
  }
})

test('public HTTP UUID fallback and account security do not depend on hidden relay endpoints', () => {
  const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8')
  const uuidSource = readFileSync(join(root, 'src', 'uuid.ts'), 'utf8')
  const accountStart = appSource.indexOf('function AccountDrawer')
  const accountEnd = appSource.indexOf('function AdminDrawer', accountStart)
  assert.notEqual(accountStart, -1, 'AccountDrawer is missing')
  assert.notEqual(accountEnd, -1, 'AccountDrawer boundary is missing')
  const accountSource = appSource.slice(accountStart, accountEnd)
  const assetsDirectory = join(root, 'dist', 'assets')
  const builtScripts = existsSync(assetsDirectory)
    ? readdirSync(assetsDirectory)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assetsDirectory, name), 'utf8'))
      .join('\n')
    : ''

  assert.doesNotMatch(appSource, /(?<![?.])\bcrypto\.randomUUID\s*\(/)
  assert.match(appSource, /import \{[^}]*\bcreateUuid\b[^}]*\} from ['"]\.\/uuid['"]/)
  assert.match(uuidSource, /typeof cryptoApi\?\.randomUUID === ['"]function['"]/)
  assert.match(uuidSource, /getRandomValues/)
  assert.match(uuidSource, /fallbackCounter/)
  assert.doesNotMatch(accountSource, /imageEndpoint|当前端点|中转端点|relay endpoint/i)
  assert.doesNotMatch(builtScripts, /crypto\.randomUUID\s*\(/)
  assert.doesNotMatch(builtScripts, /当前端点/)
})

test('public-port deployment and h management preserve the production contract', () => {
  const installer = readFileSync(join(root, 'deploy', 'install.sh'), 'utf8')
  const manager = readFileSync(join(root, 'deploy', 'manage.sh'), 'utf8')
  const managerConfig = readFileSync(join(root, 'server', 'manage-config.js'), 'utf8')
  const backup = readFileSync(join(root, 'deploy', 'backup.sh'), 'utf8')
  const restore = readFileSync(join(root, 'deploy', 'restore.sh'), 'utf8')
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
  const envExample = readFileSync(join(root, '.env.example'), 'utf8')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')

  assert.match(installer, /^#!\/usr\/bin\/env bash\r?\nset -Eeuo pipefail/m)
  assert.match(installer, /public_port=3102/)
  assert.match(installer, /public_bind=0\.0\.0\.0/)
  assert.match(installer, /--port/)
  assert.match(installer, /--bind/)
  assert.match(installer, /0\.0\.0\.0.*127\.0\.0\.1/)
  assert.match(installer, /validate_port/)
  assert.match(installer, /--domain 表示仅域名访问，必须使用 --bind 127\.0\.0\.1/)
  assert.match(installer, /access_mode=public/)
  assert.match(installer, /public\|domain\|both\|private/)
  assert.match(installer, /set_env_value MOYU_ACCESS_MODE/)
  assert.match(installer, /old_domain.*old_bind == 127\.0\.0\.1.*old_mode=domain/s)
  assert.match(installer, /old_domain.*old_mode=both/s)
  assert.match(installer, /old_bind == 127\.0\.0\.1.*old_mode=private/s)
  assert.match(installer, /access_mode == public \|\| \$access_mode == private/)
  assert.match(installer, /rm -f -- "\$rollback_site_link"/)
  assert.match(installer, /if \[\[ -n \$domain \]\]/)
  assert.match(installer, /apt_packages=\(ca-certificates curl git openssl\)/)
  assert.match(installer, /certbot --nginx --non-interactive --agree-tos --redirect/)
  assert.match(installer, /--register-unsafely-without-email/)
  assert.ok(installer.includes('[[ -z $email || $email =~'))
  assert.match(installer, /__DOMAIN__/)
  assert.match(installer, /__PUBLIC_PORT__/)
  assert.match(installer, /status --porcelain/)
  assert.match(installer, /merge-base --is-ancestor HEAD FETCH_HEAD/)
  assert.match(installer, /merge --ff-only FETCH_HEAD/)
  assert.match(installer, /backup_deployment/)
  assert.match(installer, /rollback_install/)
  assert.match(installer, /git -C "\$install_dir" update-ref/)
  assert.match(installer, /preserve_domain_config/)
  assert.match(installer, /rollback_site_captured -eq 1/)
  assert.match(installer, /! nginx -t \|\| ! systemctl reload nginx; then rollback_ok=1/)
  assert.match(installer, /public_fallback_active/)
  assert.match(installer, /回退地址使用未加密 HTTP/)
  assert.match(installer, /keep_recovery_files/)
  assert.match(installer, /chmod 600 "\$rollback_env_backup"/)
  assert.match(installer, /chmod 600 "\$rollback_site_backup"/)
  assert.match(installer, /http:\/\/127\.0\.0\.1:\$\{port\}/)
  assert.match(installer, /\/usr\/local\/bin\/h/)
  assert.match(installer, /拒绝覆盖|not this project|not this project's command/)
  assert.match(installer, /公网传输未加密|public HTTP is not encrypted/)
  assert.match(compose, /\$\{PUBLIC_BIND:-0\.0\.0\.0\}:\$\{PUBLIC_PORT:-3102\}:3102/)
  assert.match(envExample, /^PUBLIC_BIND=0\.0\.0\.0$/m)
  assert.match(envExample, /^PUBLIC_PORT=3102$/m)
  assert.match(envExample, /^MOYU_ACCESS_MODE=public$/m)
  assert.match(envExample, /^AI_IMAGE_BASE_URL=$/m)
  assert.match(envExample, /^MOYU_DOMAIN=$/m)
  assert.match(envExample, /^MOYU_TLS=0$/m)
  assert.match(envExample, /^MOYU_BACKUP_ROOT=\/srv\/canvas-backups$/m)
  assert.match(envExample, /^SITE_BILLING_ENABLED=0$/m)
  assert.match(envExample, /^AI_MODELS=$/m)
  assert.match(envExample, /^AI_IMAGE_MODELS=$/m)
  assert.match(compose, /SITE_BILLING_ENABLED: "\$\{SITE_BILLING_ENABLED:-0\}"/)
  assert.match(compose, /AI_MODELS: "\$\{AI_MODELS:-\}"/)
  assert.match(compose, /AI_IMAGE_BASE_URL: "\$\{AI_IMAGE_BASE_URL:-\}"/)
  assert.match(compose, /AI_IMAGE_MODELS: "\$\{AI_IMAGE_MODELS:-\}"/)
  assert.match(compose, /AI_IMAGE_TIMEOUT_MS: "\$\{AI_IMAGE_TIMEOUT_MS:-300000\}"/)
  assert.match(compose, /AI_IMAGE_PENDING_RECOVERY_MS: "\$\{AI_IMAGE_PENDING_RECOVERY_MS:-360000\}"/)
  assert.match(readFileSync(join(root, 'deploy', 'nginx.conf'), 'utf8'), /proxy_read_timeout 310s;/)
  assert.doesNotMatch(envExample, /^AI_(?:VIDEO_)?API_KEY=/m)
  for (const key of ['AI_API_KEY', 'AI_IMAGE_API_KEY', 'AI_VIDEO_API_KEY']) {
    assert.doesNotMatch(compose, new RegExp(`^\\s*${key}:`, 'm'))
    assert.doesNotMatch(compose, new RegExp(`\\$\\{${key}(?=[:}])`))
  }
  assert.doesNotMatch(readme, /^AI_(?:VIDEO_)?API_KEY=/m)

  for (const script of [backup, restore]) {
    assert.match(script, /PUBLIC_PORT/)
    assert.match(script, /127\.0\.0\.1:\$\{public_port\}/)
    assert.doesNotMatch(script, /127\.0\.0\.1:3102\/api\/health/)
  }
  assert.match(backup, /backup_root=\$\(cd "\$backup_root" && pwd -P\)\r?\ncase "\$backup_root" in/)
  assert.match(backup, /docker compose run --rm -T --no-deps --user 0:0 -v "\$backup_dir:\/backup:ro"/)
  assert.match(installer, /docker compose run --rm -T --no-deps --user 0:0 -v "\$backup_dir:\/backup:ro"/)
  for (const mount of [
    '\\$source_dir:/restore:ro',
    '\\$candidate_dir:/candidate:ro',
    '\\$candidate_dir:/candidate',
    '\\$rollback_dir:/rollback:ro',
  ]) {
    assert.match(restore, new RegExp(`docker compose run --rm -T --no-deps --user 0:0 -v \"${mount}\"`))
  }
  assert.match(restore, /owner=\$\(stat -c "%u:%g" \/app\)/)
  assert.match(restore, /chown "\$owner" \/app\/data\/app\.db/)

  for (const phrase of ['status', 'start', 'stop', 'restart', 'safe_update', 'configure_port', 'configure_access_mode', 'configure_commercial', 'backup_now', 'list_backups', 'restore_backup', 'show_logs', 'diagnose', 'admin_token_menu']) {
    assert.match(manager, new RegExp(phrase), phrase + ' is missing from h manager')
  }
  assert.doesNotMatch(manager, /configure_relay|server\/manage-config\.js relay/)
  for (const label of [
    '查看状态与公网地址', '启动服务', '停止服务', '重启服务', '安全更新 Git 代码',
    '管理访问方式', '修改应用端口', '配置商业参数与配额',
    '立即备份', '查看备份列表', '恢复备份', '查看日志', '运行诊断', '管理员初始化令牌',
  ]) assert.match(manager, new RegExp(label), `${label} is missing from the localized h menu`)
  for (const label of ['配置文字中转', '配置图片中转', '配置视频中转']) assert.doesNotMatch(manager, new RegExp(label))
  assert.match(manager, /输入 RESTORE 确认替换数据库/)
  assert.match(manager, /输入 SHOW 在当前 root 终端显示令牌/)
  assert.doesNotMatch(manager, /Status and public URL|Start service|Safe Git update|Commercial and quota settings|Administrator initialization token/)
  assert.match(manager, /backup_root_path/)
  assert.match(manager, /Let's Encrypt 通知邮箱（可留空）/)
  assert.match(manager, /apt-get install -y nginx certbot python3-certbot-nginx/)
  assert.ok(manager.includes('certbot_contact=(--register-unsafely-without-email)'))
  assert.doesNotMatch(manager, /留空则仅配置 HTTP/)
  assert.match(manager, /8\) configure_commercial/)
  assert.match(manager, /9\) backup_now/)
  assert.match(manager, /14\) admin_token_menu/)
  assert.match(manager, /中转地址与开放模型统一在网站“运营管理”中配置/)
  assert.match(manager, /server\/manage-config\.js admin-status/)
  assert.match(managerConfig, /admin_password_encrypted/)
  assert.match(managerConfig, /管理员密码/)
  assert.match(manager, /wait_for_health "\$port"/)
  for (const mapping of [
    /1\) mode=public; bind=0\.0\.0\.0/,
    /2\) mode=domain; bind=127\.0\.0\.1/,
    /3\) mode=both; bind=0\.0\.0\.0/,
    /4\) mode=private; bind=127\.0\.0\.1/,
  ]) assert.match(manager, mapping)
  assert.match(manager, /rm -f -- "\$link"/)
  assert.doesNotMatch(manager, /rm -f -- "\$link" "\$site"/)
  assert.match(manager, /systemctl is-active --quiet nginx/)
  assert.match(manager, /git rev-parse FETCH_HEAD/)
  assert.match(manager, /git update-ref/)
  assert.match(manager, /git read-tree --reset -u/)
  assert.doesNotMatch(manager, /read -r -s|key_action|输入 CLEAR 清除|printf ['"]%s\0%s\0%s\0%s\0/)
  assert.doesNotMatch(manager, /set_env_value AI_(?:IMAGE_)?API_KEY|set_env_value AI_VIDEO_API_KEY/)
  assert.match(manager, /__DOMAIN__/)
  assert.match(manager, /__PUBLIC_PORT__/)
  assert.match(managerConfig, /text: \['ai_base_url', 'ai_models'\]/)
  assert.match(managerConfig, /image: \['ai_image_base_url', 'ai_image_models'\]/)
  assert.match(managerConfig, /video: \['ai_video_base_url', 'ai_video_models'\]/)
  assert.doesNotMatch(managerConfig, /createCipheriv|ai_api_key_encrypted|ai_video_api_key_encrypted|AI_API_KEY|AI_VIDEO_API_KEY|keyAction|keyInput/)
  assert.match(managerConfig, /配置已更新/)
  assert.match(managerConfig, /配置更新失败/)
  assert.doesNotMatch(managerConfig, /console\.log\(.*key/i)
  assert.match(restore, /! -L \"\$backup_dir\/app\.db\"/)
  assert.match(readme, /curl -fsSL https:\/\/github\.com\/bykedie\/huabu\/raw\/refs\/heads\/codex\/infinite-canvas\/deploy\/install\.sh/)
  assert.match(readme, /公网 IP|公网IP/)
  assert.match(readme, /HTTP.*未加密|未加密.*HTTP/)
  assert.match(readme, /管理命令|h/)
  assert.match(readme, /文字、图片、视频中转地址和开放模型由网页“运营管理”配置/)
  assert.doesNotMatch(readme, /sudo h.*配置文字中转|配置文字中转.*配置图片中转.*配置视频中转/)
  assert.match(readme, /sudo bash -s -- --domain api.bkbk.baby/)
  assert.match(readme, /通知邮箱可以留空/)
})

test('terminal relay maintenance updates only addresses and models without touching compatibility keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ink-maintenance-'))
  const databasePath = join(directory, 'test.db')
  const legacyTextCiphertext = 'synthetic.compatibility.text.ciphertext'
  const legacyVideoCiphertext = 'synthetic.compatibility.video.ciphertext'
  const env = {
    ...childEnvironment,
    NODE_ENV: 'production',
    DB_PATH: databasePath,
    JWT_SECRET: secret,
    ADMIN_SETUP_TOKEN: setupToken,
    AI_API_KEY: 'forbidden-environment-text-key',
    AI_VIDEO_API_KEY: 'forbidden-environment-video-key',
  }
  const run = (kind, baseUrl, models) => spawnSync(process.execPath, ['server/manage-config.js', 'relay', kind], {
    cwd: root, encoding: 'utf8', env,
    input: Buffer.from(`${baseUrl}\0${models}\0`),
  })
  try {
    const initialized = spawnSync(process.execPath, ['--input-type=module', '--eval',
      `const { db } = await import('./server/db.js'); db.prepare('UPDATE app_settings SET ai_api_key_encrypted=?,ai_video_api_key_encrypted=? WHERE id=1').run(${JSON.stringify(legacyTextCiphertext)},${JSON.stringify(legacyVideoCiphertext)}); db.close()`,
    ], { cwd: root, encoding: 'utf8', env })
    assert.equal(initialized.status, 0, initialized.stderr)

    const text = run('text', 'https://text-relay.example/v1/', 'model-a, model-b,model-a')
    const image = run('image', 'https://image-relay.example/v1', 'image-a')
    const video = run('video', 'https://video-relay.example/v1', 'video-a')
    for (const result of [text, image, video]) assert.equal(result.status, 0, result.stderr)
    const database = new DatabaseSync(databasePath)
    const row = database.prepare('SELECT ai_base_url,ai_models,ai_image_base_url,ai_image_models,ai_video_base_url,ai_video_models,ai_api_key_encrypted,ai_video_api_key_encrypted FROM app_settings WHERE id=1').get()
    database.close()
    assert.deepEqual({ ...row }, {
      ai_base_url: 'https://text-relay.example/v1', ai_models: '["model-a","model-b"]',
      ai_image_base_url: 'https://image-relay.example/v1', ai_image_models: '["image-a"]',
      ai_video_base_url: 'https://video-relay.example/v1', ai_video_models: '["video-a"]',
      ai_api_key_encrypted: legacyTextCiphertext, ai_video_api_key_encrypted: legacyVideoCiphertext,
    })

    const credentialUrl = spawnSync(process.execPath, ['server/manage-config.js', 'relay', 'text'], {
      cwd: root, encoding: 'utf8', env,
      input: Buffer.from('https://user:password@relay.example/v1\0model-a\0'),
    })
    assert.notEqual(credentialUrl.status, 0)
    assert.match(credentialUrl.stderr, /用户名或密码/)
    assert.equal((credentialUrl.stdout + credentialUrl.stderr).includes('user:password'), false)

    for (const result of [text, image, video, credentialUrl]) {
      const output = result.stdout + result.stderr
      for (const sensitive of [legacyTextCiphertext, legacyVideoCiphertext, env.AI_API_KEY, env.AI_VIDEO_API_KEY]) {
        assert.equal(output.includes(sensitive), false)
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('proxy trust accepts only loopback reverse proxies', () => {
  const check = "const app=(await import('./server/app.js')).default; const trust=app.get('trust proxy'); process.exit(trust('127.0.0.1')&&trust('::1')&&trust('::ffff:127.0.0.1')&&!trust('203.0.113.10')?0:1)"
  const result = runApp({}, check)
  assert.equal(result.status, 0, result.stderr)
})

test('production image relay requires a credential-free HTTPS base URL', () => {
  const empty = runApp({ AI_IMAGE_BASE_URL: '' })
  assert.equal(empty.status, 0, empty.stderr)
  for (const value of ['http://images.example.test/v1', 'https://user:password@images.example.test/v1', 'https://images.example.test/v1?target=other', 'https://images.example.test/v1#fragment']) {
    const result = runApp({ AI_IMAGE_BASE_URL: value })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /图片中转站地址/)
    assert.equal((result.stdout + result.stderr).includes('user:password'), false)
  }
  const valid = runApp({ AI_IMAGE_BASE_URL: 'https://images.example.test/v1/' })
  assert.equal(valid.status, 0, valid.stderr)
})

test('database startup migrates existing generations without losing rows', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-production-migration-'))
  const databasePath = join(databaseDirectory, 'test.db')
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id,email,password_hash,name) VALUES ('legacy-user','legacy@example.com','hash','Legacy');
    CREATE TABLE canvases (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      document TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO canvases (id,user_id,name) VALUES ('legacy-canvas','legacy-user','旧画布');
    CREATE TABLE generations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_key TEXT NOT NULL,
      model TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER, status TEXT NOT NULL,
      response TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, request_key)
    );
    INSERT INTO generations (id,user_id,request_key,model,reserved,status)
    VALUES ('legacy-id','legacy-user','legacy-request','gpt-4o-mini',1,'failed');
  `)
  legacy.close()
  const script = `
    const { db } = await import('./server/db.js')
    const columns = db.prepare('PRAGMA table_info(generations)').all().map((column) => column.name)
    const canvasColumns = db.prepare('PRAGMA table_info(canvases)').all().map((column) => column.name)
    const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
    const settingsColumns = db.prepare('PRAGMA table_info(app_settings)').all().map((column) => column.name)
    const mediaColumns = db.prepare('PRAGMA table_info(media)').all().map((column) => column.name)
    const userRow = db.prepare('SELECT * FROM users WHERE id=?').get('legacy-user')
    const user = Object.fromEntries([
      'id', 'admin_password_encrypted',
      'text_api_key_encrypted', 'image_api_key_encrypted', 'video_api_key_encrypted',
      'login_failures', 'login_failure_started_at', 'login_locked_until', 'session_version',
    ].map((key) => [key, userRow[key]]))
    const canvas = db.prepare('SELECT id,version FROM canvases WHERE id=?').get('legacy-canvas')
    const row = db.prepare('SELECT id,request_hash FROM generations WHERE id=?').get('legacy-id')
    process.stdout.write(JSON.stringify({ columns, canvasColumns, userColumns, settingsColumns, mediaColumns, user, canvas, row }))
    db.close()
  `
  try {
    const result = runApp({}, script, databaseDirectory)
    assert.equal(result.status, 0, result.stderr)
    const migrated = JSON.parse(result.stdout)
    assert.ok(migrated.columns.includes('request_hash'))
    assert.ok(migrated.columns.includes('kind'))
    assert.ok(migrated.canvasColumns.includes('version'))
    for (const column of ['text_api_key_encrypted', 'image_api_key_encrypted', 'video_api_key_encrypted']) {
      assert.ok(migrated.userColumns.includes(column), column + ' was not added to the legacy users table')
    }
    assert.ok(migrated.userColumns.includes('admin_password_encrypted'))
    assert.ok(migrated.userColumns.includes('login_failures'))
    assert.ok(migrated.userColumns.includes('login_failure_started_at'))
    assert.ok(migrated.userColumns.includes('login_locked_until'))
    assert.ok(migrated.userColumns.includes('session_version'))
    assert.ok(migrated.settingsColumns.includes('ai_image_points'))
    assert.ok(migrated.settingsColumns.includes('ai_video_points'))
    assert.ok(migrated.mediaColumns.includes('data'))
    assert.deepEqual(migrated.user, {
      id: 'legacy-user', admin_password_encrypted: null,
      text_api_key_encrypted: null, image_api_key_encrypted: null, video_api_key_encrypted: null,
      login_failures: 0, login_failure_started_at: null, login_locked_until: null, session_version: 0,
    })
    assert.deepEqual(migrated.canvas, { id: 'legacy-canvas', version: 0 })
    assert.deepEqual(migrated.row, { id: 'legacy-id', request_hash: null })
  } finally {
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})

test('database restore checker accepts only a complete, consistent canvas database', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-production-restore-'))
  const databasePath = join(databaseDirectory, 'valid.db')
  try {
    const initialized = runApp({ DB_PATH: databasePath }, "const { db } = await import('./server/db.js'); db.close()", databaseDirectory)
    assert.equal(initialized.status, 0, initialized.stderr)
    assert.equal(runDatabaseCheck(databasePath).status, 0)

    const legacyPath = join(databaseDirectory, 'legacy.db')
    const legacyInitialized = runApp({ DB_PATH: legacyPath }, "const { db } = await import('./server/db.js'); db.close()", databaseDirectory)
    assert.equal(legacyInitialized.status, 0, legacyInitialized.stderr)
    const legacy = new DatabaseSync(legacyPath)
    try {
      const columns = legacy.prepare('PRAGMA table_info(users)').all().map((item) => item.name)
      for (const column of ['text_api_key_encrypted', 'image_api_key_encrypted', 'video_api_key_encrypted']) {
        assert.equal(columns.includes(column), true, column + ' is missing before the legacy restore fixture can be created')
      }
      legacy.exec('ALTER TABLE users DROP COLUMN admin_password_encrypted; ALTER TABLE users DROP COLUMN text_api_key_encrypted; ALTER TABLE users DROP COLUMN image_api_key_encrypted; ALTER TABLE users DROP COLUMN video_api_key_encrypted; ALTER TABLE users DROP COLUMN login_failures; ALTER TABLE users DROP COLUMN login_failure_started_at; ALTER TABLE users DROP COLUMN login_locked_until; ALTER TABLE users DROP COLUMN session_version; ALTER TABLE canvases DROP COLUMN version; ALTER TABLE generations DROP COLUMN request_hash; DROP TABLE admin_audit; DROP TABLE app_settings; DROP TABLE health_probe')
    } finally { legacy.close() }
    assert.notEqual(runDatabaseCheck(legacyPath).status, 0)
    assert.equal(runDatabaseCheck(legacyPath, true).status, 0)
    const migratedLegacy = runApp({ DB_PATH: legacyPath }, "const { db } = await import('./server/db.js'); db.close()", databaseDirectory)
    assert.equal(migratedLegacy.status, 0, migratedLegacy.stderr)
    assert.equal(runDatabaseCheck(legacyPath).status, 0)

    const unrelatedPath = join(databaseDirectory, 'unrelated.db')
    const unrelated = new DatabaseSync(unrelatedPath)
    unrelated.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    unrelated.close()
    const unrelatedCheck = runDatabaseCheck(unrelatedPath)
    assert.notEqual(unrelatedCheck.status, 0)
    assert.match(unrelatedCheck.stderr, /users/)
    assert.notEqual(runDatabaseCheck(unrelatedPath, true).status, 0)

    const missingColumnPath = join(databaseDirectory, 'missing-column.db')
    const missingColumn = new DatabaseSync(missingColumnPath)
    missingColumn.exec("CREATE TABLE users (id TEXT PRIMARY KEY)")
    missingColumn.close()
    const missingColumnCheck = runDatabaseCheck(missingColumnPath)
    assert.notEqual(missingColumnCheck.status, 0)
    assert.match(missingColumnCheck.stderr, /users/)

    for (const column of ['text_api_key_encrypted', 'image_api_key_encrypted', 'video_api_key_encrypted']) {
      const missingKeyPath = join(databaseDirectory, `missing-${column}.db`)
      const missingKeyInitialized = runApp({ DB_PATH: missingKeyPath }, "const { db } = await import('./server/db.js'); db.close()", databaseDirectory)
      assert.equal(missingKeyInitialized.status, 0, missingKeyInitialized.stderr)
      const missingKey = new DatabaseSync(missingKeyPath)
      try {
        const columns = missingKey.prepare('PRAGMA table_info(users)').all().map((item) => item.name)
        assert.equal(columns.includes(column), true, column + ' is missing before the restore-check regression can run')
        missingKey.exec(`ALTER TABLE users DROP COLUMN ${column}`)
      } finally { missingKey.close() }
      const missingKeyCheck = runDatabaseCheck(missingKeyPath)
      assert.notEqual(missingKeyCheck.status, 0)
      assert.match(missingKeyCheck.stderr, new RegExp(column))
      assert.equal(runDatabaseCheck(missingKeyPath, true, {}).status, 0)
    }

    const invalidForeignKey = new DatabaseSync(databasePath)
    invalidForeignKey.exec("PRAGMA foreign_keys=OFF; INSERT INTO canvases (id,user_id,name) VALUES ('orphan','missing-user','orphan')")
    invalidForeignKey.close()
    const foreignKeyCheck = runDatabaseCheck(databasePath)
    assert.notEqual(foreignKeyCheck.status, 0)
    assert.match(foreignKeyCheck.stderr, /外键/)
  } finally {
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})

test('database restore checker validates encrypted relay settings without exposing them', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-production-encrypted-restore-'))
  const databasePath = join(databaseDirectory, 'encrypted.db')
  const textKey = 'synthetic-restored-text-key'
  const videoKey = 'synthetic-restored-video-key'
  const imageKey = 'synthetic-restored-image-key'
  const wrongSecret = 'different-jwt-secret-that-is-longer-than-thirty-two-bytes'
  const script = `
    const { db } = await import('./server/db.js')
    const { createCipheriv, createHash, randomBytes } = await import('node:crypto')
    const key = createHash('sha256').update('ai-settings:' + process.env.JWT_SECRET).digest()
    const encrypt = (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.')
    }
    db.prepare('INSERT INTO users (id,email,password_hash,admin_password_encrypted,name,role,text_api_key_encrypted,image_api_key_encrypted,video_api_key_encrypted) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('restore-owner','restore-owner@example.com','hash',null,'Restore Owner','user',encrypt(${JSON.stringify(textKey)}),encrypt(${JSON.stringify(imageKey)}),encrypt(${JSON.stringify(videoKey)}))
    db.close()
  `
  try {
    const initialized = runApp({ DB_PATH: databasePath }, script, databaseDirectory)
    assert.equal(initialized.status, 0, initialized.stderr)
    const database = new DatabaseSync(databasePath)
    const ciphertexts = Object.values(database.prepare('SELECT text_api_key_encrypted,image_api_key_encrypted,video_api_key_encrypted FROM users WHERE email=?').get('restore-owner@example.com'))
    database.close()
    assert.equal(ciphertexts.every((value) => typeof value === 'string' && value.split('.').length === 3), true)
    for (const [ciphertext, plaintext] of ciphertexts.map((value, index) => [value, [textKey, imageKey, videoKey][index]])) {
      assert.equal(ciphertext.includes(plaintext), false)
    }

    const accepted = runDatabaseCheck(databasePath)
    assert.equal(accepted.status, 0, accepted.stderr)
    const rejectedWrong = runDatabaseCheck(databasePath, false, { JWT_SECRET: wrongSecret })
    assert.notEqual(rejectedWrong.status, 0)
    assert.match(rejectedWrong.stderr, /JWT_SECRET|解密|密钥/)
    const rejectedMissing = runDatabaseCheck(databasePath, false, {})
    assert.notEqual(rejectedMissing.status, 0)
    assert.match(rejectedMissing.stderr, /JWT_SECRET/)
    assert.equal(runDatabaseCheck(databasePath, true, {}).status, 0)

    for (const result of [accepted, rejectedWrong, rejectedMissing]) {
      const output = result.stdout + result.stderr
      for (const sensitive of [...ciphertexts, textKey, videoKey, imageKey]) assert.equal(output.includes(sensitive), false)
    }
  } finally {
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})

test('production setup token grants only its holder the first admin role', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-production-admin-'))
  const script = `
    const { default: app } = await import('./server/app.js')
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = 'http://127.0.0.1:' + server.address().port + '/api/auth/register'
    const register = async (email, token) => {
      const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '测试用户', email, password: 'password123', ...(token ? { setupToken: token } : {}) }) })
      return { status: response.status, body: await response.json() }
    }
    const ordinary = await register('ordinary@example.com')
    const owner = await register('owner@example.com', process.env.ADMIN_SETUP_TOKEN)
    const later = await register('later@example.com', process.env.ADMIN_SETUP_TOKEN)
    process.stdout.write(JSON.stringify({ ordinary: ordinary.body.user.role, owner: owner.body.user.role, later: later.body.user.role, balance: owner.body.user.balance }))
    await new Promise((resolve) => server.close(resolve))
  `
  try {
    const result = runApp({}, script, databaseDirectory)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { ordinary: 'user', owner: 'admin', later: 'user', balance: 0 })
    const restartWithoutSetupToken = runApp({ ADMIN_SETUP_TOKEN: '' }, undefined, databaseDirectory)
    assert.equal(restartWithoutSetupToken.status, 0, restartWithoutSetupToken.stderr)
  } finally {
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})

test('root maintenance status displays encrypted administrator credentials only', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-admin-status-'))
  const databasePath = join(databaseDirectory, 'test.db')
  const env = {
    ...childEnvironment, NODE_ENV: 'production', DB_PATH: databasePath,
    JWT_SECRET: secret, ADMIN_SETUP_TOKEN: setupToken,
  }
  const create = `
    const { default: app } = await import('./server/app.js')
    const { db } = await import('./server/db.js')
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Root Status', email: 'root-status@example.com', password: 'status-password-456', setupToken: process.env.ADMIN_SETUP_TOKEN }),
    })
    if (response.status !== 201) throw new Error(await response.text())
    await new Promise((resolve) => server.close(resolve))
    db.close()
  `
  try {
    const created = spawnSync(process.execPath, ['--input-type=module', '--eval', create], { cwd: root, encoding: 'utf8', env })
    assert.equal(created.status, 0, created.stderr)
    const database = new DatabaseSync(databasePath)
    const row = database.prepare('SELECT password_hash,admin_password_encrypted FROM users WHERE email=?').get('root-status@example.com')
    database.close()
    assert.equal(typeof row.admin_password_encrypted, 'string')
    assert.equal(row.admin_password_encrypted.includes('status-password-456'), false)
    const status = spawnSync(process.execPath, ['server/manage-config.js', 'admin-status'], { cwd: root, encoding: 'utf8', env })
    assert.equal(status.status, 0, status.stderr)
    assert.match(status.stdout, /root-status@example\.com/)
    assert.match(status.stdout, /"status-password-456"/)
    assert.equal(status.stdout.includes(row.password_hash), false)
    assert.equal(status.stdout.includes(row.admin_password_encrypted), false)
  } finally {
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})
