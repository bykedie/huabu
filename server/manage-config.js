import 'dotenv/config'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db, transaction } from './db.js'

const fail = (message) => { throw new Error(message) }
const jwtSecret = process.env.JWT_SECRET || ''
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) fail('JWT_SECRET must contain at least 32 bytes')
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
  if (fields.length !== count) fail('invalid maintenance input')
  return fields
}

function normalizeRelay(baseInput, modelsInput) {
  let baseUrl = baseInput.trim().replace(/\/+$/, '')
  if (baseUrl.length > 2000) fail('relay URL is too long')
  if (baseUrl) {
    let url
    try { url = new URL(baseUrl) } catch { fail('invalid relay URL') }
    if (!['http:', 'https:'].includes(url.protocol)) fail('relay URL must use HTTP or HTTPS')
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') fail('production relay URL must use HTTPS')
    if (url.username || url.password) fail('relay URL may not contain credentials')
    baseUrl = url.toString().replace(/\/+$/, '')
  }
  const models = [...new Set(modelsInput.split(',').map((item) => item.trim()).filter(Boolean))]
  if (!models.length || models.length > 50 || models.some((model) => model.length > 100)) fail('invalid relay model list')
  return { baseUrl, models }
}

function updateRelay(kind) {
  if (!['text', 'video'].includes(kind)) fail('unknown relay kind')
  const [baseInput, modelsInput, keyAction, keyInput] = readFields(4)
  if (!['keep', 'set', 'clear'].includes(keyAction)) fail('invalid API key action')
  const key = keyInput.trim()
  if (key.length > 4000) fail('API key is too long')
  if (keyAction === 'set' && !key) fail('API key cannot be empty')
  if (keyAction !== 'set' && key) fail('unexpected API key data')
  const { baseUrl, models } = normalizeRelay(baseInput, modelsInput)
  const current = kind === 'video'
    ? db.prepare('SELECT ai_video_api_key_encrypted AS encrypted,ai_video_api_key_managed AS managed FROM app_settings WHERE id=1').get()
    : db.prepare('SELECT ai_api_key_encrypted AS encrypted,ai_api_key_managed AS managed FROM app_settings WHERE id=1').get()
  const keyManaged = Number(current?.managed) === 1
  const environmentKey = ((kind === 'video' ? process.env.AI_VIDEO_API_KEY : process.env.AI_API_KEY) || '').trim()
  if (environmentKey.length > 4000) fail('saved environment API key is too long')
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
  if (!/^[0-9]+$/.test(raw) || raw.length > 7) fail('invalid video point cost')
  const points = Number(raw)
  if (!Number.isInteger(points) || points < 1 || points > 1000000) fail('invalid video point cost')
  db.prepare('UPDATE app_settings SET ai_video_points=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(points)
}

try {
  const command = process.argv[2]
  if (command === 'relay') updateRelay(process.argv[3])
  else if (command === 'video-points') updateVideoPoints(process.argv[3] || '')
  else fail('unknown maintenance command')
  db.close()
  process.stdout.write('Configuration updated.\n')
} catch (error) {
  try { db.close() } catch {}
  process.stderr.write(`Configuration update failed: ${error.message}\n`)
  process.exitCode = 1
}
