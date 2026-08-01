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
  admin_password_encrypted TEXT,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', balance INTEGER NOT NULL DEFAULT 0,
  image_api_key_encrypted TEXT,
  login_failures INTEGER NOT NULL DEFAULT 0, login_failure_started_at TEXT, login_locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
  source_canvas_id TEXT, source_node_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, file_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, data BLOB,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  target_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), ai_base_url TEXT, ai_api_key_encrypted TEXT,
  ai_api_key_managed INTEGER NOT NULL DEFAULT 0,
  ai_models TEXT, ai_image_base_url TEXT, ai_image_api_key_encrypted TEXT, ai_image_models TEXT, ai_image_points INTEGER,
  ai_video_base_url TEXT, ai_video_api_key_encrypted TEXT, ai_video_api_key_managed INTEGER NOT NULL DEFAULT 0,
  ai_video_models TEXT, ai_video_points INTEGER,
  updated_by TEXT REFERENCES users(id), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
  request_hash TEXT, kind TEXT NOT NULL DEFAULT 'text', model TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER, status TEXT NOT NULL,
  response TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, request_key)
);
CREATE TABLE IF NOT EXISTS health_probe (
  id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO health_probe (id,value) VALUES (1,0);
INSERT OR IGNORE INTO app_settings (id) VALUES (1);
CREATE INDEX IF NOT EXISTS idx_canvas_user ON canvases(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'admin audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete BEFORE DELETE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'admin audit records are immutable'); END;
`)
const settingsColumns = db.prepare('PRAGMA table_info(app_settings)').all()
if (!settingsColumns.some((column) => column.name === 'ai_api_key_managed')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_api_key_managed INTEGER NOT NULL DEFAULT 0')
if (!settingsColumns.some((column) => column.name === 'ai_image_base_url')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_image_base_url TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_image_api_key_encrypted')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_image_api_key_encrypted TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_image_models')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_image_models TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_image_points')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_image_points INTEGER')
if (!settingsColumns.some((column) => column.name === 'ai_video_base_url')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_video_base_url TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_video_api_key_encrypted')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_video_api_key_encrypted TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_video_api_key_managed')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_video_api_key_managed INTEGER NOT NULL DEFAULT 0')
if (!settingsColumns.some((column) => column.name === 'ai_video_models')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_video_models TEXT')
if (!settingsColumns.some((column) => column.name === 'ai_video_points')) db.exec('ALTER TABLE app_settings ADD COLUMN ai_video_points INTEGER')
db.exec(`
UPDATE app_settings SET ai_api_key_managed=1
WHERE ai_api_key_managed=0 AND (
  ai_api_key_encrypted IS NOT NULL OR EXISTS (
    SELECT 1 FROM admin_audit
    WHERE action='ai_config.update' AND instr(details,'"keyChanged":true') > 0
  )
);
UPDATE app_settings SET ai_video_api_key_managed=1
WHERE ai_video_api_key_managed=0 AND (
  ai_video_api_key_encrypted IS NOT NULL OR EXISTS (
    SELECT 1 FROM admin_audit
    WHERE action='video_config.update' AND instr(details,'"keyChanged":true') > 0
  )
);
`)
const generationColumns = db.prepare('PRAGMA table_info(generations)').all()
if (!generationColumns.some((column) => column.name === 'request_hash')) {
  db.exec('ALTER TABLE generations ADD COLUMN request_hash TEXT')
}
if (!generationColumns.some((column) => column.name === 'kind')) {
  db.exec("ALTER TABLE generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
}
const mediaColumns = db.prepare('PRAGMA table_info(media)').all()
if (!mediaColumns.some((column) => column.name === 'data')) db.exec('ALTER TABLE media ADD COLUMN data BLOB')
const canvasColumns = db.prepare('PRAGMA table_info(canvases)').all()
if (!canvasColumns.some((column) => column.name === 'version')) {
  db.exec('ALTER TABLE canvases ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
}
const userColumns = db.prepare('PRAGMA table_info(users)').all()
if (!userColumns.some((column) => column.name === 'admin_password_encrypted')) {
  db.exec('ALTER TABLE users ADD COLUMN admin_password_encrypted TEXT')
}
if (!userColumns.some((column) => column.name === 'image_api_key_encrypted')) {
  db.exec('ALTER TABLE users ADD COLUMN image_api_key_encrypted TEXT')
}
if (!userColumns.some((column) => column.name === 'login_failures')) {
  db.exec('ALTER TABLE users ADD COLUMN login_failures INTEGER NOT NULL DEFAULT 0')
}
if (!userColumns.some((column) => column.name === 'login_failure_started_at')) {
  db.exec('ALTER TABLE users ADD COLUMN login_failure_started_at TEXT')
}
if (!userColumns.some((column) => column.name === 'login_locked_until')) {
  db.exec('ALTER TABLE users ADD COLUMN login_locked_until TEXT')
}
if (!userColumns.some((column) => column.name === 'session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0')
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

export function checkDatabase() {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('UPDATE health_probe SET value=1-value WHERE id=1').run()
    if (!result.changes) throw new Error('SQLite health probe row is missing')
    db.exec('ROLLBACK')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
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

export function recoverPendingGenerations(minAgeMs = 0, videoMinAgeMs = minAgeMs) {
  return transaction(() => {
    const minimumAgeSeconds = Math.max(0, Math.ceil(minAgeMs / 1000))
    const videoMinimumAgeSeconds = Math.max(0, Math.ceil(videoMinAgeMs / 1000))
    const pending = db.prepare("SELECT id,user_id,reserved,kind FROM generations WHERE status='pending' AND ((kind='video' AND created_at <= datetime('now', ?)) OR (kind<>'video' AND created_at <= datetime('now', ?)))")
      .all(`-${videoMinimumAgeSeconds} seconds`, `-${minimumAgeSeconds} seconds`)
    let recovered = 0
    for (const item of pending) {
      const result = db.prepare("UPDATE generations SET status='failed' WHERE id=? AND status='pending'").run(item.id)
      if (!result.changes) continue
      if (Number(item.reserved) > 0) changeBalance(item.user_id, Number(item.reserved), 'ai_refund', item.id, '服务重启，AI 预占积分退回')
      recovered += 1
    }
    return recovered
  })
}
