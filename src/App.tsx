import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  addEdge, Background, BackgroundVariant, BaseEdge, Connection, Controls, Edge, EdgeLabelRenderer, EdgeProps, getBezierPath, Handle, MiniMap,
  EdgeChange, Node, NodeChange, NodeProps, Position, ReactFlow, ReactFlowInstance,
  useEdgesState, useNodesState,
} from '@xyflow/react'
import {
  Bot, Check, ChevronLeft, CircleDollarSign, Download, FilePlus2, Image, LayoutDashboard,
  KeyRound, LogOut, Menu, Plus, Save, Settings, StickyNote, Text, Trash2, X,
  Upload,
} from 'lucide-react'
import { api, ApiError, session, User } from './api'

type CanvasData = {
  kind: 'note' | 'text' | 'ai' | 'image'
  title?: string
  content?: string
  prompt?: string
  imageUrl?: string
  busy?: boolean
  onChange?: (id: string, patch: Partial<CanvasData>) => void
  onRun?: (id: string, prompt: string) => void
  onRunImage?: (id: string, prompt: string) => void
}
type CanvasNode = Node<CanvasData>
type CanvasInfo = {
  id: string
  name: string
  version: number
  updated_at?: string
  document?: { nodes: CanvasNode[]; edges: Edge[] }
}
type Notice = { type: 'ok' | 'error'; text: string } | null
type CanvasDraft = { baseVersion: number; name: string; nodes: CanvasNode[]; edges: Edge[] }
const uid = () => crypto.randomUUID()
const draftKey = (userId: string, canvasId: string) => `ink-draft:${userId}:${canvasId}`
function makeDraft(baseVersion: number, name: string, nodes: CanvasNode[], edges: Edge[]): CanvasDraft {
  return {
    baseVersion,
    name,
    nodes: nodes.map((node) => {
      const { selected: _selected, dragging: _dragging, measured: _measured, ...persistedNode } = node
      return { ...persistedNode, data: { kind: node.data.kind, title: node.data.title, content: node.data.content, prompt: node.data.prompt, imageUrl: node.data.imageUrl } }
    }),
    edges: edges.map((edge) => {
      const { selected: _selected, ...persistedEdge } = edge
      return persistedEdge
    }),
  }
}
function parseDraft(value: unknown): CanvasDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<string, unknown>
  if (!Number.isInteger(draft.baseVersion) || typeof draft.name !== 'string' || draft.name.length > 80 || !Array.isArray(draft.nodes) || draft.nodes.length > 1000 || !Array.isArray(draft.edges) || draft.edges.length > 2000) return null
  const kinds = new Set<CanvasData['kind']>(['note', 'text', 'ai', 'image'])
  const nodes: CanvasNode[] = []
  for (const value of draft.nodes) {
    if (!value || typeof value !== 'object') return null
    const node = value as Record<string, unknown>
    const position = node.position as Record<string, unknown> | undefined
    const data = node.data as Record<string, unknown> | undefined
    if (typeof node.id !== 'string' || !node.id || node.id.length > 200 || !position || typeof position.x !== 'number' || !Number.isFinite(position.x) || typeof position.y !== 'number' || !Number.isFinite(position.y) || !data || !kinds.has(data.kind as CanvasData['kind'])) return null
    const textFields = ['title', 'content', 'prompt', 'imageUrl'] as const
    if (textFields.some((field) => data[field] !== undefined && typeof data[field] !== 'string')) return null
    nodes.push({
      id: node.id,
      type: 'canvasNode',
      position: { x: position.x, y: position.y },
      data: { kind: data.kind as CanvasData['kind'], ...Object.fromEntries(textFields.filter((field) => typeof data[field] === 'string').map((field) => [field, data[field]])) },
    })
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) return null
  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  for (const value of draft.edges) {
    if (!value || typeof value !== 'object') return null
    const edge = value as Record<string, unknown>
    if (typeof edge.id !== 'string' || !edge.id || edge.id.length > 200 || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null
    if (edgeIds.has(edge.id)) return null
    if ((edge.sourceHandle !== undefined && edge.sourceHandle !== null && typeof edge.sourceHandle !== 'string') || (edge.targetHandle !== undefined && edge.targetHandle !== null && typeof edge.targetHandle !== 'string')) return null
    edges.push({ id: edge.id, source: edge.source, target: edge.target, type: 'bezier', sourceHandle: edge.sourceHandle as string | null | undefined, targetHandle: edge.targetHandle as string | null | undefined })
    edgeIds.add(edge.id)
  }
  return { baseVersion: draft.baseVersion as number, name: draft.name, nodes, edges }
}
function readDraft(userId: string, canvasId: string): CanvasDraft | null {
  try {
    return parseDraft(JSON.parse(localStorage.getItem(draftKey(userId, canvasId)) || 'null'))
  } catch { return null }
}
async function aiRequestKey(canvasId: string, nodeId: string, prompt: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const storageKey = `ink-ai:${canvasId}:${nodeId}:${hash}`
  const requestKey = localStorage.getItem(storageKey) || uid()
  localStorage.setItem(storageKey, requestKey)
  return { requestKey, storageKey }
}

