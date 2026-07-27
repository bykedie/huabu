import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = mkdtempSync(join(tmpdir(), 'ink-canvas-'))
process.env.DB_PATH = join(temp, 'test.db')
process.env.JWT_SECRET = 'test-secret-at-least-32-characters'
process.env.WELCOME_POINTS = '100'
process.env.TOPUP_INSTRUCTIONS = '测试收款方式'
process.env.MAX_CANVASES_PER_USER = '3'
process.env.MAX_CANVAS_BYTES = '2048'
process.env.MAX_USER_STORAGE_BYTES = '3072'
process.env.REGISTRATION_RATE_LIMIT = '100'
process.env.NODE_ENV = 'test'
delete process.env.AI_BASE_URL
delete process.env.AI_API_KEY

const { default: app, estimatePromptTokens } = await import('../server/app.js')
const { db, transaction, changeBalance, recoverPendingGenerations } = await import('../server/db.js')
const server = app.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}/api`

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(base + path, { ...options, headers })
  const body = response.status === 204 ? null : await response.json()
  return { status: response.status, body }
}

async function register(name, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password: 'password123' }),
  })
  assert.equal(result.status, 201)
  return result.body
}

test('AI prompt estimation includes per-message protocol overhead', () => {
  assert.equal(estimatePromptTokens([{ role: 'user', content: '' }]), 32)
  assert.equal(estimatePromptTokens([{ role: 'system', content: 'abc' }, { role: 'user', content: '' }]), 51)
})

test('health check verifies SQLite read and write access', async () => {
  const before = Number(db.prepare('SELECT value FROM health_probe WHERE id=1').get().value)
  const health = await request('/health')
  assert.equal(health.status, 200)
  assert.deepEqual(health.body, { ok: true })
  assert.equal(Number(db.prepare('SELECT value FROM health_probe WHERE id=1').get().value), before)
})

test('canvas count and storage quotas are enforced server-side', async () => {
  const member = await register('配额用户', 'quota@example.com')
  const create = () => request('/canvases', { token: member.token, method: 'POST', body: JSON.stringify({ name: '配额测试' }) })
  const first = await create()
  const second = await create()
  const third = await create()
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.equal(third.status, 201)
  assert.equal((await create()).status, 413)

  const document = (content) => ({ nodes: [{ id: 'n', position: { x: 0, y: 0 }, data: { kind: 'text', content } }], edges: [] })
  const oversized = await request(`/canvases/${first.body.canvas.id}`, {
    token: member.token, method: 'PUT', body: JSON.stringify({ name: '过大画布', version: 0, document: document('x'.repeat(3000)) }),
  })
  assert.equal(oversized.status, 413)
  const saved = await request(`/canvases/${first.body.canvas.id}`, {
    token: member.token, method: 'PUT', body: JSON.stringify({ name: '画布一', version: 0, document: document('x'.repeat(1400)) }),
  })
  assert.equal(saved.status, 200)
  const overAccountQuota = await request(`/canvases/${second.body.canvas.id}`, {
    token: member.token, method: 'PUT', body: JSON.stringify({ name: '画布二', version: 0, document: document('x'.repeat(1600)) }),
  })
  assert.equal(overAccountQuota.status, 413)
  assert.equal((await request(`/canvases/${second.body.canvas.id}`, { token: member.token })).body.canvas.version, 0)
  db.prepare("UPDATE users SET role='user' WHERE id=?").run(member.user.id)
})

test('paid canvas workflow preserves ownership and wallet invariants', async () => {
  const admin = await register('管理员', 'admin@example.com')
  const member = await register('普通用户', 'member@example.com')
  assert.equal(admin.user.role, 'admin')
  assert.equal(member.user.role, 'user')
  assert.equal(member.user.balance, 100)
  const config = await request('/config', { token: member.token })
  assert.equal(config.status, 200)
  assert.equal(config.body.centsPerPoint, 1)
  assert.equal((await request('/missing-endpoint', { token: member.token })).status, 404)

  const created = await request('/canvases', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ name: '产品构思' }),
  })
  assert.equal(created.status, 201)
  const canvasId = created.body.canvas.id
  const document = {
    nodes: [{ id: 'n1', type: 'canvasNode', position: { x: 10, y: 20 }, data: { kind: 'note', title: '方向', content: '验证保存' } }],
    edges: [],
  }
  assert.equal((await request(`/canvases/${canvasId}`, {
    token: member.token,
    method: 'PUT',
    body: JSON.stringify({ name: '产品构思 v2', version: 0, document }),
  })).status, 200)
  const staleSave = await request(`/canvases/${canvasId}`, {
    token: member.token,
    method: 'PUT',
    body: JSON.stringify({ name: '陈旧副本', version: 0, document: { nodes: [], edges: [] } }),
  })
  assert.equal(staleSave.status, 409)
  const savedCanvas = (await request(`/canvases/${canvasId}`, { token: member.token })).body.canvas
  assert.equal(savedCanvas.version, 1)
  assert.equal(savedCanvas.name, '产品构思 v2')
  assert.deepEqual(savedCanvas.document, document)
  assert.equal((await request(`/canvases/${canvasId}`, { token: admin.token })).status, 404)

  const codes = await request('/admin/codes', {
    token: admin.token,
    method: 'POST',
    body: JSON.stringify({ points: 250, count: 1, maxUses: 1, label: '测试码' }),
  })
  assert.equal(codes.status, 201)
  const code = codes.body.codes[0]
  assert.match(code, /^INK-[A-F0-9]{32}$/)
  const redeemed = await request('/redeem', { token: member.token, method: 'POST', body: JSON.stringify({ code }) })
  assert.equal(redeemed.status, 200)
  assert.equal(redeemed.body.balance, 350)
  assert.equal((await request('/redeem', { token: member.token, method: 'POST', body: JSON.stringify({ code }) })).status, 400)

  const topup = await request('/topups', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ amountCents: 1000, proof: 'TEST-TRADE-001' }),
  })
  assert.equal(topup.status, 201)
  const orderId = topup.body.order.id
  const duplicateTopup = await request('/topups', {
    token: admin.token,
    method: 'POST',
    body: JSON.stringify({ amountCents: 1000, proof: 'test-trade-001' }),
  })
  assert.equal(duplicateTopup.status, 409)
  assert.equal((await request(`/admin/topups/${orderId}/approve`, { token: admin.token, method: 'POST' })).status, 200)
  assert.equal((await request(`/admin/topups/${orderId}/approve`, { token: admin.token, method: 'POST' })).status, 409)
  assert.equal((await request('/me', { token: member.token })).body.user.balance, 1350)
  const memberTopups = await request('/topups', { token: member.token })
  assert.equal(memberTopups.body.orders[0].status, 'approved')

  const rejectedTopup = await request('/topups', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ amountCents: 500, proof: 'TEST-TRADE-002' }),
  })
  const rejectedOrderId = rejectedTopup.body.order.id
  assert.equal((await request(`/admin/topups/${rejectedOrderId}/reject`, { token: admin.token, method: 'POST' })).status, 200)
  assert.equal((await request(`/admin/topups/${rejectedOrderId}/reject`, { token: admin.token, method: 'POST' })).status, 409)
  const overview = await request('/admin/overview', { token: admin.token })
  assert.deepEqual(overview.body.audit.map((entry) => entry.action), ['topup.reject', 'topup.approve', 'codes.create'])
  assert.ok(overview.body.audit.every((entry) => entry.actor_email === 'admin@example.com'))
  assert.deepEqual(overview.body.audit[0].details, { userId: member.user.id, amountCents: 500, points: 500 })
  assert.deepEqual(overview.body.audit[2].details, { count: 1, points: 250, maxUses: 1, label: '测试码' })
  const auditId = overview.body.audit[0].id
  assert.throws(() => db.prepare('UPDATE admin_audit SET action=? WHERE id=?').run('tampered', auditId), /immutable/)
  assert.throws(() => db.prepare('DELETE FROM admin_audit WHERE id=?').run(auditId), /immutable/)
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM admin_audit').get().count), 3)

  const beforeAI = (await request('/me', { token: member.token })).body.user.balance
  const ledgerBeforeUnconfiguredAI = (await request('/wallet', { token: member.token })).body.ledger.length
  const ai = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({
      requestKey: 'test-request-0001',
      messages: [{ role: 'user', content: '这个请求应失败并退回积分' }],
      maxTokens: 128,
    }),
  })
  assert.equal(ai.status, 503)
  const wallet = await request('/wallet', { token: member.token })
  assert.equal(wallet.body.balance, beforeAI)
  assert.equal(wallet.body.ledger.length, ledgerBeforeUnconfiguredAI)

  const relay = (await import('node:http')).createServer((req, res) => {
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer test-relay-key')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      choices: [{ message: { content: '这是一条模拟中转站回复' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }))
  })
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  const relayBaseUrl = `http://127.0.0.1:${relay.address().port}/v1`
  const forbiddenConfig = await request('/admin/ai-config', {
    token: member.token, method: 'PUT', body: JSON.stringify({ baseUrl: relayBaseUrl, apiKey: 'not-allowed', models: ['gpt-4o-mini'] }),
  })
  assert.equal(forbiddenConfig.status, 403)
  const invalidConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: 'file:///tmp/relay', apiKey: 'test-relay-key', models: ['gpt-4o-mini'] }),
  })
  assert.equal(invalidConfig.status, 400)
  const savedConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: `${relayBaseUrl}/`, apiKey: 'test-relay-key', models: ['gpt-4o-mini'] }),
  })
  assert.equal(savedConfig.status, 200)
  assert.deepEqual(savedConfig.body, { configured: true, keyConfigured: true, baseUrl: relayBaseUrl, models: ['gpt-4o-mini'], source: 'database' })
  assert.equal(JSON.stringify(savedConfig.body).includes('test-relay-key'), false)
  const storedConfig = db.prepare('SELECT ai_base_url,ai_api_key_encrypted FROM app_settings WHERE id=1').get()
  assert.equal(storedConfig.ai_base_url, relayBaseUrl)
  assert.equal(storedConfig.ai_api_key_encrypted.includes('test-relay-key'), false)
  const preservedConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: relayBaseUrl, models: ['gpt-4o-mini'] }),
  })
  assert.equal(preservedConfig.status, 200)
  assert.equal(db.prepare('SELECT ai_api_key_encrypted FROM app_settings WHERE id=1').get().ai_api_key_encrypted, storedConfig.ai_api_key_encrypted)
  const configAudit = db.prepare("SELECT details FROM admin_audit WHERE action='ai_config.update' ORDER BY rowid DESC LIMIT 1").get()
  assert.equal(configAudit.details.includes('test-relay-key'), false)
  const successPayload = {
    requestKey: 'test-request-success-0001',
    messages: [{ role: 'user', content: '请生成一个测试结果' }],
    maxTokens: 1024,
  }
  const success = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify(successPayload),
  })
  assert.equal(success.status, 200)
  assert.equal(success.body.content, '这是一条模拟中转站回复')
  assert.equal(success.body.charged, 1)
  const balanceAfterSuccess = (await request('/me', { token: member.token })).body.user.balance
  assert.equal(balanceAfterSuccess, beforeAI - 1)
  const replay = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify(successPayload),
  })
  assert.equal(success.body.cached, false)
  assert.deepEqual(replay.body, { ...success.body, cached: true })
  assert.equal((await request('/me', { token: member.token })).body.user.balance, balanceAfterSuccess)
  const mismatchedReplay = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ ...successPayload, messages: [{ role: 'user', content: '不同的请求内容' }] }),
  })
  assert.equal(mismatchedReplay.status, 409)
  assert.equal(mismatchedReplay.body.error, '该请求标识已用于不同内容')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, balanceAfterSuccess)

  const interruptedId = crypto.randomUUID()
  transaction(() => {
    changeBalance(member.user.id, -7, 'ai_reserve', interruptedId, '模拟进程中断')
    db.prepare('INSERT INTO generations (id,user_id,request_key,model,reserved,status) VALUES (?,?,?,?,?,?)')
      .run(interruptedId, member.user.id, 'interrupted-request-0001', 'gpt-4o-mini', 7, 'pending')
  })
  assert.equal(recoverPendingGenerations(60000), 0)
  db.prepare("UPDATE generations SET created_at=datetime('now','-2 minutes') WHERE id=?").run(interruptedId)
  assert.equal(recoverPendingGenerations(60000), 1)
  assert.equal(recoverPendingGenerations(), 0)
  assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(interruptedId).status, 'failed')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, balanceAfterSuccess)
  const recoveryEntries = db.prepare('SELECT amount FROM ledger WHERE reference=? ORDER BY rowid').all(interruptedId)
  assert.deepEqual(recoveryEntries.map((entry) => Number(entry.amount)), [-7, 7])

  const clearedConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: '', clearApiKey: true, models: ['gpt-4o-mini'] }),
  })
  assert.equal(clearedConfig.status, 200)
  assert.equal(clearedConfig.body.configured, false)
  assert.equal(db.prepare('SELECT ai_api_key_encrypted FROM app_settings WHERE id=1').get().ai_api_key_encrypted, null)
  process.env.AI_API_KEY = 'test-relay-key'

  let releaseDelayedRelay
  const delayedRelayReady = new Promise((resolve) => { releaseDelayedRelay = resolve })
  const delayedRelay = (await import('node:http')).createServer(async (_req, res) => {
    await delayedRelayReady
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '不应结算的迟到回复' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }))
  })
  delayedRelay.listen(0, '127.0.0.1')
  await new Promise((resolve) => delayedRelay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${delayedRelay.address().port}/v1`
  const overlapKey = 'recovery-overlap-request-0001'
  const overlapCall = request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: overlapKey, messages: [{ role: 'user', content: '模拟恢复竞争' }], maxTokens: 128 }),
  })
  while (!db.prepare('SELECT id FROM generations WHERE request_key=?').get(overlapKey)) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const concurrentReplay = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: overlapKey, messages: [{ role: 'user', content: '模拟恢复竞争' }], maxTokens: 128 }),
  })
  assert.equal(concurrentReplay.status, 409)
  const overlapGeneration = db.prepare('SELECT id,reserved FROM generations WHERE request_key=?').get(overlapKey)
  const beforeOverlap = (await request('/me', { token: member.token })).body.user.balance
  assert.equal(recoverPendingGenerations(), 1)
  releaseDelayedRelay()
  assert.equal((await overlapCall).status, 409)
  assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeOverlap + Number(overlapGeneration.reserved))
  assert.equal(db.prepare('SELECT status FROM generations WHERE request_key=?').get(overlapKey).status, 'failed')
  await new Promise((resolve, reject) => delayedRelay.close((error) => error ? reject(error) : resolve()))

  const malformedRelay = (await import('node:http')).createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: { unsupported: true } } }], usage: { prompt_tokens: 'NaN', completion_tokens: -1 } }))
  })
  malformedRelay.listen(0, '127.0.0.1')
  await new Promise((resolve) => malformedRelay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${malformedRelay.address().port}/v1`
  const beforeMalformed = (await request('/me', { token: member.token })).body.user.balance
  const malformed = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: 'malformed-relay-request-0001', messages: [{ role: 'user', content: '格式验证' }], maxTokens: 128 }),
  })
  assert.equal(malformed.status, 502)
  assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeMalformed)
  await new Promise((resolve, reject) => malformedRelay.close((error) => error ? reject(error) : resolve()))

  const invalidJsonRelay = (await import('node:http')).createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{invalid')
  })
  invalidJsonRelay.listen(0, '127.0.0.1')
  await new Promise((resolve) => invalidJsonRelay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${invalidJsonRelay.address().port}/v1`
  const beforeInvalidJson = (await request('/me', { token: member.token })).body.user.balance
  const invalidJson = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: 'invalid-json-request-0001', messages: [{ role: 'user', content: 'JSON 验证' }], maxTokens: 128 }),
  })
  assert.equal(invalidJson.status, 502)
  assert.equal(invalidJson.body.error, '中转站返回了无效 JSON')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeInvalidJson)
  await new Promise((resolve, reject) => invalidJsonRelay.close((error) => error ? reject(error) : resolve()))
  process.env.AI_BASE_URL = `http://127.0.0.1:${relay.address().port}/v1`
  const retried = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: 'invalid-json-request-0001', messages: [{ role: 'user', content: 'JSON 验证' }], maxTokens: 128 }),
  })
  assert.equal(retried.status, 200)
  assert.equal(retried.body.cached, false)
  assert.equal(retried.body.content, '这是一条模拟中转站回复')
  await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
})

