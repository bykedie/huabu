import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = mkdtempSync(join(tmpdir(), 'ink-relay-modernization-'))
process.env.DB_PATH = join(temp, 'test.db')
process.env.JWT_SECRET = 'relay-modernization-test-secret-32-bytes'
process.env.WELCOME_POINTS = '100'
process.env.REGISTRATION_RATE_LIMIT = '100'
process.env.AI_TIMEOUT_MS = '1000'
process.env.AI_VIDEO_TIMEOUT_MS = '30000'
process.env.AI_VIDEO_POLL_MS = '10'
process.env.AI_VIDEO_MAX_RESPONSE_BYTES = '2048'
process.env.MAX_USER_MEDIA_BYTES = '2048'
process.env.NODE_ENV = 'test'
delete process.env.AI_BASE_URL
delete process.env.AI_MODELS
delete process.env.AI_IMAGE_BASE_URL
delete process.env.AI_IMAGE_MODELS
delete process.env.AI_VIDEO_BASE_URL
delete process.env.AI_VIDEO_MODELS
delete process.env.SITE_BILLING_ENABLED

const { default: app } = await import('../server/app.js')
const { db } = await import('../server/db.js')

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

async function saveKey(token, kind, apiKey) {
  const result = await request(`/me/${kind}-key`, {
    token, method: 'PUT', body: JSON.stringify({ apiKey }),
  })
  assert.deepEqual(result, { status: 200, body: { configured: true } })
}

async function listen(handler) {
  const relay = createServer(handler)
  relay.listen(0, '127.0.0.1')
  await new Promise((resolve) => relay.once('listening', resolve))
  return {
    relay,
    root: `http://127.0.0.1:${relay.address().port}`,
    close: () => new Promise((resolve, reject) => relay.close((error) => error ? reject(error) : resolve())),
  }
}

const admin = await register('Relay Admin', 'relay-modernization-admin@example.com')

test('fresh relay configuration has no built-in text or image models', async () => {
  const config = await request('/config', { token: admin.token })
  assert.equal(config.status, 200)
  assert.deepEqual(config.body.textModels, [])
  assert.deepEqual(config.body.imageModels, [])

  const overview = await request('/admin/overview', { token: admin.token })
  assert.equal(overview.status, 200)
  assert.deepEqual(overview.body.text.models, [])
  assert.deepEqual(overview.body.image.models, [])
})

test('text, image, and video model discovery use the administrator corresponding user key', async () => {
  const keys = {
    text: 'synthetic-admin-text-discovery-key',
    image: 'synthetic-admin-image-discovery-key',
    video: 'synthetic-admin-video-discovery-key',
  }
  const calls = []
  const upstream = await listen((req, res) => {
    calls.push({ url: req.url, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [
      { id: `${req.url.split('/')[1]}-model-b` },
      { id: `${req.url.split('/')[1]}-model-a` },
      { id: `${req.url.split('/')[1]}-model-b` },
      { id: '' },
    ] }))
  })
  try {
    for (const kind of ['text', 'image', 'video']) {
      await saveKey(admin.token, kind, keys[kind])
      const saved = await request(`/admin/${kind}-config`, {
        token: admin.token, method: 'PUT',
        body: JSON.stringify({
          baseUrl: `${upstream.root}/${kind}/v1`,
          models: [`old-${kind}-preset`],
          ...(kind === 'video' ? { points: 24 } : {}),
        }),
      })
      assert.equal(saved.status, 200)
      const discovered = await request(`/admin/${kind}-config/models`, {
        token: admin.token, method: 'POST',
        body: JSON.stringify({ baseUrl: `${upstream.root}/${kind}/v1` }),
      })
      assert.deepEqual(discovered, {
        status: 200,
        body: { models: [`${kind}-model-b`, `${kind}-model-a`] },
      })
    }
    assert.deepEqual(calls, [
      { url: '/text/v1/models', authorization: `Bearer ${keys.text}` },
      { url: '/image/v1/models', authorization: `Bearer ${keys.image}` },
      { url: '/video/v1/models', authorization: `Bearer ${keys.video}` },
    ])
  } finally {
    await upstream.close()
  }
})

