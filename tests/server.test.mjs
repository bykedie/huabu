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
process.env.AI_IMAGE_MAX_RESPONSE_BYTES = '2048'
process.env.AI_IMAGE_MODELS = 'GPT-image-2'
process.env.AI_VIDEO_MAX_RESPONSE_BYTES = '2048'
process.env.MAX_USER_MEDIA_BYTES = '2048'
process.env.NODE_ENV = 'test'
delete process.env.AI_BASE_URL
delete process.env.AI_API_KEY
delete process.env.AI_VIDEO_MEDIA_ORIGINS
delete process.env.PUBLIC_BIND
process.env.AI_IMAGE_BASE_URL = 'https://image-relay.example.test/v1'
process.env.AI_IMAGE_API_KEY = 'forbidden-image-environment-key'

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
  const trustProxy = app.get('trust proxy')
  assert.equal(trustProxy('127.0.0.1'), true)
  assert.equal(trustProxy('::1'), true)
  assert.equal(trustProxy('203.0.113.10'), false)
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
    assistantMessages: [{ id: 'm1', role: 'user', content: '下一步做什么？', createdAt: 123456 }],
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
  const credentialConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: 'http://user:password@127.0.0.1/v1', apiKey: 'test-relay-key', models: ['gpt-4o-mini'] }),
  })
  assert.equal(credentialConfig.status, 400)
  assert.match(credentialConfig.body.error, /用户名或密码/)
  assert.equal(JSON.stringify(credentialConfig.body).includes('user:password'), false)
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
  const textUserImageKey = 'test-text-user-image-key'
  assert.equal((await request('/me/image-key', {
    token: member.token, method: 'PUT', body: JSON.stringify({ apiKey: textUserImageKey }),
  })).status, 200)
  const textUserImageCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(member.user.id).image_api_key_encrypted
  assert.equal(textUserImageCiphertext.includes(textUserImageKey), false)
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

  process.env.AI_API_KEY = 'environment-key-must-not-override-clear'
  const clearedConfig = await request('/admin/ai-config', {
    token: admin.token, method: 'PUT', body: JSON.stringify({ baseUrl: '', clearApiKey: true, models: ['gpt-4o-mini'] }),
  })
  assert.equal(clearedConfig.status, 200)
  assert.equal(clearedConfig.body.configured, false)
  assert.equal(clearedConfig.body.keyConfigured, false)
  assert.equal(clearedConfig.body.source, 'database')
  assert.equal(db.prepare('SELECT ai_api_key_encrypted FROM app_settings WHERE id=1').get().ai_api_key_encrypted, null)
  db.prepare('UPDATE app_settings SET ai_base_url=NULL,ai_api_key_encrypted=NULL,ai_api_key_managed=0,ai_models=NULL WHERE id=1').run()
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
  assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(member.user.id).image_api_key_encrypted, textUserImageCiphertext)
  await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
})

