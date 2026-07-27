import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { db, transaction, changeBalance } from './db.js'

const app = express()
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me'
const welcomePoints = Number(process.env.WELCOME_POINTS || 100)
const inputRate = Number(process.env.AI_INPUT_POINTS_PER_1K || 1)
const outputRate = Number(process.env.AI_OUTPUT_POINTS_PER_1K || 4)
const allowedModels = (process.env.AI_MODELS || 'gpt-4o-mini').split(',').map((item) => item.trim()).filter(Boolean)
app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
    },
  },
}))
const limiter = (limit, options = {}) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '操作过于频繁，请稍后再试' },
  ...options,
})
app.use('/api', limiter(300))
app.use('/api/auth', limiter(15, { skipSuccessfulRequests: true }))
app.use('/api/redeem', limiter(20))
app.use('/api/ai', limiter(40))
app.use('/api', express.json({ limit: '12mb' }))

const fail = (status, message) => Object.assign(new Error(message), { status })
const hashCode = (code) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name, role: row.role, balance: Number(row.balance) })
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' })

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw fail(400, result.error.issues[0]?.message || '参数错误')
  return result.data
}
function auth(req, _res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    if (!token) throw fail(401, '请先登录')
    req.auth = jwt.verify(token, jwtSecret)
    next()
  } catch { next(fail(401, '登录已失效')) }
}
function admin(req, _res, next) {
  if (req.auth?.role !== 'admin') return next(fail(403, '需要管理员权限'))
  next()
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/config', auth, (_req, res) => res.json({ aiModel: allowedModels[0] }))
app.post('/api/auth/register', (req, res, next) => {
  try {
    const body = parse(z.object({
      name: z.string().trim().min(2, '昵称至少 2 个字').max(30),
      email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
      password: z.string().min(8, '密码至少 8 位').max(72),
    }), req.body)
    const id = randomUUID()
    let role
    transaction(() => {
      role = Number(db.prepare('SELECT COUNT(*) count FROM users').get().count) === 0 ? 'admin' : 'user'
      db.prepare('INSERT INTO users (id,email,password_hash,name,role,balance) VALUES (?,?,?,?,?,0)')
        .run(id, body.email, bcrypt.hashSync(body.password, 12), body.name, role)
      if (welcomePoints > 0) changeBalance(id, welcomePoints, 'welcome', id, '新用户赠送')
    })
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    res.status(201).json({ token: sign(user), user: publicUser(user) })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return next(fail(409, '该邮箱已注册'))
    next(error)
  }
})
app.post('/api/auth/login', (req, res, next) => {
  try {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    if (!user || !bcrypt.compareSync(body.password, user.password_hash)) throw fail(401, '邮箱或密码错误')
    res.json({ token: sign(user), user: publicUser(user) })
  } catch (error) { next(error) }
})
app.get('/api/me', auth, (req, res, next) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)
  if (!user) return next(fail(401, '用户不存在'))
  res.json({ user: publicUser(user) })
})

app.get('/api/canvases', auth, (req, res) => {
  const rows = db.prepare('SELECT id,name,created_at,updated_at FROM canvases WHERE user_id = ? ORDER BY updated_at DESC').all(req.auth.sub)
  res.json({ canvases: rows })
})
app.post('/api/canvases', auth, (req, res, next) => {
  try {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80).default('未命名画布') }), req.body)
    const canvas = { id: randomUUID(), name }
    db.prepare('INSERT INTO canvases (id,user_id,name) VALUES (?,?,?)').run(canvas.id, req.auth.sub, name)
    res.status(201).json({ canvas: { ...canvas, document: { nodes: [], edges: [] } } })
  } catch (error) { next(error) }
})
app.get('/api/canvases/:id', auth, (req, res, next) => {
  const row = db.prepare('SELECT * FROM canvases WHERE id = ? AND user_id = ?').get(req.params.id, req.auth.sub)
  if (!row) return next(fail(404, '画布不存在'))
  res.json({ canvas: { ...row, document: JSON.parse(row.document) } })
})
app.put('/api/canvases/:id', auth, (req, res, next) => {
  try {
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      document: z.object({ nodes: z.array(z.unknown()).max(1000), edges: z.array(z.unknown()).max(2000) }),
    }), req.body)
    const result = db.prepare('UPDATE canvases SET name=?,document=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
      .run(body.name, JSON.stringify(body.document), req.params.id, req.auth.sub)
    if (!result.changes) throw fail(404, '画布不存在')
    res.json({ ok: true })
  } catch (error) { next(error) }
})
app.delete('/api/canvases/:id', auth, (req, res, next) => {
  const result = db.prepare('DELETE FROM canvases WHERE id=? AND user_id=?').run(req.params.id, req.auth.sub)
  if (!result.changes) return next(fail(404, '画布不存在'))
  res.status(204).end()
})

