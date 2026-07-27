import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const secret = 'jwt-secret-that-is-longer-than-thirty-two-bytes'
const setupToken = 'admin-setup-token-longer-than-thirty-two-bytes'

function runApp(env = {}, script = "await import('./server/app.js')", databaseDirectory) {
  const temp = databaseDirectory || mkdtempSync(join(tmpdir(), 'ink-production-'))
  try {
    return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
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

function runDatabaseCheck(databasePath) {
  return spawnSync(process.execPath, ['server/check-db.js', databasePath], {
    cwd: root,
    encoding: 'utf8',
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

  const excessiveAiTimeout = runApp({ AI_TIMEOUT_MS: '120001' })
  assert.notEqual(excessiveAiTimeout.status, 0)
  assert.match(excessiveAiTimeout.stderr, /AI_TIMEOUT_MS/)

  const prematureRecovery = runApp({ AI_TIMEOUT_MS: '120000', AI_PENDING_RECOVERY_MS: '129999' })
  assert.notEqual(prematureRecovery.status, 0)
  assert.match(prematureRecovery.stderr, /AI_PENDING_RECOVERY_MS/)
})

test('database startup migrates existing generations without losing rows', () => {
  const databaseDirectory = mkdtempSync(join(tmpdir(), 'ink-production-migration-'))
  const databasePath = join(databaseDirectory, 'test.db')
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
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
    const canvas = db.prepare('SELECT id,version FROM canvases WHERE id=?').get('legacy-canvas')
    const row = db.prepare('SELECT id,request_hash FROM generations WHERE id=?').get('legacy-id')
    process.stdout.write(JSON.stringify({ columns, canvasColumns, canvas, row }))
    db.close()
  `
  try {
    const result = runApp({}, script, databaseDirectory)
    assert.equal(result.status, 0, result.stderr)
    const migrated = JSON.parse(result.stdout)
    assert.ok(migrated.columns.includes('request_hash'))
    assert.ok(migrated.canvasColumns.includes('version'))
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

    const unrelatedPath = join(databaseDirectory, 'unrelated.db')
    const unrelated = new DatabaseSync(unrelatedPath)
    unrelated.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    unrelated.close()
    const unrelatedCheck = runDatabaseCheck(unrelatedPath)
    assert.notEqual(unrelatedCheck.status, 0)
    assert.match(unrelatedCheck.stderr, /users/)

    const missingColumnPath = join(databaseDirectory, 'missing-column.db')
    const missingColumn = new DatabaseSync(missingColumnPath)
    missingColumn.exec("CREATE TABLE users (id TEXT PRIMARY KEY)")
    missingColumn.close()
    const missingColumnCheck = runDatabaseCheck(missingColumnPath)
    assert.notEqual(missingColumnCheck.status, 0)
    assert.match(missingColumnCheck.stderr, /users/)

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
