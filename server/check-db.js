import { DatabaseSync } from 'node:sqlite'

const databasePath = process.argv[2]
if (!databasePath) throw new Error('请提供数据库路径')

const db = new DatabaseSync(databasePath)
try {
  const result = db.prepare('PRAGMA quick_check').get()
  if (result.quick_check !== 'ok') throw new Error(`SQLite 校验失败：${result.quick_check}`)
} finally {
  db.close()
}
