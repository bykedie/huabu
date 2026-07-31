import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const secret = 'jwt-secret-that-is-longer-than-thirty-two-bytes'
const setupToken = 'admin-setup-token-longer-than-thirty-two-bytes'
const clearedChildEnvironment = new Set([
  'JWT_SECRET', 'ADMIN_SETUP_TOKEN',
  'AI_BASE_URL', 'AI_API_KEY', 'AI_IMAGE_BASE_URL', 'AI_IMAGE_API_KEY',
  'AI_VIDEO_BASE_URL', 'AI_VIDEO_API_KEY', 'AI_VIDEO_MEDIA_ORIGINS',
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

  const invalidStorage = runApp({ MAX_CANVAS_BYTES: '2048', MAX_USER_STORAGE_BYTES: '1024' })
  assert.notEqual(invalidStorage.status, 0)
  assert.match(invalidStorage.stderr, /MAX_USER_STORAGE_BYTES/)

  const excessiveAiTimeout = runApp({ AI_TIMEOUT_MS: '120001' })
  assert.notEqual(excessiveAiTimeout.status, 0)
  assert.match(excessiveAiTimeout.stderr, /AI_TIMEOUT_MS/)

  const prematureRecovery = runApp({ AI_TIMEOUT_MS: '120000', AI_PENDING_RECOVERY_MS: '129999' })
  assert.notEqual(prematureRecovery.status, 0)
  assert.match(prematureRecovery.stderr, /AI_PENDING_RECOVERY_MS/)

  const prematureVideoRecovery = runApp({ AI_VIDEO_TIMEOUT_MS: '60000', AI_VIDEO_PENDING_RECOVERY_MS: '69999' })
  assert.notEqual(prematureVideoRecovery.status, 0)
  assert.match(prematureVideoRecovery.stderr, /AI_VIDEO_PENDING_RECOVERY_MS/)

  const insufficientMediaStorage = runApp({ AI_VIDEO_MAX_RESPONSE_BYTES: '2048', MAX_USER_MEDIA_BYTES: '2047' })
  assert.notEqual(insufficientMediaStorage.status, 0)
  assert.match(insufficientMediaStorage.stderr, /MAX_USER_MEDIA_BYTES/)
})