test('AI billing applies local minimums when relay reports zero usage', async () => {
  const member = await register('Billing Minimum User', 'billing-minimum@example.com')
  const content = 'x'.repeat(1200)
  let relayCalls = 0
  const relay = (await import('node:http')).createServer((_req, res) => {
    relayCalls += 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }))
  })
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${relay.address().port}/v1`
  process.env.AI_API_KEY = 'test-relay-key'

  try {
    const before = (await request('/me', { token: member.token })).body.user.balance
    const payload = {
      requestKey: 'zero-usage-billing-request-0001',
      messages: [{ role: 'user', content: 'Generate a detailed answer.' }],
      maxTokens: 1024,
    }
    const first = await request('/ai/chat', { token: member.token, method: 'POST', body: JSON.stringify(payload) })
    assert.equal(first.status, 200)
    assert.ok(first.body.charged > 1)
    const generation = db.prepare('SELECT reserved,charged FROM generations WHERE id=?').get(first.body.id)
    assert.ok(Number(generation.charged) <= Number(generation.reserved))
    const afterFirst = (await request('/me', { token: member.token })).body.user.balance
    assert.equal(afterFirst, before - first.body.charged)

    const replay = await request('/ai/chat', { token: member.token, method: 'POST', body: JSON.stringify(payload) })
    assert.deepEqual(replay.body, { ...first.body, cached: true })
    assert.equal(relayCalls, 1)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, afterFirst)
  } finally {
    await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
    delete process.env.AI_BASE_URL
    delete process.env.AI_API_KEY
  }
})

test('authentication rejects passwords that bcrypt would silently truncate', async () => {
  const password = '密码'.repeat(13)
  assert.ok(Buffer.byteLength(password, 'utf8') > 72)
  const registration = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '长密码用户', email: 'long-password@example.com', password }),
  })
  assert.equal(registration.status, 400)
  assert.match(registration.body.error, /72 字节/)
})

test('login failures persist across source IPs and expire safely', async () => {
  const member = await register('Login Throttle User', 'login-throttle@example.com')
  const login = (password, ip) => request('/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ email: 'login-throttle@example.com', password }),
  })
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await login('wrong-password', `198.51.100.${attempt}`)
    assert.equal(result.status, 401)
    assert.equal(result.body.error, '邮箱或密码错误')
  }
  const locked = db.prepare('SELECT login_failures,login_locked_until FROM users WHERE id=?').get(member.user.id)
  assert.equal(Number(locked.login_failures), 5)
  assert.ok(locked.login_locked_until)
  assert.equal((await login('password123', '203.0.113.1')).status, 401)

  db.prepare("UPDATE users SET login_failure_started_at=datetime('now','-16 minutes'),login_locked_until=datetime('now','-1 second') WHERE id=?").run(member.user.id)
  assert.equal((await login('wrong-password', '203.0.113.2')).status, 401)
  const restarted = db.prepare('SELECT login_failures,login_locked_until FROM users WHERE id=?').get(member.user.id)
  assert.equal(Number(restarted.login_failures), 1)
  assert.equal(restarted.login_locked_until, null)
  assert.equal((await login('password123', '203.0.113.3')).status, 200)
  assert.deepEqual(
    { ...db.prepare('SELECT login_failures,login_failure_started_at,login_locked_until FROM users WHERE id=?').get(member.user.id) },
    { login_failures: 0, login_failure_started_at: null, login_locked_until: null },
  )
  const unknown = await request('/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.4' },
    body: JSON.stringify({ email: 'missing-account@example.com', password: 'password123' }),
  })
  assert.deepEqual(unknown, { status: 401, body: { error: '邮箱或密码错误' } })
})

test('authorization uses the current database role instead of a stale JWT claim', async () => {
  const user = await register('撤权测试用户', 'revoked-admin@example.com')
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.user.id)
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'revoked-admin@example.com', password: 'password123' }),
  })
  assert.equal(login.status, 200)
  assert.equal((await request('/admin/overview', { token: login.body.token })).status, 200)
  db.prepare("UPDATE users SET role='user' WHERE id=?").run(user.user.id)
  assert.equal((await request('/admin/overview', { token: login.body.token })).status, 403)
})

test('changing password revokes old sessions and returns a replacement token', async () => {
  const member = await register('Password Change User', 'password-change@example.com')
  const wrong = await request('/auth/password', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'replacement123' }),
  })
  assert.deepEqual(wrong, { status: 400, body: { error: '当前密码错误' } })
  assert.equal(Number(db.prepare('SELECT session_version FROM users WHERE id=?').get(member.user.id).session_version), 0)

  const changed = await request('/auth/password', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'password123', newPassword: 'replacement123' }),
  })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.token)
  assert.equal(Number(db.prepare('SELECT session_version FROM users WHERE id=?').get(member.user.id).session_version), 1)
  assert.equal((await request('/me', { token: member.token })).status, 401)
  assert.equal((await request('/me', { token: changed.body.token })).status, 200)
  assert.equal((await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'password-change@example.com', password: 'password123' }),
  })).status, 401)
  assert.equal((await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'password-change@example.com', password: 'replacement123' }),
  })).status, 200)
})

test('AI relay response size is bounded and reserved points are refunded', async () => {
  const member = await register('响应限制用户', 'response-limit@example.com')
  const relay = (await import('node:http')).createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('content-length', String(2 * 1024 * 1024 + 1))
    res.end()
  })
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${relay.address().port}/v1`
  process.env.AI_API_KEY = 'test-relay-key'
  const before = member.user.balance
  const result = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: 'oversized-response-0001', messages: [{ role: 'user', content: '测试响应限制' }], maxTokens: 128 }),
  })
  assert.equal(result.status, 502)
  assert.equal(result.body.error, '中转站返回内容过大')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, before)
  await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
})

test('AI relay chunked response size is bounded and reserved points are refunded', async () => {
  const member = await register('分块响应用户', 'chunked-response-limit@example.com')
  const relay = (await import('node:http')).createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    const chunk = Buffer.alloc(256 * 1024, 65)
    for (let index = 0; index < 9; index += 1) res.write(chunk)
    res.end()
  })
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  process.env.AI_BASE_URL = `http://127.0.0.1:${relay.address().port}/v1`
  process.env.AI_API_KEY = 'test-relay-key'
  const before = member.user.balance
  const result = await request('/ai/chat', {
    token: member.token,
    method: 'POST',
    body: JSON.stringify({ requestKey: 'chunked-oversized-response-0001', messages: [{ role: 'user', content: '测试分块响应限制' }], maxTokens: 128 }),
  })
  assert.equal(result.status, 502)
  assert.equal(result.body.error, '中转站返回内容过大')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, before)
  await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
})

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(temp, { recursive: true, force: true })
})
