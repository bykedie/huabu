import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const dbFile = resolve(process.env.DB_PATH || 'data/app.db')
mkdirSync(dirname(dbFile), { recursive: true })
export const db = new DatabaseSync(dbFile)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS redeem_codes (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, label TEXT, points INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS redemptions (
  code_id TEXT NOT NULL REFERENCES redeem_codes(id), user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (code_id, user_id)
);
CREATE TABLE IF NOT EXISTS topup_orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL,
  points INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', proof TEXT,
  reviewed_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
  request_hash TEXT, model TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER, status TEXT NOT NULL,
  response TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_canvas_user ON canvases(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at DESC);
`)
const generationColumns = db.prepare('PRAGMA table_info(generations)').all()
if (!generationColumns.some((column) => column.name === 'request_hash')) {
  db.exec('ALTER TABLE generations ADD COLUMN request_hash TEXT')
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function changeBalance(userId, amount, kind, reference = null, note = null) {
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId)
  if (!user) throw Object.assign(new Error('用户不存在'), { status: 404 })
  const next = Number(user.balance) + amount
  if (next < 0) throw Object.assign(new Error('积分不足'), { status: 402 })
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId)
  db.prepare('INSERT INTO ledger (id,user_id,amount,balance_after,kind,reference,note) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), userId, amount, next, kind, reference, note)
  return next
}

export function recoverPendingGenerations() {
  return transaction(() => {
    const pending = db.prepare("SELECT id,user_id,reserved FROM generations WHERE status='pending'").all()
    let recovered = 0
    for (const item of pending) {
      const result = db.prepare("UPDATE generations SET status='failed' WHERE id=? AND status='pending'").run(item.id)
      if (!result.changes) continue
      changeBalance(item.user_id, Number(item.reserved), 'ai_refund', item.id, '服务重启，AI 预占积分退回')
      recovered += 1
    }
    return recovered
  })
}