function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const icon = data.kind === 'ai' ? <Bot size={15} /> : data.kind === 'image' ? <Image size={15} /> : data.kind === 'note' ? <StickyNote size={15} /> : <Text size={15} />
  return (
    <article className={`canvas-node kind-${data.kind} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <header>{icon}<input className="node-title nodrag" aria-label="节点标题" value={data.title || ''} onChange={(event) => data.onChange?.(id, { title: event.target.value })} /></header>
      {data.kind === 'image' ? (
        <div className="image-body">
          {data.imageUrl && <img src={data.imageUrl} alt={data.title || '画布图片'} />}
          <input className="node-input nodrag" placeholder="粘贴图片地址" value={data.imageUrl || ''} onChange={(event) => data.onChange?.(id, { imageUrl: event.target.value })} />
        </div>
      ) : data.kind === 'ai' ? (
        <div className="ai-body">
          <textarea className="nodrag nowheel" placeholder="告诉 AI 你想探索什么…" value={data.prompt || ''} onChange={(event) => data.onChange?.(id, { prompt: event.target.value })} />
          {data.content && <div className="ai-answer">{data.content}</div>}
          <div className="node-actions"><button className="node-run nodrag" disabled={data.busy || !data.prompt?.trim()} onClick={() => data.onRun?.(id, data.prompt || '')}>{data.busy ? '思考中…' : <><Bot size={14} />文字</>}</button><button className="node-run image-run nodrag" disabled={data.busy || !data.prompt?.trim()} onClick={() => data.onRunImage?.(id, data.prompt || '')}>{data.busy ? '生成中…' : <><Image size={14} />生图</>}</button></div>
        </div>
      ) : (
        <textarea className="node-content nodrag nowheel" placeholder="写点什么…" value={data.content || ''} onChange={(event) => data.onChange?.(id, { content: event.target.value })} />
      )}
      <Handle type="source" position={Position.Right} />
    </article>
  )
}

function CanvasEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <><BaseEdge id={id} path={path} /><EdgeLabelRenderer><button className="edge-delete nodrag" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }} title="删除连接" aria-label="删除连接" onClick={() => (data as { onDelete?: (id: string) => void } | undefined)?.onDelete?.(id)}>×</button></EdgeLabelRenderer></>
}

function Auth({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget))
      const result = await api<{ token: string; user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) })
      session.set(result.token)
      onDone(result.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-hidden="true">
        <div className="visual-grid" />
        <div className="visual-node visual-a"><StickyNote size={18} /><span>梳理创意</span></div>
        <div className="visual-node visual-b"><Bot size={18} /><span>让 AI 延展思路</span></div>
        <div className="visual-node visual-c"><Image size={18} /><span>收集视觉参考</span></div>
        <svg viewBox="0 0 600 500"><path d="M180 170 C270 170 250 270 350 270 M350 270 C420 270 405 365 470 365" /></svg>
        <div className="brand-lockup"><div className="brand-mark">墨</div><strong>墨屿画布</strong><p>把散落的想法，连成可以生长的地图。</p></div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <div className="mobile-brand"><div className="brand-mark">墨</div><strong>墨屿画布</strong></div>
          <span className="eyebrow">INFINITE WORKSPACE</span>
          <h1>{mode === 'login' ? '回到你的画布' : '创建创作空间'}</h1>
          <p>{mode === 'login' ? '继续整理灵感、素材和 AI 对话。' : '注册后即可创建画布，站长可使用初始化码创建管理员。'}</p>
          {mode === 'register' && <label>昵称<input name="name" minLength={2} maxLength={30} required placeholder="你的称呼" /></label>}
          <label>邮箱<input name="email" type="email" required placeholder="name@example.com" /></label>
          <label>密码<input name="password" type="password" minLength={8} required placeholder="至少 8 位" /></label>
          {mode === 'register' && <label>管理员初始化码（可选）<input name="setupToken" type="password" autoComplete="off" placeholder="仅站长首次注册时填写" /></label>}
          {error && <div className="form-error">{error}</div>}
          <button className="primary full" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</button>
          <button type="button" className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button>
        </form>
      </section>
    </main>
  )
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const drawerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose
  useEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    const focusFirst = () => (drawer.querySelector<HTMLElement>(focusableSelector) || drawer).focus()
    const frame = window.requestAnimationFrame(focusFirst)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) {
        event.preventDefault()
        drawer.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [])
  return <><div className="drawer-backdrop" aria-hidden="true" onClick={onClose} /><aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X size={19} /></button></header>{children}</aside></>
}

function WalletDrawer({ user, refresh, close, notify }: { user: User; refresh: () => Promise<void>; close: () => void; notify: (notice: Notice) => void }) {
  type Entry = { id: string; amount: number; note: string; created_at: string }
  type TopupOrder = { id: string; amount_cents: number; points: number; status: 'pending' | 'approved' | 'rejected' }
  const [ledger, setLedger] = useState<Entry[]>([])
  const [orders, setOrders] = useState<TopupOrder[]>([])
  const [config, setConfig] = useState({ centsPerPoint: 1, topupInstructions: '' })
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState(10)
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const load = useCallback(async () => {
    const [wallet, topups, publicConfig] = await Promise.all([
      api<{ ledger: Entry[] }>('/wallet'),
      api<{ orders: TopupOrder[] }>('/topups'),
      api<{ centsPerPoint: number; topupInstructions: string }>('/config'),
    ])
    setLedger(wallet.ledger)
    setOrders(topups.orders)
    setConfig(publicConfig)
  }, [])
  useEffect(() => { void load().catch((err) => notify({ type: 'error', text: err.message })) }, [load, notify])
  async function redeem() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let committed = false
    try {
      await api('/redeem', { method: 'POST', body: JSON.stringify({ code }) })
      committed = true
      setCode('')
      await load()
      await refresh()
      notify({ type: 'ok', text: '兑换成功，积分已到账' })
    } catch (err) { notify({ type: 'error', text: committed ? '兑换已成功，但账户信息刷新失败，请重新打开积分账户' : (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  async function topup() {
    if (busyRef.current || !Number.isFinite(amount) || amount < 1 || amount > 100000 || proof.trim().length < 4) return
    busyRef.current = true
    setBusy(true)
    let committed = false
    try {
      await api('/topups', { method: 'POST', body: JSON.stringify({ amountCents: Math.round(amount * 100), proof }) })
      committed = true
      setProof('')
      await load()
      notify({ type: 'ok', text: '充值申请已提交，等待管理员审核' })
    } catch (err) { notify({ type: 'error', text: committed ? '充值申请已提交，但记录刷新失败，请重新打开积分账户' : (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  const statusText = { pending: '待审核', approved: '已到账', rejected: '已驳回' }
  const estimatedPoints = Number.isFinite(amount) && amount >= 0 ? Math.floor(amount * 100 / config.centsPerPoint) : 0
  return <Drawer title="积分账户" onClose={close}>
    <div className="balance-band"><span>可用积分</span><strong>{user.balance.toLocaleString()}</strong><small>AI 调用按实际用量结算</small></div>
    <section className="drawer-section"><h3>兑换积分</h3><div className="inline-form"><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="输入兑换码" /><button className="primary" onClick={redeem} disabled={busy || !code.trim()}>兑换</button></div></section>
    <section className="drawer-section"><h3>充值申请</h3>{config.topupInstructions ? <p className="payment-instructions">{config.topupInstructions}</p> : <p className="muted">管理员尚未配置收款方式，暂时可使用兑换码充值。</p>}<label>充值金额（元）<input type="number" min={1} max={100000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><p className="muted">预计到账 {estimatedPoints.toLocaleString()} 积分</p><label>付款交易单号<input value={proof} minLength={4} maxLength={100} required onChange={(event) => setProof(event.target.value)} placeholder="填写唯一的微信或支付宝交易单号" /></label><button className="secondary" onClick={topup} disabled={busy || !config.topupInstructions || !Number.isFinite(amount) || amount < 1 || amount > 100000 || proof.trim().length < 4}>提交审核</button><p className="muted">当前采用人工审核，管理员确认收款后积分到账。</p></section>
    {orders.length > 0 && <section className="drawer-section"><h3>充值记录</h3><div className="topup-history">{orders.slice(0, 10).map((order) => <div key={order.id}><span>¥{(order.amount_cents / 100).toFixed(2)} · {order.points.toLocaleString()} 积分</span><strong className={order.status}>{statusText[order.status]}</strong></div>)}</div></section>}
    <section className="drawer-section"><h3>最近明细</h3><div className="ledger">{ledger.map((item) => <div key={item.id}><span>{item.note || '积分变动'}<small>{new Date(item.created_at + 'Z').toLocaleString()}</small></span><strong className={item.amount > 0 ? 'gain' : 'cost'}>{item.amount > 0 ? '+' : ''}{item.amount}</strong></div>)}</div></section>
  </Drawer>
}

function AccountDrawer({ user, close, notify }: { user: User; close: () => void; notify: (notice: Notice) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('currentPassword') || '')
    const newPassword = String(form.get('newPassword') || '')
    if (newPassword !== String(form.get('confirmation') || '')) { setError('两次输入的新密码不一致'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api<{ token: string; user: User }>('/auth/password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
      })
      session.set(result.token)
      close()
      notify({ type: 'ok', text: '密码已更新，其他设备需要重新登录' })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Drawer title={'账户安全'} onClose={close}>
    <section className={'drawer-section'}><h3>登录账号</h3><p className={'account-email'}>{user.email}</p></section>
    <form className={'drawer-section'} onSubmit={changePassword}><h3>修改密码</h3>
      <label>当前密码<input name={'currentPassword'} type={'password'} minLength={8} maxLength={72} autoComplete={'current-password'} required /></label>
      <label>新密码<input name={'newPassword'} type={'password'} minLength={8} maxLength={72} autoComplete={'new-password'} required /></label>
      <label>确认新密码<input name={'confirmation'} type={'password'} minLength={8} maxLength={72} autoComplete={'new-password'} required /></label>
      {error && <div className={'form-error'} role={'alert'}>{error}</div>}
      <button className={'primary full'} disabled={busy}><KeyRound size={17} />{busy ? '正在更新' : '更新密码'}</button>
      <p className={'muted'}>更新后，其他设备上的登录会立即失效。</p>
    </form>
  </Drawer>
}

function AdminDrawer({ close, notify, refresh }: { close: () => void; notify: (notice: Notice) => void; refresh: () => Promise<void> }) {
  type Order = { id: string; email: string; amount_cents: number; points: number; status: string; proof?: string }
  type AuditEntry = { id: string; action: string; target_id?: string; actor_email: string; details: Record<string, string | number | null>; created_at: string }
  type AdminData = { stats: Record<string, number>; orders: Order[]; audit: AuditEntry[]; ai: { configured: boolean; keyConfigured: boolean; baseUrl: string; models: string[]; source: string } }
  const [data, setData] = useState<AdminData | null>(null)
  const [points, setPoints] = useState(100)
  const [count, setCount] = useState(1)
  const [codes, setCodes] = useState<string[]>([])
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiModels, setAiModels] = useState('gpt-4o-mini')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const load = useCallback(() => api<AdminData>('/admin/overview').then((result) => {
    setData(result)
    setAiBaseUrl(result.ai.baseUrl)
    setAiModels(result.ai.models.join(', '))
  }), [])
  useEffect(() => { void load().catch((err) => notify({ type: 'error', text: err.message })) }, [load, notify])
  async function createCodes() {
    if (busyRef.current || !Number.isInteger(points) || points < 1 || points > 10000000 || !Number.isInteger(count) || count < 1 || count > 100) return
    if (codes.length && !window.confirm('新生成的兑换码会替换当前显示的明文码。确认已保存当前兑换码吗？')) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api<{ codes: string[] }>('/admin/codes', { method: 'POST', body: JSON.stringify({ points, count, maxUses: 1, label: '后台生成' }) })
      setCodes(result.codes)
      await load()
      notify({ type: 'ok', text: `已生成 ${result.codes.length} 个兑换码` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  async function saveAIConfig(clearApiKey = false) {
    if (busyRef.current) return
    const models = aiModels.split(',').map((item) => item.trim()).filter(Boolean)
    if (!models.length) return notify({ type: 'error', text: '请至少填写一个模型' })
    if (clearApiKey && !window.confirm('确认清除后台保存的密钥？如果服务器 .env 中有密钥，将自动使用该密钥。')) return
    busyRef.current = true
    setBusy(true)
    try {
      await api('/admin/ai-config', { method: 'PUT', body: JSON.stringify({ baseUrl: aiBaseUrl, apiKey: aiApiKey || undefined, clearApiKey, models }) })
      setAiApiKey('')
      await load()
      notify({ type: 'ok', text: clearApiKey ? '已清除后台保存的密钥' : 'AI 中转配置已保存' })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  async function testAIConfig() {
    if (busyRef.current) return
    const models = aiModels.split(',').map((item) => item.trim()).filter(Boolean)
    const model = models[0]
    if (!aiBaseUrl.trim() || !model) return notify({ type: 'error', text: '请先填写中转站地址和模型' })
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api<{ reply: string }>('/admin/ai-config/test', { method: 'POST', body: JSON.stringify({ baseUrl: aiBaseUrl, apiKey: aiApiKey || undefined, model }) })
      notify({ type: 'ok', text: `中转测试成功：${result.reply || '上游已响应'}` })
    } catch (err) { notify({ type: 'error', text: (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  function closeAdmin() {
    if (busyRef.current) {
      notify({ type: 'error', text: '操作正在处理中，请等待完成后再关闭' })
      return
    }
    if (codes.length && !window.confirm('兑换码明文关闭后无法再次查看。确认已经保存了吗？')) return
    close()
  }
  function downloadCodes() {
    if (!codes.length) return
    const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `redeem-codes-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function review(order: Order, action: 'approve' | 'reject') {
    if (busyRef.current) return
    const verb = action === 'approve' ? '通过' : '驳回'
    if (!window.confirm(`${verb} ${order.email} 的充值申请？\n金额：¥${(order.amount_cents / 100).toFixed(2)}\n积分：${order.points}\n交易单号：${order.proof || '未填写'}`)) return
    busyRef.current = true
    setBusy(true)
    let committed = false
    try {
      await api(`/admin/topups/${order.id}/${action}`, { method: 'POST' })
      committed = true
      await load()
      if (action === 'approve') await refresh()
      notify({ type: 'ok', text: action === 'approve' ? '积分已到账' : '订单已驳回' })
    } catch (err) { notify({ type: 'error', text: committed ? '订单已处理，但界面刷新失败，请重新打开运营管理' : (err as Error).message }) } finally { busyRef.current = false; setBusy(false) }
  }
  const pending = data?.orders.filter((order) => order.status === 'pending') || []
  const auditText = (entry: AuditEntry) => entry.action === 'ai_config.update'
    ? '更新 AI 中转配置'
    : entry.action === 'codes.create'
    ? `生成 ${entry.details.count} 个兑换码 · 每码 ${entry.details.points} 积分`
    : `${entry.action === 'topup.approve' ? '通过' : '驳回'}充值 · ¥${(Number(entry.details.amountCents) / 100).toFixed(2)} · ${entry.details.points} 积分`
  return <Drawer title="运营管理" onClose={closeAdmin}>
    {data && <><div className="stats-row"><div><span>用户</span><strong>{data.stats.users}</strong></div><div><span>画布</span><strong>{data.stats.canvases}</strong></div><div><span>待审核</span><strong>{data.stats.pendingTopups}</strong></div></div><div className={`config-status ${data.ai.configured ? 'ready' : ''}`}><span>{data.ai.configured ? <Check size={16} /> : <Settings size={16} />}{data.ai.configured ? 'AI 中转已配置' : 'AI 中转待配置'}</span><small>{data.ai.baseUrl || '请在下方设置中转站地址和密钥'}</small></div></>}
    <section className="drawer-section relay-config"><h3>AI 中转配置</h3><label>中转站地址<input type="url" placeholder="https://relay.example.com/v1" value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} disabled={busy} /></label><label>API 密钥<input type="password" placeholder={data?.ai.keyConfigured ? '留空则保持当前密钥' : '输入中转站密钥'} value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} autoComplete="new-password" disabled={busy} /></label><label>开放模型<input value={aiModels} onChange={(event) => setAiModels(event.target.value)} placeholder="gpt-4o-mini, gpt-4.1-mini" disabled={busy} /><small>多个模型使用英文逗号分隔</small></label><div className="relay-actions"><button className="primary" onClick={() => void saveAIConfig()} disabled={busy || !aiBaseUrl.trim() || !aiModels.trim()}><Settings size={16} />保存配置</button><button className="secondary" onClick={() => void testAIConfig()} disabled={busy || !aiBaseUrl.trim() || !aiModels.trim()}><Check size={16} />测试中转</button>{data?.ai.keyConfigured && <button className="secondary danger-text" onClick={() => void saveAIConfig(true)} disabled={busy}>清除密钥</button>}</div><small>测试只发送一条最小请求，不扣除用户积分，也不会保存临时密钥。</small></section>
    <section className="drawer-section"><h3>生成兑换码</h3><div className="two-cols"><label>每码积分<input type="number" min={1} max={10000000} value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label><label>生成数量<input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></div><button className="secondary" onClick={createCodes} disabled={busy || !Number.isInteger(points) || points < 1 || points > 10000000 || !Number.isInteger(count) || count < 1 || count > 100}>生成兑换码</button>{codes.length > 0 && <div className="codes-result"><textarea className="codes-output" aria-label="新生成的兑换码" readOnly value={codes.join(String.fromCharCode(10))} /><button className="secondary" onClick={downloadCodes}><Download size={16} />下载兑换码</button></div>}</section>
    <section className="drawer-section"><h3>充值审核</h3><div className="orders">{pending.map((order) => <div key={order.id}><span><strong>{order.email}</strong><small>¥{(order.amount_cents / 100).toFixed(2)} · {order.points} 积分</small><small>{order.proof || '未填写备注'}</small></span><div><button className="icon-button accept" title="通过" disabled={busy} onClick={() => review(order, 'approve')}><Check size={17} /></button><button className="icon-button" title="驳回" disabled={busy} onClick={() => review(order, 'reject')}><X size={17} /></button></div></div>)}{pending.length === 0 && <p className="muted">暂无待审核订单</p>}</div></section>
    <section className="drawer-section"><h3>操作审计</h3><div className="audit-list">{data?.audit.map((entry) => <div key={entry.id}><strong>{auditText(entry)}</strong><small>{entry.actor_email} · {new Date(entry.created_at + 'Z').toLocaleString()}</small></div>)}{data?.audit.length === 0 && <p className="muted">暂无后台操作记录</p>}</div></section>
  </Drawer>
}

