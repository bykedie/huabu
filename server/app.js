import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync } from 'node:fs'
import { BlockList, isIP } from 'node:net'
import { resolve } from 'node:path'
import { z } from 'zod'
import { db, transaction, changeBalance, checkDatabase, recoverPendingGenerations } from './db.js'

const app = express()
const isProduction = process.env.NODE_ENV === 'production'
const numberSetting = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) => {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} 配置无效`)
  }
  return value
}
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'development-only-change-me')
if (isProduction && (Buffer.byteLength(jwtSecret) < 32 || /replace|change-me/i.test(jwtSecret))) {
  throw new Error('生产环境 JWT_SECRET 必须是至少 32 字节的随机值')
}
const adminSetupToken = process.env.ADMIN_SETUP_TOKEN || ''
const hasExistingAdmin = Number(db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get().count) > 0
if (isProduction && !hasExistingAdmin && (Buffer.byteLength(adminSetupToken) < 32 || /replace|change-me/i.test(adminSetupToken))) {
  throw new Error('生产环境 ADMIN_SETUP_TOKEN 必须是至少 32 字节的随机值')
}
const welcomePoints = numberSetting('WELCOME_POINTS', isProduction ? 0 : 100, { min: 0, max: 10000000, integer: true })
const inputRate = numberSetting('AI_INPUT_POINTS_PER_1K', 1, { max: 1000000 })
const outputRate = numberSetting('AI_OUTPUT_POINTS_PER_1K', 4, { max: 1000000 })
const defaultVideoPoints = numberSetting('AI_VIDEO_POINTS', 24, { min: 1, max: 1000000, integer: true })
const aiTimeout = numberSetting('AI_TIMEOUT_MS', 120000, { min: 1000, max: 120000, integer: true })
const videoTimeout = numberSetting('AI_VIDEO_TIMEOUT_MS', 600000, { min: 30000, max: 1800000, integer: true })
const videoPollMs = numberSetting('AI_VIDEO_POLL_MS', isProduction ? 2500 : 250, { min: 10, max: 30000, integer: true })
export const aiPendingRecoveryMs = numberSetting('AI_PENDING_RECOVERY_MS', aiTimeout + 60000, { min: aiTimeout + 10000, max: 3600000, integer: true })
export const videoPendingRecoveryMs = numberSetting('AI_VIDEO_PENDING_RECOVERY_MS', videoTimeout + 60000, { min: videoTimeout + 10000, max: 3600000, integer: true })
const aiMaxResponseBytes = numberSetting('AI_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, { min: 1024, max: 20 * 1024 * 1024, integer: true })
const aiImageMaxResponseBytes = numberSetting('AI_IMAGE_MAX_RESPONSE_BYTES', 12 * 1024 * 1024, { min: 1024, max: 50 * 1024 * 1024, integer: true })
const aiVideoMaxResponseBytes = numberSetting('AI_VIDEO_MAX_RESPONSE_BYTES', 64 * 1024 * 1024, { min: 1024, max: 256 * 1024 * 1024, integer: true })
const centsPerPoint = numberSetting('CENTS_PER_POINT', 1, { min: 1, max: 10000000, integer: true })
const maxCanvasesPerUser = numberSetting('MAX_CANVASES_PER_USER', 100, { min: 1, max: 10000, integer: true })
const maxAssetsPerUser = numberSetting('MAX_ASSETS_PER_USER', 200, { min: 1, max: 10000, integer: true })
const maxUserMediaBytes = numberSetting('MAX_USER_MEDIA_BYTES', 512 * 1024 * 1024, { min: aiVideoMaxResponseBytes, max: 10 * 1024 * 1024 * 1024, integer: true })
const maxCanvasBytes = numberSetting('MAX_CANVAS_BYTES', 2 * 1024 * 1024, { min: 1024, max: 10 * 1024 * 1024, integer: true })
const maxUserStorageBytes = numberSetting('MAX_USER_STORAGE_BYTES', 20 * 1024 * 1024, { min: maxCanvasBytes, max: 1024 * 1024 * 1024, integer: true })
const registrationRateLimit = numberSetting('REGISTRATION_RATE_LIMIT', 5, { min: 1, max: 1000, integer: true })
const topupInstructions = (process.env.TOPUP_INSTRUCTIONS || '').trim().slice(0, 1000)
const envModels = (process.env.AI_MODELS || 'gpt-4o-mini').split(',').map((item) => item.trim()).filter(Boolean)
if (!envModels.length) throw new Error('AI_MODELS 至少需要一个模型')
const imageModels = (process.env.AI_IMAGE_MODELS || 'GPT-image-2').split(',').map((item) => item.trim()).filter(Boolean)
if (!imageModels.length) throw new Error('AI_IMAGE_MODELS 至少需要一个模型')
recoverPendingGenerations(aiPendingRecoveryMs, videoPendingRecoveryMs)
// Trust only the local reverse proxy. Public clients cannot opt into forwarded
// headers, while domain and dual-access modes still retain the real client IP.
const loopbackProxyAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
app.set('trust proxy', (address) => loopbackProxyAddresses.has(address))
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      upgradeInsecureRequests: null,
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
app.use('/api/auth/register', limiter(registrationRateLimit))
app.use('/api/redeem', limiter(20))
app.use('/api/ai', limiter(40))
app.use('/api', express.json({ limit: '12mb' }))

const fail = (status, message) => Object.assign(new Error(message), { status })
const normalizeRelayBaseUrl = (value, label, status = 500) => {
  const input = String(value || '').trim().replace(/\/+$/, '')
  if (!input) return ''
  let url
  try { url = new URL(input) } catch { throw fail(status, label + '地址无效') }
  if (!(isProduction ? ['https:'] : ['https:', 'http:']).includes(url.protocol)) {
    throw fail(status, label + '地址必须使用 HTTPS')
  }
  if (url.username || url.password) throw fail(status, label + '地址不能包含用户名或密码')
  if (url.search || url.hash) throw fail(status, label + '地址不能包含查询参数或片段')
  return url.toString().replace(/\/+$/, '')
}
const imageRelayBaseUrl = normalizeRelayBaseUrl(process.env.AI_IMAGE_BASE_URL || 'https://www.bkbk.baby/v1', '图片中转站')
const imageRelayEndpoint = imageRelayBaseUrl + '/'
const settingsKey = createHash('sha256').update(`ai-settings:${jwtSecret}`).digest()
const adminLoginKey = createHash('sha256').update(`admin-login:${jwtSecret}`).digest()
const encryptSetting = (value) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', settingsKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.')
}
const decryptSetting = (value) => {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', settingsKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
const encryptAdminPassword = (value) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', adminLoginKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.')
}
const relaySettings = (kind = 'text') => {
  const row = db.prepare('SELECT * FROM app_settings WHERE id=1').get()
  const video = kind === 'video'
  const encrypted = video ? row?.ai_video_api_key_encrypted : row?.ai_api_key_encrypted
  const keyManaged = Number(video ? row?.ai_video_api_key_managed : row?.ai_api_key_managed) === 1
  const storedBaseUrl = video ? row?.ai_video_base_url : row?.ai_base_url
  const storedModels = video ? row?.ai_video_models : row?.ai_models
  const databaseConfigured = keyManaged || [storedBaseUrl, encrypted, storedModels].some((value) => value !== null && value !== undefined)
  let storedKey = ''
  if (encrypted) { try { storedKey = decryptSetting(encrypted) } catch { throw fail(500, '已保存的中转站密钥无法解密，请管理员重新设置') } }
  const rawBaseUrl = databaseConfigured
    ? (storedBaseUrl || '')
    : (video ? process.env.AI_VIDEO_BASE_URL : process.env.AI_BASE_URL) || ''
  const baseUrl = normalizeRelayBaseUrl(rawBaseUrl, video ? '视频中转站' : '中转站')
  const envKey = ((video ? process.env.AI_VIDEO_API_KEY : process.env.AI_API_KEY) || '').trim()
  const models = databaseConfigured
    ? (storedModels ? JSON.parse(storedModels) : [])
    : (video ? (process.env.AI_VIDEO_MODELS || '').split(',').map((item) => item.trim()).filter(Boolean) : envModels)
  return { baseUrl, apiKey: keyManaged ? storedKey : (storedKey || envKey || ''), models, source: databaseConfigured ? 'database' : 'environment' }
}
const videoPointCost = () => {
  const value = Number(db.prepare('SELECT ai_video_points FROM app_settings WHERE id=1').get()?.ai_video_points)
  return Number.isInteger(value) && value >= 1 && value <= 1000000 ? value : defaultVideoPoints
}
const hashCode = (code) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  balance: Number(row.balance),
  imageApiKeyConfigured: Boolean(row.image_api_key_encrypted),
})
const userImageApiKey = (userId) => {
  const encrypted = db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(userId)?.image_api_key_encrypted
  if (!encrypted) return ''
  try { return decryptSetting(encrypted) }
  catch { throw fail(500, '已保存的生图 API 密钥无法解密，请重新设置') }
}
const sign = (user) => jwt.sign(
  { sub: user.id, role: user.role, sv: Number(user.session_version) || 0 },
  jwtSecret,
  { algorithm: 'HS256', expiresIn: '7d' },
)
const validSetupToken = (value) => {
  if (!adminSetupToken || typeof value !== 'string') return false
  const actual = Buffer.from(value)
  const expected = Buffer.from(adminSetupToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
const passwordSchema = z.string()
  .min(8, '密码至少 8 位')
  .max(72)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, '密码 UTF-8 编码后不能超过 72 字节')
const dummyPasswordHash = '$2b$12$lzzqDX9QaibgIjulC5Z90OuTZYz27up7324qLJZsPAUw8/0xm1xC2'
const loginError = () => fail(401, '邮箱或密码错误')
const auditAdmin = (actorId, action, targetId, details) => {
  db.prepare('INSERT INTO admin_audit (id,actor_id,action,target_id,details) VALUES (?,?,?,?,?)')
    .run(randomUUID(), actorId, action, targetId || null, JSON.stringify(details))
}
export const estimatePromptTokens = (messages) => messages.reduce(
  (total, message) => total + Buffer.byteLength(message.content, 'utf8') + 16,
  16,
)
const estimateTextTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4)

async function readUpstreamText(response, maxBytes = aiMaxResponseBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel()
    throw fail(502, '中转站返回内容过大')
  }
  if (!response.body) throw fail(502, '中转站返回了空响应')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw fail(502, '中转站返回内容过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

async function readUpstreamJson(response) {
  const text = await readUpstreamText(response)
  try { return JSON.parse(text) }
  catch { throw fail(502, '中转站返回了无效 JSON') }
}
const imageUpstreamFailure = (status) => {
  if (status === 401 || status === 403) return fail(400, 'API 密钥无效、已过期或没有生图权限')
  if (status === 402) return fail(402, '中转账户余额不足，请先在中转站充值')
  if (status === 429) return fail(429, '中转站请求过于频繁或额度已用完')
  if (status === 404) return fail(502, '中转站未开放所选生图模型或接口')
  return fail(502, `生图中转站返回 ${status}`)
}

async function readUpstreamBuffer(response, maxBytes = aiVideoMaxResponseBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel()
    throw fail(502, '视频中转站返回内容过大')
  }
  if (!response.body) throw fail(502, '视频中转站返回了空响应')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw fail(502, '视频中转站返回内容过大')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, total)
}

const mediaSignature = (id, userId) => createHmac('sha256', settingsKey).update('media:' + id + ':' + userId).digest('base64url')
const mediaUrl = (id, userId) => '/api/media/' + id + '?token=' + encodeURIComponent(mediaSignature(id, userId))
const secureTextEqual = (actual, expected) => {
  if (typeof actual !== 'string') return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
const upstreamErrorDetail = (payload, status) => {
  const value = payload?.error?.message || payload?.error || payload?.message || payload?.msg
  return typeof value === 'string' && value ? value.slice(0, 240) : 'HTTP ' + status
}
const unwrapVideoPayload = (payload) => {
  if (!payload || typeof payload !== 'object') throw fail(502, '视频中转站没有返回任务')
  if ('code' in payload && payload.code !== undefined) {
    if (payload.code !== 0 && payload.code !== '0') throw fail(502, upstreamErrorDetail(payload, 502))
    if (!payload.data || typeof payload.data !== 'object') throw fail(502, '视频中转站没有返回任务')
    return payload.data
  }
  return payload
}
const videoTaskId = (payload) => [payload.id, payload.task_id, payload.taskId].find((value) => typeof value === 'string' && value)
const videoResultUrl = (payload) => [
  payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url,
  payload.result?.video_url, payload.result?.url, payload.output?.video_url, payload.output?.url,
  payload.data?.[0]?.video_url, payload.data?.[0]?.url,
].find((value) => typeof value === 'string' && value)
const videoTaskStatus = (payload) => String(payload.status || payload.state || '').toLowerCase()
const videoTaskError = (payload) => upstreamErrorDetail(payload, 502)
const allowedRelayUrl = (value, label) => {
  let url
  try { url = new URL(value) } catch { throw fail(502, label + '地址无效') }
  if (!(isProduction ? ['https:'] : ['https:', 'http:']).includes(url.protocol)) throw fail(502, label + '地址必须使用 HTTPS')
  if (url.username || url.password) throw fail(502, label + '地址不能包含用户名或密码')
  return url
}
const videoLoopbackAddresses = new BlockList()
videoLoopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
videoLoopbackAddresses.addAddress('::1', 'ipv6')
videoLoopbackAddresses.addSubnet('::ffff:127.0.0.0', 104, 'ipv6')
const videoGlobalIpv6Addresses = new BlockList()
videoGlobalIpv6Addresses.addSubnet('2000::', 3, 'ipv6')
const videoUnsafeAddresses = new BlockList()
for (const [network, prefix, type] of [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'], ['192.31.196.0', 24, 'ipv4'], ['192.52.193.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['192.175.48.0', 24, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  ['::', 96, 'ipv6'], ['::ffff:0:0', 96, 'ipv6'], ['64:ff9b::', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'], ['100::', 64, 'ipv6'], ['2001::', 23, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'], ['2002::', 16, 'ipv6'], ['3fff::', 20, 'ipv6'],
  ['5f00::', 16, 'ipv6'], ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'], ['ff00::', 8, 'ipv6'],
]) videoUnsafeAddresses.addSubnet(network, prefix, type)
const videoMediaOrigins = () => {
  const raw = process.env.AI_VIDEO_MEDIA_ORIGINS || ''
  if (!raw.trim()) return new Set()
  const origins = new Set()
  for (const item of raw.split(',')) {
    const value = item.trim()
    let url
    try { url = value ? new URL(value) : null } catch { url = null }
    if (!url || url.origin === 'null' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !(isProduction ? ['https:'] : ['https:', 'http:']).includes(url.protocol)) {
      throw fail(500, 'AI_VIDEO_MEDIA_ORIGINS 配置无效')
    }
    origins.add(url.origin)
  }
  return origins
}
const validateVideoDownloadUrl = async (value, allowedOrigins) => {
  const url = allowedRelayUrl(value, '视频')
  if (url.username || url.password || !allowedOrigins.has(url.origin)) throw fail(502, '视频地址来源未获允许')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses
  try { addresses = await lookup(hostname, { all: true, verbatim: true }) }
  catch { throw fail(502, '视频地址无法解析') }
  if (!addresses.length) throw fail(502, '视频地址无法解析')
  for (const item of addresses) {
    const address = String(item.address || '').split('%')[0]
    const family = isIP(address)
    const type = family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : null
    if (!type) throw fail(502, '视频地址解析结果无效')
    const loopback = videoLoopbackAddresses.check(address, type)
    const unsafe = videoUnsafeAddresses.check(address, type)
      || (type === 'ipv6' && !videoGlobalIpv6Addresses.check(address, type))
    if ((loopback && isProduction) || (!loopback && unsafe)) {
      throw fail(502, '视频地址解析到不安全的网络地址')
    }
  }
  return url
}
const validateImageRelayUrl = async (value) => {
  const url = allowedRelayUrl(value, '图片中转站')
  if (url.username || url.password) throw fail(502, '图片中转站地址不能包含用户名或密码')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const checkAddress = (address, family) => {
    const type = family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : null
    if (!type) throw fail(502, '图片中转站地址解析结果无效')
    const loopback = videoLoopbackAddresses.check(address, type)
    const unsafe = videoUnsafeAddresses.check(address, type)
      || (type === 'ipv6' && !videoGlobalIpv6Addresses.check(address, type))
    if ((loopback && isProduction) || (!loopback && unsafe)) throw fail(502, '图片中转站解析到不安全的网络地址')
  }
  if (literalFamily) checkAddress(hostname, literalFamily)
  else if (isProduction) {
    let addresses
    try { addresses = await lookup(hostname, { all: true, verbatim: true }) }
    catch { throw fail(502, '图片中转站地址无法解析') }
    if (!addresses.length) throw fail(502, '图片中转站地址无法解析')
    for (const item of addresses) checkAddress(String(item.address || '').split('%')[0], isIP(String(item.address || '').split('%')[0]))
  }
  return url
}
async function fetchVideoBytes(value, relay) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(videoTimeout, 120000))
  try {
    const relayOrigin = allowedRelayUrl(relay.baseUrl, '视频中转站').origin
    const allowedOrigins = videoMediaOrigins()
    allowedOrigins.add(relayOrigin)
    let url = new URL(value)
    let response
    for (let redirects = 0; ; redirects += 1) {
      url = await validateVideoDownloadUrl(url, allowedOrigins)
      controller.signal.throwIfAborted()
      response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: url.origin === relayOrigin ? { authorization: 'Bearer ' + relay.apiKey } : undefined,
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      if (redirects >= 5) {
        await response.body?.cancel().catch(() => {})
        throw fail(502, '视频下载重定向过多')
      }
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => {})
      if (!location) throw fail(502, '视频下载重定向地址无效')
      try { url = new URL(location, url) }
      catch { throw fail(502, '视频下载重定向地址无效') }
    }
    if (!response.ok) {
      const text = await readUpstreamText(response).catch((error) => {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
        return ''
      })
      let payload
      try { payload = JSON.parse(text) } catch { payload = null }
      throw fail(502, '视频下载失败：' + upstreamErrorDetail(payload, response.status))
    }
    const mimeType = (response.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase()
    if (!mimeType.startsWith('video/') && mimeType !== 'application/octet-stream') {
      await response.body?.cancel().catch(() => {})
      throw fail(502, '视频中转站返回的内容不是视频')
    }
    return { bytes: await readUpstreamBuffer(response), mimeType: mimeType === 'application/octet-stream' ? 'video/mp4' : mimeType }
  } catch (error) {
    if (error?.status) throw error
    const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError' || controller.signal.aborted
    throw fail(timeout ? 504 : 502, timeout ? '视频下载超时' : '无法下载生成的视频')
  } finally {
    clearTimeout(timer)
  }
}
function storeVideoMedia(userId, generationId, media) {
  const id = randomUUID()
  const extension = media.mimeType.includes('webm') ? 'webm' : media.mimeType.includes('quicktime') ? 'mov' : 'mp4'
  const fileName = id + '.' + extension
  let response
  transaction(() => {
    const generation = db.prepare('SELECT reserved FROM generations WHERE id=? AND user_id=?').get(generationId, userId)
    if (!generation) throw fail(404, '视频任务不存在')
    const charged = Number(generation.reserved)
    const used = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM media WHERE user_id=?').get(userId).bytes)
    if (used + media.bytes.length > maxUserMediaBytes) throw fail(413, '账户视频存储已达上限（' + Math.floor(maxUserMediaBytes / 1024 / 1024) + ' MiB）')
    db.prepare('INSERT INTO media (id,user_id,kind,file_name,mime_type,bytes,data) VALUES (?,?,?,?,?,?,?)')
      .run(id, userId, 'video', fileName, media.mimeType, media.bytes.length, media.bytes)
    response = { id: generationId, status: 'completed', videoUrl: mediaUrl(id, userId), mimeType: media.mimeType, charged, cached: false }
    const updated = db.prepare("UPDATE generations SET status='succeeded',charged=?,response=? WHERE id=? AND user_id=? AND status='pending'")
      .run(charged, JSON.stringify(response), generationId, userId)
    if (!updated.changes) throw fail(409, '该请求已由恢复流程终止，积分已退回')
  })
  return response
}
function storeUploadedVideo(userId, media) {
  const id = randomUUID()
  const extension = media.mimeType.includes('webm') ? 'webm' : media.mimeType.includes('quicktime') ? 'mov' : 'mp4'
  const fileName = id + '.' + extension
  transaction(() => {
    const used = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM media WHERE user_id=?').get(userId).bytes)
    if (used + media.bytes.length > maxUserMediaBytes) throw fail(413, '账户视频存储已达上限（' + Math.floor(maxUserMediaBytes / 1024 / 1024) + ' MiB）')
    db.prepare('INSERT INTO media (id,user_id,kind,file_name,mime_type,bytes,data) VALUES (?,?,?,?,?,?,?)')
      .run(id, userId, 'video', fileName, media.mimeType, media.bytes.length, media.bytes)
  })
  return { id, videoUrl: mediaUrl(id, userId), mimeType: media.mimeType, bytes: media.bytes.length }
}
function normalizedVideoUpload(buffer, mimeType) {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(normalized)) throw fail(400, '仅支持 MP4、WebM 或 MOV 视频')
  const mp4Like = buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  const webm = buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  if ((normalized === 'video/webm' && !webm) || (normalized !== 'video/webm' && !mp4Like)) throw fail(400, '视频文件格式与内容不匹配')
  return { bytes: buffer, mimeType: normalized }
}
function failVideoGeneration(row, kind = 'ai_video_refund') {
  transaction(() => {
    const current = db.prepare('SELECT status FROM generations WHERE id=?').get(row.id)
    if (current?.status !== 'pending') return
    changeBalance(row.user_id, Number(row.reserved), kind, row.id, '视频生成失败退回')
    db.prepare("UPDATE generations SET status='failed' WHERE id=? AND status='pending'").run(row.id)
  })
}

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw fail(400, result.error.issues[0]?.message || '参数错误')
  return result.data
}
function auth(req, _res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    if (!token) throw fail(401, '请先登录')
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })
    const user = db.prepare('SELECT id,role,session_version FROM users WHERE id=?').get(payload.sub)
    if (!user || Number(payload.sv ?? 0) !== Number(user.session_version)) throw fail(401, '登录已失效')
    req.auth = { ...payload, sub: user.id, role: user.role }
    next()
  } catch { next(fail(401, '登录已失效')) }
}
function admin(req, _res, next) {
  if (req.auth?.role !== 'admin') return next(fail(403, '需要管理员权限'))
  next()
}

app.get('/api/health', (_req, res) => {
  try {
    checkDatabase()
    res.json({ ok: true })
  } catch (error) {
    console.error('Health check failed', error)
    res.status(503).json({ ok: false })
  }
})
app.get('/api/config', auth, (req, res) => {
  const textRelay = relaySettings()
  const videoRelay = relaySettings('video')
  const imageApiKeyConfigured = Boolean(db.prepare('SELECT image_api_key_encrypted FROM users WHERE id=?').get(req.auth.sub)?.image_api_key_encrypted)
  res.json({
    aiModel: textRelay.models[0],
    textModels: textRelay.models,
    imageModels,
    imageEndpoint: imageRelayEndpoint,
    imageConfigured: imageApiKeyConfigured,
    videoModels: videoRelay.models,
    videoPoints: videoPointCost(),
    centsPerPoint,
    topupInstructions,
  })
})
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const body = parse(z.object({
      name: z.string().trim().min(2, '昵称至少 2 个字').max(30),
      email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
      password: passwordSchema,
      setupToken: z.string().max(256).optional(),
    }), req.body)
    const id = randomUUID()
    const passwordHash = await bcrypt.hash(body.password, 12)
    let role
    transaction(() => {
      const hasAdmin = Number(db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get().count) > 0
      role = !hasAdmin && (validSetupToken(body.setupToken) || (!adminSetupToken && !isProduction)) ? 'admin' : 'user'
      db.prepare('INSERT INTO users (id,email,password_hash,admin_password_encrypted,name,role,balance) VALUES (?,?,?,?,?,?,0)')
        .run(id, body.email, passwordHash, role === 'admin' ? encryptAdminPassword(body.password) : null, body.name, role)
      if (welcomePoints > 0) changeBalance(id, welcomePoints, 'welcome', id, '新用户赠送')
    })
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    res.status(201).json({ token: sign(user), user: publicUser(user) })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return next(fail(409, '该邮箱已注册'))
    next(error)
  }
})
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: passwordSchema }), req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    const passwordMatches = await bcrypt.compare(body.password, user?.password_hash || dummyPasswordHash)
    if (!user) throw loginError()
    const authenticated = transaction(() => {
      const current = db.prepare(`
        SELECT *, login_locked_until > CURRENT_TIMESTAMP AS login_locked,
          login_failure_started_at > datetime('now','-15 minutes') AS failure_window_active
        FROM users WHERE id=?
      `).get(user.id)
      if (current.login_locked) return null
      if (passwordMatches) {
        db.prepare('UPDATE users SET login_failures=0,login_failure_started_at=NULL,login_locked_until=NULL WHERE id=?').run(user.id)
        return current
      }
      const failures = current.failure_window_active ? Number(current.login_failures) + 1 : 1
      if (failures >= 5) {
        db.prepare("UPDATE users SET login_failures=?,login_failure_started_at=COALESCE(login_failure_started_at,CURRENT_TIMESTAMP),login_locked_until=datetime('now','+15 minutes') WHERE id=?")
          .run(failures, user.id)
      } else if (current.failure_window_active) {
        db.prepare('UPDATE users SET login_failures=? WHERE id=?').run(failures, user.id)
      } else {
        db.prepare('UPDATE users SET login_failures=1,login_failure_started_at=CURRENT_TIMESTAMP,login_locked_until=NULL WHERE id=?').run(user.id)
      }
      return null
    })
    if (!authenticated) throw loginError()
    res.json({ token: sign(authenticated), user: publicUser(authenticated) })
  } catch (error) { next(error) }
})
app.post('/api/auth/password', auth, async (req, res, next) => {
  try {
    const body = parse(z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }), req.body)
    if (body.currentPassword === body.newPassword) throw fail(400, '新密码不能与当前密码相同')
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub)
    if (!(await bcrypt.compare(body.currentPassword, user.password_hash))) throw fail(400, '当前密码错误')
    const passwordHash = await bcrypt.hash(body.newPassword, 12)
    const adminPasswordEncrypted = user.role === 'admin' ? encryptAdminPassword(body.newPassword) : null
    const updated = transaction(() => {
      const result = db.prepare(`
        UPDATE users SET password_hash=?,admin_password_encrypted=?,session_version=session_version+1,
          login_failures=0,login_failure_started_at=NULL,login_locked_until=NULL
        WHERE id=? AND password_hash=?
      `).run(passwordHash, adminPasswordEncrypted, user.id, user.password_hash)
      if (!result.changes) throw fail(409, '密码已在其他设备修改，请重新登录')
      return db.prepare('SELECT * FROM users WHERE id=?').get(user.id)
    })
    res.json({ token: sign(updated), user: publicUser(updated) })
  } catch (error) { next(error) }
})
app.get('/api/me', auth, (req, res, next) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)
  if (!user) return next(fail(401, '用户不存在'))
  res.json({ user: publicUser(user) })
})
app.put('/api/me/image-key', auth, (req, res, next) => {
  try {
    const { apiKey } = parse(z.object({ apiKey: z.string().trim().min(1).max(4000) }), req.body)
    db.prepare('UPDATE users SET image_api_key_encrypted=? WHERE id=?').run(encryptSetting(apiKey), req.auth.sub)
    res.json({ configured: true, endpoint: imageRelayEndpoint, models: imageModels })
  } catch (error) { next(error) }
})
app.delete('/api/me/image-key', auth, (req, res) => {
  db.prepare('UPDATE users SET image_api_key_encrypted=NULL WHERE id=?').run(req.auth.sub)
  res.json({ configured: false, endpoint: imageRelayEndpoint, models: imageModels })
})
app.post('/api/me/image-key/test', auth, async (req, res, next) => {
  try {
    const body = parse(z.object({
      apiKey: z.string().trim().min(1).max(4000).optional(),
      model: z.string().trim().min(1).max(100).optional(),
    }), req.body)
    const apiKey = body.apiKey || userImageApiKey(req.auth.sub)
    if (!apiKey) throw fail(400, '请先填写或保存生图 API 密钥')
    const model = body.model || imageModels[0]
    if (!imageModels.includes(model)) throw fail(400, '该生图模型未开放')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(aiTimeout, 60000))
    let upstream
    try {
      const url = await validateImageRelayUrl(imageRelayBaseUrl + '/images/generations')
      upstream = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'A small solid white square on a black background.', size: '1024x1024', n: 1 }),
      })
    } catch (error) {
      throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '生图中转测试超时' : '无法连接生图中转站')
    } finally { clearTimeout(timer) }
    const text = await readUpstreamText(upstream, upstream.ok ? aiImageMaxResponseBytes : aiMaxResponseBytes)
    let payload
    try { payload = JSON.parse(text) } catch { payload = null }
    if (!upstream.ok) throw imageUpstreamFailure(upstream.status)
    const image = payload?.data?.[0]
    const imageUrl = image?.url || image?.image_url || payload?.url || payload?.result?.url || ''
    const base64 = image?.b64_json || image?.base64 || payload?.result?.b64_json || ''
    if ((!imageUrl && !base64) || [imageUrl, base64].some((value) => typeof value !== 'string' || value.includes(apiKey))) {
      throw fail(502, '生图中转站未返回图片')
    }
    res.json({ ok: true, status: upstream.status, model })
  } catch (error) { next(error) }
})
app.get('/api/canvases', auth, (req, res) => {
  const rows = db.prepare('SELECT id,name,version,created_at,updated_at FROM canvases WHERE user_id = ? ORDER BY updated_at DESC').all(req.auth.sub)
  res.json({ canvases: rows })
})
app.post('/api/canvases', auth, (req, res, next) => {
  try {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80).default('未命名画布') }), req.body)
    const canvas = { id: randomUUID(), name }
    transaction(() => {
      const count = Number(db.prepare('SELECT COUNT(*) count FROM canvases WHERE user_id=?').get(req.auth.sub).count)
      if (count >= maxCanvasesPerUser) throw fail(413, `画布数量已达上限（${maxCanvasesPerUser} 张）`)
      db.prepare('INSERT INTO canvases (id,user_id,name) VALUES (?,?,?)').run(canvas.id, req.auth.sub, name)
    })
    res.status(201).json({ canvas: { ...canvas, version: 0, document: { nodes: [], edges: [], assistantMessages: [] } } })
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
      version: z.number().int().min(0),
      document: z.object({
        nodes: z.array(z.unknown()).max(1000),
        edges: z.array(z.unknown()).max(2000),
        assistantMessages: z.array(z.object({
          id: z.string().min(1).max(200),
          role: z.enum(['user', 'assistant']),
          content: z.string().max(20000),
          createdAt: z.number().finite(),
        })).max(50).default([]),
      }),
    }), req.body)
    const document = JSON.stringify(body.document)
    const documentBytes = Buffer.byteLength(document)
    if (documentBytes > maxCanvasBytes) throw fail(413, `单张画布不能超过 ${Math.floor(maxCanvasBytes / 1024)} KiB`)
    transaction(() => {
      const existing = db.prepare('SELECT version FROM canvases WHERE id=? AND user_id=?').get(req.params.id, req.auth.sub)
      if (!existing) throw fail(404, '画布不存在')
      if (Number(existing.version) !== body.version) throw fail(409, '画布已在其他页面更新，本地草稿已保留')
      const canvasBytes = Number(db.prepare('SELECT COALESCE(SUM(length(CAST(document AS BLOB))),0) bytes FROM canvases WHERE user_id=? AND id<>?').get(req.auth.sub, req.params.id).bytes)
      const assetBytes = Number(db.prepare('SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) bytes FROM assets WHERE user_id=?').get(req.auth.sub).bytes)
      const usedBytes = canvasBytes + assetBytes
      if (usedBytes + documentBytes > maxUserStorageBytes) throw fail(413, `账户画布存储已达上限（${Math.floor(maxUserStorageBytes / 1024 / 1024)} MiB）`)
      db.prepare('UPDATE canvases SET name=?,document=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=?')
        .run(body.name, document, req.params.id, req.auth.sub, body.version)
    })
    res.json({ ok: true, version: body.version + 1 })
  } catch (error) { next(error) }
})
app.delete('/api/canvases/:id', auth, (req, res, next) => {
  const result = db.prepare('DELETE FROM canvases WHERE id=? AND user_id=?').run(req.params.id, req.auth.sub)
  if (!result.changes) return next(fail(404, '画布不存在'))
  res.status(204).end()
})

app.get('/api/assets', auth, (req, res) => {
  const assets = db.prepare('SELECT id,kind,title,content,source_canvas_id,source_node_id,created_at,updated_at FROM assets WHERE user_id=? ORDER BY updated_at DESC').all(req.auth.sub)
  res.json({ assets })
})
app.post('/api/assets', auth, (req, res, next) => {
  try {
    const body = parse(z.object({
      kind: z.enum(['image', 'video', 'text']),
      title: z.string().trim().min(1).max(120),
      content: z.string().min(1).max(10 * 1024 * 1024),
      sourceCanvasId: z.string().max(200).optional(),
      sourceNodeId: z.string().max(200).optional(),
    }), req.body)
    if (body.kind === 'image' && !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(body.content) && !/^https?:\/\//i.test(body.content)) throw fail(400, '图片资产格式无效')
    if (body.kind === 'video' && !/^\/api\/media\/[a-f0-9-]+\?token=[a-z0-9_-]+$/i.test(body.content) && !/^https?:\/\//i.test(body.content)) throw fail(400, '视频资产格式无效')
    const contentBytes = Buffer.byteLength(body.content)
    if (contentBytes > maxCanvasBytes) throw fail(413, `单个资产不能超过 ${Math.floor(maxCanvasBytes / 1024)} KiB`)
    const asset = { id: randomUUID(), ...body }
    transaction(() => {
      const count = Number(db.prepare('SELECT COUNT(*) count FROM assets WHERE user_id=?').get(req.auth.sub).count)
      if (count >= maxAssetsPerUser) throw fail(413, `资产数量已达上限（${maxAssetsPerUser} 个）`)
      const canvasBytes = Number(db.prepare('SELECT COALESCE(SUM(length(CAST(document AS BLOB))),0) bytes FROM canvases WHERE user_id=?').get(req.auth.sub).bytes)
      const assetBytes = Number(db.prepare('SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) bytes FROM assets WHERE user_id=?').get(req.auth.sub).bytes)
      if (canvasBytes + assetBytes + contentBytes > maxUserStorageBytes) throw fail(413, `账户存储已达上限（${Math.floor(maxUserStorageBytes / 1024 / 1024)} MiB）`)
      db.prepare('INSERT INTO assets (id,user_id,kind,title,content,source_canvas_id,source_node_id) VALUES (?,?,?,?,?,?,?)')
        .run(asset.id, req.auth.sub, body.kind, body.title, body.content, body.sourceCanvasId || null, body.sourceNodeId || null)
    })
    res.status(201).json({ asset: { id: asset.id, kind: body.kind, title: body.title, content: body.content, source_canvas_id: body.sourceCanvasId || null, source_node_id: body.sourceNodeId || null } })
  } catch (error) { next(error) }
})
app.delete('/api/assets/:id', auth, (req, res, next) => {
  const result = db.prepare('DELETE FROM assets WHERE id=? AND user_id=?').run(req.params.id, req.auth.sub)
  if (!result.changes) return next(fail(404, '资产不存在'))
  res.status(204).end()
})

app.get('/api/media/:id', (req, res, next) => {
  try {
    const row = db.prepare('SELECT id,user_id,mime_type,bytes,data FROM media WHERE id=?').get(req.params.id)
    if (!row || !secureTextEqual(req.query.token, mediaSignature(row.id, row.user_id))) throw fail(404, '媒体不存在')
    const data = Buffer.from(row.data || [])
    if (!data.length || data.length !== Number(row.bytes)) throw fail(500, '媒体文件已损坏')
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', row.mime_type)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    if (!range) {
      res.setHeader('Content-Length', data.length)
      return res.end(data)
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2] || 0))
    const end = range[1] ? (range[2] ? Number(range[2]) : data.length - 1) : data.length - 1
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= data.length) {
      res.status(416).setHeader('Content-Range', 'bytes */' + data.length)
      return res.end()
    }
    const boundedEnd = Math.min(end, data.length - 1)
    res.status(206)
    res.setHeader('Content-Range', 'bytes ' + start + '-' + boundedEnd + '/' + data.length)
    res.setHeader('Content-Length', boundedEnd - start + 1)
    res.end(data.subarray(start, boundedEnd + 1))
  } catch (error) { next(error) }
})
app.post('/api/media/video', auth, express.raw({ type: ['video/mp4', 'video/webm', 'video/quicktime'], limit: aiVideoMaxResponseBytes }), (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, '请选择要上传的视频')
    res.status(201).json(storeUploadedVideo(req.auth.sub, normalizedVideoUpload(req.body, req.headers['content-type'])))
  } catch (error) { next(error) }
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
    if (!topupInstructions) throw fail(503, '管理员尚未配置收款方式')
    const body = parse(z.object({ amountCents: z.number().int().min(100).max(10000000), proof: z.string().trim().min(4, '请填写付款交易单号').max(100) }), req.body)
    const order = { id: randomUUID(), points: Math.floor(body.amountCents / centsPerPoint) }
    if (order.points < 1) throw fail(400, '充值金额不足以兑换 1 积分')
    transaction(() => {
      const duplicate = db.prepare("SELECT id FROM topup_orders WHERE proof=? COLLATE NOCASE AND status IN ('pending','approved')").get(body.proof)
      if (duplicate) throw fail(409, '该付款交易单号已提交')
      db.prepare('INSERT INTO topup_orders (id,user_id,amount_cents,points,proof) VALUES (?,?,?,?,?)')
        .run(order.id, req.auth.sub, body.amountCents, order.points, body.proof)
    })
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
    const relay = relaySettings()
    const model = body.model || relay.models[0]
    if (!relay.models.includes(model)) throw fail(400, '该模型未开放')
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ model, messages: body.messages, maxTokens: body.maxTokens }))
      .digest('hex')
    const cached = db.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?').get(req.auth.sub, body.requestKey)
    if (cached?.request_hash && cached.request_hash !== requestHash) throw fail(409, '该请求标识已用于不同内容')
    if (cached?.status === 'succeeded') return res.json({ ...JSON.parse(cached.response), cached: true })
    if (cached?.status === 'pending') throw fail(409, '该请求正在处理中，请稍后重试')
    if (cached?.status === 'failed') db.prepare('DELETE FROM generations WHERE id=?').run(cached.id)
    const base = relay.baseUrl
    const key = relay.apiKey
    if (!base || !key) throw fail(503, '管理员尚未配置 AI 中转站')
    let url
    try { url = new URL(`${base}/chat/completions`) }
    catch { throw fail(500, '中转站地址无效') }
    const allowedProtocols = isProduction ? ['https:'] : ['https:', 'http:']
    if (!allowedProtocols.includes(url.protocol)) throw fail(500, '中转站地址必须使用 HTTPS')
    const promptTokens = estimatePromptTokens(body.messages)
    const reserved = Math.max(1, Math.ceil(promptTokens / 1000 * inputRate + body.maxTokens / 1000 * outputRate))
    generation = { id: randomUUID(), userId: req.auth.sub, reserved }
    try {
      transaction(() => {
        changeBalance(req.auth.sub, -reserved, 'ai_reserve', generation.id, `AI 调用预占：${model}`)
        db.prepare('INSERT INTO generations (id,user_id,request_key,request_hash,model,reserved,status) VALUES (?,?,?,?,?,?,?)')
          .run(generation.id, req.auth.sub, body.requestKey, requestHash, model, reserved, 'pending')
      })
    } catch (error) {
      generation = undefined
      if (String(error).includes('UNIQUE')) throw fail(409, '该请求正在处理中，请稍后重试')
      throw error
    }
    let upstream
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: body.messages, max_tokens: body.maxTokens, stream: false }),
        signal: AbortSignal.timeout(aiTimeout),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw fail(504, '中转站响应超时')
      throw fail(502, '无法连接中转站')
    }
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {})
      throw fail(502, `中转站请求失败（${upstream.status}）`)
    }
    const data = await readUpstreamJson(upstream)
    const usage = data.usage || {}
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw fail(502, '中转站返回格式不兼容')
    const usageTokens = (value, fallback, minimum) => (
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.max(value, minimum)
        : fallback
    )
    const promptMinimum = body.messages.reduce((total, message) => total + estimateTextTokens(message.content), 0)
    const completionMinimum = estimateTextTokens(content)
    const actual = Math.max(1, Math.ceil(
      usageTokens(usage.prompt_tokens, promptTokens, promptMinimum) / 1000 * inputRate
      + usageTokens(usage.completion_tokens, body.maxTokens, completionMinimum) / 1000 * outputRate,
    ))
    const charged = Math.min(actual, reserved)
    const response = { id: generation.id, model, content, usage, charged, cached: false }
    transaction(() => {
      const row = db.prepare('SELECT status FROM generations WHERE id=?').get(generation.id)
      if (row?.status !== 'pending') throw fail(409, '该请求已由恢复流程终止，请重新生成')
      if (reserved > charged) changeBalance(req.auth.sub, reserved - charged, 'ai_refund', generation.id, 'AI 预占差额退回')
      db.prepare("UPDATE generations SET status=?,charged=?,response=? WHERE id=? AND status='pending'")
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
      } catch (refundError) { console.error('AI refund failed', refundError) }
    }
    next(error)
  }
})

app.post('/api/ai/image', auth, async (req, res, next) => {
  let generation
  try {
    const body = parse(z.object({
      requestKey: z.string().min(8).max(100),
      model: z.string().min(1).max(100).optional(),
      prompt: z.string().trim().min(1).max(10000),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
      references: z.array(z.string().max(1600000)).max(4).default([]),
    }), req.body)
    const referenceImages = body.references.map((value, index) => {
      const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i.exec(value)
      if (!match) throw fail(400, `参考图 ${index + 1} 不是可用的 PNG、JPEG 或 WebP 图片`)
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > 1200000) throw fail(413, `参考图 ${index + 1} 不能超过 1.2 MB`)
      const extension = match[1].includes('png') ? 'png' : match[1].includes('webp') ? 'webp' : 'jpg'
      return { bytes, type: match[1].toLowerCase(), extension }
    })
    const apiKey = userImageApiKey(req.auth.sub)
    if (!apiKey) throw fail(400, '请先在账户设置中保存生图 API 密钥')
    const model = body.model || imageModels[0]
    if (!imageModels.includes(model)) throw fail(400, '该生图模型未开放')
    const requestHash = createHash('sha256').update(JSON.stringify({ ...body, model })).digest('hex')
    const cached = db.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?').get(req.auth.sub, body.requestKey)
    if (cached?.request_hash && cached.request_hash !== requestHash) throw fail(409, '该请求标识已用于不同内容')
    if (cached?.status === 'succeeded') return res.json({ ...JSON.parse(cached.response), cached: true })
    if (cached?.status === 'pending') throw fail(409, '该请求正在处理中，请稍后重试')
    if (cached?.status === 'failed') db.prepare('DELETE FROM generations WHERE id=?').run(cached.id)
    const imageRoute = referenceImages.length ? '/images/edits' : '/images/generations'
    const url = await validateImageRelayUrl(imageRelayBaseUrl + imageRoute)
    generation = { id: randomUUID() }
    try {
      db.prepare('INSERT INTO generations (id,user_id,request_key,request_hash,kind,model,reserved,charged,status) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(generation.id, req.auth.sub, body.requestKey, requestHash, 'image', model, 0, 0, 'pending')
    } catch (error) {
      generation = undefined
      if (String(error).includes('UNIQUE')) throw fail(409, '该请求正在处理中，请稍后重试')
      throw error
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), aiTimeout)
    let upstream
    try {
      if (referenceImages.length) {
        const form = new FormData()
        form.set('model', model)
        form.set('prompt', body.prompt)
        form.set('size', body.size)
        form.set('n', '1')
        form.set('response_format', 'b64_json')
        form.set('output_format', 'png')
        referenceImages.forEach((image, index) => form.append('image', new Blob([image.bytes], { type: image.type }), `reference-${index + 1}.${image.extension}`))
        upstream = await fetch(url, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { authorization: `Bearer ${apiKey}` }, body: form })
      } else {
        upstream = await fetch(url, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: body.prompt, size: body.size, n: 1 }) })
      }
    } catch (error) {
      throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '生图中转站响应超时' : '无法连接生图中转站')
    } finally { clearTimeout(timer) }
    const text = await readUpstreamText(upstream, upstream.ok ? aiImageMaxResponseBytes : aiMaxResponseBytes)
    let payload
    try { payload = JSON.parse(text) } catch { payload = null }
    if (!upstream.ok) {
      throw imageUpstreamFailure(upstream.status)
    }
    const image = payload?.data?.[0]
    const rawImageUrl = image?.url || image?.image_url || payload?.url || payload?.result?.url || ''
    const base64 = image?.b64_json || image?.base64 || payload?.result?.b64_json || ''
    const imageUrl = rawImageUrl || (base64 ? `data:image/png;base64,${base64}` : '')
    if (!imageUrl || [rawImageUrl, base64].some((value) => typeof value !== 'string' || value.includes(apiKey))) {
      throw fail(502, '生图中转站未返回图片')
    }
    const response = { imageUrl, model, charged: 0, cached: false }
    transaction(() => {
      const row = db.prepare('SELECT status FROM generations WHERE id=?').get(generation.id)
      if (row?.status !== 'pending') throw fail(409, '该请求已由恢复流程终止，请重新生成')
      db.prepare("UPDATE generations SET status='succeeded',charged=?,response=? WHERE id=? AND status='pending'")
        .run(0, JSON.stringify(response), generation.id)
    })
    res.json(response)
  } catch (error) {
    if (generation) {
      try {
        db.prepare("UPDATE generations SET status='failed',charged=0 WHERE id=? AND status='pending'").run(generation.id)
      } catch (updateError) { console.error('AI image status update failed', updateError) }
    }
    next(error)
  }
})

app.post('/api/ai/video', auth, async (req, res, next) => {
  let generation
  try {
    const body = parse(z.object({
      requestKey: z.string().min(8).max(100),
      model: z.string().min(1).max(100).optional(),
      prompt: z.string().trim().min(1).max(10000),
      size: z.enum(['1280x720', '720x1280', '1024x1024']).default('1280x720'),
      seconds: z.number().int().min(1).max(20).default(6),
      references: z.array(z.string().max(1600000)).max(4).default([]),
    }), req.body)
    const referenceImages = body.references.map((value, index) => {
      const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i.exec(value)
      if (!match) throw fail(400, '参考图 ' + (index + 1) + ' 格式无效')
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > 1200000) throw fail(413, '参考图 ' + (index + 1) + ' 不能超过 1.2 MB')
      const extension = match[1].includes('png') ? 'png' : match[1].includes('webp') ? 'webp' : 'jpg'
      return { bytes, type: match[1].toLowerCase(), extension }
    })
    const relay = relaySettings('video')
    const model = body.model || relay.models[0]
    if (!relay.models.includes(model)) throw fail(400, '该视频模型未开放')
    if (!relay.baseUrl || !relay.apiKey) throw fail(503, '管理员尚未配置视频中转站')
    const requestHash = createHash('sha256').update(JSON.stringify({ ...body, model })).digest('hex')
    const cached = db.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?').get(req.auth.sub, body.requestKey)
    if (cached?.request_hash && cached.request_hash !== requestHash) throw fail(409, '该请求标识已用于不同内容')
    if (cached?.status === 'succeeded') return res.json({ ...JSON.parse(cached.response), cached: true })
    if (cached?.status === 'pending') return res.status(202).json({ id: cached.id, status: 'pending', model: cached.model, charged: Number(cached.reserved), cached: true })
    if (cached?.status === 'failed') db.prepare('DELETE FROM generations WHERE id=?').run(cached.id)
    const url = allowedRelayUrl(relay.baseUrl + '/videos', '视频中转站')
    const cost = videoPointCost()
    generation = { id: randomUUID(), userId: req.auth.sub, reserved: cost }
    transaction(() => {
      changeBalance(req.auth.sub, -cost, 'ai_video_reserve', generation.id, '视频生成预占：' + model)
      db.prepare('INSERT INTO generations (id,user_id,request_key,request_hash,kind,model,reserved,status) VALUES (?,?,?,?,?,?,?,?)')
        .run(generation.id, req.auth.sub, body.requestKey, requestHash, 'video', model, cost, 'pending')
    })
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', body.prompt)
    form.set('seconds', String(body.seconds))
    form.set('size', body.size)
    form.set('resolution_name', '720p')
    form.set('preset', 'normal')
    referenceImages.forEach((image, index) => form.append('input_reference[]', new Blob([image.bytes], { type: image.type }), 'reference-' + (index + 1) + '.' + image.extension))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(videoTimeout, 120000))
    let upstream
    try {
      upstream = await fetch(url, { method: 'POST', signal: controller.signal, headers: { authorization: 'Bearer ' + relay.apiKey }, body: form })
    } catch (error) {
      throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '视频任务创建超时' : '无法连接视频中转站')
    } finally { clearTimeout(timer) }
    const payloadText = await readUpstreamText(upstream)
    let payload
    try { payload = JSON.parse(payloadText) } catch { payload = null }
    if (!upstream.ok) throw fail(502, '视频中转站返回 ' + upstream.status + '：' + upstreamErrorDetail(payload, upstream.status))
    const task = unwrapVideoPayload(payload)
    const resultUrl = videoResultUrl(task)
    if (resultUrl) {
      const response = storeVideoMedia(req.auth.sub, generation.id, await fetchVideoBytes(resultUrl, relay))
      generation = undefined
      return res.json(response)
    }
    const taskId = videoTaskId(task)
    if (!taskId) throw fail(502, '视频中转站没有返回任务 ID 或视频地址')
    const initial = { taskId, startedAt: Date.now(), model }
    db.prepare("UPDATE generations SET response=? WHERE id=? AND user_id=? AND status='pending'").run(JSON.stringify(initial), generation.id, req.auth.sub)
    const response = { id: generation.id, status: 'pending', model, charged: cost, cached: false }
    generation = undefined
    res.status(202).json(response)
  } catch (error) {
    if (generation) {
      try { failVideoGeneration({ id: generation.id, user_id: generation.userId, reserved: generation.reserved }) }
      catch (refundError) { console.error('AI video refund failed', refundError) }
    }
    next(error)
  }
})

app.get('/api/ai/video/:id', auth, async (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM generations WHERE id=? AND user_id=? AND kind=?').get(req.params.id, req.auth.sub, 'video')
    if (!row) throw fail(404, '视频任务不存在')
    if (row.status === 'succeeded') return res.json({ ...JSON.parse(row.response), cached: true })
    if (row.status === 'failed') throw fail(409, '视频任务已失败，积分已退回')
    let state
    try { state = JSON.parse(row.response || '{}') } catch { state = {} }
    if (!state.taskId) throw fail(502, '视频任务状态已损坏')
    if (!Number.isFinite(state.startedAt) || Date.now() - state.startedAt > videoTimeout) {
      failVideoGeneration(row)
      throw fail(504, '视频生成超时，积分已退回')
    }
    const relay = relaySettings('video')
    if (!relay.baseUrl || !relay.apiKey) throw fail(503, '视频中转配置已被清除，任务暂时无法查询')
    const url = allowedRelayUrl(relay.baseUrl + '/videos/' + encodeURIComponent(state.taskId), '视频中转站')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(30000, videoTimeout))
    let upstream
    try { upstream = await fetch(url, { signal: controller.signal, headers: { authorization: 'Bearer ' + relay.apiKey } }) }
    catch (error) { throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '视频任务查询超时' : '无法查询视频任务') }
    finally { clearTimeout(timer) }
    const payloadText = await readUpstreamText(upstream)
    let payload
    try { payload = JSON.parse(payloadText) } catch { payload = null }
    if (!upstream.ok) throw fail(502, '视频任务查询失败：' + upstreamErrorDetail(payload, upstream.status))
    const task = unwrapVideoPayload(payload)
    const status = videoTaskStatus(task)
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) {
      failVideoGeneration(row)
      throw fail(502, '视频生成失败，积分已退回：' + videoTaskError(task))
    }
    let resultUrl = videoResultUrl(task)
    if (!resultUrl && ['completed', 'succeeded', 'success'].includes(status)) {
      resultUrl = relay.baseUrl + '/videos/' + encodeURIComponent(state.taskId) + '/content'
    }
    if (!resultUrl) return res.status(202).json({ id: row.id, status: 'pending', model: row.model, charged: Number(row.reserved), cached: true, pollAfterMs: videoPollMs })
    const media = await fetchVideoBytes(resultUrl, relay)
    let response
    try {
      response = storeVideoMedia(req.auth.sub, row.id, media)
    } catch (error) {
      if (Number(error?.status) === 413) failVideoGeneration(row)
      throw error
    }
    res.json(response)
  } catch (error) { next(error) }
})

app.get('/api/admin/overview', auth, admin, (_req, res) => {
  const relay = relaySettings()
  const videoRelay = relaySettings('video')
  const stats = {
    users: Number(db.prepare('SELECT COUNT(*) n FROM users').get().n),
    canvases: Number(db.prepare('SELECT COUNT(*) n FROM canvases').get().n),
    points: Number(db.prepare('SELECT COALESCE(SUM(balance),0) n FROM users').get().n),
    pendingTopups: Number(db.prepare("SELECT COUNT(*) n FROM topup_orders WHERE status='pending'").get().n),
  }
  const orders = db.prepare('SELECT o.*,u.email FROM topup_orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100').all()
  const audit = db.prepare(`
    SELECT a.id,a.action,a.target_id,a.details,a.created_at,u.email actor_email
    FROM admin_audit a JOIN users u ON u.id=a.actor_id
    ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100
  `).all().map((item) => ({ ...item, details: JSON.parse(item.details) }))
  res.json({
    stats,
    orders,
    audit,
    ai: {
      configured: Boolean(relay.baseUrl && relay.apiKey),
      keyConfigured: Boolean(relay.apiKey),
      baseUrl: relay.baseUrl,
      models: relay.models,
      source: relay.source,
      inputRate,
      outputRate,
    },
    video: { configured: Boolean(videoRelay.baseUrl && videoRelay.apiKey), keyConfigured: Boolean(videoRelay.apiKey), baseUrl: videoRelay.baseUrl, models: videoRelay.models, source: videoRelay.source, points: videoPointCost() },
  })
})
app.put('/api/admin/ai-config', auth, admin, (req, res, next) => {
  try {
    const body = parse(z.object({
      baseUrl: z.string().trim().max(2000),
      apiKey: z.string().trim().max(4000).optional(),
      clearApiKey: z.boolean().default(false),
      models: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    }), req.body)
    if (body.apiKey && body.clearApiKey) throw fail(400, '不能同时填写密钥和清除密钥')
    const normalizedBase = normalizeRelayBaseUrl(body.baseUrl, '中转站', 400)
    const models = [...new Set(body.models)]
    const before = relaySettings()
    const current = db.prepare('SELECT ai_api_key_encrypted,ai_api_key_managed FROM app_settings WHERE id=1').get()
    let encryptedKey = current?.ai_api_key_encrypted || null
    if (body.apiKey) encryptedKey = encryptSetting(body.apiKey)
    else if (body.clearApiKey) encryptedKey = null
    else if (!Number(current?.ai_api_key_managed) && !encryptedKey && process.env.AI_API_KEY?.trim()) encryptedKey = encryptSetting(process.env.AI_API_KEY.trim())
    transaction(() => {
      db.prepare(`UPDATE app_settings SET ai_base_url=?,
        ai_api_key_encrypted=?,ai_api_key_managed=1,
        ai_models=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
        .run(normalizedBase || null, encryptedKey, JSON.stringify(models), req.auth.sub)
      auditAdmin(req.auth.sub, 'ai_config.update', null, {
        baseUrlChanged: before.baseUrl !== normalizedBase,
        keyChanged: Boolean(body.apiKey || body.clearApiKey),
        modelsChanged: JSON.stringify(before.models) !== JSON.stringify(models),
      })
    })
    const relay = relaySettings()
    res.json({ configured: Boolean(relay.baseUrl && relay.apiKey), keyConfigured: Boolean(relay.apiKey), baseUrl: relay.baseUrl, models: relay.models, source: relay.source })
  } catch (error) { next(error) }
})
app.put('/api/admin/video-config', auth, admin, (req, res, next) => {
  try {
    const body = parse(z.object({
      baseUrl: z.string().trim().max(2000), apiKey: z.string().trim().max(4000).optional(),
      clearApiKey: z.boolean().default(false), models: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
      points: z.number().int().min(1).max(1000000),
    }), req.body)
    if (body.apiKey && body.clearApiKey) throw fail(400, '不能同时填写密钥和清除密钥')
    const base = normalizeRelayBaseUrl(body.baseUrl, '视频中转站', 400)
    const before = relaySettings('video')
    const current = db.prepare('SELECT ai_video_api_key_encrypted,ai_video_api_key_managed FROM app_settings WHERE id=1').get()
    let encrypted = current?.ai_video_api_key_encrypted || null
    if (body.apiKey) encrypted = encryptSetting(body.apiKey)
    else if (body.clearApiKey) encrypted = null
    else if (!Number(current?.ai_video_api_key_managed) && !encrypted && process.env.AI_VIDEO_API_KEY?.trim()) encrypted = encryptSetting(process.env.AI_VIDEO_API_KEY.trim())
    const models = [...new Set(body.models)]
    transaction(() => {
      db.prepare('UPDATE app_settings SET ai_video_base_url=?, ai_video_api_key_encrypted=?, ai_video_api_key_managed=1, ai_video_models=?, ai_video_points=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=1')
        .run(base || null, encrypted, JSON.stringify(models), body.points, req.auth.sub)
      auditAdmin(req.auth.sub, 'video_config.update', null, { baseUrlChanged: before.baseUrl !== base, keyChanged: Boolean(body.apiKey || body.clearApiKey), modelsChanged: JSON.stringify(before.models) !== JSON.stringify(models), points: body.points })
    })
    const relay = relaySettings('video')
    res.json({ configured: Boolean(relay.baseUrl && relay.apiKey), keyConfigured: Boolean(relay.apiKey), baseUrl: relay.baseUrl, models: relay.models, source: relay.source, points: videoPointCost() })
  } catch (error) { next(error) }
})
app.post('/api/admin/ai-config/test', auth, admin, async (req, res, next) => {
  try {
    const body = parse(z.object({
      baseUrl: z.string().trim().max(2000),
      apiKey: z.string().trim().max(4000).optional(),
      model: z.string().trim().min(1).max(100),
    }), req.body)
    const baseUrl = normalizeRelayBaseUrl(body.baseUrl, '中转站', 400)
    if (!baseUrl) throw fail(400, '中转站地址无效')
    const saved = relaySettings()
    const key = body.apiKey || saved.apiKey
    if (!key) throw fail(400, '请先填写或保存 API 密钥')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(aiTimeout, 30000))
    let upstream
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: body.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8 }),
      })
    } catch (error) {
      throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '中转站测试超时' : '无法连接中转站')
    } finally { clearTimeout(timer) }
    const text = await readUpstreamText(upstream)
    let payload
    try { payload = JSON.parse(text) } catch { payload = null }
    if (!upstream.ok) {
      const detail = typeof payload?.error?.message === 'string' ? payload.error.message.slice(0, 240) : `HTTP ${upstream.status}`
      throw fail(502, `中转站返回错误：${detail}`)
    }
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw fail(502, '中转站响应格式不符合 Chat Completions')
    res.json({ ok: true, status: upstream.status, model: body.model, reply: content.slice(0, 240) })
  } catch (error) { next(error) }
})
app.post('/api/admin/video-config/test', auth, admin, async (req, res, next) => {
  try {
    const body = parse(z.object({ baseUrl: z.string().trim().max(2000), apiKey: z.string().trim().max(4000).optional(), model: z.string().trim().min(1).max(100) }), req.body)
    const baseUrl = normalizeRelayBaseUrl(body.baseUrl, '视频中转站', 400)
    if (!baseUrl) throw fail(400, '视频中转站地址无效')
    allowedRelayUrl(baseUrl, '视频中转站')
    const saved = relaySettings('video')
    const key = body.apiKey || saved.apiKey
    if (!key) throw fail(400, '请先填写或保存视频 API 密钥')
    const form = new FormData()
    form.set('model', body.model)
    form.set('prompt', 'A static white square on a plain background.')
    form.set('seconds', '1')
    form.set('size', '1280x720')
    form.set('resolution_name', '720p')
    form.set('preset', 'normal')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(videoTimeout, 60000))
    let upstream
    try { upstream = await fetch(baseUrl + '/videos', { method: 'POST', signal: controller.signal, headers: { authorization: 'Bearer ' + key }, body: form }) }
    catch (error) { throw fail(error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? '视频中转测试超时' : '无法连接视频中转站') }
    finally { clearTimeout(timer) }
    const text = await readUpstreamText(upstream)
    let payload
    try { payload = JSON.parse(text) } catch { payload = null }
    if (!upstream.ok) throw fail(502, '视频中转站返回 ' + upstream.status + '：' + upstreamErrorDetail(payload, upstream.status))
    const task = unwrapVideoPayload(payload)
    if (!videoTaskId(task) && !videoResultUrl(task)) throw fail(502, '视频中转站没有返回任务 ID 或视频地址')
    res.json({ ok: true, status: upstream.status, model: body.model, taskId: videoTaskId(task) || null })
  } catch (error) { next(error) }
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
    const codes = transaction(() => {
      const generated = Array.from({ length: body.count }, () => {
        const code = `INK-${randomBytes(16).toString('hex').toUpperCase()}`
        db.prepare('INSERT INTO redeem_codes (id,code_hash,label,points,max_uses,expires_at,created_by) VALUES (?,?,?,?,?,?,?)')
          .run(randomUUID(), hashCode(code), body.label || null, body.points, body.maxUses, body.expiresAt || null, req.auth.sub)
        return code
      })
      auditAdmin(req.auth.sub, 'codes.create', null, { count: body.count, points: body.points, maxUses: body.maxUses, label: body.label || null })
      return generated
    })
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
      auditAdmin(req.auth.sub, 'topup.approve', item.id, { userId: item.user_id, amountCents: Number(item.amount_cents), points: Number(item.points) })
      return { ...item, status: 'approved' }
    })
    res.json({ order })
  } catch (error) { next(error) }
})
app.post('/api/admin/topups/:id/reject', auth, admin, (req, res, next) => {
  try {
    transaction(() => {
      const item = db.prepare("SELECT * FROM topup_orders WHERE id=? AND status='pending'").get(req.params.id)
      if (!item) throw fail(409, '订单不存在或已处理')
      db.prepare("UPDATE topup_orders SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(req.auth.sub, item.id)
      auditAdmin(req.auth.sub, 'topup.reject', item.id, { userId: item.user_id, amountCents: Number(item.amount_cents), points: Number(item.points) })
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }))
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
