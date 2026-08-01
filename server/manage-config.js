import 'dotenv/config'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db, transaction } from './db.js'

const fail = (message) => { throw new Error(message) }
const jwtSecret = process.env.JWT_SECRET || ''
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) fail('JWT_SECRET 必须至少包含 32 字节')
const settingsKey = createHash('sha256').update(`ai-settings:${jwtSecret}`).digest()

function encryptSetting(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', settingsKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.')
}

function readFields(count) {
  const fields = readFileSync(0).toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length !== count) fail('维护输入格式无效')
  return fields
}

function normalizeRelay(baseInput, modelsInput) {
  let baseUrl = baseInput.trim().replace(/\/+$/, '')
  if (baseUrl.length > 2000) fail('中转站地址过长')
  if (baseUrl) {
    let url
    try { url = new URL(baseUrl) } catch { fail('中转站地址无效') }
    if (!['http:', 'https:'].includes(url.protocol)) fail('中转站地址必须使用 HTTP 或 HTTPS')
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') fail('生产环境的中转站地址必须使用 HTTPS')
    if (url.username || url.password) fail('中转站地址不能包含用户名或密码')
    baseUrl = url.toString().replace(/\/+$/, '')
  }
  const models = [...new Set(modelsInput.split(',').map((item) => item.trim()).filter(Boolean))]
  if (!models.length || models.length > 50 || models.some((model) => model.length > 100)) fail('中转模型列表无效')
  return { baseUrl, models }
}

function updateRelay(kind) {
  if (!['text', 'video'].includes(kind)) fail('未知的中转类型')
  const [baseInput, modelsInput, keyAction, keyInput] = readFields(4)
  if (!['keep', 'set', 'clear'].includes(keyAction)) fail('API 密钥操作无效')
  const key = keyInput.trim()
  if (key.length > 4000) fail('API 密钥过长')
  if (keyAction === 'set' && !key) fail('API 密钥不能为空')
  if (keyAction !== 'set' && key) fail('收到非预期的 API 密钥数据')
  const { baseUrl, models } = normalizeRelay(baseInput, modelsInput)
  const current = kind === 'video'
    ? db.prepare('SELECT ai_video_api_key_encrypted AS encrypted,ai_video_api_key_managed AS managed FROM app_settings WHERE id=1').get()
    : db.prepare('SELECT ai_api_key_encrypted AS encrypted,ai_api_key_managed AS managed FROM app_settings WHERE id=1').get()
  const keyManaged = Number(current?.managed) === 1
  const environmentKey = ((kind === 'video' ? process.env.AI_VIDEO_API_KEY : process.env.AI_API_KEY) || '').trim()
  if (environmentKey.length > 4000) fail('环境变量中保存的 API 密钥过长')
  let encrypted = current?.encrypted || null
  if (keyAction === 'set') encrypted = encryptSetting(key)
  if (keyAction === 'clear') encrypted = null
  if (keyAction === 'keep' && !keyManaged && !encrypted && environmentKey) encrypted = encryptSetting(environmentKey)
  transaction(() => {
    if (kind === 'video') {
      db.prepare(`UPDATE app_settings SET ai_video_base_url=?,
        ai_video_api_key_encrypted=?,ai_video_api_key_managed=1,
        ai_video_models=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
        .run(baseUrl || null, encrypted, JSON.stringify(models))
    } else {
      db.prepare(`UPDATE app_settings SET ai_base_url=?,
        ai_api_key_encrypted=?,ai_api_key_managed=1,
        ai_models=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
        .run(baseUrl || null, encrypted, JSON.stringify(models))
    }
  })
}

function updateVideoPoints(raw) {
  if (!/^[0-9]+$/.test(raw) || raw.length > 7) fail('视频积分消耗无效')
  const points = Number(raw)
  if (!Number.isInteger(points) || points < 1 || points > 1000000) fail('视频积分消耗无效')
  db.prepare('UPDATE app_settings SET ai_video_points=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(points)
}

try {
  const command = process.argv[2]
  if (command === 'relay') updateRelay(process.argv[3])
  else if (command === 'video-points') updateVideoPoints(process.argv[3] || '')
  else fail('未知的维护命令')
  db.close()
  process.stdout.write('配置已更新。\n')
} catch (error) {
  try { db.close() } catch {}
  process.stderr.write(`配置更新失败：${error.message}\n`)
  process.exitCode = 1
}