function Workspace({ user, setUser }: { user: User; setUser: (user: User | null) => void }) {
  const [canvases, setCanvases] = useState<CanvasInfo[]>([])
  const canvasesRef = useRef<CanvasInfo[]>([])
  const [current, setCurrent] = useState<CanvasInfo | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [panel, setPanel] = useState<'account' | 'wallet' | 'admin' | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [creatingCanvas, setCreatingCanvas] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [blockedReason, setBlockedReason] = useState<'session' | 'conflict' | 'storage' | 'deleted' | null>(null)
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const aiInFlight = useRef(0)
  const aiNodesInFlight = useRef(new Set<string>())
  const resolvedAIKeys = useRef(new Map<string, number>())
  const creatingCanvasRef = useRef(false)
  const revision = useRef(0)
  const persistedRevision = useRef(0)
  const serverVersion = useRef(0)
  const activeCanvasId = useRef<string | null>(null)
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true))
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const deletedCanvasIds = useRef(new Set<string>())
  const openRequest = useRef(0)
  activeCanvasId.current = current?.id || null
  const updateCanvases = useCallback((update: CanvasInfo[] | ((items: CanvasInfo[]) => CanvasInfo[])) => {
    const next = typeof update === 'function' ? update(canvasesRef.current) : update
    canvasesRef.current = next
    setCanvases(next)
    return next
  }, [])

  const refreshUser = useCallback(async () => {
    const result = await api<{ user: User }>('/me')
    setUser(result.user)
  }, [setUser])
  const markDirty = useCallback(() => {
    revision.current += 1
    setSaveState('dirty')
  }, [])
  const updateNode = useCallback((id: string, patch: Partial<CanvasData>) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
    markDirty()
  }, [markDirty, setNodes])
  const setNodeBusy = useCallback((id: string, busy: boolean) => {
    setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, busy } } : node))
  }, [setNodes])
  const runAI = useCallback(async (id: string, prompt: string) => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    aiNodesInFlight.current.add(id)
    aiInFlight.current += 1
    setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, prompt)
      const result = await api<{ content: string; charged: number; cached: boolean }>('/ai/chat', { method: 'POST', body: JSON.stringify({ requestKey, messages: [{ role: 'user', content: prompt }], maxTokens: 1024 }) })
      if (activeCanvasId.current === canvasId) updateNode(id, { busy: false, content: result.content })
      resolvedAIKeys.current.set(storageKey, revision.current)
      await refreshUser()
      setNotice({ type: 'ok', text: result.cached ? '已恢复生成结果，本次未重复扣分' : `生成完成，消耗 ${result.charged} 积分` })
    } catch (err) {
      if (activeCanvasId.current === canvasId) setNodeBusy(id, false)
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      aiNodesInFlight.current.delete(id)
      aiInFlight.current = Math.max(0, aiInFlight.current - 1)
    }
  }, [refreshUser, setNodeBusy, updateNode])
  const runImage = useCallback(async (id: string, prompt: string) => {
    const canvasId = activeCanvasId.current
    if (!canvasId || aiNodesInFlight.current.has(id)) return
    aiNodesInFlight.current.add(id); aiInFlight.current += 1; setNodeBusy(id, true)
    try {
      if (!(await flushRef.current())) throw new Error('请先完成画布保存后再生成')
      const { requestKey, storageKey } = await aiRequestKey(canvasId, id, `image:${prompt}`)
      const result = await api<{ imageUrl: string; charged: number; cached: boolean }>('/ai/image', { method: 'POST', body: JSON.stringify({ requestKey, prompt }) })
      if (activeCanvasId.current === canvasId) {
        const imageNode = nodes.find((node) => node.data.kind === 'image')
        if (imageNode) updateNode(imageNode.id, { imageUrl: result.imageUrl })
        else updateNode(id, { imageUrl: result.imageUrl, kind: 'image', content: '' })
        setNodeBusy(id, false)
      }
      resolvedAIKeys.current.set(storageKey, revision.current); await refreshUser(); setNotice({ type: 'ok', text: result.cached ? '已恢复图片结果' : `图片生成完成，消耗 ${result.charged} 积分` })
    } catch (err) { if (activeCanvasId.current === canvasId) setNodeBusy(id, false); setNotice({ type: 'error', text: (err as Error).message }) } finally { aiNodesInFlight.current.delete(id); aiInFlight.current = Math.max(0, aiInFlight.current - 1) }
  }, [nodes, refreshUser, setNodeBusy, updateNode])
  const deleteEdge = useCallback((id: string) => { setEdges((items) => items.filter((edge) => edge.id !== id)); markDirty() }, [markDirty, setEdges])
  const liveNodes = useMemo(() => nodes.map((node) => ({ ...node, data: { ...node.data, onChange: updateNode, onRun: runAI, onRunImage: runImage } })), [nodes, updateNode, runAI, runImage])
  const liveEdges = useMemo(() => edges.map((edge) => ({ ...edge, type: 'bezier', data: { ...edge.data, onDelete: deleteEdge } })), [deleteEdge, edges])
  const nodeTypes = useMemo(() => ({ canvasNode: CanvasNodeView }), [])
  const edgeTypes = useMemo(() => ({ bezier: CanvasEdgeView }), [])
  const save = useCallback(() => {
    if (!current) return Promise.resolve(true)
    const canvas = { ...current }
    const savedName = canvas.name.trim() || '未命名画布'
    const savedRevision = revision.current
    const draft = makeDraft(serverVersion.current, savedName, nodes, edges)
    const persist = async () => {
      if (deletedCanvasIds.current.has(canvas.id)) return true
      if (activeCanvasId.current === canvas.id) setSaveState('saving')
      try {
        const result = await api<{ version: number }>(`/canvases/${canvas.id}`, { method: 'PUT', body: JSON.stringify({ name: savedName, version: serverVersion.current, document: { nodes: draft.nodes, edges: draft.edges } }) })
        serverVersion.current = result.version
        for (const [key, requiredRevision] of resolvedAIKeys.current) {
          if (!key.startsWith(`ink-ai:${canvas.id}:`) || requiredRevision > savedRevision) continue
          localStorage.removeItem(key)
          resolvedAIKeys.current.delete(key)
        }
        updateCanvases((items) => items.map((item) => item.id === canvas.id ? { ...item, name: savedName, version: result.version } : item))
        if (activeCanvasId.current === canvas.id) {
          setCurrent((item) => item?.id === canvas.id ? {
            ...item,
            ...(revision.current === savedRevision ? { name: savedName } : {}),
            version: result.version,
          } : item)
          persistedRevision.current = Math.max(persistedRevision.current, savedRevision)
          const nextState = revision.current === savedRevision ? 'saved' : 'dirty'
          setSaveState(nextState)
          if (nextState === 'saved') {
            localStorage.removeItem(draftKey(user.id, canvas.id))
            setBlockedReason(null)
          }
        }
        return true
      } catch (err) {
        if (activeCanvasId.current === canvas.id) {
          setSaveState('error')
          if (err instanceof ApiError && err.status === 404) {
            updateCanvases((items) => items.filter((item) => item.id !== canvas.id))
            setBlockedReason('deleted')
          } else if ((err as Error).message.includes('其他页面更新')) setBlockedReason('conflict')
          setNotice({ type: 'error', text: (err as Error).message })
        }
        return false
      }
    }
    saveQueue.current = saveQueue.current.then(persist, persist)
    return saveQueue.current
  }, [current, edges, nodes, updateCanvases, user.id])
  saveRef.current = save
  const flush = useCallback(async () => {
    if (blockedReason === 'session' || blockedReason === 'conflict') return false
    if (blockedReason === 'deleted') return true
    const canvasId = activeCanvasId.current
    if (canvasId && deletedCanvasIds.current.has(canvasId)) return true
    while (canvasId && activeCanvasId.current === canvasId && persistedRevision.current < revision.current) {
      if (!(await saveRef.current())) return false
    }
    return true
  }, [blockedReason])
  flushRef.current = flush

  const openCanvas = useCallback(async (id: string) => {
    try {
      if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再切换画布' }); return }
      if (creatingCanvasRef.current) { setNotice({ type: 'error', text: '请等待画布创建完成' }); return }
      if (id === activeCanvasId.current || deletedCanvasIds.current.has(id)) return
      if (activeCanvasId.current && !(await flushRef.current())) return
      const requestId = ++openRequest.current
      const result = await api<{ canvas: CanvasInfo & { document: { nodes: CanvasNode[]; edges: Edge[] } } }>(`/canvases/${id}`)
      if (requestId !== openRequest.current || deletedCanvasIds.current.has(id)) return
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      const draft = readDraft(user.id, id)
      activeCanvasId.current = id
      serverVersion.current = draft?.baseVersion ?? result.canvas.version
      if (draft) {
        revision.current = 1
        persistedRevision.current = 0
        setCurrent({ ...result.canvas, name: draft.name, version: draft.baseVersion })
        setNodes(draft.nodes)
        setEdges(draft.edges)
        const hasConflict = draft.baseVersion !== result.canvas.version
        setSaveState(hasConflict ? 'error' : 'dirty')
        setBlockedReason(hasConflict ? 'conflict' : null)
        setNotice({ type: hasConflict ? 'error' : 'ok', text: hasConflict ? '服务器已有更新，本地草稿已恢复但不会自动覆盖' : '已恢复本地草稿' })
      } else {
        revision.current = 0
        persistedRevision.current = 0
        setCurrent(result.canvas)
        setNodes(result.canvas.document.nodes)
        setEdges(result.canvas.document.edges)
        setSaveState('saved')
        setBlockedReason(null)
      }
      setSidebar(false)
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [setEdges, setNodes, user.id])
  useEffect(() => {
    api<{ canvases: CanvasInfo[] }>('/canvases').then((result) => {
      updateCanvases(result.canvases)
      if (result.canvases[0]) void openCanvas(result.canvases[0].id)
    }).catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [openCanvas, updateCanvases])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function createCanvas() {
    if (creatingCanvasRef.current) return
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再新建画布' }); return }
    creatingCanvasRef.current = true
    setCreatingCanvas(true)
    try {
      if (activeCanvasId.current && !(await flushRef.current())) return
      const requestId = ++openRequest.current
      const result = await api<{ canvas: CanvasInfo }>('/canvases', { method: 'POST', body: JSON.stringify({ name: '未命名画布' }) })
      updateCanvases((items) => items.some((item) => item.id === result.canvas.id) ? items : [result.canvas, ...items])
      if (!(await flushRef.current()) || requestId !== openRequest.current) return
      const first: CanvasNode = { id: uid(), type: 'canvasNode', position: { x: 80, y: 80 }, data: { kind: 'note', title: '欢迎来到墨屿', content: '从左侧添加内容，拖动画布探索空间。节点会自动保存。' } }
      activeCanvasId.current = result.canvas.id
      serverVersion.current = result.canvas.version
      revision.current = 1
      persistedRevision.current = 0
      setCurrent(result.canvas)
      setNodes([first])
      setEdges([])
      setSaveState('dirty')
      setBlockedReason(null)
    } catch (err) {
      setNotice({ type: 'error', text: (err as Error).message })
    } finally {
      creatingCanvasRef.current = false
      setCreatingCanvas(false)
    }
  }
  async function deleteCanvas(id: string) {
    if (deletedCanvasIds.current.has(id)) return
    if (creatingCanvasRef.current) { setNotice({ type: 'error', text: '请等待画布创建完成后再删除' }); return }
    if (id === activeCanvasId.current && aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再删除画布' }); return }
    if (!window.confirm('确定删除这张画布吗？此操作无法撤销。')) return
    ++openRequest.current
    deletedCanvasIds.current.add(id)
    try {
      await saveQueue.current
      await api(`/canvases/${id}`, { method: 'DELETE' })
      localStorage.removeItem(draftKey(user.id, id))
    } catch (err) {
      deletedCanvasIds.current.delete(id)
      setNotice({ type: 'error', text: (err as Error).message })
      void flushRef.current()
      return
    }
    const remaining = updateCanvases((items) => items.filter((canvas) => canvas.id !== id))
    if (activeCanvasId.current === id) {
      ++openRequest.current
      activeCanvasId.current = null
      revision.current = 0
      persistedRevision.current = 0
      setCurrent(null)
      setNodes([])
      setEdges([])
      const next = remaining.find((canvas) => !deletedCanvasIds.current.has(canvas.id))
      if (next) await openCanvas(next.id)
    }
  }
  useEffect(() => {
    if (saveState !== 'dirty' || !current || blockedReason === 'session' || blockedReason === 'conflict' || blockedReason === 'deleted') return
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
  }, [blockedReason, current, edges, nodes, save, saveState])
  useEffect(() => {
    if (!current || (saveState !== 'dirty' && saveState !== 'error')) return
    try {
      localStorage.setItem(draftKey(user.id, current.id), JSON.stringify(makeDraft(serverVersion.current, current.name, nodes, edges)))
      setBlockedReason((reason) => reason === 'storage' ? null : reason)
    } catch {
      if (session.get()) setBlockedReason('storage')
      setNotice({ type: 'error', text: '本地草稿空间不足，请立即下载草稿备份' })
    }
  }, [current, edges, nodes, saveState, user.id])

  function addNode(kind: CanvasData['kind']) {
    const center = flow.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 200, y: 150 }
    const title = kind === 'ai' ? 'AI 灵感' : kind === 'image' ? '视觉参考' : kind === 'note' ? '便签' : '文本'
    setNodes((items) => {
      const slot = items.length % 6
      const position = { x: center.x + (slot % 3) * 42, y: center.y + Math.floor(slot / 3) * 42 }
      return [...items, { id: uid(), type: 'canvasNode', position, data: { kind, title, content: '' } }]
    })
    markDirty()
  }
  const connect = useCallback((connection: Connection) => {
    setEdges((items) => addEdge({ ...connection, type: 'smoothstep' }, items))
    markDirty()
  }, [markDirty, setEdges])
  const changeNodes = useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes)
    if (changes.some((change) => change.type === 'position' || change.type === 'add' || change.type === 'remove' || change.type === 'replace')) markDirty()
  }, [markDirty, onNodesChange])
  const changeEdges = useCallback((changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes)
    if (changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace')) markDirty()
  }, [markDirty, onEdgesChange])
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (persistedRevision.current >= revision.current && aiInFlight.current === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])
  const logout = useCallback(async () => {
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再退出' }); return }
    if (!(await flushRef.current())) return
    session.clear()
    setUser(null)
  }, [setUser])
  const downloadDraft = useCallback(() => {
    if (!current) return
    const draft = JSON.stringify(makeDraft(serverVersion.current, current.name, nodes, edges), null, 2)
    const url = URL.createObjectURL(new Blob([draft], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${current.name.trim() || '画布'}-本地草稿.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [current, edges, nodes])
  const importDraft = useCallback(async (file: File) => {
    const canvasId = activeCanvasId.current
    if (!current || !canvasId) return
    if (aiInFlight.current > 0) { setNotice({ type: 'error', text: '请等待 AI 生成完成后再导入草稿' }); return }
    if (file.size > 10 * 1024 * 1024) { setNotice({ type: 'error', text: '草稿文件不能超过 10MB' }); return }
    let draft: CanvasDraft | null = null
    try { draft = parseDraft(JSON.parse(await file.text())) } catch {}
    if (!draft) { setNotice({ type: 'error', text: '草稿文件格式无效或内容已损坏' }); return }
    if (!window.confirm(`导入将覆盖当前画布“${current.name}”的内容，确认继续吗？`)) return
    try {
      const result = await api<{ canvas: CanvasInfo }>(`/canvases/${canvasId}`)
      if (activeCanvasId.current !== canvasId || deletedCanvasIds.current.has(canvasId)) return
      ++openRequest.current
      serverVersion.current = result.canvas.version
      revision.current += 1
      persistedRevision.current = Math.min(persistedRevision.current, revision.current - 1)
      setCurrent((item) => item?.id === canvasId ? { ...item, name: draft.name.trim() || '未命名画布', version: result.canvas.version } : item)
      setNodes(draft.nodes)
      setEdges(draft.edges)
      setBlockedReason(null)
      setSaveState('dirty')
      setNotice({ type: 'ok', text: '草稿已导入，正在保存' })
      window.setTimeout(() => flow.current?.fitView({ padding: 0.25 }), 30)
    } catch (err) { setNotice({ type: 'error', text: (err as Error).message }) }
  }, [current, setEdges, setNodes])
  const chooseDraft = useCallback(() => {
    if (!current) return
    if (blockedReason === 'session') { setNotice({ type: 'error', text: '请重新登录后再导入草稿' }); return }
    importInput.current?.click()
  }, [blockedReason, current])
  const discardDraft = useCallback(() => {
    if (!current || !window.confirm('确定放弃本地草稿并加载服务器版本吗？此操作无法撤销。')) return
    localStorage.removeItem(draftKey(user.id, current.id))
    window.location.reload()
  }, [current, user.id])
  const abandonDeletedCanvas = useCallback(() => {
    if (!current || !window.confirm('确定放弃这张已删除画布的本地草稿吗？请先下载需要保留的内容。')) return
    const canvasId = current.id
    localStorage.removeItem(draftKey(user.id, canvasId))
    const remaining = updateCanvases((items) => items.filter((item) => item.id !== canvasId))
    ++openRequest.current
    activeCanvasId.current = null
    revision.current = 0
    persistedRevision.current = 0
    setCurrent(null)
    setNodes([])
    setEdges([])
    setSaveState('saved')
    setBlockedReason(null)
    if (remaining[0]) void openCanvas(remaining[0].id)
  }, [current, openCanvas, setEdges, setNodes, updateCanvases, user.id])
  useEffect(() => session.onClear(() => {
    if (persistedRevision.current >= revision.current && aiInFlight.current === 0) setUser(null)
    else {
      setBlockedReason('session')
      setNotice({ type: 'error', text: '登录已失效；未保存内容已保留在本机' })
    }
  }), [setUser])

  return <main className="workspace">
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark small">墨</div><strong>墨屿</strong><button className="icon-button sidebar-close" title="收起" onClick={() => setSidebar(false)}><ChevronLeft size={18} /></button></div>
      <button className="new-canvas" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button>
      <nav className="canvas-list" aria-label="我的画布">{canvases.map((canvas) => <div className={canvas.id === current?.id ? 'active' : ''} key={canvas.id}><button onClick={() => openCanvas(canvas.id)}><LayoutDashboard size={15} /><span>{canvas.name}</span></button><button className="canvas-delete" title="删除画布" onClick={() => deleteCanvas(canvas.id)}><Trash2 size={14} /></button></div>)}</nav>
      <div className={'sidebar-account'}><button onClick={() => setPanel('account')}><div className={'avatar'}>{user.name.slice(0, 1)}</div><span><strong>{user.name}</strong><small>{user.balance} 积分</small></span></button><button className={'icon-button'} title={'退出登录'} onClick={() => void logout()}><LogOut size={17} /></button></div>
    </aside>
    {sidebar && <button className="sidebar-backdrop" onClick={() => setSidebar(false)} aria-label="关闭侧栏" />}
    <section className="canvas-shell">
      {blockedReason && <div className="workspace-alert" role="alert"><span>{blockedReason === 'session' ? '登录已失效，本地草稿会在重新登录后恢复。' : blockedReason === 'conflict' ? '服务器存在更新，本地草稿未覆盖服务器内容。' : blockedReason === 'deleted' ? '这张画布已在其他页面删除，本地草稿尚未丢失。' : '本地草稿空间不足，请下载备份。'}</span><div><button className="icon-button" title="下载草稿" onClick={downloadDraft}><Download size={17} /></button>{blockedReason !== 'session' && blockedReason !== 'deleted' && <button className="icon-button" title="导入草稿" onClick={chooseDraft}><Upload size={17} /></button>}{blockedReason === 'session' ? <button className="secondary" onClick={() => setUser(null)}>重新登录</button> : blockedReason === 'conflict' ? <button className="secondary" onClick={discardDraft}>使用服务器版本</button> : blockedReason === 'deleted' ? <button className="secondary" onClick={abandonDeletedCanvas}>放弃本地草稿</button> : null}</div></div>}
      <header className="topbar"><button className="icon-button menu-button" title="菜单" onClick={() => setSidebar(true)}><Menu size={19} /></button>{current ? <input className="canvas-name" maxLength={80} value={current.name} onChange={(event) => { setCurrent({ ...current, name: event.target.value }); markDirty() }} aria-label="画布名称" /> : <strong>我的画布</strong>}<div className="top-actions"><span className={`save-state ${saveState}`}>{saveState === 'saving' ? '保存中' : saveState === 'dirty' ? '待保存' : saveState === 'error' ? '保存失败' : <><Check size={13} />已保存</>}</span><button className="points-button" onClick={() => setPanel('wallet')}><CircleDollarSign size={16} />{user.balance}</button>{user.role === 'admin' && <button className="icon-button" title="运营管理" onClick={() => setPanel('admin')}><Settings size={18} /></button>}<button className="icon-button import-button" title="导入草稿" disabled={!current || blockedReason === 'session' || blockedReason === 'deleted'} onClick={chooseDraft}><Upload size={18} /></button><button className="icon-button" title="立即保存" disabled={blockedReason === 'session' || blockedReason === 'conflict' || blockedReason === 'deleted'} onClick={() => void flush()}><Save size={18} /></button></div></header>
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importDraft(file) }} />
      {current ? <div className="flow-wrap">
        <ReactFlow<CanvasNode, Edge> nodes={liveNodes} edges={liveEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={connect} onInit={(instance) => { flow.current = instance }} fitView deleteKeyCode={['Backspace', 'Delete']} minZoom={0.08} maxZoom={3} snapToGrid snapGrid={[16, 16]}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#c9cdd3" />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data?.kind === 'ai' ? '#80cbc4' : node.data?.kind === 'note' ? '#efb64f' : '#aab7c8'} />
        </ReactFlow>
        <div className="tool-rail"><button title="便签" onClick={() => addNode('note')}><StickyNote size={19} /></button><button title="文本" onClick={() => addNode('text')}><Text size={19} /></button><button title="图片" onClick={() => addNode('image')}><Image size={19} /></button><span /><button className="ai-tool" title="AI 对话" onClick={() => addNode('ai')}><Bot size={19} /></button></div>
      </div> : <div className="empty-state"><div><FilePlus2 size={34} /><h2>从一张空白画布开始</h2><p>把文字、图片和 AI 对话放到同一个可延展空间。</p><button className="primary" onClick={createCanvas} disabled={creatingCanvas}><Plus size={17} />新建画布</button></div></div>}
    </section>
    {panel === 'account' && <AccountDrawer user={user} close={() => setPanel(null)} notify={setNotice} />}
    {panel === 'wallet' && <WalletDrawer user={user} refresh={refreshUser} close={() => setPanel(null)} notify={setNotice} />}
    {panel === 'admin' && <AdminDrawer close={() => setPanel(null)} notify={setNotice} refresh={refreshUser} />}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'ok' ? <Check size={16} /> : <X size={16} />}{notice.text}</div>}
  </main>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(session.get()))
  useEffect(() => {
    if (!session.get()) return
    api<{ user: User }>('/me').then((result) => setUser(result.user)).catch(() => session.clear()).finally(() => setLoading(false))
  }, [])
  if (loading) return <div className="app-loading"><div className="brand-mark">墨</div><span>正在打开画布…</span></div>
  return user ? <Workspace user={user} setUser={setUser} /> : <Auth onDone={setUser} />
}