test('asset library preserves ownership and shares the account storage quota', async () => {
  const owner = await register('资产用户', 'asset-owner@example.com')
  const other = await register('其他资产用户', 'asset-other@example.com')
  const invalidImage = await request('/assets', {
    token: owner.token, method: 'POST', body: JSON.stringify({ kind: 'image', title: '错误图片', content: 'not-an-image' }),
  })
  assert.equal(invalidImage.status, 400)

  const created = await request('/assets', {
    token: owner.token, method: 'POST', body: JSON.stringify({ kind: 'text', title: '角色设定', content: '一位穿红色风衣的侦探', sourceCanvasId: 'canvas-a', sourceNodeId: 'node-a' }),
  })
  assert.equal(created.status, 201)
  const assetId = created.body.asset.id
  assert.equal(created.body.asset.source_canvas_id, 'canvas-a')
  assert.deepEqual((await request('/assets', { token: owner.token })).body.assets.map((asset) => asset.id), [assetId])
  assert.deepEqual((await request('/assets', { token: other.token })).body.assets, [])
  assert.equal((await request(`/assets/${assetId}`, { token: other.token, method: 'DELETE' })).status, 404)
  assert.deepEqual((await request('/assets', { token: owner.token })).body.assets.map((asset) => asset.id), [assetId])
  assert.equal((await request(`/assets/${assetId}`, { token: owner.token, method: 'DELETE' })).status, 204)
  assert.deepEqual((await request('/assets', { token: owner.token })).body.assets, [])

  const quotaUser = await register('资产配额用户', 'asset-quota@example.com')
  const canvas = await request('/canvases', { token: quotaUser.token, method: 'POST', body: JSON.stringify({ name: '资产配额' }) })
  const quotaDocument = { nodes: [{ id: 'n', position: { x: 0, y: 0 }, data: { kind: 'text', content: 'x'.repeat(1200) } }], edges: [] }
  assert.equal((await request(`/canvases/${canvas.body.canvas.id}`, { token: quotaUser.token, method: 'PUT', body: JSON.stringify({ name: '资产配额', version: 0, document: quotaDocument }) })).status, 200)
  const canvasBytes = Number(db.prepare('SELECT length(CAST(document AS BLOB)) bytes FROM canvases WHERE id=?').get(canvas.body.canvas.id).bytes)
  const contentLength = 3072 - canvasBytes + 1
  assert.ok(contentLength > 0 && contentLength <= 2048)
  const overQuota = await request('/assets', { token: quotaUser.token, method: 'POST', body: JSON.stringify({ kind: 'text', title: '超出配额', content: 'y'.repeat(contentLength) }) })
  assert.equal(overQuota.status, 413)
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

test('video relay configuration and billing remain independent from user image keys', async () => {
  const admin = await register('视频配置管理员', 'video-relay-admin@example.com')
  const member = await register('视频生成用户', 'video-relay-member@example.com')
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id)
  const memberImageKey = 'test-video-user-image-key'
  assert.equal((await request('/me/image-key', {
    token: member.token, method: 'PUT', body: JSON.stringify({ apiKey: memberImageKey }),
  })).status, 200)
  const memberImageCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(member.user.id).image_api_key_encrypted
  assert.equal(memberImageCiphertext.includes(memberImageKey), false)

  let createCalls = 0
  let contentCalls = 0
  let redirectCalls = 0
  let externalMediaCalls = 0
  let externalMediaAuthorizationPresent = false
  let unsafeTargetFetches = 0
  const videoKey = 'test-video-relay-key'
  const externalMedia = (await import('node:http')).createServer((req, res) => {
    externalMediaCalls += 1
    externalMediaAuthorizationPresent ||= Boolean(req.headers.authorization)
    assert.equal(req.url, '/external.mp4')
    res.setHeader('content-type', 'video/mp4')
    res.end(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]))
  })
  externalMedia.listen(0, '127.0.0.1')
  await new Promise((resolve) => externalMedia.once('listening', resolve))
  const externalMediaOrigin = `http://127.0.0.1:${externalMedia.address().port}`
  const unsafeHosts = new Set(['169.254.169.254', '10.0.0.1'])
  process.env.AI_VIDEO_MEDIA_ORIGINS = [externalMediaOrigin, ...[...unsafeHosts].map((host) => `http://${host}`)].join(',')
  const fetchBeforeVideoSsrf = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (unsafeHosts.has(new URL(value).hostname)) {
      unsafeTargetFetches += 1
      throw new Error('unsafe video target fetch attempted')
    }
    return fetchBeforeVideoSsrf(input, init)
  }
  const relay = (await import('node:http')).createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${videoKey}`)
    if (req.method === 'POST' && req.url === '/v1/videos') {
      createCalls += 1
      for await (const _chunk of req) { /* drain multipart request */ }
      res.setHeader('content-type', 'application/json')
      if (createCalls === 2) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: { message: 'simulated video failure' } }))
        return
      }
      if (createCalls === 3) {
        res.end(JSON.stringify({ video_url: `${externalMediaOrigin}/external.mp4` }))
        return
      }
      if (createCalls === 4) {
        res.end(JSON.stringify({ video_url: 'http://169.254.169.254/result.mp4' }))
        return
      }
      if (createCalls === 5) {
        const port = relay.address().port
        res.end(JSON.stringify({ video_url: `http://127.0.0.1:${port}/redirect-private` }))
        return
      }
      if (createCalls === 6) {
        res.end(JSON.stringify({ id: 'quota-task', status: 'queued' }))
        return
      }
      if (createCalls === 7) {
        res.end(JSON.stringify({ id: 'download-error-task', status: 'queued' }))
        return
      }
      if (createCalls === 8) {
        res.end(JSON.stringify({ id: 'download-timeout-task', status: 'queued' }))
        return
      }
      if (createCalls === 9) {
        res.end(JSON.stringify({ id: 'unsafe-poll-task', status: 'queued' }))
        return
      }
      const port = relay.address().port
      res.end(JSON.stringify({ video_url: `http://127.0.0.1:${port}/result.mp4` }))
      return
    }
    if (req.method === 'GET' && ['/v1/videos/quota-task', '/v1/videos/download-error-task'].includes(req.url)) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: req.url.split('/').at(-1), status: 'completed' }))
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/download-timeout-task') {
      const port = relay.address().port
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'download-timeout-task', status: 'completed', video_url: `http://127.0.0.1:${port}/timeout.mp4` }))
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/unsafe-poll-task') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'unsafe-poll-task', status: 'completed', video_url: 'http://10.0.0.1/result.mp4' }))
      return
    }
    if (req.method === 'GET' && req.url === '/redirect-private') {
      redirectCalls += 1
      res.writeHead(302, { location: 'http://169.254.169.254/redirected.mp4' })
      res.end()
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/download-error-task/content') {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: { message: 'simulated download failure' } }))
      return
    }
    if (req.method === 'GET' && req.url === '/v1/videos/quota-task/content') {
      contentCalls += 1
      res.setHeader('content-type', 'video/mp4')
      res.end(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]))
      return
    }
    if (req.method === 'GET' && req.url === '/result.mp4') {
      contentCalls += 1
      res.setHeader('content-type', 'video/mp4')
      res.end(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]))
      return
    }
    res.statusCode = 404
    res.end()
  })
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  const relayBaseUrl = `http://127.0.0.1:${relay.address().port}/v1`

  try {
    const forbidden = await request('/admin/video-config', {
      token: member.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: relayBaseUrl, apiKey: videoKey, models: ['test-video-model'], points: 7 }),
    })
    assert.equal(forbidden.status, 403)

    const credentialConfig = await request('/admin/video-config', {
      token: admin.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: 'http://user:password@127.0.0.1/v1', apiKey: videoKey, models: ['test-video-model'], points: 7 }),
    })
    assert.equal(credentialConfig.status, 400)
    assert.match(credentialConfig.body.error, /用户名或密码/)
    assert.equal(JSON.stringify(credentialConfig.body).includes('user:password'), false)

    const saved = await request('/admin/video-config', {
      token: admin.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: relayBaseUrl, apiKey: videoKey, models: ['test-video-model'], points: 7 }),
    })
    assert.deepEqual(saved, {
      status: 200,
      body: { configured: true, keyConfigured: true, baseUrl: relayBaseUrl, models: ['test-video-model'], source: 'database', points: 7 },
    })
    assert.equal(JSON.stringify(saved.body).includes(videoKey), false)
    const stored = db.prepare('SELECT ai_video_api_key_encrypted FROM app_settings WHERE id=1').get().ai_video_api_key_encrypted
    assert.equal(stored.includes(videoKey), false)
    const audit = db.prepare("SELECT details FROM admin_audit WHERE action='video_config.update' ORDER BY rowid DESC LIMIT 1").get()
    assert.equal(audit.details.includes(videoKey), false)

    const config = await request('/config', { token: member.token })
    assert.deepEqual(config.body.videoModels, ['test-video-model'])
    assert.equal(config.body.videoPoints, 7)
    assert.equal(config.body.imageEndpoint, 'https://image-relay.example.test/v1/')
    assert.equal(config.body.imageConfigured, true)

    const walletBefore = await request('/wallet', { token: member.token })
    const payload = {
      requestKey: 'video-relay-success-0001', model: 'test-video-model',
      prompt: 'generate a test video', size: '1280x720', seconds: 6,
    }
    const generated = await request('/ai/video', {
      token: member.token, method: 'POST', body: JSON.stringify(payload),
    })
    assert.equal(generated.status, 200)
    assert.equal(generated.body.status, 'completed')
    assert.equal(generated.body.charged, 7)
    assert.equal(generated.body.cached, false)
    assert.match(generated.body.videoUrl, /^\/api\/media\/[a-f0-9-]+\?token=/)
    assert.equal(createCalls, 1)
    assert.equal(contentCalls, 1)
    assert.deepEqual({ ...db.prepare('SELECT kind,reserved,charged,status FROM generations WHERE request_key=?').get(payload.requestKey) }, {
      kind: 'video', reserved: 7, charged: 7, status: 'succeeded',
    })
    assert.equal((await request('/me', { token: member.token })).body.user.balance, walletBefore.body.balance - 7)
    assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(member.user.id).image_api_key_encrypted, memberImageCiphertext)

    const mediaResponse = await fetch(`http://127.0.0.1:${server.address().port}${generated.body.videoUrl}`)
    assert.equal(mediaResponse.status, 200)
    assert.equal(mediaResponse.headers.get('content-type'), 'video/mp4')
    assert.equal((await mediaResponse.arrayBuffer()).byteLength, 12)

    const replay = await request('/ai/video', {
      token: member.token, method: 'POST', body: JSON.stringify(payload),
    })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.cached, true)
    assert.equal(createCalls, 1)
    assert.equal(contentCalls, 1)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, walletBefore.body.balance - 7)

    const beforeFailure = (await request('/me', { token: member.token })).body.user.balance
    const failed = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-failure-0001', prompt: 'trigger the simulated failure' }),
    })
    assert.equal(failed.status, 502)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeFailure)
    assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get('video-relay-failure-0001') }, {
      reserved: 7, charged: null, status: 'failed',
    })
    assert.deepEqual(db.prepare('SELECT kind,amount FROM ledger WHERE reference=(SELECT id FROM generations WHERE request_key=?) ORDER BY rowid').all('video-relay-failure-0001').map((entry) => ({ ...entry, amount: Number(entry.amount) })), [
      { kind: 'ai_video_reserve', amount: -7 },
      { kind: 'ai_video_refund', amount: 7 },
    ])

    const beforeExternalMedia = (await request('/me', { token: member.token })).body.user.balance
    const externalMediaResult = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-external-media-0001', prompt: 'download from an allowed media origin' }),
    })
    assert.equal(externalMediaResult.status, 200)
    assert.equal(externalMediaResult.body.charged, 7)
    assert.equal(externalMediaCalls, 1)
    assert.equal(externalMediaAuthorizationPresent, false)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeExternalMedia - 7)

    const beforeUnsafeDirect = (await request('/me', { token: member.token })).body.user.balance
    const unsafeDirect = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-unsafe-direct-0001', prompt: 'reject a direct private result URL' }),
    })
    assert.equal(unsafeDirect.status, 502)
    assert.equal(unsafeTargetFetches, 0)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeUnsafeDirect)
    assert.deepEqual({ ...db.prepare('SELECT reserved,status FROM generations WHERE request_key=?').get('video-relay-unsafe-direct-0001') }, { reserved: 7, status: 'failed' })
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=(SELECT id FROM generations WHERE request_key=?)').get('video-relay-unsafe-direct-0001').count, 2)

    const beforeUnsafeRedirect = (await request('/me', { token: member.token })).body.user.balance
    const unsafeRedirect = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-unsafe-redirect-0001', prompt: 'reject a redirect to a private result URL' }),
    })
    assert.equal(unsafeRedirect.status, 502)
    assert.equal(redirectCalls, 1)
    assert.equal(unsafeTargetFetches, 0)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeUnsafeRedirect)
    assert.equal(db.prepare('SELECT status FROM generations WHERE request_key=?').get('video-relay-unsafe-redirect-0001').status, 'failed')
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=(SELECT id FROM generations WHERE request_key=?)').get('video-relay-unsafe-redirect-0001').count, 2)

    db.prepare('INSERT INTO media (id,user_id,kind,file_name,mime_type,bytes,data) VALUES (?,?,?,?,?,?,?)')
      .run('quota-filler-media', member.user.id, 'video', 'quota-filler.mp4', 'video/mp4', 2030, Buffer.alloc(2030))
    const beforeQuota = (await request('/me', { token: member.token })).body.user.balance
    const quotaCreated = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-quota-0001', prompt: 'create an asynchronous quota result' }),
    })
    assert.equal(quotaCreated.status, 202)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeQuota - 7)
    const quotaPoll = await request(`/ai/video/${quotaCreated.body.id}`, { token: member.token })
    assert.equal(quotaPoll.status, 413)
    assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(quotaCreated.body.id).status, 'failed')
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeQuota)
    assert.deepEqual(db.prepare('SELECT kind,amount FROM ledger WHERE reference=? ORDER BY rowid').all(quotaCreated.body.id).map((entry) => ({ ...entry, amount: Number(entry.amount) })), [
      { kind: 'ai_video_reserve', amount: -7 },
      { kind: 'ai_video_refund', amount: 7 },
    ])
    assert.equal((await request(`/ai/video/${quotaCreated.body.id}`, { token: member.token })).status, 409)
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeQuota)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=?').get(quotaCreated.body.id).count, 2)

    const beforeDownloadFailure = (await request('/me', { token: member.token })).body.user.balance
    const downloadFailureCreated = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-download-failure-0001', prompt: 'create a transient download failure' }),
    })
    assert.equal(downloadFailureCreated.status, 202)
    assert.equal((await request(`/ai/video/${downloadFailureCreated.body.id}`, { token: member.token })).status, 502)
    assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(downloadFailureCreated.body.id).status, 'pending')
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeDownloadFailure - 7)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=?').get(downloadFailureCreated.body.id).count, 1)

    const beforeDownloadTimeout = (await request('/me', { token: member.token })).body.user.balance
    const downloadTimeoutCreated = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-download-timeout-0001', prompt: 'create a transient download timeout' }),
    })
    assert.equal(downloadTimeoutCreated.status, 202)
    const timeoutUrl = `http://127.0.0.1:${relay.address().port}/timeout.mp4`
    const fetchBeforeTimeout = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === timeoutUrl) {
        const error = new Error('simulated timeout')
        error.name = 'AbortError'
        throw error
      }
      return fetchBeforeTimeout(input, init)
    }
    let downloadTimeout
    try { downloadTimeout = await request(`/ai/video/${downloadTimeoutCreated.body.id}`, { token: member.token }) }
    finally { globalThis.fetch = fetchBeforeTimeout }
    assert.equal(downloadTimeout.status, 504)
    assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(downloadTimeoutCreated.body.id).status, 'pending')
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeDownloadTimeout - 7)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=?').get(downloadTimeoutCreated.body.id).count, 1)

    const beforeUnsafePoll = (await request('/me', { token: member.token })).body.user.balance
    const unsafePollCreated = await request('/ai/video', {
      token: member.token, method: 'POST',
      body: JSON.stringify({ ...payload, requestKey: 'video-relay-unsafe-poll-0001', prompt: 'reject a polled private result URL' }),
    })
    assert.equal(unsafePollCreated.status, 202)
    assert.equal((await request(`/ai/video/${unsafePollCreated.body.id}`, { token: member.token })).status, 502)
    assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(unsafePollCreated.body.id).status, 'pending')
    assert.equal((await request('/me', { token: member.token })).body.user.balance, beforeUnsafePoll - 7)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ledger WHERE reference=?').get(unsafePollCreated.body.id).count, 1)
    assert.equal(unsafeTargetFetches, 0)
    assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(member.user.id).image_api_key_encrypted, memberImageCiphertext)
  } finally {
    globalThis.fetch = fetchBeforeVideoSsrf
    delete process.env.AI_VIDEO_MEDIA_ORIGINS
    await new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => externalMedia.close((error) => error ? reject(error) : resolve()))
  }
})

