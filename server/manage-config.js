import 'dotenv/config'
import { createDecipheriv, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db, transaction } from './db.js'

const fail = (message) => { throw new Error(message) }
const jwtSecret = process.env.JWT_SECRET || ''
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) fail('JWT_SECRET 必须至少包含 32 字节')
const adminLoginKey = createHash('sha256').update(`admin-login:${jwtSecret}`).digest()

function readFields(count) {
  const fields = readFileSync(0).toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length !== count) fail('维护输入格式无效')
  return fields
}

function normalizeRelay(baseInput, modelsInput) {
  if ([baseInput, modelsInput].some((value) => value.includes('\n') || value.includes('\r'))) fail('中转配置不能包含换行符')
  let baseUrl = baseInput.trim().replace(/\/+$/, '')
  if (baseUrl.length > 2000) fail('中转站地址过长')
  if (baseUrl) {
    let url
    try { url = new URL(baseUrl) } catch { fail('中转站地址无效') }
    if (!['http:', 'https:'].includes(url.protocol)) fail('中转站地址必须使用 HTTP 或 HTTPS')
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') fail('生产环境的中转站地址必须使用 HTTPS')
    if (url.username || url.password) fail('中转站地址不能包含用户名或密码')
    if (url.search || url.hash) fail('中转站地址不能包含查询参数或片段')
    baseUrl = url.toString().replace(/\/+$/, '')
  }
  const models = [...new Set(modelsInput.split(',').map((item) => item.trim()).filter(Boolean))]
  if (!models.length || models.length > 50 || models.some((model) => model.length > 100)) fail('中转模型列表无效')
  return { baseUrl, models }
}

function updateRelay(kind) {
  const columns = {
    text: ['ai_base_url', 'ai_models'],
    image: ['ai_image_base_url', 'ai_image_models'],
    video: ['ai_video_base_url', 'ai_video_models'],
  }[kind]
  if (!columns) fail('未知的中转类型')
  const [baseInput, modelsInput] = readFields(2)
  const { baseUrl, models } = normalizeRelay(baseInput, modelsInput)
  transaction(() => {
    db.prepare(`UPDATE app_settings SET ${columns[0]}=?,${columns[1]}=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
      .run(baseUrl || null, JSON.stringify(models))
  })
}

function updateVideoPoints(raw) {
  if (!/^[0-9]+$/.test(raw) || raw.length > 7) fail('视频积分消耗无效')
  const points = Number(raw)
  if (!Number.isInteger(points) || points < 1 || points > 1000000) fail('视频积分消耗无效')
  db.prepare('UPDATE app_settings SET ai_video_points=?,updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(points)
}

function adminStatus() {
  const admins = db.prepare("SELECT email,admin_password_encrypted FROM users WHERE role='admin' ORDER BY created_at,id").all()
  if (!admins.length) {
    return '管理员账号：尚未创建\n管理员密码：尚未设置；请在注册页填写密码，并使用第 17 项查看初始化令牌\n'
  }
  return admins.map((admin) => {
    let password = '不可查看；旧账号需在账户安全中修改一次密码后同步'
    if (admin.admin_password_encrypted) {
      try {
        const [iv, tag, encrypted] = admin.admin_password_encrypted.split('.').map((part) => Buffer.from(part, 'base64'))
        const decipher = createDecipheriv('aes-256-gcm', adminLoginKey, iv)
        decipher.setAuthTag(tag)
        const value = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
        password = JSON.stringify(value)
      } catch { password = '无法用当前 JWT_SECRET 解密；请修改一次密码后同步' }
    }
    return `管理员账号：${admin.email}\n管理员密码：${password}`
  }).join('\n') + '\n'
}

try {
  const command = process.argv[2]
  let output = '配置已更新。\n'
  if (command === 'relay') updateRelay(process.argv[3])
  else if (command === 'video-points') updateVideoPoints(process.argv[3] || '')
  else if (command === 'admin-status') output = adminStatus()
  else fail('未知的维护命令')
  db.close()
  process.stdout.write(output)
} catch (error) {
  try { db.close() } catch {}
  process.stderr.write(`配置更新失败：${error.message}\n`)
  process.exitCode = 1
}
