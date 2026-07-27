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
} finally {
  db.close()
}
