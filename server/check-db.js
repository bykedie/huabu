import { DatabaseSync } from 'node:sqlite'
import { existsSync, statSync } from 'node:fs'

const databasePath = process.argv[2]
if (!databasePath) throw new Error('请提供数据库路径')
if (!existsSync(databasePath) || !statSync(databasePath).isFile() || statSync(databasePath).size === 0) {
  throw new Error('数据库文件不存在或为空')
}

const db = new DatabaseSync(databasePath)
try {
  const result = db.prepare('PRAGMA quick_check').get()
  if (result.quick_check !== 'ok') throw new Error(`SQLite 校验失败：${result.quick_check}`)

  const requiredSchema = {
    users: ['id', 'email', 'password_hash', 'name', 'role', 'balance'],
    canvases: ['id', 'user_id', 'name', 'document', 'version'],
    ledger: ['id', 'user_id', 'amount', 'balance_after', 'kind', 'reference'],
    redeem_codes: ['id', 'code_hash', 'points', 'max_uses', 'uses', 'created_by'],
    redemptions: ['code_id', 'user_id'],
    topup_orders: ['id', 'user_id', 'amount_cents', 'points', 'status', 'proof'],
    generations: ['id', 'user_id', 'request_key', 'request_hash', 'reserved', 'charged', 'status'],
    health_probe: ['id', 'value'],
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
  for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
    if (!tables.has(table)) throw new Error(`不是有效的画布数据库：缺少 ${table} 表`)
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
    const missing = requiredColumns.filter((column) => !columns.has(column))
    if (missing.length) throw new Error(`不是有效的画布数据库：${table} 缺少字段 ${missing.join(', ')}`)
  }

  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyErrors.length) {
    const first = foreignKeyErrors[0]
    throw new Error(`数据库外键校验失败：${first.table} 第 ${first.rowid} 行`)
  }
} finally {
  db.close()
}