app.get('/api/wallet', auth, (req, res) => {
  const { balance } = db.prepare('SELECT balance FROM users WHERE id=?').get(req.auth.sub)
  const ledger = db.prepare('SELECT id,amount,balance_after,kind,note,created_at FROM ledger WHERE user_id=? ORDER BY rowid DESC LIMIT 50').all(req.auth.sub)
  res.json({ balance: Number(balance), ledger })
})
app.post('/api/redeem', auth, (req, res, next) => {
  try {
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(64) }), req.body)
    const result = transaction(() => {
      const item = db.prepare('SELECT * FROM redeem_codes WHERE code_hash=?').get(hashCode(code))
      if (!item || item.uses >= item.max_uses || (item.expires_at && new Date(item.expires_at) < new Date())) throw fail(400, '兑换码无效或已用完')
      try { db.prepare('INSERT INTO redemptions (code_id,user_id) VALUES (?,?)').run(item.id, req.auth.sub) }
      catch { throw fail(409, '你已经使用过该兑换码') }
      db.prepare('UPDATE redeem_codes SET uses=uses+1 WHERE id=?').run(item.id)
      return { points: item.points, balance: changeBalance(req.auth.sub, Number(item.points), 'redeem', item.id, item.label || '兑换码充值') }
    })
    res.json(result)
  } catch (error) { next(error) }
})
app.get('/api/topups', auth, (req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM topup_orders WHERE user_id=? ORDER BY created_at DESC').all(req.auth.sub) })
})
app.post('/api/topups', auth, (req, res, next) => {
  try {
    const body = parse(z.object({ amountCents: z.number().int().min(100).max(10000000), proof: z.string().trim().max(500).optional() }), req.body)
    const order = { id: randomUUID(), points: Math.floor(body.amountCents / Number(process.env.CENTS_PER_POINT || 1)) }
    db.prepare('INSERT INTO topup_orders (id,user_id,amount_cents,points,proof) VALUES (?,?,?,?,?)')
      .run(order.id, req.auth.sub, body.amountCents, order.points, body.proof || null)
    res.status(201).json({ order: { ...order, amount_cents: body.amountCents, status: 'pending' } })
  } catch (error) { next(error) }
})

app.post('/api/ai/chat', auth, async (req, res, next) => {
  let generation
  try {
    const body = parse(z.object({
      requestKey: z.string().min(8).max(100),
      model: z.string().min(1).max(100).optional(),
      messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(100000),
      })).min(1).max(50),
      maxTokens: z.number().int().min(16).max(8192).default(1024),
    }), req.body)
    const cached = db.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?').get(req.auth.sub, body.requestKey)
    if (cached?.status === 'succeeded') return res.json(JSON.parse(cached.response))
    if (cached) throw fail(409, '该请求已处理，请换一个请求标识')
    const model = body.model || allowedModels[0]
    if (!allowedModels.includes(model)) throw fail(400, '该模型未开放')
    const promptTokens = body.messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0)
    const reserved = Math.max(1, Math.ceil(promptTokens / 1000 * inputRate + body.maxTokens / 1000 * outputRate))
    generation = { id: randomUUID(), userId: req.auth.sub, reserved }
    transaction(() => {
      changeBalance(req.auth.sub, -reserved, 'ai_reserve', generation.id, `AI 调用预占：${model}`)
      db.prepare('INSERT INTO generations (id,user_id,request_key,model,reserved,status) VALUES (?,?,?,?,?,?)')
        .run(generation.id, req.auth.sub, body.requestKey, model, reserved, 'pending')
    })
    const base = (process.env.AI_BASE_URL || '').replace(/\/$/, '')
    const key = process.env.AI_API_KEY
    if (!base || !key) throw fail(503, '管理员尚未配置 AI 中转站')
    const url = new URL(`${base}/chat/completions`)
    const allowedProtocols = process.env.NODE_ENV === 'production' ? ['https:'] : ['https:', 'http:']
    if (!allowedProtocols.includes(url.protocol)) throw fail(500, '中转站地址必须使用 HTTPS')
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: body.messages, max_tokens: body.maxTokens, stream: false }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 120000)),
    })
    if (!upstream.ok) throw fail(502, `中转站请求失败（${upstream.status}）`)
    const data = await upstream.json()
    const usage = data.usage || {}
    const actual = Math.max(1, Math.ceil(
      Number(usage.prompt_tokens || promptTokens) / 1000 * inputRate
      + Number(usage.completion_tokens || body.maxTokens) / 1000 * outputRate,
    ))
    const charged = Math.min(actual, reserved)
    const response = { id: generation.id, content: data.choices?.[0]?.message?.content || '', usage, charged }
    transaction(() => {
      if (reserved > charged) changeBalance(req.auth.sub, reserved - charged, 'ai_refund', generation.id, 'AI 预占差额退回')
      db.prepare('UPDATE generations SET status=?,charged=?,response=? WHERE id=?')
        .run('succeeded', charged, JSON.stringify(response), generation.id)
    })
    res.json(response)
  } catch (error) {
    if (generation) {
      try {
        transaction(() => {
          const row = db.prepare('SELECT status FROM generations WHERE id=?').get(generation.id)
          if (row?.status === 'pending') {
            changeBalance(generation.userId, generation.reserved, 'ai_refund', generation.id, 'AI 调用失败退回')
            db.prepare('UPDATE generations SET status=? WHERE id=?').run('failed', generation.id)
          }
        })
      } catch {}
    }
    next(error)
  }
})