test('user-owned image keys stay private, isolated, server-routed, and free of site charges', async () => {
  const originalFetch = globalThis.fetch
  const generationUrl = 'https://image-relay.example.test/v1/images/generations'
  const editUrl = 'https://image-relay.example.test/v1/images/edits'
  const calls = []
  let deniedAttempts = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== generationUrl && url !== editUrl) {
      const parsed = new URL(url)
      if (['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return originalFetch(input, init)
      throw new Error(`unexpected external fetch: ${parsed.origin}${parsed.pathname}`)
    }
    const headers = new Headers(init.headers)
    const authorization = headers.get('authorization')
    const call = { url, authorization, redirect: init.redirect }
    if (url === generationUrl) {
      const payload = JSON.parse(String(init.body))
      Object.assign(call, { model: payload.model, prompt: payload.prompt, size: payload.size })
      calls.push(call)
      if (payload.prompt === 'reject this image key' && ++deniedAttempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'secret upstream detail' } }), {
          status: 401, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ data: [{ url: 'https://images.example.test/generated.png' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    assert.ok(init.body instanceof FormData)
    Object.assign(call, {
      model: init.body.get('model'),
      prompt: init.body.get('prompt'),
      size: init.body.get('size'),
      imageName: init.body.get('image')?.name,
    })
    calls.push(call)
    return new Response(JSON.stringify({ data: [{ image_url: 'https://images.example.test/edited.png' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const legacyShared = await register('旧共享图片配置', 'legacy-shared-image@example.com')
    const legacySharedKey = 'forbidden-legacy-shared-image-key'
    assert.equal((await request('/me/image-key', {
      token: legacyShared.token, method: 'PUT', body: JSON.stringify({ apiKey: legacySharedKey }),
    })).status, 200)
    const legacySharedCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(legacyShared.user.id).image_api_key_encrypted
    db.prepare('UPDATE app_settings SET ai_image_base_url=?,ai_image_api_key_encrypted=?,ai_image_models=?,ai_image_points=? WHERE id=1')
      .run('https://forbidden-legacy-image.example/v1', legacySharedCiphertext, JSON.stringify(['forbidden-legacy-image-model']), 999)
    const owner = await register('用户密钥甲', 'user-image-key-a@example.com')
    const other = await register('用户密钥乙', 'user-image-key-b@example.com')
    const ownerKey = 'test-user-a-image-key'
    const replacementKey = 'test-user-a-replacement-key'
    const otherKey = 'test-user-b-image-key'
    const temporaryKey = 'test-temporary-image-key'
    const initialOwner = await request('/me', { token: owner.token })
    assert.equal(initialOwner.body.user.imageApiKeyConfigured, false)
    assert.equal('imageApiKey' in initialOwner.body.user, false)

    const temporaryTest = await request('/me/image-key/test', {
      token: owner.token, method: 'POST', body: JSON.stringify({ apiKey: temporaryKey, model: 'GPT-image-2' }),
    })
    assert.deepEqual(temporaryTest, { status: 200, body: { ok: true, status: 200, model: 'GPT-image-2' } })
    assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(owner.user.id).image_api_key_encrypted, null)
    assert.equal((await request('/me', { token: owner.token })).body.user.imageApiKeyConfigured, false)

    const savedOwner = await request('/me/image-key', {
      token: owner.token, method: 'PUT', body: JSON.stringify({ apiKey: ownerKey }),
    })
    assert.deepEqual(savedOwner, {
      status: 200, body: { configured: true, endpoint: 'https://image-relay.example.test/v1/', models: ['GPT-image-2'] },
    })
    const ownerCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(owner.user.id).image_api_key_encrypted
    assert.equal(ownerCiphertext.split('.').length, 3)
    assert.equal(ownerCiphertext.includes(ownerKey), false)
    const ownerProfile = await request('/me', { token: owner.token })
    assert.equal(ownerProfile.body.user.imageApiKeyConfigured, true)
    assert.equal('imageApiKey' in ownerProfile.body.user, false)
    assert.equal('image_api_key_encrypted' in ownerProfile.body.user, false)
    assert.equal(JSON.stringify(ownerProfile.body).includes(ownerKey), false)

    const savedKeyTest = await request('/me/image-key/test', {
      token: owner.token, method: 'POST', body: JSON.stringify({ model: 'GPT-image-2' }),
    })
    assert.deepEqual(savedKeyTest, { status: 200, body: { ok: true, status: 200, model: 'GPT-image-2' } })

    const replacedOwner = await request('/me/image-key', {
      token: owner.token, method: 'PUT', body: JSON.stringify({ apiKey: replacementKey }),
    })
    assert.deepEqual(replacedOwner, {
      status: 200, body: { configured: true, endpoint: 'https://image-relay.example.test/v1/', models: ['GPT-image-2'] },
    })
    const replacementCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(owner.user.id).image_api_key_encrypted
    assert.notEqual(replacementCiphertext, ownerCiphertext)
    assert.equal(replacementCiphertext.includes(ownerKey), false)
    assert.equal(replacementCiphertext.includes(replacementKey), false)

    assert.equal((await request('/me', { token: other.token })).body.user.imageApiKeyConfigured, false)
    assert.equal((await request('/config', { token: other.token })).body.imageConfigured, false)
    assert.equal((await request('/me/image-key', {
      token: other.token, method: 'PUT', body: JSON.stringify({ apiKey: otherKey }),
    })).status, 200)
    const otherCiphertext = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(other.user.id).image_api_key_encrypted
    assert.equal(otherCiphertext.split('.').length, 3)
    assert.equal(otherCiphertext.includes(otherKey), false)
    assert.notEqual(otherCiphertext, ownerCiphertext)
    assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(owner.user.id).image_api_key_encrypted, replacementCiphertext)

    const ownerWalletBefore = await request('/wallet', { token: owner.token })
    const otherWalletBefore = await request('/wallet', { token: other.token })
    const generated = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-success-0001', model: 'GPT-image-2', prompt: 'generate for user a', size: '1024x1024' }),
    })
    assert.deepEqual(generated, {
      status: 200,
      body: { imageUrl: 'https://images.example.test/generated.png', model: 'GPT-image-2', charged: 0, cached: false },
    })
    const successfulRow = db.prepare('SELECT kind,reserved,charged,status FROM generations WHERE request_key=?').get('user-owned-image-success-0001')
    assert.deepEqual({ ...successfulRow }, { kind: 'image', reserved: 0, charged: 0, status: 'succeeded' })

    const edited = await request('/ai/image', {
      token: other.token, method: 'POST',
      body: JSON.stringify({
        requestKey: 'user-owned-image-edit-0001', model: 'GPT-image-2', prompt: 'edit for user b', size: '1024x1024',
        references: ['data:image/png;base64,iVBORw0KGgo='],
      }),
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.imageUrl, 'https://images.example.test/edited.png')
    assert.equal(edited.body.charged, 0)
    assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get('user-owned-image-edit-0001') }, {
      reserved: 0, charged: 0, status: 'succeeded',
    })

    const callsBeforeReplay = calls.length
    const replay = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-success-0001', model: 'GPT-image-2', prompt: 'generate for user a', size: '1024x1024' }),
    })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.cached, true)
    assert.equal(calls.length, callsBeforeReplay)
    const conflict = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-success-0001', model: 'GPT-image-2', prompt: 'different content', size: '1024x1024' }),
    })
    assert.equal(conflict.status, 409)
    assert.equal(calls.length, callsBeforeReplay)

    const denied = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-denied-0001', model: 'GPT-image-2', prompt: 'reject this image key', size: '1024x1024' }),
    })
    assert.equal(denied.status, 400)
    assert.equal(denied.body.error, 'API 密钥无效、已过期或没有生图权限')
    assert.equal(JSON.stringify(denied.body).includes('secret upstream detail'), false)
    assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get('user-owned-image-denied-0001') }, {
      reserved: 0, charged: 0, status: 'failed',
    })
    const deniedRetry = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-denied-0001', model: 'GPT-image-2', prompt: 'reject this image key', size: '1024x1024' }),
    })
    assert.deepEqual(deniedRetry, {
      status: 200,
      body: { imageUrl: 'https://images.example.test/generated.png', model: 'GPT-image-2', charged: 0, cached: false },
    })
    assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get('user-owned-image-denied-0001') }, {
      reserved: 0, charged: 0, status: 'succeeded',
    })

    const cleared = await request('/me/image-key', { token: owner.token, method: 'DELETE' })
    assert.deepEqual(cleared, {
      status: 200, body: { configured: false, endpoint: 'https://image-relay.example.test/v1/', models: ['GPT-image-2'] },
    })
    assert.equal(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(owner.user.id).image_api_key_encrypted, null)
    assert.equal((await request('/me', { token: owner.token })).body.user.imageApiKeyConfigured, false)
    const callsBeforeClearedReplay = calls.length
    const clearedReplay = await request('/ai/image', {
      token: owner.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'user-owned-image-success-0001', model: 'GPT-image-2', prompt: 'generate for user a', size: '1024x1024' }),
    })
    assert.equal(clearedReplay.status, 400)
    assert.match(clearedReplay.body.error, /保存生图 API 密钥/)
    assert.equal(calls.length, callsBeforeClearedReplay)

    const ownerWalletAfter = await request('/wallet', { token: owner.token })
    const otherWalletAfter = await request('/wallet', { token: other.token })
    assert.deepEqual(ownerWalletAfter.body, ownerWalletBefore.body)
    assert.deepEqual(otherWalletAfter.body, otherWalletBefore.body)
    assert.deepEqual(calls.map(({ url, authorization }) => ({ url, authorization })), [
      { url: generationUrl, authorization: `Bearer ${temporaryKey}` },
      { url: generationUrl, authorization: `Bearer ${ownerKey}` },
      { url: generationUrl, authorization: `Bearer ${replacementKey}` },
      { url: editUrl, authorization: `Bearer ${otherKey}` },
      { url: generationUrl, authorization: `Bearer ${replacementKey}` },
      { url: generationUrl, authorization: `Bearer ${replacementKey}` },
    ])
    assert.equal(calls.every((call) => call.redirect === 'manual'), true)
    assert.deepEqual(calls[2], { url: generationUrl, authorization: `Bearer ${replacementKey}`, redirect: 'manual', model: 'GPT-image-2', prompt: 'generate for user a', size: '1024x1024' })
    assert.deepEqual(calls[3], { url: editUrl, authorization: `Bearer ${otherKey}`, redirect: 'manual', model: 'GPT-image-2', prompt: 'edit for user b', size: '1024x1024', imageName: 'reference-1.png' })
    assert.deepEqual({ ...db.prepare('SELECT ai_image_base_url,ai_image_api_key_encrypted,ai_image_models,ai_image_points FROM app_settings WHERE id=1').get() }, {
      ai_image_base_url: 'https://forbidden-legacy-image.example/v1',
      ai_image_api_key_encrypted: legacySharedCiphertext,
      ai_image_models: JSON.stringify(['forbidden-legacy-image-model']),
      ai_image_points: 999,
    })
    assert.equal(calls.some((call) => call.authorization === `Bearer ${legacySharedKey}`), false)
    assert.equal(calls.some((call) => call.authorization === 'Bearer forbidden-image-environment-key'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(temp, { recursive: true, force: true })
})
