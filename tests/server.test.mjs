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
process.env.NODE_ENV = 'test'
delete process.env.AI_BASE_URL
delete process.env.AI_API_KEY

const { default: app } = await import('../server/app.js')
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
    body: JSON.stringify({ name: '产品构思 v2', document }),
  })).status, 200)
  assert.deepEqual((await request(`/canvases/${canvasId}`, { token: member.token })).body.canvas.document, document)
  assert.equal((await request(`/canvases/${canvasId}`, { token: admin.token })).status, 404)

  const codes = await request('/admin/codes', {
    token: admin.token,
    method: 'POST',
    body: JSON.stringify({ points: 250, count: 1, maxUses: 1, label: '测试码' }),
  })
  assert.equal(codes.status, 201)
  const code = codes.body.codes[0]
  assert.match(code, /^INK-[A-F0-9]{12}$/)
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

  const beforeAI = (await request('/me', { token: member.token })).body.user.balance
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
  assert.equal(wallet.body.ledger[0].kind, 'ai_refund')
  assert.equal(wallet.body.ledger[1].kind, 'ai_reserve')

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
  process.env.AI_BASE_URL = `http://127.0.0.1:${relay.address().port}/v1`
  process.env.AI_API_KEY = 'test-relay-key'
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

  const interruptedId = crypto.randomUUID()
  transaction(() => {
    changeBalance(member.user.id, -7, 'ai_reserve', interruptedId, '模拟进程中断')
    db.prepare('INSERT INTO generations (id,user_id,request_key,model,reserved,status) VALUES (?,?,?,?,?,?)')
      .run(interruptedId, member.user.id, 'interrupted-request-0001', 'gpt-4o-mini', 7, 'pending')
  })
  assert.equal(recoverPendingGenerations(), 1)
  assert.equal(recoverPendingGenerations(), 0)
  assert.equal(db.prepare('SELECT status FROM generations WHERE id=?').get(interruptedId).status, 'failed')
  assert.equal((await request('/me', { token: member.token })).body.user.balance, balanceAfterSuccess)
  const recoveryEntries = db.prepare('SELECT amount FROM ledger WHERE reference=? ORDER BY rowid').all(interruptedId)
  assert.deepEqual(recoveryEntries.map((entry) => Number(entry.amount)), [-7, 7])

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

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(temp, { recursive: true, force: true })
})
