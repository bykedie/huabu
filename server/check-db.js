import { DatabaseSync } from 'node:sqlite'
import { existsSync, statSync } from 'node:fs'
import { createDecipheriv, createHash } from 'node:crypto'

const allowLegacy = process.argv.includes('--allow-legacy')
const databasePath = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
if (!databasePath) throw new Error('请提供数据库路径')
if (!existsSync(databasePath) || !statSync(databasePath).isFile() || statSync(databasePath).size === 0) {
  throw new Error('数据库文件不存在或为空')
}

const db = new DatabaseSync(databasePath)
try {
  const result = db.prepare('PRAGMA quick_check').get()
  if (result.quick_check !== 'ok') throw new Error(`SQLite 校验失败：${result.quick_check}`)

  const requiredSchema = {
    users: [
      'id', 'email', 'password_hash', 'name', 'role', 'balance',
      ...(allowLegacy ? [] : ['admin_password_encrypted', 'image_api_key_encrypted', 'login_failures', 'login_failure_started_at', 'login_locked_until', 'session_version']),
    ],
    canvases: ['id', 'user_id', 'name', 'document', ...(allowLegacy ? [] : ['version'])],
    ...(!allowLegacy ? { assets: ['id', 'user_id', 'kind', 'title', 'content'] } : {}),
    ...(!allowLegacy ? { media: ['id', 'user_id', 'kind', 'file_name', 'mime_type', 'bytes', 'data'] } : {}),
    ledger: ['id', 'user_id', 'amount', 'balance_after', 'kind', 'reference'],
    redeem_codes: ['id', 'code_hash', 'points', 'max_uses', 'uses', 'created_by'],
    redemptions: ['code_id', 'user_id'],
    topup_orders: ['id', 'user_id', 'amount_cents', 'points', 'status', 'proof'],
    ...(!allowLegacy ? { admin_audit: ['id', 'actor_id', 'action', 'target_id', 'details', 'created_at'] } : {}),
    ...(!allowLegacy ? { app_settings: ['id', 'ai_base_url', 'ai_api_key_encrypted', 'ai_api_key_managed', 'ai_models', 'ai_image_base_url', 'ai_image_api_key_encrypted', 'ai_image_models', 'ai_image_points', 'ai_video_base_url', 'ai_video_api_key_encrypted', 'ai_video_api_key_managed', 'ai_video_models', 'ai_video_points', 'updated_by', 'updated_at'] } : {}),
    generations: ['id', 'user_id', 'request_key', ...(allowLegacy ? [] : ['request_hash', 'kind']), 'reserved', 'charged', 'status'],
    ...(!allowLegacy ? { health_probe: ['id', 'value'] } : {}),
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
  for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
    if (!tables.has(table)) throw new Error(`不是有效的画布数据库：缺少 ${table} 表`)
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
    const missing = requiredColumns.filter((column) => !columns.has(column))
    if (missing.length) throw new Error(`不是有效的画布数据库：${table} 缺少字段 ${missing.join(', ')}`)
  }

  if (!allowLegacy) {
    const jwtSecret = process.env.JWT_SECRET || ''
    const settingsKey = jwtSecret ? createHash('sha256').update(`ai-settings:${jwtSecret}`).digest() : null
    const adminLoginKey = jwtSecret ? createHash('sha256').update(`admin-login:${jwtSecret}`).digest() : null
    const encryptedColumns = [
      ['app_settings', 'ai_api_key_encrypted', settingsKey],
      ['app_settings', 'ai_video_api_key_encrypted', settingsKey],
      ['users', 'admin_password_encrypted', adminLoginKey],
      ['users', 'image_api_key_encrypted', settingsKey],
    ]
    const decrypt = (value, key) => {
      const parts = typeof value === 'string' ? value.split('.') : []
      if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('invalid ciphertext')
      const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'))
      if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error('invalid ciphertext')
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      decipher.update(encrypted)
      decipher.final()
    }
    for (const [table, column, key] of encryptedColumns) {
      const values = db.prepare(`SELECT ${column} value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()
      if (!values.length) continue
      if (!jwtSecret) throw new Error(`数据库包含加密密钥但 JWT_SECRET 未配置：${table}.${column}`)
      for (const row of values) {
        try { decrypt(row.value, key) }
        catch { throw new Error(`数据库加密密钥无法用当前 JWT_SECRET 解密：${table}.${column}`) }
      }
    }
  }

  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyErrors.length) {
    const first = foreignKeyErrors[0]
    throw new Error(`数据库外键校验失败：${first.table} 第 ${first.rowid} 行`)
  }
} finally {
  db.close()
}
