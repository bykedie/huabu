import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