test('production environment example exposes current video and media settings', () => {
  const exampleKeys = new Set(readFileSync(join(root, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter(Boolean))
  for (const key of [
    'AI_VIDEO_BASE_URL', 'AI_VIDEO_API_KEY', 'AI_VIDEO_MODELS', 'AI_VIDEO_POINTS',
    'AI_VIDEO_TIMEOUT_MS', 'AI_VIDEO_POLL_MS', 'AI_VIDEO_PENDING_RECOVERY_MS',
    'AI_VIDEO_MAX_RESPONSE_BYTES', 'AI_VIDEO_MEDIA_ORIGINS', 'MAX_USER_MEDIA_BYTES',
  ]) assert.equal(exampleKeys.has(key), true, `${key} is missing from .env.example`)
})

test('public-port deployment and h management preserve the production contract', () => {
  const installer = readFileSync(join(root, 'deploy', 'install.sh'), 'utf8')
  const manager = readFileSync(join(root, 'deploy', 'manage.sh'), 'utf8')
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
  assert.match(installer, /if \[\[ -n \$domain \]\]/)
  assert.match(installer, /apt_packages=\(ca-certificates curl git openssl\)/)
  assert.match(installer, /certbot --nginx --non-interactive --agree-tos --redirect/)
  assert.match(installer, /__DOMAIN__/)
  assert.match(installer, /__PUBLIC_PORT__/)
  assert.match(installer, /status --porcelain/)
  assert.match(installer, /merge-base --is-ancestor HEAD FETCH_HEAD/)
  assert.match(installer, /merge --ff-only FETCH_HEAD/)
  assert.match(installer, /backup_deployment/)
  assert.match(installer, /http:\/\/127\.0\.0\.1:\$\{port\}/)
  assert.match(installer, /\/usr\/local\/bin\/h/)
  assert.match(installer, /拒绝覆盖|not this project|not this project's command/)
  assert.match(installer, /公网传输未加密|public HTTP is not encrypted/)
  assert.match(compose, /\$\{PUBLIC_BIND:-0\.0\.0\.0\}:\$\{PUBLIC_PORT:-3102\}:3102/)
  assert.match(envExample, /^PUBLIC_BIND=0\.0\.0\.0$/m)
  assert.match(envExample, /^PUBLIC_PORT=3102$/m)

  for (const script of [backup, restore]) {
    assert.match(script, /PUBLIC_PORT/)
    assert.match(script, /127\.0\.0\.1:\$\{public_port\}/)
    assert.doesNotMatch(script, /127\.0\.0\.1:3102\/api\/health/)
  }

  for (const phrase of ['status', 'start', 'stop', 'restart', 'safe_update', 'configure_port', 'configure_domain', 'configure_relay', 'configure_commercial', 'backup_now', 'list_backups', 'restore_backup', 'show_logs', 'diagnose', 'admin_token_menu']) {
    assert.match(manager, new RegExp(phrase), phrase + ' is missing from h manager')
  }
  assert.match(manager, /read -r -s/)
  assert.match(manager, /AI_API_KEY/)
  assert.match(manager, /AI_VIDEO_API_KEY/)
  assert.doesNotMatch(manager, /printf\s+\"\$key\"/)
  assert.match(manager, /__DOMAIN__/)
  assert.match(manager, /__PUBLIC_PORT__/)
  assert.match(readme, /curl -fsSL https:\/\/github\.com\/bykedie\/huabu\/raw\/refs\/heads\/codex\/infinite-canvas\/deploy\/install\.sh/)
  assert.match(readme, /公网 IP|公网IP/)
  assert.match(readme, /HTTP.*未加密|未加密.*HTTP/)
  assert.match(readme, /管理命令|h/)
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
    const user = db.prepare('SELECT id,image_api_key_encrypted,login_failures,login_failure_started_at,login_locked_until,session_version FROM users WHERE id=?').get('legacy-user')
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
    assert.ok(migrated.userColumns.includes('image_api_key_encrypted'))
    assert.ok(migrated.userColumns.includes('login_failures'))
    assert.ok(migrated.userColumns.includes('login_failure_started_at'))
    assert.ok(migrated.userColumns.includes('login_locked_until'))
    assert.ok(migrated.userColumns.includes('session_version'))
    assert.ok(migrated.settingsColumns.includes('ai_image_points'))
    assert.ok(migrated.settingsColumns.includes('ai_video_points'))
    assert.ok(migrated.mediaColumns.includes('data'))
    assert.deepEqual(migrated.user, { id: 'legacy-user', image_api_key_encrypted: null, login_failures: 0, login_failure_started_at: null, login_locked_until: null, session_version: 0 })
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
    legacy.exec('ALTER TABLE users DROP COLUMN image_api_key_encrypted; ALTER TABLE users DROP COLUMN login_failures; ALTER TABLE users DROP COLUMN login_failure_started_at; ALTER TABLE users DROP COLUMN login_locked_until; ALTER TABLE users DROP COLUMN session_version; ALTER TABLE canvases DROP COLUMN version; ALTER TABLE generations DROP COLUMN request_hash; DROP TABLE admin_audit; DROP TABLE app_settings; DROP TABLE health_probe')
    legacy.close()
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

    const missingImageKeyPath = join(databaseDirectory, 'missing-image-key.db')
    const missingImageKeyInitialized = runApp({ DB_PATH: missingImageKeyPath }, "const { db } = await import('./server/db.js'); db.close()", databaseDirectory)
    assert.equal(missingImageKeyInitialized.status, 0, missingImageKeyInitialized.stderr)
    const missingImageKey = new DatabaseSync(missingImageKeyPath)
    missingImageKey.exec('ALTER TABLE users DROP COLUMN image_api_key_encrypted')
    missingImageKey.close()
    const missingImageKeyCheck = runDatabaseCheck(missingImageKeyPath)
    assert.notEqual(missingImageKeyCheck.status, 0)
    assert.match(missingImageKeyCheck.stderr, /image_api_key_encrypted/)
    assert.equal(runDatabaseCheck(missingImageKeyPath, true, {}).status, 0)

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
    const { default: app } = await import('./server/app.js')
    const { db } = await import('./server/db.js')
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = 'http://127.0.0.1:' + server.address().port + '/api'
    const json = async (path, options = {}) => {
      const response = await fetch(base + path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      })
      if (!response.ok) throw new Error('encrypted restore fixture setup failed')
      return response.json()
    }
    const registration = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Restore Owner', email: 'restore-owner@example.com', password: 'password123', setupToken: process.env.ADMIN_SETUP_TOKEN }),
    })
    const authorization = 'Bearer ' + registration.token
    await json('/me/image-key', { method: 'PUT', headers: { authorization }, body: JSON.stringify({ apiKey: ${JSON.stringify(imageKey)} }) })
    await json('/admin/ai-config', {
      method: 'PUT', headers: { authorization },
      body: JSON.stringify({ baseUrl: 'https://text-relay.example/v1', apiKey: ${JSON.stringify(textKey)}, models: ['text-model'] }),
    })
    await json('/admin/video-config', {
      method: 'PUT', headers: { authorization },
      body: JSON.stringify({ baseUrl: 'https://video-relay.example/v1', apiKey: ${JSON.stringify(videoKey)}, models: ['video-model'], points: 7 }),
    })
    await new Promise((resolve) => server.close(resolve))
    db.close()
  `
  try {
    const initialized = runApp({ DB_PATH: databasePath }, script, databaseDirectory)
    assert.equal(initialized.status, 0, initialized.stderr)
    const database = new DatabaseSync(databasePath)
    const ciphertexts = [
      ...Object.values(database.prepare('SELECT ai_api_key_encrypted,ai_video_api_key_encrypted FROM app_settings WHERE id=1').get()),
      database.prepare('SELECT image_api_key_encrypted FROM users WHERE email=?').get('restore-owner@example.com').image_api_key_encrypted,
    ]
    database.close()
    assert.equal(ciphertexts.every((value) => typeof value === 'string' && value.split('.').length === 3), true)
    for (const [ciphertext, plaintext] of ciphertexts.map((value, index) => [value, [textKey, videoKey, imageKey][index]])) {
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
