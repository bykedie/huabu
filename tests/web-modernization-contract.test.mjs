import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const appSource = readFileSync(join(root, 'src', 'App.tsx'), 'utf8')
const manager = readFileSync(join(root, 'deploy', 'manage.sh'), 'utf8')
const envExample = readFileSync(join(root, '.env.example'), 'utf8')
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')

test('web UI exposes API keys instead of wallet, recharge, and point surfaces', () => {
  assert.equal(appSource.includes("setPanel('wallet')"), false)
  assert.equal(appSource.includes("panel === 'wallet'"), false)
  assert.equal(appSource.includes('className="points-button"'), false)
  assert.equal(appSource.includes('className="api-key-button"'), true)
  assert.equal(appSource.includes("onClick={() => setPanel('account')}"), true)
  assert.equal(appSource.includes('<KeyRound size={16} />API 密钥'), true)

  const sidebarStart = appSource.indexOf("<div className={'sidebar-account'}>")
  const sidebarEnd = appSource.indexOf('</aside>', sidebarStart)
  assert.notEqual(sidebarStart, -1)
  const sidebarSource = appSource.slice(sidebarStart, sidebarEnd)
  assert.equal(sidebarSource.includes('balance'), false)
  assert.equal(sidebarSource.includes('积分'), false)

  const adminStart = appSource.indexOf('function AdminDrawer')
  const adminEnd = appSource.indexOf('function nodeKindIcon', adminStart)
  const adminSource = appSource.slice(adminStart, adminEnd)
  for (const obsolete of ['/admin/codes', '/admin/topups', '生成兑换码', '充值审核', '待审核']) {
    assert.equal(adminSource.includes(obsolete), false, obsolete)
  }
  for (const obsolete of ['生成视频 ·', '消耗 ', '未重复扣分', '积分余额']) {
    assert.equal(appSource.includes(obsolete), false, obsolete)
  }
})

test('operations discovers and explicitly selects text, image, and video models', () => {
  for (const kind of ['text', 'image', 'video']) {
    assert.equal(appSource.includes('/admin/' + kind + '-config/models'), true, kind)
  }
  for (const kind of ['Text', 'Image', 'Video']) {
    assert.match(appSource, new RegExp('setDiscovered' + kind + 'Models\\(result\\.models\\)[\\s\\S]*?set' + kind + 'Models\\(\\[\\]\\)'))
  }
})

test('canvas rename has a visible single-click and touch entry', () => {
  const renameStart = appSource.indexOf('title="修改画布名称"')
  assert.notEqual(renameStart, -1)
  const renameSource = appSource.slice(renameStart, renameStart + 400)
  assert.equal(renameSource.includes('onClick='), true)
  assert.equal(renameSource.includes('<Pencil size={14} />'), true)
  const renameInputStart = appSource.indexOf('className="canvas-name canvas-name-input"')
  assert.notEqual(renameInputStart, -1)
  const renameInputSource = appSource.slice(renameInputStart, renameInputStart + 800)
  assert.match(renameInputSource, /event\.key === 'Enter'[^}]*event\.preventDefault\(\); finishCanvasTitleEditing\(\)/)
  assert.doesNotMatch(renameInputSource, /event\.key === 'Enter'[^}]*event\.currentTarget\.blur\(\)/)
  assert.equal(appSource.includes('title="双击修改画布名称"'), false)
})

test('h no longer configures relays and deployment defaults contain no preset models or billing', () => {
  for (const obsolete of ['configure_relay', '配置文字中转', '配置图片中转', '配置视频中转', 'server/manage-config.js relay']) {
    assert.equal(manager.includes(obsolete), false, obsolete)
  }
  assert.equal(manager.includes('5 安全更新 Git 代码'), true)
  assert.equal(manager.includes('8 配置商业参数与配额'), true)

  assert.match(envExample, /^SITE_BILLING_ENABLED=0$/m)
  assert.match(envExample, /^AI_MODELS=$/m)
  assert.match(envExample, /^AI_IMAGE_MODELS=$/m)
  assert.equal(compose.includes('SITE_BILLING_ENABLED: "\${SITE_BILLING_ENABLED:-0}"'), true)
  assert.equal(compose.includes('AI_MODELS: "\${AI_MODELS:-}"'), true)
  assert.equal(compose.includes('AI_IMAGE_MODELS: "\${AI_IMAGE_MODELS:-}"'), true)
})