test('text generation prefers Responses, parses both text forms, and limits Chat Completions fallback', async () => {
  const textKey = 'synthetic-responses-user-key'
  const model = 'responses-text-model'
  const calls = []
  const upstream = await listen(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const payload = raw ? JSON.parse(raw) : {}
    calls.push({ url: req.url, payload, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    const inputText = Array.isArray(payload.input)
      ? payload.input.map((item) => item.content).join(' ')
      : payload.messages?.map((item) => item.content).join(' ') || ''
    if (req.url === '/text/v1/responses') {
      if (inputText.includes('top-level')) return res.end(JSON.stringify({ output_text: 'top-level response', usage: { input_tokens: 2, output_tokens: 3 } }))
      if (inputText.includes('nested')) return res.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'nested response' }] }], usage: { input_tokens: 4, output_tokens: 5 } }))
      if (inputText.includes('fallback-404')) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'unsupported' })) }
      if (inputText.includes('fallback-405')) { res.statusCode = 405; return res.end(JSON.stringify({ error: 'unsupported' })) }
      res.statusCode = 500
      return res.end(JSON.stringify({ error: 'temporary failure' }))
    }
    if (req.url === '/text/v1/chat/completions') {
      return res.end(JSON.stringify({ choices: [{ message: { content: `fallback response: ${inputText}` } }], usage: { prompt_tokens: 6, completion_tokens: 7 } }))
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'missing' }))
  })
  try {
    await saveKey(admin.token, 'text', textKey)
    assert.equal((await request('/admin/text-config', {
      token: admin.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: `${upstream.root}/text/v1`, models: [model] }),
    })).status, 200)

    const balanceBefore = (await request('/me', { token: admin.token })).body.user.balance
    const ledgerBefore = (await request('/wallet', { token: admin.token })).body.ledger.length
    const generate = (requestKey, content) => request('/ai/chat', {
      token: admin.token, method: 'POST',
      body: JSON.stringify({ requestKey, model, messages: [{ role: 'user', content }], maxTokens: 128 }),
    })

    const topLevel = await generate('responses-top-level', 'top-level')
    assert.equal(topLevel.status, 200)
    assert.equal(topLevel.body.content, 'top-level response')
    assert.equal(topLevel.body.charged, 0)

    const nested = await generate('responses-nested', 'nested')
    assert.equal(nested.status, 200)
    assert.equal(nested.body.content, 'nested response')
    assert.equal(nested.body.charged, 0)

    for (const status of [404, 405]) {
      const fallback = await generate(`responses-fallback-${status}`, `fallback-${status}`)
      assert.equal(fallback.status, 200)
      assert.equal(fallback.body.content, `fallback response: fallback-${status}`)
      assert.equal(fallback.body.charged, 0)
    }

    const chatCallsBefore500 = calls.filter((call) => call.url.endsWith('/chat/completions')).length
    const noFallback = await generate('responses-no-fallback-500', 'no-fallback-500')
    assert.equal(noFallback.status, 502)
    assert.equal(calls.filter((call) => call.url.endsWith('/chat/completions')).length, chatCallsBefore500)

    const responseCalls = calls.filter((call) => call.url.endsWith('/responses'))
    assert.equal(responseCalls.length, 5)
    assert.equal(responseCalls.every((call) => call.authorization === `Bearer ${textKey}`), true)
    assert.equal(responseCalls.every((call) => Array.isArray(call.payload.input)), true)
    assert.equal(responseCalls.every((call) => call.payload.max_output_tokens === 128), true)
    assert.equal((await request('/me', { token: admin.token })).body.user.balance, balanceBefore)
    assert.equal((await request('/wallet', { token: admin.token })).body.ledger.length, ledgerBefore)
    for (const requestKey of ['responses-top-level', 'responses-nested', 'responses-fallback-404', 'responses-fallback-405']) {
      assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get(requestKey) }, { reserved: 0, charged: 0, status: 'succeeded' })
    }
  } finally {
    await upstream.close()
  }
})