app.get('/api/admin/overview', auth, admin, (_req, res) => {
  const stats = {
    users: Number(db.prepare('SELECT COUNT(*) n FROM users').get().n),
    canvases: Number(db.prepare('SELECT COUNT(*) n FROM canvases').get().n),
    points: Number(db.prepare('SELECT COALESCE(SUM(balance),0) n FROM users').get().n),
    pendingTopups: Number(db.prepare("SELECT COUNT(*) n FROM topup_orders WHERE status='pending'").get().n),
  }
  const orders = db.prepare('SELECT o.*,u.email FROM topup_orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100').all()
  res.json({
    stats,
    orders,
    ai: {
      configured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY),
      baseUrl: process.env.AI_BASE_URL || '',
      models: allowedModels,
      inputRate,
      outputRate,
    },
  })
})
app.post('/api/admin/codes', auth, admin, (req, res, next) => {
  try {
    const body = parse(z.object({
      points: z.number().int().min(1).max(10000000),
      count: z.number().int().min(1).max(100),
      maxUses: z.number().int().min(1).max(10000).default(1),
      label: z.string().trim().max(100).optional(),
      expiresAt: z.string().datetime().optional(),
    }), req.body)
    const codes = transaction(() => Array.from({ length: body.count }, () => {
      const code = `INK-${randomBytes(6).toString('hex').toUpperCase()}`
      db.prepare('INSERT INTO redeem_codes (id,code_hash,label,points,max_uses,expires_at,created_by) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), hashCode(code), body.label || null, body.points, body.maxUses, body.expiresAt || null, req.auth.sub)
      return code
    }))
    res.status(201).json({ codes })
  } catch (error) { next(error) }
})
app.post('/api/admin/topups/:id/approve', auth, admin, (req, res, next) => {
  try {
    const order = transaction(() => {
      const item = db.prepare('SELECT * FROM topup_orders WHERE id=?').get(req.params.id)
      if (!item) throw fail(404, '订单不存在')
      if (item.status !== 'pending') throw fail(409, '订单已处理')
      db.prepare("UPDATE topup_orders SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(req.auth.sub, item.id)
      changeBalance(item.user_id, Number(item.points), 'topup', item.id, '充值到账')
      return { ...item, status: 'approved' }
    })
    res.json({ order })
  } catch (error) { next(error) }
})
app.post('/api/admin/topups/:id/reject', auth, admin, (req, res, next) => {
  const result = db.prepare("UPDATE topup_orders SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'")
    .run(req.auth.sub, req.params.id)
  if (!result.changes) return next(fail(409, '订单不存在或已处理'))
  res.json({ ok: true })
})

const dist = resolve('dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/.*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500
  if (status >= 500 && !error.status) console.error(error)
  res.status(status).json({ error: status >= 500 && !error.status ? '服务器内部错误' : error.message })
})

export default app