test('text relay sends bounded references through non-streaming Responses and Chat Completions payloads', async () => {
  const textKey = 'synthetic-multimodal-user-key'
  const directModel = 'responses-multimodal-model'
  const fallbackModel = 'chat-multimodal-model'
  const calls = []
  const upstream = await listen(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const payload = raw ? JSON.parse(raw) : {}
    calls.push({ url: req.url, payload, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/multimodal/v1/responses' && payload.model === fallbackModel) {
      res.statusCode = 404
      return res.end(JSON.stringify({ error: 'responses unsupported for this model' }))
    }
    if (payload.stream !== false) return
    if (req.url === '/multimodal/v1/responses') return res.end(JSON.stringify({ output_text: 'responses saw image' }))
    if (req.url === '/multimodal/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: 'chat saw image' } }] }))
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'missing' }))
  })
  try {
    await saveKey(admin.token, 'text', textKey)
    assert.equal((await request('/admin/text-config', {
      token: admin.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: `${upstream.root}/multimodal/v1`, models: [directModel, fallbackModel] }),
    })).status, 200)
    const references = ['data:image/png;base64,iVBORw0KGgo=']
    const generate = (requestKey, model, content) => request('/ai/chat', {
      token: admin.token, method: 'POST',
      body: JSON.stringify({ requestKey, model, messages: [{ role: 'user', content }], references, maxTokens: 128 }),
    })

    const direct = await generate('responses-multimodal-direct', directModel, 'inspect direct reference')
    assert.equal(direct.status, 200)
    assert.equal(direct.body.content, 'responses saw image')
    const fallback = await generate('responses-multimodal-fallback', fallbackModel, 'inspect fallback reference')
    assert.equal(fallback.status, 200)
    assert.equal(fallback.body.content, 'chat saw image')

    assert.equal(calls.every((call) => call.authorization === `Bearer ${textKey}`), true)
    assert.equal(calls.every((call) => call.payload.stream === false), true)
    assert.deepEqual(calls[0].payload.input.at(-1).content, [
      { type: 'input_text', text: 'inspect direct reference' },
      { type: 'input_image', image_url: references[0] },
    ])
    assert.deepEqual(calls.at(-1).payload.messages.at(-1).content, [
      { type: 'text', text: 'inspect fallback reference' },
      { type: 'image_url', image_url: { url: references[0] } },
    ])
  } finally {
    await upstream.close()
  }
})

test('video generation reserves zero site points when billing is disabled', async () => {
  const videoKey = 'synthetic-no-billing-video-key'
  const model = 'video-no-billing-model'
  const upstream = await listen(async (req, res) => {
    for await (const _chunk of req) { /* drain request */ }
    assert.equal(req.url, '/video/v1/videos')
    assert.equal(req.headers.authorization, `Bearer ${videoKey}`)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'pending-video-task' }))
  })
  try {
    await saveKey(admin.token, 'video', videoKey)
    assert.equal((await request('/admin/video-config', {
      token: admin.token, method: 'PUT',
      body: JSON.stringify({ baseUrl: `${upstream.root}/video/v1`, models: [model], points: 24 }),
    })).status, 200)
    const balanceBefore = (await request('/me', { token: admin.token })).body.user.balance
    const ledgerBefore = (await request('/wallet', { token: admin.token })).body.ledger.length
    const created = await request('/ai/video', {
      token: admin.token, method: 'POST',
      body: JSON.stringify({ requestKey: 'video-zero-site-billing', model, prompt: 'test video', size: '1280x720', seconds: 1 }),
    })
    assert.equal(created.status, 202)
    assert.equal(created.body.charged, 0)
    assert.deepEqual({ ...db.prepare('SELECT reserved,charged,status FROM generations WHERE request_key=?').get('video-zero-site-billing') }, {
      reserved: 0, charged: null, status: 'pending',
    })
    assert.equal((await request('/me', { token: admin.token })).body.user.balance, balanceBefore)
    assert.equal((await request('/wallet', { token: admin.token })).body.ledger.length, ledgerBefore)
  } finally {
    await upstream.close()
  }
})

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(temp, { recursive: true, force: true })
})
